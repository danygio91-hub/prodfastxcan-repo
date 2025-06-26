'use server';

import { revalidatePath } from 'next/cache';
import { mockJobOrders, type JobOrder, type JobPhase } from '@/lib/mock-data';
import * as z from 'zod';

// THIS IS A SERVER-SIDE IN-MEMORY "DATABASE" SIMULATION.
// In a real app, you would use Firestore, Prisma, etc.
// NOTE: This data will reset every time the server restarts.
let jobOrdersStore: JobOrder[] = [...mockJobOrders];


export async function getJobOrders(): Promise<JobOrder[]> {
  // In a real app: return await db.jobOrder.findMany();
  // Return a copy to prevent mutation issues
  return JSON.parse(JSON.stringify(jobOrdersStore));
}

const jobOrderFormSchema = z.object({
  ordinePF: z.string().min(1, 'Ordine PF è obbligatorio.'),
  numeroODL: z.string().min(1, 'Numero ODL è obbligatorio.'),
  department: z.string().min(1, 'Reparto è obbligatorio.'),
  details: z.string().min(1, 'Codice Articolo è obbligatorio.'),
  dataConsegnaFinale: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD).'),
  postazioneLavoro: z.string().min(1, 'Postazione di lavoro è obbligatoria.'),
});

export async function addJobOrder(formData: FormData) {
    const values = Object.fromEntries(formData.entries());

    const validatedFields = jobOrderFormSchema.safeParse(values);

    if (!validatedFields.success) {
      return { success: false, message: "Dati non validi." };
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
      phases: defaultPhases,
      isProblemReported: false,
    };

    // In a real app: await db.jobOrder.create({ data: newJobOrder });
    jobOrdersStore.push(newJobOrder);
    
    revalidatePath('/admin/data-management');

    return {
      success: true,
      message: `Commessa ${newJobOrder.ordinePF} aggiunta con successo.`,
    };
}

export async function importJobOrders(data: any[]): Promise<{ success: boolean; message: string; }> {
  let importedCount = 0;
  let skippedCount = 0;

  for (const row of data) {
    // Row from Excel should already be mapped to the correct keys
    const validatedFields = jobOrderFormSchema.safeParse(row);

    if (!validatedFields.success || jobOrdersStore.some(job => job.id === row.ordinePF)) {
      skippedCount++;
      continue; // Skip invalid rows or duplicates
    }

    const { data: validatedData } = validatedFields;

    const defaultPhases: JobPhase[] = [
      { id: `${validatedData.ordinePF}-phase-1`, name: "Preparazione Materiali", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: `${validatedData.ordinePF}-phase-2`, name: "Lavorazione Principale", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: `${validatedData.ordinePF}-phase-3`, name: "Controllo Finale", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
    ];

    const newJobOrder: JobOrder = {
      id: validatedData.ordinePF,
      ...validatedData,
      phases: defaultPhases,
      isProblemReported: false,
    };

    jobOrdersStore.push(newJobOrder);
    importedCount++;
  }
  
  if (importedCount > 0) {
    revalidatePath('/admin/data-management');
  }

  return {
    success: true,
    message: `Importazione completata. ${importedCount} commesse importate, ${skippedCount} ignorate (duplicati o dati non validi).`,
  };
}
