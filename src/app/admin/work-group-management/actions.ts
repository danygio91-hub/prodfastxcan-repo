

'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, deleteDoc, writeBatch, query, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { WorkGroup, JobOrder } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';


export async function getWorkGroups(): Promise<WorkGroup[]> {
  const groupsCol = collection(db, 'workGroups');
  const snapshot = await getDocs(groupsCol);
  const list = snapshot.docs.map(doc => {
    const data = doc.data();
    // Convert Firestore Timestamp to a serializable format (ISO string)
    if (data.createdAt && typeof data.createdAt.toDate === 'function') {
      data.createdAt = data.createdAt.toDate().toISOString();
    }
     if (data.overallStartTime && typeof data.overallStartTime.toDate === 'function') {
      data.overallStartTime = data.overallStartTime.toDate().toISOString();
    }
    if (data.overallEndTime && typeof data.overallEndTime.toDate === 'function') {
      data.overallEndTime = data.overallEndTime.toDate().toISOString();
    }
    return { id: doc.id, ...data } as WorkGroup;
  });
  return JSON.parse(JSON.stringify(list)); // Extra safety to ensure plain objects
}


export async function dissolveWorkGroup(groupId: string): Promise<{ success: boolean; message: string }> {
  try {
    const groupRef = doc(db, 'workGroups', groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      throw new Error("Gruppo di lavoro non trovato.");
    }
    
    const groupData = groupSnap.data() as WorkGroup;
    const jobOrderIds = groupData.jobOrderIds || [];
    
    const batch = writeBatch(db);

    // Fetch all job documents to update them
    if (jobOrderIds.length > 0) {
        const jobsQuery = query(collection(db, 'jobOrders'), where('id', 'in', jobOrderIds));
        const jobsSnapshot = await getDocs(jobsQuery);

        jobsSnapshot.forEach(jobDoc => {
            const jobData = jobDoc.data() as JobOrder;
            // Reset phase statuses and clear work periods to avoid ghost sessions
            const cleanedPhases = (jobData.phases || []).map(phase => {
                if (phase.status === 'in-progress' || phase.status === 'paused') {
                    return { ...phase, status: 'pending' as const, workPeriods: [] };
                }
                return phase;
            });
            
            // Set job to a safe, paused state and remove group association
            batch.update(jobDoc.ref, { 
                workGroupId: null,
                status: 'paused', // Force a safe, inactive state.
                phases: cleanedPhases
            });
        });
    }

    // Delete the group document
    batch.delete(groupRef);

    await batch.commit();

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');

    return { success: true, message: `Gruppo ${groupId} annullato. Le commesse sono state slegate e messe in pausa.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error dissolving work group:", error);
    return { success: false, message: errorMessage };
  }
}





