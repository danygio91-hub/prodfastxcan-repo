
import { BillOfMaterialsItem, JobBillOfMaterialsItem, MaterialWithdrawal, RawMaterial, RawMaterialBatch, UnitOfMeasure } from '@/types';
import {
  findMaterialTypeConfig,
  GlobalSettings,
  RawMaterialTypeConfig,
} from './settings-types';
import { getLotResidualSummary, hydrateMaterialWithWithdrawals, normStockLot } from './stock-logic';

export const STOCK_FLOAT_EPSILON = 0.01;
export const INTEGER_ROUNDING_TOLERANCE = 0.5;

export interface InventoryMovementOptions {
  isExhaustion?: boolean;
}

export interface InventoryMovementResult {
  unitsToChange: number; // In Base UOM
  weightToChange: number; // In Kg
  updatedBatches: RawMaterialBatch[];
  usedLotto: string | null;
}

/**
 * Calculates the impact of a movement (addition or subtraction) on stock and batches.
 * 
 * @param material The current material document
 * @param config The configuration for this material's type
 * @param quantity The quantity of the movement (relative to inputUom)
 * @param inputUom The unit of the input quantity ('kg', 'mt', 'n')
 * @param isAddition True for Carico, False for Scarico
 * @param specificLotto Optional lot for targeted movement
 * @param withdrawals ALL current withdrawals for this material (for Live Aggregation check)
 * @param options Optional behavior flags (e.g. isExhaustion for "Materiale Finito")
 */
export function calculateInventoryMovement(
  material: RawMaterial,
  config: Partial<RawMaterialTypeConfig> & { defaultUnit: string },
  quantity: number,
  inputUom: UnitOfMeasure,
  isAddition: boolean,
  specificLotto?: string | null,
  withdrawals: any[] = [],
  options?: InventoryMovementOptions
): InventoryMovementResult {
  const baseUom = (config?.defaultUnit || material.unitOfMeasure) as UnitOfMeasure;
  const factor = getConversionFactor(material, config);
  const isExhaustion = Boolean(options?.isExhaustion);
  
  let unitsToChange = 0;
  let weightToChange = 0;

  // 1. Calculate impact in Base UOM and KG
  let unitsToChangeRaw = 0;
  let weightToChangeRaw = 0;

  if (inputUom === 'kg') {
    weightToChangeRaw = quantity;
    if (baseUom === 'kg') {
      unitsToChangeRaw = quantity;
    } else {
      // KG to Base (e.g. MT, N): Division by factor
      unitsToChangeRaw = factor > 0 ? quantity / factor : quantity;
    }
  } else {
    // Primary UOM (MT, N, or KG) to KG
    unitsToChangeRaw = quantity;
    if (baseUom === 'kg') {
      weightToChangeRaw = quantity;
    } else {
      // Base (MT, N) to KG: Multiplication by factor
      weightToChangeRaw = quantity * factor;
    }
  }

  // HARDENING: ENFORCE INTEGRITY AND REMOVE FLOATING POINT NOISE
  if (baseUom === 'n') {
    // TASSATIVO: Pezzi sempre interi nei carichi/scarichi standard
    unitsToChange = Math.round(unitsToChangeRaw);
  } else {
    // Normalizzazione millesimale per MT e altri
    unitsToChange = Number(unitsToChangeRaw.toFixed(3));
  }

  // Pesi sempre normalizzati a 3 decimali
  weightToChange = Number(weightToChangeRaw.toFixed(3));

  const batches = (material.batches || []).map((b) => ({ ...b }));
  let usedLotto: string | null = specificLotto || null;

  if (isAddition) {
    if (specificLotto) {
      const targetNorm = normStockLot(specificLotto);
      const idx = batches.findIndex((b) => normStockLot(b.lotto) === targetNorm);
      if (idx !== -1) {
        batches[idx].netQuantity = Number(((batches[idx].netQuantity || 0) + unitsToChange).toFixed(3));
        batches[idx].grossWeight = Number(((batches[idx].grossWeight || 0) + weightToChange).toFixed(3));
        if (batches[idx].netQuantity > 0.001) batches[idx].isExhausted = false;
      }
    }
  } else {
    // SUBTRACTION (Withdrawal/Scarico) - IMMUTABLE LOG: STOP DEDUCTING FROM BATCHES IN DB
    const hydrated = hydrateMaterialWithWithdrawals(material, withdrawals as MaterialWithdrawal[]);

    if (specificLotto) {
      const residual = getLotResidualSummary(hydrated, specificLotto);
      if (residual.matchingBatches.length === 0) {
        throw new Error(`Lotto "${specificLotto}" non trovato.`);
      }

      const canonicalLotto = residual.activeBatch?.lotto || residual.matchingBatches[0]?.lotto || specificLotto;
      const liveAvailableUnits = Math.max(0, residual.availableUnits);
      const liveAvailableWeightKg = Math.max(0, residual.availableWeightKg);
      usedLotto = canonicalLotto;

      if (isExhaustion) {
        // FASE 99: Zero-Out Esatto SSoT ("Materiale Finito")
        // Ignora qualsiasi quantità arrotondata lato client e scarica esattamente il residuo reale del lotto.
        unitsToChange = Number(liveAvailableUnits.toFixed(3));
        weightToChange = liveAvailableWeightKg > 0
          ? Number(liveAvailableWeightKg.toFixed(3))
          : Number((unitsToChange * (baseUom === 'kg' ? 1 : factor)).toFixed(3));

        const targetNorm = normStockLot(canonicalLotto);
        for (let i = 0; i < batches.length; i++) {
          if (normStockLot(batches[i].lotto) === targetNorm) {
            batches[i].isExhausted = true;
          }
        }
      } else if (unitsToChange > liveAvailableUnits) {
        const diff = unitsToChange - liveAvailableUnits;
        const withinFloatTolerance = diff <= STOCK_FLOAT_EPSILON;
        const withinIntegerRoundingTolerance = baseUom === 'n' && diff <= INTEGER_ROUNDING_TOLERANCE;

        if (withinFloatTolerance || withinIntegerRoundingTolerance) {
          // FASE 99: Clamping tollerante sul residuo reale per assorbire rumore float o arrotondamenti interi (es. 106 vs 105.728)
          unitsToChange = Number(liveAvailableUnits.toFixed(3));
          weightToChange =
            baseUom === 'kg'
              ? unitsToChange
              : liveAvailableWeightKg > 0
                ? Math.min(weightToChange, Number(liveAvailableWeightKg.toFixed(3)))
                : Number((unitsToChange * factor).toFixed(3));
        } else {
          throw new Error(`Giacenza insufficiente sul lotto ${canonicalLotto}. Richiesti: ${Number(unitsToChange.toFixed(3))}, Disponibili: ${Number(liveAvailableUnits.toFixed(3))}`);
        }
      }
    } else {
      // FIFO Withdrawal detection for reporting used lot
      const validBatches = (hydrated.batches || [])
        .filter((b) => !b.isExhausted && (b.currentQuantity ?? b.netQuantity ?? 0) > 0.001)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (validBatches.length > 0) {
        usedLotto = validBatches[0].lotto as string;
      }

      if (isExhaustion) {
        const totalAvail = Math.max(0, Number((hydrated.currentStockUnits || 0).toFixed(3)));
        if (unitsToChange <= 0 || unitsToChange > totalAvail) {
          unitsToChange = totalAvail;
          weightToChange = baseUom === 'kg'
            ? unitsToChange
            : Math.max(0, Number((hydrated.currentWeightKg || unitsToChange * factor).toFixed(3)));
        }
      }
    }
  }

  return {
    unitsToChange,
    weightToChange,
    updatedBatches: batches,
    usedLotto
  };
}

export interface ExecuteLotWithdrawalParams {
  material: RawMaterial;
  config: Partial<RawMaterialTypeConfig> & { defaultUnit: string };
  withdrawals: any[];
  quantity: number;
  inputUom: UnitOfMeasure;
  lotto?: string | null;
  isFinished?: boolean;
  clearActiveSession?: boolean;
}

/**
 * Helper SSoT centralizzato per scarichi normali e azzeramenti "Materiale Finito".
 * In modalità `isFinished`, ignora quantità client arrotondate e azzera esattamente il residuo SSoT del lotto.
 */
export function prepareWithdrawalMovement(params: ExecuteLotWithdrawalParams): InventoryMovementResult {
  const {
    material,
    config,
    withdrawals,
    quantity,
    inputUom,
    lotto,
    isFinished = false,
    clearActiveSession = false,
  } = params;

  const movement = calculateInventoryMovement(
    material,
    config,
    isFinished ? 0 : quantity,
    isFinished ? ((config?.defaultUnit || material.unitOfMeasure) as UnitOfMeasure) : inputUom,
    false,
    lotto,
    withdrawals,
    { isExhaustion: isFinished }
  );

  let updatedBatches = movement.updatedBatches;
  if (movement.usedLotto && (isFinished || clearActiveSession)) {
    const targetNorm = normStockLot(movement.usedLotto);
    updatedBatches = updatedBatches.map((b) =>
      normStockLot(b.lotto) === targetNorm
        ? {
            ...b,
            ...(isFinished ? { isExhausted: true } : {}),
            ...(clearActiveSession ? { activeSessionId: null } : {}),
          }
        : b
    );
  }

  return {
    ...movement,
    updatedBatches,
  };
}

/**
 * Re-idrata il materiale post-scarico nello stesso perimetro transazionale
 * garantendo che `currentStockUnits`, `currentWeightKg` e flag `isExhausted`
 * risultino esattamente allineati (0 assoluto su Materiale Finito).
 */
export function finalizePostWithdrawalMaterialState(
  material: RawMaterial,
  updatedBatches: RawMaterialBatch[],
  previousWithdrawals: any[],
  newWithdrawalRecord: Record<string, any>
): {
  hydratedAfter: RawMaterial;
  syncedBatches: RawMaterialBatch[];
  currentStockUnits: number;
  currentWeightKg: number;
} {
  const postWithdrawals = [
    ...previousWithdrawals,
    { ...newWithdrawalRecord, withdrawalDate: new Date() },
  ];
  const hydratedAfter = hydrateMaterialWithWithdrawals(
    { ...material, batches: updatedBatches },
    postWithdrawals as MaterialWithdrawal[]
  );
  const hydratedById = new Map((hydratedAfter.batches || []).map((b) => [b.id, b]));
  const syncedBatches = updatedBatches.map((b) => {
    const hb = hydratedById.get(b.id);
    return {
      ...b,
      isExhausted: Boolean(b.isExhausted || hb?.isExhausted),
    };
  });

  const syncedHydrated: RawMaterial = {
    ...hydratedAfter,
    batches: (hydratedAfter.batches || []).map((b) => ({
      ...b,
      isExhausted: Boolean(b.isExhausted || updatedBatches.find((ub) => ub.id === b.id)?.isExhausted),
    })),
  };

  return {
    hydratedAfter: syncedHydrated,
    syncedBatches,
    currentStockUnits: syncedHydrated.currentStockUnits,
    currentWeightKg: syncedHydrated.currentWeightKg,
  };
}

/**
 * Robust conversion factor selector with fallback.
 */
export function getConversionFactor(
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>,
  config?: Partial<RawMaterialTypeConfig>
): number {
  const uom = (material?.unitOfMeasure || config?.defaultUnit || '').toLowerCase();
  const ratio =
    uom === 'mt' || config?.conversionType === 'kg/mt'
      ? (material?.rapportoKgMt || material?.conversionFactor || 0)
      : (material?.conversionFactor || material?.rapportoKgMt || 0);

  if (ratio > 0) return ratio;

  return 1; // Default to 1 (discrete or unconfigured)
}

export interface BOMRequirementDetails {
  /** Fabbisogno LORDO in unità base (con eventuale scarto % se abilitato sul tipo) — per Approvvigionamenti / MRP / Impegnato */
  totalInBaseUnits: number;
  /** Fabbisogno NETTO in unità base (senza scarto %) — per Officina / Stampa ODL / Tablet */
  netInBaseUnits: number;
  baseUnit: UnitOfMeasure;  // The official UOM of the material
  /** Peso stimato LORDO in KG */
  weightKg: number;
  /** Peso stimato NETTO in KG */
  netWeightKg: number;
  /** Metri LORDI (se lunghezzaTaglioMm o unit mt) */
  totalMeters?: number;
  /** Metri NETTI (se lunghezzaTaglioMm o unit mt) */
  netMeters?: number;
  totalPieces: number;      // Total pieces (jobQta * bomItem.quantity, invariato rispetto allo scarto)
  /** Percentuale di scarto effettivamente applicata (0 se switch enableScrap OFF o campo non valorizzato) */
  appliedScrapPercent: number;
}

/**
 * Calculates the material requirement (commitment) based on BOM data.
 * Centralizes the logic for length-to-base conversion (mm -> mt -> kg/others)
 * and separates NET (officina/ODL/tablet) vs GROSS (approvvigionamenti/MRP/impegnato with scrap %).
 *
 * @param jobQta The quantity of the production job/manual order
 * @param bomItem The BOM item containing 'quantity', 'unit', optionally 'lunghezzaTaglioMm' and 'scrapPercentage'
 * @param material The raw material document
 * @param config The configuration for this material's type
 */
export function calculateBOMRequirement(
  jobQta: number,
  bomItem: { quantity: number; lunghezzaTaglioMm?: number | null; unit: string; scrapPercentage?: number | null },
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'> | null | undefined,
  config: (Partial<RawMaterialTypeConfig> & { defaultUnit: string }) | null | undefined
): BOMRequirementDetails {
  const qta = Number(jobQta) || 0;
  const bomQty = Number(bomItem.quantity) || 0;

  // SSoT: L'unità base è quella del materiale (eccezione locale) oppure default del tipo
  const rawUom = material?.unitOfMeasure || config?.defaultUnit || bomItem.unit || 'n';
  const baseUnitStr = rawUom.toLowerCase();
  const baseUnit = baseUnitStr as UnitOfMeasure;

  const totalPieces = qta * bomQty;

  // ARCHITETTURA: I flag di GlobalSettings guidano dinamicamente la logica (retrocompatibili se omessi)
  const richiedeTaglio = config?.requiresCutLength !== false;
  const explicitFactor = Number(material?.rapportoKgMt || material?.conversionFactor || 0) > 0;
  const usaConversione =
    config?.hasConversion === true
      ? true
      : config?.hasConversion === false
        ? false
        : baseUnitStr === 'kg'
          ? explicitFactor
          : Number(material?.rapportoKgMt || 0) > 0;
  const conversionType = config?.conversionType; // 'kg/mt' o 'kg/unit'
  const lengthMm = Number(bomItem.lunghezzaTaglioMm) || 0;

  const factor = usaConversione && material ? getConversionFactor(material, config || undefined) : 1;

  let netMetersRaw: number | undefined = undefined;

  // 1. Calcolo Metri NETTI (Solo se richiedeTaglio !== false e lunghezza > 0, o BOM in mt)
  if (richiedeTaglio && lengthMm > 0) {
    netMetersRaw = (totalPieces * lengthMm) / 1000;
  } else if (bomItem.unit?.toLowerCase() === 'mt' || bomItem.unit?.toLowerCase() === 'm') {
    netMetersRaw = totalPieces;
  }

  // 2. Fabbisogno NETTO in base all'unità (Source of Truth Officina)
  let netInBaseUnits = 0;
  if (baseUnitStr === 'kg') {
    if (usaConversione) {
      if (conversionType === 'kg/mt' || (conversionType == null && netMetersRaw !== undefined)) {
        // Conversione da Metri a KG (es. Bobina: netMeters * rapportoKgMt)
        netInBaseUnits = (netMetersRaw !== undefined ? netMetersRaw : 0) * factor;
      } else if (conversionType === 'kg/unit' || conversionType == null) {
        // Conversione da Pezzi a KG (es. Tubi: totalPieces * pesoUnitario)
        netInBaseUnits = totalPieces * factor;
      }
    } else {
      // Senza conversione (impostazione admin) fallback 1:1
      netInBaseUnits = netMetersRaw !== undefined ? netMetersRaw : totalPieces;
    }
  } else if (baseUnitStr === 'mt' || baseUnitStr === 'm') {
    netInBaseUnits = netMetersRaw !== undefined ? netMetersRaw : totalPieces;
  } else {
    // baseUnitStr === 'n' o altro
    netInBaseUnits = totalPieces;
  }

  // 3. Stima Peso NETTO
  let netWeightKg = 0;
  if (baseUnitStr === 'kg') {
    netWeightKg = netInBaseUnits;
  } else if (usaConversione && factor > 0) {
    netWeightKg = netInBaseUnits * factor;
  }

  // 4. Scarto % per Approvvigionamenti / MRP (attivo SOLO se switch config.enableScrap === true)
  const rawScrap = Math.max(0, Number(bomItem.scrapPercentage) || 0);
  const appliedScrapPercent = config?.enableScrap === true ? rawScrap : 0;
  const mult = 1 + appliedScrapPercent / 100;

  const netMeters = netMetersRaw !== undefined ? Number(netMetersRaw.toFixed(4)) : undefined;

  let totalInBaseUnits = netInBaseUnits;
  let weightKg = netWeightKg;
  let totalMeters = netMeters;

  if (appliedScrapPercent > 0) {
    if (netMetersRaw !== undefined) {
      totalMeters = Number((netMetersRaw * mult).toFixed(4));
    }
    if (baseUnitStr === 'n') {
      totalInBaseUnits = Math.ceil(netInBaseUnits * mult);
    } else {
      totalInBaseUnits = Number((netInBaseUnits * mult).toFixed(4));
    }
    weightKg =
      baseUnitStr === 'kg'
        ? totalInBaseUnits
        : usaConversione && factor > 0
          ? Number((totalInBaseUnits * factor).toFixed(4))
          : 0;
  }

  return {
    totalInBaseUnits,
    netInBaseUnits,
    baseUnit,
    weightKg,
    netWeightKg,
    totalMeters,
    netMeters,
    totalPieces,
    appliedScrapPercent,
  };
}

/**
 * Helper SSoT unico per costruire una riga BOM commessa partendo da una riga template/manuale,
 * popolando sia i campi LORDI (fabbisognoTotale, pesoStimato) che quelli NETTI (fabbisognoNetto, pesoNettoStimato).
 */
export function computeJobBOMItemSnapshot(params: {
  jobQta: number;
  bomItem: Partial<BillOfMaterialsItem> & { component: string; quantity: number; unit: UnitOfMeasure };
  rawMaterials?: RawMaterial[];
  globalSettings?: Partial<GlobalSettings> | null;
  status?: JobBillOfMaterialsItem['status'];
  withdrawn?: boolean;
  isFromTemplate?: boolean;
}): JobBillOfMaterialsItem {
  const {
    jobQta,
    bomItem,
    rawMaterials = [],
    globalSettings = null,
    status = 'pending',
    withdrawn = false,
    isFromTemplate = true,
  } = params;

  const compCode = (bomItem.component || '').toUpperCase().trim();
  const material = rawMaterials.find((m) => (m?.code || '').toUpperCase().trim() === compCode);
  const typeConfig = findMaterialTypeConfig(material?.type, globalSettings);
  const requiresCut = typeConfig ? typeConfig.requiresCutLength !== false : true;
  const resolvedUnit = ((material?.unitOfMeasure as UnitOfMeasure) || bomItem.unit || 'n');
  const rawScrap = Number(bomItem.scrapPercentage);
  const normalizedScrap =
    typeConfig?.enableScrap === true && Number.isFinite(rawScrap) && rawScrap > 0 ? rawScrap : null;

  const req = calculateBOMRequirement(
    jobQta,
    {
      quantity: bomItem.quantity,
      lunghezzaTaglioMm: requiresCut ? bomItem.lunghezzaTaglioMm : undefined,
      unit: resolvedUnit,
      scrapPercentage: normalizedScrap,
    },
    material || ({ unitOfMeasure: resolvedUnit, conversionFactor: 1, rapportoKgMt: 0 } as any),
    typeConfig || ({ defaultUnit: resolvedUnit } as any)
  );

  const resolvedCut =
    requiresCut && bomItem.lunghezzaTaglioMm !== undefined && bomItem.lunghezzaTaglioMm !== null && Number(bomItem.lunghezzaTaglioMm) > 0
      ? Number(bomItem.lunghezzaTaglioMm)
      : undefined;

  return {
    ...bomItem,
    component: compCode,
    unit: resolvedUnit,
    quantity: Number(bomItem.quantity) || 0,
    lunghezzaTaglioMm: resolvedCut,
    note: bomItem.note,
    scrapPercentage: normalizedScrap,
    status,
    withdrawn,
    isFromTemplate,
    fabbisognoTotale: req.totalInBaseUnits,
    fabbisognoNetto: req.netInBaseUnits,
    pesoStimato: req.weightKg,
    pesoNettoStimato: req.netWeightKg,
  };
}

/**
 * Helper unificato per generare l'intero array billOfMaterials di una commessa dall'anagrafica Articolo.
 */
export function buildJobBOMItemsFromArticle(params: {
  jobQta: number;
  articleBOM?: Array<Partial<BillOfMaterialsItem> & { component: string; quantity: number; unit: UnitOfMeasure }>;
  rawMaterials?: RawMaterial[];
  globalSettings?: Partial<GlobalSettings> | null;
}): JobBillOfMaterialsItem[] {
  const { jobQta, articleBOM = [], rawMaterials = [], globalSettings = null } = params;
  if (!Array.isArray(articleBOM) || articleBOM.length === 0) return [];

  return articleBOM.map((item) =>
    computeJobBOMItemSnapshot({
      jobQta,
      bomItem: item,
      rawMaterials,
      globalSettings,
      status: 'pending',
      withdrawn: false,
      isFromTemplate: true,
    })
  );
}

/**
 * Helper to synchronize a JobOrder's BOM with the Article's BOM.
 * recalculates explicit fields (fabbisognoTotale, fabbisognoNetto, pesoStimato, pesoNettoStimato).
 * FASE 105-BIS: Supporta più righe con lo stesso codice componente e lunghezze di taglio diverse.
 */
export function syncJobBOMItems(
    jobQta: number,
    currentBOM: any[], // JobBillOfMaterialsItem[]
    articleBOM: any[] = [], // JobBillOfMaterialsItem[]
    rawMaterials: RawMaterial[],
    globalSettings: any
): any[] {
    const safeArticleBOM = Array.isArray(articleBOM) ? articleBOM : [];
    const safeCurrentBOM = Array.isArray(currentBOM) ? currentBOM : [];
    const updatedBOM: any[] = [];

    const normalizeCutKey = (val: unknown): string => {
        if (val === null || val === undefined || val === '' || val === 0) return 'NO_CUT';
        const num = Number(val);
        return Number.isFinite(num) && num > 0 ? String(num) : 'NO_CUT';
    };

    const articleComponentSet = new Set(
        safeArticleBOM.map((item) => (item?.component || '').toUpperCase().trim()).filter(Boolean)
    );

    const currentByCompositeKey = new Map<string, any>();
    const currentByCompCounts = new Map<string, number>();
    const currentBucketsByComp = new Map<string, any[]>();

    safeCurrentBOM.forEach((item) => {
        const compCode = (item?.component || '').toUpperCase().trim() || 'UNKNOWN';
        const cutKey = normalizeCutKey(item?.lunghezzaTaglioMm);
        const basePair = `${compCode}__${cutKey}`;
        const occIdx = currentByCompCounts.get(basePair) || 0;
        currentByCompCounts.set(basePair, occIdx + 1);
        currentByCompositeKey.set(`${basePair}__${occIdx}`, item);

        const bucket = currentBucketsByComp.get(compCode) || [];
        bucket.push(item);
        currentBucketsByComp.set(compCode, bucket);
    });

    const consumedCurrentItems = new Set<any>();
    const articlePairCounts = new Map<string, number>();

    // 1. Update/Add items from Article BOM (o ricalcola currentBOM se articleBOM è vuota)
    const sourceTemplateBOM = safeArticleBOM.length > 0 ? safeArticleBOM : safeCurrentBOM;

    sourceTemplateBOM.forEach((artItem) => {
        const compCode = (artItem?.component || '').toUpperCase().trim() || 'UNKNOWN';
        const cutKey = normalizeCutKey(artItem?.lunghezzaTaglioMm);
        const basePair = `${compCode}__${cutKey}`;
        const occIdx = articlePairCounts.get(basePair) || 0;
        articlePairCounts.set(basePair, occIdx + 1);

        let existingItem = currentByCompositeKey.get(`${basePair}__${occIdx}`);
        if (!existingItem || consumedCurrentItems.has(existingItem)) {
            const candidates = currentBucketsByComp.get(compCode) || [];
            existingItem = candidates.find((c) => !consumedCurrentItems.has(c));
        }
        if (existingItem) {
            consumedCurrentItems.add(existingItem);
        }

        const snapshot = computeJobBOMItemSnapshot({
            jobQta,
            bomItem: artItem,
            rawMaterials,
            globalSettings,
            status: existingItem?.status || artItem?.status || 'pending',
            withdrawn: existingItem?.withdrawn ?? artItem?.withdrawn ?? false,
            isFromTemplate: safeArticleBOM.length > 0 ? true : (artItem.isFromTemplate ?? true),
        });

        updatedBOM.push({
            ...snapshot,
            lunghezzaTaglioMm: snapshot.lunghezzaTaglioMm ?? null,
        });
    });

    // 2. Preserve manually added items that are NOT in the article BOM
    if (safeArticleBOM.length > 0) {
        safeCurrentBOM.forEach((item) => {
            const compCode = (item?.component || '').toUpperCase().trim() || 'UNKNOWN';
            if (!item.isFromTemplate && !articleComponentSet.has(compCode) && !consumedCurrentItems.has(item)) {
                const snapshot = computeJobBOMItemSnapshot({
                    jobQta,
                    bomItem: item,
                    rawMaterials,
                    globalSettings,
                    status: item.status || 'pending',
                    withdrawn: item.withdrawn ?? false,
                    isFromTemplate: false,
                });

                updatedBOM.push({
                    ...snapshot,
                    lunghezzaTaglioMm: snapshot.lunghezzaTaglioMm ?? null,
                });
            }
        });
    }

    return updatedBOM;
}
