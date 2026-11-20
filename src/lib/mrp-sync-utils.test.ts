import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MRP_SYNC_META,
  acknowledgeLocalMrpSyncMeta,
  collectGlobalMrpCodes,
  evaluateMrpSyncDiff,
  hasFullStockHydration,
  normalizeMrpSyncMeta,
  upsertPurchaseOrdersIntoCache,
} from './mrp-sync-utils';
import type { Article, JobOrder, PurchaseOrder, RawMaterial } from '@/types';

const makeJob = (overrides: Partial<JobOrder> = {}): JobOrder => ({
  id: 'job-1',
  cliente: 'CLIENTE',
  qta: 100,
  department: 'CP',
  details: 'ART-001',
  ordinePF: '900/PF.1',
  dataConsegnaFinale: '2026-12-01',
  postazioneLavoro: 'P1',
  phases: [],
  status: 'Pianificata',
  ...overrides,
});

const makeArticle = (code: string, components: string[]): Article => ({
  id: code,
  code,
  description: `Articolo ${code}`,
  department: 'CP',
  workCycleId: 'wc-1',
  billOfMaterials: components.map((c) => ({
    component: c,
    quantity: 1,
    unit: 'kg',
  })),
});

const makePO = (id: string, materialCode: string, quantity: number, receivedQuantity = 0): PurchaseOrder => ({
  id,
  orderNumber: `PO-${id}`,
  supplierName: 'Fornitore Test',
  materialCode,
  quantity,
  receivedQuantity,
  unitOfMeasure: 'kg',
  expectedDeliveryDate: '2026-12-10',
  status: 'pending',
  createdAt: '2026-11-01T00:00:00.000Z',
});

describe('FASE 100-BIS: Version Token MRP & Bonifica Cache', () => {
  it('valuta correttamente diff Version Token (none vs stock_po vs full) e riallineamento locale', () => {
    const base = normalizeMrpSyncMeta({
      version: 10,
      stockVersion: 4,
      poVersion: 2,
      jobsBomVersion: 4,
    });

    // Versione invariata -> 0 query MRP
    expect(evaluateMrpSyncDiff(base, { ...base })).toEqual({
      needsRefresh: false,
      scope: 'none',
    });

    // Solo stockVersion incrementato (es. carico/scarico magazzino) -> refresh mirato stock_po
    expect(
      evaluateMrpSyncDiff(base, {
        ...base,
        version: 11,
        stockVersion: 5,
      })
    ).toEqual({
      needsRefresh: true,
      scope: 'stock_po',
    });

    // Solo poVersion incrementato -> refresh mirato stock_po
    expect(
      evaluateMrpSyncDiff(base, {
        ...base,
        version: 11,
        poVersion: 3,
      })
    ).toEqual({
      needsRefresh: true,
      scope: 'stock_po',
    });

    // jobsBomVersion incrementato -> refresh completo
    expect(
      evaluateMrpSyncDiff(base, {
        ...base,
        version: 11,
        jobsBomVersion: 5,
      })
    ).toEqual({
      needsRefresh: true,
      scope: 'full',
    });

    // Mutazione locale in Programmazione riallinea il ref locale evitando doppio fetch
    const afterLocal = acknowledgeLocalMrpSyncMeta(base, 'jobsBom', 'local:updateJobNote');
    expect(afterLocal.version).toBe(11);
    expect(afterLocal.jobsBomVersion).toBe(5);
    expect(
      evaluateMrpSyncDiff(afterLocal, {
        ...base,
        version: 11,
        jobsBomVersion: 5,
      })
    ).toEqual({
      needsRefresh: false,
      scope: 'none',
    });

    // Ma se nel frattempo un altro utente ha fatto un carico magazzino, scatta stock_po!
    expect(
      evaluateMrpSyncDiff(afterLocal, {
        ...base,
        version: 12,
        stockVersion: 5,
        jobsBomVersion: 5,
      })
    ).toEqual({
      needsRefresh: true,
      scope: 'stock_po',
    });

    // Bulk start con delta=3
    const afterBulk = acknowledgeLocalMrpSyncMeta(DEFAULT_MRP_SYNC_META, 'jobsBom', 'bulkStart', 3);
    expect(afterBulk.version).toBe(3);
    expect(afterBulk.jobsBomVersion).toBe(3);
  });

  it('Fix #1: rifiuta proiezioni parziali di getOdlPrintData (senza stock/batches) per impedire avvelenamento materialsCacheRef', () => {
    // Proiezione restituita da getOdlPrintData senza includeStockHydration (causava stock = 0 / MANCANTE)
    const partialOdlMat = {
      id: 'mat-150',
      code: '150X020X38FT-CL',
      type: 'CAVO',
      unitOfMeasure: 'kg',
      conversionFactor: 1,
      rapportoKgMt: 0.5,
      description: 'Cavo test ODL',
    } as unknown as RawMaterial;

    expect(hasFullStockHydration(partialOdlMat)).toBe(false);

    // Materiale idratato SSoT da getTargetedMRPData (con currentStockUnits / batches)
    const hydratedMrpMat: RawMaterial = {
      id: 'mat-150',
      code: '150X020X38FT-CL',
      type: 'CAVO',
      unitOfMeasure: 'kg',
      description: 'Cavo test MRP',
      details: {},
      currentStockUnits: 814,
      currentWeightKg: 814,
      batches: [],
    };

    expect(hasFullStockHydration(hydratedMrpMat)).toBe(true);
  });

  it('Fix #2: risolve i componenti BOM da articleMap/articlesCache gia in collectGlobalMrpCodes per commesse senza BOM inline', () => {
    const artCached = makeArticle('ART-CACHED', ['150X020X38FT-CL', '20X1L30R']);
    const articleMap = new Map<string, Article>([['ART-CACHED', artCached]]);
    const articlesCache = new Map<string, Article>([
      ['ART-REF-ONLY', makeArticle('ART-REF-ONLY', ['COMP-REF'])],
    ]);

    const jobs: JobOrder[] = [
      // 1. Commessa senza billOfMaterials inline, articolo in articleMap
      makeJob({ id: 'j1', details: 'art-cached', billOfMaterials: [] }),
      // 2. Commessa senza billOfMaterials inline, articolo in articlesCacheRef
      makeJob({ id: 'j2', details: 'ART-REF-ONLY', billOfMaterials: undefined }),
      // 3. Commessa senza billOfMaterials inline, articolo NON in cache -> va in globalArticleCodes
      makeJob({ id: 'j3', details: 'ART-MISSING', billOfMaterials: [] }),
      // 4. Commessa con BOM inline
      makeJob({
        id: 'j4',
        details: 'ART-INLINE',
        billOfMaterials: [
          { component: 'COMP-INLINE', quantity: 2, unit: 'n', status: 'pending', isFromTemplate: false },
        ],
      }),
      // 5. Commessa conclusa -> ignorata
      makeJob({ id: 'j5', details: 'ART-DONE', status: 'Spedito', billOfMaterials: [] }),
    ];

    const { globalMaterialCodes, globalArticleCodes } = collectGlobalMrpCodes(
      jobs,
      articleMap,
      articlesCache,
      (j) => j.status === 'Spedito'
    );

    expect(globalMaterialCodes.sort()).toEqual(
      ['150X020X38FT-CL', '20X1L30R', 'COMP-INLINE', 'COMP-REF'].sort()
    );
    expect(globalArticleCodes).toEqual(['ART-MISSING']);
  });

  it('Fix #3: deduplica poCacheRef per po.id evitando duplicati su fetch incrementali e sostituendo su replaceAll', () => {
    const poCache = new Map<string, PurchaseOrder[]>();

    // Prima popolazione
    upsertPurchaseOrdersIntoCache(poCache, [
      makePO('po-1', '150X020X38FT-CL', 500, 0),
      makePO('po-2', '150X020X38FT-CL', 300, 50),
    ]);
    expect(poCache.get('150X020X38FT-CL')).toHaveLength(2);

    // Fetch incrementale successivo con lo stesso po-1 aggiornato + nuovo po-3: NON deve duplicare po-1!
    upsertPurchaseOrdersIntoCache(poCache, [
      makePO('po-1', '150x020x38ft-cl', 500, 200),
      makePO('po-3', '150X020X38FT-CL', 100, 0),
    ]);

    const afterUpsert = poCache.get('150X020X38FT-CL') || [];
    expect(afterUpsert).toHaveLength(3);
    expect(afterUpsert.find((p) => p.id === 'po-1')?.receivedQuantity).toBe(200);

    // Refresh completo con replaceAll: rimuove PO chiusi/non piu presenti
    upsertPurchaseOrdersIntoCache(
      poCache,
      [makePO('po-3', '150X020X38FT-CL', 100, 0)],
      { replaceAll: true }
    );
    expect(poCache.get('150X020X38FT-CL')?.map((p) => p.id)).toEqual(['po-3']);
  });
});
