
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
  if (inputUom === 'kg') {
    weightToChange = quantity;
    if (baseUom === 'kg') {
      unitsToChange = quantity;
    } else {
      // KG to Base (e.g. MT, N): Division by factor
      unitsToChange = factor > 0 ? quantity / factor : quantity;
    }
  } else {
    // Primary UOM (MT, N, or KG) to KG
    unitsToChange = quantity;
    if (baseUom === 'kg') {
      weightToChange = quantity;
    } else {
      // Base (MT, N) to KG: Multiplication by factor
      weightToChange = quantity * factor;
    }
  }

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
        batches[idx].netQuantity = (batches[idx].netQuantity || 0) + unitsToChange;
        batches[idx].grossWeight = (batches[idx].grossWeight || 0) + weightToChange;
        if (batches[idx].netQuantity > 0.001) batches[idx].isExhausted = false;
      }
    }
  } else {
    // SUBTRACTION (Withdrawal/Scarico) - MODIFIED: DIRECT DEDUCTION FROM BATCHES
    // We use LIVE AGGREGATION for validation during the transaction
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx === -1) throw new Error(`Lotto "${specificLotto}" non trovato.`);
      
      const lotto = batches[idx].lotto as string;
      const initialBatchQty = batches[idx].netQuantity || 0;
      
      // REAL-TIME AVAILABILITY: Batch Net - Historical Withdrawals
      const withdrawnUnits = withdrawals
        .filter(w => (w.lotto === lotto || w.lotto === specificLotto) && w.status !== 'cancelled')
        .reduce((sum, w) => sum + (w.consumedUnits || 0), 0);
      
      const availableUnits = Math.max(0, initialBatchQty - withdrawnUnits);

      if (availableUnits < unitsToChange - 0.001) {
          throw new Error(`Giacenza insufficiente su lotto "${specificLotto}": disponibili ${availableUnits.toFixed(3)} (richiesti ${unitsToChange.toFixed(3)}).`);
      }

      // DEDUCT FROM BATCH
      batches[idx].netQuantity = Math.max(0, initialBatchQty - unitsToChange);
      // Deduct from Weight (keeping Tare consistent)
      batches[idx].grossWeight = Math.max(batches[idx].tareWeight || 0, (batches[idx].grossWeight || 0) - weightToChange);
      
      usedLotto = specificLotto;
    } else {
      // FIFO Withdrawal with Batch Mutation
      const validBatches = batches
        .map((b, originalIndex) => ({ b, index: originalIndex }))
        .filter(item => !item.b.isExhausted && (item.b.netQuantity || 0) > 0.001);

      // REAL-TIME AVAILABILITY: Sum(Active Batches) - Sum(Withdrawals of those batches)
      // Actually, for FIFO, we can just check the sum of availableUnits per batch
      let totalAvail = 0;
      validBatches.forEach(item => {
          const wUnits = withdrawals
            .filter(w => w.lotto === item.b.lotto && w.status !== 'cancelled')
            .reduce((sum, w) => sum + (w.consumedUnits || 0), 0);
          totalAvail += Math.max(0, (item.b.netQuantity || 0) - wUnits);
      });

      if (totalAvail < unitsToChange - 0.001) {
          throw new Error(`Giacenza insufficiente a magazzino: disponibili ${totalAvail.toFixed(3)} (richiesti ${unitsToChange.toFixed(3)}).`);
      }

      let remainingToDeduct = unitsToChange;
      let remainingWeightToDeduct = weightToChange;
      
      const sortedItems = validBatches.sort((a, b) => new Date(a.b.date).getTime() - new Date(b.b.date).getTime());
      
      for (const item of sortedItems) {
        if (remainingToDeduct <= 0.0001) break;
        if (!usedLotto) usedLotto = item.b.lotto as string;
        
        const b = batches[item.index];
        const canTake = b.netQuantity || 0;
        const toTake = Math.min(canTake, remainingToDeduct);
        
        // Linear deduction for weight if taking partial batch
        const weightToTake = (toTake / canTake) * ((b.grossWeight || 0) - (b.tareWeight || 0));
        
        b.netQuantity = Math.max(0, canTake - toTake);
        b.grossWeight = Math.max(b.tareWeight || 0, (b.grossWeight || 0) - weightToTake);
        
        remainingToDeduct -= toTake;
        remainingWeightToDeduct -= weightToTake;
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
  config: { defaultUnit: string; hasConversion?: boolean; conversionType?: string }
): BOMRequirementDetails {
  const qta = Number(jobQta) || 0;
  const bomQty = Number(bomItem.quantity) || 0;
  const lengthMm = Number(bomItem.lunghezzaTaglioMm) || 0;
  const baseUnit = config.defaultUnit as UnitOfMeasure;
  const totalPieces = qta * bomQty;
  const factor = getConversionFactor(material as any, config as any);

  let totalInBaseUnits = 0;
  let totalMeters: number | undefined = undefined;

  // 1. Calculate Length if applicable (mm -> mt)
  if (lengthMm > 0) {
      totalMeters = (totalPieces * lengthMm) / 1000;
  } else if (bomItem.unit === 'mt') {
      totalMeters = totalPieces;
  }

  // 2. Derive base units
  if (baseUnit === 'kg') {
      if (totalMeters !== undefined) {
          // Mt to Kg: Meters * Factor
          totalInBaseUnits = totalMeters * factor;
      } else {
          // Generic Unit to Kg: Units * Factor
          totalInBaseUnits = totalPieces * factor;
      }
  } else if (baseUnit === 'mt') {
      totalInBaseUnits = totalMeters ?? totalPieces;
  } else {
      // Default for 'n' or others: direct multiplication
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
