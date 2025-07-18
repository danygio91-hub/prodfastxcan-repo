

'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial } from '@/lib/mock-data';
import type { ActiveMaterialSessionData } from '@/contexts/ActiveMaterialSessionProvider';
import * as z from 'zod';

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
  
  const allPreparationPhases = (jobCopy.phases || []).filter(p => p.type === 'preparation');
  const allPreparationPhasesCompleted = allPreparationPhases.length > 0 && allPreparationPhases.every(p => p.status === 'completed');
  
  jobCopy.phases = (jobCopy.phases || []).map(p => {
    let materialReady = p.materialReady || false; // Preserve existing state

    if (p.type === 'preparation') {
        // A prep phase is ready if it doesn't need a scan OR if it already has material.
        materialReady = !p.requiresMaterialScan || !!p.materialConsumption;
    } else { // For production/quality phases
        // Production phases are ready only when all prep phases are done.
        materialReady = allPreparationPhasesCompleted;
    }
    
    return {
      ...p,
      materialReady: materialReady,
      workPeriods: p.workPeriods || [], 
      workstationScannedAndVerified: p.workstationScannedAndVerified || false,
    };
  });
  
  jobCopy.isProblemReported = jobCopy.isProblemReported || false;

  return jobCopy;
}


export async function updateJob(jobData: JobOrder): Promise<{ success: boolean; message: string; }> {
    const jobRef = doc(db, "jobOrders", jobData.id);

    try {
        const allPhasesCompleted = (jobData.phases || []).every(p => p.status === 'completed');
        if (allPhasesCompleted && jobData.overallEndTime && jobData.status !== 'suspended') {
            jobData.status = 'completed';
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
        
        const consumedWeight = sessionData.openingWeight - closingWeight;
        if (consumedWeight < 0) {
            throw new Error("Il peso di chiusura non può essere maggiore di quello di apertura.");
        }
        
        const materialData = materialDoc.data() as RawMaterial;
        const newWeightKg = (materialData.currentWeightKg ?? 0) - consumedWeight;
        
        if (newWeightKg < 0) {
           throw new Error(`Stock insufficiente. Peso disponibile: ${(materialData.currentWeightKg ?? 0).toFixed(2)}kg, richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }
        
        // --- 3. ALL WRITES LAST ---

        // 3a. Update material stock
        transaction.update(materialRef, { currentWeightKg: newWeightKg });

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

        // 3c. Update all associated job orders to record the closing weight
        for (const jobDoc of jobDocs) {
            if (jobDoc.exists()) {
                const jobData = jobDoc.data() as JobOrder;
                const updatedPhases = jobData.phases.map(p => {
                    // Match the specific material consumption instance that hasn't been closed yet
                    if (p.materialConsumption?.materialId === sessionData.materialId && p.materialConsumption.openingWeight === sessionData.openingWeight && p.materialConsumption.closingWeight === undefined) {
                        return {
                            ...p,
                            materialConsumption: {
                                ...p.materialConsumption,
                                closingWeight: closingWeight,
                            }
                        };
                    }
                    return p;
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

const tubiWithdrawalSchema = z.object({
  materialId: z.string(),
  operatorId: z.string(),
  jobId: z.string(),
  jobOrderPF: z.string(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  unit: z.enum(['n', 'kg']),
});

export async function logTubiWithdrawal(formData: FormData): Promise<{ success: boolean; message: string }> {
  const rawData = Object.fromEntries(formData.entries());
  const validated = tubiWithdrawalSchema.safeParse(rawData);
  if (!validated.success) {
    return { success: false, message: validated.error.errors[0]?.message || 'Dati non validi.' };
  }
  
  const { materialId, operatorId, jobId, jobOrderPF, quantity, unit } = validated.data;
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
    await runTransaction(db, async (transaction) => {
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists()) {
            throw new Error("Materia prima non trovata.");
        }
        
        const material = materialDoc.data() as RawMaterial;
        let consumedWeight = 0;
        let unitsConsumed = 0;
        let newStockUnits = material.currentStockUnits ?? 0;
        let currentWeightKg = material.currentWeightKg ?? 0;

        if (unit === 'kg') {
            consumedWeight = quantity;
            unitsConsumed = material.conversionFactor && material.conversionFactor > 0 ? Math.round(consumedWeight / material.conversionFactor) : 0;
        } else { // unit is 'n'
            unitsConsumed = quantity;
            consumedWeight = material.conversionFactor && material.conversionFactor > 0 ? quantity * material.conversionFactor : 0;
        }

        if (newStockUnits < unitsConsumed) {
            throw new Error(`Stock a unità insufficiente. Disponibile: ${newStockUnits}, Richiesto: ${unitsConsumed}.`);
        }
        if (currentWeightKg < consumedWeight) {
             throw new Error(`Stock a peso insufficiente. Disponibile: ${currentWeightKg.toFixed(2)}kg, Richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }
        
        newStockUnits -= unitsConsumed;
        const newWeightKg = currentWeightKg - consumedWeight;

        transaction.update(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg });
        
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
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Prelievo registrato con successo.` };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la registrazione del prelievo.";
     return { success: false, message: errorMessage };
  }
}


export async function findLastWeightForLotto(materialId: string, lotto: string): Promise<number | null> {
    if (!materialId || !lotto) return null;

    // This is a robust but potentially expensive query if the number of jobs is very large.
    // For this application's scale, it is acceptable.
    // It finds all usages of a specific lotto and returns the closing weight of the most recent one.

    const jobsRef = collection(db, "jobOrders");
    const snapshot = await getDocs(jobsRef);

    if (snapshot.empty) {
        return null;
    }

    // Collect all consumptions of this specific lotto with their completion times
    const consumptions: { closingWeight: number; completedAt: Date }[] = [];

    for (const doc of snapshot.docs) {
        const job = convertTimestampsToDates(doc.data()) as JobOrder;
        for (const phase of (job.phases || [])) {
            if (
                phase.materialConsumption &&
                phase.materialConsumption.materialId === materialId &&
                phase.materialConsumption.lottoBobina === lotto &&
                phase.materialConsumption.closingWeight !== undefined &&
                phase.materialConsumption.closingWeight !== null
            ) {
                // Find the end time of the last work period for this phase to determine recency
                const lastWorkPeriodEnd = (phase.workPeriods || []).reduce((latest, wp) => {
                    if (wp.end && (!latest || new Date(wp.end) > latest)) {
                        return new Date(wp.end);
                    }
                    return latest;
                }, null as Date | null);
                
                if (lastWorkPeriodEnd) {
                    consumptions.push({
                        closingWeight: phase.materialConsumption.closingWeight,
                        completedAt: lastWorkPeriodEnd,
                    });
                }
            }
        }
    }
    
    // If no consumptions were found for this lotto, return null
    if (consumptions.length === 0) {
        return null;
    }

    // Sort consumptions by completion date, descending, to find the most recent one
    consumptions.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

    // The first item is the most recent one
    return consumptions[0].closingWeight;
}





    

