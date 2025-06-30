
'use server';

import { getJobOrdersStore, getOperatorsStore, type JobOrder, type JobPhase, type Operator, type WorkPeriod } from '@/lib/mock-data';
import { differenceInMilliseconds, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

// --- Helper Functions ---

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function calculateTimeForPeriods(periods: WorkPeriod[]): number {
  return periods.reduce((acc, period) => {
    // Ensure dates are actual Date objects before calculation
    const end = period.end ? new Date(period.end) : new Date(); // Use now for active periods
    const start = new Date(period.start);
    return acc + differenceInMilliseconds(end, start);
  }, 0);
}


// --- Main Action Functions ---

export async function getJobsReport() {
    const jobs = await getJobOrdersStore();
    const mockOperators = await getOperatorsStore();

    return jobs
        .filter(job => job.status === 'production' || job.status === 'completed')
        .map(job => {
            const allWorkPeriods = job.phases.flatMap(p => p.workPeriods);
            const timeElapsedMs = calculateTimeForPeriods(allWorkPeriods);
            
            const operatorIds = [...new Set(allWorkPeriods.map(p => p.operatorId))];
            const operators = operatorIds
                .map(id => {
                    const op = mockOperators.find(o => o.id === id);
                    return op ? `${op.nome} ${op.cognome}` : 'Sconosciuto';
                })
                .join(', ');

            let overallStatus: 'In Lavorazione' | 'Completata' | 'Problema' = 'In Lavorazione';
            if (job.isProblemReported) {
                overallStatus = 'Problema';
            } else if (job.status === 'completed') {
                overallStatus = 'Completata';
            }

            return {
                id: job.id,
                cliente: job.cliente,
                details: job.details,
                status: overallStatus,
                timeElapsed: formatDuration(timeElapsedMs),
                operators: operators || 'N/A',
                deliveryDate: job.dataConsegnaFinale || 'N/D',
            };
        });
}

export async function getOperatorsReport() {
    const operators = await getOperatorsStore();
    const jobs = await getJobOrdersStore();
    const allWorkPeriods = jobs.flatMap(job => job.phases.flatMap(phase => phase.workPeriods));

    const now = new Date();
    const todayInterval = { start: startOfDay(now), end: endOfDay(now) };
    const thisWeekInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);

        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                if (period.end && isWithinInterval(new Date(period.start), interval)) {
                    return acc + differenceInMilliseconds(new Date(period.end), new Date(period.start));
                }
                return acc;
            }, 0);
        };
        
        return {
            id: op.id,
            name: `${op.nome} ${op.cognome}`,
            department: op.reparto,
            status: op.stato,
            timeToday: formatDuration(getTimeInInterval(todayInterval)),
            timeWeek: formatDuration(getTimeInInterval(thisWeekInterval)),
            timeMonth: formatDuration(getTimeInInterval(thisMonthInterval)),
        };
    });
}

export async function getJobDetailReport(jobId: string) {
    const jobs = await getJobOrdersStore();
    const mockOperators = await getOperatorsStore();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return null;
    
    // Deep copy
    const jobDetail: JobOrder = JSON.parse(JSON.stringify(job));

    const phasesWithDetails = jobDetail.phases.map(phase => {
        const timeElapsedMs = calculateTimeForPeriods(phase.workPeriods);
        const operatorIds = [...new Set(phase.workPeriods.map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = mockOperators.find(o => o.id === id);
                return op ? `${op.nome} ${op.cognome}` : 'Sconosciuto';
            })
            .join(', ');

        return {
            ...phase,
            timeElapsed: formatDuration(timeElapsedMs),
            operators: operators || 'N/A',
        };
    });
    
    const totalTimeElapsedMs = calculateTimeForPeriods(jobDetail.phases.flatMap(p => p.workPeriods));

    return {
        ...jobDetail,
        phases: phasesWithDetails,
        totalTimeElapsed: formatDuration(totalTimeElapsedMs)
    };
}
