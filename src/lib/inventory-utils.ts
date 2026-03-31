
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
 */
export function calculateInventoryMovement(
  material: RawMaterial,
  config: RawMaterialTypeConfig,
  quantity: number,
  inputUom: UnitOfMeasure,
  isAddition: boolean,
  specificLotto?: string | null
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
      // Convert weight to units: Units = Weight / Factor
      unitsToChange = factor > 0 ? quantity / factor : quantity;
    }
  } else {
    // inputUom is 'mt' or 'n'
    unitsToChange = quantity;
    if (baseUom === 'kg') {
      weightToChange = quantity;
    } else {
      // Convert units to weight: Weight = Units * Factor
      weightToChange = quantity * factor;
    }
  }

  // If it's a subtraction, invert the numbers for internal batch math
  // but we return positive delta values for the caller to add/subtract as needed.
  const signedUnits = isAddition ? unitsToChange : -unitsToChange;
  
  const batches = [...(material.batches || [])];
  let usedLotto: string | null = specificLotto || null;

  if (isAddition) {
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx !== -1) {
        batches[idx].netQuantity = (batches[idx].netQuantity || 0) + unitsToChange;
        batches[idx].grossWeight = (batches[idx].grossWeight || 0) + weightToChange;
        // Se la quantità torna > 0, riattiviamo il lotto (Resurrection Logic)
        if (batches[idx].netQuantity > 0) {
          batches[idx].isExhausted = false;
        }
      } else {
        // Create a basic batch if it doesn't exist? 
        // Usually additions create specific batches with more info (DDT, etc.)
        // But for generic additions we can push a simple record.
      }
    } else {
        // Addition without lot? Maybe not standard, but we'll leave it to caller
    }
  } else {
    // SUBTRACTION (Scarico)
    if (specificLotto) {
      const idx = batches.findIndex(b => b.lotto === specificLotto);
      if (idx !== -1) {
        batches[idx].netQuantity = (batches[idx].netQuantity || 0) - unitsToChange;
        // Approximation for weight in batch if needed
        batches[idx].grossWeight = (batches[idx].grossWeight || 0) - weightToChange;
      } else {
        // Lot not found. User said: Consenti giacenza negativa. 
        // We can't update a non-existent batch record, but we still return usedLotto.
      }
    } else {
      // FIFO Logic
      let remainingToDeduct = unitsToChange;
      // Sort batches by date (oldest first)
      const sortedBatches = batches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      for (const b of sortedBatches) {
        if (remainingToDeduct <= 0) break;
        const avail = b.netQuantity || 0;
        if (avail > 0) {
          if (!usedLotto) usedLotto = b.lotto || 'Iniziale';
          const toTake = Math.min(avail, remainingToDeduct);
          b.netQuantity = avail - toTake;
          b.grossWeight = Math.max(0, (b.grossWeight || 0) - (toTake * factor));
          remainingToDeduct -= toTake;
        }
      }

      // If still remaining, deduct from the oldest batch anyway (allows negative)
      if (remainingToDeduct > 0 && sortedBatches.length > 0) {
        if (!usedLotto) usedLotto = sortedBatches[0].lotto || 'Iniziale';
        sortedBatches[0].netQuantity = (sortedBatches[0].netQuantity || 0) - remainingToDeduct;
        sortedBatches[0].grossWeight = (sortedBatches[0].grossWeight || 0) - (remainingToDeduct * factor);
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

/**
 * Calculates the material requirement (commitment) based on BOM data.
 * Centralizes the logic for length-to-base conversion (mm -> mt -> kg/others).
 * 
 * @param jobQta The quantity of the production job/manual order
 * @param bomItem The BOM item containing 'quantity', 'unit', and potentially 'lunghezzaTaglioMm'
 * @param material The raw material document
 * @param config The configuration for this material's type
 */
export function calculateMaterialRequirement(
  jobQta: number,
  bomItem: any,
  material: RawMaterial,
  config: RawMaterialTypeConfig
): number {
  const qta = Number(jobQta) || 0;
  const bomQty = Number(bomItem.quantity) || 0;
  const lengthMm = Number(bomItem.lunghezzaTaglioMm) || 0;
  const baseUom = config.defaultUnit as UnitOfMeasure;
  const factor = getConversionFactor(material, config);

  // 1. Calculate Length if applicable
  let totalInBaseUnits = 0;

  if (baseUom === 'kg') {
      let totalMeters = 0;
      if (lengthMm > 0) {
          totalMeters = (qta * bomQty * lengthMm) / 1000;
      } else if (bomItem.unit === 'mt') {
          totalMeters = qta * bomQty;
      }

      if (totalMeters > 0) {
          // Mt to Kg: Meters * Factor
          return totalMeters * factor;
      }
      
      // Generic Unit to Kg: Units * Factor
      return (qta * bomQty) * factor;
  }
  
  if (baseUom === 'mt') {
      if (lengthMm > 0) return (qta * bomQty * lengthMm) / 1000;
      // If BOM unit is already MT, it's just a direct multiplication
      return qta * bomQty;
  }
  
  // Default for 'n' or others: direct multiplication
  return qta * bomQty;
}
