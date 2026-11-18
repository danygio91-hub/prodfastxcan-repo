import { describe, it, expect } from 'vitest';
import { isBOMItemPhaseCompleted, calculateMRPTimelines } from './mrp-utils';
import type { JobOrder, RawMaterial } from '@/types';

describe('FASE 94: Override Stato MRP da Fase Completata', () => {
  const mockBraidedMaterial: RawMaterial = {
    id: 'mat-185',
    code: '185X025IR',
    description: 'TRECCIA RAME STAGNATO 185X025',
    type: 'BOB',
    unitOfMeasure: 'mt',
    currentStockUnits: 0,
    minStockLevel: 0,
    batches: [
      {
        id: 'b-1',
        lotto: 'L-100',
        activeSessionId: 'session-open-1',
      } as any,
    ],
  } as RawMaterial;

  it('forza il componente 185X025IR come completato/prelevato se la fase Taglio Treccia/Corda è status: completed', () => {
    const jobWithCompletedPhase: JobOrder = {
      id: 'job-1',
      ordinePF: '860/PF.1',
      cliente: 'Cliente Test',
      qta: 10,
      department: 'CP',
      details: 'ART-01',
      dataConsegnaFinale: '2026-11-25',
      postazioneLavoro: '',
      status: 'IN_PRODUZIONE',
      billOfMaterials: [
        {
          component: '185X025IR',
          unit: 'mt',
          quantity: 2,
          status: 'pending',
          isFromTemplate: true,
        },
      ],
      phases: [
        {
          id: 'phase-template-1',
          name: 'Taglio Treccia/Corda',
          type: 'preparation',
          status: 'completed',
          sequence: -3,
          materialReady: true,
          workPeriods: [],
          materialConsumptions: [],
          departmentCodes: ['MAG'],
        },
      ],
    };

    const res = isBOMItemPhaseCompleted(
      jobWithCompletedPhase,
      jobWithCompletedPhase.billOfMaterials![0],
      mockBraidedMaterial
    );
    expect(res.completed).toBe(true);
    expect(res.phaseName).toBe('Taglio Treccia/Corda');

    // Anche con sessione attiva aperta e stock 0, calculateMRPTimelines salta il fabbisogno già assolto dalla fase completata
    const timelines = calculateMRPTimelines(
      [jobWithCompletedPhase],
      [mockBraidedMaterial],
      [],
      [],
      [],
      null,
      [
        {
          id: 'session-open-1',
          status: 'open',
          materialCode: '185X025IR',
          linkedJobOrderIds: ['job-1'],
        },
      ]
    );

    const entriesFor185 = timelines.get('185X025IR') || [];
    expect(entriesFor185.find((e) => e.jobId === 'job-1')).toBeUndefined();
  });

  it('non forza il componente se la fase correlata è ancora in-progress o pending', () => {
    const jobInProgressPhase: JobOrder = {
      id: 'job-2',
      ordinePF: '860/PF.2',
      cliente: 'Cliente Test',
      qta: 10,
      department: 'CP',
      details: 'ART-01',
      dataConsegnaFinale: '2026-11-25',
      postazioneLavoro: '',
      status: 'IN_PREPARAZIONE',
      billOfMaterials: [
        {
          component: '185X025IR',
          unit: 'mt',
          quantity: 2,
          status: 'pending',
          isFromTemplate: true,
        },
      ],
      phases: [
        {
          id: 'phase-template-1',
          name: 'Taglio Treccia/Corda',
          type: 'preparation',
          status: 'in-progress',
          sequence: -3,
          materialReady: true,
          workPeriods: [],
          materialConsumptions: [],
          departmentCodes: ['MAG'],
        },
      ],
    };

    const res = isBOMItemPhaseCompleted(
      jobInProgressPhase,
      jobInProgressPhase.billOfMaterials![0],
      mockBraidedMaterial
    );
    expect(res.completed).toBe(false);
  });
});
