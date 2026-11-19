import { describe, it, expect } from 'vitest';
import { evaluateJobStartEligibility, isPlannedStatusValue } from './job-status';
import type { JobOrder, JobPhase } from '@/types';

function makePhase(overrides: Partial<JobPhase> = {}): JobPhase {
  return {
    id: 'ph-1',
    name: 'Taglio',
    status: 'pending',
    materialReady: true,
    workPeriods: [],
    sequence: 1,
    materialConsumptions: [],
    departmentCodes: ['CP'],
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    id: 'job-1',
    cliente: 'CLIENTE TEST',
    qta: 100,
    department: 'CP',
    details: 'ART-01',
    ordinePF: '869/PF.1',
    dataConsegnaFinale: '2026-11-30',
    postazioneLavoro: 'P1',
    phases: [makePhase()],
    status: 'Pianificata',
    billOfMaterials: [],
    ...overrides,
  };
}

describe('FASE 98: isPlannedStatusValue', () => {
  it('riconosce varianti case-insensitive degli stati pianificati / da avviare', () => {
    expect(isPlannedStatusValue('Pianificata')).toBe(true);
    expect(isPlannedStatusValue('PLANNED')).toBe(true);
    expect(isPlannedStatusValue('pianificate')).toBe(true);
    expect(isPlannedStatusValue('DA_AVVIARE')).toBe(true);
    expect(isPlannedStatusValue('CONFIRMED')).toBe(true);
    expect(isPlannedStatusValue('PREP')).toBe(true);
    expect(isPlannedStatusValue('')).toBe(true);
  });

  it('esclude stati gia avviati o conclusi', () => {
    expect(isPlannedStatusValue('In Produzione')).toBe(false);
    expect(isPlannedStatusValue('Completato Prod.')).toBe(false);
    expect(isPlannedStatusValue('Spedito')).toBe(false);
  });
});

describe('FASE 98: evaluateJobStartEligibility', () => {
  it('consente avvio di commesse PLANNED / DA_AVVIARE / CONFIRMED anche con BOM vuota o carenza MRP', () => {
    const plannedUpper = evaluateJobStartEligibility(
      makeJob({ status: 'PLANNED', billOfMaterials: [], hasMaterialShortage: true })
    );
    expect(plannedUpper.eligible).toBe(true);

    const daAvviare = evaluateJobStartEligibility(
      makeJob({ status: 'DA_AVVIARE', billOfMaterials: undefined })
    );
    expect(daAvviare.eligible).toBe(true);

    const confirmed = evaluateJobStartEligibility(
      makeJob({ status: 'CONFIRMED', hasMaterialShortage: true })
    );
    expect(confirmed.eligible).toBe(true);
  });

  it('consente avvio se il ciclo e referenziato da workCycleId o da Anagrafica Articolo', () => {
    const withWorkCycleId = evaluateJobStartEligibility(
      makeJob({ phases: [], workCycleId: 'wc-1' })
    );
    expect(withWorkCycleId.eligible).toBe(true);

    const withArticleCycle = evaluateJobStartEligibility(
      makeJob({ phases: [], workCycleId: undefined }),
      { hasArticleWorkCycle: true }
    );
    expect(withArticleCycle.eligible).toBe(true);
  });

  it('blocca con motivo esplicito quando manca il ciclo di lavorazione o la data di consegna', () => {
    const noCycle = evaluateJobStartEligibility(
      makeJob({ phases: [], workCycleId: undefined })
    );
    expect(noCycle.eligible).toBe(false);
    expect(noCycle.skipCategory).toBe('no_cycle');

    const noDate = evaluateJobStartEligibility(
      makeJob({ dataConsegnaFinale: '' })
    );
    expect(noDate.eligible).toBe(false);
    expect(noDate.skipCategory).toBe('no_date');
  });

  it('blocca commesse gia concluse o gia avviate restituendo la categoria corretta', () => {
    const shipped = evaluateJobStartEligibility(makeJob({ status: 'Spedito' }));
    expect(shipped.eligible).toBe(false);
    expect(shipped.skipCategory).toBe('concluded');
    expect(shipped.reason).toContain('Spedito');

    const completed = evaluateJobStartEligibility(
      makeJob({
        status: 'completed',
        phases: [makePhase({ status: 'completed' })],
      })
    );
    expect(completed.eligible).toBe(false);
    expect(completed.skipCategory).toBe('concluded');

    const inProd = evaluateJobStartEligibility(
      makeJob({
        status: 'In Produzione',
        phases: [makePhase({ status: 'in-progress' })],
      })
    );
    expect(inProd.eligible).toBe(false);
    expect(inProd.skipCategory).toBe('already_started');
    expect(inProd.reason).toContain('In Produzione');
  });
});
