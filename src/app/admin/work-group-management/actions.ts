
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { WorkGroup, JobOrder, JobPhase, WorkPeriod, Operator } from '@/types';
import { pulseOperatorsForJob } from '@/lib/job-sync-server';


export async function getWorkGroups(): Promise<WorkGroup[]> {
  const snapshot = await adminDb.collection('workGroups').orderBy('createdAt', 'desc').limit(200).get();
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


export async function dissolveWorkGroup(groupId: string, forceComplete: boolean = false, forceUnlock: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    const groupRef = adminDb.collection('workGroups').doc(groupId);
    
    // 1. SAFETY CHECK: BLOCCA SCIOGLIMENTO SOLO SE SESSIONI DI LAVORO ATTIVE (CLOCK-IN)
    const opsSnap = await adminDb.collection("operators").get();
    const activeOperators = opsSnap.docs.filter(docSnap => {
        const op = docSnap.data() as Operator;
        return op.activeJobId === groupId;
    });

    if (activeOperators.length > 0 && !forceUnlock) {
        const names = activeOperators.map(d => (d.data() as Operator).nome).join(", ");
        return { 
            success: false, 
            message: `Impossibile scollegare: l'operatore [${names}] ha una fase di lavoro attiva su questa commessa. Termina prima la fase (Clock-out) per poter modificare il gruppo.` 
        };
    }

    const blockerIds = activeOperators.map(d => d.id);

    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
        return { success: false, message: "Gruppo di lavoro non trovato." };
    }
    
    const groupDataRaw = groupSnap.data();
    // Convert timestamps for initial checks
    if (groupDataRaw?.createdAt?.toDate) groupDataRaw.createdAt = groupDataRaw.createdAt.toDate();
    if (groupDataRaw?.overallStartTime?.toDate) groupDataRaw.overallStartTime = groupDataRaw.overallStartTime.toDate();
    if (groupDataRaw?.overallEndTime?.toDate) groupDataRaw.overallEndTime = groupDataRaw.overallEndTime.toDate();
    
    const groupData = groupDataRaw as WorkGroup;
    const jobOrderIds = groupData.jobOrderIds || [];

    if (jobOrderIds.length === 0) {
        await groupRef.delete();
        return { success: true, message: "Gruppo vuoto eliminato." };
    }

    // 2. RECUPERA PRELIEVI (Per lo split contabile)
    const withdrawalsSnap = await adminDb.collection("materialWithdrawals")
        .where("jobIds", "array-contains", groupId)
        .get();
    
    const groupWithdrawals = withdrawalsSnap.docs.map(doc => {
        const data = doc.data();
        if (data.withdrawalDate?.toDate) data.withdrawalDate = data.withdrawalDate.toDate();
        return { id: doc.id, ...data } as any;
    });

    // 3. TRANSAZIONE DI SCIOGLIMENTO E RIPARTIZIONE (REMAINDER METHOD)
    await adminDb.runTransaction(async (transaction) => {
        const gSnapTx = await transaction.get(groupRef);
        if (!gSnapTx.exists) throw new Error("Gruppo di lavoro non trovato.");
        
        const gData = gSnapTx.data() as WorkGroup;
        const jobRefs = jobOrderIds.map(id => adminDb.collection('jobOrders').doc(id));
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));
        
        const jobs = jobDocs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(), 
            ref: doc.ref 
        } as any));

        // FORCE UNLOCK: Clear state of any blocking operators found during safety check
        for (const opId of blockerIds) {
            const opRef = adminDb.collection("operators").doc(opId);
            transaction.update(opRef, {
                activeJobId: null,
                activePhaseName: null,
                stato: 'inattivo',
                activeMaterialSessions: [] // Defensive clearing
            });
        }

        const totalQty = gData.totalQuantity;
        const totalJobsCount = jobs.length;

        // Accumulatori per Metodo del Resto (Remainder Method)
        const accWorkDurations = new Map<string, number>(); // key: phaseId-periodIdx
        const accMaterialValues = new Map<string, { gross: number, net: number, close: number, pcs: number }>(); // key: phaseId-consIdx
        const accWithdrawalValues = new Map<string, { weight: number, units: number }>(); // key: withdrawalId

        for (let i = 0; i < totalJobsCount; i++) {
            const job = jobs[i];
            const isLastJob = i === totalJobsCount - 1;
            const jobShare = totalQty > 0 ? (job.qta / totalQty) : (1 / totalJobsCount);

            // A. RIPARTIZIONE FASI (TEMPI E CONSUMI)
            const finalJobPhases = (job.phases || []).map((originalPhase: JobPhase) => {
                const matchedGroupPhase = (gData.phases || []).find(gp => gp.id === originalPhase.id);
                if (!matchedGroupPhase) return originalPhase;

                // 1. Ripartizione Tempi (Work Periods)
                const scaledWorkPeriods = (matchedGroupPhase.workPeriods || []).map((wp, wpIdx) => {
                    const startTs = wp.start?.toDate ? wp.start.toDate().getTime() : new Date(wp.start).getTime();
                    
                    // SELF-HEALING: Se il periodo è rimasto "aperto" (zombie), lo chiudiamo forzatamente impostando end = start.
                    // Questo garantisce che il gruppo possa sempre essere sciolto e azzera eventuali tempi fittizi.
                    let endTs: number;
                    if (wp.end) {
                        endTs = wp.end.toDate ? wp.end.toDate().getTime() : new Date(wp.end).getTime();
                    } else {
                        endTs = startTs; // AUTO-CLOSE ZOMBIE PERIOD
                    }

                    const totalDuration = endTs - startTs;
                    const key = `${matchedGroupPhase.id}-${wpIdx}`;

                    let allocatedDuration: number;
                    if (!isLastJob) {
                        allocatedDuration = Math.round(totalDuration * jobShare);
                        accWorkDurations.set(key, (accWorkDurations.get(key) || 0) + allocatedDuration);
                    } else {
                        allocatedDuration = totalDuration - (accWorkDurations.get(key) || 0);
                    }

                    return {
                        ...wp,
                        start: admin.firestore.Timestamp.fromMillis(startTs),
                        end: admin.firestore.Timestamp.fromMillis(startTs + Math.max(0, allocatedDuration)),
                        reason: wp.end ? wp.reason : (wp.reason || 'Chiusura Automatica Scioglimento (Orphaned)')
                    };
                });

                // 2. Ripartizione Materiali (Consumptions)
                const scaledConsumptions = (matchedGroupPhase.materialConsumptions || []).map((mc, mcIdx) => {
                    const key = `${matchedGroupPhase.id}-${mcIdx}`;
                    const acc = accMaterialValues.get(key) || { gross: 0, net: 0, close: 0, pcs: 0 };
                    
                    let allocated = { gross: 0, net: 0, close: 0, pcs: 0 };
                    const round3 = (v: number) => Math.round(v * 1000) / 1000;

                    if (!isLastJob) {
                        allocated.gross = round3((mc.grossOpeningWeight || 0) * jobShare);
                        allocated.net = round3((mc.netOpeningWeight || 0) * jobShare);
                        allocated.close = round3((mc.closingWeight || 0) * jobShare);
                        allocated.pcs = Math.round((mc.pcs || 0) * jobShare);

                        accMaterialValues.set(key, {
                            gross: acc.gross + allocated.gross,
                            net: acc.net + allocated.net,
                            close: acc.close + allocated.close,
                            pcs: acc.pcs + allocated.pcs
                        });
                    } else {
                        allocated.gross = round3((mc.grossOpeningWeight || 0) - acc.gross);
                        allocated.net = round3((mc.netOpeningWeight || 0) - acc.net);
                        allocated.close = round3((mc.closingWeight || 0) - acc.close);
                        allocated.pcs = (mc.pcs || 0) - acc.pcs;
                    }

                    return {
                        ...mc,
                        grossOpeningWeight: allocated.gross,
                        netOpeningWeight: allocated.net,
                        closingWeight: allocated.close,
                        pcs: allocated.pcs
                    };
                });

                return {
                    ...originalPhase,
                    status: matchedGroupPhase.status,
                    workPeriods: scaledWorkPeriods,
                    materialConsumptions: scaledConsumptions,
                    materialReady: matchedGroupPhase.materialReady,
                    materialStatus: matchedGroupPhase.materialStatus || originalPhase.materialStatus
                };
            });

            // B. AGGIORNAMENTO COMMESSA
            const isGroupCompleted = forceComplete || gData.status === 'completed';
            const finalStatus = isGroupCompleted ? 'completed' : 'paused';
            
            transaction.update(job.ref, { 
                workGroupId: admin.firestore.FieldValue.delete(),
                phases: finalJobPhases,
                status: finalStatus,
                overallStartTime: gData.overallStartTime || job.overallStartTime || null,
                overallEndTime: isGroupCompleted ? (gData.overallEndTime || admin.firestore.FieldValue.serverTimestamp()) : null, 
                isProblemReported: gData.isProblemReported || false,
                problemType: gData.problemType || admin.firestore.FieldValue.delete(),
                problemNotes: gData.problemNotes || admin.firestore.FieldValue.delete(),
                problemReportedBy: gData.problemReportedBy || admin.firestore.FieldValue.delete(),
            });

            // C. SPLIT PRELIEVI (Solo Contabilità)
            for (const w of groupWithdrawals) {
                const key = `withdrawal-${w.id}`;
                const acc = accWithdrawalValues.get(key) || { weight: 0, units: 0 };
                
                let allocated = { weight: 0, units: 0 };
                const round3 = (v: number) => Math.round(v * 1000) / 1000;

                if (!isLastJob) {
                    allocated.weight = round3((w.consumedWeight || 0) * jobShare);
                    allocated.units = round3((w.consumedUnits || 0) * jobShare);
                    accWithdrawalValues.set(key, {
                        weight: acc.weight + allocated.weight,
                        units: acc.units + allocated.units
                    });
                } else {
                    allocated.weight = round3((w.consumedWeight || 0) - acc.weight);
                    allocated.units = round3((w.consumedUnits || 0) - acc.units);
                }

                // Crea nuovo prelievo per la singola commessa
                if (allocated.weight > 0 || allocated.units > 0) {
                    const newWithdrawalRef = adminDb.collection("materialWithdrawals").doc();
                    transaction.set(newWithdrawalRef, {
                        ...w,
                        id: newWithdrawalRef.id,
                        jobIds: [job.id],
                        jobOrderPFs: [job.ordinePF],
                        consumedWeight: allocated.weight,
                        consumedUnits: allocated.units,
                        withdrawalDate: w.withdrawalDate // Usiamo la data originale
                    });
                }
            }
        }

        // D. PULIZIA: ELIMINA PRELIEVI ORIGINALI DEL GRUPPO E IL GRUPPO STESSO
        for (const w of groupWithdrawals) {
            transaction.delete(adminDb.collection("materialWithdrawals").doc(w.id));
        }
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    
    await pulseOperatorsForJob([groupId, ...jobOrderIds]);

    return { success: true, message: `Gruppo sciolto e dati ripartiti correttamente.` };

  } catch (error) {
    console.error("Error dissolving work group:", error);
    const errorMessage = error instanceof Error ? error.message : "Errore durante lo scioglimento.";
    return { success: false, message: errorMessage };
  }
}
