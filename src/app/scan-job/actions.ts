'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

import type { JobOrder, JobPhase, RawMaterial, MaterialConsumption, WorkGroup, Operator, MaterialWithdrawal, ActiveMaterialSessionData, InventoryRecord } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';
import { ensureAdmin } from '@/lib/server-auth';

export { dissolveWorkGroup };

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}


export async function resolveJobProblem(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const isGroup = jobId.startsWith('group-');
        const itemRef = adminDb.collection(isGroup ? "workGroups" : "jobOrders").doc(jobId);
        
        await itemRef.update({
            isProblemReported: false,
            problemType: admin.firestore.FieldValue.delete(),
            problemNotes: admin.firestore.FieldValue.delete(),
            problemReportedBy: admin.firestore.FieldValue.delete()
        });

        if (isGroup) {
            const gSnap = await itemRef.get();
            if (gSnap.exists) {
                const gData = gSnap.data() as WorkGroup;
                const batch = adminDb.batch();
                (gData.jobOrderIds || []).forEach(id => {
                    batch.update(adminDb.collection("jobOrders").doc(id), {
                        isProblemReported: false,
                        problemType: admin.firestore.FieldValue.delete(),
                        problemNotes: admin.firestore.FieldValue.delete(),
                        problemReportedBy: admin.firestore.FieldValue.delete()
                    });
                });
                await batch.commit();
            }
        }

        revalidatePath('/admin/production-console');
        return { success: true, message: "Problema segnato come risolto." };
    } catch (e) {
        return { success: false, message: "Errore durante la risoluzione del problema." };
    }
}

export async function getRawMaterialByCode(code: string | undefined): Promise<RawMaterial | { error: string; title?: string }> {
  const trimmed = (code || '').trim();
  if (!trimmed) return { error: `Il codice inserito è vuoto.`, title: 'Codice Vuoto' };
  const snap = await adminDb.collection("rawMaterials").where("code_normalized", "==", trimmed.toLowerCase()).get();
  if (snap.empty) return { error: `Materia prima "${trimmed}" non trovata a sistema.`, title: 'Materiale non Trovato' };
  const material = { ...snap.docs[0].data(), id: snap.docs[0].id } as RawMaterial;
  return JSON.parse(JSON.stringify(material));
}

export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    if (!id || typeof id !== 'string') return null;
    const isGroup = id.startsWith('group-');
    const snap = await adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(id).get();
    if (!snap.exists) return null;
    const data = convertTimestampsToDates(snap.data()) as any;
    if (isGroup) {
        const group = data as WorkGroup;
        return { 
            id: group.id, cliente: group.cliente, qta: group.totalQuantity, department: group.department, details: group.details, ordinePF: group.jobOrderPFs?.join(', ') || 'Gruppo', 
            numeroODL: group.numeroODL || 'N/D', numeroODLInterno: group.numeroODLInterno || 'N/D', dataConsegnaFinale: group.dataConsegnaFinale || 'N/D', 
            postazioneLavoro: 'Multi-Commessa', phases: group.phases || [], overallStartTime: group.overallStartTime, overallEndTime: group.overallEndTime, 
            isProblemReported: group.isProblemReported, problemType: group.problemType, problemNotes: group.problemNotes, problemReportedBy: group.problemReportedBy, 
            status: group.status, workCycleId: group.workCycleId, workGroupId: group.id, jobOrderIds: group.jobOrderIds, jobOrderPFs: group.jobOrderPFs 
        } as any;
    }
    return data as JobOrder;
}

export async function verifyAndGetJobOrder(scannedData: { ordinePF: string; codice: string; qta: string; }): Promise<JobOrder | { error: string; title?: string }> {
  const sanitizedId = (scannedData.ordinePF || '').replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
  if (!sanitizedId) return { error: 'ID Commessa non valido.', title: 'Errore' };
  const snap = await adminDb.collection("jobOrders").doc(sanitizedId).get();
  if (!snap.exists) return { error: `Commessa ${sanitizedId} non trovata.`, title: 'Errore' };
  
  let job = convertTimestampsToDates(snap.data()) as JobOrder;
  
  // Enchancement: Fetch attachments from Article if not present on JobOrder
  if (!job.attachments || job.attachments.length === 0) {
      if (job.details) {
          const articleSnap = await adminDb.collection("articles").where("code", "==", job.details).limit(1).get();
          if (!articleSnap.empty) {
              const articleData = articleSnap.docs[0].data() as any;
              if (articleData.attachments) {
                  job.attachments = articleData.attachments;
              }
          }
      }
  }

  if (job.workGroupId) {
      const group = await getJobOrderById(job.workGroupId);
      if (group) return JSON.parse(JSON.stringify(group));
  }
  return JSON.parse(JSON.stringify(job));
}

export async function updateOperatorStatus(opId: string, jobId: string | null, phaseName: string | null) {
  if (!opId) return;
  await adminDb.collection('operators').doc(opId).update({ activeJobId: jobId || null, activePhaseName: phaseName || null, stato: jobId ? 'attivo' : 'inattivo' });
  return { success: true };
}

export async function updateJob(job: JobOrder) {
    if (!job || !job.id) return { success: false, message: 'Dati commessa incompleti.' };
    if (job.id.startsWith('group-')) return { success: false, message: 'Tentativo di salvataggio errato.' };
    
    await adminDb.collection("jobOrders").doc(job.id).set(JSON.parse(JSON.stringify(job)), { merge: true });
    revalidatePath('/scan-job');
    return { success: true, message: 'Commessa aggiornata.' };
}

export async function updateWorkGroup(group: WorkGroup, opId: string) {
    if (!group || !group.id) return { success: false, message: 'Dati gruppo incompleti.' };
    try {
        await adminDb.collection("workGroups").doc(group.id).update(JSON.parse(JSON.stringify(group)));
        revalidatePath('/scan-job');
        return { success: true, message: 'Gruppo aggiornato.' };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function isOperatorActiveOnAnyJob(opId: string, currentJobId: string): Promise<{ available: boolean; activeJobId?: string | null; activePhaseName?: string | null }> {
    const docSnap = await adminDb.collection("operators").doc(opId).get();
    if (docSnap.exists) {
        const data = docSnap.data();
        if (data && data.activeJobId && data.activeJobId !== currentJobId) return { available: false, activeJobId: data.activeJobId, activePhaseName: data.activePhaseName };
    }
    return { available: true };
}

export async function handlePhaseScanResult(jobId: string, phaseId: string, opId: string, isCompletion: boolean = false) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists) return;
        const data = snap.data() as any;
        const phs = [...(data.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        
        if (idx !== -1) {
            if (isCompletion) {
                // Handle Completion
                const myWorkPeriodIndex = phs[idx].workPeriods.findIndex((wp: any) => wp.operatorId === opId && wp.end === null);
                if (myWorkPeriodIndex !== -1) {
                    phs[idx].workPeriods[myWorkPeriodIndex].end = new Date();
                }
                
                // If no one else is active, mark phase as completed
                if (!phs[idx].workPeriods.some((wp: any) => wp.end === null)) {
                    phs[idx].status = 'completed';
                }

                // CHECK FOR JOB COMPLETION (New Requirement)
                const allCompleted = phs.every(p => p.status === 'completed' || p.status === 'skipped');
                if (allCompleted) {
                    transaction.update(itemRef, { 
                        phases: phs, 
                        status: 'completed', 
                        overallEndTime: new Date() 
                    });
                } else {
                    transaction.update(itemRef, { phases: phs });
                }

                // Operator is now inactive on this job
                transaction.update(adminDb.collection('operators').doc(opId), { activeJobId: null, activePhaseName: null, stato: 'inattivo' });

            } else {
                // Handle Start/Join
                phs[idx].status = 'in-progress';
                if (!phs[idx].workPeriods) phs[idx].workPeriods = [];
                
                // Only add if not already active
                if (!phs[idx].workPeriods.some((wp: any) => wp.operatorId === opId && wp.end === null)) {
                    phs[idx].workPeriods.push({ start: new Date(), end: null, operatorId: opId });
                }
                
                transaction.update(itemRef, { 
                    phases: phs, 
                    status: 'production', 
                    overallStartTime: data.overallStartTime || new Date() 
                });
                
                transaction.update(adminDb.collection('operators').doc(opId), { 
                    activeJobId: jobId, 
                    activePhaseName: phs[idx].name, 
                    stato: 'attivo' 
                });
            }
        }
    });

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
}

export async function handlePhasePause(jobId: string, phaseId: string, opId: string, reason?: string, notes?: string) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists) return;
        const data = snap.data() as any;
        const phs = [...(data.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        
        if (idx !== -1) {
            const myWorkPeriodIndex = phs[idx].workPeriods.findIndex((wp: any) => wp.operatorId === opId && wp.end === null);
            if (myWorkPeriodIndex !== -1) {
                phs[idx].workPeriods[myWorkPeriodIndex].end = new Date();
                phs[idx].workPeriods[myWorkPeriodIndex].reason = reason; // Save reason in period
                
                // If no one else is active, mark phase as paused
                if (!phs[idx].workPeriods.some((wp: any) => wp.end === null)) {
                    phs[idx].status = 'paused';
                    phs[idx].pauseReason = reason; // Save current pause reason in phase
                }
                
                const updateData: any = { phases: phs };

                // Handle 'Manca Materiale' automation
                if (reason === 'Manca Materiale') {
                    const opSnap = await transaction.get(adminDb.collection('operators').doc(opId));
                    phs[idx].materialStatus = 'missing';
                    phs[idx].materialReady = false;
                    updateData.isProblemReported = true;
                    updateData.problemType = 'MANCA_MATERIALE';
                    updateData.problemReportedBy = (opSnap.data() as any)?.nome || 'Operatore';
                    updateData.problemNotes = notes || 'Segnalato automaticamente dalla pausa.';
                } else if (reason === 'Altro' && notes) {
                    // Update notes if reason is 'Altro'
                    updateData.isProblemReported = true;
                    updateData.problemType = 'ALTRO';
                    updateData.problemNotes = notes;
                }
                
                transaction.update(itemRef, updateData);
                transaction.update(adminDb.collection('operators').doc(opId), { activeJobId: null, activePhaseName: null, stato: 'inattivo' });
            }
        }
    });

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
}


export async function startMaterialSessionInJob(jobId: string, phaseId: string, consumption: MaterialConsumption) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    try {
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(itemRef);
            if (!snap.exists) throw new Error('Elemento non trovato.');
            const data = snap.data() as any;
            
            const phs = (data.phases || []).map((p: any) => 
                p.id === phaseId 
                    ? { ...p, materialConsumptions: [...(p.materialConsumptions || []), consumption], materialReady: true } 
                    : p
            );
            
            transaction.update(itemRef, { phases: phs });
            
            if (isGroup && data.jobOrderIds) {
                data.jobOrderIds.forEach((id: string) => {
                    transaction.update(adminDb.collection('jobOrders').doc(id), { phases: phs });
                });
            }
        });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        return { success: true, message: 'Sessione avviata e dati sincronizzati.' };
    } catch (error) {
        console.error("Error in startMaterialSessionInJob:", error);
        return { success: false, message: 'Errore durante il salvataggio.' };
    }
}


export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
    await adminDb.collection('operators').doc(opId).update({ activeMaterialSessions: sessions });
    return { success: true };
}

export async function closeMaterialSessionAndUpdateStock(session: ActiveMaterialSessionData, closingGrossWeight: number, opId: string) {
    try {
        await adminDb.runTransaction(async (transaction) => {
            const materialRef = adminDb.collection('rawMaterials').doc(session.materialId);
            const matSnap = await transaction.get(materialRef);
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;

            const consumedWeight = session.grossOpeningWeight - closingGrossWeight;
            if (consumedWeight < -0.001) throw new Error("Il peso di chiusura non può essere superiore a quello di apertura.");

            const globalSettings = await getGlobalSettings();
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
                material,
                config,
                consumedWeight, // Input is always weight in this session logic
                'kg',
                false,
                session.lotto as string | undefined
            );

            transaction.update(materialRef, {
                currentStockUnits: (material.currentStockUnits || 0) - unitsToChange,
                currentWeightKg: (material.currentWeightKg || 0) - weightToChange,
                batches: updatedBatches
            });

            const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
            transaction.set(withdrawalRef, {
                jobIds: session.associatedJobs.map(j => j.jobId),
                jobOrderPFs: session.associatedJobs.map(j => j.jobOrderPF),
                materialId: session.materialId,
                materialCode: session.materialCode,
                consumedWeight: weightToChange,
                consumedUnits: unitsToChange,
                operatorId: opId,
                withdrawalDate: admin.firestore.Timestamp.now(),
                lotto: usedLotto,
            });
        });
        return { success: true, message: "Sessione chiusa e magazzino aggiornato." };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : "Errore chiusura sessione." };
    }
}

export async function logTubiGuainaWithdrawal(formData: FormData) {
    const rawData = Object.fromEntries(formData.entries());
    const { materialId, operatorId, jobId, jobOrderPF, phaseId, quantity, unit, lotto } = rawData;
    
    try {
        await adminDb.runTransaction(async (t) => {
            const mRef = adminDb.collection("rawMaterials").doc(materialId as string);
            const mSnap = await t.get(mRef);
            if (!mSnap.exists) throw new Error("Materiale non trovato.");
            const material = mSnap.data() as RawMaterial;
            
            const globalSettings = await getGlobalSettings();
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
                material,
                config,
                Number(quantity),
                unit as any,
                false,
                lotto as string
            );

            t.update(mRef, { 
                currentStockUnits: (material.currentStockUnits || 0) - unitsToChange, 
                currentWeightKg: (material.currentWeightKg || 0) - weightToChange,
                batches: updatedBatches
            });

            const wRef = adminDb.collection("materialWithdrawals").doc();
            t.set(wRef, {
                jobIds: [jobId],
                jobOrderPFs: [jobOrderPF],
                materialId,
                materialCode: material.code,
                consumedWeight: weightToChange,
                consumedUnits: unitsToChange,
                operatorId,
                withdrawalDate: admin.firestore.Timestamp.now(),
                lotto: usedLotto,
            });
        });
        return { success: true, message: "Scarico registrato." };
    } catch (e) { return { success: false, message: "Errore scarico." }; }
}

export async function findLastWeightForLotto(materialId: string | undefined, lotto: string): Promise<any> {
    const snap = await adminDb.collection("inventoryRecords").where("lotto", "==", lotto).where("status", "==", "approved").get();
    
    if (!snap.empty) {
        const records = snap.docs.map(d => ({ ...d.data(), id: d.id } as InventoryRecord));
        records.sort((a, b) => {
            const timeA = a.recordedAt?.toMillis?.() || new Date(a.recordedAt).getTime();
            const timeB = b.recordedAt?.toMillis?.() || new Date(b.recordedAt).getTime();
            return timeB - timeA;
        });
        
        const rec = records[0];
        const mSnap = await adminDb.collection("rawMaterials").doc(rec.materialId).get();
        if (mSnap.exists) {
            return { 
                material: { ...mSnap.data(), id: mSnap.id }, 
                netWeight: rec.netWeight, 
                packagingId: rec.packagingId || 'none'
            };
        }
    }

    const materialsSnap = await adminDb.collection("rawMaterials").get();
    for (const mDoc of materialsSnap.docs) {
        const mData = mDoc.data() as RawMaterial;
        const matchingBatch = (mData.batches || []).find(b => b.lotto === lotto);
        if (matchingBatch) {
            const netWeight = matchingBatch.netQuantity || (matchingBatch.grossWeight - matchingBatch.tareWeight);
            return {
                material: { ...mData, id: mDoc.id },
                netWeight: netWeight,
                packagingId: matchingBatch.packagingId || 'none'
            };
        }
    }

    return null;
}

export async function createWorkGroup(jobIds: string[], creatorId: string) {
    try {
        const batch = adminDb.batch();
        const newGroupId = `group-${Date.now()}`;
        const groupRef = adminDb.collection("workGroups").doc(newGroupId);
        
        const jobSnaps = await Promise.all(jobIds.map(id => adminDb.collection("jobOrders").doc(id).get()));
        const jobs = jobSnaps.map(s => ({ ...s.data(), id: s.id } as JobOrder));
        
        const firstJob = jobs[0];
        if (!firstJob) throw new Error("Nessuna commessa valida.");

        const totalQty = jobs.reduce((sum, j) => sum + j.qta, 0);
        const jobPFs = jobs.map(j => j.ordinePF);

        // REFINED LOGIC: ONLY COMMON AVAILABLE PHASES
        // We find phases that are present in ALL jobs and NOT completed in any job.
        const allPhases = jobs.map(j => j.phases || []);
        const firstJobPhases = allPhases[0] || [];
        
        const commonPhases = firstJobPhases
            .filter(p1 => {
                // Check if this phase exists in all other jobs
                const existsInAll = allPhases.every(jobPhs => jobPhs.some(p2 => p2.id === p1.id));
                if (!existsInAll) return false;

                // Check if it's NOT completed in ANY job (as per user requirement to exclude already done phases)
                const isCompletedAnywhere = allPhases.some(jobPhs => {
                    const match = jobPhs.find(p2 => p2.id === p1.id);
                    return match?.status === 'completed';
                });
                
                return !isCompletedAnywhere;
            })
            .sort((a, b) => a.sequence - b.sequence)
            .map(p => ({
                ...p,
                status: 'pending' as const,
                workPeriods: [],
                materialConsumptions: []
            }));

        if (commonPhases.length === 0) {
            throw new Error("Nessuna fase operativa comune disponibile per il concatenamento.");
        }
        
        const newGroup: any = {
            id: newGroupId,
            jobOrderIds: jobIds,
            jobOrderPFs: jobPFs,
            status: 'production',
            createdAt: admin.firestore.Timestamp.now(),
            createdBy: creatorId,
            totalQuantity: totalQty,
            workCycleId: firstJob.workCycleId || '',
            department: firstJob.department,
            cliente: firstJob.cliente,
            details: firstJob.details,
            phases: commonPhases,
            numeroODLInterno: firstJob.numeroODLInterno || null,
            dataConsegnaFinale: firstJob.dataConsegnaFinale || '',
        };


        batch.set(groupRef, newGroup);
        jobIds.forEach(id => batch.update(adminDb.collection("jobOrders").doc(id), { workGroupId: newGroupId }));
        
        await batch.commit();
        revalidatePath('/admin/work-group-management');
        revalidatePath('/admin/production-console');
        return { success: true, workGroupId: newGroupId };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : "Errore creazione gruppo." };
    }
}
