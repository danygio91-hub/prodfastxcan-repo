
'use server';

import { revalidatePath } from 'next/cache';
import { getJobOrdersStore, saveJobOrdersStore, type JobOrder, type JobPhase } from '@/lib/mock-data';
import * as z from 'zod';

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
  const mockJobOrders = await getJobOrdersStore();
  return JSON.parse(JSON.stringify(mockJobOrders.filter(job => job.status === 'planned')));
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
  const mockJobOrders = await getJobOrdersStore();
  return JSON.parse(JSON.stringify(mockJobOrders.filter(job => job.status === 'production')));
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
    
    const mockJobOrders = await getJobOrdersStore();

    const existingJob = mockJobOrders.find(job => job.ordinePF === validatedFields.data.ordinePF);
    if (existingJob) {
      return { success: false, message: `La commessa con ID ${validatedFields.data.ordinePF} esiste già.` };
    }

    const newJobOrder: JobOrder = {
      ...validatedFields.data,
      id: validatedFields.data.ordinePF,
      status: 'planned',
      postazioneLavoro: "Da Assegnare",
      phases: createDefaultPhases(validatedFields.data.department),
      qta: Number(validatedFields.data.qta),
      dataConsegnaFinale: validatedFields.data.dataConsegnaFinale || '',
    };

    mockJobOrders.push(newJobOrder);
    await saveJobOrdersStore(mockJobOrders);
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
    
    const mockJobOrders = await getJobOrdersStore();

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
        const existingJob = mockJobOrders.find(j => j.id === validData.ordinePF);

        if (existingJob) {
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
    let newCount = 0;
    let updatedCount = 0;
    const mockJobOrders = await getJobOrdersStore();

    data.newJobs.forEach(job => {
        if (!mockJobOrders.some(j => j.id === job.id)) {
            mockJobOrders.push(job);
            newCount++;
        }
    });

    data.jobsToUpdate.forEach(job => {
        const index = mockJobOrders.findIndex(j => j.id === job.id);
        if (index !== -1) {
            mockJobOrders[index] = job;
            updatedCount++;
        }
    });
    
    if(newCount > 0 || updatedCount > 0) {
        await saveJobOrdersStore(mockJobOrders);
    }

    revalidatePath('/admin/data-management');
    return {
        success: true,
        message: `Importazione completata. ${newCount} commesse aggiunte, ${updatedCount} aggiornate.`
    };
}


export async function deleteSelectedJobOrders(ids: string[]): Promise<{ success: boolean; message: string }> {
  let deletedCount = 0;
  const mockJobOrders = await getJobOrdersStore();
  const remainingJobs = mockJobOrders.filter(job => {
    if (ids.includes(job.id)) {
      deletedCount++;
      return false;
    }
    return true;
  });

  if (deletedCount > 0) {
    await saveJobOrdersStore(remainingJobs);
    revalidatePath('/admin/data-management');
    return { success: true, message: `${deletedCount} commesse eliminate con successo.` };
  }
  return { success: false, message: 'Nessuna commessa trovata con gli ID forniti.' };
}

export async function deleteAllPlannedJobOrders(): Promise<{ success: boolean; message: string }> {
    const mockJobOrders = await getJobOrdersStore();
    let deletedCount = 0;
    const remainingJobs = mockJobOrders.filter(job => {
        if (job.status === 'planned') {
            deletedCount++;
            return false;
        }
        return true;
    });

    if (deletedCount > 0) {
        await saveJobOrdersStore(remainingJobs);
        revalidatePath('/admin/data-management');
        return { success: true, message: `Tutte le ${deletedCount} commesse pianificate sono state eliminate.` };
    }
    return { success: false, message: `Nessuna commessa pianificata da eliminare.`};
}

export async function createODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const mockJobOrders = await getJobOrdersStore();
  const jobIndex = mockJobOrders.findIndex(job => job.id === jobId && job.status === 'planned');
  
  if (jobIndex === -1) {
    return { success: false, message: `Commessa ${jobId} non trovata o già in produzione.` };
  }

  mockJobOrders[jobIndex].status = 'production';
  
  if (!mockJobOrders[jobIndex].phases || mockJobOrders[jobIndex].phases.length === 0) {
      mockJobOrders[jobIndex].phases = createDefaultPhases(mockJobOrders[jobIndex].department);
  }
  
  await saveJobOrdersStore(mockJobOrders);
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: `ODL per la commessa ${jobId} creato. La commessa è ora in produzione.` };
}

export async function createMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  let createdCount = 0;
  let failedCount = 0;
  const mockJobOrders = await getJobOrdersStore();

  jobIds.forEach(jobId => {
    const jobIndex = mockJobOrders.findIndex(job => job.id === jobId && job.status === 'planned');
    if (jobIndex !== -1) {
      mockJobOrders[jobIndex].status = 'production';
      if (!mockJobOrders[jobIndex].phases || mockJobOrders[jobIndex].phases.length === 0) {
        mockJobOrders[jobIndex].phases = createDefaultPhases(mockJobOrders[jobIndex].department);
      }
      createdCount++;
    } else {
      failedCount++;
    }
  });

  if (createdCount > 0) {
    await saveJobOrdersStore(mockJobOrders);
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
