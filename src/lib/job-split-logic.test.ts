import { describe, expect, it } from 'vitest';
import {
  computeNextChildOrdinePF,
  computeSplitJobPayloads,
  mapPhasesForSplitChild,
  normalizeChildJobId,
} from './job-split-logic';
import type { JobOrder } from '@/types';

describe('job-split-logic (FASE 83 & FASE 83-BIS)', () => {
  it('normalizeChildJobId converte ordinePF in chiave Firestore normalizzata (es. 779/PF.2_1 -> 779-PF.2_1)', () => {
    expect(normalizeChildJobId('779/PF.2_1')).toBe('779-PF.2_1');
    expect(normalizeChildJobId('860/PF.6_2')).toBe('860-PF.6_2');
  });

  it('computeNextChildOrdinePF genera _1 se non esistono figli e incrementa a _2, _3 ignorando eventuali suffissi anno', () => {
    expect(computeNextChildOrdinePF('779/PF.2', [])).toEqual({
      childOrdinePF: '779/PF.2_1',
      suffixNumber: 1,
      childDocId: '779-PF.2_1',
    });

    // Ignora eventuali record sporchi con anno (_2026, _2027) e genera _1 se non esistono veri figli _1
    expect(computeNextChildOrdinePF('779/PF.2', ['779/PF.2_2027'])).toEqual({
      childOrdinePF: '779/PF.2_1',
      suffixNumber: 1,
      childDocId: '779-PF.2_1',
    });

    expect(
      computeNextChildOrdinePF('779/PF.2', ['779/PF.2_1', '779/PF.2_2'])
    ).toEqual({
      childOrdinePF: '779/PF.2_3',
      suffixNumber: 3,
      childDocId: '779-PF.2_3',
    });
  });

  it('valida che la somma delle quantità coincida con la quantità originale', () => {
    const baseJob: JobOrder = {
      id: '779-PF.2_2026',
      ordinePF: '779/PF.2',
      cliente: 'TEST SRL',
      details: 'E60025',
      department: 'CP',
      qta: 1000,
      dataConsegnaFinale: '2026-11-20',
      postazioneLavoro: 'Da Assegnare',
      status: 'IN_PRODUZIONE',
      phases: [],
    };

    const invalidSum = computeSplitJobPayloads({
      originalJob: baseJob,
      newQuantityOriginal: 700,
      newQuantityChild: 250,
      childId: '779-PF.2_1',
      childOrdinePF: '779/PF.2_1',
    });
    expect(invalidSum.valid).toBe(false);
    expect(invalidSum.error).toContain('1000');
  });

  it('mantiene intatte le fasi completed nel figlio e azzera a pending quelle in-progress o in pausa', () => {
    const baseJob: JobOrder = {
      id: '779-PF.2_2026',
      ordinePF: '779/PF.2',
      cliente: 'TEST SRL',
      details: 'E60025',
      department: 'CP',
      qta: 1000,
      qtaRichiesta: 1000,
      expectedMinutesDefault: 0.6, // 10.0 ore totali
      dataConsegnaFinale: '2026-11-20',
      postazioneLavoro: 'Da Assegnare',
      status: 'IN_PRODUZIONE',
      numeroODL: '0123-26',
      numeroODLInterno: '0123-26',
      isPrinted: true,
      odlPrinted: true,
      phases: [
        {
          id: 'ph-1',
          name: 'Taglio',
          status: 'completed',
          materialReady: true,
          workPeriods: [{ start: '2026-11-10T08:00:00Z', end: '2026-11-10T09:00:00Z', operatorId: 'op-1' }],
          sequence: 1,
          type: 'preparation',
          materialConsumptions: [{ materialId: 'm1', materialCode: 'TUBO-1' }],
          departmentCodes: ['MAG'],
          qualityResult: 'passed',
          forced: false,
        },
        {
          id: 'ph-2',
          name: 'Assemblaggio',
          status: 'in-progress',
          materialReady: true,
          workPeriods: [{ start: '2026-11-10T09:30:00Z', end: null, operatorId: 'op-2' }],
          sequence: 2,
          type: 'production',
          materialConsumptions: [],
          departmentCodes: ['CP'],
        },
        {
          id: 'ph-3',
          name: 'Collaudo',
          status: 'paused',
          materialReady: false,
          workPeriods: [{ start: '2026-11-10T10:00:00Z', end: '2026-11-10T10:15:00Z', operatorId: 'op-3' }],
          pauseReason: 'Attesa attrezzatura',
          sequence: 3,
          type: 'production',
          materialConsumptions: [],
          departmentCodes: ['QLTY'],
        },
      ],
    };

    const res = computeSplitJobPayloads({
      originalJob: baseJob,
      newQuantityOriginal: 700,
      newQuantityChild: 300,
      childId: '779-PF.2_1',
      childOrdinePF: '779/PF.2_1',
    });

    expect(res.valid).toBe(true);
    const child = res.childJobPayload!;
    expect(child.id).toBe('779-PF.2_1');
    expect(child.ordinePF).toBe('779/PF.2_1');
    expect(child.qta).toBe(300);
    expect(child.orePreviste).toBe(3);

    // Fase 1 (completed nel padre) -> rimane intatta nel figlio!
    expect(child.phases[0].status).toBe('completed');
    expect(child.phases[0].workPeriods).toHaveLength(1);
    expect(child.phases[0].workPeriods[0].operatorId).toBe('op-1');
    expect(child.phases[0].materialConsumptions).toHaveLength(1);

    // Fase 2 (in-progress nel padre) -> azzerata a pending nel figlio
    expect(child.phases[1].status).toBe('pending');
    expect(child.phases[1].workPeriods).toEqual([]);
    expect(child.phases[1].materialConsumptions).toEqual([]);

    // Fase 3 (paused nel padre) -> azzerata a pending nel figlio
    expect(child.phases[2].status).toBe('pending');
    expect(child.phases[2].workPeriods).toEqual([]);
    expect(child.phases[2].pauseReason).toBeUndefined();
  });

  it('mapPhasesForSplitChild pulisce startDate, endDate, operatorId e metrics sulle fasi non completate', () => {
    const mapped = mapPhasesForSplitChild([
      {
        id: 'p1',
        name: 'Taglio',
        status: 'completed',
        materialReady: true,
        workPeriods: [{ start: '2026-11-10T08:00:00Z', end: '2026-11-10T09:00:00Z', operatorId: 'op1' }],
        sequence: 1,
        materialConsumptions: [],
        departmentCodes: ['MAG'],
        ...({ operatorId: 'op1', startDate: '2026-11-10', endDate: '2026-11-10' } as any),
      },
      {
        id: 'p2',
        name: 'Cablaggio',
        status: 'in-progress',
        materialReady: true,
        workPeriods: [{ start: '2026-11-10T09:00:00Z', end: null, operatorId: 'op2' }],
        sequence: 2,
        materialConsumptions: [],
        departmentCodes: ['CP'],
        ...({ operatorId: 'op2', startDate: '2026-11-10', endDate: '2026-11-10', metrics: { speed: 1 } } as any),
      },
    ]);

    expect(mapped[0].status).toBe('completed');
    expect((mapped[0] as any).operatorId).toBe('op1');
    expect((mapped[0] as any).startDate).toBe('2026-11-10');

    expect(mapped[1].status).toBe('pending');
    expect(mapped[1].workPeriods).toEqual([]);
    expect((mapped[1] as any).operatorId).toBeUndefined();
    expect((mapped[1] as any).startDate).toBeUndefined();
    expect((mapped[1] as any).endDate).toBeUndefined();
    expect((mapped[1] as any).metrics).toBeUndefined();
  });
});
