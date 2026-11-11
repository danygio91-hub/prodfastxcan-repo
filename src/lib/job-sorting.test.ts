import { describe, it, expect } from 'vitest';
import { STATUS_WEIGHTS, getJobStatusPriority, defaultJobStatusComparator } from './job-sorting';
import type { JobOrder } from '@/types';

describe('FASE 71: Ordinamento Gerarchico Automatico Stato Commessa', () => {
  const makeJob = (overrides: Partial<JobOrder>): JobOrder => ({
    id: 'job-1',
    ordinePF: '001/PF',
    cliente: 'CLIENTE A',
    department: 'CP',
    details: 'ART-01',
    qta: 10,
    postazioneLavoro: 'P1',
    dataConsegnaFinale: '2026-11-20',
    phases: [],
    status: 'Pianificata',
    ...overrides,
  });

  describe('Mappa di priorità e getJobStatusPriority', () => {
    it('assegna priorità 1 a commesse Pianificate', () => {
      const j1 = makeJob({ status: 'Pianificata' });
      const j2 = makeJob({ status: 'PIANIFICATO' });
      const j3 = makeJob({ status: 'planned' });
      const j4 = makeJob({ status: undefined }); // default backlog

      expect(getJobStatusPriority(j1)).toBe(1);
      expect(getJobStatusPriority(j2)).toBe(1);
      expect(getJobStatusPriority(j3)).toBe(1);
      expect(getJobStatusPriority(j4)).toBe(1);
    });

    it('assegna priorità 2 a commesse DA_INIZIARE, IN_PREPARAZIONE e PRONTO_PROD', () => {
      const j1 = makeJob({ status: 'DA_INIZIARE' });
      const j2 = makeJob({
        status: 'IN_PREPARAZIONE',
        phases: [{ id: '1', name: 'Prep', type: 'preparation', status: 'in-progress', sequence: 1, materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [] }],
      });

      expect(getJobStatusPriority(j1)).toBe(2);
      expect(getJobStatusPriority(j2)).toBe(2);
    });

    it('assegna priorità 3 a commesse IN_PRODUZIONE', () => {
      const j1 = makeJob({
        status: 'IN_PRODUZIONE',
        phases: [{ id: '1', name: 'Montaggio', type: 'production', status: 'in-progress', sequence: 1, materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [] }],
      });

      expect(getJobStatusPriority(j1)).toBe(3);
    });

    it('assegna priorità 4 a commesse FINE_PRODUZIONE e QLTY_PACK (Completati prod)', () => {
      const j1 = makeJob({
        status: 'FINE_PRODUZIONE',
        phases: [{ id: '1', name: 'Taglio', type: 'production', status: 'completed', sequence: 1, materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [] }],
      });
      const j2 = makeJob({ status: 'Completato Prod.' });

      expect(getJobStatusPriority(j1)).toBe(4);
      expect(getJobStatusPriority(j2)).toBe(4);
    });

    it('assegna priorità 5 a commesse SPEDITO e CHIUSO (in fondo assoluto)', () => {
      const j1 = makeJob({ status: 'Spedito' });
      const j2 = makeJob({ status: 'CHIUSO' });
      const j3 = makeJob({ packingListId: 'PL-12345' });

      expect(getJobStatusPriority(j1)).toBe(5);
      expect(getJobStatusPriority(j2)).toBe(5);
      expect(getJobStatusPriority(j3)).toBe(5);
    });

    it('assegna peso intermedio 2.5 a stati non riconosciuti o non mappati', () => {
      const j = makeJob({ status: 'STATO_SCONOSCIUTO_CUSTOM' as any });
      expect(getJobStatusPriority(j)).toBe(2.5);
    });
  });

  describe('defaultJobStatusComparator', () => {
    it('ordina rigorosamente per gerarchia di stato (1 -> 2 -> 3 -> 4 -> 5)', () => {
      const jobPianificata = makeJob({ id: '1', status: 'Pianificata' });
      const jobDaIniziare = makeJob({ id: '2', status: 'DA_INIZIARE' });
      const jobInProd = makeJob({
        id: '3',
        status: 'IN_PRODUZIONE',
        phases: [{ id: '1', name: 'Lavoro', type: 'production', status: 'in-progress', sequence: 1, materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [] }],
      });
      const jobFineProd = makeJob({ id: '4', status: 'Completato Prod.' });
      const jobSpedito = makeJob({ id: '5', status: 'Spedito' });

      const list = [jobSpedito, jobInProd, jobPianificata, jobFineProd, jobDaIniziare];
      list.sort(defaultJobStatusComparator);

      expect(list.map((j) => j.id)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('a parità di stato, ordina secondariamente per Data Consegna (più urgenti prima)', () => {
      const jobPianificataUrgente = makeJob({ id: 'p1', status: 'Pianificata', dataConsegnaFinale: '2026-11-15' });
      const jobPianificataMenoUrgente = makeJob({ id: 'p2', status: 'Pianificata', dataConsegnaFinale: '2026-11-28' });
      const jobPianificataSenzaData = makeJob({ id: 'p3', status: 'Pianificata', dataConsegnaFinale: '' });

      const list = [jobPianificataSenzaData, jobPianificataMenoUrgente, jobPianificataUrgente];
      list.sort(defaultJobStatusComparator);

      expect(list.map((j) => j.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('a parità di stato e data, ordina terziariamente per numero ODL / Ordine PF', () => {
      const jobA = makeJob({ id: 'a', status: 'Pianificata', dataConsegnaFinale: '2026-11-20', ordinePF: '010/PF' });
      const jobB = makeJob({ id: 'b', status: 'Pianificata', dataConsegnaFinale: '2026-11-20', ordinePF: '002/PF' });

      const list = [jobA, jobB];
      list.sort(defaultJobStatusComparator);

      expect(list.map((j) => j.id)).toEqual(['b', 'a']);
    });
  });
});
