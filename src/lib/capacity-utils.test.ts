import { describe, it, expect } from 'vitest';
import type { JobOrder } from '@/types';
import {
  getJobDepartmentGroup,
  aggregateCompanyCapacity,
  filterJobsForCapacityMetrics,
  isCapacityPeriodAtOrAfter,
  resolveBucketWithBaseline,
} from './capacity-utils';

describe('FASE 92: Reparto MAG, Esclusione Aggregato TUTTI e Propagazione Baseline', () => {
  it('classifica correttamente commesse MAG tramite department o fasi', () => {
    expect(getJobDepartmentGroup({ department: 'MAG' } as JobOrder)).toBe('MAG');
    expect(getJobDepartmentGroup({ department: 'Magazzino Spedizioni' } as JobOrder)).toBe('MAG');
    expect(
      getJobDepartmentGroup({
        department: '',
        phases: [{ name: 'Prelievo Magazzino', departmentCodes: ['MAG'] } as any],
      } as JobOrder)
    ).toBe('MAG');
    expect(getJobDepartmentGroup({ department: 'CP' } as JobOrder)).toBe('CP');
    expect(getJobDepartmentGroup({ department: 'CG' } as JobOrder)).toBe('CG');
    expect(getJobDepartmentGroup({ department: 'BF' } as JobOrder)).toBe('BF');
  });

  it('esclude MAG dall aggregato addetti/ore disponibili quando filtro è TUTTI (somma solo CP + CG + BF)', () => {
    const capacities = {
      'CP_2026_W47': { L: 2, M: 2, Me: 2, G: 2, V: 2, overtime: 4 },
      'CG_2026_W47': { L: 3, M: 3, Me: 3, G: 3, V: 3, overtime: 2 },
      'BF_2026_W47': { L: 1, M: 1, Me: 1, G: 1, V: 1, overtime: 0 },
      'MAG_2026_W47': { L: 5, M: 5, Me: 5, G: 5, V: 5, overtime: 10 },
    };

    const agg = aggregateCompanyCapacity(capacities, 2026, 47);
    expect(agg).toEqual({ L: 6, M: 6, Me: 6, G: 6, V: 6, overtime: 6 });
  });

  it('esclude commesse MAG dal calcolo carico/saturazione in filtro TUTTI ma le mantiene in tab MAG', () => {
    const jobs = [
      { id: '1', department: 'CP' },
      { id: '2', department: 'CG' },
      { id: '3', department: 'BF' },
      { id: '4', department: 'MAG' },
      { id: '5', department: 'OTHER_CUSTOM' },
    ] as JobOrder[];

    const metricsAll = filterJobsForCapacityMetrics(jobs, 'ALL');
    expect(metricsAll.map((j) => j.id)).toEqual(['1', '2', '3']);

    const metricsMag = filterJobsForCapacityMetrics(
      jobs.filter((j) => getJobDepartmentGroup(j) === 'MAG'),
      'MAG'
    );
    expect(metricsMag.map((j) => j.id)).toEqual(['4']);
  });

  it('risolve correttamente settimane vuote future da settings/default_capacity preservando il passato', () => {
    expect(isCapacityPeriodAtOrAfter(2026, 47, 2026, 47)).toBe(true);
    expect(isCapacityPeriodAtOrAfter(2026, 48, 2026, 47)).toBe(true);
    expect(isCapacityPeriodAtOrAfter(2027, 1, 2026, 47)).toBe(true);
    expect(isCapacityPeriodAtOrAfter(2026, 46, 2026, 47)).toBe(false);
    expect(isCapacityPeriodAtOrAfter(2025, 52, 2026, 47)).toBe(false);

    const baseline = {
      L: 4,
      M: 4,
      Me: 4,
      G: 4,
      V: 3,
      overtime: 0,
      effectiveFromYear: 2026,
      effectiveFromWeek: 47,
    };

    // Settimana futura vuota -> eredita baseline
    expect(resolveBucketWithBaseline(undefined, baseline, 2026, 49)).toEqual({
      L: 4,
      M: 4,
      Me: 4,
      G: 4,
      V: 3,
      overtime: 0,
    });

    // Settimana passata vuota -> NON retroattiva
    expect(resolveBucketWithBaseline(undefined, baseline, 2026, 45)).toBeUndefined();

    // Settimana già salvata -> preservata integralmente
    const stored = { L: 2, M: 2, Me: 2, G: 2, V: 2, overtime: 5 };
    expect(resolveBucketWithBaseline(stored, baseline, 2026, 45)).toEqual(stored);
  });
});

