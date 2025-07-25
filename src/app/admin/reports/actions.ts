

'use server';

import { collection, getDocs, doc, getDoc, query, where, Timestamp, writeBatch, deleteDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, Operator, WorkPeriod, MaterialWithdrawal, RawMaterial } from '@/lib/mock-data';
import { differenceInMilliseconds, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import type { OverallStatus } from '@/lib/types';
import { revalidatePath } from 'next/cache';

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
    const q = query(jobsRef, where("status", "in", ["production", "completed", "suspended"]));
    const jobsSnapshot = await getDocs(q);
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    // Collect all unique operator IDs from all jobs
    const allOperatorIds = [...new Set(jobs.flatMap(job => 
        (job.phases || []).flatMap(phase => 
            (phase.workPeriods || []).map(wp => wp.operatorId)
        )
    ))];

    const operatorsMap = new Map<string, Operator>();
    if (allOperatorIds.length > 0) {
        // Firestore 'in' query is limited to 30 elements. If there are more, we need to chunk the requests.
        const chunks = [];
        for (let i = 0; i < allOperatorIds.length; i += 30) {
            chunks.push(allOperatorIds.slice(i, i + 30));
        }

        for (const chunk of chunks) {
            if (chunk.length > 0) { // Ensure chunk is not empty
                const operatorsQuery = query(collection(db, "operators"), where("id", "in", chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, doc.data() as Operator);
                });
            }
        }
    }


    return jobs.map(job => {
        const allWorkPeriods = job.phases.flatMap(p => p.workPeriods || []);
        const timeElapsedMs = calculateTimeForPeriods(allWorkPeriods);
        
        const operatorIds = [...new Set(allWorkPeriods.map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = operatorsMap.get(id);
                return op ? op.nome : 'Sconosciuto';
            })
            .join(', ');

        let overallStatus: OverallStatus;
        if (job.status === 'suspended') {
            overallStatus = 'Sospesa';
        } else if (job.isProblemReported) {
            overallStatus = 'Problema';
        } else if (job.status === 'completed') {
            overallStatus = 'Completata';
        } else if (job.status === 'production') {
             overallStatus = 'In Lavorazione';
        } else {
            overallStatus = 'Da Iniziare';
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

    const allWorkPeriods = jobs.flatMap(job => 
        job.phases.flatMap(phase => 
            (phase.workPeriods || []).map(wp => ({...wp, operatorId: wp.operatorId}))
        )
    );
    
    const now = new Date();
    const todayInterval = { start: startOfDay(now), end: endOfDay(now) };
    const thisWeekInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);

        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                const periodStart = new Date(period.start);
                // If a period is still active, its end time is 'now'.
                const periodEnd = period.end ? new Date(period.end) : new Date();

                if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
                    return acc;
                }

                // Determine the overlapping interval
                const overlapStart = Math.max(periodStart.getTime(), interval.start.getTime());
                const overlapEnd = Math.min(periodEnd.getTime(), interval.end.getTime());

                // If there's a valid overlap, add the duration to the accumulator
                if (overlapStart < overlapEnd) {
                    return acc + (overlapEnd - overlapStart);
                }
                
                return acc;
            }, 0);
        };
        
        return {
            id: op.id,
            name: op.nome,
            department: Array.isArray(op.reparto) ? op.reparto.join(', ') : op.reparto,
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

    const operatorIds = [...new Set((jobDetail.phases || []).flatMap(p => (p.workPeriods || []).map(wp => wp.operatorId)))];
    const operatorsMap = new Map<string, Operator>();

    if (operatorIds.length > 0) {
        // Fetch only the needed operators
        const chunks = [];
        for (let i = 0; i < operatorIds.length; i += 30) {
            chunks.push(operatorIds.slice(i, i + 30));
        }
        for (const chunk of chunks) {
             if (chunk.length > 0) {
                const operatorsQuery = query(collection(db, "operators"), where('id', 'in', chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, doc.data() as Operator);
                });
            }
        }
    }


    const phasesWithDetails = (jobDetail.phases || []).map(phase => {
        const timeElapsedMs = calculateTimeForPeriods(phase.workPeriods || []);
        const operatorIds = [...new Set((phase.workPeriods || []).map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = operatorsMap.get(id);
                return op ? op.nome : 'Sconosciuto';
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

export async function getOperatorDetailReport(operatorId: string) {
    // 1. Get operator details
    const operatorRef = doc(db, "operators", operatorId);
    const operatorSnap = await getDoc(operatorRef);
    if (!operatorSnap.exists()) {
        return null;
    }
    const operator = operatorSnap.data() as Operator;

    // 2. Get all jobs
    const jobsSnapshot = await getDocs(collection(db, "jobOrders"));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    // 3. Filter work periods for this operator and calculate times
    const operatorPeriods: (WorkPeriod & {jobId: string, phaseName: string})[] = [];
    jobs.forEach(job => {
        (job.phases || []).forEach(phase => {
            (phase.workPeriods || []).forEach(wp => {
                if (wp.operatorId === operatorId) {
                    operatorPeriods.push({ ...wp, jobId: job.id, phaseName: phase.name });
                }
            });
        });
    });
    
    const now = new Date();
    const todayInterval = { start: startOfDay(now), end: endOfDay(now) };
    const thisWeekInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    const getTimeInInterval = (interval: { start: Date, end: Date }) => {
        return operatorPeriods.reduce((acc, period) => {
            const periodStart = new Date(period.start);
            const periodEnd = period.end ? new Date(period.end) : new Date(); // Use now for active periods
             if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
                return acc;
            }
            const overlapStart = Math.max(periodStart.getTime(), interval.start.getTime());
            const overlapEnd = Math.min(periodEnd.getTime(), interval.end.getTime());
            if (overlapStart < overlapEnd) {
                return acc + (overlapEnd - overlapStart);
            }
            return acc;
        }, 0);
    };
    
    const timeTodayMs = getTimeInInterval(todayInterval);
    const timeWeekMs = getTimeInInterval(thisWeekInterval);
    const timeMonthMs = getTimeInInterval(thisMonthInterval);

    // 4. Group work by job and phase
    const workSummaryByJob: { [jobId: string]: { cliente: string; details: string; phases: { [phaseName: string]: number } } } = {};
    operatorPeriods.forEach(period => {
        const job = jobs.find(j => j.id === period.jobId);
        if (!job) return;

        if (!workSummaryByJob[period.jobId]) {
            workSummaryByJob[period.jobId] = {
                cliente: job.cliente,
                details: job.details,
                phases: {}
            };
        }
        
        const duration = (period.end ? new Date(period.end).getTime() : new Date().getTime()) - new Date(period.start).getTime();
        
        if (!workSummaryByJob[period.jobId].phases[period.phaseName]) {
            workSummaryByJob[period.jobId].phases[period.phaseName] = 0;
        }
        workSummaryByJob[period.jobId].phases[period.phaseName] += duration;
    });

    const jobsWorkedOn = Object.entries(workSummaryByJob).map(([jobId, data]) => ({
        id: jobId,
        cliente: data.cliente,
        details: data.details,
        phases: Object.entries(data.phases).map(([phaseName, duration]) => ({
            name: phaseName,
            time: formatDuration(duration)
        }))
    }));

    return {
        operator,
        timeToday: formatDuration(timeTodayMs),
        timeWeek: formatDuration(timeWeekMs),
        timeMonth: formatDuration(timeMonthMs),
        jobsWorkedOn
    };
}

export async function getMaterialWithdrawals(dateRange?: { from?: Date; to?: Date }): Promise<MaterialWithdrawal[]> {
    const withdrawalsRef = collection(db, "materialWithdrawals");
    let q = query(withdrawalsRef);

    if (dateRange && dateRange.from) {
        q = query(q, where("withdrawalDate", ">=", Timestamp.fromDate(dateRange.from)));
    }
    if (dateRange && dateRange.to) {
        q = query(q, where("withdrawalDate", "<=", Timestamp.fromDate(dateRange.to)));
    }

    const snapshot = await getDocs(q);
    const withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);

    // Fetch operators to enrich the report
    const operatorIds = [...new Set(withdrawals.map(w => w.operatorId))];
    if (operatorIds.length > 0) {
        const operatorsSnapshot = await getDocs(query(collection(db, "operators"), where("id", "in", operatorIds)));
        const operatorsMap = new Map(operatorsSnapshot.docs.map(doc => [doc.data().id, doc.data() as Operator]));
        withdrawals.forEach(w => {
            w.operatorName = operatorsMap.get(w.operatorId)?.nome || 'Sconosciuto';
        });
    }

    return withdrawals.sort((a, b) => b.withdrawalDate.getTime() - a.withdrawalDate.getTime());
}


export async function deleteSelectedWithdrawals(ids: string[]): Promise<{ success: boolean; message: string }> {
  if (ids.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  
  try {
    const withdrawalsRef = collection(db, "materialWithdrawals");
    const q = query(withdrawalsRef, where("__name__", "in", ids));
    const withdrawalsSnapshot = await getDocs(q);
    
    if (withdrawalsSnapshot.empty) {
      return { success: false, message: 'Nessun prelievo valido da eliminare.' };
    }

    const withdrawals = withdrawalsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as MaterialWithdrawal);

    await runTransaction(db, async (transaction) => {
        const materialUpdates = new Map<string, { consumedWeight: number; consumedUnits: number }>();
        
        for (const withdrawal of withdrawals) {
            const update = materialUpdates.get(withdrawal.materialId) || { consumedWeight: 0, consumedUnits: 0 };
            update.consumedWeight += withdrawal.consumedWeight || 0;
            if (typeof withdrawal.consumedUnits === 'number') {
                update.consumedUnits += withdrawal.consumedUnits;
            }
            materialUpdates.set(withdrawal.materialId, update);
        }

        const materialIds = Array.from(materialUpdates.keys());
        if (materialIds.length === 0) return;

        const materialRefs = materialIds.map(id => doc(db, 'rawMaterials', id));
        const materialDocs = await Promise.all(materialRefs.map(ref => transaction.get(ref)));
        
        for (let i = 0; i < materialDocs.length; i++) {
            const materialDoc = materialDocs[i];
            if (materialDoc.exists()) {
                const materialData = materialDoc.data() as RawMaterial;
                const updates = materialUpdates.get(materialDoc.id)!;
                
                const newWeight = (materialData.currentWeightKg || 0) + updates.consumedWeight;
                const newUnits = (materialData.currentStockUnits || 0) + updates.consumedUnits;

                transaction.update(materialDoc.ref, { 
                    currentWeightKg: newWeight,
                    currentStockUnits: newUnits,
                });
            }
        }
        
        for (const withdrawalDoc of withdrawalsSnapshot.docs) {
            transaction.delete(withdrawalDoc.ref);
        }
    });

    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${withdrawals.length} prelievi eliminati e stock ripristinato.` };
  
  } catch(error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante l'eliminazione dei prelievi.";
    return { success: false, message: errorMessage };
  }
}

export async function deleteAllWithdrawals(): Promise<{ success: boolean; message: string }> {
    const withdrawalsRef = collection(db, "materialWithdrawals");
    const q = query(withdrawalsRef);
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        return { success: true, message: 'Nessun prelievo da eliminare.' };
    }
    const idsToDelete = querySnapshot.docs.map(doc => doc.id);
    return await deleteSelectedWithdrawals(idsToDelete);
}

// --- Production Time Analysis ---

export type ProductionTimeAnalysisReport = {
    articleCode: string;
    totalJobs: number;
    totalQuantity: number;
    averageMinutesPerPiece: number;
    jobs: Array<{
        id: string;
        cliente: string;
        qta: number;
        totalTimeMinutes: number;
        minutesPerPiece: number;
    }>;
};

function getTotalMilliseconds(job: JobOrder): number {
    return (job.phases || []).reduce((total, phase) => {
        const phaseTime = (phase.workPeriods || []).reduce((phaseTotal, period) => {
            if (period.start && period.end) {
                return phaseTotal + (new Date(period.end).getTime() - new Date(period.start).getTime());
            }
            return phaseTotal;
        }, 0);
        return total + phaseTime;
    }, 0);
}

export async function getProductionTimeAnalysisReport(): Promise<ProductionTimeAnalysisReport[]> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "==", "completed"));
    const jobsSnapshot = await getDocs(q);
    const completedJobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const analysisByArticle: { [articleCode: string]: ProductionTimeAnalysisReport } = {};

    for (const job of completedJobs) {
        const articleCode = job.details;
        if (!articleCode) continue;

        if (!analysisByArticle[articleCode]) {
            analysisByArticle[articleCode] = {
                articleCode: articleCode,
                totalJobs: 0,
                totalQuantity: 0,
                averageMinutesPerPiece: 0, // Will be calculated later
                jobs: [],
            };
        }

        const totalTimeMs = getTotalMilliseconds(job);
        const totalTimeMinutes = totalTimeMs / (1000 * 60);
        const minutesPerPiece = job.qta > 0 ? totalTimeMinutes / job.qta : 0;

        const report = analysisByArticle[articleCode];
        report.totalJobs += 1;
        report.totalQuantity += job.qta;
        report.jobs.push({
            id: job.ordinePF,
            cliente: job.cliente,
            qta: job.qta,
            totalTimeMinutes: totalTimeMinutes,
            minutesPerPiece: minutesPerPiece,
        });
    }

    // Calculate the final average
    for (const articleCode in analysisByArticle) {
        const report = analysisByArticle[articleCode];
        const totalMinutesForAllJobs = report.jobs.reduce((sum, j) => sum + j.totalTimeMinutes, 0);
        if (report.totalQuantity > 0) {
            report.averageMinutesPerPiece = totalMinutesForAllJobs / report.totalQuantity;
        }
    }

    return Object.values(analysisByArticle).sort((a, b) => a.articleCode.localeCompare(b.articleCode));
}
