
'use server';

import { revalidatePath } from 'next/cache';
import { type JobOrder, type JobPhase } from '@/lib/mock-data';
import * as z from 'zod';

// THIS IS A SERVER-SIDE IN-MEMORY "DATABASE" SIMULATION.
// In a real app, you would use Firestore, Prisma, etc.
// NOTE: This data will reset every time the server restarts.
let jobOrdersStore: JobOrder[] = [];


export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  // Return a copy to prevent mutation issues
  return JSON.parse(JSON.stringify(jobOrdersStore.filter(job => job.status === 'planned')));
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
  // Return a copy to prevent mutation issues
  return JSON.parse(JSON.stringify(jobOrdersStore.filter(job => job.status === 'production')));
}

// Schema for manual form validation
const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, 'Cliente è obbligatorio.'),
  ordinePF: z.string().min(1, 'Ordine PF (ID Commessa) è obbligatorio.'),
  numeroODL: z.string().min(1, 'Ordine Nr Est è obbligatorio.'),
  details: z.string().min(1, 'Codice è obbligatorio.'),
  qta: z.coerce.number().positive('La quantità deve essere un numero positivo.'),
  dataConsegnaFinale: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD).')
    .or(z.string().length(0)), // Allow empty string
  department: z.string().min(1, 'Reparto è obbligatorio.'),
});

// Schema for Excel import validation
const jobOrderImportSchema = jobOrderFormSchema.omit({ postazioneLavoro: true });

export async function addJobOrder(formData: FormData) {
    const values = {
      cliente: formData.get('cliente'),
      ordinePF: formData.get('ordinePF'),
      numeroODL: formData.get('numeroODL'),
      details: formData.get('details'),
      qta: formData.get('qta'),
      dataConsegnaFinale: formData.get('dataConsegnaFinale'),
      department: formData.get('department'),
    };

    const validatedFields = jobOrderFormSchema.safeParse(values);

    if (!validatedFields.success) {
      const errorMessages = validatedFields.error.issues.map(issue => issue.message).join(' ');
      return { success: false, message: `Dati non validi: ${errorMessages}` };
    }

    const { data } = validatedFields;
    
    if (jobOrdersStore.some(job => job.id === data.ordinePF)) {
        return { success: false, message: `Commessa con ID ${data.ordinePF} esiste già.` };
    }

    const defaultPhases: JobPhase[] = [
      { id: `${data.ordinePF}-phase-1`, name: "Preparazione Materiali", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: `${data.ordinePF}-phase-2`, name: "Lavorazione Principale", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: `${data.ordinePF}-phase-3`, name: "Controllo Finale", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
    ];

    const newJobOrder: JobOrder = {
      id: data.ordinePF,
      ...data,
      postazioneLavoro: 'Da Assegnare',
      phases: defaultPhases,
      isProblemReported: false,
      status: 'planned',
    };

    jobOrdersStore.push(newJobOrder);
    
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
    let newJobs: JobOrder[] = [];
    let jobsToUpdate: JobOrder[] = [];
    let skippedCount = 0;

    for (const row of data) {
        if (!row.ordinePF) {
            skippedCount++;
            continue;
        }

        const validatedFields = jobOrderImportSchema.safeParse(row);

        if (!validatedFields.success) {
            skippedCount++;
            continue;
        }

        const { data: validatedData } = validatedFields;

        const defaultPhases: JobPhase[] = [
            { id: `${validatedData.ordinePF}-phase-1`, name: "Preparazione Materiali", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
            { id: `${validatedData.ordinePF}-phase-2`, name: "Lavorazione Principale", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
            { id: `${validatedData.ordinePF}-phase-3`, name: "Controllo Finale", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
        ];

        const jobOrderObject: JobOrder = {
            id: validatedData.ordinePF,
            ...validatedData,
            postazioneLavoro: 'Da Assegnare',
            phases: defaultPhases,
            isProblemReported: false,
            status: 'planned',
        };

        const existingJob = jobOrdersStore.find(job => job.id === jobOrderObject.id);
        if (existingJob) {
            jobsToUpdate.push({ ...jobOrderObject, status: existingJob.status }); // Preserve status of existing job
        } else {
            newJobs.push(jobOrderObject);
        }
    }

    const message = `Analisi completata: ${newJobs.length} nuove commesse, ${jobsToUpdate.length} duplicati, ${skippedCount} righe ignorate.`;
    return { success: true, message, newJobs, jobsToUpdate, skippedCount };
}


export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }): Promise<{ success: boolean; message: string; }> {
    const { newJobs, jobsToUpdate } = data;

    // Update existing jobs
    jobsToUpdate.forEach(updatedJob => {
        const index = jobOrdersStore.findIndex(job => job.id === updatedJob.id);
        if (index !== -1) {
            jobOrdersStore[index] = updatedJob; // Overwrite with new data, status is preserved from previous step
        }
    });

    // Add new jobs
    jobOrdersStore.push(...newJobs);

    const totalAffected = newJobs.length + jobsToUpdate.length;
    if (totalAffected > 0) {
        revalidatePath('/admin/data-management');
    }

    return {
        success: true,
        message: `Importazione completata. ${newJobs.length} commesse aggiunte, ${jobsToUpdate.length} aggiornate.`
    };
}


export async function deleteSelectedJobOrders(ids: string[]): Promise<{ success: boolean; message: string }> {
  const initialCount = jobOrdersStore.length;
  jobOrdersStore = jobOrdersStore.filter(job => !ids.includes(job.id));
  const deletedCount = initialCount - jobOrdersStore.length;

  if (deletedCount > 0) {
    revalidatePath('/admin/data-management');
    return { success: true, message: `${deletedCount} commesse eliminate con successo.` };
  }
  return { success: false, message: 'Nessuna commessa trovata da eliminare.' };
}

export async function deleteAllPlannedJobOrders(): Promise<{ success: boolean; message: string }> {
    const plannedJobsCount = jobOrdersStore.filter(j => j.status === 'planned').length;
    if (plannedJobsCount === 0) {
        return { success: false, message: 'Nessuna commessa pianificata da eliminare.' };
    }
    jobOrdersStore = jobOrdersStore.filter(j => j.status !== 'planned');
    revalidatePath('/admin/data-management');
    return { success: true, message: `Tutte le ${plannedJobsCount} commesse pianificate sono state eliminate.` };
}

export async function createODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const job = jobOrdersStore.find(j => j.id === jobId);
  if (job) {
    if (job.status === 'production') {
      return { success: false, message: `L'ODL per la commessa ${jobId} è già stato creato.` };
    }
    job.status = 'production';
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return { success: true, message: `ODL per la commessa ${jobId} creato. La commessa è ora in produzione.` };
  }
  return { success: false, message: `Commessa con ID ${jobId} non trovata.` };
}
    
