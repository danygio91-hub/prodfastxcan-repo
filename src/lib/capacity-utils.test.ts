import { describe, it, expect } from 'vitest';
import type { JobOrder } from '@/types';
import {
  HOURS_PER_WORKER_DAY,
  getJobDepartmentGroup,
  aggregateCompanyCapacity,
  filterJobsForCapacityMetrics,
  isCapacityPeriodAtOrAfter,
  resolveBucketWithBaseline,
  isJobOpenForCapacity,
  calculateWeeklyAvailableHours,
  computePrimaryCapacityDashboard,
  computeDynamicViewSummary,
  type DayCapacityConfigData,
} from './capacity-utils';

const makeJob = (overrides: Partial<JobOrder> = {}): JobOrder => ({
  id: 'job-1',
  cliente: 'CLIENTE TEST',
  qta: 100,
  department: 'CP',
  details: 'ART-001',
  ordinePF: '100/PF.1',
  dataConsegnaFinale: '2026-11-20',
  postazioneLavoro: 'Da Assegnare',
  phases: [],
  status: 'Pianificata',
  orePreviste: 10,
  isoWeek: 47,
  weekYear: 2026,
  ...overrides,
});

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

describe('FASE 102: Separazione Cruscotto Capacità Reale vs Contatore Dinamico + Disponibilità Giornaliera', () => {
  it('isJobOpenForCapacity include commesse aperte (100%) ed esclude spedite/completate/concluse/archiviate (0%)', () => {
    // Aperte -> true (anche se una fase è completata ma ne restano altre in corso/pending)
    expect(isJobOpenForCapacity(makeJob({ status: 'Pianificata' }))).toBe(true);
    expect(isJobOpenForCapacity(makeJob({ status: 'Da Avviare' }))).toBe(true);
    expect(isJobOpenForCapacity(makeJob({ status: 'DA_INIZIARE' }))).toBe(true);
    expect(
      isJobOpenForCapacity(
        makeJob({
          status: 'In Produzione',
          phases: [
            { id: 'p1', name: 'Taglio', status: 'completed', materialReady: true, workPeriods: [], sequence: 1, materialConsumptions: [], departmentCodes: ['CP'] },
            { id: 'p2', name: 'Montaggio', status: 'in-progress', materialReady: true, workPeriods: [], sequence: 2, materialConsumptions: [], departmentCodes: ['CP'] },
          ],
        })
      )
    ).toBe(true);

    // Chiuse/Concluse/Spedite/Archiviate -> false
    expect(isJobOpenForCapacity(makeJob({ status: 'Spedito' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'Spedita' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'Completato Prod.' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'FINE_PRODUZIONE' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'Conclusa' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'Archiviata' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'CHIUSO' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'In Produzione', packingListId: 'PL-1' }))).toBe(false);
    expect(isJobOpenForCapacity(makeJob({ status: 'In Produzione', forcedCompletion: true }))).toBe(false);
  });

  it('esclude commesse spedite/concluse dal carico primario mantenendo 100% del tempo previsto sulle aperte (incluse fasi parziali)', () => {
    const capacities: Record<string, DayCapacityConfigData> = {
      CP_2026_W48: { L: 2, M: 2, Me: 2, G: 2, V: 2, overtime: 0 }, // 10 * 7.6 = 76.0 h (settimana futura)
    };
    const jobs: JobOrder[] = [
      makeJob({ id: 'open-1', department: 'CP', status: 'Pianificata', orePreviste: 20, isoWeek: 48, weekYear: 2026 }),
      makeJob({
        id: 'open-partial',
        department: 'CP',
        status: 'In Produzione',
        orePreviste: 18,
        isoWeek: 48,
        weekYear: 2026,
        phases: [
          { id: 'p1', name: 'F1', status: 'completed', materialReady: true, workPeriods: [], sequence: 1, materialConsumptions: [], departmentCodes: ['CP'] },
          { id: 'p2', name: 'F2', status: 'pending', materialReady: true, workPeriods: [], sequence: 2, materialConsumptions: [], departmentCodes: ['CP'] },
        ],
      }),
      makeJob({ id: 'open-zero', department: 'CP', status: 'Pianificata', orePreviste: 0, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'closed-shipped', department: 'CP', status: 'Spedito', orePreviste: 40, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'closed-done', department: 'CP', status: 'Completato Prod.', orePreviste: 25, isoWeek: 48, weekYear: 2026 }),
    ];

    const res = computePrimaryCapacityDashboard({
      allJobs: jobs,
      selectedDept: 'CP',
      selectedYear: 2026,
      selectedWeekNumber: 48,
      showAllWeeks: false,
      capacitiesByBucket: capacities,
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: new Date(2026, 10, 18, 12, 0, 0), // Mercoledì W47 2026 -> W48 è futura
    });

    expect(res.openJobsCount).toBe(3);
    expect(res.zeroHourOpenJobsCount).toBe(1);
    expect(res.openLoadedHours).toBe(38); // 20 + 18 + 0 (40 e 25 chiuse contribuiscono 0h)
    expect(res.availableHours).toBe(76);
    expect(res.saturationPercent).toBe(50);
    expect(res.balanceHours).toBe(38);
    expect(res.isOverloaded).toBe(false);
  });

  it('esclude MAG da TUTTI (sia disponibilità che carico) e include MAG sul solo tab MAG + calcola mini-bilancio CP/CG/BF', () => {
    const capacities: Record<string, DayCapacityConfigData> = {
      CP_2026_W48: { L: 2, M: 2, Me: 2, G: 2, V: 2, overtime: 0 }, // 76 h
      CG_2026_W48: { L: 1, M: 1, Me: 1, G: 1, V: 1, overtime: 2 }, // 40 h
      BF_2026_W48: { L: 1, M: 1, Me: 1, G: 1, V: 1, overtime: 0 }, // 38 h
      MAG_2026_W48: { L: 5, M: 5, Me: 5, G: 5, V: 5, overtime: 10 }, // 200 h (escluso da ALL)
    };
    const jobs: JobOrder[] = [
      makeJob({ id: 'cp-1', department: 'CP', status: 'Pianificata', orePreviste: 60, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'cg-1', department: 'CG', status: 'In Produzione', orePreviste: 46, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'bf-1', department: 'BF', status: 'Pianificata', orePreviste: 18, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'mag-open', department: 'MAG', status: 'Pianificata', orePreviste: 100, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'mag-closed', department: 'MAG', status: 'Spedito', orePreviste: 50, isoWeek: 48, weekYear: 2026 }),
    ];
    const refDate = new Date(2026, 10, 18, 12, 0, 0); // W47

    const allView = computePrimaryCapacityDashboard({
      allJobs: jobs,
      selectedDept: 'ALL',
      selectedYear: 2026,
      selectedWeekNumber: 48,
      showAllWeeks: false,
      capacitiesByBucket: capacities,
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: refDate,
    });

    // ALL = CP (76) + CG (40) + BF (38) = 154 h disponibili; carico aperto = 60 + 46 + 18 = 124 h (MAG 100h escluso)
    expect(allView.availableHours).toBe(154);
    expect(allView.openLoadedHours).toBe(124);
    expect(allView.openJobsCount).toBe(3);
    expect(allView.balanceHours).toBe(30);
    expect(allView.departmentBreakdowns).toHaveLength(3);
    expect(allView.departmentBreakdowns.map((d) => ({ dept: d.dept, sat: d.saturationPercent, bal: d.balanceHours }))).toEqual([
      { dept: 'CP', sat: 79, bal: 16 },
      { dept: 'CG', sat: 115, bal: -6 },
      { dept: 'BF', sat: 47, bal: 20 },
    ]);

    // Tab MAG -> solo MAG (disponibilità 200 h, carico aperto 100 h, spedita 50 h esclusa)
    const magView = computePrimaryCapacityDashboard({
      allJobs: jobs,
      selectedDept: 'MAG',
      selectedYear: 2026,
      selectedWeekNumber: 48,
      showAllWeeks: false,
      capacitiesByBucket: capacities,
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: refDate,
    });

    expect(magView.availableHours).toBe(200);
    expect(magView.openLoadedHours).toBe(100);
    expect(magView.openJobsCount).toBe(1);
    expect(magView.saturationPercent).toBe(50);
    expect(magView.balanceHours).toBe(100);
  });

  it('calcola la disponibilità residua giorno per giorno (passata, corrente Lun/Mer/Ven/Sab, futura)', () => {
    const cap: DayCapacityConfigData = { L: 2, M: 3, Me: 4, G: 5, V: 1, overtime: 6 };
    // Intera settimana: (2+3+4+5+1) * 7.6 + 6 = 15 * 7.6 + 6 = 114 + 6 = 120.0 h
    const expectedFull = Math.round((15 * HOURS_PER_WORKER_DAY + 6) * 10) / 10;
    expect(expectedFull).toBe(120);

    // W47 2026 = Lun 16 Nov 2026 .. Dom 22 Nov 2026
    const monW47 = new Date(2026, 10, 16, 9, 0, 0);
    const wedW47 = new Date(2026, 10, 18, 9, 0, 0);
    const friW47 = new Date(2026, 10, 20, 9, 0, 0);
    const satW47 = new Date(2026, 10, 21, 9, 0, 0);

    // 1. Settimana futura (W48 vista da Mer W47): tutti e 5 i giorni + straordinari
    const future = calculateWeeklyAvailableHours(cap, 2026, 48, wedW47);
    expect(future.weekState).toBe('future');
    expect(future.remainingHours).toBe(120);
    expect(future.fullWeekHours).toBe(120);
    expect(future.activeDays).toEqual(['L', 'M', 'Me', 'G', 'V']);
    expect(future.pastDays).toEqual({ L: false, M: false, Me: false, G: false, V: false });

    // 2. Settimana corrente — Lunedì: L+M+Me+G+V (15 addetti * 7.6 = 114) + 6 = 120
    const curMon = calculateWeeklyAvailableHours(cap, 2026, 47, monW47);
    expect(curMon.weekState).toBe('current');
    expect(curMon.remainingHours).toBe(120);
    expect(curMon.pastDays).toEqual({ L: false, M: false, Me: false, G: false, V: false });
    expect(curMon.todayDayKey).toBe('L');

    // 3. Settimana corrente — Mercoledì: Me+G+V (4+5+1 = 10 * 7.6 = 76) + 6 = 82
    const curWed = calculateWeeklyAvailableHours(cap, 2026, 47, wedW47);
    expect(curWed.weekState).toBe('current');
    expect(curWed.remainingHours).toBe(82);
    expect(curWed.fullWeekHours).toBe(120);
    expect(curWed.activeDays).toEqual(['Me', 'G', 'V']);
    expect(curWed.pastDays).toEqual({ L: true, M: true, Me: false, G: false, V: false });
    expect(curWed.todayDayKey).toBe('Me');

    // 4. Settimana corrente — Venerdì: V (1 * 7.6 = 7.6) + 6 = 13.6
    const curFri = calculateWeeklyAvailableHours(cap, 2026, 47, friW47);
    expect(curFri.weekState).toBe('current');
    expect(curFri.remainingHours).toBe(13.6);
    expect(curFri.activeDays).toEqual(['V']);
    expect(curFri.pastDays).toEqual({ L: true, M: true, Me: true, G: true, V: false });
    expect(curFri.todayDayKey).toBe('V');

    // 5. Settimana corrente — Sabato: ordinarie residue 0 + straordinari 6 = 6.0
    const curSat = calculateWeeklyAvailableHours(cap, 2026, 47, satW47);
    expect(curSat.weekState).toBe('current');
    expect(curSat.ordinaryRemainingHours).toBe(0);
    expect(curSat.remainingHours).toBe(6);
    expect(curSat.activeDays).toEqual([]);
    expect(curSat.pastDays).toEqual({ L: true, M: true, Me: true, G: true, V: true });
    expect(curSat.todayDayKey).toBeNull();

    // 6. Settimana passata (W46 vista da Mer W47): residue = 0.0 h, fullWeekHours preservato
    const past = calculateWeeklyAvailableHours(cap, 2026, 46, wedW47);
    expect(past.weekState).toBe('past');
    expect(past.remainingHours).toBe(0);
    expect(past.fullWeekHours).toBe(120);
    expect(past.pastDays).toEqual({ L: true, M: true, Me: true, G: true, V: true });

    // Verifica sforamento immediato in settimana passata se resta una commessa aperta
    const pastDash = computePrimaryCapacityDashboard({
      allJobs: [makeJob({ id: 'late-open', department: 'CP', status: 'In Produzione', orePreviste: 12, isoWeek: 46, weekYear: 2026 })],
      selectedDept: 'CP',
      selectedYear: 2026,
      selectedWeekNumber: 46,
      showAllWeeks: false,
      capacitiesByBucket: { CP_2026_W46: cap },
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: wedW47,
    });
    expect(pastDash.availableHours).toBe(0);
    expect(pastDash.balanceHours).toBe(-12);
    expect(pastDash.isOverloaded).toBe(true);
    expect(pastDash.saturationPercent).toBeNull();
  });

  it('mantiene invariante il cruscotto primario rispetto a ricerca/filtro stato/selezione mentre aggiorna lo specchietto dinamico e gestisce Tutte le Settimane', () => {
    const capacities: Record<string, DayCapacityConfigData> = {
      CP_2026_W48: { L: 2, M: 2, Me: 2, G: 2, V: 2, overtime: 0 }, // 76 h
    };
    const allJobs: JobOrder[] = [
      makeJob({ id: 'j1', cliente: 'ROSSI', department: 'CP', status: 'Pianificata', orePreviste: 20, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'j2', cliente: 'BIANCHI', department: 'CP', status: 'In Produzione', orePreviste: 30, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'j3', cliente: 'ROSSI', department: 'CP', status: 'Spedito', orePreviste: 15, isoWeek: 48, weekYear: 2026 }),
      makeJob({ id: 'j4', cliente: 'VERDI', department: 'CP', status: 'Pianificata', orePreviste: 10, isoWeek: 49, weekYear: 2026 }),
    ];
    const refDate = new Date(2026, 10, 18, 12, 0, 0);

    // Cruscotto primario per CP / W48: dipende SOLO da allJobs + (W48, CP), mai dai filtri UI
    const primaryBeforeFilter = computePrimaryCapacityDashboard({
      allJobs,
      selectedDept: 'CP',
      selectedYear: 2026,
      selectedWeekNumber: 48,
      showAllWeeks: false,
      capacitiesByBucket: capacities,
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: refDate,
    });

    // Simulazione filtro ricerca "ROSSI" + selezione checkbox di j1 e j3
    const filteredVisible = allJobs.filter((j) => j.isoWeek === 48 && j.cliente === 'ROSSI'); // j1 (open 20h) + j3 (closed 15h)
    const selectedJobs = [allJobs[0], allJobs[2]];

    const dynamicSummary = computeDynamicViewSummary({
      visibleJobs: filteredVisible,
      selectedJobs,
      getJobHours: (j) => j.orePreviste || 0,
    });

    // Il cruscotto primario NON cambia applicando filtri/ricerche (resta 50 h su 2 commesse aperte: j1+j2)
    expect(primaryBeforeFilter.openJobsCount).toBe(2);
    expect(primaryBeforeFilter.openLoadedHours).toBe(50);
    expect(primaryBeforeFilter.balanceHours).toBe(26);

    // Lo specchietto dinamico riflette esattamente filtro + spaccato aperte/chiuse + selezione
    expect(dynamicSummary).toEqual({
      visibleCount: 2,
      visibleTotalHours: 35,
      visibleTotalPieces: 200,
      visibleOpenCount: 1,
      visibleOpenHours: 20,
      visibleClosedCount: 1,
      visibleClosedHours: 15,
      selectedCount: 2,
      selectedTotalHours: 35,
      selectedOpenCount: 1,
      selectedOpenHours: 20,
      selectedClosedCount: 1,
      selectedClosedHours: 15,
    });

    // Vista "Tutte le Settimane": somma carico aperto totale (j1 20 + j2 30 + j4 10 = 60h), disponibili/saturazione/bilancio = null
    const allWeeksDash = computePrimaryCapacityDashboard({
      allJobs,
      selectedDept: 'CP',
      selectedYear: 2026,
      selectedWeekNumber: 48,
      showAllWeeks: true,
      capacitiesByBucket: capacities,
      getJobHours: (j) => j.orePreviste || 0,
      getJobWeek: (j) => (j.isoWeek && j.weekYear ? { week: j.isoWeek, year: j.weekYear } : null),
      referenceDate: refDate,
    });

    expect(allWeeksDash.openJobsCount).toBe(3);
    expect(allWeeksDash.openLoadedHours).toBe(60);
    expect(allWeeksDash.availableHours).toBeNull();
    expect(allWeeksDash.saturationPercent).toBeNull();
    expect(allWeeksDash.balanceHours).toBeNull();
  });
});
