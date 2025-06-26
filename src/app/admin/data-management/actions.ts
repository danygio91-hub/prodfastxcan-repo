
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
const jobOrderImportSchema = jobOrderFormSchema;

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

        const existingJob = jobOrdersStore.find(job => job.id === row.ordinePF);

        if (existingJob) {
            // It's a potential update. Merge existing data with new data from the row.
            // This ensures that if the Excel row only has a few columns for an update,
            // the other required fields are filled from the existing record before validation.
            const dataForValidation = {
                ...existingJob,
                ...row,
            };

            const validatedFields = jobOrderImportSchema.safeParse(dataForValidation);

            if (validatedFields.success) {
                const { data: validatedData } = validatedFields;

                // Construct the final updated object, using validated data but preserving
                // the status and other non-imported fields from the original existing job.
                const updatedJobObject: JobOrder = {
                    id: validatedData.ordinePF,
                    cliente: validatedData.cliente,
                    ordinePF: validatedData.ordinePF,
                    numeroODL: validatedData.numeroODL,
                    details: validatedData.details,
                    qta: validatedData.qta,
                    dataConsegnaFinale: validatedData.dataConsegnaFinale,
                    department: validatedData.department,
                    postazioneLavoro: existingJob.postazioneLavoro, // Preserve
                    phases: existingJob.phases, // Preserve
                    isProblemReported: existingJob.isProblemReported, // Preserve
                    status: existingJob.status, // Preserve
                };
                jobsToUpdate.push(updatedJobObject);
            } else {
                // The merged data is still invalid, so we skip this row.
                skippedCount++;
            }
        } else {
            // It's a new job. Validate the row as is.
            const validatedFields = jobOrderImportSchema.safeParse(row);
            if (validatedFields.success) {
                const { data: validatedData } = validatedFields;
                const defaultPhases: JobPhase[] = [
                    { id: `${validatedData.ordinePF}-phase-1`, name: "Preparazione Materiali", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
                    { id: `${validatedData.ordinePF}-phase-2`, name: "Lavorazione Principale", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
                    { id: `${validatedData.ordinePF}-phase-3`, name: "Controllo Finale", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
                ];
                const newJobOrder: JobOrder = {
                    id: validatedData.ordinePF,
                    ...validatedData,
                    postazioneLavoro: 'Da Assegnare',
                    phases: defaultPhases,
                    isProblemReported: false,
                    status: 'planned',
                };
                newJobs.push(newJobOrder);
            } else {
                // The new job data is invalid.
                skippedCount++;
            }
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
            // Overwrite with the fully constructed updatedJob object
            jobOrdersStore[index] = updatedJob;
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
  // Only delete from planned jobs
  jobOrdersStore = jobOrdersStore.filter(job => !(ids.includes(job.id) && job.status === 'planned'));
  const deletedCount = initialCount - jobOrdersStore.length;

  if (deletedCount > 0) {
    revalidatePath('/admin/data-management');
    return { success: true, message: `${deletedCount} commesse eliminate con successo.` };
  }
  return { success: false, message: 'Nessuna commessa pianificata trovata da eliminare con gli ID forniti.' };
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
    
