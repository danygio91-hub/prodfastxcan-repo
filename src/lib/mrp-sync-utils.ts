import type { Article, JobOrder, PurchaseOrder, RawMaterial } from '@/types';

export type MrpSyncDomain = 'stock' | 'po' | 'jobsBom';

export interface MrpSyncMeta {
  version: number;
  stockVersion: number;
  poVersion: number;
  jobsBomVersion: number;
  updatedAt: string | null;
  lastSource: string | null;
}

export const DEFAULT_MRP_SYNC_META: MrpSyncMeta = {
  version: 0,
  stockVersion: 0,
  poVersion: 0,
  jobsBomVersion: 0,
  updatedAt: null,
  lastSource: null,
};

export type MrpSyncRefreshScope = 'none' | 'stock_po' | 'full';

export function normalizeMrpSyncMeta(raw?: Record<string, any> | null): MrpSyncMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MRP_SYNC_META };
  }

  const toSafeCounter = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  let updatedAt: string | null = null;
  if (raw.updatedAt) {
    if (typeof raw.updatedAt === 'string') {
      updatedAt = raw.updatedAt;
    } else if (raw.updatedAt instanceof Date) {
      updatedAt = raw.updatedAt.toISOString();
    } else if (typeof raw.updatedAt.toDate === 'function') {
      try {
        updatedAt = raw.updatedAt.toDate().toISOString();
      } catch {
        updatedAt = null;
      }
    } else if (typeof raw.updatedAt._seconds === 'number') {
      updatedAt = new Date(raw.updatedAt._seconds * 1000).toISOString();
    }
  }

  return {
    version: toSafeCounter(raw.version),
    stockVersion: toSafeCounter(raw.stockVersion),
    poVersion: toSafeCounter(raw.poVersion),
    jobsBomVersion: toSafeCounter(raw.jobsBomVersion),
    updatedAt,
    lastSource: typeof raw.lastSource === 'string' && raw.lastSource.trim() ? raw.lastSource.trim() : null,
  };
}

/**
 * Confronta il token di sincronizzazione locale con quello remoto su `settings/mrp_sync_meta`.
 * - `'none'`: nessuna modifica -> 0 query MRP.
 * - `'stock_po'`: cambiati solo stock/prelievi/sessioni/PO -> svuota e ricarica solo MRP + sessioni attive.
 * - `'full'`: cambiate commesse/articoli/BOM -> ricarica anche jobs/articles preservando optimisticPatchesRef.
 */
export function evaluateMrpSyncDiff(
  local: MrpSyncMeta | null | undefined,
  remote: MrpSyncMeta | null | undefined
): { needsRefresh: boolean; scope: MrpSyncRefreshScope } {
  if (!remote) {
    return { needsRefresh: false, scope: 'none' };
  }

  const safeLocal = local ? normalizeMrpSyncMeta(local) : { ...DEFAULT_MRP_SYNC_META };
  const safeRemote = normalizeMrpSyncMeta(remote);

  const jobsBomChanged = safeRemote.jobsBomVersion > safeLocal.jobsBomVersion;
  const stockOrPoChanged =
    safeRemote.stockVersion > safeLocal.stockVersion ||
    safeRemote.poVersion > safeLocal.poVersion;
  const globalChanged = safeRemote.version > safeLocal.version;

  if (!jobsBomChanged && !stockOrPoChanged && !globalChanged) {
    return { needsRefresh: false, scope: 'none' };
  }

  if (jobsBomChanged) {
    return { needsRefresh: true, scope: 'full' };
  }

  return { needsRefresh: true, scope: 'stock_po' };
}

/**
 * Riallinea in memoria il token locale dopo una mutazione eseguita direttamente
 * nella pagina Programmazione, evitando un doppio fetch inutile al focus successivo.
 * Se un altro utente scrive in parallelo, il server avrà version > local + 1 e scatterà comunque il sync.
 */
export function acknowledgeLocalMrpSyncMeta(
  current: MrpSyncMeta | null | undefined,
  domains: MrpSyncDomain | MrpSyncDomain[] = 'jobsBom',
  source?: string,
  delta: number = 1
): MrpSyncMeta {
  const base = normalizeMrpSyncMeta(current);
  const step = Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 1;
  const domainList = Array.isArray(domains) ? domains : [domains];
  return {
    version: base.version + step,
    stockVersion: base.stockVersion + (domainList.includes('stock') ? step : 0),
    poVersion: base.poVersion + (domainList.includes('po') ? step : 0),
    jobsBomVersion: base.jobsBomVersion + (domainList.includes('jobsBom') ? step : 0),
    updatedAt: new Date().toISOString(),
    lastSource: source || base.lastSource,
  };
}

/**
 * FASE 100-BIS (Fix #1 - Stop Avvelenamento Cache ODL):
 * Verifica che un record RawMaterial contenga effettivamente dati di giacenza SSoT
 * (e non sia una proiezione parziale di stampa ODL priva di currentStockUnits/stock/batches).
 */
export function hasFullStockHydration(mat?: Partial<RawMaterial> | null): boolean {
  if (!mat || !mat.code) return false;
  return (
    mat.currentStockUnits !== undefined ||
    (mat as any).stock !== undefined ||
    Array.isArray(mat.batches)
  );
}

/**
 * FASE 100-BIS (Fix #2 - BOM da Articolo in Cache):
 * Estrae i codici materiale e articolo mancanti per le commesse attive.
 * Per commesse senza `job.billOfMaterials` inline, risolve i componenti BOM
 * direttamente da `articleMap` / `articlesCache` se già presenti, evitando che
 * i loro materiali restino esclusi da `getTargetedMRPData`.
 */
export function collectGlobalMrpCodes(
  activeJobs: JobOrder[],
  articleMap: Map<string, Article>,
  articlesCache: Map<string, Article>,
  isFinishedFn?: (job: JobOrder) => boolean
): {
  globalMaterialCodes: string[];
  globalArticleCodes: string[];
} {
  const matSet = new Set<string>();
  const artSet = new Set<string>();

  for (const job of activeJobs) {
    if (!job) continue;
    if (isFinishedFn && isFinishedFn(job)) continue;

    const inlineBom = Array.isArray(job.billOfMaterials) ? job.billOfMaterials : [];
    if (inlineBom.length > 0) {
      for (const item of inlineBom) {
        const comp = (item?.component || '').trim().toUpperCase();
        if (comp) matSet.add(comp);
      }
      continue;
    }

    const artCode = ((job as any).articolo || job.details || (job as any).articleCode || '').trim().toUpperCase();
    if (!artCode) continue;

    const cachedArt = articleMap.get(artCode) || articlesCache.get(artCode);
    if (cachedArt) {
      const artBom = Array.isArray(cachedArt.billOfMaterials) ? cachedArt.billOfMaterials : [];
      for (const item of artBom) {
        const comp = (item?.component || '').trim().toUpperCase();
        if (comp) matSet.add(comp);
      }
    } else {
      artSet.add(artCode);
    }
  }

  return {
    globalMaterialCodes: Array.from(matSet),
    globalArticleCodes: Array.from(artSet),
  };
}

/**
 * FASE 100-BIS (Fix #3 - Deduplicazione PO per `po.id`):
 * Inserisce/aggiorna i PurchaseOrder nella `poCache` raggruppati per `materialCode`
 * garantendo unicità per `po.id` (mai `list.push` duplicati).
 */
export function upsertPurchaseOrdersIntoCache(
  poCache: Map<string, PurchaseOrder[]>,
  incomingPOs: PurchaseOrder[],
  options?: { replaceAll?: boolean }
): void {
  if (options?.replaceAll) {
    poCache.clear();
  }

  if (!Array.isArray(incomingPOs) || incomingPOs.length === 0) return;

  const groupedByCode = new Map<string, Map<string, PurchaseOrder>>();

  for (const po of incomingPOs) {
    if (!po) continue;
    const code = (po.materialCode || (po as any).codiceArticolo || (po as any).code || '').trim().toUpperCase();
    if (!code) continue;

    let byId = groupedByCode.get(code);
    if (!byId) {
      byId = new Map<string, PurchaseOrder>();
      const existingList = poCache.get(code) || [];
      for (const existingPo of existingList) {
        if (existingPo?.id) {
          byId.set(existingPo.id, existingPo);
        }
      }
      groupedByCode.set(code, byId);
    }

    const poKey = po.id || `${code}::${po.orderNumber || ''}::${po.expectedDeliveryDate || ''}`;
    byId.set(poKey, po);
  }

  groupedByCode.forEach((byId, code) => {
    poCache.set(code, Array.from(byId.values()));
  });
}
