
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { WorkGroup, JobOrder, JobPhase, WorkPeriod, Operator } from '@/types';
import { pulseOperatorsForJob } from '@/lib/job-sync-server';

/**
 * Rimuove ricorsivamente tutte le proprietà 'undefined' da un oggetto per compatibilità con Firestore.
 */
function cleanUndefined(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    // Preserva oggetti speciali di Firestore
    if (obj instanceof admin.firestore.Timestamp || 
        (obj.constructor && obj.constructor.name === 'FieldValue') ||
        typeof obj.toDate === 'function') {
        return obj;
    }
    
    if (Array.isArray(obj)) return obj.map(item => cleanUndefined(item));
    
    const newObj: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (val !== undefined) {
                newObj[key] = cleanUndefined(val);
            }
        }
    }
    return newObj;
}


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


export async function dissolveWorkGroup(groupId: string, forceComplete: boolean = false, forceUnlock: boolean = false): Promise<{ success: boolean; message: string; childJobIds?: string[] }> {
  try {
    if (!groupId) {
        return { success: false, message: "ID Gruppo mancante o non valido." };
    }
    const groupRef = adminDb.collection('workGroups').doc(groupId);

    // 1. ANALISI STATO OPERATORI: Recupera chi ha il gruppo aperto o timer attivi
    const opsSnap = await adminDb.collection("operators").get();
    const phantomOperators = opsSnap.docs.filter(docSnap => {
        const op = docSnap.data() as Operator;
        return op.activeJobId === groupId;
    });

    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
        return { success: false, message: "Gruppo di lavoro non trovato." };
    }
    const gDataRaw = groupSnap.data() as WorkGroup;
    
    // 2. ANTI-ZOMBIE LOCK: Blocca se c'è una fase con status === 'in-progress' o timer aperti
    const inProgressPhases = (gDataRaw.phases || []).filter(p => p.status === 'in-progress');
    const openTimers = (gDataRaw.phases || []).flatMap(p => 
        (p.workPeriods || []).filter(wp => wp.end === null)
    );

    if (inProgressPhases.length > 0 || openTimers.length > 0) {
        throw new Error(`IMPOSSIBILE SCIOGLIERE: Il gruppo ha ${inProgressPhases.length} fasi attive e ${openTimers.length} timer operatori aperti. Chiudi o metti in pausa tutte le attività prima di procedere.`);
    }

    // ID operatori da resettare (sessioni fantasma rimaste nel documento operatore)
    const operatorIdsToReset = Array.from(new Set([
        ...phantomOperators.map(d => d.id)
    ]));

    // 3. PREPARAZIONE DATI
    if (gDataRaw?.createdAt?.toDate) gDataRaw.createdAt = gDataRaw.createdAt.toDate();
    if (gDataRaw?.overallStartTime?.toDate) gDataRaw.overallStartTime = gDataRaw.overallStartTime.toDate();
    if (gDataRaw?.overallEndTime?.toDate) gDataRaw.overallEndTime = gDataRaw.overallEndTime.toDate();
    
    const gData = gDataRaw;
    const jobOrderIds = gData.jobOrderIds || [];

    if (jobOrderIds.length === 0) {
        await groupRef.delete();
        return { success: true, message: "Gruppo vuoto eliminato." };
    }

    // 4. RECUPERA PRELIEVI ORIGINALI
    const withdrawalsSnap = await adminDb.collection("materialWithdrawals")
        .where("jobIds", "array-contains", groupId)
        .get();
    
    const groupWithdrawals = withdrawalsSnap.docs.map(doc => {
        const data = doc.data();
        if (data.withdrawalDate?.toDate) data.withdrawalDate = data.withdrawalDate.toDate();
        return { id: doc.id, ...data } as any;
    });

    // 5. TRANSAZIONE DI SCIOGLIMENTO E RIPARTIZIONE
    await adminDb.runTransaction(async (transaction) => {
        const gSnapTx = await transaction.get(groupRef);
        if (!gSnapTx.exists) throw new Error("Gruppo di lavoro non trovato durante la transazione.");
        
        const gTx = gSnapTx.data() as WorkGroup;
        const jobRefs = jobOrderIds.map(id => {
             const tid = id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
             return adminDb.collection('jobOrders').doc(tid);
        });
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));
        
        const jobs = jobDocs.map(doc => ({ 
            id: doc.id, 
            ...(doc.data() || {}), 
            ref: doc.ref 
        } as any));

        // RESET SESSIONI FANTASMA
        for (const opId of operatorIdsToReset) {
            transaction.update(adminDb.collection("operators").doc(opId), {
                activeJobId: null,
                activePhaseName: null,
                stato: 'inattivo',
                activeMaterialSessions: [] 
            });
        }

        const totalQty = gTx.totalQuantity || jobs.reduce((s: number, j: any) => s + (j.qta || 0), 0);
        const totalJobsCount = jobs.length;

        // Accumulatori Remainder Method
        const accWorkDurations = new Map<string, number>();
        const accMaterialValues = new Map<string, { gross: number, net: number, close: number, pcs: number }>();

        for (let i = 0; i < totalJobsCount; i++) {
            const job = jobs[i];
            const isLastJob = i === totalJobsCount - 1;
            const jobShare = totalQty > 0 ? (job.qta / totalQty) : (1 / totalJobsCount);

            // A. RIPARTIZIONE FASI (Solo log documentale - Nessun effetto stock)
            const finalJobPhases = (job.phases || []).map((originalPhase: JobPhase) => {
                const matchedGroupPhase = (gTx.phases || []).find(gp => gp.id === originalPhase.id);
                if (!matchedGroupPhase) return originalPhase;

                // 1. Tempi (Work Periods)
                const scaledWorkPeriods = (matchedGroupPhase.workPeriods || []).map((wp, wpIdx) => {
                    const startTs = wp.start?.toDate ? wp.start.toDate().getTime() : new Date(wp.start).getTime();
                    const endTs = wp.end?.toDate ? wp.end.toDate().getTime() : new Date(wp.end).getTime();

                    const totalDuration = endTs - startTs;
                    const key = `${matchedGroupPhase.id}-${wpIdx}`;

                    let allocatedDuration: number;
                    if (!isLastJob) {
                        allocatedDuration = Math.round(totalDuration * jobShare);
                        accWorkDurations.set(key, (accWorkDurations.get(key) || 0) + allocatedDuration);
                    } else {
                        allocatedDuration = totalDuration - (accWorkDurations.get(key) || 0);
                    }

                    return cleanUndefined({
                        ...wp,
                        start: admin.firestore.Timestamp.fromMillis(startTs),
                        end: admin.firestore.Timestamp.fromMillis(startTs + Math.max(0, allocatedDuration))
                    });
                });

                // 2. Materiali (Consumptions)
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

                    return cleanUndefined({
                        ...mc,
                        grossOpeningWeight: allocated.gross,
                        netOpeningWeight: allocated.net,
                        closingWeight: allocated.close,
                        pcs: allocated.pcs
                    });
                });

                return cleanUndefined({
                    ...originalPhase,
                    status: matchedGroupPhase.status,
                    workPeriods: scaledWorkPeriods,
                    materialConsumptions: scaledConsumptions,
                    materialReady: matchedGroupPhase.materialReady,
                    materialStatus: matchedGroupPhase.materialStatus || originalPhase.materialStatus || null
                });
            });

            // B. AGGIORNAMENTO COMMESSA FIGLIA
            const isGroupCompleted = forceComplete || gTx.status === 'completed';
            const finalJobStatus = isGroupCompleted ? 'completed' : 'paused';
            
            transaction.update(job.ref, cleanUndefined({ 
                workGroupId: admin.firestore.FieldValue.delete(),
                phases: finalJobPhases,
                status: finalJobStatus,
                overallStartTime: gTx.overallStartTime || job.overallStartTime || null,
                overallEndTime: isGroupCompleted ? (gTx.overallEndTime || admin.firestore.FieldValue.serverTimestamp()) : null, 
                isProblemReported: gTx.isProblemReported || false,
                problemType: gTx.problemType || admin.firestore.FieldValue.delete(),
                problemNotes: gTx.problemNotes || admin.firestore.FieldValue.delete(),
                problemReportedBy: gTx.problemReportedBy || admin.firestore.FieldValue.delete(),
            }));

            // C. SPLIT PRELIEVI
            for (const w of groupWithdrawals) {
                const jobShareW = totalQty > 0 ? (job.qta / totalQty) : (1 / totalJobsCount);
                // (Qui usiamo lo stesso sistema remainder se necessario, ma per semplicità scaliamo)
                const allocatedW = {
                    weight: Math.round(((w.consumedWeight || 0) * jobShareW) * 1000) / 1000,
                    units: Math.round(((w.consumedUnits || 0) * jobShareW) * 1000) / 1000
                };

                if (allocatedW.weight > 0 || allocatedW.units > 0) {
                    const newWRef = adminDb.collection("materialWithdrawals").doc();
                    transaction.set(newWRef, cleanUndefined({
                        ...w,
                        id: newWRef.id,
                        jobIds: [job.id],
                        jobOrderPFs: [job.ordinePF],
                        consumedWeight: allocatedW.weight,
                        consumedUnits: allocatedW.units,
                        withdrawalDate: w.withdrawalDate
                    }));
                }
            }
        }

        // 6. PULIZIA FINALE
        for (const w of groupWithdrawals) {
            transaction.delete(adminDb.collection("materialWithdrawals").doc(w.id));
        }
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    
    await pulseOperatorsForJob([groupId, ...jobOrderIds]);

    return { success: true, message: `Gruppo sciolto e dati ripartiti correttamente.`, childJobIds: jobOrderIds };

  } catch (error) {
    console.error("Error dissolving work group:", error);
    const errorMessage = error instanceof Error ? error.message : "Errore durante lo scioglimento.";
    return { success: false, message: errorMessage };
  }
}
