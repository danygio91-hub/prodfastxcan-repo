'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, Operator, WorkPeriod, MaterialWithdrawal, RawMaterial, JobPhase, RawMaterialType, WorkPhaseTemplate, WorkGroup } from '@/types';
import { differenceInMilliseconds, startOfDay, endOfDay, startOfWeek, endOfWeek, format, getWeek, startOfMonth, endOfMonth } from 'date-fns';
import { it } from 'date-fns/locale';
import { getOverallStatus } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import { convertTimestampsToDates } from '@/lib/utils';

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
    const start = new Date(period.start);
    if (isNaN(start.getTime())) return acc;
    const end = period.end ? new Date(period.end) : new Date();
    if (isNaN(end.getTime())) return acc;
    return acc + differenceInMilliseconds(end, start);
  }, 0);
}

async function fetchRelevantJobsAndGroups(completedLimit = 400) {
    const activeJobsQuery = adminDb.collection("jobOrders").where("status", "in", ["production", "suspended", "paused"]).get();
    const completedJobsQuery = adminDb.collection("jobOrders").where("status", "==", "completed").limit(completedLimit).get();
    
    const activeGroupsQuery = adminDb.collection("workGroups").where("status", "in", ["production", "suspended", "paused"]).get();
    const completedGroupsQuery = adminDb.collection("workGroups").where("status", "==", "completed").limit(Math.max(100, Math.floor(completedLimit / 4))).get();

    const [activeJobs, completedJobs, activeGroups, completedGroups] = await Promise.all([
        activeJobsQuery, completedJobsQuery, activeGroupsQuery, completedGroupsQuery
    ]);

    const jobs = [...activeJobs.docs, ...completedJobs.docs].map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    const groups = [...activeGroups.docs, ...completedGroups.docs].map(doc => convertTimestampsToDates(doc.data()) as WorkGroup);

    return { jobs, groups };
}

export type JobsReport = Awaited<ReturnType<typeof getJobsReport>>;

export async function getJobsReport() {
    const { jobs, groups } = await fetchRelevantJobsAndGroups(200);

    const groupsMap = new Map<string, WorkGroup>();
    groups.forEach(group => groupsMap.set(group.id, group));

    const allOperatorIds = [...new Set([
        ...jobs.flatMap(job => (job.phases || []).flatMap(phase => (phase.workPeriods || []).map(wp => wp.operatorId))),
        ...Array.from(groupsMap.values()).flatMap(group => (group.phases || []).flatMap(phase => (phase.workPeriods || []).map(wp => wp.operatorId)))
    ])].filter(id => id && typeof id === 'string' && id.trim() !== '');

    const operatorsMap = new Map<string, Operator>();
    if (allOperatorIds.length > 0) {
        const CHUNK_SIZE = 30;
        for (let i = 0; i < allOperatorIds.length; i += CHUNK_SIZE) {
            const chunk = allOperatorIds.slice(i, i + CHUNK_SIZE);
            const operatorsSnapshot = await adminDb.collection("operators").where("id", "in", chunk).get();
            operatorsSnapshot.forEach(doc => { operatorsMap.set(doc.data().id, doc.data() as Operator); });
        }
    }

    return jobs.map(job => {
        let timeElapsedMs = 0;
        let jobOperators = '';

        if (job.workGroupId && groupsMap.has(job.workGroupId)) {
            const group = groupsMap.get(job.workGroupId)!;
            const groupTotalMs = (group.phases || []).flatMap(p => p.workPeriods || []).reduce((acc, wp) => {
                const start = new Date(wp.start).getTime();
                const end = wp.end ? new Date(wp.end).getTime() : new Date().getTime();
                return acc + (end - start);
            }, 0);
            timeElapsedMs = group.totalQuantity > 0 ? (groupTotalMs / group.totalQuantity) * job.qta : 0;
            
            jobOperators = [...new Set((group.phases || []).flatMap(p => (p.workPeriods || []).map(wp => operatorsMap.get(wp.operatorId)?.nome || 'Sconosciuto')))].join(', ');
        } else {
            const allWorkPeriods = (job.phases || []).flatMap(p => p.workPeriods || []);
            timeElapsedMs = calculateTimeForPeriods(allWorkPeriods);
            jobOperators = [...new Set(allWorkPeriods.map(p => operatorsMap.get(p.operatorId)?.nome || 'Sconosciuto'))].join(', ');
        }

        return { 
            id: job.id, 
            cliente: job.cliente, 
            details: job.details, 
            status: getOverallStatus(job), 
            timeElapsed: formatDuration(timeElapsedMs), 
            operators: jobOperators || 'N/A', 
            deliveryDate: job.dataConsegnaFinale || 'N/D' 
        };
    });

}

export async function getOperatorsReport(targetDateString?: string) {
    const operatorsSnapshot = await adminDb.collection("operators").get();
    const operators = operatorsSnapshot.docs.map(doc => doc.data() as Operator);
    const referenceDate = targetDateString ? new Date(targetDateString) : new Date();
    const todayInterval = { start: startOfDay(referenceDate), end: endOfDay(referenceDate) };
    const thisWeekInterval = { start: startOfWeek(referenceDate, { weekStartsOn: 1 }), end: endOfWeek(referenceDate, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(referenceDate), end: endOfMonth(referenceDate) };

    const { jobs, groups } = await fetchRelevantJobsAndGroups(400);

    const allWorkPeriods = [
        ...jobs.flatMap(job => (job.phases || []).flatMap(phase => (phase.workPeriods || []))),
        ...groups.flatMap(group => (group.phases || []).flatMap(phase => (phase.workPeriods || [])))
    ];


    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);
        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                if (!period.start) return acc;
                const periodStart = new Date(period.start);
                const periodEnd = period.end ? new Date(period.end) : new Date();
                const overlapStart = Math.max(periodStart.getTime(), interval.start.getTime());
                const overlapEnd = Math.min(periodEnd.getTime(), interval.end.getTime());
                return overlapStart < overlapEnd ? acc + (overlapEnd - overlapStart) : acc;
            }, 0);
        };
        return {
            id: op.id,
            name: op.nome,
            department: op.role === 'supervisor' ? 'Officina' : (Array.isArray(op.reparto) ? op.reparto.join(', ') : (op.reparto || 'N/D')),
            status: op.stato || 'inattivo',
            timeToday: formatDuration(getTimeInInterval(todayInterval)),
            timeWeek: formatDuration(getTimeInInterval(thisWeekInterval)),
            timeMonth: formatDuration(getTimeInInterval(thisMonthInterval)),
            todayDate: format(referenceDate, 'dd/MM/yyyy'),
            weekLabel: `Settimana ${getWeek(referenceDate, { weekStartsOn: 1 })}`,
            monthLabel: format(referenceDate, 'MMMM yyyy', { locale: it }),
        };
    });
}

export async function getOperatorDetailReport(operatorId: string, date: string) {
    const operatorSnap = await adminDb.collection("operators").doc(operatorId).get();
    if (!operatorSnap.exists) return null;
    const operator = operatorSnap.data() as Operator;
    const targetDate = new Date(date);
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);
    
    const { jobs, groups } = await fetchRelevantJobsAndGroups(400);

    const timeMetrics = await getOperatorsReport(date);
    const operatorMetrics = timeMetrics.find(op => op.id === operatorId);
    const jobsWorkedOn: any[] = [];
    jobs.forEach(job => {
        const phasesWorkedOn: any[] = [];
        const isCurrentlyInGroup = job.workGroupId && groups.some(g => g.id === job.workGroupId);
        
        if (isCurrentlyInGroup) {
            const group = groups.find(g => g.id === job.workGroupId)!;
            (group.phases || []).forEach(phase => {
                const groupTimeInPhaseMs = (phase.workPeriods || []).filter(wp => wp.operatorId === operatorId).reduce((acc, period) => {
                    const periodStart = new Date(period.start);
                    const periodEnd = period.end ? new Date(period.end) : new Date();
                    const overlapStart = Math.max(periodStart.getTime(), dayStart.getTime());
                    const overlapEnd = Math.min(periodEnd.getTime(), dayEnd.getTime());
                    return overlapStart < overlapEnd ? acc + (overlapEnd - overlapStart) : acc;
                }, 0);
                
                if (groupTimeInPhaseMs > 0) {
                    const proportionalTimeMs = group.totalQuantity > 0 ? (groupTimeInPhaseMs / group.totalQuantity) * job.qta : 0;
                    phasesWorkedOn.push({ 
                        name: `(GRUPPO) ${phase.name}`, 
                        time: formatDuration(proportionalTimeMs), 
                        date: format(dayStart, 'dd/MM/yyyy') 
                    });
                }
            });
        } else {
            (job.phases || []).forEach(phase => {
                const timeInPhaseMs = (phase.workPeriods || []).filter(wp => wp.operatorId === operatorId).reduce((acc, period) => {
                    const periodStart = new Date(period.start);
                    const periodEnd = period.end ? new Date(period.end) : new Date();
                    const overlapStart = Math.max(periodStart.getTime(), dayStart.getTime());
                    const overlapEnd = Math.min(periodEnd.getTime(), dayEnd.getTime());
                    return overlapStart < overlapEnd ? acc + (overlapEnd - overlapStart) : acc;
                }, 0);
                if (timeInPhaseMs > 0) phasesWorkedOn.push({ name: phase.name, time: formatDuration(timeInPhaseMs), date: format(new Date(phase.workPeriods[0].start), 'dd/MM/yyyy') });
            });
        }
        
        if (phasesWorkedOn.length > 0) jobsWorkedOn.push({ id: job.ordinePF, details: job.details, cliente: job.cliente, phases: phasesWorkedOn });
    });

    return { operator, timeToday: operatorMetrics?.timeToday || '00:00:00', timeWeek: operatorMetrics?.timeWeek || '00:00:00', timeMonth: operatorMetrics?.timeMonth || '00:00:00', dateLabels: { today: format(targetDate, 'dd MMMM yyyy', { locale: it }), week: `Settimana ${getWeek(targetDate, { weekStartsOn: 1 })}`, month: format(targetDate, 'MMMM yyyy', { locale: it }) }, jobsWorkedOn };
}

export async function getJobTimeData(job: JobOrder): Promise<{ totalMs: number; isReliable: boolean; phasesWithDetails: Array<{ phase: JobPhase; timeMs: number }> }> {
    let totalMs = 0;
    const settingsDoc = await adminDb.collection('configuration').doc('timeTrackingSettings').get();
    const timeSettings = settingsDoc.exists ? settingsDoc.data() : { minimumPhaseDurationSeconds: 10 } as any;
    const MIN_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;
    const getMs = (p: JobPhase) => (p.workPeriods || []).reduce((acc, wp) => wp.start && wp.end ? acc + (new Date(wp.end).getTime() - new Date(wp.start).getTime()) : acc, 0);
    
    let isReliable = true;
    let phasesWithDetails: any[] = [];

    // LOGICA PROPORZIONALE: Se la commessa fa parte di un gruppo, distribuisci il tempo in base alla quantità
    if (job.workGroupId) {
        const gSnap = await adminDb.collection('workGroups').doc(job.workGroupId).get();
        if (gSnap.exists) {
            const group = convertTimestampsToDates(gSnap.data()) as WorkGroup;
            isReliable = false; // I tempi dei gruppi sono sempre considerati stime proporzionali
            phasesWithDetails = (group.phases || []).map(gp => {
                const groupTotalMs = getMs(gp);
                // Distribuzione: (Tempo Gruppo / Pezzi Gruppo) * Pezzi Commessa
                const proportionalPhaseMs = group.totalQuantity > 0 ? (groupTotalMs / group.totalQuantity) * job.qta : 0;
                
                if (gp.tracksTime !== false) totalMs += proportionalPhaseMs;
                
                return { phase: gp, timeMs: proportionalPhaseMs };
            });
        }
    } else {
        const tracking = (job.phases || []).filter(p => p.tracksTime !== false);
        isReliable = tracking.length > 0 && tracking.every(p => p.status === 'completed') && !tracking.some(p => p.forced || (getMs(p) > 0 && getMs(p) < MIN_MS));
        phasesWithDetails = (job.phases || []).map(p => {
            const t = getMs(p);
            if (p.tracksTime !== false) totalMs += t;
            return { phase: p, timeMs: t };
        });
    }
    return { totalMs, isReliable, phasesWithDetails };
}

export async function getJobDetailReport(jobId: string) {
    const jobSnap = await adminDb.collection("jobOrders").doc(jobId).get();
    if (!jobSnap.exists) return null;
    let jobDetail = convertTimestampsToDates(jobSnap.data()) as JobOrder;
    const { totalMs, phasesWithDetails } = await getJobTimeData(jobDetail);
    const opIds = [...new Set(phasesWithDetails.flatMap(p => (p.phase.workPeriods || []).map(wp => wp.operatorId)))].filter(id => id && id.trim() !== '');
    const opMap = new Map<string, string>();
    if (opIds.length > 0) {
        const CHUNK_SIZE = 30;
        for (let i = 0; i < opIds.length; i += CHUNK_SIZE) {
            const chunk = opIds.slice(i, i + CHUNK_SIZE);
            const snap = await adminDb.collection("operators").where('id', 'in', chunk).get();
            snap.forEach(d => { opMap.set(d.data().id, d.data().nome); });
        }
    }
    return { ...jobDetail, phases: phasesWithDetails.map(p => ({ ...p.phase, timeElapsed: formatDuration(p.timeMs), operators: [...new Set((p.phase.workPeriods || []).map(wp => opMap.get(wp.operatorId) || 'Sconosciuto'))].join(', ') })), totalTimeElapsed: formatDuration(totalMs), operatorsMap: Object.fromEntries(opMap) };
}

export async function updateWorkPeriodsForPhase(jobId: string, phaseId: string, updatedPeriods: WorkPeriod[], uid: string) {
    await ensureAdmin(uid);
    const jobRef = adminDb.collection("jobOrders").doc(jobId);
    await adminDb.runTransaction(async (t) => {
        const snap = await t.get(jobRef);
        if (!snap.exists) throw new Error("Non trovata.");
        const phs = snap.data()?.phases || [];
        const idx = phs.findIndex((p:any) => p.id === phaseId);
        if (idx !== -1) { phs[idx].workPeriods = updatedPeriods; t.update(jobRef, { phases: phs }); }
    });
    revalidatePath(`/admin/reports/${jobId}`);
    return { success: true, message: "Aggiornato." };
}

export type EnrichedMaterialWithdrawal = MaterialWithdrawal & { materialType?: RawMaterialType; materialUnitOfMeasure?: string; };

export async function getMaterialWithdrawals(range?: { from?: Date; to?: Date }) {
    let q: admin.firestore.Query = adminDb.collection("materialWithdrawals");
    if (range?.from) q = q.where("withdrawalDate", ">=", admin.firestore.Timestamp.fromDate(startOfDay(range.from)));
    if (range?.to) q = q.where("withdrawalDate", "<=", admin.firestore.Timestamp.fromDate(endOfDay(range.to)));
    const snap = await q.get();
    const withdrawals = snap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as EnrichedMaterialWithdrawal);
    const mIds = [...new Set(withdrawals.map(w => w.materialId))].filter(Boolean);
    const mMap = new Map<string, RawMaterial>();
    if (mIds.length > 0) {
        const CHUNK_SIZE = 30;
        for (let i = 0; i < mIds.length; i += CHUNK_SIZE) {
            const chunk = mIds.slice(i, i + CHUNK_SIZE);
            const mSnap = await adminDb.collection("rawMaterials").where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
            mSnap.forEach(d => mMap.set(d.id, d.data() as RawMaterial));
        }
    }
    withdrawals.forEach(w => { const m = mMap.get(w.materialId); w.materialType = m?.type; w.materialUnitOfMeasure = m?.unitOfMeasure; });
    return withdrawals.sort((a, b) => new Date(b.withdrawalDate).getTime() - new Date(a.withdrawalDate).getTime());
}

export async function deleteSelectedWithdrawals(ids: string[]) {
    await adminDb.runTransaction(async (t) => {
        const snaps = await Promise.all(ids.map(id => t.get(adminDb.collection("materialWithdrawals").doc(id))));
        for (const snap of snaps) {
            if (!snap.exists) continue;
            const w = snap.data() as MaterialWithdrawal;
            const mRef = adminDb.collection('rawMaterials').doc(w.materialId);
            const mSnap = await t.get(mRef);
            if (mSnap.exists) {
                const m = mSnap.data() as RawMaterial;
                t.update(mRef, { currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight, currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0) });
            }
            t.delete(snap.ref);
        }
    });
    revalidatePath('/admin/reports');
    return { success: true, message: 'Eliminati.' };
}

export async function deleteAllWithdrawals() {
    const snap = await adminDb.collection("materialWithdrawals").get();
    return await deleteSelectedWithdrawals(snap.docs.map(d => d.id));
}

export async function declareWithdrawals(ids: string[], uid: string) {
    try {
        await ensureAdmin(uid);
        if (!ids.length) return { success: false, message: "Nessun prelievo selezionato." };

        const batch = adminDb.batch();
        const now = new Date().toISOString();

        ids.forEach(id => {
            const ref = adminDb.collection("materialWithdrawals").doc(id);
            batch.update(ref, {
                isDeclared: true,
                declaredAt: now
            });
        });

        await batch.commit();
        revalidatePath('/admin/reports');
        return { success: true, message: `${ids.length} prelievi dichiarati con successo.` };
    } catch (error) {
        console.error("Error declaring withdrawals:", error);
        return { success: false, message: "Errore durante la dichiarazione." };
    }
}

export type ProductionTimeAnalysisReport = {
    articleCode: string; totalJobs: number; totalQuantity: number; averageMinutesPerPiece: number;
    averagePhaseTimes: Array<{ name: string; averageMinutesPerPiece: number; type: WorkPhaseTemplate['type']; }>;
    jobs: Array<{ id: string; cliente: string; qta: number; totalTimeMinutes: number; minutesPerPiece: number; isTimeCalculationReliable: boolean; phases: Array<{ name: string; totalTimeMinutes: number; minutesPerPiece: number; }> }>;
};

export async function getProductionTimeAnalysisReport(): Promise<ProductionTimeAnalysisReport[]> {
    // Optimization: only consider the last 100 completed/in-production jobs for average calculation
    // to keep performance stable even with large histories.
    const jobsSnap = await adminDb.collection("jobOrders")
        .where("status", "in", ["completed", "production", "suspended", "paused"])
        .limit(100)
        .get();

    const jobs = jobsSnap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    // Sort in-memory to avoid requiring a composite index
    jobs.sort((a, b) => {
        const dateA = a.dataConsegnaFinale || '';
        const dateB = b.dataConsegnaFinale || '';
        return dateB.localeCompare(dateA);
    });

    const settingsDoc = await adminDb.collection('configuration').doc('timeTrackingSettings').get();
    const timeSettings = settingsDoc.exists ? settingsDoc.data() : { minimumPhaseDurationSeconds: 10 } as any;
    const MIN_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;
    
    // Fetch necessary templates upfront to avoid N+1 queries
    const tSnap = await adminDb.collection("workPhaseTemplates").get();
    
    const typeMap = new Map<string, WorkPhaseTemplate['type']>();
    tSnap.forEach(d => typeMap.set(d.data().name, d.data().type));
    
    const workGroupIds = [...new Set(jobs.map(j => j.workGroupId).filter(Boolean))] as string[];
    const groupsMap = new Map<string, WorkGroup>();
    if (workGroupIds.length > 0) {
        for (let i = 0; i < workGroupIds.length; i += 30) {
            const chunk = workGroupIds.slice(i, i + 30);
            const snap = await adminDb.collection("workGroups").where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
            snap.forEach(d => groupsMap.set(d.id, convertTimestampsToDates(d.data()) as WorkGroup));
        }
    }
    
    const analysis: { [code: string]: any } = {};
    const phaseData: { [code: string]: any } = {};

    for (const job of jobs) {
        if (!job.details || job.qta <= 0) continue;
        const code = job.details;
        
        if (!analysis[code]) { 
            analysis[code] = { articleCode: code, totalJobs: 0, totalQuantity: 0, averageMinutesPerPiece: 0, averagePhaseTimes: [], jobs: [] }; 
            phaseData[code] = {}; 
        }

        // Optimized job time calculation (avoiding separate await calls)
        let totalMs = 0;
        let isReliable = true;
        let phasesWithDetails: any[] = [];
        const calculateMs = (p: JobPhase) => (p.workPeriods || []).reduce((acc, wp) => wp.start && wp.end ? acc + (new Date(wp.end).getTime() - new Date(wp.start).getTime()) : acc, 0);

        if (job.workGroupId && groupsMap.has(job.workGroupId)) {
            const group = groupsMap.get(job.workGroupId)!;
            isReliable = false;
            phasesWithDetails = (group.phases || []).map(gp => {
                const groupMs = calculateMs(gp);
                const proportionalMs = group.totalQuantity > 0 ? (groupMs / group.totalQuantity) * job.qta : 0;
                if (gp.tracksTime !== false) totalMs += proportionalMs;
                return { phase: gp, timeMs: proportionalMs };
            });
        } else {
            const tracking = (job.phases || []).filter(p => p.tracksTime !== false);
            isReliable = tracking.length > 0 && tracking.every(p => p.status === 'completed') && !tracking.some(p => p.forced || (calculateMs(p) > 0 && calculateMs(p) < MIN_MS));
            phasesWithDetails = (job.phases || []).map(p => {
                const t = calculateMs(p);
                if (p.tracksTime !== false) totalMs += t;
                return { phase: p, timeMs: t };
            });
        }

        const pDetails = phasesWithDetails.filter(p => p.phase.tracksTime !== false).map(p => {
            const min = p.timeMs / 60000;
            if (p.phase.status === 'completed' && !p.phase.forced && p.timeMs >= MIN_MS) {
                if (!phaseData[code][p.phase.name]) phaseData[code][p.phase.name] = { totalMinutes: 0, totalQuantity: 0, type: typeMap.get(p.phase.name) || 'production' };
                phaseData[code][p.phase.name].totalMinutes += min;
                phaseData[code][p.phase.name].totalQuantity += job.qta;
            }
            return { name: p.phase.name, totalTimeMinutes: min, minutesPerPiece: min / job.qta };
        });

        analysis[code].totalJobs++; 
        analysis[code].totalQuantity += job.qta;
        analysis[code].jobs.push({ 
            id: job.ordinePF, 
            cliente: job.cliente, 
            qta: job.qta, 
            totalTimeMinutes: totalMs / 60000, 
            minutesPerPiece: job.qta > 0 ? (totalMs / 60000) / job.qta : 0, 
            isTimeCalculationReliable: isReliable, 
            phases: pDetails 
        });
    }

    Object.values(analysis).forEach((r:any) => {
        const reliableJobs = r.jobs.filter((j:any) => j.isTimeCalculationReliable);
        if (reliableJobs.length > 0) {
            const totalReliableMs = reliableJobs.reduce((s:number, j:any) => s + (j.totalTimeMinutes * 60000), 0);
            const totalReliableQty = reliableJobs.reduce((s:number, j:any) => s + j.qta, 0);
            r.averageMinutesPerPiece = totalReliableQty > 0 ? (totalReliableMs / 60000) / totalReliableQty : 0;
        }
        r.averagePhaseTimes = Object.entries(phaseData[r.articleCode]).map(([name, d]:any) => ({ name, averageMinutesPerPiece: d.totalQuantity > 0 ? d.totalMinutes / d.totalQuantity : 0, type: d.type })).sort((a:any, b:any) => a.name.localeCompare(b.name));
    });

    return Object.values(analysis).sort((a:any, b:any) => a.articleCode.localeCompare(b.articleCode));
}
