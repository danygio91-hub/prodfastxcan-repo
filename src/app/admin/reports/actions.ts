

'use server';

import { collection, getDocs, doc, getDoc, query, where, Timestamp, writeBatch, deleteDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, Operator, WorkPeriod, MaterialWithdrawal, RawMaterial, JobPhase, RawMaterialType, ProductionProblemReport, WorkGroup } from '@/lib/mock-data';
import { differenceInMilliseconds, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, getWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import type { OverallStatus } from '@/lib/types';
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
        const allWorkPeriods = (job.phases || []).flatMap(p => p.workPeriods || []);
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
            const preparationPhases = (job.phases || []).filter(p => (p.type ?? 'production') === 'preparation');
            const allPreparationDone = preparationPhases.every(p => p.status === 'completed');
            const isAnyPreparationActive = preparationPhases.some(p => p.status !== 'pending');

            if (isAnyPreparationActive && !allPreparationDone) {
                overallStatus = 'In Preparazione';
            } else {
                overallStatus = 'In Lavorazione';
            }
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

export async function getOperatorsReport(targetDateString?: string) {
    const operatorsSnapshot = await getDocs(collection(db, "operators"));
    const operators = operatorsSnapshot.docs.map(doc => doc.data() as Operator);
    
    const jobsSnapshot = await getDocs(collection(db, "jobOrders"));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const allWorkPeriods = jobs.flatMap(job => 
        (job.phases || []).flatMap(phase => 
            (phase.workPeriods || []).map(wp => ({...wp, operatorId: wp.operatorId}))
        )
    );
    
    const referenceDate = targetDateString ? new Date(targetDateString) : new Date();
    
    const todayInterval = { start: startOfDay(referenceDate), end: endOfDay(referenceDate) };
    const thisWeekInterval = { start: startOfWeek(referenceDate, { weekStartsOn: 1 }), end: endOfWeek(referenceDate, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(referenceDate), end: endOfMonth(referenceDate) };

    return operators.map(op => {
        const operatorPeriods = allWorkPeriods.filter(p => p.operatorId === op.id);

        const getTimeInInterval = (interval: { start: Date, end: Date }) => {
            return operatorPeriods.reduce((acc, period) => {
                if (!period.start) return acc;
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
            weekLabel: `Week ${getWeek(referenceDate, { weekStartsOn: 1 })}`,
            monthLabel: format(referenceDate, 'MMMM yyyy', { locale: it }),
        };
    });
}

export async function getJobDetailReport(jobId: string) {
    const jobRef = doc(db, "jobOrders", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) return null;
    
    let jobDetail = convertTimestampsToDates(jobSnap.data()) as JobOrder;
    let workGroupId = jobDetail.workGroupId;
    let group: WorkGroup | null = null;
    
    // If the job was part of a group, fetch the group's data to calculate proportional time
    if (workGroupId) {
        const groupRef = doc(db, 'workGroups', workGroupId);
        const groupSnap = await getDoc(groupRef);
        if (groupSnap.exists()) {
            group = convertTimestampsToDates(groupSnap.data()) as WorkGroup;
        }
    }

    const operatorIds = [...new Set((jobDetail.phases || []).flatMap(p => (p.workPeriods || []).map(wp => wp.operatorId)))];
    const operatorsMap = new Map<string, string>();

    if (operatorIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < operatorIds.length; i += 30) {
            chunks.push(operatorIds.slice(i, i + 30));
        }
        for (const chunk of chunks) {
             if (chunk.length > 0) {
                const operatorsQuery = query(collection(db, "operators"), where('id', 'in', chunk));
                const operatorsSnapshot = await getDocs(operatorsQuery);
                operatorsSnapshot.forEach(doc => {
                    operatorsMap.set(doc.data().id, (doc.data() as Operator).nome);
                });
            }
        }
    }

    let totalTimeElapsedMs = 0;

    const phasesWithDetails = (jobDetail.phases || []).map(phase => {
        let timeElapsedMs = 0;
        let operatorNames = 'N/A';

        // Use group data for time calculation if available
        if (group && group.phases) {
            const groupPhase = group.phases.find(p => p.id === phase.id);
            if (groupPhase) {
                const totalGroupTimeMs = calculateTimeForPeriods(groupPhase.workPeriods || []);
                const timePerUnit = group.totalQuantity > 0 ? totalGroupTimeMs / group.totalQuantity : 0;
                timeElapsedMs = timePerUnit * jobDetail.qta;
                
                const phaseOperatorIds = [...new Set((groupPhase.workPeriods || []).map(p => p.operatorId))];
                operatorNames = phaseOperatorIds.map(id => operatorsMap.get(id) || 'Sconosciuto').join(', ');
            }
        } else { // Fallback to individual job data if not in a group or group data is missing
            timeElapsedMs = calculateTimeForPeriods(phase.workPeriods || []);
            const phaseOperatorIds = [...new Set((phase.workPeriods || []).map(p => p.operatorId))];
            operatorNames = phaseOperatorIds.map(id => operatorsMap.get(id) || 'Sconosciuto').join(', ');
        }
        
        if(phase.tracksTime !== false) {
          totalTimeElapsedMs += timeElapsedMs;
        }

        return {
            ...phase,
            timeElapsed: formatDuration(timeElapsedMs),
            operators: operatorNames || 'N/A',
        };
    });
    
    return {
        ...jobDetail,
        phases: phasesWithDetails,
        totalTimeElapsed: formatDuration(totalTimeElapsedMs),
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
    await ensureAdmin(uid); // Ensure only admin/supervisor can perform this action

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
        throw new Error("Fase non trovata all'interno della commessa.");
      }

      // Replace the old work periods with the newly edited ones
      phases[phaseIndex].workPeriods = updatedPeriods;
      
      // Update the entire phases array
      transaction.update(jobRef, { phases: phases });
    });

    // Revalidate paths to update data across the app
    revalidatePath(`/admin/reports/${jobId}`);
    revalidatePath(`/admin/reports`);
    revalidatePath(`/admin/production-time-analysis`);
    
    // We also need to revalidate any operator report pages that might be affected,
    // although this is less direct. A layout revalidation is a broad but effective way.
    revalidatePath('/admin/reports/operator', 'layout');


    return { success: true, message: "Tempi di lavorazione aggiornati con successo." };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error updating work periods:", error);
    return { success: false, message: errorMessage };
  }
}


export async function getOperatorDetailReport(operatorId: string, targetDateString?: string) {
    const operatorRef = doc(db, "operators", operatorId);
    const operatorSnap = await getDoc(operatorRef);
    if (!operatorSnap.exists()) {
        return null;
    }
    const operator = operatorSnap.data() as Operator;

    const jobsSnapshot = await getDocs(collection(db, "jobOrders"));
    const jobs = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const referenceDate = targetDateString ? new Date(targetDateString) : new Date();
    
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

    const todayInterval = { start: startOfDay(referenceDate), end: endOfDay(referenceDate) };
    const thisWeekInterval = { start: startOfWeek(referenceDate, { weekStartsOn: 1 }), end: endOfWeek(referenceDate, { weekStartsOn: 1 }) };
    const thisMonthInterval = { start: startOfMonth(referenceDate), end: endOfMonth(referenceDate) };

    const getTimeInInterval = (interval: { start: Date, end: Date }) => {
        return operatorPeriods.reduce((acc, period) => {
            const periodStart = new Date(period.start);
            const periodEnd = period.end ? new Date(period.end) : new Date();
             if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) return acc;
            
            const overlapStart = Math.max(periodStart.getTime(), interval.start.getTime());
            const overlapEnd = Math.min(periodEnd.getTime(), interval.end.getTime());

            if (overlapStart < overlapEnd) {
                return acc + (overlapEnd - overlapStart);
            }
            return acc;
        }, 0);
    };
    
    const workSummaryByJob: { [jobId: string]: { cliente: string; details: string; phases: { [phaseName: string]: { duration: number; date: string } } } } = {};

    operatorPeriods.forEach(period => {
        const job = jobs.find(j => j.id === period.jobId);
        if (!job) return;

        const periodStart = new Date(period.start);
        if (periodStart < todayInterval.start || periodStart > todayInterval.end) {
          return; // Skip periods outside the selected day
        }
        
        const periodEnd = period.end ? new Date(period.end) : new Date();
        const duration = periodEnd.getTime() - periodStart.getTime();

        const workDate = format(periodStart, 'yyyy-MM-dd');

        if (!workSummaryByJob[period.jobId]) {
            workSummaryByJob[period.jobId] = {
                cliente: job.cliente,
                details: job.details,
                phases: {}
            };
        }
        
        const phaseKey = `${workDate}#${period.phaseName}`;
        if (!workSummaryByJob[period.jobId].phases[phaseKey]) {
            workSummaryByJob[period.jobId].phases[phaseKey] = { duration: 0, date: workDate };
        }
        workSummaryByJob[period.jobId].phases[phaseKey].duration += duration;
    });

    const jobsWorkedOn = Object.entries(workSummaryByJob).map(([jobId, data]) => ({
        id: jobId,
        cliente: data.cliente,
        details: data.details,
        phases: Object.entries(data.phases).map(([key, phaseData]) => {
            const [date, name] = key.split('#');
            return {
                name,
                time: formatDuration(phaseData.duration),
                date,
            };
        }).filter(p => p.time !== '00:00:00'),
    })).filter(j => j.phases.length > 0);

    return {
        operator,
        timeToday: formatDuration(getTimeInInterval(todayInterval)),
        timeWeek: formatDuration(getTimeInInterval(thisWeekInterval)),
        timeMonth: formatDuration(getTimeInInterval(thisMonthInterval)),
        jobsWorkedOn,
        dateLabels: {
            today: format(referenceDate, 'dd/MM/yyyy', { locale: it }),
            week: `Settimana ${getWeek(referenceDate, { weekStartsOn: 1 })}`,
            month: `Mese di ${format(referenceDate, 'MMMM yyyy', { locale: it })}`,
        }
    };
}


type EnrichedMaterialWithdrawal = MaterialWithdrawal & { materialType?: RawMaterialType };

export async function getMaterialWithdrawals(dateRange?: { from?: Date; to?: Date }): Promise<EnrichedMaterialWithdrawal[]> {
    const withdrawalsRef = collection(db, "materialWithdrawals");
    let q = query(withdrawalsRef);

    if (dateRange && dateRange.from) {
        q = query(q, where("withdrawalDate", ">=", Timestamp.fromDate(dateRange.from)));
    }
    if (dateRange && dateRange.to) {
        q = query(q, where("withdrawalDate", "<=", Timestamp.fromDate(dateRange.to)));
    }

    const snapshot = await getDocs(q);
    const withdrawals: EnrichedMaterialWithdrawal[] = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as EnrichedMaterialWithdrawal);

    const operatorIds = [...new Set(withdrawals.map(w => w.operatorId))];
    const materialIds = [...new Set(withdrawals.map(w => w.materialId))];

    // Fetch operators to enrich the report
    if (operatorIds.length > 0) {
        const operatorsSnapshot = await getDocs(query(collection(db, "operators"), where("id", "in", operatorIds)));
        const operatorsMap = new Map(operatorsSnapshot.docs.map(doc => [doc.data().id, doc.data() as Operator]));
        withdrawals.forEach(w => {
            w.operatorName = operatorsMap.get(w.operatorId)?.nome || 'Sconosciuto';
        });
    }

    // Fetch materials to get their type for grouping
    if (materialIds.length > 0) {
        const materialsSnapshot = await getDocs(query(collection(db, "rawMaterials"), where("__name__", "in", materialIds)));
        const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.id, doc.data() as RawMaterial]));
        withdrawals.forEach(w => {
            w.materialType = materialsMap.get(w.materialId)?.type;
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
            if (typeof (withdrawal as any).consumedUnits === 'number') {
                update.consumedUnits += (withdrawal as any).consumedUnits;
            }
            materialUpdates.set(withdrawal.materialId, update);
        }

        const materialIds = Array.from(materialUpdates.keys());
        if (materialIds.length === 0) {
            // This case handles if withdrawals exist but have no material to update for some reason.
            // Still need to delete the withdrawals themselves.
            for (const withdrawalDoc of withdrawalsSnapshot.docs) {
                transaction.delete(withdrawalDoc.ref);
            }
            return;
        }

        const materialRefs = materialIds.map(id => doc(db, 'rawMaterials', id));
        const materialDocs = await Promise.all(materialRefs.map(ref => transaction.get(ref)));
        
        for (let i = 0; i < materialDocs.length; i++) {
            const materialDoc = materialDocs[i];
            if (materialDoc.exists()) {
                const materialData = materialDoc.data() as RawMaterial;
                const updates = materialUpdates.get(materialDoc.id)!;
                
                let newWeight = (materialData.currentWeightKg || 0) + updates.consumedWeight;
                let newUnits = (materialData.currentStockUnits || 0) + updates.consumedUnits;

                if (materialData.unitOfMeasure === 'kg') {
                    newUnits = newWeight;
                }

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
        isTimeCalculationReliable: boolean; // New field
        phases: Array<{
            name: string;
            totalTimeMinutes: number;
            minutesPerPiece: number;
        }>
    }>;
};

function getPhaseTimeMilliseconds(phase: JobPhase): number {
    return (phase.workPeriods || []).reduce((phaseTotal, period) => {
        if (period.start && period.end) {
            return phaseTotal + (new Date(period.end).getTime() - new Date(period.start).getTime());
        }
        return phaseTotal;
    }, 0);
}

async function getJobTimeData(job: JobOrder, settings: TimeTrackingSettings): Promise<{ totalMs: number; isReliable: boolean; phases: JobPhase[] }> {
    let totalMs = 0;
    let jobPhases: JobPhase[] = [];
    let group: WorkGroup | null = null;
    
    const MINIMUM_VALID_PHASE_DURATION_MS = (settings.minimumPhaseDurationSeconds || 10) * 1000;

    if (job.workGroupId) {
        const groupRef = doc(db, 'workGroups', job.workGroupId);
        const groupSnap = await getDoc(groupRef);
        if (groupSnap.exists()) {
            group = convertTimestampsToDates(groupSnap.data()) as WorkGroup;
            jobPhases = group.phases || [];
        } else {
            jobPhases = job.phases || [];
        }
    } else {
        jobPhases = job.phases || [];
    }

    const timeTrackingPhases = jobPhases.filter(p => p.tracksTime !== false);
    
    const wasAnyPhaseForced = timeTrackingPhases.some(p => p.forced);
    const areAllPhasesCompleted = timeTrackingPhases.length > 0 && timeTrackingPhases.every(p => p.status === 'completed');
    
    const hasAnomalousShortPhase = timeTrackingPhases.some(p => {
        if (p.status !== 'completed') return false;
        const phaseDuration = getPhaseTimeMilliseconds(p);
        return phaseDuration > 0 && phaseDuration < MINIMUM_VALID_PHASE_DURATION_MS;
    });

    const isReliable = areAllPhasesCompleted && !wasAnyPhaseForced && !hasAnomalousShortPhase;

    for (const phase of timeTrackingPhases) {
        let phaseTimeMs = 0;
        if (job.workGroupId && group) {
            const groupPhase = (group.phases || []).find(p => p.id === phase.id);
            if (groupPhase) {
                const totalGroupTimeMs = getPhaseTimeMilliseconds(groupPhase);
                phaseTimeMs = (group.totalQuantity > 0) 
                    ? (totalGroupTimeMs / group.totalQuantity) * job.qta 
                    : 0;
            }
        } else {
             phaseTimeMs = getPhaseTimeMilliseconds(phase);
        }
        totalMs += phaseTimeMs;
    }
    
    return { totalMs, isReliable, phases: jobPhases };
}


export async function getProductionTimeAnalysisReport(): Promise<ProductionTimeAnalysisReport[]> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "in", ["completed", "production", "suspended"]));
    const jobsSnapshot = await getDocs(q);
    const jobsToAnalyze = jobsSnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    const settingsDoc = await getDoc(doc(db, 'configuration', 'timeTrackingSettings'));
    const timeSettings: TimeTrackingSettings = settingsDoc.exists() ? settingsDoc.data() as TimeTrackingSettings : { minimumPhaseDurationSeconds: 10 };


    const analysisByArticle: { [articleCode: string]: ProductionTimeAnalysisReport } = {};

    const allGroups: Map<string, WorkGroup> = new Map();

    for (const job of jobsToAnalyze) {
        if (job.workGroupId && !allGroups.has(job.workGroupId)) {
             const groupRef = doc(db, 'workGroups', job.workGroupId);
             const groupSnap = await getDoc(groupRef);
             if (groupSnap.exists()) {
                allGroups.set(job.workGroupId, convertTimestampsToDates(groupSnap.data()) as WorkGroup);
             }
        }
    }

    for (const job of jobsToAnalyze) {
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

        const { totalMs, isReliable, phases: jobPhases } = await getJobTimeData(job, timeSettings);
        const totalTimeMinutes = totalMs / (1000 * 60);
        
        if (job.qta <= 0) continue; // Skip jobs with no quantity
        
        const minutesPerPiece = totalTimeMinutes / job.qta;
        
        // Calculate phase details based on proportional time if in a group
        const phaseDetailsPromises = jobPhases
          .filter(p => p.tracksTime !== false)
          .map(async (phase) => {
            let phaseTimeMs = 0;
             if (job.workGroupId) {
                const group = allGroups.get(job.workGroupId);
                 if (group) {
                    const groupPhase = (group.phases || []).find(p => p.id === phase.id);
                    if (groupPhase) {
                        const totalGroupTimeMs = getPhaseTimeMilliseconds(groupPhase);
                        phaseTimeMs = (group.totalQuantity > 0)
                            ? (totalGroupTimeMs / group.totalQuantity) * job.qta
                            : 0;
                    }
                }
            } else {
                phaseTimeMs = getPhaseTimeMilliseconds(phase);
            }

            const phaseTimeMinutes = phaseTimeMs / (1000 * 60);
             return {
                name: phase.name,
                totalTimeMinutes: phaseTimeMinutes,
                minutesPerPiece: job.qta > 0 ? phaseTimeMinutes / job.qta : 0,
            };
        });

        const resolvedPhaseDetails = (await Promise.all(phaseDetailsPromises)).filter(p => p.totalTimeMinutes > 0);

        // Only add the job to the report if it has some tracked time
        if (totalTimeMinutes > 0) {
            const report = analysisByArticle[articleCode];
            report.totalJobs += 1;
            report.totalQuantity += job.qta;
            report.jobs.push({
                id: job.ordinePF,
                cliente: job.cliente,
                qta: job.qta,
                totalTimeMinutes: totalTimeMinutes,
                minutesPerPiece: minutesPerPiece,
                isTimeCalculationReliable: isReliable,
                phases: resolvedPhaseDetails,
            });
        }
    }

    // Calculate the final average based only on reliable jobs
    for (const articleCode in analysisByArticle) {
        const report = analysisByArticle[articleCode];
        if (report.jobs.length === 0) {
            delete analysisByArticle[articleCode];
            continue;
        }
        
        const reliableJobs = report.jobs.filter(j => j.isTimeCalculationReliable);
        
        const totalMinutesFromReliableJobs = reliableJobs.reduce((sum, j) => sum + j.totalTimeMinutes, 0);
        const totalQuantityFromReliableJobs = reliableJobs.reduce((sum, j) => sum + j.qta, 0);

        if (totalQuantityFromReliableJobs > 0) {
            report.averageMinutesPerPiece = totalMinutesFromReliableJobs / totalQuantityFromReliableJobs;
        } else {
            // If no reliable jobs, calculate average from all available jobs for a partial estimate but maybe set it to 0 to indicate it's not final
            report.averageMinutesPerPiece = 0; 
        }
    }

    return Object.values(analysisByArticle).sort((a, b) => a.articleCode.localeCompare(b.articleCode));
}
