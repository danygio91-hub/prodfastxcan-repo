
'use server';

import { revalidatePath } from 'next/cache';
import { collection, query, where, getDocs, doc, setDoc, getDoc, writeBatch, deleteDoc, updateDoc, Timestamp, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, WorkPhaseTemplate, WorkCycle } from '@/lib/mock-data';
import * as z from 'zod';

// Helper function to sanitize Firestore document IDs
function sanitizeDocumentId(id: string): string {
  // Replace slashes with dashes, and remove other invalid characters for Firestore IDs
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}

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

async function createPhasesFromCycle(cycleId: string): Promise<JobPhase[]> {
    if (!cycleId) return [];
    
    const cycleRef = doc(db, "workCycles", cycleId);
    const cycleSnap = await getDoc(cycleRef);
    if (!cycleSnap.exists()) {
        console.warn(`Work cycle with id ${cycleId} not found.`);
        return [];
    }
    const cycle = cycleSnap.data() as WorkCycle;
    const phaseTemplateIds = cycle.phaseTemplateIds;

    if (!phaseTemplateIds || phaseTemplateIds.length === 0) {
        return [];
    }

    const templatesRef = collection(db, "workPhaseTemplates");
    const q = query(templatesRef, where("id", "in", phaseTemplateIds));
    const templatesSnap = await getDocs(q);
    const templates = templatesSnap.docs.map(d => d.data() as WorkPhaseTemplate);

    const phases: JobPhase[] = templates.map(template => ({
        id: template.id,
        name: template.name,
        status: 'pending',
        materialReady: !(template.requiresMaterialScan),
        workPeriods: [],
        sequence: template.sequence,
        type: template.type,
        requiresMaterialScan: template.requiresMaterialScan,
        materialConsumption: null,
    }));

    // Ensure the first production phase is marked as materialReady if there are no preparation phases
    if (!phases.some(p => p.type === 'preparation')) {
        const firstProductionPhase = phases.find(p => p.sequence === 1);
        if (firstProductionPhase) {
            firstProductionPhase.materialReady = true;
        }
    }

    return phases.sort((a, b) => a.sequence - b.sequence);
}

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const jobsRef = collection(db, "jobOrders");
  const q = query(jobsRef, where("status", "==", "planned"));
  const querySnapshot = await getDocs(q);
  const jobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
  return jobs;
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "in", ["production", "suspended"]));
    const querySnapshot = await getDocs(q);
    const jobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    return jobs;
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean;
    message: string;
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    skippedCount: number;
}> {
    const newJobs: JobOrder[] = [];
    const jobsToUpdate: JobOrder[] = [];
    let skippedCount = 0;

    // Fetch all work cycles once to create a lookup map
    const workCyclesSnap = await getDocs(collection(db, "workCycles"));
    const workCyclesMap = new Map(workCyclesSnap.docs.map(doc => {
        const cycleData = doc.data() as Omit<WorkCycle, 'id'>;
        return [cycleData.name, { ...cycleData, id: doc.id }];
    }));

    const importSchema = z.object({
      cliente: z.coerce.string().optional(),
      ordinePF: z.coerce.string().min(1, "ID Commessa (ordinePF) è obbligatorio."),
      numeroODL: z.coerce.string().optional(),
      details: z.coerce.string().optional(),
      qta: z.coerce.number().positive("La quantità deve essere un numero positivo.").optional(),
      dataConsegnaFinale: z.string().optional(),
      department: z.coerce.string().optional(),
      workCycleName: z.coerce.string().optional(), // Changed from workCycleId
    });

    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success) {
            skippedCount++;
            continue;
        }
        
        const { data: validData } = validated;
        const sanitizedId = sanitizeDocumentId(validData.ordinePF);
        
        const jobRef = doc(db, "jobOrders", sanitizedId);
        const docSnap = await getDoc(jobRef);
        
        // Find work cycle by name and get its ID to create phases
        const workCycle = validData.workCycleName ? workCyclesMap.get(validData.workCycleName.trim()) : undefined;
        const workCycleId = workCycle?.id;
        const phases = workCycleId ? await createPhasesFromCycle(workCycleId) : [];

        if (docSnap.exists()) {
            const existingJob = convertTimestampsToDates(docSnap.data()) as JobOrder;
            const updatedJob: JobOrder = {
                ...existingJob,
                ...validData,
                id: sanitizedId,
                ordinePF: validData.ordinePF, // Keep original user-facing ID
                qta: validData.qta ?? existingJob.qta,
                cliente: validData.cliente ?? existingJob.cliente,
                numeroODL: validData.numeroODL ?? existingJob.numeroODL,
                details: validData.details ?? existingJob.details,
                department: validData.department ?? existingJob.department,
                dataConsegnaFinale: validData.dataConsegnaFinale ?? existingJob.dataConsegnaFinale,
                workCycleId: workCycleId ?? existingJob.workCycleId, // Use found ID
                phases: phases.length > 0 ? phases : existingJob.phases,
            };
            jobsToUpdate.push(updatedJob);
        } else {
            if (validData.qta === undefined) {
                skippedCount++;
                continue; 
            }
            const department = validData.department || "Reparto Generico";
            const newJob: JobOrder = {
                id: sanitizedId,
                status: 'planned',
                postazioneLavoro: 'Da Assegnare',
                phases: phases,
                cliente: validData.cliente || "N/D",
                ordinePF: validData.ordinePF, // Keep original user-facing ID
                numeroODL: validData.numeroODL || "N/D",
                details: validData.details || "N/D",
                qta: validData.qta,
                dataConsegnaFinale: validData.dataConsegnaFinale || '',
                department: department,
                workCycleId: workCycleId || '', // Use found ID
            };
            newJobs.push(newJob);
        }
    }
    
    let message = `Analisi completata. Trovate ${newJobs.length} nuove commesse e ${jobsToUpdate.length} da aggiornare.`;
    if (skippedCount > 0) {
        message += ` ${skippedCount} righe sono state ignorate per dati mancanti o non validi.`;
    }

    return { 
        success: true, 
        message: message,
        newJobs, 
        jobsToUpdate, 
        skippedCount
    };
}


export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }): Promise<{ success: boolean; message: string; }> {
    const batch = writeBatch(db);
    let newCount = data.newJobs.length;
    let updatedCount = data.jobsToUpdate.length;

    data.newJobs.forEach(job => {
        const docRef = doc(db, "jobOrders", job.id);
        batch.set(docRef, job);
    });

    data.jobsToUpdate.forEach(job => {
        const docRef = doc(db, "jobOrders", job.id);
        batch.set(docRef, job, { merge: true }); // Use merge to update existing documents
    });
    
    if(newCount > 0 || updatedCount > 0) {
        await batch.commit();
    }

    revalidatePath('/admin/data-management');
    return {
        success: true,
        message: `Importazione completata. ${newCount} commesse aggiunte, ${updatedCount} aggiornate.`
    };
}


export async function deleteSelectedJobOrders(ids: string[]): Promise<{ success: boolean; message: string }> {
  if (ids.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  const batch = writeBatch(db);
  ids.forEach(id => {
    const docRef = doc(db, "jobOrders", id);
    batch.delete(docRef);
  });

  await batch.commit();
  revalidatePath('/admin/data-management');
  return { success: true, message: `${ids.length} commesse eliminate con successo.` };
}

export async function deleteAllPlannedJobOrders(): Promise<{ success: boolean; message: string }> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "==", "planned"));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        return { success: false, message: 'Nessuna commessa pianificata da eliminare.' };
    }

    const batch = writeBatch(db);
    let deletedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
        deletedCount++;
    });

    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: `Tutte le ${deletedCount} commesse pianificate sono state eliminate.` };
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  
  try {
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);

    // If a manual ODL number is provided, perform a pre-transaction check for uniqueness.
    if (manualOdlNumberStr && manualOdlNumberStr.trim() !== '') {
      const manualOdlNumber = parseInt(manualOdlNumberStr, 10);
      if (isNaN(manualOdlNumber) || manualOdlNumber <= 0) {
        return { success: false, message: "Il numero ODL manuale fornito non è un numero valido." };
      }
      const manualOdlId = `${manualOdlNumber}/${shortYear}`;
      
      const q = query(collection(db, "jobOrders"), where("numeroODLInterno", "==", manualOdlId));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        return { success: false, message: `Errore: L'ODL ${manualOdlId} è già stato utilizzato.` };
      }
    }

    const newOdlData = await runTransaction(db, async (transaction) => {
      // 1. Get the current job data
      const docSnap = await transaction.get(jobRef);
      if (!docSnap.exists() || docSnap.data().status !== 'planned') {
        throw new Error(`Commessa ${jobId} non trovata o non è in stato 'pianificata'.`);
      }

      // 2. Validate it has a work cycle
      const jobData = docSnap.data() as JobOrder;
      if (!jobData.phases || jobData.phases.length === 0) {
        throw new Error(`La commessa ${jobId} non ha un ciclo di lavorazione associato. Impossibile creare ODL.`);
      }

      // 3. Get the counter for the current year
      const counterRef = doc(db, "counters", `odl_${year}`);
      const counterDoc = await transaction.get(counterRef);
      const currentCounter = counterDoc.data()?.value || 0;

      let newOdlId: string;
      let newCounterValue: number;

      if (manualOdlNumberStr && manualOdlNumberStr.trim() !== '') {
        newCounterValue = parseInt(manualOdlNumberStr, 10);
        newOdlId = `${newCounterValue}/${shortYear}`;
      } else {
        newCounterValue = currentCounter + 1;
        newOdlId = `${newCounterValue}/${shortYear}`;
      }
      
      // 4. Prepare update data
      const dataToUpdate = {
        status: 'production' as const,
        odlCreationDate: Timestamp.fromDate(now),
        numeroODLInterno: newOdlId,
        odlCounter: newCounterValue,
      };
      
      // 5. Perform writes within the transaction
      transaction.update(jobRef, dataToUpdate);
      if (newCounterValue > currentCounter) {
        transaction.set(counterRef, { value: newCounterValue });
      }
      
      return { newOdlId };
    });

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return { success: true, message: `ODL #${newOdlData.newOdlId} creato per la commessa ${jobId}. La commessa è ora in produzione.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la creazione dell'ODL.";
    console.error("Failed to create ODL:", error);
    return { success: false, message: errorMessage };
  }
}

export async function createMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  if (jobIds.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }

  let createdCount = 0;
  let failedCount = 0;
  let noCycleCount = 0;

  const now = new Date();
  const year = now.getFullYear();
  const shortYear = year.toString().slice(-2);
  const counterRef = doc(db, "counters", `odl_${year}`);

  try {
    await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let currentCounter = counterDoc.data()?.value || 0;

      const jobDocs = await Promise.all(jobIds.map(id => transaction.get(doc(db, "jobOrders", id))));

      for (const docSnap of jobDocs) {
        if (docSnap.exists() && docSnap.data().status === 'planned') {
          const jobData = docSnap.data() as JobOrder;
          if (!jobData.phases || jobData.phases.length === 0) {
            noCycleCount++;
            continue;
          }
          
          currentCounter++;
          const newOdlId = `${currentCounter}/${shortYear}`;
          
          transaction.update(docSnap.ref, { 
              status: 'production' as const,
              odlCreationDate: Timestamp.fromDate(now),
              numeroODLInterno: newOdlId,
              odlCounter: currentCounter
          });
          createdCount++;

        } else {
          failedCount++;
        }
      }

      if (createdCount > 0) {
        transaction.set(counterRef, { value: currentCounter });
      }
    });
  } catch(error) {
      const errorMessage = error instanceof Error ? error.message : "Errore durante la transazione.";
      console.error("Failed to create multiple ODLs:", error);
      return { success: false, message: `Operazione fallita a causa di un errore di sistema: ${errorMessage}` };
  }

  if (createdCount > 0) {
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
  }

  let messageParts: string[] = [];
  if (createdCount > 0) messageParts.push(`${createdCount} ODL creati con successo.`);
  if (failedCount > 0) messageParts.push(`${failedCount} commesse non valide.`);
  if (noCycleCount > 0) messageParts.push(`${noCycleCount} commesse senza ciclo di lavorazione.`);
  
  const message = messageParts.length > 0 ? messageParts.join(' ') : 'Nessuna operazione eseguita.';

  if (createdCount === 0) {
      return { success: false, message: `Nessun ODL creato. ${message}` };
  }

  return { success: true, message: message.trim() };
}

export async function cancelODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  const docSnap = await getDoc(jobRef);
  
  if (!docSnap.exists() || docSnap.data().status !== 'production') {
    return { success: false, message: `Commessa ${jobId} non trovata o non è in produzione.` };
  }

  // When canceling, we keep the ODL number for historical reference, but reset status
  await updateDoc(jobRef, { status: 'planned' });
  
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: `ODL per la commessa ${jobId} annullato. La commessa è di nuovo pianificata.` };
}


export async function cancelMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  if (jobIds.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  
  const batch = writeBatch(db);
  let canceledCount = 0;
  let failedCount = 0;

  for (const jobId of jobIds) {
    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (docSnap.exists() && docSnap.data().status === 'production') {
      batch.update(jobRef, { status: 'planned' });
      canceledCount++;
    } else {
      failedCount++;
    }
  }

  if (canceledCount > 0) {
    await batch.commit();
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
  }

  let message = '';
  if (canceledCount > 0) {
    message += `${canceledCount} ODL annullati con successo.`;
  }
  if (failedCount > 0) {
    message += ` ${failedCount} commesse non sono state processate perché non trovate o non in produzione.`;
  }
  
  if (canceledCount === 0 && failedCount > 0) {
      return { success: false, message: `Nessun ODL annullato. Le commesse selezionate non sono valide per questa operazione.` };
  }
  
  return { success: true, message: message.trim() };
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const cyclesCol = collection(db, 'workCycles');
  const snapshot = await getDocs(cyclesCol);
  const list = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as WorkCycle);
  return list;
}
