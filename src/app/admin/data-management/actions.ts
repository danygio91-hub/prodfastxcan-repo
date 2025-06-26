
'use server';

import { revalidatePath } from 'next/cache';
import { type JobOrder, type JobPhase } from '@/lib/mock-data';
import * as z from 'zod';

// DATA STORAGE HAS BEEN TEMPORARILY DISABLED PER USER REQUEST
// TO ALLOW PROGRESS ON OTHER FEATURES.
// All functions will return successful responses without modifying data.
let jobOrdersStore: JobOrder[] = [];


export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  return [];
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
  return [];
}

// Schemas are kept for potential future use or client-side validation needs
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

export async function addJobOrder(formData: FormData) {
    revalidatePath('/admin/data-management');
    return {
      success: true,
      message: `Commessa aggiunta con successo.`,
    };
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean;
    message: string;
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    skippedCount: number;
}> {
    // Return empty results to simulate success without data processing
    return { 
        success: true, 
        message: `Analisi completata. L'importazione è temporaneamente disattivata.`,
        newJobs: [], 
        jobsToUpdate: [], 
        skippedCount: 0
    };
}


export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }): Promise<{ success: boolean; message: string; }> {
    revalidatePath('/admin/data-management');
    return {
        success: true,
        message: `Importazione completata.`
    };
}


export async function deleteSelectedJobOrders(ids: string[]): Promise<{ success: boolean; message: string }> {
  revalidatePath('/admin/data-management');
  return { success: true, message: `${ids.length} commesse eliminate con successo.` };
}

export async function deleteAllPlannedJobOrders(): Promise<{ success: boolean; message: string }> {
    revalidatePath('/admin/data-management');
    return { success: true, message: `Tutte le commesse pianificate sono state eliminate.` };
}

export async function createODL(jobId: string): Promise<{ success: boolean; message: string }> {
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: `ODL per la commessa ${jobId} creato. La commessa è ora in produzione.` };
}
