
import { RawMaterial, RawMaterialBatch, MaterialWithdrawal, UnitOfMeasure } from '@/types';
import { RawMaterialTypeConfig } from './settings-types';
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
export function getConversionFactor(material: RawMaterial, config: Partial<RawMaterialTypeConfig>): number {
  // SSoT Priority: Use rapportoKgMt if present (for KG/MT materials), otherwise conversionFactor
  const ratio = material.rapportoKgMt || material.conversionFactor || 0;
  
  if (ratio > 0) return ratio;
  
  return 1; // Default to 1 (discrete or unconfigured)
}

export interface BOMRequirementDetails {
  totalInBaseUnits: number; // Final value for stock (KG, MT or N)
  baseUnit: UnitOfMeasure;  // The official UOM of the material
  weightKg: number;         // Estimated weight in KG
  totalMeters?: number;     // Meters calculated if lunghezzaTaglioMm was used
  totalPieces: number;      // Total pieces (jobQta * bomItem.quantity)
}

/**
 * Calculates the material requirement (commitment) based on BOM data.
 * Centralizes the logic for length-to-base conversion (mm -> mt -> kg/others).
 * 
 * @param jobQta The quantity of the production job/manual order
 * @param bomItem The BOM item containing 'quantity', 'unit', and potentially 'lunghezzaTaglioMm'
 * @param material The raw material document
 * @param config The configuration for this material's type
 */
export function calculateBOMRequirement(
  jobQta: number,
  bomItem: { quantity: number; lunghezzaTaglioMm?: number; unit: string },
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>,
  config: { defaultUnit: string; hasConversion?: boolean; conversionType?: string; requiresCutLength?: boolean }
): BOMRequirementDetails {
  const qta = Number(jobQta) || 0;
  const bomQty = Number(bomItem.quantity) || 0;
  
  // SSoT: L'unità base è quella di default per la tipologia (dai Global Settings),
  // sovrascritta da quella del materiale solo se è stata fatta un'eccezione locale.
  const rawUom = material?.unitOfMeasure || config?.defaultUnit || 'n';
  const baseUnitStr = rawUom.toLowerCase();
  const baseUnit = baseUnitStr as UnitOfMeasure;
  
  const totalPieces = qta * bomQty;
  
  // ARCHITETTURA: I flag di GlobalSettings guidano dinamicamente la logica
  const richiedeTaglio = config?.requiresCutLength === true;
  const usaConversione = config?.hasConversion === true;
  const conversionType = config?.conversionType; // 'kg/mt' o 'kg/unit'
  const lengthMm = Number(bomItem.lunghezzaTaglioMm) || 0;

  const factor = usaConversione ? getConversionFactor(material as any, config as any) : 1;

  let totalInBaseUnits = 0;
  let totalMeters: number | undefined = undefined;

  // 1. Calcolo Metri (Solo se richiedeTaglio === true)
  if (richiedeTaglio && lengthMm > 0) {
      totalMeters = (totalPieces * lengthMm) / 1000;
  } else if (bomItem.unit?.toLowerCase() === 'mt' || bomItem.unit?.toLowerCase() === 'm') {
      totalMeters = totalPieces;
  }

  // 2. Fabbisogno in base all'unità (Source of Truth) e regole di conversione
  if (baseUnitStr === 'kg') {
      if (usaConversione) {
          if (conversionType === 'kg/mt' || (conversionType == null && totalMeters !== undefined)) {
              // Conversione da Metri a KG (es. Bobina: totalMeters * rapportoKgMt)
              totalInBaseUnits = (totalMeters !== undefined ? totalMeters : 0) * factor;
          } else if (conversionType === 'kg/unit' || conversionType == null) {
              // Conversione da Pezzi a KG (es. Tubi: totalPieces * pesoUnitario)
              totalInBaseUnits = totalPieces * factor;
          }
      } else {
          // Senza conversione (impostazione admin) fallback 1:1
          totalInBaseUnits = totalMeters !== undefined ? totalMeters : totalPieces;
      }
  } else if (baseUnitStr === 'mt' || baseUnitStr === 'm') {
      totalInBaseUnits = totalMeters !== undefined ? totalMeters : totalPieces;
  } else {
      // baseUnitStr === 'n' o altro
      totalInBaseUnits = totalPieces;
  }

  // 3. Stima Peso
  let weightKg = 0;
  if (baseUnitStr === 'kg') {
      weightKg = totalInBaseUnits;
  } else if (usaConversione && factor > 0) {
      weightKg = totalInBaseUnits * factor;
  }

  return {
      totalInBaseUnits,
      baseUnit,
      weightKg,
      totalMeters: totalMeters !== undefined ? Number(totalMeters.toFixed(4)) : undefined,
      totalPieces
  };
}

/**
 * Helper to synchronize a JobOrder's BOM with the Article's BOM.
 * recalculates explicit fields (fabbisognoTotale, pesoStimato).
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
    const articleBOMMap = new Map(safeArticleBOM.map(item => [item.component?.toUpperCase() || "UNKNOWN", item]));
    const currentBOMMap = new Map(safeCurrentBOM.map(item => [item.component?.toUpperCase() || "UNKNOWN", item]));

    // 1. Update/Add items from Article BOM
    safeArticleBOM.forEach(artItem => {
        const compCode = artItem.component?.toUpperCase() || "UNKNOWN";
        const existingItem = currentBOMMap.get(compCode);
        
        // Recalculate explicit fields
        const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
        const typeConfig = material ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
        const requiresCut = typeConfig?.requiresCutLength !== false;

        const req = calculateBOMRequirement(
            jobQta,
            { 
                quantity: artItem.quantity, 
                lunghezzaTaglioMm: requiresCut ? artItem.lunghezzaTaglioMm : undefined, 
                unit: artItem.unit 
            },
            material || { unitOfMeasure: artItem.unit, conversionFactor: 1, rapportoKgMt: 0 } as any,
            typeConfig || { defaultUnit: artItem.unit }
        );

        let newItem: any = {
            ...artItem,
            isFromTemplate: true,
            status: existingItem?.status || 'pending',
            lunghezzaTaglioMm: requiresCut ? (artItem.lunghezzaTaglioMm ?? null) : null,
            fabbisognoTotale: req.totalInBaseUnits,
            pesoStimato: req.weightKg
        };

        updatedBOM.push(newItem);
    });

    // 2. Preserve manually added items that are NOT in the article BOM
    safeCurrentBOM.forEach(item => {
        if (!item.isFromTemplate && !articleBOMMap.has(item.component?.toUpperCase() || "")) {
            const compCode = item.component?.toUpperCase() || "UNKNOWN";
            const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
            const typeConfig = material ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
            const requiresCut = typeConfig?.requiresCutLength !== false;

            const req = calculateBOMRequirement(
                jobQta,
                { 
                    quantity: item.quantity, 
                    lunghezzaTaglioMm: requiresCut ? item.lunghezzaTaglioMm : undefined, 
                    unit: item.unit 
                },
                material || { unitOfMeasure: item.unit, conversionFactor: 1, rapportoKgMt: 0 } as any,
                typeConfig || { defaultUnit: item.unit }
            );
            
            let preservedItem = { 
                ...item,
                lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? null) : null,
                fabbisognoTotale: req.totalInBaseUnits,
                pesoStimato: req.weightKg
            };
            updatedBOM.push(preservedItem);
        }
    });

    return updatedBOM;
}
