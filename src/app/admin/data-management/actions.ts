
'use server';

import { revalidatePath } from 'next/cache';
import { collection, query, where, getDocs, doc, setDoc, getDoc, writeBatch, deleteDoc, updateDoc } from 'firebase/firestore';
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

const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, 'Cliente è obbligatorio.'),
  ordinePF: z.string().min(1, 'Ordine PF (ID Commessa) è obbligatorio.'),
  numeroODL: z.string().min(1, 'Ordine Nr Est è obbligatorio.'),
  details: z.string().min(1, 'Codice è obbligatorio.'),
  qta: z.coerce.number().positive('La quantità deve essere un numero positivo.'),
  dataConsegnaFinale: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD).').optional().or(z.literal('')),
  department: z.enum(['CP', 'CG', 'BF', 'MAG'], {
    errorMap: () => ({ message: "Selezionare un reparto di produzione valido." })
  }),
  workCycleId: z.string().optional(),
});

export async function addJobOrder(formData: FormData) {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = jobOrderFormSchema.safeParse(rawData);
    
    if (!validatedFields.success) {
      return { success: false, message: 'Dati del modulo non validi.', errors: validatedFields.error.flatten().fieldErrors };
    }
    
    const data = validatedFields.data;
    const jobId = sanitizeDocumentId(data.ordinePF);

    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (docSnap.exists()) {
      return { success: false, message: `La commessa con ID ${data.ordinePF} esiste già.` };
    }

    const phases = data.workCycleId ? await createPhasesFromCycle(data.workCycleId) : [];

    const newJobOrder: JobOrder = {
      ...data,
      id: jobId,
      ordinePF: data.ordinePF, // Keep original user-facing ID
      status: 'planned',
      postazioneLavoro: "Da Assegnare",
      phases: phases,
      qta: Number(data.qta),
      dataConsegnaFinale: data.dataConsegnaFinale || '',
      workCycleId: data.workCycleId || '',
    };

    await setDoc(jobRef, newJobOrder);
    revalidatePath('/admin/data-management');
    return {
      success: true,
      message: `Commessa ${newJobOrder.ordinePF} aggiunta con successo.`,
    };
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

    const importSchema = z.object({
      cliente: z.coerce.string().optional(),
      ordinePF: z.coerce.string().min(1, "ID Commessa (ordinePF) è obbligatorio."),
      numeroODL: z.coerce.string().optional(),
      details: z.coerce.string().optional(),
      qta: z.coerce.number().positive("La quantità deve essere un numero positivo.").optional(),
      dataConsegnaFinale: z.string().optional(),
      department: z.coerce.string().optional(),
      workCycleId: z.coerce.string().optional(),
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
        const phases = validData.workCycleId ? await createPhasesFromCycle(validData.workCycleId) : [];

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
                workCycleId: validData.workCycleId ?? existingJob.workCycleId,
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
                workCycleId: validData.workCycleId || '',
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

export async function createODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  const docSnap = await getDoc(jobRef);
  
  if (!docSnap.exists() || docSnap.data().status !== 'planned') {
    return { success: false, message: `Commessa ${jobId} non trovata o già in produzione.` };
  }

  const jobData = docSnap.data() as JobOrder;
  if (!jobData.phases || jobData.phases.length === 0) {
      return { success: false, message: `La commessa ${jobId} non ha un ciclo di lavorazione associato. Impossibile creare ODL.` };
  }
  
  jobData.status = 'production';

  await setDoc(jobRef, jobData, { merge: true });
  
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: `ODL per la commessa ${jobId} creato. La commessa è ora in produzione.` };
}

export async function createMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  let createdCount = 0;
  let failedCount = 0;
  let noCycleCount = 0;

  const batch = writeBatch(db);

  for (const jobId of jobIds) {
    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (docSnap.exists() && docSnap.data().status === 'planned') {
        const jobData = docSnap.data() as JobOrder;
        if (!jobData.phases || jobData.phases.length === 0) {
            noCycleCount++;
            continue;
        }
        batch.update(jobRef, { status: 'production' });
        createdCount++;
    } else {
        failedCount++;
    }
  }

  if (createdCount > 0) {
    await batch.commit();
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
  }

  let message = '';
  if (createdCount > 0) {
    message += `${createdCount} ODL creati con successo. Le commesse sono ora in produzione. `;
  }
  if (failedCount > 0) {
    message += `${failedCount} commesse non processate (non trovate o già in produzione). `;
  }
  if (noCycleCount > 0) {
    message += `${noCycleCount} commesse ignorate perché non hanno un ciclo di lavorazione.`;
  }

  if (createdCount === 0 && (failedCount > 0 || noCycleCount > 0)) {
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
