
'use server';

import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, Operator, WorkPeriod } from '@/lib/mock-data';
import { differenceInMilliseconds, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

// Helper to convert Firestore Timestamps to Dates in nested objects
function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj.toDate && typeof obj.toDate === 'function') {
        return obj.toDate();
    }
    if (Array.isArray(obj)) {
        return obj.map(item => convertTimestampsToDates(item));
    }
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
        newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
}


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
    const end = period.end ? new Date(period.end) : new Date(); // Use now for active periods
    const start = new Date(period.start);
    if (isNaN(start.getTime()) || (period.end && isNaN(end.getTime()))) return acc;
    return acc + differenceInMilliseconds(end, start);
  }, 0);
}


export async function getJobsReport() {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "in", ["production", "completed"]));
    const jobsSnapshot = await getDocs(q);
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operatorsMap = new Map(operatorsSnapshot.docs.map(doc => [doc.id, doc.data() as Operator]));

    return jobs.map(job => {
        const allWorkPeriods = job.phases.flatMap(p => p.workPeriods || []);
        const timeElapsedMs = calculateTimeForPeriods(allWorkPeriods);
        
        const operatorIds = [...new Set(allWorkPeriods.map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = operatorsMap.get(id);
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
    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operators = operatorsSnapshot.docs.map(doc => doc.data() as Operator);
    
    const jobsSnapshot = await getDocs(collection(db, "jobOrders"));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const allWorkPeriods = jobs.flatMap(job => job.phases.flatMap(phase => phase.workPeriods || []));

    const now = new Date();
    const todayInterval = { start: startOfDay(now), end: endOfDay(now) };
    const thisWeekInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);

        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                 const start = new Date(period.start);
                if (period.end && isWithinInterval(start, interval)) {
                    const end = new Date(period.end);
                     if (isNaN(start.getTime()) || isNaN(end.getTime())) return acc;
                    return acc + differenceInMilliseconds(end, start);
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
    const jobRef = doc(db, "jobOrders", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) return null;
    
    const jobDetail = convertTimestampsToDates(jobSnap.data()) as JobOrder;

    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operatorsMap = new Map(operatorsSnapshot.docs.map(doc => [doc.id, doc.data() as Operator]));

    const phasesWithDetails = (jobDetail.phases || []).map(phase => {
        const timeElapsedMs = calculateTimeForPeriods(phase.workPeriods || []);
        const operatorIds = [...new Set((phase.workPeriods || []).map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = operatorsMap.get(id);
                return op ? `${op.nome} ${op.cognome}` : 'Sconosciuto';
            })
            .join(', ');

        return {
            ...phase,
            timeElapsed: formatDuration(timeElapsedMs),
            operators: operators || 'N/A',
        };
    });
    
    const totalTimeElapsedMs = calculateTimeForPeriods((jobDetail.phases || []).flatMap(p => p.workPeriods || []));

    return {
        ...jobDetail,
        phases: phasesWithDetails,
        totalTimeElapsed: formatDuration(totalTimeElapsedMs)
    };
}
