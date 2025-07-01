
'use server';

import { revalidatePath } from 'next/cache';
import { collection, query, where, getDocs, doc, setDoc, getDoc, writeBatch, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase } from '@/lib/mock-data';
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


const createDefaultPhases = (department: string): JobPhase[] => {
  if (department === 'Assemblaggio Componenti Elettronici') {
    return [
      { id: 'phase-1', name: 'Preparazione Componenti', status: 'pending', materialReady: true, workPeriods: [], sequence: 1 },
      { id: 'phase-2', name: 'Assemblaggio Scheda', status: 'pending', materialReady: false, workPeriods: [], sequence: 2 },
      { id: 'phase-3', name: 'Saldatura', status: 'pending', materialReady: false, workPeriods: [], sequence: 3 },
    ];
  }
  if (department === 'Controllo Qualità') {
     return [
      { id: 'phase-1', name: 'Test Funzionale', status: 'pending', materialReady: true, workPeriods: [], sequence: 1 },
      { id: 'phase-2', name: 'Ispezione Visiva', status: 'pending', materialReady: false, workPeriods: [], sequence: 2 },
    ];
  }
  return [
    { id: 'phase-1', name: 'Lavorazione Generica', status: 'pending', materialReady: true, workPeriods: [], sequence: 1 },
  ];
};

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const jobsRef = collection(db, "jobOrders");
  const q = query(jobsRef, where("status", "==", "planned"));
  const querySnapshot = await getDocs(q);
  const jobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
  return jobs;
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "==", "production"));
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
  department: z.string().min(1, 'Reparto è obbligatorio.'),
});

export async function addJobOrder(formData: FormData) {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = jobOrderFormSchema.safeParse(rawData);
    
    if (!validatedFields.success) {
      return { success: false, message: 'Dati del modulo non validi.', errors: validatedFields.error.flatten().fieldErrors };
    }
    
    const jobId = validatedFields.data.ordinePF;
    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (docSnap.exists()) {
      return { success: false, message: `La commessa con ID ${jobId} esiste già.` };
    }

    const newJobOrder: JobOrder = {
      ...validatedFields.data,
      id: jobId,
      status: 'planned',
      postazioneLavoro: "Da Assegnare",
      phases: createDefaultPhases(validatedFields.data.department),
      qta: Number(validatedFields.data.qta),
      dataConsegnaFinale: validatedFields.data.dataConsegnaFinale || '',
    };

    await setDoc(jobRef, newJobOrder);
    revalidatePath('/admin/data-management');
    return {
      success: true,
      message: `Commessa ${newJobOrder.id} aggiunta con successo.`,
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
    });

    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success) {
            skippedCount++;
            continue;
        }
        
        const { data: validData } = validated;
        const jobRef = doc(db, "jobOrders", validData.ordinePF);
        const docSnap = await getDoc(jobRef);

        if (docSnap.exists()) {
            const existingJob = convertTimestampsToDates(docSnap.data()) as JobOrder;
            const updatedJob: JobOrder = {
                ...existingJob,
                ...validData,
                qta: validData.qta ?? existingJob.qta,
                cliente: validData.cliente ?? existingJob.cliente,
                numeroODL: validData.numeroODL ?? existingJob.numeroODL,
                details: validData.details ?? existingJob.details,
                department: validData.department ?? existingJob.department,
                dataConsegnaFinale: validData.dataConsegnaFinale ?? existingJob.dataConsegnaFinale,
            };
            jobsToUpdate.push(updatedJob);
        } else {
            if (validData.qta === undefined) {
                skippedCount++;
                continue; 
            }
            const department = validData.department || "Reparto Generico";
            const newJob: JobOrder = {
                id: validData.ordinePF,
                status: 'planned',
                postazioneLavoro: 'Da Assegnare',
                phases: createDefaultPhases(department),
                cliente: validData.cliente || "N/D",
                ordinePF: validData.ordinePF,
                numeroODL: validData.numeroODL || "N/D",
                details: validData.details || "N/D",
                qta: validData.qta,
                dataConsegnaFinale: validData.dataConsegnaFinale || '',
                department: department,
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
      jobData.phases = createDefaultPhases(jobData.department);
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

  const batch = writeBatch(db);

  for (const jobId of jobIds) {
    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (docSnap.exists() && docSnap.data().status === 'planned') {
        const jobData = docSnap.data() as JobOrder;
        let phases = jobData.phases;
        if (!phases || phases.length === 0) {
            phases = createDefaultPhases(jobData.department);
        }
        batch.update(jobRef, { status: 'production', phases: phases });
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
    message += `${createdCount} ODL creati con successo. Le commesse sono ora in produzione.`;
  }
  if (failedCount > 0) {
    message += ` ${failedCount} commesse non sono state processate perché non trovate o già in produzione.`;
  }
  if (createdCount === 0 && failedCount > 0) {
      return { success: false, message: `Nessun ODL creato. Le commesse selezionate non sono valide per questa operazione.` };
  }

  return { success: true, message: message.trim() };
}

export async function cancelODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  const docSnap = await getDoc(jobRef);
  
  if (!docSnap.exists() || docSnap.data().status !== 'production') {
    return { success: false, message: `Commessa ${jobId} non trovata o non è in produzione.` };
  }

  await setDoc(jobRef, { status: 'planned' }, { merge: true });
  
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: `ODL per la commessa ${jobId} annullato. La commessa è di nuovo pianificata.` };
}
