
import { RawMaterial, RawMaterialBatch, UnitOfMeasure } from '@/types';
import { RawMaterialTypeConfig } from './settings-types';

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
 */
export function calculateInventoryMovement(
  material: RawMaterial,
  config: Partial<RawMaterialTypeConfig> & { defaultUnit: string },
  quantity: number,
  inputUom: UnitOfMeasure,
  isAddition: boolean,
  specificLotto?: string | null,
  withdrawals: any[] = []
): InventoryMovementResult {
  const baseUom = (config?.defaultUnit || material.unitOfMeasure) as UnitOfMeasure;
  const factor = getConversionFactor(material, config);
  
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
    // TASSATIVO: Pezzi sempre interi
    unitsToChange = Math.round(unitsToChangeRaw);
  } else {
    // Normalizzazione millesimale per MT e altri
    unitsToChange = Number(unitsToChangeRaw.toFixed(3));
  }

  // Pesi sempre normalizzati a 3 decimali
  weightToChange = Number(weightToChangeRaw.toFixed(3));

  const batches = [...(material.batches || [])];
  let usedLotto: string | null = specificLotto || null;

  // Helper for Live Aggregation availability per lot
  const getLotAvailable = (lotto: string, initialQty: number) => {
    const withdrawn = withdrawals
      .filter(w => w.lotto === lotto && w.status !== 'cancelled')
      .reduce((sum, w) => sum + (w.consumedUnits || 0), 0);
    return Math.max(0, initialQty - withdrawn);
  };

  if (isAddition) {
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx !== -1) {
        batches[idx].netQuantity = Number(((batches[idx].netQuantity || 0) + unitsToChange).toFixed(3));
        batches[idx].grossWeight = Number(((batches[idx].grossWeight || 0) + weightToChange).toFixed(3));
        if (batches[idx].netQuantity > 0.001) batches[idx].isExhausted = false;
      }
    }
  } else {
    // SUBTRACTION (Withdrawal/Scarico) - MODIFIED: DIRECT DEDUCTION FROM BATCHES (SSoT)
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx === -1) throw new Error(`Lotto "${specificLotto}" non trovato.`);
      
      const availableUnits = batches[idx].netQuantity || 0;

      if (availableUnits < unitsToChange - 0.001) {
          throw new Error(`Giacenza insufficiente su lotto "${specificLotto}": disponibili ${availableUnits.toFixed(3)} (richiesti ${unitsToChange.toFixed(3)}).`);
      }

      batches[idx].netQuantity = Number((availableUnits - unitsToChange).toFixed(3));
      batches[idx].grossWeight = Number(Math.max(0, (batches[idx].grossWeight || 0) - weightToChange).toFixed(3));
      
      if (batches[idx].netQuantity <= 0.001) {
          batches[idx].isExhausted = true;
          batches[idx].grossWeight = 0; // Azzera anche la tara residua se esaurito
          batches[idx].netQuantity = 0;
      }

      usedLotto = specificLotto;
    } else {
      // FIFO Withdrawal: Deduct from oldest active batches
      const validBatches = batches
        .filter(b => !b.isExhausted && (b.netQuantity || 0) > 0.001)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let totalAvail = validBatches.reduce((sum, b) => sum + (b.netQuantity || 0), 0);

      if (totalAvail < unitsToChange - 0.001) {
          throw new Error(`Giacenza insufficiente a magazzino: disponibili ${totalAvail.toFixed(3)} (richiesti ${unitsToChange.toFixed(3)}).`);
      }

      let remainingUnitsToChange = unitsToChange;
      
      // We record the first lot used for reporting
      if (validBatches.length > 0) {
          usedLotto = validBatches[0].lotto as string;
      }

      for (let i = 0; i < validBatches.length && remainingUnitsToChange > 0.001; i++) {
         const b = validBatches[i];
         const availableInBatch = b.netQuantity || 0;
         const qtyToDeduct = Math.min(availableInBatch, remainingUnitsToChange);
         
         const weightRatio = availableInBatch > 0 ? (b.grossWeight || 0) / availableInBatch : 0;
         const weightToDeductForThisBatch = Number((qtyToDeduct * weightRatio).toFixed(3));

         const actualBatchIdx = batches.findIndex(tb => tb.lotto === b.lotto);
         if (actualBatchIdx !== -1) {
             batches[actualBatchIdx].netQuantity = Number((availableInBatch - qtyToDeduct).toFixed(3));
             
             // Deduce proportional gross weight
             let calculatedGross = (batches[actualBatchIdx].grossWeight || 0) - weightToDeductForThisBatch;
             batches[actualBatchIdx].grossWeight = Number(Math.max(0, calculatedGross).toFixed(3));
             
             if (batches[actualBatchIdx].netQuantity <= 0.001) {
                 batches[actualBatchIdx].isExhausted = true;
                 batches[actualBatchIdx].grossWeight = 0; 
                 batches[actualBatchIdx].netQuantity = 0;
             }
         }

         remainingUnitsToChange = Number((remainingUnitsToChange - qtyToDeduct).toFixed(3));
      }
    }
  }

  return {
    unitsToChange,
    weightToChange,
    updatedBatches: batches, // batches now mutated with new balances
    usedLotto
  };
}

/**
 * Robust conversion factor selector with fallback.
 */
export function getConversionFactor(material: RawMaterial, config: Partial<RawMaterialTypeConfig>): number {
  if (!config.hasConversion) return 1;
  
  const factorField = config.conversionType === 'kg/mt' ? 'rapportoKgMt' : 'conversionFactor';
  const primaryFactor = material[factorField as keyof RawMaterial] as number;
  
  if (primaryFactor && primaryFactor > 0) return primaryFactor;
  
  // Fallback to the other factor if primary is missing/zero
  const secondaryField = config.conversionType === 'kg/mt' ? 'conversionFactor' : 'rapportoKgMt';
  const secondaryFactor = material[secondaryField as keyof RawMaterial] as number;
  
  if (secondaryFactor && secondaryFactor > 0) return secondaryFactor;
  
  return 1; // Last resort fallback
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
  const baseUnit = config.defaultUnit as UnitOfMeasure;
  const totalPieces = qta * bomQty;
  const factor = getConversionFactor(material as any, config as any);

  // Determina se considerare la lunghezza taglio (mm)
  // Se config.requiresCutLength è undefined, assumiamo il comportamento storico (se lengthMm > 0 usalo)
  // Se è esplicitamente false, MAI usarlo.
  const isLengthApplicable = config.requiresCutLength !== false;
  const lengthMm = isLengthApplicable ? (Number(bomItem.lunghezzaTaglioMm) || 0) : 0;

  let totalInBaseUnits = 0;
  let totalMeters: number | undefined = undefined;

  // 1. Calculate Length if applicable (mm -> mt)
  if (isLengthApplicable && lengthMm > 0) {
      totalMeters = (totalPieces * lengthMm) / 1000;
  } else if (isLengthApplicable && bomItem.unit === 'mt') {
      totalMeters = totalPieces;
  }

  // 2. Derive base units
  if (baseUnit === 'kg') {
      if (totalMeters !== undefined) {
          // Mt to Kg: Meters * Factor
          totalInBaseUnits = totalMeters * factor;
      } else {
          // Generic Unit to Kg: Units * Factor (e.g. pieces * unit weight)
          totalInBaseUnits = totalPieces * factor;
      }
  } else if (baseUnit === 'mt' && totalMeters !== undefined) {
      totalInBaseUnits = totalMeters;
  } else {
      // In ogni altro caso (incluso 'n' o 'mt' senza taglio), moltiplicazione diretta pezzi * quantita per pezzo
      totalInBaseUnits = totalPieces;
  }

  // 3. Calculate Weight in KG for estimate/printing
  let weightKg = 0;
  if (baseUnit === 'kg') {
      weightKg = totalInBaseUnits;
  } else {
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
