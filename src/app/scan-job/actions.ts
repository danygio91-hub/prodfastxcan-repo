

'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, RawMaterial } from '@/lib/mock-data';
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
  jobCopy.phases = (jobCopy.phases || []).map(p => ({
    ...p,
    workPeriods: p.workPeriods || [], 
    workstationScannedAndVerified: p.workstationScannedAndVerified || false,
  }));
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
        let newStockUnits = material.currentStockUnits ?? 0;
        let currentWeightKg = material.currentWeightKg ?? 0;

        if (unit === 'kg') {
            consumedWeight = quantity;
            if (currentWeightKg < consumedWeight) {
                throw new Error(`Stock a peso insufficiente. Disponibile: ${currentWeightKg.toFixed(2)}kg, Richiesto: ${consumedWeight.toFixed(2)}kg.`);
            }
            if (material.conversionFactor && material.conversionFactor > 0) {
                const unitsConsumed = Math.round(consumedWeight / material.conversionFactor);
                newStockUnits -= unitsConsumed;
            }
        } else { // unit is 'n'
            if (newStockUnits < quantity) {
                throw new Error(`Stock a unità insufficiente. Disponibile: ${newStockUnits}, Richiesto: ${quantity}.`);
            }
            newStockUnits -= quantity;
            if (material.conversionFactor && material.conversionFactor > 0) {
                consumedWeight = quantity * material.conversionFactor;
            }
        }

        const newWeightKg = currentWeightKg - consumedWeight;
        if (newWeightKg < 0) {
            throw new Error(`Stock a peso risultante negativo. Verificare il fattore di conversione.`);
        }
        
        transaction.update(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg });
        
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: [jobId],
            jobOrderPFs: [jobOrderPF],
            materialId,
            materialCode: material.code,
            consumedWeight: consumedWeight,
            consumedUnits: unit === 'n' ? quantity : undefined,
            operatorId,
            withdrawalDate: Timestamp.now(),
        });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Prelievo di ${quantity} ${unit} registrato con successo.` };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la registrazione del prelievo.";
     return { success: false, message: errorMessage };
  }
}


export async function findLastWeightForLotto(materialId: string, lotto: string): Promise<number | null> {
    if (!materialId || !lotto) return null;

    // This query is much more efficient. It directly searches for phases that have used
    // the specific material and lotto combination, and orders them by the last work period's
    // end time to find the most recent usage.
    const jobsRef = collection(db, "jobOrders");
    const q = firestoreQuery(
        jobsRef,
        where("phases.materialConsumption.materialId", "==", materialId),
        where("phases.materialConsumption.lottoBobina", "==", lotto)
        // We cannot order by a nested timestamp, so we fetch all relevant docs and sort in memory.
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        return null;
    }

    let latestTimestamp: Date | null = null;
    let lastWeight: number | null = null;

    for (const doc of snapshot.docs) {
        const job = convertTimestampsToDates(doc.data()) as JobOrder;
        for (const phase of (job.phases || [])) {
            if (
                phase.materialConsumption &&
                phase.materialConsumption.materialId === materialId &&
                phase.materialConsumption.lottoBobina === lotto &&
                phase.materialConsumption.closingWeight !== undefined
            ) {
                 // Find the last work period end time for this phase to determine recency
                const lastWorkPeriodEnd = (phase.workPeriods || []).reduce((latest, wp) => {
                    if (wp.end && (!latest || wp.end > latest)) {
                        return wp.end;
                    }
                    return latest;
                }, null as Date | null);
                
                if (lastWorkPeriodEnd) {
                    if (!latestTimestamp || lastWorkPeriodEnd > latestTimestamp) {
                        latestTimestamp = lastWorkPeriodEnd;
                        lastWeight = phase.materialConsumption.closingWeight;
                    }
                }
            }
        }
    }
    
    return lastWeight;
}


