

'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, MaterialConsumption, RawMaterialType } from '@/lib/mock-data';
import type { ActiveMaterialSessionData } from '@/contexts/ActiveMaterialSessionProvider';
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


export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    const jobRef = doc(db, "jobOrders", id);
    const docSnap = await getDoc(jobRef);
    if (!docSnap.exists()) return null;
    return convertTimestampsToDates(docSnap.data()) as JobOrder;
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

  if (job.status !== 'production' && job.status !== 'suspended') {
     return {
      error: `La commessa "${scannedData.ordinePF}" non è in produzione o sospesa. Stato attuale: ${job.status}.`,
      title: 'Commessa non Lavorabile',
    };
  }

  if (job.details !== scannedData.codice || job.qta.toString() !== scannedData.qta) {
     return {
      error: `I dati scansionati non corrispondono. Attesi: Articolo "${job.details}", Qta "${job.qta}". Scansionati: Articolo "${scannedData.codice}", Qta "${scannedData.qta}".`,
      title: 'Dati non Corrispondenti',
    };
  }
  
  const jobCopy: JobOrder = JSON.parse(JSON.stringify(job));
  
  // Clean up the job data to ensure it's in a consistent state without modifying readiness.
  jobCopy.phases = (jobCopy.phases || []).map(p => ({
    ...p,
    workPeriods: p.workPeriods || [], 
    materialConsumptions: p.materialConsumptions || [],
  }));
  
  jobCopy.isProblemReported = jobCopy.isProblemReported || false;

  return jobCopy;
}


export async function updateJob(jobData: JobOrder): Promise<{ success: boolean; message: string; }> {
    const jobRef = doc(db, "jobOrders", jobData.id);

    try {
        const allPhasesCompleted = (jobData.phases || []).length > 0 && (jobData.phases || []).every(p => p.status === 'completed');

        // A job is completed if ALL its phases are completed, AND there is no open problem report.
        if (allPhasesCompleted && !jobData.isProblemReported && jobData.status !== 'suspended') {
            jobData.status = 'completed';
            if (!jobData.overallEndTime) {
                jobData.overallEndTime = new Date();
            }
        }

        // Convert Date objects back to Firestore Timestamps before writing
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

export async function resolveJobProblem(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string; }> {
  try {
    const operator = await ensureAdmin(uid); // Re-use ensureAdmin for role check
    if (operator.role !== 'admin' && operator.role !== 'superadvisor') {
      throw new Error('Permessi non sufficienti.');
    }

    const jobRef = doc(db, "jobOrders", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) throw new Error("Commessa non trovata.");

    const jobData = jobSnap.data() as JobOrder;
    
    // Reset the general problem flag using deleteField() for undefined values
    const updatePayload: any = { 
        isProblemReported: false,
        problemType: deleteField(),
        problemNotes: deleteField(),
        problemReportedBy: deleteField()
    };

    // If the problem was a quality failure, reset the phase status to allow re-testing
    const failedPhaseIndex = jobData.phases.findIndex(p => p.qualityResult === 'failed');
    if (failedPhaseIndex !== -1) {
        const updatedPhases = [...jobData.phases];
        updatedPhases[failedPhaseIndex].status = 'pending';
        updatedPhases[failedPhaseIndex].qualityResult = null;
        updatePayload.phases = updatedPhases;
    }

    await updateDoc(jobRef, updatePayload);

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
    
    return { success: true, message: 'Problema risolto. La commessa è stata sbloccata e la fase di collaudo resettata.' };
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
    const q = firestoreQuery(jobsRef, where("status", "in", ["production", "completed", "suspended"]));
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


export async function handlePhaseScanResult(jobId: string, phaseId: string, operatorId: string) {
  try {
    const jobRef = doc(db, 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(jobRef);
        if (!docSnap.exists()) throw new Error('Commessa non trovata.');

        const jobData = convertTimestampsToDates(docSnap.data()) as JobOrder;
        
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
        
        transaction.update(jobRef, jobToUpdate);
    });

    revalidatePath('/scan-job'); // Revalidate to update the UI
    return { success: true, message: `Fase avviata con successo.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}
