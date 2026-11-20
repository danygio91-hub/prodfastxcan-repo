import { getISOWeek, getISOWeekYear } from 'date-fns';
import type { JobOrder } from '@/types';
import { getJobDisplayStatus } from './job-status';

export type MacroDepartmentCode = 'ALL' | 'CP' | 'CG' | 'BF' | 'MAG';
export type JobDepartmentGroup = 'CP' | 'CG' | 'BF' | 'MAG' | 'OTHER';
export type ProductionDepartmentCode = 'CP' | 'CG' | 'BF';
export type CapacityDayKey = 'L' | 'M' | 'Me' | 'G' | 'V';
export type WeekTemporalState = 'past' | 'current' | 'future';

export const HOURS_PER_WORKER_DAY = 7.6;
export const CAPACITY_DAY_KEYS: readonly CapacityDayKey[] = ['L', 'M', 'Me', 'G', 'V'];
export const AGGREGATE_PRODUCTION_DEPTS: readonly ProductionDepartmentCode[] = ['CP', 'CG', 'BF'];
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

const CLOSED_CAPACITY_STATUS_EXACT = new Set([
  'spedito',
  'spedita',
  'shipped',
  'completato',
  'completata',
  'completato prod',
  'completato prod.',
  'completed',
  'conclusa',
  'concluso',
  'concluse',
  'archiviata',
  'archiviato',
  'archived',
  'chiuso',
  'chiusa',
  'closed',
  'fine_produzione',
  'fine produzione',
  'fine prod.',
  'annullato',
  'annullata',
  'cancelled',
  'canceled',
]);

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Formatta le ore in modo compatto per badge/pillole (es. 14.0 -> "14h", 14.5 -> "14.5h").
 */
export function formatCompactHours(hours: number): string {
  const safe = round1(Number.isFinite(hours) ? hours : 0);
  return Number.isInteger(safe) ? `${safe}h` : `${safe.toFixed(1)}h`;
}

/**
 * FASE 102 — SSoT Carico Capacità (Aperte 100% / Chiuse 0%).
 * Restituisce true se la commessa è APERTA e quindi contribuisce col 100% del suo tempo previsto
 * al carico del cruscotto capacità primario.
 * Restituisce false se la commessa è chiusa/conclusa/spedita/archiviata/completata (contributo 0 h).
 */
export function isJobOpenForCapacity(job: JobOrder | null | undefined): boolean {
  if (!job) return false;

  if (
    Boolean(job.packingListId) ||
    job.forcedCompletion === true ||
    Boolean(job.overallEndTime)
  ) {
    return false;
  }

  const rawStatus = String(job.status || '').toLowerCase().trim();
  if (
    rawStatus &&
    (CLOSED_CAPACITY_STATUS_EXACT.has(rawStatus) ||
      rawStatus.includes('spedit') ||
      rawStatus.includes('archiviat') ||
      rawStatus.includes('conclus') ||
      rawStatus.includes('annullat'))
  ) {
    return false;
  }

  const displayStatus = getJobDisplayStatus(job);
  if (displayStatus === 'Completato Prod.' || displayStatus === 'Spedito') {
    return false;
  }

  return true;
}

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
 * Classifica la settimana selezionata rispetto alla data odierna (passata / corrente / futura).
 */
export function getWeekTemporalState(
  targetYear: number,
  targetWeek: number,
  referenceDate: Date = new Date()
): WeekTemporalState {
  const currentYear = getISOWeekYear(referenceDate);
  const currentWeek = getISOWeek(referenceDate);

  if (targetYear < currentYear || (targetYear === currentYear && targetWeek < currentWeek)) {
    return 'past';
  }
  if (targetYear === currentYear && targetWeek === currentWeek) {
    return 'current';
  }
  return 'future';
}

export interface WeeklyAvailableHoursBreakdown {
  weekState: WeekTemporalState;
  remainingHours: number;
  fullWeekHours: number;
  ordinaryRemainingHours: number;
  overtimeHours: number;
  activeDays: CapacityDayKey[];
  pastDays: Record<CapacityDayKey, boolean>;
  todayDayKey: CapacityDayKey | null;
}

/**
 * FASE 102 — Calcolo disponibilità dinamica giorno per giorno (Lunedì–Venerdì + Straordinari):
 * - Settimane future: somma tutti e 5 i giorni (L, M, Me, G, V) * 7.6 h + straordinari.
 * - Settimana corrente: somma solo i giorni lavorativi da oggi (incluso) a Venerdì * 7.6 h + straordinari
 *   (Sabato/Domenica -> ore ordinarie residue = 0 + eventuali straordinari).
 * - Settimane passate: ore disponibili residue = 0.0 h (capacità originaria preservata in fullWeekHours).
 */
export function calculateWeeklyAvailableHours(
  capacity: DayCapacityConfigData | undefined,
  targetYear: number,
  targetWeek: number,
  referenceDate: Date = new Date()
): WeeklyAvailableHoursBreakdown {
  const safeCap = capacity || EMPTY_CAPACITY_BUCKET;
  const dayWorkers: Record<CapacityDayKey, number> = {
    L: Math.max(0, Number(safeCap.L) || 0),
    M: Math.max(0, Number(safeCap.M) || 0),
    Me: Math.max(0, Number(safeCap.Me) || 0),
    G: Math.max(0, Number(safeCap.G) || 0),
    V: Math.max(0, Number(safeCap.V) || 0),
  };
  const overtimeHours = round1(Math.max(0, Number(safeCap.overtime) || 0));

  const fullWeekWorkers =
    dayWorkers.L + dayWorkers.M + dayWorkers.Me + dayWorkers.G + dayWorkers.V;
  const fullWeekHours = round1(fullWeekWorkers * HOURS_PER_WORKER_DAY + overtimeHours);

  const weekState = getWeekTemporalState(targetYear, targetWeek, referenceDate);

  if (weekState === 'future') {
    const ordinaryRemainingHours = round1(fullWeekWorkers * HOURS_PER_WORKER_DAY);
    return {
      weekState,
      remainingHours: fullWeekHours,
      fullWeekHours,
      ordinaryRemainingHours,
      overtimeHours,
      activeDays: [...CAPACITY_DAY_KEYS],
      pastDays: { L: false, M: false, Me: false, G: false, V: false },
      todayDayKey: null,
    };
  }

  if (weekState === 'past') {
    return {
      weekState,
      remainingHours: 0,
      fullWeekHours,
      ordinaryRemainingHours: 0,
      overtimeHours,
      activeDays: [],
      pastDays: { L: true, M: true, Me: true, G: true, V: true },
      todayDayKey: null,
    };
  }

  // Settimana corrente: JS getDay() -> 0=Dom, 1=Lun .. 5=Ven, 6=Sab -> ISO 1..7
  const jsDay = referenceDate.getDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;

  const pastDays: Record<CapacityDayKey, boolean> = {
    L: 1 < isoDay,
    M: 2 < isoDay,
    Me: 3 < isoDay,
    G: 4 < isoDay,
    V: 5 < isoDay,
  };

  const activeDays = CAPACITY_DAY_KEYS.filter((day) => !pastDays[day]);
  const todayDayKey: CapacityDayKey | null =
    isoDay >= 1 && isoDay <= 5 ? CAPACITY_DAY_KEYS[isoDay - 1] : null;

  const remainingWorkers = activeDays.reduce((sum, day) => sum + dayWorkers[day], 0);
  const ordinaryRemainingHours = round1(remainingWorkers * HOURS_PER_WORKER_DAY);
  const remainingHours = round1(ordinaryRemainingHours + overtimeHours);

  return {
    weekState,
    remainingHours,
    fullWeekHours,
    ordinaryRemainingHours,
    overtimeHours,
    activeDays,
    pastDays,
    todayDayKey,
  };
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
 * - Quando selectedDept === 'ALL' ("TUTTI"), esclude esplicitamente MAG e considera SOLO ['CP', 'CG', 'BF'].
 * - Quando è selezionato un reparto specifico (es. 'CP', 'CG', 'BF', 'MAG'), include solo quel reparto.
 */
export function filterJobsForCapacityMetrics(
  jobs: JobOrder[],
  selectedDept: MacroDepartmentCode
): JobOrder[] {
  if (selectedDept === 'ALL') {
    return jobs.filter((job) =>
      (AGGREGATE_PRODUCTION_DEPTS as readonly string[]).includes(getJobDepartmentGroup(job))
    );
  }
  return jobs.filter((job) => getJobDepartmentGroup(job) === selectedDept);
}

export interface DepartmentCapacitySummary {
  dept: ProductionDepartmentCode;
  availableHours: number;
  fullWeekHours: number;
  openLoadedHours: number;
  openJobsCount: number;
  zeroHourOpenJobsCount: number;
  saturationPercent: number | null;
  balanceHours: number;
  isOverloaded: boolean;
}

export interface PrimaryCapacityDashboardInput {
  allJobs: JobOrder[];
  selectedDept: MacroDepartmentCode;
  selectedYear: number;
  selectedWeekNumber: number;
  showAllWeeks: boolean;
  capacitiesByBucket: Record<string, DayCapacityConfigData>;
  getJobHours: (job: JobOrder) => number;
  getJobWeek: (job: JobOrder) => { week: number; year: number } | null;
  referenceDate?: Date;
}

export interface PrimaryCapacityDashboardMetrics {
  showAllWeeks: boolean;
  availability: WeeklyAvailableHoursBreakdown;
  availableHours: number | null;
  fullWeekHours: number | null;
  openLoadedHours: number;
  openJobsCount: number;
  openPieces: number;
  zeroHourOpenJobsCount: number;
  saturationPercent: number | null;
  balanceHours: number | null;
  isOverloaded: boolean;
  departmentBreakdowns: DepartmentCapacitySummary[];
}

/**
 * FASE 102 — Specchietto 1: Cruscotto Capacità Reale (Primario).
 * Calcolato ESCLUSIVAMENTE su (Settimana selezionata + Reparto selezionato) usando SOLO commesse aperte.
 * Totalmente insensibile a ricerca testuale, filtro stato, ordinamenti o selezioni checkbox.
 */
export function computePrimaryCapacityDashboard(
  input: PrimaryCapacityDashboardInput
): PrimaryCapacityDashboardMetrics {
  const {
    allJobs,
    selectedDept,
    selectedYear,
    selectedWeekNumber,
    showAllWeeks,
    capacitiesByBucket,
    getJobHours,
    getJobWeek,
    referenceDate = new Date(),
  } = input;

  // 1. Scoping temporale (singola settimana vs tutte le settimane)
  const jobsInPeriod = showAllWeeks
    ? allJobs
    : allJobs.filter((job) => {
        const w = getJobWeek(job);
        return Boolean(w && w.week === selectedWeekNumber && w.year === selectedYear);
      });

  // 2. Scoping reparto (in ALL esclude rigorosamente MAG; in MAG include solo MAG)
  const deptScopedJobs = filterJobsForCapacityMetrics(jobsInPeriod, selectedDept);

  // 3. Regola netta Aperte 100% / Chiuse 0%
  const openJobs = deptScopedJobs.filter((job) => isJobOpenForCapacity(job));

  let rawOpenHours = 0;
  let openPieces = 0;
  let zeroHourOpenJobsCount = 0;

  for (const job of openJobs) {
    const h = Math.max(0, Number(getJobHours(job)) || 0);
    rawOpenHours += h;
    openPieces += Number(job.qta) || 0;
    if (h <= 0) {
      zeroHourOpenJobsCount++;
    }
  }

  const openLoadedHours = round1(rawOpenHours);

  // 4. Disponibilità giornaliera residua (CP+CG+BF per ALL; singolo reparto altrimenti)
  const currentCapacity =
    selectedDept === 'ALL'
      ? aggregateCompanyCapacity(capacitiesByBucket, selectedYear, selectedWeekNumber)
      : capacitiesByBucket[`${selectedDept}_${selectedYear}_W${selectedWeekNumber}`] ||
        EMPTY_CAPACITY_BUCKET;

  const availability = calculateWeeklyAvailableHours(
    currentCapacity,
    selectedYear,
    selectedWeekNumber,
    referenceDate
  );

  // 5. Mini-bilancio sintetico per i 3 reparti produttivi (CP, CG, BF) quando è selezionata una singola settimana
  const departmentBreakdowns: DepartmentCapacitySummary[] = showAllWeeks
    ? []
    : AGGREGATE_PRODUCTION_DEPTS.map((dept) => {
        const deptOpenJobs = jobsInPeriod.filter(
          (job) => getJobDepartmentGroup(job) === dept && isJobOpenForCapacity(job)
        );
        let rawDeptHours = 0;
        let deptZeroHourCount = 0;
        for (const job of deptOpenJobs) {
          const h = Math.max(0, Number(getJobHours(job)) || 0);
          rawDeptHours += h;
          if (h <= 0) deptZeroHourCount++;
        }
        const deptOpenLoadedHours = round1(rawDeptHours);
        const deptCap =
          capacitiesByBucket[`${dept}_${selectedYear}_W${selectedWeekNumber}`] ||
          EMPTY_CAPACITY_BUCKET;
        const deptAvail = calculateWeeklyAvailableHours(
          deptCap,
          selectedYear,
          selectedWeekNumber,
          referenceDate
        );
        const deptBalance = round1(deptAvail.remainingHours - deptOpenLoadedHours);
        const deptOverloaded = deptOpenLoadedHours > deptAvail.remainingHours;
        const deptSaturation =
          deptAvail.remainingHours > 0
            ? Math.round((deptOpenLoadedHours / deptAvail.remainingHours) * 100)
            : deptOpenLoadedHours > 0
              ? null
              : 0;

        return {
          dept,
          availableHours: deptAvail.remainingHours,
          fullWeekHours: deptAvail.fullWeekHours,
          openLoadedHours: deptOpenLoadedHours,
          openJobsCount: deptOpenJobs.length,
          zeroHourOpenJobsCount: deptZeroHourCount,
          saturationPercent: deptSaturation,
          balanceHours: deptBalance,
          isOverloaded: deptOverloaded,
        };
      });

  // Vista "Tutte le Settimane": non confrontare mesi di ordini contro 5 giorni
  if (showAllWeeks) {
    return {
      showAllWeeks: true,
      availability,
      availableHours: null,
      fullWeekHours: null,
      openLoadedHours,
      openJobsCount: openJobs.length,
      openPieces,
      zeroHourOpenJobsCount,
      saturationPercent: null,
      balanceHours: null,
      isOverloaded: false,
      departmentBreakdowns,
    };
  }

  const availableHours = availability.remainingHours;
  const balanceHours = round1(availableHours - openLoadedHours);
  const isOverloaded = openLoadedHours > availableHours;
  const saturationPercent =
    availableHours > 0
      ? Math.round((openLoadedHours / availableHours) * 100)
      : openLoadedHours > 0
        ? null
        : 0;

  return {
    showAllWeeks: false,
    availability,
    availableHours,
    fullWeekHours: availability.fullWeekHours,
    openLoadedHours,
    openJobsCount: openJobs.length,
    openPieces,
    zeroHourOpenJobsCount,
    saturationPercent,
    balanceHours,
    isOverloaded,
    departmentBreakdowns,
  };
}

export interface DynamicViewSummary {
  visibleCount: number;
  visibleTotalHours: number;
  visibleTotalPieces: number;
  visibleOpenCount: number;
  visibleOpenHours: number;
  visibleClosedCount: number;
  visibleClosedHours: number;
  selectedCount: number;
  selectedTotalHours: number;
  selectedOpenCount: number;
  selectedOpenHours: number;
  selectedClosedCount: number;
  selectedClosedHours: number;
}

/**
 * FASE 102 — Specchietto 2: Contatore Dinamico di Consultazione / Selezione (Secondario).
 * Reagisce in tempo reale a ricerca, filtro stato, righe visibili e checkbox selezionate,
 * mantenendo lo spaccato tra commesse aperte e chiuse/spedite.
 */
export function computeDynamicViewSummary(params: {
  visibleJobs: JobOrder[];
  selectedJobs: JobOrder[];
  getJobHours: (job: JobOrder) => number;
}): DynamicViewSummary {
  const { visibleJobs, selectedJobs, getJobHours } = params;

  let visibleOpenCount = 0;
  let visibleOpenRaw = 0;
  let visibleClosedCount = 0;
  let visibleClosedRaw = 0;
  let visibleTotalPieces = 0;

  for (const job of visibleJobs) {
    const h = Math.max(0, Number(getJobHours(job)) || 0);
    visibleTotalPieces += Number(job.qta) || 0;
    if (isJobOpenForCapacity(job)) {
      visibleOpenCount++;
      visibleOpenRaw += h;
    } else {
      visibleClosedCount++;
      visibleClosedRaw += h;
    }
  }

  let selectedOpenCount = 0;
  let selectedOpenRaw = 0;
  let selectedClosedCount = 0;
  let selectedClosedRaw = 0;

  for (const job of selectedJobs) {
    const h = Math.max(0, Number(getJobHours(job)) || 0);
    if (isJobOpenForCapacity(job)) {
      selectedOpenCount++;
      selectedOpenRaw += h;
    } else {
      selectedClosedCount++;
      selectedClosedRaw += h;
    }
  }

  const visibleOpenHours = round1(visibleOpenRaw);
  const visibleClosedHours = round1(visibleClosedRaw);
  const visibleTotalHours = round1(visibleOpenRaw + visibleClosedRaw);

  const selectedOpenHours = round1(selectedOpenRaw);
  const selectedClosedHours = round1(selectedClosedRaw);
  const selectedTotalHours = round1(selectedOpenRaw + selectedClosedRaw);

  return {
    visibleCount: visibleJobs.length,
    visibleTotalHours,
    visibleTotalPieces,
    visibleOpenCount,
    visibleOpenHours,
    visibleClosedCount,
    visibleClosedHours,
    selectedCount: selectedJobs.length,
    selectedTotalHours,
    selectedOpenCount,
    selectedOpenHours,
    selectedClosedCount,
    selectedClosedHours,
  };
}
