
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, deleteDoc, writeBatch, query, updateDoc, getDoc, where, Timestamp } from 'firebase/firestore';
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
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      throw new Error("Gruppo di lavoro non trovato.");
    }
    
    const groupData = groupSnap.data() as WorkGroup;
    const jobOrderIds = groupData.jobOrderIds || [];
    
    const batch = writeBatch(db);

    if (jobOrderIds.length > 0) {
        const jobsQuery = query(collection(db, 'jobOrders'), where('id', 'in', jobOrderIds));
        const jobsSnapshot = await getDocs(jobsQuery);

        jobsSnapshot.forEach(jobDoc => {
            const jobData = jobDoc.data() as JobOrder;
            
            // Proportional time calculation
            const jobProportion = groupData.totalQuantity > 0 ? (jobData.qta / groupData.totalQuantity) : 0;
            
            const inheritedPhases = (groupData.phases || []).map(groupPhase => {
                const inheritedWorkPeriods: WorkPeriod[] = (groupPhase.workPeriods || []).map(wp => {
                    if (wp.end) {
                        const start = new Date(wp.start).getTime();
                        const end = new Date(wp.end).getTime();
                        const duration = end - start;
                        const proportionalDuration = duration * jobProportion;
                        const newEnd = new Date(start + proportionalDuration);
                        return { ...wp, end: newEnd };
                    }
                    return wp; // Keep active work periods as they are, they'll be managed individually later
                });
                
                return {
                    ...groupPhase,
                    workPeriods: inheritedWorkPeriods,
                };
            });
            
            // Revert job to a "planned" state and remove group association
            batch.update(jobDoc.ref, { 
                workGroupId: null, // This is the most important part
                phases: inheritedPhases,
                // We keep the current status from the group, as it's been worked on.
                // Resetting to 'planned' would lose all progress info.
                status: groupData.status, 
                overallStartTime: groupData.overallStartTime || null,
                // Don't set end time, as the job is now standalone and might continue
                overallEndTime: null, 
                // Copy over problem state if any
                isProblemReported: groupData.isProblemReported || false,
                problemType: groupData.problemType || null,
                problemNotes: groupData.problemNotes || null,
                problemReportedBy: groupData.problemReportedBy || null,
            });
        });
    }

    // Delete the group document
    batch.delete(groupRef);

    await batch.commit();

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');

    return { success: true, message: `Gruppo ${groupId} sciolto. Le commesse ora sono indipendenti.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error dissolving work group:", error);
    return { success: false, message: errorMessage };
  }
}
