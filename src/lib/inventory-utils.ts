
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
  config: RawMaterialTypeConfig,
  quantity: number,
  inputUom: UnitOfMeasure,
  isAddition: boolean,
  specificLotto?: string | null,
  withdrawals: any[] = [] // Optional for backward compatibility but recommended
): InventoryMovementResult {
  const baseUom = config.defaultUnit as UnitOfMeasure;
  const factor = getConversionFactor(material, config);
  
  let unitsToChange = 0;
  let weightToChange = 0;

  // 1. Calculate impact in Base UOM and KG
  if (inputUom === 'kg') {
    weightToChange = quantity;
    if (baseUom === 'kg') {
      unitsToChange = quantity;
    } else {
      unitsToChange = factor > 0 ? quantity / factor : quantity;
    }
  } else {
    unitsToChange = quantity;
    if (baseUom === 'kg') {
      weightToChange = quantity;
    } else {
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
        if (batches[idx].netQuantity > 0) batches[idx].isExhausted = false;
      }
    }
  } else {
    // SUBTRACTION (Withdrawal/Scarico) - LIVE AGGREGATION LOGIC
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx === -1) throw new Error(`Lotto "${specificLotto}" non trovato.`);
      
      const initial = batches[idx].netQuantity || 0;
      const avail = getLotAvailable(specificLotto, initial);
      
      if (avail < unitsToChange - 0.0001) {
          throw new Error(`Giacenza insufficiente: il lotto "${specificLotto}" ha solo ${avail.toFixed(3)} ${baseUom.toUpperCase()} (richiesti ${unitsToChange.toFixed(3)}).`);
      }
      // SACRED QUANTITY RULE: DO NOT MUTATE batches[idx].netQuantity
    } else {
      // FIFO Withdrawal
      const lotAvailabilities = batches.map(b => ({
        batch: b,
        avail: getLotAvailable(b.lotto || 'SENZA_LOTTO', b.netQuantity || 0)
      })).filter(item => !item.batch.isExhausted && item.avail > 0);

      const totalAvail = lotAvailabilities.reduce((sum, item) => sum + item.avail, 0);
      if (totalAvail < unitsToChange - 0.0001) {
          throw new Error(`Giacenza insufficiente a magazzino: disponibili ${totalAvail.toFixed(3)} ${baseUom.toUpperCase()} (richiesti ${unitsToChange.toFixed(3)}).`);
      }

      let remainingToDeduct = unitsToChange;
      const sortedItems = lotAvailabilities.sort((a, b) => new Date(a.batch.date).getTime() - new Date(b.batch.date).getTime());
      
      for (const item of sortedItems) {
        if (remainingToDeduct <= 0) break;
        if (!usedLotto) usedLotto = (item.batch.lotto as string | null);
        const toTake = Math.min(item.avail, remainingToDeduct);
        remainingToDeduct -= toTake;
        // SACRED QUANTITY RULE: DO NOT MUTATE item.batch.netQuantity
      }
    }
  }

  return {
    unitsToChange,
    weightToChange,
    updatedBatches: batches, // netQuantity/grossWeight preserved
    usedLotto
  };
}

/**
 * Robust conversion factor selector with fallback.
 */
export function getConversionFactor(material: RawMaterial, config: RawMaterialTypeConfig): number {
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
