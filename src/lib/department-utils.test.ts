import { describe, it, expect } from 'vitest';
import {
  NO_DEPARTMENT_VALUE,
  buildDepartmentOptions,
  getArticleDefaultDepartment,
  normalizeDepartmentCode,
  resolveDepartmentForNewJob,
} from './department-utils';
import type { Article, Department } from '@/types';

const SAMPLE_DEPARTMENTS: Department[] = [
  { id: 'CP', code: 'CP', name: 'Connessioni Piccole', macroAreas: ['PRODUZIONE'] },
  { id: 'CG', code: 'CG', name: 'Connessioni Grandi', macroAreas: ['PRODUZIONE'] },
  { id: 'BF', code: 'BF', name: 'Reparto Barre', macroAreas: ['PRODUZIONE'] },
  { id: 'MAG', code: 'MAG', name: 'Magazzino', macroAreas: ['PREPARAZIONE'] },
  { id: 'PREP', code: 'PREP', name: 'Preparazione Materiali', macroAreas: ['PREPARAZIONE'] },
];

describe('FASE 101: Helper SSoT Reparto Predefinito Articolo & Override Commessa', () => {
  it('normalizza codici, nomi italiani, spazi, oggetti Department e marcatori vuoti', () => {
    expect(normalizeDepartmentCode('cg', SAMPLE_DEPARTMENTS)).toBe('CG');
    expect(normalizeDepartmentCode('  Connessioni Grandi  ', SAMPLE_DEPARTMENTS)).toBe('CG');
    expect(normalizeDepartmentCode('Reparto Barre', SAMPLE_DEPARTMENTS)).toBe('BF');
    expect(normalizeDepartmentCode('Magazzino', SAMPLE_DEPARTMENTS)).toBe('MAG');
    expect(normalizeDepartmentCode(SAMPLE_DEPARTMENTS[0])).toBe('CP');

    expect(normalizeDepartmentCode('')).toBe('');
    expect(normalizeDepartmentCode('N/D')).toBe('');
    expect(normalizeDepartmentCode(NO_DEPARTMENT_VALUE)).toBe('');
    expect(normalizeDepartmentCode('Nessuno')).toBe('');
    expect(normalizeDepartmentCode(null)).toBe('');
    expect(normalizeDepartmentCode(undefined)).toBe('');
  });

  it('costruisce opzioni dinamiche includendo sempre i reparti aziendali CP, CG, BF, MAG', () => {
    const opts = buildDepartmentOptions(SAMPLE_DEPARTMENTS);
    expect(opts.map((o) => o.value)).toEqual(['CP', 'CG', 'BF', 'MAG']);
    expect(opts.find((o) => o.value === 'CG')?.label).toBe('CG — Connessioni Grandi');

    const fallbackOpts = buildDepartmentOptions([]);
    expect(fallbackOpts.map((o) => o.value)).toEqual(['CP', 'CG', 'BF', 'MAG']);
  });

  it('legge il reparto predefinito da defaultDepartmentId > defaultDepartmentCode > department', () => {
    const artPrimary: Partial<Article> = {
      code: 'ART-1',
      defaultDepartmentId: 'cg',
      defaultDepartmentCode: 'BF',
      department: 'CP',
    };
    expect(getArticleDefaultDepartment(artPrimary, SAMPLE_DEPARTMENTS)).toBe('CG');

    const artLegacyOnly: Partial<Article> = {
      code: 'ART-2',
      department: 'Connessioni Grandi',
    };
    expect(getArticleDefaultDepartment(artLegacyOnly, SAMPLE_DEPARTMENTS)).toBe('CG');

    const artUnset: Partial<Article> = {
      code: 'ART-3',
      defaultDepartmentId: null,
      department: '',
    };
    expect(getArticleDefaultDepartment(artUnset, SAMPLE_DEPARTMENTS)).toBe('');
  });

  it('risolve il reparto per nuove commesse garantendo override esplicito > default articolo > retrocompatibilità fallback', () => {
    const articleWithCG: Partial<Article> = {
      code: 'ART-CG',
      defaultDepartmentId: 'CG',
      defaultDepartmentCode: 'CG',
    };
    const articleWithoutDept: Partial<Article> = {
      code: 'ART-LEGACY',
    };

    // 1. Pre-compilazione da articolo quando non c'è valore esplicito (es. Excel senza colonna Reparto)
    expect(
      resolveDepartmentForNewJob({
        explicitDepartment: undefined,
        article: articleWithCG,
        departments: SAMPLE_DEPARTMENTS,
        fallback: 'N/D',
      })
    ).toBe('CG');

    expect(
      resolveDepartmentForNewJob({
        explicitDepartment: 'N/D',
        article: articleWithCG,
        departments: SAMPLE_DEPARTMENTS,
        fallback: 'CP',
      })
    ).toBe('CG');

    // 2. Override esplicito utente / cella Excel vince sul default articolo
    expect(
      resolveDepartmentForNewJob({
        explicitDepartment: 'BF',
        article: articleWithCG,
        departments: SAMPLE_DEPARTMENTS,
        fallback: 'CP',
      })
    ).toBe('BF');

    // 3. Retrocompatibilità: articolo privo di reparto predefinito mantiene fallback precedente
    expect(
      resolveDepartmentForNewJob({
        explicitDepartment: undefined,
        article: articleWithoutDept,
        departments: SAMPLE_DEPARTMENTS,
        fallback: 'CP',
      })
    ).toBe('CP');
    expect(
      resolveDepartmentForNewJob({
        explicitDepartment: '',
        article: articleWithoutDept,
        departments: SAMPLE_DEPARTMENTS,
        fallback: 'N/D',
      })
    ).toBe('N/D');
  });
});
