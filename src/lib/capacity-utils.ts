import type { JobOrder } from '@/types';

export type MacroDepartmentCode = 'ALL' | 'CP' | 'CG' | 'BF' | 'MAG';
export type JobDepartmentGroup = 'CP' | 'CG' | 'BF' | 'MAG' | 'OTHER';

export const AGGREGATE_PRODUCTION_DEPTS: readonly ('CP' | 'CG' | 'BF')[] = ['CP', 'CG', 'BF'];
export const ALL_TRACKED_CAPACITY_DEPTS: readonly ('CP' | 'CG' | 'BF' | 'MAG')[] = ['CP', 'CG', 'BF', 'MAG'];

export interface DayCapacityConfigData {
  L: number;
  M: number;
  Me: number;
  G: number;
  V: number;
  overtime: number;
}

export interface DefaultCapacityBaselineData {
  L: number;
  M: number;
  Me: number;
  G: number;
  V: number;
  overtime?: number;
  effectiveFromYear?: number;
  effectiveFromWeek?: number;
}

export const EMPTY_CAPACITY_BUCKET: DayCapacityConfigData = {
  L: 0,
  M: 0,
  Me: 0,
  G: 0,
  V: 0,
  overtime: 0,
};

/**
 * Determina il gruppo macro-reparto (CP, CG, BF, MAG, OTHER) per una commessa.
 */
export function getJobDepartmentGroup(job: JobOrder): JobDepartmentGroup {
  const d = (job.department || '').toUpperCase().trim();
  if (d === 'CP' || d.includes('PICCOL') || d.includes('CONNESSIONI PICCOLE')) return 'CP';
  if (d === 'CG' || d.includes('GRAND') || d.includes('CONNESSIONI GRANDI')) return 'CG';
  if (d === 'BF' || d.includes('BARRE') || d.includes('REPARTO BARRE')) return 'BF';
  if (d === 'MAG' || d.includes('MAGAZZ')) return 'MAG';

  if (job.phases && job.phases.length > 0) {
    for (const p of job.phases) {
      const pDepts = (p.departmentCodes || []).map((c) => c.toUpperCase());
      const pName = (p.name || '').toUpperCase();
      if (pDepts.includes('CP') || pName.includes('PICCOL')) return 'CP';
      if (pDepts.includes('CG') || pName.includes('GRAND')) return 'CG';
      if (pDepts.includes('BF') || pName.includes('BARRE')) return 'BF';
      if (pDepts.includes('MAG') || pName.includes('MAGAZZ')) return 'MAG';
    }
  }

  return 'OTHER';
}

/**
 * Restituisce true se (targetYear, targetWeek) è uguale o successivo a (fromYear, fromWeek).
 */
export function isCapacityPeriodAtOrAfter(
  targetYear: number,
  targetWeek: number,
  fromYear: number,
  fromWeek: number
): boolean {
  if (targetYear > fromYear) return true;
  if (targetYear < fromYear) return false;
  return targetWeek >= fromWeek;
}

/**
 * Risolve la capacità settimanale per un reparto:
 * - Se esiste un record esplicito salvato in capacityBuckets, lo preserva.
 * - Altrimenti (settimana futura vuota), legge la baseline da settings/default_capacity_${reparto}
 *   se il periodo è >= alla settimana di decorrenza (o se non è impostato alcun limite).
 */
export function resolveBucketWithBaseline(
  storedBucket: DayCapacityConfigData | undefined,
  baseline: DefaultCapacityBaselineData | undefined,
  targetYear: number,
  targetWeek: number
): DayCapacityConfigData | undefined {
  if (storedBucket) {
    return storedBucket;
  }

  if (!baseline) {
    return undefined;
  }

  const hasEffectiveStart =
    typeof baseline.effectiveFromYear === 'number' &&
    typeof baseline.effectiveFromWeek === 'number';

  if (
    hasEffectiveStart &&
    !isCapacityPeriodAtOrAfter(
      targetYear,
      targetWeek,
      baseline.effectiveFromYear as number,
      baseline.effectiveFromWeek as number
    )
  ) {
    return undefined;
  }

  return {
    L: Math.max(0, Number(baseline.L) || 0),
    M: Math.max(0, Number(baseline.M) || 0),
    Me: Math.max(0, Number(baseline.Me) || 0),
    G: Math.max(0, Number(baseline.G) || 0),
    V: Math.max(0, Number(baseline.V) || 0),
    overtime: Math.max(0, Number(baseline.overtime) || 0),
  };
}

/**
 * Aggrega la capacità aziendale per il filtro "TUTTI" sommando ESCLUSIVAMENTE ['CP', 'CG', 'BF'],
 * escludendo esplicitamente MAG dal conteggio addetti e ore disponibili.
 */
export function aggregateCompanyCapacity(
  capacitiesByBucket: Record<string, DayCapacityConfigData>,
  year: number,
  week: number
): DayCapacityConfigData {
  const totals: DayCapacityConfigData = { ...EMPTY_CAPACITY_BUCKET };
  AGGREGATE_PRODUCTION_DEPTS.forEach((dept) => {
    const key = `${dept}_${year}_W${week}`;
    const cap = capacitiesByBucket[key] || EMPTY_CAPACITY_BUCKET;
    totals.L += cap.L || 0;
    totals.M += cap.M || 0;
    totals.Me += cap.Me || 0;
    totals.G += cap.G || 0;
    totals.V += cap.V || 0;
    totals.overtime += cap.overtime || 0;
  });
  return totals;
}

/**
 * Filtra le commesse incluse nel calcolo KPI di carico e saturazione.
 * Quando selectedDept === 'ALL' ("TUTTI"), esclude esplicitamente MAG e considera SOLO ['CP', 'CG', 'BF'].
 */
export function filterJobsForCapacityMetrics(
  jobs: JobOrder[],
  selectedDept: MacroDepartmentCode
): JobOrder[] {
  if (selectedDept !== 'ALL') {
    return jobs;
  }
  return jobs.filter((job) =>
    (AGGREGATE_PRODUCTION_DEPTS as readonly string[]).includes(getJobDepartmentGroup(job))
  );
}
