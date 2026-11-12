import { describe, it, expect } from 'vitest';
import {
  computeInventoryMetrics,
  getAggregatedLotsForMaterial,
  normInventoryLot,
  resolveRecordCountedUnits,
} from './inventory-ledger-logic';
import { hydrateMaterialWithWithdrawals } from './stock-logic';
import type { RawMaterial, MaterialWithdrawal, RawMaterialBatch } from '@/types';

describe('FASE 74: SSoT Inventory Ledger & Universal Metrics', () => {
  it('fixes the N/MT without conversionFactor bug so netWeight is never 0 when inputQuantity > 0', () => {
    const materialN = {
      unitOfMeasure: 'n' as const,
      conversionFactor: 0,
      rapportoKgMt: null,
    };

    const metrics = computeInventoryMetrics({
      material: materialN,
      inputQuantity: 250,
      inputUnit: 'n',
      tareWeight: 0,
      theoreticalUnitsAtScan: 300,
    });

    expect(metrics.uom).toBe('n');
    expect(metrics.countedUnits).toBe(250);
    expect(metrics.theoreticalUnitsAtScan).toBe(300);
    expect(metrics.deltaUnits).toBe(-50);
    expect(metrics.netWeight).toBe(250); // No longer 0!
  });

  it('supports inputQuantity = 0 to declare an exhausted lot', () => {
    const materialKg = {
      unitOfMeasure: 'kg' as const,
      conversionFactor: 1,
      rapportoKgMt: null,
    };

    const metrics = computeInventoryMetrics({
      material: materialKg,
      inputQuantity: 0,
      inputUnit: 'kg',
      tareWeight: 12.5,
      theoreticalUnitsAtScan: 84.5,
    });

    expect(metrics.countedUnits).toBe(0);
    expect(metrics.netWeight).toBe(0);
    expect(metrics.grossWeight).toBe(0);
    expect(metrics.deltaUnits).toBe(-84.5);
  });

  it('reconciles positive delta (+Delta), negative delta (-Delta), write-off (0), and revert accurately via hydrateMaterialWithWithdrawals', () => {
    const baseMaterial: RawMaterial = {
      id: 'mat-1',
      type: 'CAVO',
      code: 'MP-001',
      description: 'Cavo Rame',
      details: {},
      unitOfMeasure: 'mt',
      rapportoKgMt: 0.5,
      currentStockUnits: 100,
      currentWeightKg: 50,
      batches: [
        {
          id: 'b-1',
          date: '2026-01-10T10:00:00.000Z',
          ddt: 'DDT-100',
          lotto: 'L-100',
          netQuantity: 100,
          grossWeight: 55,
          tareWeight: 5,
          tareName: 'Bobina Piccola',
          type: 'CARICO',
        },
      ],
    };

    const withdrawals: MaterialWithdrawal[] = [
      {
        id: 'w-prod-1',
        jobIds: ['J1'],
        jobOrderPFs: ['PF1'],
        materialId: 'mat-1',
        materialCode: 'MP-001',
        lotto: 'L-100',
        consumedUnits: 20,
        consumedWeight: 10,
        operatorId: 'op-1',
        withdrawalDate: new Date().toISOString(),
        status: 'completed',
      },
    ];

    // 1. Live theoretical stock before inventory = 100 - 20 = 80 MT
    const lotsBefore = getAggregatedLotsForMaterial(baseMaterial, withdrawals);
    expect(lotsBefore).toHaveLength(1);
    expect(lotsBefore[0].theoreticalUnits).toBe(80);
    expect(lotsBefore[0].theoreticalWeightKg).toBe(40);
    expect(lotsBefore[0].isExhausted).toBe(false);

    // 2. Negative Delta: operator counts 65 MT (Delta = -15 MT)
    const invWithdrawal: MaterialWithdrawal = {
      id: 'w-inv-ssot-rec1',
      type: 'RETTIFICA_INVENTARIO',
      source: 'inventory_reconciliation',
      jobIds: [],
      jobOrderPFs: [],
      materialId: 'mat-1',
      materialCode: 'MP-001',
      lotto: 'L-100',
      consumedUnits: 15,
      consumedWeight: 7.5,
      inventoryRecordId: 'rec1',
      operatorId: 'admin',
      withdrawalDate: new Date().toISOString(),
      status: 'completed',
    };

    const afterNeg = hydrateMaterialWithWithdrawals(baseMaterial, [
      ...withdrawals,
      invWithdrawal,
    ]);
    expect(afterNeg.currentStockUnits).toBe(65);
    expect(afterNeg.batches[0].netQuantity).toBe(100); // Original DDT load intact!

    // 3. Revert Negative Delta (status: 'cancelled') -> returns to 80 MT
    const afterRevertNeg = hydrateMaterialWithWithdrawals(baseMaterial, [
      ...withdrawals,
      { ...invWithdrawal, status: 'cancelled' },
    ]);
    expect(afterRevertNeg.currentStockUnits).toBe(80);

    // 4. Positive Delta: operator counts 95 MT (Delta = +15 MT)
    const invBatch: RawMaterialBatch = {
      id: 'batch-inv-ssot-rec2',
      inventoryRecordId: 'rec2',
      date: new Date().toISOString(),
      ddt: 'RETTIFICA-INV',
      type: 'RETTIFICA_INVENTARIO',
      isReturn: true,
      lotto: 'L-100',
      netQuantity: 15,
      grossWeight: 7.5,
      tareWeight: 0,
    };

    const afterPos = hydrateMaterialWithWithdrawals(
      { ...baseMaterial, batches: [...baseMaterial.batches, invBatch] },
      withdrawals
    );
    expect(afterPos.currentStockUnits).toBe(95);

    // 5. Write-Off Unscanned Lot (bring 80 MT to 0 -> isExhausted: true)
    const writeOffWithdrawal: MaterialWithdrawal = {
      id: 'w-inv-ssot-writeoff1',
      type: 'RETTIFICA_INVENTARIO',
      source: 'inventory_reconciliation',
      jobIds: [],
      jobOrderPFs: [],
      materialId: 'mat-1',
      materialCode: 'MP-001',
      lotto: 'L-100',
      consumedUnits: 80,
      consumedWeight: 40,
      operatorId: 'admin',
      withdrawalDate: new Date().toISOString(),
      status: 'completed',
    };

    const afterWriteOff = hydrateMaterialWithWithdrawals(baseMaterial, [
      ...withdrawals,
      writeOffWithdrawal,
    ]);
    expect(afterWriteOff.currentStockUnits).toBe(0);
    expect(afterWriteOff.batches[0].currentQuantity).toBe(0);
    expect(afterWriteOff.batches[0].isExhausted).toBe(true);
  });
});

