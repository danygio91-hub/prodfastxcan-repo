
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, RawMaterial } from '@/lib/mock-data';
import type { ActiveMaterialSessionData } from '@/contexts/ActiveMaterialSessionProvider';

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
  
  try {
    await runTransaction(db, async (transaction) => {
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists()) {
            throw new Error("Materia prima associata alla sessione non trovata.");
        }
        
        const consumedWeight = sessionData.openingWeight - closingWeight;
        if (consumedWeight < 0) {
            throw new Error("Il peso di chiusura non può essere maggiore di quello di apertura.");
        }
        
        const materialData = materialDoc.data() as RawMaterial;
        const newWeightKg = materialData.currentWeightKg - consumedWeight;
        
        if (newWeightKg < 0) {
           throw new Error(`Stock insufficiente. Peso disponibile: ${materialData.currentWeightKg.toFixed(2)}kg, richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }

        // 1. Update material stock
        transaction.update(materialRef, { currentWeightKg: newWeightKg });

        // 2. Create a single withdrawal log for the entire session
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

        // 3. Update all associated job orders to record the closing weight
        const jobRefs = sessionData.associatedJobs.map(j => doc(db, "jobOrders", j.jobId));
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));

        for (const jobDoc of jobDocs) {
            if (jobDoc.exists()) {
                const jobData = jobDoc.data() as JobOrder;
                const updatedPhases = jobData.phases.map(p => {
                    if (p.materialConsumption?.materialId === sessionData.materialId && p.materialConsumption.openingWeight === sessionData.openingWeight) {
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
