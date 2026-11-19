import { describe, it, expect } from 'vitest';
import {
  calculateInventoryMovement,
  finalizePostWithdrawalMaterialState,
  prepareWithdrawalMovement,
} from './inventory-utils';
import { getLotResidualSummary, hydrateMaterialWithWithdrawals } from './stock-logic';
import { formatDisplayStock } from './utils';
import type { MaterialWithdrawal, RawMaterial } from '@/types';

const makeDiscreteMaterial = (netLoad = 200, priorWithdrawn = 94.272): {
  material: RawMaterial;
  withdrawals: MaterialWithdrawal[];
} => ({
  material: {
    id: 'mat-45',
    code: '45X1.5L33SN',
    description: 'Terminale test T0010-25',
    type: 'TERMINALE',
    details: {},
    unitOfMeasure: 'n',
    conversionFactor: 0.05,
    currentStockUnits: 106, // simula vecchio campo arrotondato corrotto su DB
    currentWeightKg: 5.3,
    batches: [
      {
        id: 'b-t0010',
        lotto: 'T0010-25',
        ddt: 'DDT-25',
        date: '2025-10-01T00:00:00.000Z',
        grossWeight: 10,
        tareWeight: 0,
        netQuantity: netLoad,
        isExhausted: false,
      },
    ],
  },
  withdrawals:
    priorWithdrawn > 0
      ? [
          {
            id: 'w-prev',
            materialId: 'mat-45',
            materialCode: '45X1.5L33SN',
            operatorId: 'op-1',
            operatorName: 'Operatore',
            withdrawalDate: '2026-01-10T10:00:00.000Z',
            consumedUnits: priorWithdrawn,
            consumedWeight: Number((priorWithdrawn * 0.05).toFixed(3)),
            jobIds: ['job-1'],
            jobOrderPFs: ['PF-1'],
            lotto: 'T0010-25',
            status: 'completed',
          },
        ]
      : [],
});

describe('FASE 99: Zero-Out "Materiale Finito", Tolleranza Float e Coerenza Display', () => {
  const nConfig = { id: 'TERMINALE', label: 'Terminale', defaultUnit: 'n', hasConversion: true };

  it('Materiale Finito azzera esattamente 105.728 sul lotto T0010-25 senza fallire per arrotondamento a 106', () => {
    const { material, withdrawals } = makeDiscreteMaterial(200, 94.272);

    const movement = prepareWithdrawalMovement({
      material,
      config: nConfig,
      withdrawals,
      quantity: 106, // simula client che invia valore arrotondato 106
      inputUom: 'n',
      lotto: 'T0010-25',
      isFinished: true,
      clearActiveSession: true,
    });

    expect(movement.unitsToChange).toBe(105.728);
    expect(movement.weightToChange).toBe(5.286);
    expect(movement.usedLotto).toBe('T0010-25');
    expect(movement.updatedBatches[0].isExhausted).toBe(true);
    expect(movement.updatedBatches[0].activeSessionId).toBeNull();

    const postState = finalizePostWithdrawalMaterialState(
      material,
      movement.updatedBatches,
      withdrawals,
      {
        id: 'w-final',
        materialId: material.id,
        materialCode: material.code,
        lotto: movement.usedLotto,
        consumedUnits: movement.unitsToChange,
        consumedWeight: movement.weightToChange,
        isFinal: true,
      }
    );

    expect(postState.currentStockUnits).toBe(0);
    expect(postState.currentWeightKg).toBe(0);
    expect(postState.syncedBatches[0].isExhausted).toBe(true);

    const summaryAfter = getLotResidualSummary(postState.hydratedAfter, 'T0010-25');
    expect(summaryAfter.isExhausted).toBe(true);
    expect(summaryAfter.availableUnits).toBe(0);
  });

  it('tollera arrotondamento intero su residuo decimale (106 vs 105.728) nello scarico standard senza andare in negativo', () => {
    const { material, withdrawals } = makeDiscreteMaterial(200, 94.272);

    const res = calculateInventoryMovement(
      material,
      nConfig,
      106,
      'n',
      false,
      'T0010-25',
      withdrawals,
      { isExhaustion: false }
    );

    expect(res.unitsToChange).toBe(105.728);
    expect(res.weightToChange).toBeLessThanOrEqual(5.3);
  });

  it('blocca comunque un vero sovra-scarico oltre tolleranza su unita intere e continue', () => {
    const { material } = makeDiscreteMaterial(105, 0);

    expect(() =>
      calculateInventoryMovement(material, nConfig, 106, 'n', false, 'T0010-25', [], {
        isExhaustion: false,
      })
    ).toThrow(/Giacenza insufficiente sul lotto T0010-25/);

    const kgMaterial: RawMaterial = {
      ...material,
      unitOfMeasure: 'kg',
      batches: [{ ...material.batches![0], netQuantity: 105.728 }],
    };
    const kgConfig = { id: 'CAVO', label: 'Cavo', defaultUnit: 'kg', hasConversion: false };

    // Entro EPSILON (0.01): tollerato e clampato
    const okFloat = calculateInventoryMovement(
      kgMaterial,
      kgConfig,
      105.735,
      'kg',
      false,
      'T0010-25',
      [],
      { isExhaustion: false }
    );
    expect(okFloat.unitsToChange).toBe(105.728);

    // Oltre EPSILON (0.01): bloccato
    expect(() =>
      calculateInventoryMovement(kgMaterial, kgConfig, 105.8, 'kg', false, 'T0010-25', [], {
        isExhaustion: false,
      })
    ).toThrow(/Giacenza insufficiente sul lotto T0010-25/);
  });

  it('allinea TOTALE MAGAZZINO e IN USO (LOTTO) tramite formatDisplayStock su SSoT idratato', () => {
    const { material, withdrawals } = makeDiscreteMaterial(200, 94.272);
    const hydrated = hydrateMaterialWithWithdrawals(material, withdrawals);
    const summary = getLotResidualSummary(hydrated, 'T0010-25');

    expect(formatDisplayStock(hydrated.currentStockUnits, 'n')).toBe('105');
    expect(formatDisplayStock(summary.availableUnits, 'n')).toBe('105');
    expect(formatDisplayStock(summary.availableUnits, 'N')).toBe('105');
    expect(formatDisplayStock(9.999999, 'n')).toBe('10');
  });
});
