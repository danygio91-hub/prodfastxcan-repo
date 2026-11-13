import { describe, expect, it } from 'vitest';
import {
  computeNextChildOrdinePF,
  computeSplitJobPayloads,
  extractBaseOrdinePF,
  resetPhasesForSplitChild,
} from './job-split-logic';
import type { JobOrder } from '@/types';

describe('job-split-logic (FASE 83)', () => {
  it('extractBaseOrdinePF rimuove eventuali suffissi _1, _2 mantenendo intatto il codice base', () => {
    expect(extractBaseOrdinePF('860/PF.6')).toBe('860/PF.6');
    expect(extractBaseOrdinePF('860/PF.6_1')).toBe('860/PF.6');
    expect(extractBaseOrdinePF('860/PF.6_12')).toBe('860/PF.6');
  });

  it('computeNextChildOrdinePF genera _1 se non esistono figli e incrementa a _2, _3 se esistono', () => {
    expect(computeNextChildOrdinePF('860/PF.6', [])).toEqual({
      childOrdinePF: '860/PF.6_1',
      suffixNumber: 1,
    });

    expect(
      computeNextChildOrdinePF('860/PF.6', ['860/PF.6_1', '860-PF.6_2'])
    ).toEqual({
      childOrdinePF: '860/PF.6_3',
      suffixNumber: 3,
    });

    // Anche partendo da un figlio _1 genera correttamente il fratello successivo _2
    expect(computeNextChildOrdinePF('860/PF.6_1', ['860/PF.6_1'])).toEqual({
      childOrdinePF: '860/PF.6_2',
      suffixNumber: 2,
    });
  });

  it('valida che la somma delle quantità coincida con la quantità originale', () => {
    const baseJob: JobOrder = {
      id: '860-PF.6_2026',
      ordinePF: '860/PF.6',
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
      childId: '860-PF.6_1_2026',
      childOrdinePF: '860/PF.6_1',
    });
    expect(invalidSum.valid).toBe(false);
    expect(invalidSum.error).toContain('1000');

    const invalidZero = computeSplitJobPayloads({
      originalJob: baseJob,
      newQuantityOriginal: 1000,
      newQuantityChild: 0,
      childId: '860-PF.6_1_2026',
      childOrdinePF: '860/PF.6_1',
    });
    expect(invalidZero.valid).toBe(false);
  });

  it('ricalcola proporzionalmente qta, orePreviste, BOM e azzera fasi/stato sulla commessa figlia', () => {
    const baseJob: JobOrder = {
      id: '860-PF.6_2026',
      ordinePF: '860/PF.6',
      cliente: 'TEST SRL',
      details: 'E60025',
      department: 'CP',
      qta: 1000,
      qtaRichiesta: 1000,
      expectedMinutesDefault: 0.6, // 0.6 min/pz * 1000 = 600 min = 10.0 ore
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
          name: 'Preparazione Tubi',
          status: 'completed',
          materialReady: true,
          workPeriods: [{ start: '2026-11-10T08:00:00Z', end: '2026-11-10T09:00:00Z', operatorId: 'op-1' }],
          sequence: 1,
          type: 'preparation',
          materialConsumptions: [{ materialId: 'm1', materialCode: 'TUBO-1' }],
          departmentCodes: ['MAG'],
          qualityResult: 'passed',
          forced: true,
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
      ],
      billOfMaterials: [
        {
          component: 'TUBO-1',
          unit: 'mt',
          quantity: 1,
          status: 'withdrawn',
          withdrawn: true,
          isFromTemplate: true,
          fabbisognoTotale: 500,
          pesoStimato: 100,
        },
      ],
    };

    const res = computeSplitJobPayloads({
      originalJob: baseJob,
      newQuantityOriginal: 700,
      newQuantityChild: 300,
      childId: '860-PF.6_1_2026',
      childOrdinePF: '860/PF.6_1',
    });

    expect(res.valid).toBe(true);
    expect(res.splitCoefficient).toBeCloseTo(0.7);
    expect(res.complementaryCoefficient).toBeCloseTo(0.3);
    expect(res.orePrevisteOriginal).toBe(7);
    expect(res.orePrevisteChild).toBe(3);

    // Verifica update originale
    expect(res.originalUpdatePayload?.qta).toBe(700);
    expect(res.originalUpdatePayload?.qtaRichiesta).toBe(700);
    expect(res.originalUpdatePayload?.orePreviste).toBe(7);
    expect(res.originalUpdatePayload?.billOfMaterials?.[0]?.fabbisognoTotale).toBe(350);
    expect(res.originalUpdatePayload?.billOfMaterials?.[0]?.pesoStimato).toBe(70);

    // Verifica commessa figlia clonata
    const child = res.childJobPayload!;
    expect(child.id).toBe('860-PF.6_1_2026');
    expect(child.ordinePF).toBe('860/PF.6_1');
    expect(child.qta).toBe(300);
    expect(child.qtaRichiesta).toBe(300);
    expect(child.orePreviste).toBe(3);
    expect(child.status).toBe('Pianificata');
    expect(child.numeroODL).toBeNull();
    expect(child.numeroODLInterno).toBeNull();
    expect(child.isPrinted).toBe(false);
    expect(child.odlPrinted).toBe(false);
    expect(child.phases).toHaveLength(2);
    expect(child.phases[0].status).toBe('pending');
    expect(child.phases[0].workPeriods).toEqual([]);
    expect(child.phases[0].materialConsumptions).toEqual([]);
    expect(child.phases[0].materialReady).toBe(true); // preparation phase
    expect(child.phases[1].status).toBe('pending');
    expect(child.phases[1].workPeriods).toEqual([]);
    expect(child.phases[1].materialReady).toBe(false); // production phase
    expect(child.billOfMaterials?.[0]?.fabbisognoTotale).toBe(150);
    expect(child.billOfMaterials?.[0]?.pesoStimato).toBe(30);
    expect(child.billOfMaterials?.[0]?.status).toBe('pending');
    expect(child.billOfMaterials?.[0]?.withdrawn).toBe(false);
  });

  it('resetPhasesForSplitChild rimuove timestamp e operatori da fasi completate o in corso', () => {
    const reset = resetPhasesForSplitChild([
      {
        id: 'p1',
        name: 'Collaudo',
        status: 'completed',
        materialReady: true,
        workPeriods: [{ start: new Date(), end: new Date(), operatorId: 'op1' }],
        sequence: 1,
        materialConsumptions: [],
        departmentCodes: ['QLTY'],
        pauseReason: 'Pausa pranzo',
      },
    ]);

    expect(reset[0].status).toBe('pending');
    expect(reset[0].workPeriods).toEqual([]);
    expect(reset[0].pauseReason).toBeUndefined();
  });
});
