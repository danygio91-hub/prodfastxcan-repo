
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, Operator } from '@/lib/mock-data';
import { getDepartmentMap } from '@/app/admin/settings/actions';

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


export async function getScannableJob(operator: Operator): Promise<JobOrder | { error: string, title?: string }> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "==", "production"));
    const querySnapshot = await getDocs(q);
    const availableJobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);

    if (availableJobs.length === 0) {
        return { 
            error: "Nessuna Commessa in Produzione. Creare un ODL da 'Gestione Dati' nell'area admin.",
            title: "Nessuna Commessa in Produzione"
        };
    }
    
    let suitableJobs: JobOrder[] = [];
    const departmentMap = await getDepartmentMap();

    if (operator.role === 'superadvisor' || operator.role === 'admin') {
        suitableJobs = availableJobs;
    } else {
        const operatorDepartmentName = departmentMap[operator.reparto];
        suitableJobs = availableJobs.filter(job => job.department === operatorDepartmentName);
    }
    
    if (suitableJobs.length === 0) {
       return { 
           error: operator.role === 'superadvisor' || operator.role === 'admin' 
            ? "Nessuna commessa di produzione attiva trovata."
            : `Nessuna commessa disponibile per il tuo reparto (${departmentMap[operator.reparto]}) al momento.`,
           title: "Nessuna Commessa Disponibile"
        };
    }

    const randomJobIndex = Math.floor(Math.random() * suitableJobs.length);
    const job = suitableJobs[randomJobIndex];
    if (!job) {
         return { 
           error: `Errore inaspettato durante la selezione di una commessa casuale.`,
           title: "Errore"
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
        if (allPhasesCompleted && jobData.overallEndTime) {
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
