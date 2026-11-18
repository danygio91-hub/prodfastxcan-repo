import { describe, it, expect } from 'vitest';
import {
  isBOMItemPhaseCompleted,
  calculateMRPTimelines,
  buildJobComponentWithdrawalIndex,
  getJobComponentWithdrawnQty,
} from './mrp-utils';
import type { JobOrder, RawMaterial, MaterialWithdrawal } from '@/types';

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

describe('FASE 97-TER: Override MRP tramite Scarichi Storici e Manuali', () => {
  const mockTuboMaterial: RawMaterial = {
    id: 'mat-20x1l30r-docid',
    code: '20X1L30R',
    description: 'TUBO RAME 20X1 L30',
    details: '',
    type: 'TUBI',
    unitOfMeasure: 'n',
    currentStockUnits: 0,
    currentWeightKg: 0,
    minStockLevel: 0,
    batches: [],
  } as RawMaterial;

  const job788: JobOrder = {
    id: '788-PF.1_2026',
    ordinePF: '788/PF.1',
    cliente: 'Cliente Test',
    qta: 250,
    department: 'CP',
    details: 'ART-788',
    dataConsegnaFinale: '2026-11-28',
    postazioneLavoro: '',
    status: 'DA_INIZIARE',
    billOfMaterials: [
      {
        component: '20X1L30R',
        unit: 'n',
        quantity: 1,
        status: 'pending',
        isFromTemplate: true,
      },
    ],
    phases: [],
  };

  it('Saturazione 100%: sblocca 788/PF.1 per 20X1L30R quando esiste uno SCARICO MANUALE per 250 pz in jobOrderPFs (con jobIds vuoto)', () => {
    const manualWithdrawal: MaterialWithdrawal = {
      id: 'w-manual-788',
      jobIds: [],
      jobOrderPFs: ['788/PF.1'],
      materialId: 'mat-20x1l30r-docid',
      materialCode: '20X1L30R',
      consumedWeight: 12.5,
      consumedUnits: 250,
      operatorId: 'op-1',
      withdrawalDate: new Date(),
      source: 'manual',
    };

    const index = buildJobComponentWithdrawalIndex([manualWithdrawal], [mockTuboMaterial]);
    const totalWithdrawn = getJobComponentWithdrawnQty(job788, '20X1L30R', index);
    expect(totalWithdrawn).toBe(250);

    const timelines = calculateMRPTimelines(
      [job788],
      [mockTuboMaterial],
      [],
      [],
      [],
      null,
      [],
      index
    );

    const entries = timelines.get('20X1L30R') || [];
    expect(entries.find((e) => e.jobId === job788.id)).toBeUndefined();
  });

  it('Saturazione Parziale: sottrae totalWithdrawn (100 pz) dal fabbisogno originario (250 pz) lasciando solo il residuo (150 pz) in demands', () => {
    const partialWithdrawal: MaterialWithdrawal = {
      id: 'w-partial-788',
      jobIds: [],
      jobOrderPFs: ['788/PF.1'],
      materialId: 'mat-20x1l30r-docid',
      materialCode: '20X1L30R',
      consumedWeight: 5,
      consumedUnits: 100,
      operatorId: 'op-1',
      withdrawalDate: new Date(),
      source: 'manual',
    };

    const index = buildJobComponentWithdrawalIndex([partialWithdrawal], [mockTuboMaterial]);
    const timelines = calculateMRPTimelines(
      [job788],
      [mockTuboMaterial],
      [],
      [],
      [],
      null,
      [],
      index
    );

    const entries = timelines.get('20X1L30R') || [];
    const jobEntry = entries.find((e) => e.jobId === job788.id);
    expect(jobEntry).toBeDefined();
    expect(jobEntry?.requiredQty).toBe(150);
  });

  it('ignora gli scarichi con status === cancelled e non collide con commesse madri o split fratelli (788/PF o 788/PF.2)', () => {
    const cancelledOrOtherWithdrawals: MaterialWithdrawal[] = [
      {
        id: 'w-cancelled',
        jobIds: [],
        jobOrderPFs: ['788/PF.1'],
        materialId: 'mat-20x1l30r-docid',
        materialCode: '20X1L30R',
        consumedWeight: 12.5,
        consumedUnits: 250,
        operatorId: 'op-1',
        withdrawalDate: new Date(),
        status: 'cancelled',
        source: 'manual',
      },
      {
        id: 'w-other-split',
        jobIds: [],
        jobOrderPFs: ['788/PF.2'],
        materialId: 'mat-20x1l30r-docid',
        materialCode: '20X1L30R',
        consumedWeight: 12.5,
        consumedUnits: 250,
        operatorId: 'op-1',
        withdrawalDate: new Date(),
        source: 'manual',
      },
    ];

    const index = buildJobComponentWithdrawalIndex(cancelledOrOtherWithdrawals, [mockTuboMaterial]);
    expect(getJobComponentWithdrawnQty(job788, '20X1L30R', index)).toBe(0);
  });
});

