

'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, MaterialConsumption, RawMaterialType, ActiveMaterialSessionData, WorkGroup } from '@/lib/mock-data';
import * as z from 'zod';
import { ensureAdmin } from '@/lib/server-auth';
import { dissolveWorkGroup } from '../admin/work-group-management/actions';
import type { ConcatenationPolicy } from '../admin/concatenation-settings/actions';

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


export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    const isWorkGroup = id.startsWith('group-');
    const collectionName = isWorkGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, id);
    const docSnap = await getDoc(itemRef);

    if (!docSnap.exists()) return null;

    const data = convertTimestampsToDates(docSnap.data());

    if (isWorkGroup) {
        const group = data as WorkGroup;
        // If the group has a paused status, we should still treat it as 'production' for the operator view
        // to allow interaction. The 'paused' state is primarily for console display and filtering.
        const operatorFacingStatus = group.status === 'paused' ? 'production' : group.status;
        
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
            status: operatorFacingStatus,
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
  
  if (job.workGroupId) {
      const groupData = await getJobOrderById(job.workGroupId);
      if (groupData) {
          // A group is always considered workable if it exists, its status is handled inside getJobOrderById
          return groupData;
      } else {
          // If group is not found, maybe it was dissolved. We should clean up the reference.
          await updateDoc(jobRef, { workGroupId: deleteField() });
          // and then return the job itself after cleanup
          return job;
      }
  }


  // Allow 'paused' jobs to be loaded so they can be resumed.
  if (!['production', 'suspended', 'paused'].includes(job.status)) {
     return {
      error: `La commessa "${scannedData.ordinePF}" non è in produzione o sospesa. Stato attuale: ${job.status}.`,
      title: 'Commessa non Lavorabile',
    };
  }

  // Do not perform this check for groups, as the QR data belongs to a single job.
  if (!job.workGroupId && (job.details !== scannedData.codice || job.qta.toString() !== scannedData.qta)) {
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
  
  // For the operator, a paused job should be treated as 'production' to allow interaction
  if (jobCopy.status === 'paused') {
      jobCopy.status = 'production';
  }

  return jobCopy;
}


export async function updateJob(jobData: JobOrder): Promise<{ success: boolean; message: string; }> {
    const jobRef = doc(db, "jobOrders", jobData.id);

    try {
        const allPhasesCompleted = (jobData.phases || []).length > 0 && (jobData.phases || []).every(p => p.status === 'completed');

        if (allPhasesCompleted && !jobData.isProblemReported && jobData.status !== 'suspended') {
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

async function getConcatenationPolicy(): Promise<ConcatenationPolicy> {
    const configDoc = await getDoc(doc(db, 'configuration', 'concatenationPolicy'));
    if (configDoc.exists()) {
        return configDoc.data() as ConcatenationPolicy;
    }
    return { ungroupAfterPreparation: false, ungroupAfterProduction: false, ungroupAfterQuality: false }; // Default value
}


export async function updateWorkGroup(groupData: WorkGroup): Promise<{ success: boolean; message: string; }> {
    const groupRef = doc(db, "workGroups", groupData.id);

    try {
        const batch = writeBatch(db);
        const allPhasesCompleted = (groupData.phases || []).length > 0 && (groupData.phases || []).every(p => p.status === 'completed');
        
        if (allPhasesCompleted && !groupData.isProblemReported) {
            groupData.status = 'completed';
            if (!groupData.overallEndTime) {
                groupData.overallEndTime = new Date();
            }
        }
        
        const dataToSave = JSON.parse(JSON.stringify(groupData));
        batch.set(groupRef, dataToSave, { merge: true });

        // --- START PROPAGATION LOGIC ---
        const isAnyPhaseInProgress = (groupData.phases || []).some(p => p.status === 'in-progress');
        const statusForJobs = groupData.status === 'completed' ? 'completed' : isAnyPhaseInProgress ? 'production' : 'paused';

        const updatePayload: { [key: string]: any } = {
            phases: groupData.phases, 
            status: statusForJobs,
            isProblemReported: groupData.isProblemReported || false,
            problemType: groupData.problemType || deleteField(),
            problemNotes: groupData.problemNotes || deleteField(),
            problemReportedBy: groupData.problemReportedBy || deleteField(),
            overallStartTime: groupData.overallStartTime || null,
        };

        if (groupData.overallEndTime) {
            updatePayload.overallEndTime = groupData.overallEndTime;
        }

        (groupData.jobOrderIds || []).forEach(jobId => {
            const jobRef = doc(db, 'jobOrders', jobId);
            batch.update(jobRef, updatePayload);
        });
        // --- END PROPAGATION LOGIC ---

        await batch.commit();
        
        const policy = await getConcatenationPolicy();
        const checkAndDissolve = async (phaseType: 'preparation' | 'production' | 'quality', policyFlag: keyof ConcatenationPolicy) => {
            if (policy[policyFlag]) {
                const typePhases = (groupData.phases || []).filter(p => p.type === phaseType);
                if (typePhases.length === 0) return null; // No phases of this type to check
                
                const allTypePhasesCompleted = typePhases.every(p => p.status === 'completed');
                
                if (allTypePhasesCompleted) {
                    await dissolveWorkGroup(groupData.id);
                    return `Tutte le fasi di ${phaseType} sono state completate, il gruppo è stato sciolto come da policy.`;
                }
            }
            return null;
        };

        let dissolveMessage = await checkAndDissolve('preparation', 'ungroupAfterPreparation') ||
                              await checkAndDissolve('production', 'ungroupAfterProduction') ||
                              await checkAndDissolve('quality', 'ungroupAfterQuality');

        if (dissolveMessage) {
            revalidatePath('/scan-job'); 
            return { success: true, message: `Gruppo di lavoro ${groupData.id} aggiornato. ${dissolveMessage}` };
        }


        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/work-group-management');

        return { success: true, message: `Gruppo di lavoro ${groupData.id} aggiornato.` };

    } catch (error) {
        console.error("Error updating work group:", error);
        return { success: false, message: "Errore durante l'aggiornamento del gruppo." };
    }
}


export async function resolveJobProblem(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string; }> {
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
             const groupData = { ...itemData, ...updatePayload } as WorkGroup;
            (groupData.jobOrderIds || []).forEach(individualJobId => {
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
    const currentJobId = isGroup ? jobId : undefined;

    const availability = await isOperatorActiveOnAnyJob(operatorId, currentJobId);
    if (!availability.available) {
        return { success: false, message: 'Operatore già attivo su un\'altra fase.', error: 'OPERATOR_BUSY' };
    }

    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const jobRef = doc(db, collectionName, jobId);
    
    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(jobRef);
        if (!docSnap.exists()) throw new Error('Commessa o Gruppo non trovato.');

        const jobData = convertTimestampsToDates(docSnap.data()) as JobOrder | WorkGroup;
        
        // Create a mutable copy
        const jobToUpdate = JSON.parse(JSON.stringify(jobData));
        const phaseToStart = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);
        if (!phaseToStart) throw new Error('Fase non trovata nella commessa.');

        // Validate if the phase is ready to be started
        if (phaseToStart.status !== 'pending') throw new Error('Questa fase non è in attesa.');
        if (!phaseToStart.materialReady) throw new Error('Il materiale per questa fase non è pronto.');
        if (jobData.isProblemReported) throw new Error('Lavorazione bloccata a causa di un problema.');

        // Start the phase
        phaseToStart.status = 'in-progress';
        phaseToStart.workstationScannedAndVerified = true;
        phaseToStart.workPeriods.push({ start: new Date(), end: null, operatorId: operatorId });

        // Unlock the next phase's material readiness if it's NOT a preparation phase
        if (phaseToStart.type !== 'preparation') {
            const sortedPhases = jobToUpdate.phases.sort((a: JobPhase, b: JobPhase) => a.sequence - b.sequence);
            const currentPhaseIndex = sortedPhases.findIndex((p: JobPhase) => p.id === phaseToStart.id);
            const nextPhase = sortedPhases[currentPhaseIndex + 1];
            
            if (nextPhase && nextPhase.status === 'pending') {
              nextPhase.materialReady = true;
            }
        }
        
        // If it's a group, propagate the phase change to all member jobs
        if (isGroup) {
            const group = jobData as WorkGroup;
            (group.jobOrderIds || []).forEach(individualJobId => {
                const individualJobRef = doc(db, 'jobOrders', individualJobId);
                transaction.update(individualJobRef, { phases: jobToUpdate.phases });
            });
        }
        
        transaction.update(jobRef, { phases: jobToUpdate.phases });
    });

    revalidatePath('/scan-job'); // Revalidate to update the UI
    revalidatePath('/admin/production-console');
    return { success: true, message: `Fase avviata con successo.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}

export async function isOperatorActiveOnAnyJob(operatorId: string, currentGroupId?: string): Promise<{ available: boolean, activeJobId?: string, activePhaseName?: string }> {
    const jobsRef = collection(db, "jobOrders");
    const groupsRef = collection(db, "workGroups");
    const collectionsToScan = [jobsRef, groupsRef];

    for (const ref of collectionsToScan) {
        const q = firestoreQuery(ref, where("status", "in", ["production", "suspended", "paused"]));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            continue;
        }

        for (const doc of querySnapshot.docs) {
            const item = doc.data() as JobOrder | WorkGroup;
            
            // If we are checking for a group context, skip the group itself.
            if (currentGroupId && item.id === currentGroupId) {
                continue;
            }

            for (const phase of (item.phases || [])) {
                if (phase.status === 'in-progress') {
                    const isActive = (phase.workPeriods || []).some(wp => wp.operatorId === operatorId && wp.end === null);
                    if (isActive) {
                        return {
                            available: false,
                            activeJobId: item.ordinePF || item.id,
                            activePhaseName: phase.name,
                        };
                    }
                }
            }
        }
    }
    
    return { available: true };
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

    

