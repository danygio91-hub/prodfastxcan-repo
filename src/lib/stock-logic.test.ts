import { describe, it, expect } from 'vitest';
import {
  extractHydratedLots,
  getLotResidualSummary,
  hydrateMaterialWithWithdrawals,
  normStockLot,
  previewWithdrawalImpact,
} from './stock-logic';
import type { MaterialWithdrawal, RawMaterial } from '@/types';

const makeMaterial = (overrides?: Partial<RawMaterial>): RawMaterial => ({
  id: 'mat-1',
  code: 'TUBO-01',
  description: 'Tubo test SSoT',
  type: 'TUBO',
  details: {},
  unitOfMeasure: 'kg',
  currentStockUnits: 300,
  currentWeightKg: 300,
  batches: [
    {
      id: 'b-1',
      lotto: 'LOT-A',
      ddt: 'DDT-1',
      date: '2026-01-10T00:00:00.000Z',
      grossWeight: 302,
      tareWeight: 2,
      netQuantity: 300,
      currentQuantity: 300,
      isExhausted: false,
    },
  ],
  ...overrides,
});

const makeWithdrawal = (
  lotto: string,
  consumedUnits: number,
  status: MaterialWithdrawal['status'] = 'completed',
  id = 'w-1'
): MaterialWithdrawal => ({
  id,
  materialId: 'mat-1',
  materialCode: 'TUBO-01',
  operatorId: 'op-1',
  operatorName: 'Mario',
  withdrawalDate: '2026-02-01T10:00:00.000Z',
  consumedUnits,
  consumedWeight: consumedUnits,
  jobIds: ['job-1'],
  jobOrderPFs: ['PF-100'],
  lotto,
  status,
});

describe('FASE 80: SSoT Stock Logic & Operator Alignment', () => {
  it('hydrates residual currentQuantity (300 - 100 = 200) while preserving immutable initial netQuantity', () => {
    const raw = makeMaterial();
    const hydrated = hydrateMaterialWithWithdrawals(raw, [makeWithdrawal('lot-a', 100)]);

    expect(hydrated.currentStockUnits).toBe(200);
    expect(hydrated.batches?.[0].netQuantity).toBe(300);
    expect(hydrated.batches?.[0].currentQuantity).toBe(200);
    expect(hydrated.batches?.[0].currentWeightKg).toBe(200);
    expect(hydrated.batches?.[0].isExhausted).toBe(false);
  });

  it('extractHydratedLots strictly reads currentQuantity & currentWeightKg (never netQuantity) and aggregates FIFO', () => {
    const raw = makeMaterial({
      batches: [
        {
          id: 'b-1',
          lotto: 'lot-a ',
          ddt: 'DDT-1',
          date: '2026-01-10T00:00:00.000Z',
          grossWeight: 300,
          tareWeight: 0,
          netQuantity: 300,
          currentQuantity: 300,
          isExhausted: false,
        },
        {
          id: 'b-2',
          lotto: 'LOT-A',
          ddt: 'DDT-2',
          date: '2026-01-20T00:00:00.000Z',
          grossWeight: 100,
          tareWeight: 0,
          netQuantity: 100,
          currentQuantity: 100,
          isExhausted: false,
        },
        {
          id: 'b-3',
          lotto: 'LOT-B',
          ddt: 'DDT-3',
          date: '2026-01-05T00:00:00.000Z',
          grossWeight: 50,
          tareWeight: 0,
          netQuantity: 50,
          currentQuantity: 50,
          isExhausted: false,
        },
      ],
    });

    const hydrated = hydrateMaterialWithWithdrawals(raw, [
      makeWithdrawal('LOT-A', 200, 'completed', 'w-1'),
      makeWithdrawal('LOT-A', 50, 'cancelled', 'w-2'),
    ]);

    const lots = extractHydratedLots(hydrated);
    expect(lots.map((l) => normStockLot(l.lotto))).toEqual(['LOT-B', 'LOT-A']);

    const lotA = lots.find((l) => normStockLot(l.lotto) === 'LOT-A');
    expect(lotA?.available).toBe(200);
    expect(lotA?.availableWeightKg).toBe(200);

    const summaryA = getLotResidualSummary(hydrated, ' lot-a ');
    expect(summaryA.availableUnits).toBe(200);
    expect(summaryA.availableWeightKg).toBe(200);
    expect(summaryA.matchingBatches).toHaveLength(2);
  });

  it('recomputes stale isExhausted flags from hydrated currentQuantity', () => {
    const raw = makeMaterial({
      batches: [
        {
          id: 'b-stale',
          lotto: 'LOT-STALE',
          ddt: 'DDT-1',
          date: '2026-01-10T00:00:00.000Z',
          grossWeight: 300,
          tareWeight: 0,
          netQuantity: 300,
          currentQuantity: 0,
          isExhausted: true, // stale flag in DB despite 200kg left after 100kg withdrawal
        },
      ],
    });

    const hydrated = hydrateMaterialWithWithdrawals(raw, [makeWithdrawal('LOT-STALE', 100)]);
    const lots = extractHydratedLots(hydrated);

    expect(lots).toHaveLength(1);
    expect(lots[0].available).toBe(200);
  });

  it('computes live preview for direct mode (200 - 50 = 150) and blocks overdraw (250 > 200)', () => {
    const okPreview = previewWithdrawalImpact({
      availableUnits: 200,
      rawInput: 50,
      isScaleMode: false,
      unitOfMeasure: 'kg',
    });

    expect(okPreview.hasInput).toBe(true);
    expect(okPreview.currentAvailableUnits).toBe(200);
    expect(okPreview.withdrawalUnits).toBe(50);
    expect(okPreview.estimatedRemainingUnits).toBe(150);
    expect(okPreview.isOverdraw).toBe(false);
    expect(okPreview.errorMessage).toBeNull();

    const overdrawPreview = previewWithdrawalImpact({
      availableUnits: 200,
      rawInput: 250,
      isScaleMode: false,
      unitOfMeasure: 'kg',
    });

    expect(overdrawPreview.isOverdraw).toBe(true);
    expect(overdrawPreview.estimatedRemainingUnits).toBe(0);
    expect(overdrawPreview.errorMessage).toBe('Quantità superiore alla giacenza');
  });

  it('computes scale-mode KG preview with tare subtraction and overdraw detection', () => {
    // 200 kg available; gross on scale = 152 kg with 2 kg tare => remaining net = 150 kg => withdrawn = 50 kg
    const scaleOk = previewWithdrawalImpact({
      availableUnits: 200,
      rawInput: 152,
      isScaleMode: true,
      tareKg: 2,
      unitOfMeasure: 'kg',
    });

    expect(scaleOk.netOnScaleUnits).toBe(150);
    expect(scaleOk.withdrawalUnits).toBe(50);
    expect(scaleOk.estimatedRemainingUnits).toBe(150);
    expect(scaleOk.isOverdraw).toBe(false);
    expect(scaleOk.isZeroOrNegativeScaleDelta).toBe(false);

    // Remaining on scale (205 - 2 = 203 kg) > available (200 kg) => overdraw block
    const scaleOver = previewWithdrawalImpact({
      availableUnits: 200,
      rawInput: 205,
      isScaleMode: true,
      tareKg: 2,
      unitOfMeasure: 'kg',
    });

    expect(scaleOver.isOverdraw).toBe(true);
    expect(scaleOver.errorMessage).toBe('Quantità superiore alla giacenza');
    expect(scaleOver.withdrawalUnits).toBe(0);

    // Non-KG primary unit (mt with rapportoKgMt = 0.5 kg/mt): 200 mt available (= 100 kg net).
    // Gross on scale = 82 kg, tare = 2 kg => 80 kg net => 160 mt on scale => 40 mt withdrawn
    const scaleMt = previewWithdrawalImpact({
      availableUnits: 200,
      rawInput: 82,
      isScaleMode: true,
      tareKg: 2,
      unitOfMeasure: 'mt',
      rapportoKgMt: 0.5,
    });

    expect(scaleMt.netOnScaleUnits).toBe(160);
    expect(scaleMt.withdrawalUnits).toBe(40);
    expect(scaleMt.estimatedRemainingUnits).toBe(160);
    expect(scaleMt.isOverdraw).toBe(false);
  });
});
