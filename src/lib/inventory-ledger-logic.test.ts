import { describe, it, expect } from 'vitest';
import {
  VIRTUAL_SESSION_2025_ID,
  computeInventoryMetrics,
  evaluateLotsForInventorySession,
  getAggregatedLotsForMaterial,
  getAllowedInventoryInputUnits,
  inferYearFromLotOrDdt,
  normInventoryLot,
  resolveRecordCountedUnits,
  resolveRecordMetrics,
  resolveRecordSessionId,
} from './inventory-ledger-logic';
import { hydrateMaterialWithWithdrawals } from './stock-logic';
import {
  areJobIdsEquivalent,
  expandOperatorDepartments,
  normalizeJobIdForComparison,
} from './utils';
import type {
  RawMaterial,
  MaterialWithdrawal,
  RawMaterialBatch,
  InventoryCountingSession,
} from '@/types';

describe('FASE 74 & FASE 106-BIS: SSoT Inventory Ledger & Universal Metrics', () => {
  it('supports direct count on N/MT without factor (isDirectCount: true, no fake 1:1 netWeight)', () => {
    const materialN = {
      unitOfMeasure: 'n' as const,
      conversionFactor: 0,
      rapportoKgMt: null,
    };

    const metrics = computeInventoryMetrics({
      material: materialN,
      inputQuantity: 250,
      inputUnit: 'n',
      tareWeight: 5, // must be forced to 0 for direct counts
      theoreticalUnitsAtScan: 300,
    });

    expect(metrics.uom).toBe('n');
    expect(metrics.isDirectCount).toBe(true);
    expect(metrics.missingConversionFactor).toBe(false);
    expect(metrics.hasWeightEstimate).toBe(false);
    expect(metrics.tareWeight).toBe(0);
    expect(metrics.countedUnits).toBe(250);
    expect(metrics.theoreticalUnitsAtScan).toBe(300);
    expect(metrics.deltaUnits).toBe(-50);
    expect(metrics.netWeight).toBe(0);
    expect(metrics.grossWeight).toBe(0);
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
    expect(metrics.hasNegativeNetWarning).toBe(false);
    expect(metrics.isAnomaly).toBe(false);
  });

  it('FASE 74-BIS: never throws when tareWeight > grossWeight on historical records, returning isAnomaly: true and netWeight: 0', () => {
    const materialKg = {
      unitOfMeasure: 'kg' as const,
      conversionFactor: 1,
      rapportoKgMt: null,
    };

    const metrics = computeInventoryMetrics({
      material: materialKg,
      inputQuantity: 4.2,
      inputUnit: 'kg',
      tareWeight: 15.0,
      theoreticalUnitsAtScan: 50,
    });

    expect(metrics.netWeight).toBe(0);
    expect(metrics.countedUnits).toBe(0);
    expect(metrics.hasNegativeNetWarning).toBe(true);
    expect(metrics.isAnomaly).toBe(true);
    expect(metrics.anomalyReason).toBe('Tara superiore al peso lordo');

    // Also verify resolveRecordMetrics on malformed/dirty historical records
    const dirtyMetrics = resolveRecordMetrics(
      {
        inputQuantity: undefined as any,
        grossWeight: 3,
        tareWeight: 10,
        netWeight: -7,
        inputUnit: 'kg',
      },
      materialKg
    );
    expect(dirtyMetrics.netWeight).toBe(0);
    expect(dirtyMetrics.isAnomaly).toBe(true);
    expect(dirtyMetrics.anomalyReason).toBe('Tara superiore al peso lordo');
    expect(resolveRecordCountedUnits({ inputQuantity: NaN as any, tareWeight: 20 }, materialKg)).toBe(0);
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

  it('FASE 76: expands SUPPORT into MAG + QLTY + PACK and normalizes job IDs (/ vs -)', () => {
    // 1. SUPPORT expansion for Claudio (['MAG', 'SUPPORT'])
    const expanded = expandOperatorDepartments(['MAG', 'SUPPORT']);
    expect(expanded).toContain('SUPPORT');
    expect(expanded).toContain('MAG');
    expect(expanded).toContain('MAGAZZINO');
    expect(expanded).toContain('QLTY');
    expect(expanded).toContain('QUALITA');
    expect(expanded).toContain('QUALITÀ');
    expect(expanded).toContain('COLLAUDO');
    expect(expanded).toContain('PACK');
    expect(expanded).toContain('IMBALLO');

    // 2. Job ID normalization (/ vs -, case-insensitive, year suffix, legacy stripped dots)
    expect(areJobIdsEquivalent('241/PF.1-1', '241-PF.1-1')).toBe(true);
    expect(areJobIdsEquivalent('241/pf.1-1', '241-PF1-1')).toBe(true);
    expect(areJobIdsEquivalent('840/PF', '840-PF_2026')).toBe(true);
    expect(areJobIdsEquivalent('241/PF.1-1', '999/PF.2-1')).toBe(false);
    expect(normalizeJobIdForComparison('241/pf.1-1')).toBe('241-PF.1-1');
  });

  it('FASE 77: isolates 2025 historical scans from 2026 campaigns and excludes 2026 new lots from 2025 Fantasmi', () => {
    expect(inferYearFromLotOrDdt('145-25')).toBe(2025);
    expect(inferYearFromLotOrDdt('882/26')).toBe(2026);
    expect(inferYearFromLotOrDdt('DDT-10-2026')).toBe(2026);

    const material: RawMaterial = {
      id: 'mat-ssot',
      type: 'CAVO',
      code: 'MP-2026',
      description: 'Cavo Test Sessioni',
      details: {},
      unitOfMeasure: 'kg',
      currentStockUnits: 300,
      currentWeightKg: 300,
      batches: [
        {
          id: 'b-2025-scanned',
          date: '2025-10-15T10:00:00.000Z',
          ddt: 'DDT-01/25',
          lotto: '101-25',
          netQuantity: 100,
          grossWeight: 100,
          tareWeight: 0,
        },
        {
          id: 'b-2025-ghost',
          date: '2025-11-20T10:00:00.000Z',
          ddt: 'DDT-02/25',
          lotto: '102-25',
          netQuantity: 100,
          grossWeight: 100,
          tareWeight: 0,
        },
        {
          id: 'b-2026-new',
          date: '2026-02-14T10:00:00.000Z',
          ddt: 'DDT-09/26',
          lotto: '201-26',
          netQuantity: 100,
          grossWeight: 100,
          tareWeight: 0,
        },
      ],
    };

    const baseLots = getAggregatedLotsForMaterial(material, []);
    expect(baseLots).toHaveLength(3);

    const historical2025Records = [
      {
        id: 'rec-dec-2025',
        materialId: 'mat-ssot',
        materialCode: 'MP-2026',
        lotto: '101-25',
        recordedAt: '2025-12-19T14:30:00.000Z',
        status: 'approved' as const,
      },
    ];

    // Legacy 2025 record without sessionId maps automatically to VIRTUAL_2025
    expect(resolveRecordSessionId(historical2025Records[0])).toBe(VIRTUAL_SESSION_2025_ID);

    const session2025: InventoryCountingSession = {
      id: VIRTUAL_SESSION_2025_ID,
      name: 'Storico Inventario 2025',
      year: 2025,
      status: 'closed',
      openedAt: '2025-01-01T00:00:00.000Z',
      closedAt: '2025-12-31T23:59:59.999Z',
      isVirtual: true,
    };

    const eval2025 = evaluateLotsForInventorySession({
      baseLots,
      records: historical2025Records,
      session: session2025,
    });

    const lot101_in2025 = eval2025.allActiveLots.find((l) => l.lotto === '101-25')!;
    const lot102_in2025 = eval2025.allActiveLots.find((l) => l.lotto === '102-25')!;
    const lot201_in2025 = eval2025.allActiveLots.find((l) => l.lotto === '201-26')!;

    expect(lot101_in2025.scanStatus).toBe('SCANNED_APPROVED');
    expect(lot102_in2025.scanStatus).toBe('UNSCANNED');
    // Crucial: 2026 lot viewed in 2025 session is POST_INVENTORY, NOT a 2025 Ghost!
    expect(lot201_in2025.scanStatus).toBe('POST_INVENTORY');
    expect(lot201_in2025.lotTemporalStatus).toBe('POST_SESSION_CLOSED');

    expect(eval2025.unscannedLots).toHaveLength(1);
    expect(eval2025.unscannedLots[0].lotto).toBe('102-25');

    // Now open a new 2026 session: all 3 lots must start as UNSCANNED (0 scanned in 2026 session)
    const session2026: InventoryCountingSession = {
      id: 'sess-2026-1',
      name: 'Inventario 2026 - Sessione 1',
      year: 2026,
      status: 'open',
      openedAt: '2026-02-01T08:00:00.000Z',
      closedAt: null,
      isVirtual: false,
    };

    const eval2026 = evaluateLotsForInventorySession({
      baseLots,
      records: historical2025Records,
      session: session2026,
    });

    expect(eval2026.sessionRecords).toHaveLength(0);
    expect(eval2026.unscannedLots).toHaveLength(3);

    const lot101_in2026 = eval2026.allActiveLots.find((l) => l.lotto === '101-25')!;
    const lot201_in2026 = eval2026.allActiveLots.find((l) => l.lotto === '201-26')!;

    // 101-25 (scanned in Dec 2025) is now UNSCANNED in the new 2026 campaign!
    expect(lot101_in2026.scanStatus).toBe('UNSCANNED');
    expect(lot101_in2026.lotTemporalStatus).toBe('PRE_EXISTING');

    // 201-26 (loaded Feb 14, 2026, after session opened Feb 1, 2026) is distinguished as POST_SESSION_OPENED
    expect(lot201_in2026.scanStatus).toBe('UNSCANNED');
    expect(lot201_in2026.lotTemporalStatus).toBe('POST_SESSION_OPENED');
  });

  it('FASE 106-BIS (1): enforces allowed input units matrix for mt, n, kg', () => {
    expect(getAllowedInventoryInputUnits('mt')).toEqual(['mt', 'kg']);
    expect(getAllowedInventoryInputUnits('n')).toEqual(['n', 'kg']);
    expect(getAllowedInventoryInputUnits('kg')).toEqual(['kg']);
  });

  it('FASE 106-BIS (2): Option B ("Pesa e Parcheggia") blocks 1:1 fallback when weighing mt/n without conversion factor', () => {
    const mtWithoutFactor = {
      unitOfMeasure: 'mt' as const,
      rapportoKgMt: 0,
      conversionFactor: null,
    };

    const metricsMt = computeInventoryMetrics({
      material: mtWithoutFactor,
      inputQuantity: 92,
      inputUnit: 'kg',
      tareWeight: 2,
      theoreticalUnitsAtScan: 200,
    });

    expect(metricsMt.missingConversionFactor).toBe(true);
    expect(metricsMt.isDirectCount).toBe(false);
    expect(metricsMt.netWeight).toBe(90);
    expect(metricsMt.grossWeight).toBe(92);
    expect(metricsMt.tareWeight).toBe(2);
    expect(metricsMt.countedUnits).toBe(0);
    expect(metricsMt.deltaUnits).toBeNull();
    expect(metricsMt.isAnomaly).toBe(true);

    const nWithoutFactor = {
      unitOfMeasure: 'n' as const,
      conversionFactor: undefined,
      rapportoKgMt: null,
    };

    const metricsN = computeInventoryMetrics({
      material: nWithoutFactor,
      inputQuantity: 15,
      inputUnit: 'kg',
      tareWeight: 0,
      theoreticalUnitsAtScan: 100,
    });

    expect(metricsN.missingConversionFactor).toBe(true);
    expect(metricsN.countedUnits).toBe(0);
    expect(metricsN.deltaUnits).toBeNull();
  });

  it('FASE 106-BIS (3): direct count on mt/n without factor sets isDirectCount: true and zero fake kg weight', () => {
    const guainaMt = {
      unitOfMeasure: 'mt' as const,
      rapportoKgMt: null,
      conversionFactor: 0,
    };

    const metrics = computeInventoryMetrics({
      material: guainaMt,
      inputQuantity: 1800,
      inputUnit: 'mt',
      tareWeight: 0,
      theoreticalUnitsAtScan: 1500,
    });

    expect(metrics.isDirectCount).toBe(true);
    expect(metrics.missingConversionFactor).toBe(false);
    expect(metrics.hasWeightEstimate).toBe(false);
    expect(metrics.countedUnits).toBe(1800);
    expect(metrics.deltaUnits).toBe(300);
    expect(metrics.netWeight).toBe(0);
    expect(metrics.grossWeight).toBe(0);
  });

  it('FASE 106-BIS (4): rounds countedUnits to integer via Math.round when uom="n" is weighed in kg', () => {
    const pezziMaterial = {
      unitOfMeasure: 'n' as const,
      conversionFactor: 0.047, // 47g per piece
    };

    // 5.0 kg net / 0.047 = 106.382978... -> rounds to 106 integer pieces
    const metricsFloor = computeInventoryMetrics({
      material: pezziMaterial,
      inputQuantity: 5.0,
      inputUnit: 'kg',
      tareWeight: 0,
      theoreticalUnitsAtScan: 100,
    });
    expect(metricsFloor.countedUnits).toBe(106);
    expect(Number.isInteger(metricsFloor.countedUnits)).toBe(true);

    // 5.02 kg net / 0.047 = 106.8085... -> rounds to 107 integer pieces
    const metricsCeil = computeInventoryMetrics({
      material: pezziMaterial,
      inputQuantity: 5.02,
      inputUnit: 'kg',
      tareWeight: 0,
      theoreticalUnitsAtScan: 100,
    });
    expect(metricsCeil.countedUnits).toBe(107);
    expect(Number.isInteger(metricsCeil.countedUnits)).toBe(true);
  });

  it('FASE 106-BIS (5): pending record dynamically unlocks and recalculates once material receives conversion factor', () => {
    const pendingParkedRecord = {
      id: 'rec-parked-1',
      materialId: 'mat-guaina',
      status: 'pending' as const,
      inputUnit: 'kg' as const,
      inputQuantity: 27,
      grossWeight: 27,
      tareWeight: 2,
      netWeight: 25,
      countedUnits: 0,
      theoreticalUnitsAtScan: 80,
      conversionFactor: undefined,
      rapportoKgMt: undefined,
    };

    // Step 1: Material has no factor yet -> parked (missingConversionFactor: true)
    const beforeFactor = resolveRecordMetrics(pendingParkedRecord, {
      unitOfMeasure: 'mt',
      rapportoKgMt: 0,
      conversionFactor: 0,
    });
    expect(beforeFactor.missingConversionFactor).toBe(true);
    expect(beforeFactor.countedUnits).toBe(0);
    expect(beforeFactor.deltaUnits).toBeNull();

    // Step 2: Admin sets rapportoKgMt = 0.25 on rawMaterials -> row unlocks automatically!
    // Net weight = 27 - 2 = 25 kg -> 25 / 0.25 = 100 mt (Delta = +20 mt)
    const afterFactor = resolveRecordMetrics(pendingParkedRecord, {
      unitOfMeasure: 'mt',
      rapportoKgMt: 0.25,
      conversionFactor: 0,
    });
    expect(afterFactor.missingConversionFactor).toBe(false);
    expect(afterFactor.countedUnits).toBe(100);
    expect(afterFactor.deltaUnits).toBe(20);
    expect(resolveRecordCountedUnits(pendingParkedRecord, { unitOfMeasure: 'mt', rapportoKgMt: 0.25 })).toBe(100);
  });

  it('FASE 106-BIS (6): aligns stock-logic.ts hydrateMaterialWithWithdrawals for mt using conversionFactor fallback', () => {
    const mtWithConvFactor: RawMaterial = {
      id: 'mat-mt-conv',
      type: 'GUAINA',
      code: 'GU-TEST',
      description: 'Guaina con fattore in conversionFactor',
      details: {},
      unitOfMeasure: 'mt',
      rapportoKgMt: 0,
      conversionFactor: 0.25,
      currentStockUnits: 100,
      currentWeightKg: 100,
      batches: [
        {
          id: 'b-gu-1',
          date: '2026-01-10T00:00:00.000Z',
          ddt: 'DDT-1',
          lotto: 'LG-1',
          netQuantity: 100,
          grossWeight: 25,
          tareWeight: 0,
        },
      ],
    };

    const hydrated = hydrateMaterialWithWithdrawals(mtWithConvFactor, [
      {
        id: 'w-gu-1',
        jobIds: [],
        jobOrderPFs: [],
        materialId: 'mat-mt-conv',
        materialCode: 'GU-TEST',
        lotto: 'LG-1',
        consumedUnits: 20,
        consumedWeight: 5,
        operatorId: 'op-1',
        withdrawalDate: '2026-02-01T00:00:00.000Z',
        status: 'completed',
      },
    ]);

    expect(hydrated.currentStockUnits).toBe(80);
    expect(hydrated.currentWeightKg).toBe(20); // 80 mt * 0.25 kg/mt = 20 kg
    expect(hydrated.batches[0].currentWeightKg).toBe(20);
  });
});

