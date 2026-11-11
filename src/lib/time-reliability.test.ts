import { describe, it, expect } from 'vitest';
import { getTimeReliabilityStatus, getTimeReliabilityMeta, calculateJobHours } from './time-reliability';
import type { JobOrder, Article } from '@/types';

describe('FASE 69: getTimeReliabilityStatus & calculateJobHours', () => {
  const baseJob: JobOrder = {
    id: 'JOB-001',
    ordinePF: 'PF123',
    cliente: 'ACME',
    department: 'CP',
    details: 'ART-01',
    qta: 10,
    postazioneLavoro: 'P1',
    dataConsegnaFinale: '2026-11-20',
    phases: [],
    status: 'Pianificata',
  };

  describe('Stato MISSING (Rosso)', () => {
    it('restituisce MISSING se job è undefined o nullo', () => {
      expect(getTimeReliabilityStatus(null as any)).toBe('MISSING');
      expect(getTimeReliabilityStatus(undefined as any)).toBe('MISSING');
    });

    it('restituisce MISSING se il tempo totale previsto è 0 e le fasi non hanno tempi', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 0,
        phases: [
          { id: '1', name: 'Taglio', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 0 },
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('MISSING');
    });

    it('restituisce MISSING se la quantità è 0 anche se sono definiti minuti per pezzo', () => {
      const job: JobOrder = {
        ...baseJob,
        qta: 0,
        expectedMinutesDefault: 10,
      };
      expect(getTimeReliabilityStatus(job)).toBe('MISSING');
    });
  });

  describe('Stato COMPLETE (Verde)', () => {
    it('restituisce COMPLETE quando expectedMinutesDefault coincide esattamente con la somma delle fasi attive e non ci sono target mancanti', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 10,
        phases: [
          { id: '1', name: 'Taglio', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 4 },
          { id: '2', name: 'Aggraffatura', sequence: 2, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 6 },
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('COMPLETE');
    });

    it('restituisce COMPLETE con targetTime esplicito su fasi con isActive === true', () => {
      const job: any = {
        ...baseJob,
        targetTime: 15,
        phases: [
          { id: '1', name: 'Taglio', targetTime: 5, isActive: true },
          { id: '2', name: 'Saldatura', targetTime: 10, isActive: true },
          { id: '3', name: 'Collaudo', targetTime: 99, isActive: false }, // Fase non attiva esclusa
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('COMPLETE');
    });

    it('restituisce COMPLETE gestendo la tolleranza per i float', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 10,
        phases: [
          { id: '1', name: 'P1', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 3.333 },
          { id: '2', name: 'P2', sequence: 2, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 3.333 },
          { id: '3', name: 'P3', sequence: 3, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 3.334 },
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('COMPLETE');
    });

    it('restituisce COMPLETE se expectedMinutesDefault non è impostato ma le fasi attive hanno tutte target validi', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 0,
        phases: [
          { id: '1', name: 'Taglio', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 5 },
          { id: '2', name: 'Collaudo', sequence: 2, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 5 },
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('COMPLETE');
    });
  });

  describe('Stato MANUAL (Blu/Azzurro)', () => {
    it('restituisce MANUAL se il tempo totale previsto è un override manuale (diverso dalla somma fasi)', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 20, // Override manuale: 20 vs 10 somma fasi
        phases: [
          { id: '1', name: 'Taglio', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 4 },
          { id: '2', name: 'Aggraffatura', sequence: 2, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 6 },
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('MANUAL');
    });

    it('restituisce MANUAL se ci sono fasi attive senza target temporale (target 0 o null - ciclo parziale)', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 10,
        phases: [
          { id: '1', name: 'Taglio', sequence: 1, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 10 },
          { id: '2', name: 'Collaudo', sequence: 2, status: 'pending', materialReady: true, workPeriods: [], materialConsumptions: [], departmentCodes: [], expectedMinutesPerPiece: 0 }, // target mancante
        ],
      };
      expect(getTimeReliabilityStatus(job)).toBe('MANUAL');
    });

    it('restituisce MANUAL se ci sono target totali ma nessuna fase attiva (stima manuale senza ciclo)', () => {
      const job: JobOrder = {
        ...baseJob,
        expectedMinutesDefault: 15,
        phases: [],
      };
      expect(getTimeReliabilityStatus(job)).toBe('MANUAL');
    });
  });

  describe('getTimeReliabilityMeta', () => {
    it('restituisce configurazione grafica corretta per ogni stato', () => {
      const completeMeta = getTimeReliabilityMeta('COMPLETE');
      expect(completeMeta.colorClass).toBe('text-emerald-500');
      expect(completeMeta.title).toBe('Tempo calcolato esattamente dalla somma del ciclo fasi');

      const manualMeta = getTimeReliabilityMeta('MANUAL');
      expect(manualMeta.colorClass).toBe('text-cyan-500');
      expect(manualMeta.title).toBe('Stima manuale o ciclo fasi incompleto');

      const missingMeta = getTimeReliabilityMeta('MISSING');
      expect(missingMeta.colorClass).toBe('text-red-500');
      expect(missingMeta.title).toBe('Tempi mancanti in anagrafica');
    });
  });
});

