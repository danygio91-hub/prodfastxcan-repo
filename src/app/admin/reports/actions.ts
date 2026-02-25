'use server';

import { collection, getDocs, doc, getDoc, query as firestoreQuery, query, where, Timestamp, writeBatch, deleteDoc, runTransaction, updateDoc, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, Operator, WorkPeriod, MaterialWithdrawal, RawMaterial, JobPhase, RawMaterialType, ProductionProblemReport, WorkGroup, WorkPhaseTemplate } from '@/lib/mock-data';
import { differenceInMilliseconds, startOfDay, endOfDay, startOfWeek, endOfWeek, format, getWeek, startOfMonth, endOfMonth } from 'date-fns';
import { it } from 'date-fns/locale';
import { getOverallStatus, type OverallStatus } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import type { TimeTrackingSettings } from '../time-tracking-settings/actions';


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
    const start = new Date(period.start);
    if (isNaN(start.getTime())) return acc;
    
    // If a period is still active, its end time is 'now'.
    const end = period.end ? new Date(period.end) : new Date();
    if (isNaN(end.getTime())) return acc;

    return acc + differenceInMilliseconds(end, start);
  }, 0);
}

export type JobsReport = Awaited<ReturnType<typeof getJobsReport>>;

export async function getJobsReport() {
    const jobsRef = collection(db, "jobOrders");
    const q = firestoreQuery(jobsRef, where("status", "in", ["production", "completed", "suspended", "paused"]));
    const jobsSnapshot = await getDocs(q);
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    // Collect all unique operator IDs from all jobs
    const allOperatorIds = [...new Set(jobs.flatMap(job => 
        (job.phases || []).flatMap(phase => 
            (phase.workPeriods || []).map(wp => wp.operatorId)
        )
    ))].filter(id => id && typeof id === 'string' && id.trim() !== '');

    const operatorsMap = new Map<string, Operator>();
    if (allOperatorIds.length > 0) {
        // Firestore 'in' query is limited to 30 elements.
        const chunks = [];
        for (let i = 0; i < allOperatorIds.length; i += 30) {
            chunks.push(allOperatorIds.slice(i, i + 30));
        }

        for (const chunk of chunks) {
             if (chunk.length > 0) {
                const operatorsQuery = firestoreQuery(collection(db, "operators"), where("id", "in", chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, doc.data() as Operator);
                });
            }
        }
    }


    return jobs.map(job => {
        const allWorkPeriods = (job.phases || []).flatMap(p => p.workPeriods || []);
        const timeElapsedMs = calculateTimeForPeriods(allWorkPeriods);
        
        const operatorIds = [...new Set(allWorkPeriods.map(p => p.operatorId))];
        const operators = operatorIds
            .map(id => {
                const op = operatorsMap.get(id);
                return op ? op.nome : 'Sconosciuto';
            })
            .join(', ');

        return {
            id: job.id,
            cliente: job.cliente,
            details: job.details,
            status: getOverallStatus(job),
            timeElapsed: formatDuration(timeElapsedMs),
            operators: operators || 'N/A',
            deliveryDate: job.dataConsegnaFinale || 'N/D',
        };
    });
}

export type getOperatorsReport = typeof getOperatorsReport;

export async function getOperatorsReport(targetDateString?: string) {
    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operators = operatorsSnapshot.docs.map(doc => doc.data() as Operator);
    
    const referenceDate = targetDateString ? new Date(targetDateString) : new Date();
    
    const todayInterval = { start: startOfDay(referenceDate), end: endOfDay(referenceDate) };
    const thisWeekInterval = { start: startOfWeek(referenceDate, { weekStartsOn: 1 }), end: endOfWeek(referenceDate, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(referenceDate), end: endOfMonth(referenceDate) };

    const jobsSnapshot = await getDocs(collection(db, "jobOrders"));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    
    const allWorkPeriods = jobs.flatMap(job => 
        (job.phases || []).flatMap(phase => 
            (phase.workPeriods || []).map(wp => ({...wp, operatorId: wp.operatorId}))
        )
    );

    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);

        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                if (!period.start) return acc;
                const periodStart = new Date(period.start);
                const periodEnd = period.end ? new Date(period.end) : new Date();

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
        
        const getDepartmentDisplay = (operator: Operator) => {
            if (operator.role === 'supervisor') {
                return 'Officina';
            }
            if (Array.isArray(operator.reparto)) {
                return operator.reparto.join(', ');
            }
            return operator.reparto || 'N/D';
        };

        return {
            id: op.id,
            name: op.nome,
            department: getDepartmentDisplay(op),
            status: op.stato,
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
    const operatorRef = doc(db, "operators", operatorId);
    const operatorSnap = await getDoc(operatorRef);

    if (!operatorSnap.exists()) {
        return null;
    }

    const operator = operatorSnap.data() as Operator;
    const targetDate = new Date(date);
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    const jobsSnapshot = await getDocs(query(collection(db, "jobOrders")));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const jobsWorkedOn: {
        id: string,
        details: string,
        cliente: string,
        phases: { name: string, time: string, date: string }[]
    }[] = [];

    const timeMetrics = await getOperatorsReport(date);
    const operatorMetrics = timeMetrics.find(op => op.id === operatorId);

    jobs.forEach(job => {
        const phasesWorkedOn: { name: string, time: string, date: string }[] = [];
        
        (job.phases || []).forEach(phase => {
            const timeInPhaseMs = (phase.workPeriods || [])
                .filter(wp => wp.operatorId === operatorId)
                .reduce((acc, period) => {
                    if (!period.start) return acc;
                    const periodStart = new Date(period.start);
                    const periodEnd = period.end ? new Date(period.end) : new Date();

                    const overlapStart = Math.max(periodStart.getTime(), dayStart.getTime());
                    const overlapEnd = Math.min(periodEnd.getTime(), dayEnd.getTime());

                    if (overlapStart < overlapEnd) {
                        return acc + (overlapEnd - overlapStart);
                    }
                    return acc;
                }, 0);
            
            if (timeInPhaseMs > 0) {
                phasesWorkedOn.push({
                    name: phase.name,
                    time: formatDuration(timeInPhaseMs),
                    date: format(new Date(phase.workPeriods[0].start), 'dd/MM/yyyy'),
                });
            }
        });

        if (phasesWorkedOn.length > 0) {
            jobsWorkedOn.push({
                id: job.ordinePF,
                details: job.details,
                cliente: job.cliente,
                phases: phasesWorkedOn
            });
        }
    });

    return {
        operator,
        timeToday: operatorMetrics?.timeToday || '00:00:00',
        timeWeek: operatorMetrics?.timeWeek || '00:00:00',
        timeMonth: operatorMetrics?.timeMonth || '00:00:00',
        dateLabels: {
            today: format(targetDate, 'dd MMMM yyyy', { locale: it }),
            week: `Settimana ${getWeek(targetDate, { weekStartsOn: 1 })}`,
            month: format(targetDate, 'MMMM yyyy', { locale: it }),
        },
        jobsWorkedOn,
    };
}


export async function getJobTimeData(job: JobOrder): Promise<{ totalMs: number; isReliable: boolean; phasesWithDetails: Array<{ phase: JobPhase; timeMs: number }> }> {
    let totalMs = 0;
    let isReliable = true;
    let phasesWithDetails: Array<{ phase: JobPhase; timeMs: number }> = [];

    const settingsDoc = await getDoc(doc(db, 'configuration', 'timeTrackingSettings'));
    const timeSettings: TimeTrackingSettings = settingsDoc.exists() ? settingsDoc.data() as TimeTrackingSettings : { minimumPhaseDurationSeconds: 10 };
    const MINIMUM_VALID_PHASE_DURATION_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;

    const getPhaseTimeMilliseconds = (phase: JobPhase): number => {
        return (phase.workPeriods || []).reduce((phaseTotal, period) => {
            if (period.start && period.end) {
                const startTime = new Date(period.start).getTime();
                const endTime = new Date(period.end).getTime();
                if (!isNaN(startTime) && !isNaN(endTime)) {
                    return phaseTotal + (endTime - startTime);
                }
            }
            return phaseTotal;
        }, 0);
    };

    let groupSnap;
    if (job.workGroupId) {
        const groupRef = doc(db, 'workGroups', job.workGroupId);
        groupSnap = await getDoc(groupRef);
    }

    if (job.workGroupId && groupSnap && groupSnap.exists()) {
        const group = convertTimestampsToDates(groupSnap.data()) as WorkGroup;
        isReliable = false; 
        const groupPhases = group.phases || [];
        phasesWithDetails = groupPhases.map(groupPhase => {
            const totalGroupTimeMs = getPhaseTimeMilliseconds(groupPhase);
            const phaseTimeMs = group.totalQuantity > 0 ? (totalGroupTimeMs / group.totalQuantity) * job.qta : 0;
            totalMs += phaseTimeMs;
            return { phase: groupPhase, timeMs: phaseTimeMs };
        });
    } else {
        const individualPhases = job.phases || [];
        const timeTrackingPhases = individualPhases.filter(p => p.tracksTime !== false);
        const wasAnyPhaseForced = timeTrackingPhases.some(p => p.forced);
        const areAllPhasesCompleted = timeTrackingPhases.length > 0 && timeTrackingPhases.every(p => p.status === 'completed');
        const hasAnomalousShortPhase = timeTrackingPhases.some(p => {
            if (p.status !== 'completed') return false;
            const phaseDuration = getPhaseTimeMilliseconds(p);
            return phaseDuration > 0 && phaseDuration < MINIMUM_VALID_PHASE_DURATION_MS;
        });
        isReliable = areAllPhasesCompleted && !wasAnyPhaseForced && !hasAnomalousShortPhase;
        if (job.workGroupId) isReliable = false;
        phasesWithDetails = individualPhases.map(phase => {
            const phaseTimeMs = getPhaseTimeMilliseconds(phase);
            if (phase.tracksTime !== false) totalMs += phaseTimeMs;
            return { phase, timeMs: phaseTimeMs };
        });
    }
    return { totalMs, isReliable, phasesWithDetails };
}

export async function getJobDetailReport(jobId: string) {
    const jobRef = doc(db, "jobOrders", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) return null;
    
    let jobDetail = convertTimestampsToDates(jobSnap.data()) as JobOrder;
    
    const { totalMs, phasesWithDetails } = await getJobTimeData(jobDetail);

    // Operator mapping part
    const operatorIds = [...new Set(phasesWithDetails.flatMap(p => (p.phase.workPeriods || []).map(wp => wp.operatorId)))].filter(id => id && typeof id === 'string' && id.trim() !== '');
    const operatorsMap = new Map<string, string>();
    if (operatorIds.length > 0) {
        const chunks = [];
        const CHUNK_SIZE = 30;
        for (let i = 0; i < operatorIds.length; i += CHUNK_SIZE) {
            chunks.push(operatorIds.slice(i, i + CHUNK_SIZE));
        }
        for (const chunk of chunks) {
             if (chunk.length > 0) {
                const operatorsQuery = firestoreQuery(collection(db, "operators"), where('id', 'in', chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, (doc.data() as Operator).nome);
                });
            }
        }
    }
    
    const phasesWithOperatorNames = phasesWithDetails.map(p => {
        const phaseOperatorIds = [...new Set((p.phase.workPeriods || []).map(p => p.operatorId))];
        const operatorNames = phaseOperatorIds.map(id => operatorsMap.get(id) || 'Sconosciuto').join(', ');
        return {
            ...p.phase,
            timeElapsed: formatDuration(p.timeMs),
            operators: operatorNames || 'N/A',
        };
    });

    return {
        ...jobDetail,
        phases: phasesWithOperatorNames,
        totalTimeElapsed: formatDuration(totalMs),
        operatorsMap: Object.fromEntries(operatorsMap),
    };
}

export async function updateWorkPeriodsForPhase(
  jobId: string,
  phaseId: string,
  updatedPeriods: WorkPeriod[],
  uid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);

    const jobRef = doc(db, "jobOrders", jobId);

    await runTransaction(db, async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error("Commessa non trovata.");
      }

      const jobData = jobSnap.data() as JobOrder;
      const phases = jobData.phases || [];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);

      if (phaseIndex === -1) {
        throw new Error("Fase non trovata.");
      }

      phases[phaseIndex].workPeriods = updatedPeriods;
      transaction.update(jobRef, { phases: phases });
    });

    revalidatePath(`/admin/reports/${jobId}`);
    revalidatePath(`/admin/reports`);
    revalidatePath(`/admin/production-time-analysis`);
    revalidatePath('/admin/reports/operator', 'layout');

    return { success: true, message: "Tempi aggiornati." };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}


export type EnrichedMaterialWithdrawal = MaterialWithdrawal & { 
  materialType?: RawMaterialType;
  materialUnitOfMeasure?: 'n' | 'mt' | 'kg';
};

export async function getMaterialWithdrawals(dateRange?: { from?: Date; to?: Date }): Promise<EnrichedMaterialWithdrawal[]> {
    const withdrawalsRef = collection(db, "materialWithdrawals");
    let q = firestoreQuery(withdrawalsRef);

    if (dateRange && dateRange.from) {
        q = firestoreQuery(q, where("withdrawalDate", ">=", Timestamp.fromDate(startOfDay(dateRange.from))));
    }
    if (dateRange && dateRange.to) {
        q = firestoreQuery(q, where("withdrawalDate", "<=", Timestamp.fromDate(endOfDay(dateRange.to))));
    }

    const snapshot = await getDocs(q);
    const withdrawals: EnrichedMaterialWithdrawal[] = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as EnrichedMaterialWithdrawal);

    const operatorIds = [...new Set(withdrawals.map(w => w.operatorId))].filter(id => id && typeof id === 'string' && id.trim() !== '');
    const materialIds = [...new Set(withdrawals.map(w => w.materialId))].filter(id => id && typeof id === 'string' && id.trim() !== '');

    // Fetch operators (CHUNKED)
    const operatorsMap = new Map<string, Operator>();
    if (operatorIds.length > 0) {
        const CHUNK_SIZE = 30;
        for (let i = 0; i < operatorIds.length; i += CHUNK_SIZE) {
            const chunk = operatorIds.slice(i, i + 30);
            if (chunk.length > 0) {
                const operatorsQuery = firestoreQuery(collection(db, "operators"), where("id", "in", chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, doc.data() as Operator);
                });
            }
        }
    }
    withdrawals.forEach(w => {
        w.operatorName = operatorsMap.get(w.operatorId)?.nome || 'Sconosciuto';
    });


    // Fetch materials (CHUNKED)
    const materialsMap = new Map<string, RawMaterial>();
    if (materialIds.length > 0) {
        const CHUNK_SIZE = 30;
         for (let i = 0; i < materialIds.length; i += CHUNK_SIZE) {
            const chunk = materialIds.slice(i, i + CHUNK_SIZE);
             if (chunk.length > 0) {
                const materialsQuery = firestoreQuery(collection(db, "rawMaterials"), where("__name__", "in", chunk));
                const materialsSnapshot = await getDocs(materialsQuery);
                materialsSnapshot.forEach(doc => {
                    materialsMap.set(doc.id, doc.data() as RawMaterial);
                });
            }
        }
    }
    withdrawals.forEach(w => {
        const material = materialsMap.get(w.materialId);
        w.materialType = material?.type;
        w.materialUnitOfMeasure = material?.unitOfMeasure;
    });

    return withdrawals.sort((a, b) => new Date(b.withdrawalDate).getTime() - new Date(a.withdrawalDate).getTime());
}


export async function deleteSelectedWithdrawals(ids: string[]): Promise<{ success: boolean; message: string }> {
  if (ids.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  
  try {
    const validIds = ids.filter(id => id && typeof id === 'string');
    if (validIds.length === 0) throw new Error("ID non validi.");

    const withdrawalsRef = collection(db, "materialWithdrawals");
    const q = firestoreQuery(withdrawalsRef, where("__name__", "in", validIds));
    const withdrawalsSnapshot = await getDocs(q);
    
    if (withdrawalsSnapshot.empty) {
      return { success: false, message: 'Nessun prelievo valido trovato.' };
    }

    const withdrawals = withdrawalsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as MaterialWithdrawal);

    await runTransaction(db, async (transaction) => {
        const materialUpdates = new Map<string, { consumedWeight: number; consumedUnits: number }>();
        const jobUpdates = new Map<string, string[]>();
        
        for (const withdrawal of withdrawals) {
            const update = materialUpdates.get(withdrawal.materialId) || { consumedWeight: 0, consumedUnits: 0 };
            update.consumedWeight += withdrawal.consumedWeight || 0;
            if (typeof (withdrawal as any).consumedUnits === 'number') {
                update.consumedUnits += (withdrawal as any).consumedUnits;
            }
            materialUpdates.set(withdrawal.materialId, update);
            
            (withdrawal.jobIds || []).forEach(jobId => {
                if (!jobUpdates.has(jobId)) {
                    jobUpdates.set(jobId, []);
                }
                jobUpdates.get(jobId)!.push(withdrawal.id);
            });
        }

        const materialIds = Array.from(materialUpdates.keys());
        const materialDocs = await Promise.all(materialIds.map(id => transaction.get(doc(db, 'rawMaterials', id))));
        
        for (let i = 0; i < materialDocs.length; i++) {
            const materialDoc = materialDocs[i];
            if (materialDoc.exists()) {
                const materialData = materialDoc.data() as RawMaterial;
                const updates = materialUpdates.get(materialDoc.id)!;
                let newWeight = (materialData.currentWeightKg || 0) + updates.consumedWeight;
                let newUnits = (materialData.currentStockUnits || 0) + updates.consumedUnits;
                transaction.update(materialDoc.ref, { currentWeightKg: newWeight, currentStockUnits: newUnits });
            }
        }
        
        for (const [jobId, withdrawalIdsToRemove] of jobUpdates.entries()) {
            const jobRef = doc(db, 'jobOrders', jobId);
            const jobSnap = await transaction.get(jobRef);
            if (jobSnap.exists()) {
                const jobData = jobSnap.data() as JobOrder;
                const updatedPhases = (jobData.phases || []).map(phase => ({
                    ...phase,
                    materialConsumptions: (phase.materialConsumptions || []).filter(c => !withdrawalIdsToRemove.includes(c.withdrawalId!))
                }));
                transaction.update(jobRef, { phases: updatedPhases });
            }
        }
        
        for (const withdrawalDoc of withdrawalsSnapshot.docs) {
            transaction.delete(withdrawalDoc.ref);
        }
    });

    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${withdrawals.length} prelievi eliminati.` };
  
  } catch(error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore durante l'eliminazione." };
  }
}

export async function deleteAllWithdrawals(): Promise<{ success: boolean; message: string }> {
    const querySnapshot = await getDocs(collection(db, "materialWithdrawals"));
    if (querySnapshot.empty) return { success: true, message: 'Nessun prelievo.' };
    return await deleteSelectedWithdrawals(querySnapshot.docs.map(doc => doc.id));
}

// --- Production Time Analysis ---

export type ProductionTimeAnalysisReport = {
    articleCode: string;
    totalJobs: number;
    totalQuantity: number;
    averageMinutesPerPiece: number;
    averagePhaseTimes: Array<{
        name: string;
        averageMinutesPerPiece: number;
        type: WorkPhaseTemplate['type'];
    }>;
    jobs: Array<{
        id: string;
        cliente: string;
        qta: number;
        totalTimeMinutes: number;
        minutesPerPiece: number;
        isTimeCalculationReliable: boolean;
        phases: Array<{
            name: string;
            totalTimeMinutes: number;
            minutesPerPiece: number;
        }>
    }>;
};

export async function getProductionTimeAnalysisReport(): Promise<ProductionTimeAnalysisReport[]> {
    const jobsSnapshot = await getDocs(firestoreQuery(collection(db, "jobOrders"), where("status", "in", ["completed", "production", "suspended", "paused"])));
    const jobsToAnalyze = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const settingsDoc = await getDoc(doc(db, 'configuration', 'timeTrackingSettings'));
    const timeSettings: TimeTrackingSettings = settingsDoc.exists() ? settingsDoc.data() as TimeTrackingSettings : { minimumPhaseDurationSeconds: 10 };
    const MINIMUM_VALID_PHASE_DURATION_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;

    const templatesSnapshot = await getDocs(collection(db, "workPhaseTemplates"));
    const phaseTypeMap = new Map<string, WorkPhaseTemplate['type']>();
    templatesSnapshot.forEach(doc => phaseTypeMap.set(doc.data().name, doc.data().type));

    const analysisByArticle: { [articleCode: string]: ProductionTimeAnalysisReport } = {};
    const phaseDataByArticle: { [articleCode: string]: { [phaseName: string]: { totalMinutes: number; totalQuantity: number; type: WorkPhaseTemplate['type'] } } } = {};

    for (const job of jobsToAnalyze) {
        const articleCode = job.details;
        if (!articleCode || job.qta <= 0) continue;

        if (!analysisByArticle[articleCode]) {
            analysisByArticle[articleCode] = { articleCode, totalJobs: 0, totalQuantity: 0, averageMinutesPerPiece: 0, averagePhaseTimes: [], jobs: [] };
            phaseDataByArticle[articleCode] = {};
        }

        const { totalMs, isReliable, phasesWithDetails } = await getJobTimeData(job);
        const totalTimeMinutes = totalMs / (1000 * 60);
        const minutesPerPiece = totalTimeMinutes / job.qta;
        
        const phaseDetails = phasesWithDetails.filter(p => p.phase.tracksTime !== false).map(p => {
            const phaseTimeMinutes = p.timeMs / (1000 * 60);
            if (p.phase.status === 'completed' && !p.phase.forced && p.timeMs >= MINIMUM_VALID_PHASE_DURATION_MS) {
                 if (!phaseDataByArticle[articleCode][p.phase.name]) {
                    phaseDataByArticle[articleCode][p.phase.name] = { totalMinutes: 0, totalQuantity: 0, type: phaseTypeMap.get(p.phase.name) || 'production' };
                }
                phaseDataByArticle[articleCode][p.phase.name].totalMinutes += phaseTimeMinutes;
                phaseDataByArticle[articleCode][p.phase.name].totalQuantity += job.qta;
            }
             return { name: p.phase.name, totalTimeMinutes: phaseTimeMinutes, minutesPerPiece: phaseTimeMinutes / job.qta };
        });

        analysisByArticle[articleCode].totalJobs += 1;
        analysisByArticle[articleCode].totalQuantity += job.qta;
        analysisByArticle[articleCode].jobs.push({ id: job.ordinePF, cliente: job.cliente, qta: job.qta, totalTimeMinutes, minutesPerPiece, isTimeCalculationReliable: isReliable, phases: phaseDetails });
    }

    for (const articleCode in analysisByArticle) {
        const report = analysisByArticle[articleCode];
        const reliableJobs = report.jobs.filter(j => j.isTimeCalculationReliable);
        if (reliableJobs.length > 0) {
            report.averageMinutesPerPiece = reliableJobs.reduce((s, j) => s + j.totalTimeMinutes, 0) / reliableJobs.reduce((s, j) => s + j.qta, 0);
        }
        report.averagePhaseTimes = Object.entries(phaseDataByArticle[articleCode]).map(([name, data]) => ({
            name, averageMinutesPerPiece: data.totalQuantity > 0 ? data.totalMinutes / data.totalQuantity : 0, type: data.type,
        })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return Object.values(analysisByArticle).sort((a, b) => a.articleCode.localeCompare(b.articleCode));
}
