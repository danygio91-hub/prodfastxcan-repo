

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

    // Reset the state for each job order.
    // Set status to paused to prevent them from being stuck in an active state.
    jobOrderIds.forEach(jobId => {
      const jobRef = doc(db, 'jobOrders', jobId);
      batch.update(jobRef, { 
        workGroupId: null,
        status: 'paused', // Force a safe, inactive state.
      });
    });

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



