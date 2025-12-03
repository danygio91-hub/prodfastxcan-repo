

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
        const isGroupCompleted = groupData.status === 'completed';
        
        if (jobOrderIds.length > 0) {
            const jobsQuery = query(collection(db, 'jobOrders'), where('id', 'in', jobOrderIds));
            const jobsSnapshot = await getDocs(jobsQuery);

            jobsSnapshot.forEach(jobDoc => {
                const jobData = jobDoc.data() as JobOrder;
                
                const finalStatus = isGroupCompleted ? 'completed' : jobData.status;

                // Propagate the group's current phase state to the individual jobs.
                // This ensures that if the group is paused mid-way, the jobs reflect that.
                transaction.update(jobDoc.ref, { 
                    workGroupId: deleteField(),
                    phases: groupData.phases, // Inherit the exact phase progress
                    status: finalStatus,
                    overallStartTime: groupData.overallStartTime || jobData.overallStartTime || null,
                    overallEndTime: isGroupCompleted ? (groupData.overallEndTime || new Date()) : null, 
                    isProblemReported: groupData.isProblemReported || false,
                    problemType: groupData.problemType || deleteField(),
                    problemNotes: groupData.problemNotes || deleteField(),
                    problemReportedBy: groupData.problemReportedBy || deleteField(),
                });
            });
        }
        
        // Delete the group document
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');

    const message = isGroupCompleted
        ? `Gruppo ${groupId} completato e sciolto. Le commesse sono state finalizzate.`
        : `Gruppo ${groupId} sciolto. Le commesse ora sono indipendenti e mantengono l'avanzamento attuale.`;

    return { success: true, message: message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error dissolving work group:", error);
    return { success: false, message: errorMessage };
  }
}
