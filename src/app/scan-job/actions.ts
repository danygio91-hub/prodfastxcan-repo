'use server';

import { revalidatePath } from 'next/cache';
import { mockJobOrders, type JobOrder } from '@/lib/mock-data';

/**
 * Finds a job order in the mock database and returns a deep copy.
 * @param jobId The ID of the job to find.
 * @returns An object containing the job and its index, or null if not found.
 */
const findJob = (jobId: string) => {
    const jobIndex = mockJobOrders.findIndex(j => j.id === jobId);
    if (jobIndex === -1) {
        return { job: null, jobIndex: -1 };
    }
    // Return a deep copy to avoid direct mutation of the found object before it's intentionally replaced
    return { job: JSON.parse(JSON.stringify(mockJobOrders[jobIndex])), jobIndex };
};

/**
 * Retrieves a single job order by its ID.
 * @param id The ID of the job order.
 * @returns A deep copy of the job order or null if not found.
 */
export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    const job = mockJobOrders.find(j => j.id === id);
    if (!job) return null;
    return JSON.parse(JSON.stringify(job));
}

/**
 * Simulates scanning for a job available for a specific department.
 * @param operatorDepartment The department of the operator scanning.
 * @returns A job order or an error object.
 */
export async function getScannableJob(operatorDepartment: string): Promise<JobOrder | { error: string, title?: string }> {
    const availableJobs = mockJobOrders.filter(job => job.status === 'production');

    if (availableJobs.length === 0) {
        return { 
            error: "Nessuna Commessa in Produzione. Creare un ODL da 'Gestione Dati' nell'area admin.",
            title: "Nessuna Commessa in Produzione"
        };
    }
    
    // For simulation, find a job that matches the department
    const suitableJobs = availableJobs.filter(job => job.department === operatorDepartment);
    
    if (suitableJobs.length === 0) {
       return { 
           error: "Nessuna commessa disponibile per il tuo reparto al momento.",
           title: "Nessuna Commessa per il Reparto"
        };
    }

    const randomJobIndex = Math.floor(Math.random() * suitableJobs.length);
    const job = suitableJobs[randomJobIndex];
    
    // Return a clean copy of the job order, ensuring nested arrays and flags are initialized
    const jobCopy: JobOrder = JSON.parse(JSON.stringify(job));
     jobCopy.phases = jobCopy.phases.map(p => ({
      ...p,
      workPeriods: p.workPeriods || [], 
      workstationScannedAndVerified: p.workstationScannedAndVerified || false,
    }));
    jobCopy.isProblemReported = jobCopy.isProblemReported || false;

    return jobCopy;
}

/**
 * Updates an entire job order in the mock database with the provided data.
 * @param jobData The full, updated job order object.
 * @returns A success or failure message.
 */
export async function updateJob(jobData: JobOrder): Promise<{ success: boolean; message: string; }> {
    const { jobIndex } = findJob(jobData.id);

    if (jobIndex === -1) {
        return { success: false, message: 'Commessa non trovata. Impossibile aggiornare.' };
    }

    // Replace the old job order object with the new, updated one
    mockJobOrders[jobIndex] = jobData;
    
    // Revalidate paths to ensure both operator and admin dashboards update
    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');

    return { success: true, message: `Commessa ${jobData.id} aggiornata con successo.` };
}
