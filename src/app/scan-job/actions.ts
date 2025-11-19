
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, MaterialConsumption, RawMaterialType, ActiveMaterialSessionData, WorkGroup, Operator, WorkPhaseTemplate } from '@/lib/mock-data';
import * as z from 'zod';
import { ensureAdmin } from '@/lib/server-auth';


// Helper function to convert Firestore Timestamps to Dates in nested objects
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

/**
 * Helper function to propagate state changes from a group to its member job orders.
 * @param transaction Firestore transaction object.
 * @param groupData The WorkGroup data containing the state to propagate.
 */
async function propagateGroupUpdatesToJobs(transaction: any, groupData: WorkGroup) {
    if (!groupData.jobOrderIds || groupData.jobOrderIds.length === 0) return;
    
    const updatePayload: { [key: string]: any } = {
        phases: groupData.phases,
        status: groupData.status,
    };

    const jobRefs = groupData.jobOrderIds.map(id => doc(db, 'jobOrders', id));
    jobRefs.forEach(jobRef => {
        transaction.update(jobRef, updatePayload);
    });
}


export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    const isWorkGroup = id.startsWith('group-');
    const collectionName = isWorkGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, id);
    const docSnap = await getDoc(itemRef);

    if (!docSnap.exists()) return null;

    const data = convertTimestampsToDates(docSnap.data());

    if (isWorkGroup) {
        const group = data as WorkGroup;
        // The client-side logic will handle the operator view.
        // We pass the group status as is.
        return {
            id: group.id,
            cliente: group.cliente,
            qta: group.totalQuantity,
            department: group.department,
            details: group.details,
            ordinePF: group.jobOrderPFs?.join(', ') || 'Gruppo',
            numeroODL: group.numeroODL || 'N/D',
            numeroODLInterno: group.numeroODLInterno || 'N/D',
            dataConsegnaFinale: group.dataConsegnaFinale || 'N/D',
            postazioneLavoro: 'Multi-Commessa',
            phases: group.phases || [],
            overallStartTime: group.overallStartTime,
            overallEndTime: group.overallEndTime,
            isProblemReported: group.isProblemReported,
            problemType: group.problemType,
            problemNotes: group.problemNotes,
            problemReportedBy: group.problemReportedBy,
            status: group.status,
            workCycleId: group.workCycleId,
            workGroupId: group.id,
        };
    }

    return data as JobOrder;
}

export async function verifyAndGetJobOrder(scannedData: {
  ordinePF: string;
  codice: string;
  qta: string; // Keep as string for comparison flexibility
}): Promise<JobOrder | { error: string; title?: string }> {
  const sanitizedId = scannedData.ordinePF.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
  const jobRef = doc(db, "jobOrders", sanitizedId);
  const docSnap = await getDoc(jobRef);

  if (!docSnap.exists()) {
    return {
      error: `Commessa con ID "${scannedData.ordinePF}" non trovata nel database.`,
      title: 'Commessa non Trovata',
    };
  }

  const job = convertTimestampsToDates(docSnap.data()) as JobOrder;

  // If the job belongs to a group, always prioritize opening the group context.
  if (job.workGroupId) {
    const groupRef = doc(db, 'workGroups', job.workGroupId);
    const groupSnap = await getDoc(groupRef);
    
    // If the group exists, return the group data. This forces the user into the group context.
    if (groupSnap.exists()) {
      const groupData = await getJobOrderById(job.workGroupId);
      if (groupData) {
        return groupData;
      }
    }
    // If the group does NOT exist (it was dissolved), the code will proceed to treat the job as a standalone job.
  }

  // This block is now for standalone jobs or jobs that have been ungrouped.
  if (!['production', 'suspended', 'paused'].includes(job.status)) {
    return {
      error: `La commessa "${scannedData.ordinePF}" non è in produzione, sospesa o in pausa. Stato attuale: ${job.status}.`,
      title: 'Commessa non Lavorabile',
    };
  }

  // This check is now only for non-grouped jobs or jobs that have been ungrouped.
  if (job.details !== scannedData.codice || job.qta.toString() !== scannedData.qta) {
    return {
      error: `I dati scansionati non corrispondono. Attesi: Articolo "${job.details}", Qta "${job.qta}". Scansionati: Articolo "${scannedData.codice}", Qta "${scannedData.qta}".`,
      title: 'Dati non Corrispondenti',
    };
  }
  
  const jobCopy: JobOrder = JSON.parse(JSON.stringify(job));
  
  jobCopy.phases = (jobCopy.phases || []).map(p => ({
    ...p,
    workPeriods: p.workPeriods || [], 
    materialConsumptions: p.materialConsumptions || [],
  }));
  
  jobCopy.isProblemReported = jobCopy.isProblemReported || false;
  
  return jobCopy;
}

function updatePhasesMaterialReadiness(phases: JobPhase[]): JobPhase[] {
    const sortedPhases = [...phases].sort((a, b) => a.sequence - b.sequence);

    const allPrepCompleted = sortedPhases
        .filter(p => p.type === 'preparation' && p.postponed !== true)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    for (let i = 0; i < sortedPhases.length; i++) {
        const currentPhase = sortedPhases[i];
        
        // If material is marked as missing, it's not ready. This has priority.
        if (currentPhase.materialStatus === 'missing') {
            currentPhase.materialReady = false;
            continue;
        }

        if (currentPhase.type === 'preparation') {
            currentPhase.materialReady = true;
            continue;
        }

        if (currentPhase.isIndependent) {
            currentPhase.materialReady = true;
            continue;
        }

        // For sequential phases (production, quality, packaging)
        // Condition 1: All non-postponed preparations must be complete.
        if (!allPrepCompleted) {
            currentPhase.materialReady = false;
            continue;
        }

        // Condition 2: Check the preceding sequential phase.
        let previousSequentialPhase: JobPhase | null = null;
        for (let j = i - 1; j >= 0; j--) {
            if (!sortedPhases[j].isIndependent) {
                previousSequentialPhase = sortedPhases[j];
                break;
            }
        }
        
        if (!previousSequentialPhase) {
             // This is the first sequential phase after preparations, so it's ready.
            currentPhase.materialReady = true;
        } else {
            // It's ready if the previous one has been started or is done.
            const isPreviousStartedOrDone = ['in-progress', 'completed', 'skipped', 'paused'].includes(previousSequentialPhase.status);
            currentPhase.materialReady = isPreviousStartedOrDone;
        }
    }

    return sortedPhases;
}

export async function updateOperatorStatus(operatorId: string, activeJobId: string | null, activePhaseName: string | null) {
  const operatorRef = doc(db, 'operators', operatorId);
  try {
    const payload: { activeJobId: string | null; activePhaseName: string | null; stato?: 'attivo' | 'inattivo' } = {
        activeJobId,
        activePhaseName,
    };
    if (activeJobId === null && activePhaseName === null) {
        payload.stato = 'inattivo';
    } else {
        payload.stato = activeJobId ? 'attivo' : 'inattivo';
    }
    await updateDoc(operatorRef, payload);
    return { success: true };
  } catch (error) {
    console.error("Failed to update operator status:", error);
    return { success: false, message: "Failed to update operator status." };
  }
}

export async function updateJob(jobData: JobOrder): Promise<{ success: boolean; message: string; }> {
    const jobRef = doc(db, "jobOrders", jobData.id);

    try {
        const updatedPhases = updatePhasesMaterialReadiness(jobData.phases || []);
        jobData.phases = updatedPhases;

        const allRequiredPhasesCompleted = (jobData.phases || []).length > 0 &&
            (jobData.phases || []).filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped');

        if (allRequiredPhasesCompleted && !jobData.isProblemReported && jobData.status !== 'suspended') {
            jobData.status = 'completed';
            if (!jobData.overallEndTime) {
                jobData.overallEndTime = new Date();
            }
        }

        const dataToSave = JSON.parse(JSON.stringify(jobData));

        await setDoc(jobRef, dataToSave, { merge: true });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/reports');
        revalidatePath(`/admin/reports/${jobData.id}`);

        return { success: true, message: `Commessa ${jobData.id} aggiornata con successo.` };
    } catch (error) {
        console.error("Error updating job:", error);
        return { success: false, message: 'Commessa non trovata o errore durante l\'aggiornamento.' };
    }
}


export async function updateWorkGroup(groupData: WorkGroup, operatorId: string): Promise<{ success: boolean; message: string; }> {
    const groupRef = doc(db, "workGroups", groupData.id);
    
    try {
        const groupPhases = groupData.phases || [];
        const allRequiredPhasesCompleted = groupPhases.length > 0 && 
            groupPhases.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped');

        if (allRequiredPhasesCompleted) {
            groupData.status = 'completed';
            if (!groupData.overallEndTime) {
                groupData.overallEndTime = new Date();
            }
        } else {
            const isAnyPhaseInProgress = (groupData.phases || []).some(p => p.status === 'in-progress');
            groupData.status = isAnyPhaseInProgress ? 'production' : 'paused';
        }
        
        const dataToSave = JSON.parse(JSON.stringify(groupData));
        
        await runTransaction(db, async (transaction) => {
            transaction.set(groupRef, dataToSave, { merge: true });
            await propagateGroupUpdatesToJobs(transaction, groupData);
             // Clear operator status if the group is now complete
            if (groupData.status === 'completed') {
                await updateOperatorStatus(operatorId, null, null);
            }
        });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/work-group-management');

        return { success: true, message: `Gruppo di lavoro ${groupData.id} aggiornato.` };

    } catch (error) {
        console.error("Error updating work group:", error);
        return { success: false, message: "Errore durante l'aggiornamento del gruppo." };
    }
}


export async function resolveJobProblem(jobId: string, uid: string): Promise<{ success: boolean; message: string; }> {
  try {
    const operator = await ensureAdmin(uid); // Re-use ensureAdmin for role check
    if (operator.role !== 'admin' && operator.role !== 'supervisor') {
      throw new Error('Permessi non sufficienti.');
    }

    const isGroup = jobId.startsWith('group-');
    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, jobId);
    
    await runTransaction(db, async (transaction) => {
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato.");

        const itemData = itemSnap.data() as JobOrder | WorkGroup;
        
        const updatePayload: any = { 
            isProblemReported: false,
            problemType: deleteField(),
            problemNotes: deleteField(),
            problemReportedBy: deleteField()
        };

        const failedPhaseIndex = itemData.phases.findIndex(p => p.qualityResult === 'failed');
        if (failedPhaseIndex !== -1) {
            const updatedPhases = [...itemData.phases];
            updatedPhases[failedPhaseIndex].status = 'pending';
            updatedPhases[failedPhaseIndex].qualityResult = null;
            updatePayload.phases = updatedPhases;
        }

        transaction.update(itemRef, updatePayload);

        if (isGroup) {
            ( (itemData as WorkGroup).jobOrderIds || []).forEach(individualJobId => {
                const jobRef = doc(db, 'jobOrders', individualJobId);
                transaction.update(jobRef, updatePayload);
            });
        }
    });

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
    
    return { success: true, message: 'Problema risolto. La lavorazione è stata sbloccata.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error resolving job problem:", error);
    return { success: false, message: errorMessage };
  }
}


export async function closeMaterialSessionAndUpdateStock(
  sessionData: ActiveMaterialSessionData,
  closingWeight: number,
  operatorId: string,
): Promise<{ success: boolean; message: string }> {
  const materialRef = doc(db, "rawMaterials", sessionData.materialId);
  const jobRefs = sessionData.associatedJobs.map(j => doc(db, "jobOrders", j.jobId));
  
  try {
    await runTransaction(db, async (transaction) => {
        // --- 1. ALL READS FIRST ---
        const materialDoc = await transaction.get(materialRef);
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));

        // --- 2. VALIDATION AND PREPARATION ---
        if (!materialDoc.exists()) {
            throw new Error("Materia prima associata alla sessione non trovata.");
        }
        
        const consumedWeight = sessionData.grossOpeningWeight - closingWeight;
        if (consumedWeight < 0) {
            throw new Error("Il peso di chiusura non può essere maggiore di quello di apertura.");
        }
        
        const materialData = materialDoc.data() as RawMaterial;
        const newWeightKg = (materialData.currentWeightKg ?? 0) - consumedWeight;
        
        if (newWeightKg < 0) {
           throw new Error(`Stock insufficiente. Peso disponibile: ${(materialData.currentWeightKg ?? 0).toFixed(2)}kg, richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }
        
        // --- 3. ALL WRITES LAST ---
        const finalStock = newWeightKg;

        // 3a. Update material stock (both weight and units for KG-based materials)
        transaction.update(materialRef, { 
            currentWeightKg: finalStock,
            currentStockUnits: finalStock,
        });

        // 3b. Create a single withdrawal log for the entire session
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: sessionData.associatedJobs.map(j => j.jobId),
            jobOrderPFs: sessionData.associatedJobs.map(j => j.jobOrderPF),
            materialId: sessionData.materialId,
            materialCode: sessionData.materialCode,
            consumedWeight: consumedWeight,
            consumedUnits: null, // Set to null for weight-based sessions to avoid Firestore 'undefined' error
            operatorId: operatorId,
            withdrawalDate: Timestamp.now(),
        });

        // 3c. Update all associated job orders to record the closing weight for the correct consumption
        for (const jobDoc of jobDocs) {
            if (jobDoc.exists()) {
                const jobData = jobDoc.data() as JobOrder;
                const updatedPhases = jobData.phases.map(p => {
                     const updatedConsumptions = (p.materialConsumptions || []).map(mc => {
                        if (
                          mc.materialId === sessionData.materialId &&
                          mc.grossOpeningWeight === sessionData.grossOpeningWeight &&
                          mc.closingWeight === undefined // Only close sessions that are open
                        ) {
                          return { ...mc, closingWeight };
                        }
                        return mc;
                      });

                      return { ...p, materialConsumptions: updatedConsumptions };
                });
                transaction.update(jobDoc.ref, { phases: updatedPhases });
            }
        }
    });

    revalidatePath('/scan-job');
    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');

    return { success: true, message: 'Sessione chiusa, peso registrato e stock aggiornato.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la chiusura della sessione.";
    console.error("Failed to close material session:", error);
    return { success: false, message: errorMessage };
  }
}

const tubiGuainaWithdrawalSchema = z.object({
  materialId: z.string(),
  operatorId: z.string(),
  jobId: z.string(),
  jobOrderPF: z.string(),
  phaseId: z.string(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  unit: z.enum(['n', 'mt', 'kg']),
});

export async function logTubiGuainaWithdrawal(formData: FormData): Promise<{ success: boolean; message: string }> {
  const rawData = Object.fromEntries(formData.entries());
  const validated = tubiGuainaWithdrawalSchema.safeParse(rawData);
  if (!validated.success) {
    return { success: false, message: validated.error.errors[0]?.message || 'Dati non validi.' };
  }
  
  const { materialId, operatorId, jobId, jobOrderPF, phaseId, quantity, unit } = validated.data;
  const materialRef = doc(db, "rawMaterials", materialId);
  const jobRef = doc(db, 'jobOrders', jobId);
  
  try {
    await runTransaction(db, async (transaction) => {
        const materialDoc = await transaction.get(materialRef);
        const jobDoc = await transaction.get(jobRef);

        if (!materialDoc.exists()) throw new Error("Materia prima non trovata.");
        if (!jobDoc.exists()) throw new Error("Commessa non trovata.");
        
        const material = materialDoc.data() as RawMaterial;
        const job = jobDoc.data() as JobOrder;
        
        let unitsConsumed = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          unitsConsumed = (material.conversionFactor && material.conversionFactor > 0) ? Math.round(quantity / material.conversionFactor) : 0;
        } else { // 'n' or 'mt'
          unitsConsumed = quantity;
          consumedWeight = (material.conversionFactor && material.conversionFactor > 0) ? quantity * material.conversionFactor : 0;
        }
        
        let newStockUnits = material.currentStockUnits ?? 0;
        let currentWeightKg = material.currentWeightKg ?? 0;

        if (newStockUnits < unitsConsumed) {
            throw new Error(`Stock a unità insufficiente. Disponibile: ${newStockUnits}, Richiesto: ${unitsConsumed}.`);
        }
         if (consumedWeight > 0 && currentWeightKg < consumedWeight) {
             throw new Error(`Stock a peso insufficiente. Disponibile: ${currentWeightKg.toFixed(2)}kg, Richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }
        
        newStockUnits -= unitsConsumed;
        const newWeightKg = currentWeightKg - consumedWeight;

        // Update material stock
        transaction.update(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg });
        
        // Create withdrawal log
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: [jobId],
            jobOrderPFs: [jobOrderPF],
            materialId,
            materialCode: material.code,
            consumedWeight,
            consumedUnits: unitsConsumed,
            operatorId,
            withdrawalDate: Timestamp.now(),
        });
        
        // Update JobOrder with consumption data
        const phaseToUpdate = job.phases.find(p => p.id === phaseId);
        if (!phaseToUpdate) {
            throw new Error(`Fase con ID ${phaseId} non trovata nella commessa.`);
        }
        
        const newConsumption: MaterialConsumption = {
            materialId: materialId,
            materialCode: material.code,
            pcs: unitsConsumed,
        };

        if (!phaseToUpdate.materialConsumptions) {
            phaseToUpdate.materialConsumptions = [];
        }
        phaseToUpdate.materialConsumptions.push(newConsumption);
        phaseToUpdate.materialReady = true; // Mark phase as ready
        
        const updatedPhases = job.phases.map(p => p.id === phaseId ? phaseToUpdate : p);
        transaction.update(jobRef, { phases: updatedPhases });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Prelievo registrato con successo.` };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la registrazione del prelievo.";
     return { success: false, message: errorMessage };
  }
}


export async function findLastWeightForLotto(materialId: string, lotto: string): Promise<{grossWeight: number, netWeight: number, packagingId: string, isInitialLoad: boolean} | null> {
    if (!materialId || !lotto) return null;

    // STRATEGY 1: Find the last usage (closing weight) of this lot, as it's most current.
    const jobsRef = collection(db, "jobOrders");
    const q = firestoreQuery(jobsRef, where("status", "in", ["production", "completed", "suspended", "paused"]));
    const snapshot = await getDocs(q);
    const consumptions: { closingWeight: number; tareWeight: number; packagingId: string; completedAt: Date }[] = [];

    if (!snapshot.empty) {
        for (const docSnap of snapshot.docs) {
            const job = convertTimestampsToDates(docSnap.data()) as JobOrder;
            for (const phase of (job.phases || [])) {
                for (const consumption of (phase.materialConsumptions || [])) {
                  if (
                      consumption.materialId === materialId &&
                      consumption.lottoBobina === lotto &&
                      consumption.closingWeight !== undefined &&
                      consumption.closingWeight !== null
                  ) {
                      const lastWorkPeriodEnd = (phase.workPeriods || []).reduce((latest, wp) => {
                          if (wp.end && (!latest || new Date(wp.end) > latest)) {
                              return new Date(wp.end);
                          }
                          return latest;
                      }, null as Date | null);
                      
                      if (lastWorkPeriodEnd) {
                          consumptions.push({
                              closingWeight: consumption.closingWeight,
                              tareWeight: consumption.tareWeight || 0,
                              packagingId: consumption.packagingId || 'none',
                              completedAt: lastWorkPeriodEnd,
                          });
                      }
                  }
                }
            }
        }
    }
    
    if (consumptions.length > 0) {
        consumptions.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
        const lastUsage = consumptions[0];
        return {
            grossWeight: lastUsage.closingWeight,
            netWeight: lastUsage.closingWeight - lastUsage.tareWeight,
            packagingId: lastUsage.packagingId,
            isInitialLoad: false, // It's from a previous usage, not the initial load.
        };
    }

    // STRATEGY 2: If no usage found, find the initial loading data for this lot.
    const materialRef = doc(db, "rawMaterials", materialId);
    const materialSnap = await getDoc(materialRef);
    if (materialSnap.exists()) {
        const material = materialSnap.data() as RawMaterial;
        const specificBatch = (material.batches || []).find(b => b.lotto === lotto);
        if (specificBatch) {
            return { 
                grossWeight: specificBatch.grossWeight,
                netWeight: specificBatch.netQuantity,
                packagingId: specificBatch.packagingId || 'none',
                isInitialLoad: true,
            };
        }
    }

    // If neither strategy finds a weight, return null.
    return null;
}

export async function searchRawMaterials(
  searchTerm: string,
  allowedTypes?: RawMaterialType[]
): Promise<Array<Pick<RawMaterial, 'id' | 'code' | 'description' | 'type' | 'unitOfMeasure' | 'currentStockUnits' | 'currentWeightKg'>>> {
  const materialsRef = collection(db, "rawMaterials");
  
  let q = firestoreQuery(materialsRef);

  if (allowedTypes && allowedTypes.length > 0) {
    q = firestoreQuery(q, where("type", "in", allowedTypes));
  }
  
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return [];
  }

  const allMaterials = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as RawMaterial);
  
  const lowercasedTerm = searchTerm.toLowerCase();

  const filteredMaterials = allMaterials
    .filter(material => 
      material.code.toLowerCase().includes(lowercasedTerm) || 
      material.description.toLowerCase().includes(lowercasedTerm)
    )
    .map(({ id, code, description, type, unitOfMeasure, currentStockUnits, currentWeightKg }) => ({
      id,
      code,
      description,
      type,
      unitOfMeasure,
      currentStockUnits,
      currentWeightKg
    }));
  
  return filteredMaterials.slice(0, 10); // Limit to 10 results for performance
}


export async function handlePhaseScanResult(jobId: string, phaseId: string, operatorId: string): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const isGroup = jobId.startsWith('group-');
    
    const availability = await isOperatorActiveOnAnyJob(operatorId, isGroup ? jobId : undefined);
    if (!availability.available) {
        return { success: false, message: `Sei già attivo sulla commessa ${availability.activeJobId} (fase: ${availability.activePhaseName}). Completa o metti in pausa l'attività precedente.`, error: 'OPERATOR_BUSY' };
    }

    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, jobId);
    
    let startedPhaseName = '';
    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(itemRef);
        if (!docSnap.exists()) throw new Error('Commessa o Gruppo non trovato.');

        const itemData = convertTimestampsToDates(docSnap.data()) as JobOrder | WorkGroup;
        
        const itemToUpdate = JSON.parse(JSON.stringify(itemData));
        const sortedPhases = itemToUpdate.phases.sort((a: JobPhase, b: JobPhase) => a.sequence - b.sequence);
        const currentPhaseIndex = sortedPhases.findIndex((p: JobPhase) => p.id === phaseId);
        
        if (currentPhaseIndex === -1) throw new Error('Fase non trovata nella commessa.');

        const phaseToStart = sortedPhases[currentPhaseIndex];
        startedPhaseName = phaseToStart.name;

        if (phaseToStart.status !== 'pending' && phaseToStart.status !== 'paused') throw new Error('Questa fase non è in attesa o in pausa.');
        if (itemData.isProblemReported) throw new Error('Lavorazione bloccata a causa di un problema.');

        if (!phaseToStart.isIndependent && !phaseToStart.materialReady) {
            throw new Error('Il materiale per questa fase non è pronto.');
        }

        phaseToStart.status = 'in-progress';
        phaseToStart.workstationScannedAndVerified = true;
        phaseToStart.workPeriods.push({ start: new Date(), end: null, operatorId: operatorId });

        itemToUpdate.status = 'production';
        if (!itemToUpdate.overallStartTime) {
            itemToUpdate.overallStartTime = new Date();
        }

        const phasesWithReadiness = updatePhasesMaterialReadiness(sortedPhases);

        transaction.update(itemRef, { phases: phasesWithReadiness, status: 'production', overallStartTime: itemToUpdate.overallStartTime });

        if (isGroup) {
            const group = itemData as WorkGroup;
            (group.jobOrderIds || []).forEach(individualJobId => {
                const jobRef = doc(db, 'jobOrders', individualJobId);
                transaction.update(jobRef, { phases: phasesWithReadiness, status: 'production', overallStartTime: itemToUpdate.overallStartTime });
            });
        }

        // Update operator status
        await updateOperatorStatus(operatorId, jobId, startedPhaseName);
    });

    revalidatePath('/scan-job'); 
    revalidatePath('/admin/production-console');
    return { success: true, message: `Fase avviata con successo.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}

export async function postponeQualityPhase(jobId: string, phaseId: string, currentState: 'default' | 'postponed'): Promise<{ success: boolean; message: string }> {
  try {
    const isGroup = jobId.startsWith('group-');
    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, jobId);
    
    await runTransaction(db, async (transaction) => {
        const itemSnap = await transaction.get(itemRef);

        if (!itemSnap.exists()) {
          throw new Error('Commessa o Gruppo non trovato.');
        }

        const itemData = itemSnap.data() as JobOrder | WorkGroup;
        const originalPhases = itemData.phases || [];
        const phaseIndex = originalPhases.findIndex(p => p.id === phaseId);

        if (phaseIndex === -1) {
          throw new Error('Fase "Taglio Guaina" non trovata.');
        }

        const phaseToMove = originalPhases[phaseIndex];

        if (!['pending', 'paused'].includes(phaseToMove.status)) {
            throw new Error('È possibile spostare la fase solo se non è ancora stata avviata o è in pausa.');
        }
        
        const updatedPhases = [...originalPhases];
        const isCurrentlyPostponed = currentState === 'postponed';

        if (!isCurrentlyPostponed) {
          // Logic to move it after the last 'production' phase
          const phasesSorted = [...originalPhases].sort((a, b) => a.sequence - b.sequence);
          const productionPhases = phasesSorted.filter(p => p.type === 'production');
          
          let targetSequence;
          if (productionPhases.length > 0) {
            const lastProductionPhase = productionPhases[productionPhases.length - 1];
            targetSequence = lastProductionPhase.sequence + 0.1; // Place it right after
          } else {
            const firstQualityPhase = phasesSorted.find(p => p.type === 'quality' || p.type === 'packaging');
            targetSequence = firstQualityPhase ? firstQualityPhase.sequence - 0.1 : 99;
          }
          
          updatedPhases[phaseIndex].sequence = targetSequence;
          updatedPhases[phaseIndex].postponed = true;

        } else { // 'postponed' -> revert to original
          const templateRef = doc(db, 'workPhaseTemplates', phaseId);
          const templateSnap = await transaction.get(templateRef);
          if (!templateSnap.exists()) {
              throw new Error('Impossibile trovare il modello originale della fase per ripristinare la sequenza.');
          }
          const originalSequence = (templateSnap.data() as WorkPhaseTemplate).sequence;
          updatedPhases[phaseIndex].sequence = originalSequence;
          delete updatedPhases[phaseIndex].postponed;
        }

        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);

        transaction.update(itemRef, { phases: finalPhases });

        if (isGroup) {
             const groupData = itemSnap.data() as WorkGroup;
            (groupData.jobOrderIds || []).forEach(individualJobId => {
                const jobRef = doc(db, 'jobOrders', individualJobId);
                transaction.update(jobRef, { phases: finalPhases });
            });
        }
    });
    
    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);

    return { 
      success: true, 
      message: `Posizione della fase "Taglio Guaina" aggiornata.` 
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error toggling phase position:", error);
    return { success: false, message: errorMessage };
  }
}


export async function isOperatorActiveOnAnyJob(operatorId: string, currentGroupId?: string): Promise<{ available: boolean, activeJobId?: string, activePhaseName?: string }> {
    const operatorDocRef = doc(db, "operators", operatorId);
    const operatorDocSnap = await getDoc(operatorDocRef);

    if (!operatorDocSnap.exists()) {
        console.warn(`Operator with ID ${operatorId} not found.`);
        return { available: true };
    }

    const operatorData = operatorDocSnap.data() as Operator;
    const activeJobId = operatorData.activeJobId;
    
    if (!activeJobId) {
        return { available: true }; // Operator is free
    }

    // If the operator thinks they are on the current group, they are available for actions within it.
    if (currentGroupId && activeJobId === currentGroupId) {
        return { available: true };
    }

    // --- Cross-Verification Logic ---
    // The operator thinks they are busy. Let's verify if that's actually true.
    const isGroup = activeJobId.startsWith('group-');
    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, activeJobId);
    const itemSnap = await getDoc(itemRef);

    let isStillActive = false;
    if (itemSnap.exists()) {
        const itemData = itemSnap.data() as JobOrder | WorkGroup;
        isStillActive = (itemData.phases || []).some(p => 
            p.status === 'in-progress' &&
            (p.workPeriods || []).some(wp => wp.operatorId === operatorId && wp.end === null)
        );
    }

    if (isStillActive) {
        // The state is consistent. The operator is genuinely busy.
        return {
            available: false,
            activeJobId: activeJobId,
            activePhaseName: operatorData.activePhaseName || 'Sconosciuta',
        };
    } else {
        // GHOST STATE DETECTED! The operator's profile is stale.
        // Auto-correct the state and report the operator as available.
        console.warn(`Ghost state detected for operator ${operatorId}. Auto-correcting.`);
        await updateOperatorStatus(operatorId, null, null);
        return { available: true };
    }
}

export async function createWorkGroup(jobIds: string[], operatorId: string): Promise<{ success: boolean; message: string; workGroupId?: string }> {
    try {
        if (jobIds.length < 2) {
            return { success: false, message: 'Selezionare almeno due commesse da raggruppare.' };
        }
        const jobDocs = await Promise.all(jobIds.map(id => getDoc(doc(db, 'jobOrders', id))));
        const jobs = jobDocs.map(d => d.data() as JobOrder);
        
        if (jobs.some(j => !j)) {
            return { success: false, message: 'Una o più commesse selezionate non sono valide.' };
        }
         if (jobs.some(j => j.workGroupId)) {
            return { success: false, message: 'Una o più commesse selezionate fanno già parte di un altro gruppo.' };
        }
        const firstJob = jobs[0];
        
        const { workCycleId, department, cliente } = firstJob;
        if (jobs.some(j => j.workCycleId !== workCycleId || j.department !== department || j.cliente !== cliente)) {
            return { success: false, message: 'Le commesse non sono compatibili. Devono avere lo stesso ciclo, reparto e cliente.' };
        }

        const workGroupId = `group-${Date.now()}`;
        const workGroupRef = doc(db, 'workGroups', workGroupId);

        const totalQuantity = jobs.reduce((sum, job) => sum + job.qta, 0);
        
        const allOdlInterno = [...new Set(jobs.map(j => j.numeroODLInterno).filter(Boolean))];
        const allOdlEst = [...new Set(jobs.map(j => j.numeroODL).filter(Boolean))];
        const allDeliveryDates = jobs.map(j => j.dataConsegnaFinale).filter(Boolean).map(d => new Date(d));
        const earliestDeliveryDate = allDeliveryDates.length > 0 ? new Date(Math.min(...allDeliveryDates.map(d => d.getTime()))) : null;


        const newWorkGroup: WorkGroup = {
            id: workGroupId,
            jobOrderIds: jobs.map(j => j.id),
            jobOrderPFs: jobs.map(j => j.ordinePF),
            status: 'production',
            createdAt: new Date(),
            createdBy: operatorId,
            totalQuantity: totalQuantity,
            qta: totalQuantity, 
            workCycleId: workCycleId || '',
            department: department,
            cliente: cliente,
            phases: firstJob.phases,
            details: 'Lavorazione Multi-Commessa',
            numeroODLInterno: allOdlInterno.join(', ') || 'N/D',
            numeroODL: allOdlEst.join(', ') || 'N/D',
            dataConsegnaFinale: earliestDeliveryDate ? earliestDeliveryDate.toISOString().split('T')[0] : 'N/D',
            ordinePF: jobs.map(j => j.ordinePF).join(', '),
        };

        const batch = writeBatch(db);
        batch.set(workGroupRef, newWorkGroup);

        jobDocs.forEach(jobDoc => {
            batch.update(jobDoc.ref, { workGroupId: workGroupId });
        });

        await batch.commit();

        return { success: true, message: 'Gruppo creato con successo.', workGroupId: workGroupId };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la creazione del gruppo.";
        return { success: false, message: errorMessage };
    }
}

export async function reportMaterialMissing(
  itemId: string,
  phaseId: string,
  uid: string,
  notes?: string,
): Promise<{ success: boolean; message: string }> {
  
  const isGroup = itemId.startsWith('group-');
  const collectionName = isGroup ? 'workGroups' : 'jobOrders';
  const itemRef = doc(db, collectionName, itemId);

  try {
    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato.");
      
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const phases = [...itemData.phases];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);

      if (phaseIndex === -1) throw new Error("Fase non trovata.");
      
      phases[phaseIndex].materialStatus = 'missing';
      phases[phaseIndex].materialReady = false;

      const operatorDocSnap = await getOperatorByUid(uid);
      const operatorName = operatorDocSnap ? operatorDocSnap.nome : 'Sconosciuto';
      
      const updatePayload: any = { 
        phases,
        isProblemReported: true,
        problemType: 'MANCA_MATERIALE',
        problemReportedBy: operatorName,
        problemNotes: notes || '',
      };

      const phaseToUpdate = phases[phaseIndex];
      let operatorWasActive = false;

      if (phaseToUpdate.status === 'in-progress') {
        const myWorkPeriodIndex = phaseToUpdate.workPeriods.findIndex(wp => wp.operatorId === uid && wp.end === null);
        if (myWorkPeriodIndex !== -1) {
            operatorWasActive = true;
            phaseToUpdate.workPeriods[myWorkPeriodIndex].end = new Date();
        }
        const isAnyoneElseWorking = phaseToUpdate.workPeriods.some(wp => wp.end === null);
        if (!isAnyoneElseWorking) {
            phaseToUpdate.status = 'paused';
        }
        updatePayload.status = isAnyPhaseInProgress(phases) ? 'production' : 'paused';
      }

      transaction.update(itemRef, updatePayload);
      
      // If the operator was active, clear their state
      if (operatorWasActive) {
          await updateOperatorStatus(uid, null, null);
      }

      if (isGroup) {
        ( (itemData as WorkGroup).jobOrderIds || []).forEach(individualJobId => {
            const jobRef = doc(db, 'jobOrders', individualJobId);
            transaction.update(jobRef, updatePayload);
        });
      }
    });

    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    return { success: true, message: 'Mancanza materiale segnalata. La fase è stata messa in pausa.' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Errore sconosciuto' };
  }
}
    
function isAnyPhaseInProgress(phases: JobPhase[]): boolean {
    return phases.some(p => p.status === 'in-progress');
}


export async function getOperatorByUid(uid: string): Promise<Operator | null> {
    const q = firestoreQuery(collection(db, "operators"), where("uid", "==", uid));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const operatorDoc = querySnapshot.docs[0];
        return { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
    }
    // Fallback to check by ID if UID is not set
    const docRef = doc(db, "operators", uid);
    const docSnap = await getDoc(docRef);
    if(docSnap.exists()){
        return { ...docSnap.data(), id: docSnap.id } as Operator;
    }

    return null;
}

