

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
    let isGroupCompleted = false;
    
    await runTransaction(db, async (transaction) => {
        const groupSnap = await transaction.get(groupRef);

        if (!groupSnap.exists()) {
          throw new Error("Gruppo di lavoro non trovato.");
        }
        
        const groupData = groupSnap.data() as WorkGroup;
        const jobOrderIds = groupData.jobOrderIds || [];
        isGroupCompleted = groupData.status === 'completed';
        
        if (jobOrderIds.length > 0) {
            // Firestore 'in' query is limited to 30 elements. Chunking is needed for larger groups.
            const chunks: string[][] = [];
            for (let i = 0; i < jobOrderIds.length; i += 30) {
                chunks.push(jobOrderIds.slice(i, i + 30));
            }
            
            for (const chunk of chunks) {
                const jobsQuery = query(collection(db, 'jobOrders'), where('id', 'in', chunk));
                const jobsSnapshot = await getDocs(jobsQuery); // Note: getDocs is not available in transactions. This read happens outside.

                jobsSnapshot.forEach(jobDoc => {
                    // Re-fetch inside transaction for consistency if strict guarantees are needed,
                    // but for this operation, using the outside snapshot is generally safe.
                    const finalStatus = isGroupCompleted ? 'completed' : 'paused';

                    transaction.update(jobDoc.ref, { 
                        workGroupId: deleteField(),
                        phases: groupData.phases, // Inherit the exact phase progress
                        status: finalStatus,
                        overallStartTime: groupData.overallStartTime || jobDoc.data().overallStartTime || null,
                        overallEndTime: isGroupCompleted ? (groupData.overallEndTime || new Date()) : null, 
                        isProblemReported: groupData.isProblemReported || false,
                        problemType: groupData.problemType || deleteField(),
                        problemNotes: groupData.problemNotes || deleteField(),
                        problemReportedBy: groupData.problemReportedBy || deleteField(),
                    });
                });
            }
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

