import { describe, it, expect } from 'vitest';
import {
  isJobEligibleForArticleSync,
  computeArticleCycleSyncForJob,
} from './article-cycle-sync';
import type { Article, JobOrder, WorkCycle, WorkPhaseTemplate } from '@/types';

const makeJob = (overrides: Partial<JobOrder> = {}): JobOrder => ({
  id: 'job-1',
  ordinePF: '001/26',
  cliente: 'CLIENTE TEST',
  department: 'CP',
  details: 'ART-100',
  qta: 100,
  postazioneLavoro: '',
  dataConsegnaFinale: '2026-12-01',
  phases: [],
  status: 'Pianificata',
  ...overrides,
});

const templates: WorkPhaseTemplate[] = [
  {
    id: 'tpl-prep',
    name: 'Taglio Prep',
    description: 'Preparazione materiali',
    departmentCodes: ['CP'],
    sequence: 1,
    type: 'preparation',
    tracksTime: true,
    isIndependent: false,
  },
  {
    id: 'tpl-prod',
    name: 'Stampaggio',
    description: 'Produzione principale',
    departmentCodes: ['CP'],
    sequence: 2,
    type: 'production',
    tracksTime: true,
    requiresMaterialScan: true,
  },
  {
    id: 'tpl-qc',
    name: 'Controllo Qualità',
    description: 'Controllo finale',
    departmentCodes: ['CP'],
    sequence: 3,
    type: 'qlty_pack',
    tracksTime: true,
  },
];

const cycles: WorkCycle[] = [
  {
    id: 'cyc-cp-std',
    name: 'Ciclo Standard CP',
    description: 'Preparazione + Stampaggio + QC',
    phaseTemplateIds: ['tpl-prep', 'tpl-prod', 'tpl-qc'],
    phaseWeights: [1, 3, 1],
  },
];

describe('FASE 95: Propagazione Globale Tempi/Cicli su Commesse Attive', () => {
  describe('isJobEligibleForArticleSync', () => {
    it('include commesse Pianificate, Avviate e In Produzione (anche con odlCreationDate o fasi attive)', () => {
      expect(isJobEligibleForArticleSync(makeJob({ status: 'Pianificata' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'PIANIFICATA' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'DA_INIZIARE', odlCreationDate: '2026-11-11T10:00:00Z' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'IN_PREPARAZIONE' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'PRONTO_PROD' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'IN_PRODUZIONE' }))).toBe(true);
      expect(isJobEligibleForArticleSync(makeJob({ status: 'In Produzione' }))).toBe(true);
    });

    it('esclude solo le commesse Concluse, Spedite o Chiuse', () => {
      const concludedStatuses = [
        'FINE_PRODUZIONE',
        'SPEDITO',
        'SPEDITA',
        'SHIPPED',
        'CHIUSO',
        'CLOSED',
        'COMPLETATO',
        'COMPLETATO PROD.',
        'completed',
        'CONCLUSA',
      ];

      for (const status of concludedStatuses) {
        expect(isJobEligibleForArticleSync(makeJob({ status })), `stato ${status}`).toBe(false);
      }

      expect(
        isJobEligibleForArticleSync(makeJob({ status: 'IN_PRODUZIONE', forcedCompletion: true }))
      ).toBe(false);
      expect(
        isJobEligibleForArticleSync(makeJob({ status: 'IN_PRODUZIONE', overallEndTime: '2026-11-18T10:00:00Z' }))
      ).toBe(false);
    });
  });

  describe('computeArticleCycleSyncForJob', () => {
    it('popola job.phases da un WorkCycle su commessa pianificata nata senza ciclo (phases = [])', () => {
      const jobWithoutCycle = makeJob({
        status: 'Pianificata',
        phases: [],
        workCycleId: '',
        expectedMinutesDefault: 0,
      });

      const updatedArticle: Partial<Article> = {
        id: 'ART-100',
        code: 'ART-100',
        workCycleId: 'cyc-cp-std',
        expectedMinutesDefault: 4.5,
        phaseTimes: {
          'tpl-prep': { expectedMinutesPerPiece: 1.0, detectedMinutesPerPiece: 0, enabled: true },
          'tpl-prod': { expectedMinutesPerPiece: 2.5, detectedMinutesPerPiece: 0, enabled: true },
          'tpl-qc': { expectedMinutesPerPiece: 1.0, detectedMinutesPerPiece: 0, enabled: true },
        },
      };

      const res = computeArticleCycleSyncForJob({
        job: jobWithoutCycle,
        article: updatedArticle,
        workCycles: cycles,
        phaseTemplates: templates,
      });

      expect(res.changed).toBe(true);
      expect(res.workCycleId).toBe('cyc-cp-std');
      expect(res.expectedMinutesDefault).toBe(4.5);
      expect(res.phases).toHaveLength(3);
      expect(res.phases.map((p) => p.id)).toEqual(['tpl-prep', 'tpl-prod', 'tpl-qc']);
      expect(res.phases.map((p) => p.sequence)).toEqual([1, 2, 3]);
      expect(res.phases.map((p) => p.theoreticalWeight)).toEqual([1, 3, 1]);
      expect(res.phases.map((p) => p.expectedMinutesPerPiece)).toEqual([1.0, 2.5, 1.0]);

      // Nessun campo undefined ammesso in Firestore payload
      for (const phase of res.phases) {
        Object.values(phase).forEach((val) => {
          expect(val).not.toBeUndefined();
        });
      }
    });

    it('popola job.phases in modalità Manuale usando le sole fasi abilitate (enabled !== false)', () => {
      const jobWithoutCycle = makeJob({ phases: [], workCycleId: 'manual' });
      const manualArticle: Partial<Article> = {
        id: 'ART-100',
        code: 'ART-100',
        workCycleId: 'manual',
        expectedMinutesDefault: 3,
        phaseTimes: {
          'tpl-prep': { expectedMinutesPerPiece: 1, detectedMinutesPerPiece: 0, enabled: false },
          'tpl-prod': { expectedMinutesPerPiece: 2, detectedMinutesPerPiece: 0, enabled: true },
          'tpl-qc': { expectedMinutesPerPiece: 1, detectedMinutesPerPiece: 0, enabled: true },
        },
      };

      const res = computeArticleCycleSyncForJob({
        job: jobWithoutCycle,
        article: manualArticle,
        workCycles: cycles,
        phaseTemplates: templates,
      });

      expect(res.changed).toBe(true);
      expect(res.workCycleId).toBe('manual');
      expect(res.phases.map((p) => p.id)).toEqual(['tpl-prod', 'tpl-qc']);
      expect(res.phases.map((p) => p.sequence)).toEqual([1, 2]);
      expect(res.phases.map((p) => p.expectedMinutesPerPiece)).toEqual([2, 1]);
    });

    it('utilizza il ciclo secondario quando la commessa era già associata a secondaryWorkCycleId', () => {
      const secondaryCycle: WorkCycle = {
        id: 'cyc-sec',
        name: 'Ciclo Alternativo',
        description: 'Solo Stampaggio',
        phaseTemplateIds: ['tpl-prod'],
        phaseWeights: [1],
      };

      const jobOnSecondary = makeJob({
        status: 'PIANIFICATA',
        workCycleId: 'cyc-sec',
        phases: [],
        expectedMinutesDefault: 0,
      });

      const article: Partial<Article> = {
        id: 'ART-100',
        code: 'ART-100',
        workCycleId: 'cyc-cp-std',
        secondaryWorkCycleId: 'cyc-sec',
        expectedMinutesDefault: 4.5,
        expectedMinutesSecondary: 6.0,
        phaseTimes: {
          'tpl-prod': { expectedMinutesPerPiece: 2.5, detectedMinutesPerPiece: 0, enabled: true },
        },
        phaseTimesSecondary: {
          'tpl-prod': { expectedMinutesPerPiece: 6.0, detectedMinutesPerPiece: 0, enabled: true },
        },
      };

      const res = computeArticleCycleSyncForJob({
        job: jobOnSecondary,
        article,
        workCycles: [...cycles, secondaryCycle],
        phaseTemplates: templates,
      });

      expect(res.changed).toBe(true);
      expect(res.workCycleId).toBe('cyc-sec');
      expect(res.expectedMinutesDefault).toBe(6.0);
      expect(res.phases).toHaveLength(1);
      expect(res.phases[0].id).toBe('tpl-prod');
      expect(res.phases[0].expectedMinutesPerPiece).toBe(6.0);
    });

    it('FASE 101: preserva il reparto esistente sulla commessa anche quando l\'articolo ha un defaultDepartmentId diverso', () => {
      const jobWithManualDeptOverride = makeJob({
        id: 'job-override-dept',
        department: 'BF',
        status: 'Pianificata',
        workCycleId: 'cyc-cp-std',
        phases: [],
      });

      const articleWithDefaultDept: Partial<Article> = {
        id: 'ART-100',
        code: 'ART-100',
        defaultDepartmentId: 'CG',
        defaultDepartmentCode: 'CG',
        department: 'CG',
        workCycleId: 'cyc-cp-std',
        expectedMinutesDefault: 4.5,
      };

      const res = computeArticleCycleSyncForJob({
        job: jobWithManualDeptOverride,
        article: articleWithDefaultDept,
        workCycles: cycles,
        phaseTemplates: templates,
      });

      expect('department' in res).toBe(false);
      expect(jobWithManualDeptOverride.department).toBe('BF');
    });
  });
});

