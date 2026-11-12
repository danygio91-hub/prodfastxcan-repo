import type { RawMaterial, RawMaterialBatch, MaterialWithdrawal, UnitOfMeasure, InventoryRecord } from '@/types';
import { hydrateMaterialWithWithdrawals } from './stock-logic';

export const normInventoryLot = (lotto?: string | null): string => {
  const trimmed = (lotto || '').trim().toUpperCase();
  if (!trimmed) return 'SENZA_LOTTO';
  return trimmed;
};

export interface AggregatedMaterialLot {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  uom: UnitOfMeasure;
  conversionFactor?: number | null;
  rapportoKgMt?: number | null;
  lotto: string;
  normLotto: string;
  initialUnits: number;
  theoreticalUnits: number;
  theoreticalWeightKg: number;
  tareWeight: number;
  tareName?: string;
  packagingId?: string;
  latestDate: string;
  isExhausted: boolean;
  batchCount: number;
}

/**
 * Aggregates a hydrated material's batches by normalized lot code,
 * returning live SSoT theoretical stock, net weight, and expected tare per lot.
 */
export function getAggregatedLotsForMaterial(
  rawMaterial: RawMaterial,
  withdrawals?: MaterialWithdrawal[]
): AggregatedMaterialLot[] {
  const hydrated = withdrawals
    ? hydrateMaterialWithWithdrawals(rawMaterial, withdrawals)
    : rawMaterial;

  const map = new Map<string, AggregatedMaterialLot>();

  for (const batch of hydrated.batches || []) {
    const normLotto = normInventoryLot(batch.lotto);
    const displayLotto = (batch.lotto || '').trim() || 'SENZA_LOTTO';
    const currentUnits = batch.currentQuantity ?? batch.netQuantity ?? 0;
    const currentWeight = batch.currentWeightKg ?? (batch.netQuantity ?? 0);
    const initialUnits = batch.netQuantity || 0;

    const existing = map.get(normLotto);
    if (!existing) {
      map.set(normLotto, {
        materialId: hydrated.id,
        materialCode: hydrated.code,
        materialDescription: hydrated.description || '',
        uom: hydrated.unitOfMeasure,
        conversionFactor: hydrated.conversionFactor,
        rapportoKgMt: hydrated.rapportoKgMt,
        lotto: displayLotto,
        normLotto,
        initialUnits: Number(initialUnits.toFixed(4)),
        theoreticalUnits: Number(currentUnits.toFixed(4)),
        theoreticalWeightKg: Number(currentWeight.toFixed(4)),
        tareWeight: batch.tareWeight || 0,
        tareName: batch.tareName,
        packagingId: batch.packagingId,
        latestDate: batch.date || new Date(0).toISOString(),
        isExhausted: currentUnits <= 0.001,
        batchCount: 1,
      });
    } else {
      existing.initialUnits = Number((existing.initialUnits + initialUnits).toFixed(4));
      existing.theoreticalUnits = Number((existing.theoreticalUnits + currentUnits).toFixed(4));
      existing.theoreticalWeightKg = Number((existing.theoreticalWeightKg + currentWeight).toFixed(4));
      existing.batchCount += 1;
      existing.isExhausted = existing.theoreticalUnits <= 0.001;

      if ((batch.date || '') >= existing.latestDate) {
        existing.latestDate = batch.date || existing.latestDate;
        if (batch.tareWeight !== undefined && batch.tareWeight > 0) {
          existing.tareWeight = batch.tareWeight;
          existing.tareName = batch.tareName;
          existing.packagingId = batch.packagingId;
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.isExhausted !== b.isExhausted) return a.isExhausted ? 1 : -1;
    return b.theoreticalUnits - a.theoreticalUnits;
  });
}

export interface ComputedInventoryMetrics {
  uom: UnitOfMeasure;
  countedUnits: number;
  theoreticalUnitsAtScan: number;
  deltaUnits: number;
  tareWeight: number;
  netWeight: number;
  grossWeight: number;
}

/**
 * Computes universal inventory metrics (countedUnits in base UoM, netWeight, grossWeight, deltaUnits).
 * Fixes the bug where N or MT materials without conversionFactor saved netWeight: 0,
 * and supports inputQuantity === 0 (exhausted lot).
 */
export function computeInventoryMetrics(params: {
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>;
  inputQuantity: number;
  inputUnit: UnitOfMeasure;
  tareWeight: number;
  theoreticalUnitsAtScan: number;
}): ComputedInventoryMetrics {
  const { material, inputQuantity, inputUnit, tareWeight, theoreticalUnitsAtScan } = params;
  const uom = material.unitOfMeasure;
  const safeInputQty = Math.max(0, Number(inputQuantity) || 0);
  const safeTare = Math.max(0, Number(tareWeight) || 0);
  const safeTheoretical = Number((theoreticalUnitsAtScan || 0).toFixed(4));

  // Explicit 0 handling: declaring a lot physically exhausted (0 stock)
  if (safeInputQty === 0) {
    return {
      uom,
      countedUnits: 0,
      theoreticalUnitsAtScan: safeTheoretical,
      deltaUnits: Number((0 - safeTheoretical).toFixed(4)),
      tareWeight: safeTare,
      netWeight: 0,
      grossWeight: 0,
    };
  }

  const rawFactorMt = material.rapportoKgMt || material.conversionFactor || 0;
  const rawFactorN = material.conversionFactor || 0;

  let netWeight = 0;
  let grossWeight = 0;
  let countedUnits = 0;

  if (inputUnit === 'kg') {
    grossWeight = safeInputQty;
    netWeight = grossWeight - safeTare;
    if (netWeight < -0.001) {
      throw new Error('Il peso netto calcolato è negativo. Controllare peso e tara.');
    }
    netWeight = Math.max(0, netWeight);

    if (uom === 'kg') {
      countedUnits = netWeight;
    } else if (uom === 'mt') {
      const factor = rawFactorMt > 0 ? rawFactorMt : 1;
      countedUnits = netWeight / factor;
    } else {
      // uom === 'n'
      const factor = rawFactorN > 0 ? rawFactorN : 1;
      countedUnits = netWeight / factor;
    }
  } else {
    // inputUnit is 'mt' or 'n'
    const rawFactor = inputUnit === 'mt' ? rawFactorMt : rawFactorN;
    // Fix Bug UdM: if factor is missing/0 on N or MT articles, fallback to 1 so netWeight is never 0
    const effectiveWeightFactor = rawFactor > 0 ? rawFactor : 1;

    netWeight = safeInputQty * effectiveWeightFactor;
    grossWeight = netWeight + safeTare;

    if (inputUnit === uom) {
      countedUnits = safeInputQty;
    } else if (uom === 'kg') {
      countedUnits = netWeight;
    } else if (uom === 'mt') {
      const targetFactor = rawFactorMt > 0 ? rawFactorMt : 1;
      countedUnits = netWeight / targetFactor;
    } else {
      const targetFactor = rawFactorN > 0 ? rawFactorN : 1;
      countedUnits = netWeight / targetFactor;
    }
  }

  const finalCountedUnits = Number(countedUnits.toFixed(4));
  const finalDeltaUnits = Number((finalCountedUnits - safeTheoretical).toFixed(4));

  return {
    uom,
    countedUnits: finalCountedUnits,
    theoreticalUnitsAtScan: safeTheoretical,
    deltaUnits: finalDeltaUnits,
    tareWeight: Number(safeTare.toFixed(4)),
    netWeight: Number(netWeight.toFixed(4)),
    grossWeight: Number(grossWeight.toFixed(4)),
  };
}

/**
 * Extracts countedUnits in the material's native UoM from an InventoryRecord,
 * supporting both FASE 74 records (with explicit countedUnits) and legacy records.
 */
export function resolveRecordCountedUnits(
  record: InventoryRecord,
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>
): number {
  if (typeof record.countedUnits === 'number' && !Number.isNaN(record.countedUnits)) {
    return Number(record.countedUnits.toFixed(4));
  }

  const metrics = computeInventoryMetrics({
    material,
    inputQuantity: record.inputQuantity ?? 0,
    inputUnit: record.inputUnit || material.unitOfMeasure,
    tareWeight: record.tareWeight || 0,
    theoreticalUnitsAtScan: record.theoreticalUnitsAtScan || 0,
  });

  return metrics.countedUnits;
}

/**
 * Converts a delta in native material units to weight in KG.
 */
export function convertUnitsToWeightKg(
  units: number,
  material: Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>
): number {
  const absUnits = Math.abs(units);
  if (material.unitOfMeasure === 'kg') {
    return Number(absUnits.toFixed(4));
  }
  if (material.unitOfMeasure === 'mt') {
    const factor = material.rapportoKgMt || material.conversionFactor || 1;
    return Number((absUnits * (factor > 0 ? factor : 1)).toFixed(4));
  }
  const factor = material.conversionFactor || 1;
  return Number((absUnits * (factor > 0 ? factor : 1)).toFixed(4));
}

