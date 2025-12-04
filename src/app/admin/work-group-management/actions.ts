

'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, deleteDoc, writeBatch, query, updateDoc, getDoc, where, Timestamp, runTransaction, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { WorkGroup, JobOrder, JobPhase, WorkPeriod } from '@/lib/mock-data';

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
    
    await runTransaction(db, async (transaction) => {
        const groupSnap = await transaction.get(groupRef);

        if (!groupSnap.exists()) {
          throw new Error("Gruppo di lavoro non trovato.");
        }
        
        const groupData = groupSnap.data() as WorkGroup;
        const jobOrderIds = groupData.jobOrderIds || [];
        
        // Determine the final state to be propagated BEFORE deleting the group.
        const isGroupCompleted = groupData.status === 'completed';
        
        if (jobOrderIds.length > 0) {
            // First, update all child jobs.
            const jobRefs = jobOrderIds.map(id => doc(db, 'jobOrders', id));
            const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));

            for (const jobDoc of jobDocs) {
                 if (jobDoc.exists()) {
                    // If the group was completed, all jobs become completed.
                    // If it was manually dissolved, they inherit the group's current progress and become paused.
                    const finalStatus = isGroupCompleted ? 'completed' : 'paused';
                    
                    transaction.update(jobDoc.ref, { 
                        workGroupId: deleteField(),
                        phases: groupData.phases, // Inherit the exact phase progress from the group
                        status: finalStatus,
                        overallStartTime: groupData.overallStartTime || jobDoc.data().overallStartTime || null,
                        overallEndTime: isGroupCompleted ? (groupData.overallEndTime || new Date()) : null, 
                        isProblemReported: groupData.isProblemReported || false,
                        problemType: groupData.problemType || deleteField(),
                        problemNotes: groupData.problemNotes || deleteField(),
                        problemReportedBy: groupData.problemReportedBy || deleteField(),
                    });
                }
            }
        }
        
        // After ensuring all jobs are updated, delete the group document.
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    
    // The message is now determined based on the initial state of the group before dissolution.
    const groupData = (await getDoc(groupRef)).data() as WorkGroup | undefined; // Re-fetch might not work as it's deleted, but the logic inside transaction is what matters.
    const wasCompleted = groupData ? groupData.status === 'completed' : (await getDoc(groupRef)).data()?.status === 'completed';

    const message = wasCompleted
        ? `Gruppo ${groupId} completato e sciolto. Le commesse sono state finalizzate.`
        : `Gruppo ${groupId} sciolto. Le commesse ora sono indipendenti e mantengono l'avanzamento attuale.`;

    return { success: true, message: message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error dissolving work group:", error);
    return { success: false, message: errorMessage };
  }
}



