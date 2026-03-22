
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { WorkGroup, JobOrder, JobPhase, WorkPeriod, Operator } from '@/lib/mock-data';

export async function getWorkGroups(): Promise<WorkGroup[]> {
  const snapshot = await adminDb.collection('workGroups').get();
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


export async function dissolveWorkGroup(groupId: string, forceComplete: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    const groupRef = adminDb.collection('workGroups').doc(groupId);
    
    // BLOCCA SCIOGLIMENTO SE SESSIONE MATERIALE ATTIVA
    const opsSnap = await adminDb.collection("operators").get();
    const hasActiveSession = opsSnap.docs.some(docSnap => {
        const op = docSnap.data() as Operator;
        return (op.activeMaterialSessions || []).some(s => s.originatorJobId === groupId || s.associatedJobs.some(aj => aj.jobId === groupId));
    });

    if (hasActiveSession) {
        return { success: false, message: "NON E' POSSIBILE SCOLLEGARE IL GRUPPO: SESSIONE MATERIALE ATTIVA" };
    }

    await adminDb.runTransaction(async (transaction) => {
        const groupSnap = await transaction.get(groupRef);

        if (!groupSnap.exists) {
          throw new Error("Gruppo di lavoro non trovato.");
        }
        
        const groupData = groupSnap.data() as WorkGroup;
        const jobOrderIds = groupData.jobOrderIds || [];
        
        if (jobOrderIds.length === 0) {
            // If no jobs, just delete the group
            transaction.delete(groupRef);
            return;
        }

        // 1. READ all associated jobs to get their original data
        const jobRefs = jobOrderIds.map(id => adminDb.collection('jobOrders').doc(id));
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));
        
        const isGroupCompleted = forceComplete;

        // 2. Iterate through each job and build its new phase data
        for (const jobDoc of jobDocs) {
             if (!jobDoc.exists) continue;
             
             const jobOriginalData = jobDoc.data() as JobOrder;
             // Deep copy of the group's phase structure
             const groupPhases: JobPhase[] = JSON.parse(JSON.stringify(groupData.phases));

             // Unisci l'avanzamento del gruppo con le fasi originali della commessa
             // Le fasi individuali (es. Qualità) rimangono intatte
             const finalJobPhases = (jobOriginalData.phases || []).map(originalPhase => {
                 const matchedGroupPhase = groupPhases.find(gp => gp.id === originalPhase.id);
                 if (matchedGroupPhase) {
                     return {
                         ...originalPhase,
                         status: matchedGroupPhase.status,
                         workPeriods: matchedGroupPhase.workPeriods || originalPhase.workPeriods,
                         materialConsumptions: matchedGroupPhase.materialConsumptions || originalPhase.materialConsumptions,
                         materialReady: matchedGroupPhase.materialReady
                     };
                 }
                 return originalPhase;
             });

             const finalStatus = isGroupCompleted ? 'completed' : 'paused';
                
             transaction.update(jobDoc.ref, { 
                workGroupId: admin.firestore.FieldValue.delete(),
                phases: finalJobPhases, // Inherit phase progress, keeping material consumptions
                status: finalStatus,
                overallStartTime: groupData.overallStartTime || jobOriginalData.overallStartTime || null,
                overallEndTime: isGroupCompleted ? (groupData.overallEndTime || new Date()) : null, 
                isProblemReported: groupData.isProblemReported || false,
                problemType: groupData.problemType || admin.firestore.FieldValue.delete(),
                problemNotes: groupData.problemNotes || admin.firestore.FieldValue.delete(),
                problemReportedBy: groupData.problemReportedBy || admin.firestore.FieldValue.delete(),
            });
        }
        
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    
    return { success: true, message: `Gruppo sciolto.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore.";
    return { success: false, message: errorMessage };
  }
}
