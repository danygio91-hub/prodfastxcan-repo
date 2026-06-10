'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';

import type { JobOrder, JobPhase, RawMaterial, MaterialConsumption, WorkGroup, Operator, MaterialWithdrawal, ActiveMaterialSessionData, InventoryRecord, JobBillOfMaterialsItem } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';
import { ensureAdmin } from '@/lib/server-auth';
import { getOverallStatus } from '@/lib/types';
import { updateArticleHistoricalTimes } from '@/lib/production-time-server-utils';

export { dissolveWorkGroup };

import { pulseOperatorsForJob } from '@/lib/job-sync-server';

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

/**
 * Helper to perform a hybrid, fallback-safe lookup for a Job Order.
 * Supports standard fetches and Firestore transactions.
 */
async function getJobOrderRefAndSnap(
    rawId: string, 
    transaction?: admin.firestore.Transaction
): Promise<{ jobRef: admin.firestore.DocumentReference; jobSnap: admin.firestore.DocumentSnapshot }> {
    const sanitizedId = rawId.replace(/\//g, '-');
    let jobRef = adminDb.collection('jobOrders').doc(sanitizedId);
    let jobSnap = transaction ? await transaction.get(jobRef) : await jobRef.get();

    if (!jobSnap.exists) {
        const querySnap = await adminDb.collection('jobOrders')
            .where('ordinePF', '==', rawId)
            .limit(1)
            .get();
        
        if (!querySnap.empty) {
            const foundSnap = querySnap.docs[0];
            jobRef = foundSnap.ref;
            jobSnap = transaction ? await transaction.get(jobRef) : foundSnap;
        }
    }

    if (!jobSnap.exists) {
        const legacyId = sanitizedId.replace(/[\.#$\[\]]/g, '');
        const legacyRef = adminDb.collection('jobOrders').doc(legacyId);
        const legacySnap = transaction ? await transaction.get(legacyRef) : await legacyRef.get();
        if (legacySnap.exists) {
            jobRef = legacyRef;
            jobSnap = legacySnap;
        }
    }

    return { jobRef, jobSnap };
}

export async function getTrueJobId(id: string): Promise<{ success: boolean; trueId?: string; message?: string }> {
    try {
        if (!id) return { success: false, message: "ID mancante." };
        if (id.startsWith('group-')) {
            return { success: true, trueId: id }; // Groups use their ID directly
        }
        
        const { jobRef, jobSnap } = await getJobOrderRefAndSnap(id);
        if (jobSnap.exists) {
            return { success: true, trueId: jobRef.id };
        } else {
            return { success: false, message: "Commessa non trovata." };
        }
    } catch (e) {
        return { success: false, message: "Errore durante il lookup." };
    }
}

function updatePhasesMaterialReadiness(phases: JobPhase[]): JobPhase[] {
    const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
    
    // 1. Idenpendent PREP: Always ready
    // 2. PRODUCTION/QLTY: Ready if ALL mandatory PREP are done/skipped AND previous non-independent phase is at least in-progress.
    
    const allPrepDone = sorted
        .filter(p => p.type === 'preparation' && !p.postponed)
        .every(p => ['completed', 'skipped'].includes(p.status));

    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        
        // Preparation phases are always ready to start
        if (curr.isIndependent || curr.type === 'preparation') { 
            curr.materialReady = true; 
            continue; 
        }

        // Production phases need PREP to be finished
        if (!allPrepDone) { 
            curr.materialReady = false; 
            continue; 
        }

        // Check previous non-independent phase status for simultaneity (Start)
        let prev: JobPhase | null = null;
        for (let j = i - 1; j >= 0; j--) { 
            if (!sorted[j].isIndependent) { 
                prev = sorted[j]; 
                break; 
            } 
        }

        if (!prev) {
            curr.materialReady = true;
        } else {
            // SIMULTANEITY: Can start if previous is at least 'in-progress'
            curr.materialReady = ['in-progress', 'completed', 'skipped', 'paused'].includes(prev.status);
        }
    }
    return sorted;
}

export async function fastForwardToPackaging(jobId: string, opId: string): Promise<{ success: boolean; message: string }> {
    try {
        const opSnap = await adminDb.collection('operators').doc(opId).get();
        if (!opSnap.exists) throw new Error("Operatore non trovato.");
        const opData = opSnap.data();
        
        // Permission check: Magazzino or Quality
        const allowedDepts = ['MAG', 'MAGAZZINO', 'COLLAUDO', 'QUALITA', 'QUALITÀ', 'QLTY', 'IMBALLO', 'PACK'];
        const hasAccess = (opData?.reparto || []).some((r: string) => allowedDepts.includes(r.toUpperCase()));
        
        if (!hasAccess && opData?.role !== 'admin') {
            throw new Error("Permesso negato: Solo il magazzino o il collaudo possono saltare la produzione per il Phased Rollout.");
        }

        const isGroup = jobId.startsWith('group-');
        await adminDb.runTransaction(async (transaction) => {
            let itemRef;
            let snap;
            if (isGroup) {
                itemRef = adminDb.collection('workGroups').doc(jobId);
                snap = await transaction.get(itemRef);
            } else {
                const lookup = await getJobOrderRefAndSnap(jobId, transaction);
                itemRef = lookup.jobRef;
                snap = lookup.jobSnap;
            }
            if (!snap.exists) throw new Error("Commessa non trovata.");
            const data = snap.data() as JobOrder;
            
            const phs = [...(data.phases || [])];
            let modified = false;

            const operatorIdsToPulse: Set<string> = new Set();

            phs.forEach((p, idx) => {
                // Saltiamo solo le fasi di produzione centrali
                if (p.type === 'production' && p.status !== 'completed' && p.status !== 'skipped') {
                    // Chiudiamo eventuali workPeriods aperti
                    const updatedWPs = (p.workPeriods || []).map(wp => {
                        if (wp.end === null) {
                            operatorIdsToPulse.add(wp.operatorId);
                            return { ...wp, end: new Date(), reason: 'Fast-Forward' };
                        }
                        return wp;
                    });
                    
                    phs[idx] = {
                        ...p,
                        status: 'skipped', // New Policy: Use 'skipped' instead of 'completed'
                        workPeriods: updatedWPs,
                        forced: true,
                        paper_tracked: true
                    };
                    modified = true;
                }
            });

            if (!modified) throw new Error("Nessuna fase di produzione da saltare trovata.");

            // Aggiorniamo la material readiness per le fasi successive (Quality/Packaging)
            const updatedPhases = updatePhasesMaterialReadiness(phs);
            
            const updates: any = { phases: updatedPhases };
            // Forza lo stato a production se era in sospeso o altro, per permettere il collaudo
            if (data.status !== 'completed' && data.status !== 'shipped') {
                updates.status = 'production';
            }

            transaction.update(itemRef, updates);

            // Se è un gruppo, propaghiamo alle commesse figlie
            if (isGroup) {
                for (const childId of (data.jobOrderIds || [])) {
                    const lookup = await getJobOrderRefAndSnap(childId, transaction);
                    if (lookup.jobSnap.exists) {
                        transaction.update(lookup.jobRef, updates);
                    }
                }
            }

            for (const kickedOpId of Array.from(operatorIdsToPulse)) {
                transaction.update(adminDb.collection('operators').doc(kickedOpId), {
                    stato: 'inattivo',
                    activePhaseName: null,
                    activeJobId: null
                });
            }
        });

        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        await pulseOperatorsForJob(jobId);

        return { success: true, message: "Fast-Forward completato. La commessa è ora pronta per il Collaudo/Packaging." };
    } catch (e) {
        console.error("Error in fastForwardToPackaging:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore durante il salto produzione." };
    }
}


export async function resolveJobProblem(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const isGroup = jobId.startsWith('group-');
        let itemRef;
        if (isGroup) {
            itemRef = adminDb.collection("workGroups").doc(jobId);
        } else {
            const lookup = await getJobOrderRefAndSnap(jobId);
            itemRef = lookup.jobRef;
        }
        
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
  const materialData = { ...snap.docs[0].data(), id: snap.docs[0].id } as RawMaterial;
  
  // Fetch withdrawals for hydration (SSoT)
  const wSnap = await adminDb.collection("materialWithdrawals").where("materialId", "==", materialData.id).get();
  // Ensure timestamps are handled if any exist (safety)
  const withdrawals = wSnap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as any));
  
  const hydratedMaterial = hydrateMaterialWithWithdrawals(materialData, withdrawals);
  
  // TASSATIVO: Assicura che l'array batches sia espressamente popolato e serializzato
  const finalPayload = JSON.parse(JSON.stringify(hydratedMaterial));
  
  return finalPayload;
}

export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    if (!id || typeof id !== 'string') return null;
    const isGroup = id.startsWith('group-');
    let snap;
    let finalId = id;
    if (isGroup) {
        snap = await adminDb.collection('workGroups').doc(id).get();
    } else {
        const lookup = await getJobOrderRefAndSnap(id);
        snap = lookup.jobSnap;
        finalId = snap.id;
    }
    if (!snap.exists) return null;
    const data = convertTimestampsToDates(snap.data()) as any;
    data.id = finalId;
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
  const scannedCode = scannedData.ordinePF || '';
  if (!scannedCode) return { error: 'ID Commessa non valido.', title: 'Errore' };
  
  // NUCLEAR FIX: ONLY EXACT MATCH ON SSoT 'ordinePF' for QR SCANS
  const querySnap = await adminDb.collection('jobOrders')
      .where('ordinePF', '==', scannedCode)
      .limit(1)
      .get();

  if (querySnap.empty) {
      return { error: `Commessa "${scannedCode}" non trovata (Ricerca esatta fallita).`, title: 'Errore SSoT' };
  }
  
  const jobSnap = querySnap.docs[0];
  
  let job = convertTimestampsToDates(jobSnap.data()) as JobOrder;
  job.id = jobSnap.id;
  
  if (['planned', 'IN_ATTESA', 'In Pianificazione', 'IN_PIANIFICAZIONE'].includes(job.status)) {
      return { error: `La commessa ${job.ordinePF || scannedCode} è in pianificazione e non può essere lavorata. Rivolgiti al responsabile.`, title: 'Commessa non Avviata' };
  }

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
  
  let displayJobId = jobId;
  if (jobId && !jobId.startsWith('group-')) {
      const { jobSnap } = await getJobOrderRefAndSnap(jobId);
      if (jobSnap.exists) {
          const data = jobSnap.data() as any;
          displayJobId = data.ordinePF || jobId;
      }
  }

  await adminDb.collection('operators').doc(opId).update({ activeJobId: displayJobId || null, activePhaseName: phaseName || null, stato: displayJobId ? 'attivo' : 'inattivo' });
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

export async function resolveJobBOMCommitmentsByType(
    jobIds: string[],
    materialTypesToExtinguish: string[],
    transaction?: admin.firestore.Transaction
) {
    if (!jobIds || !jobIds.length || !materialTypesToExtinguish || !materialTypesToExtinguish.length) return;

    // 1. Pre-mappa i tipi di materiale per evitare lookup ripetuti se possibile
    // Recuperiamo le anagrafiche materiali coinvolte
    const materialsSnap = await adminDb.collection('rawMaterials').get();
    const typeMap = new Map<string, string>();
    materialsSnap.docs.forEach(d => {
        const m = d.data();
        if (m.code) typeMap.set(m.code.toUpperCase(), m.type.toUpperCase());
    });

    const typesToMatch = materialTypesToExtinguish.map(t => t.toUpperCase());

    for (const rawId of jobIds) {
        const lookup = await getJobOrderRefAndSnap(rawId, transaction);
        const jobRef = lookup.jobRef;
        const snap = lookup.jobSnap;
        if (!snap.exists) continue;
        
        const jobData = snap.data() as JobOrder;
        if (!jobData.billOfMaterials || jobData.billOfMaterials.length === 0) continue;

        let modified = false;
        const updatedBOM = jobData.billOfMaterials.map(item => {
            const compCode = item.component?.toUpperCase() || '';
            const compType = typeMap.get(compCode);

            // Matching: se il tipo corrisponde ed è tra quelli da estinguere
            if (compType && typesToMatch.includes(compType) && (item.status !== 'withdrawn' || !item.withdrawn)) {
                modified = true;
                return { 
                    ...item, 
                    status: 'withdrawn' as const, 
                    withdrawn: true 
                };
            }
            return item;
        });

        if (modified) {
            if (transaction) {
                transaction.update(jobRef, { billOfMaterials: updatedBOM });
            } else {
                await jobRef.update({ billOfMaterials: updatedBOM });
            }
        }
    }
}

/**
 * Risolve un impegno SPECIFICO in BOM tramite codice materiale.
 * Pattern Read-Modify-Write rigoroso.
 */
export async function resolveJobBOMCommitmentByMaterialCode(
    jobIds: string[],
    materialCode: string,
    transaction?: admin.firestore.Transaction
) {
    if (!jobIds || !jobIds.length || !materialCode) return;
    const targetCode = materialCode.trim().toUpperCase();

    for (const rawId of jobIds) {
        const lookup = await getJobOrderRefAndSnap(rawId, transaction);
        const jobRef = lookup.jobRef;
        const snap = lookup.jobSnap;
        if (!snap.exists) continue;
        
        const jobData = snap.data() as JobOrder;
        if (!jobData.billOfMaterials || jobData.billOfMaterials.length === 0) continue;

        let modified = false;
        const updatedBOM = jobData.billOfMaterials.map(item => {
            if (item.component.trim().toUpperCase() === targetCode && (item.status !== 'withdrawn' || !item.withdrawn)) {
                modified = true;
                return { ...item, status: 'withdrawn' as const, withdrawn: true };
            }
            return item;
        });

        if (modified) {
            if (transaction) {
                transaction.update(jobRef, { billOfMaterials: updatedBOM });
            } else {
                await jobRef.update({ billOfMaterials: updatedBOM });
            }
        }
    }
}

export async function isOperatorActiveOnAnyJob(opId: string, currentJobId: string): Promise<{ available: boolean; activeJobId?: string | null; activePhaseName?: string | null }> {
    const docSnap = await adminDb.collection("operators").doc(opId).get();
    if (docSnap.exists) {
        const data = docSnap.data();
        // L'operatore è considerato "Occupato" (e bloccato) SOLO se ha una fase attiva
        // Se activePhaseName è null, significa che è in pausa o sta solo esplorando, quindi è libero.
        if (data && data.activeJobId && data.activePhaseName && data.activeJobId !== currentJobId) {
             return { available: false, activeJobId: data.activeJobId, activePhaseName: data.activePhaseName };
        }
    }
    return { available: true };
}

export async function handlePhaseScanResult(
    jobId: string, 
    phaseId: string, 
    opId: string, 
    isCompletion: boolean = false,
    anomalyData?: { hasAnomaly: boolean, anomalyType: string, anomalyNote?: string },
    packagingUpdates?: { jobId: string, actualQty: number }[]
) {
    if (!isCompletion) {
        // GLOBAL PRE-TRANSACTION CHECK (Operator Ubiquity Check)
        // Find if this operator has any open work periods across ALL active jobs/groups
        const statusesToCheck = ['IN_PREPARAZIONE', 'IN_PRODUZIONE', 'PRONTO_PROD', 'FINE_PRODUZIONE', 'in-progress', 'production', 'paused', 'suspended'];
        
        const activeJobsQuery = await adminDb.collection('jobOrders')
            .where('status', 'in', statusesToCheck)
            .get();
            
        for (const doc of activeJobsQuery.docs) {
            const jobDoc = doc.data() as JobOrder;
            for (const p of (jobDoc.phases || [])) {
                for (const wp of (p.workPeriods || [])) {
                    if (wp.operatorId === opId && wp.end === null) {
                        // Ignore if it's the exact same phase (e.g. rapid double click retry)
                        if (doc.id === jobId.replace(/\//g, '-') && p.id === phaseId) continue;
                        
                        throw new Error(`Impossibile iniziare: hai già un'attività in corso sulla commessa ${jobDoc.ordinePF || doc.id} (Fase: ${p.name}). Devi prima metterla in pausa o concluderla.`);
                    }
                }
            }
        }

        const activeGroupsQuery = await adminDb.collection('workGroups')
            .where('status', 'in', statusesToCheck)
            .get();

        for (const doc of activeGroupsQuery.docs) {
            const groupDoc = doc.data() as WorkGroup;
            for (const p of (groupDoc.phases || [])) {
                for (const wp of (p.workPeriods || [])) {
                    if (wp.operatorId === opId && wp.end === null) {
                        if (doc.id === jobId && p.id === phaseId) continue;
                        
                        throw new Error(`Impossibile iniziare: hai già un'attività in corso sul gruppo ${doc.id} (Fase: ${p.name}). Devi prima metterla in pausa o concluderla.`);
                    }
                }
            }
        }
    }

    const isGroup = jobId.startsWith('group-');
    await adminDb.runTransaction(async (transaction) => {
        let itemRef;
        let snap;
        if (isGroup) {
            itemRef = adminDb.collection('workGroups').doc(jobId);
            snap = await transaction.get(itemRef);
        } else {
            const lookup = await getJobOrderRefAndSnap(jobId, transaction);
            itemRef = lookup.jobRef;
            snap = lookup.jobSnap;
        }
        if (!snap.exists) throw new Error("Commessa non trovata.");
        const data = snap.data() as any;
        const phs = [...(data.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        
        if (idx === -1) throw new Error("Fase non trovata.");

        if (isCompletion) {
            // Handle Completion
                
                // NEW: Strict Completion Order Policy
                let prev: JobPhase | null = null;
                for (let j = idx - 1; j >= 0; j--) { 
                    if (!phs[j].isIndependent) { 
                        prev = phs[j]; 
                        break; 
                    } 
                }

                if (prev && !['completed', 'skipped'].includes(prev.status)) {
                    throw new Error(`Impossibile completare "${phs[idx].name}": la fase precedente "${prev.name}" è ancora attiva.`);
                }

                const myWorkPeriodIndex = phs[idx].workPeriods.findIndex((wp: any) => wp.operatorId === opId && wp.end === null);
                if (myWorkPeriodIndex === -1) {
                    throw new Error("L'operatore non ha un periodo di lavoro aperto in questa fase.");
                }
                
                phs[idx].workPeriods[myWorkPeriodIndex].end = new Date();
                
                // If no one else is active, mark phase as completed
                if (!phs[idx].workPeriods.some((wp: any) => wp.end === null)) {
                    phs[idx].status = 'completed';

                    // ADDED: DUAL-DYNAMIC B (PHASE EXTINGUISHMENT)
                    if (phs[idx].type === 'preparation' && phs[idx].allowedMaterialTypes && phs[idx].allowedMaterialTypes.length > 0) {
                        // Filter out session-based types (BOB, PF3V0) which are handled when the session closes
                        const typesToExtinguish = phs[idx].allowedMaterialTypes.filter((t: string) => !['BOB', 'PF3V0'].includes(t.toUpperCase()));
                        if (typesToExtinguish.length > 0) {
                            const jobIds = isGroup ? (data.jobOrderIds || []) : [jobId];
                            await resolveJobBOMCommitmentsByType(jobIds, typesToExtinguish, transaction);
                        }
                    }
                }

                const updatedPhases = updatePhasesMaterialReadiness(phs);
                const dummyJob = { ...data, phases: updatedPhases };
                const newStatus = getOverallStatus(dummyJob);

                const updates: any = { 
                    phases: updatedPhases,
                    status: newStatus,
                    ...(newStatus === 'CHIUSO' ? { overallEndTime: new Date() } : {})
                };

                // HANDLE ANOMALIES (Quality)
                if (anomalyData?.hasAnomaly) {
                    updates.hasAnomaly = true;
                    updates.anomalyType = anomalyData.anomalyType;
                    updates.anomalyNote = anomalyData.anomalyNote;
                }

                // HANDLE PACKAGING UPDATES (WorkGroup / Single Job)
                if (packagingUpdates && packagingUpdates.length > 0) {
                    for (const update of packagingUpdates) {
                        const childLookup = await getJobOrderRefAndSnap(update.jobId, transaction);
                        const childRef = childLookup.jobRef;
                        const childSnap = childLookup.jobSnap;
                        
                        if (childSnap.exists) {
                            const childData = childSnap.data() as JobOrder;
                            const childUpdates: any = { qta: update.actualQty };
                            
                            // Check for quantity mismatch anomaly
                            if (update.actualQty < childData.qta) {
                                childUpdates.hasAnomaly = true;
                                childUpdates.anomalyType = 'QTY_MISMATCH';
                                childUpdates.anomalyNote = `Quantità ridotta durante l'imballo: da ${childData.qta} a ${update.actualQty}`;
                            }
                            transaction.update(childRef, childUpdates);
                        }
                    }
                }

                transaction.update(itemRef, updates);

                // --- CASCADE UPDATE TO CHILDREN ---
                if (isGroup && data.jobOrderIds) {
                    for (const childId of data.jobOrderIds) {
                        const lookup = await getJobOrderRefAndSnap(childId, transaction);
                        if (lookup.jobSnap.exists) {
                            transaction.update(lookup.jobRef, updates);
                        }
                    }
                }
                // ----------------------------------

                transaction.update(adminDb.collection('operators').doc(opId), { 
                    activeJobId: data.ordinePF || jobId, 
                    activePhaseName: null, 
                    stato: 'attivo' // Keeps them in the job, but without active phase
                });

            } else {
                // Handle Start/Join
                
                const opSnap = await transaction.get(adminDb.collection('operators').doc(opId));
                if (opSnap.exists) {
                    const opData = opSnap.data();
                    // Blocca se l'operatore ha una fase attualmente attiva ovunque
                    if (opData && opData.activeJobId && opData.activePhaseName) {
                        if (opData.activeJobId !== (data.ordinePF || jobId) || opData.activePhaseName !== phs[idx].name) {
                            throw new Error(`Impossibile iniziare: hai già un'attività in corso sulla commessa ${opData.activeJobId} (Fase: ${opData.activePhaseName}). Devi prima metterla in pausa o concluderla.`);
                        }
                    }
                }
                
                phs[idx].status = 'in-progress';
                phs[idx].isEstimated = false; // Freeze estimate as production starts
                if (!phs[idx].workPeriods) phs[idx].workPeriods = [];
                
                if (!phs[idx].workPeriods.some((wp: any) => wp.operatorId === opId && wp.end === null)) {
                    phs[idx].workPeriods.push({ start: new Date(), end: null, operatorId: opId });
                }

                const updatedPhases = updatePhasesMaterialReadiness(phs);
                const dummyJob = { ...data, phases: updatedPhases };
                const newStatus = getOverallStatus(dummyJob);
                
                const startUpdates: any = { 
                    phases: updatedPhases, 
                    status: newStatus, 
                    overallStartTime: data.overallStartTime || new Date(),
                    isSuspended: false,
                    isProblemReported: false // Clear problem/suspension on resume
                };
                
                // Clear specific material shortage problem if starting the stuck phase
                if (data.hasMaterialShortage) {
                   startUpdates.hasMaterialShortage = false; 
                }

                transaction.update(itemRef, startUpdates);
                
                // --- CASCADE UPDATE TO CHILDREN ---
                if (isGroup && data.jobOrderIds) {
                    for (const childId of data.jobOrderIds) {
                        const lookup = await getJobOrderRefAndSnap(childId, transaction);
                        if (lookup.jobSnap.exists) {
                            transaction.update(lookup.jobRef, startUpdates);
                        }
                    }
                }
                // ----------------------------------
                
                transaction.update(adminDb.collection('operators').doc(opId), { 
                    activeJobId: data.ordinePF || jobId, 
                    activePhaseName: phs[idx].name, 
                    stato: 'attivo' 
                });
            }
    });

    if (isCompletion) {
        let snap;
        if (jobId.startsWith('group-')) {
            snap = await adminDb.collection('workGroups').doc(jobId).get();
        } else {
            const lookup = await getJobOrderRefAndSnap(jobId);
            snap = lookup.jobSnap;
        }
        const details = snap.data()?.details;
        if (details) {
            await updateArticleHistoricalTimes(details);
        }
    }

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
}

export async function handlePhasePause(jobId: string, phaseId: string, opId: string, reason?: string, notes?: string) {
    const isGroup = jobId.startsWith('group-');
    await adminDb.runTransaction(async (transaction) => {
        let itemRef;
        let snap;
        if (isGroup) {
            itemRef = adminDb.collection('workGroups').doc(jobId);
            snap = await transaction.get(itemRef);
        } else {
            const lookup = await getJobOrderRefAndSnap(jobId, transaction);
            itemRef = lookup.jobRef;
            snap = lookup.jobSnap;
        }
        if (!snap.exists) throw new Error("Commessa non trovata.");
        const data = snap.data() as any;
        const phs = [...(data.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        
        if (idx === -1) throw new Error("Fase non trovata.");
        
        const myWorkPeriodIndex = phs[idx].workPeriods.findIndex((wp: any) => wp.operatorId === opId && wp.end === null);
        if (myWorkPeriodIndex === -1) {
            throw new Error("L'operatore non ha un periodo di lavoro aperto in questa fase.");
        }
        
        phs[idx].workPeriods[myWorkPeriodIndex].end = new Date();
        phs[idx].workPeriods[myWorkPeriodIndex].reason = reason; // Save reason in period
                
                // If no one else is active, mark phase as paused
                if (!phs[idx].workPeriods.some((wp: any) => wp.end === null)) {
                    phs[idx].status = 'paused';
                    phs[idx].pauseReason = reason; // Save current pause reason in phase
                }
                
                const dummyJob = { ...data, phases: phs };
                const updateData: any = { phases: phs, status: getOverallStatus(dummyJob) };

                // Handle 'Manca Materiale' automation
                if (reason === 'Manca Materiale') {
                    const opSnap = await transaction.get(adminDb.collection('operators').doc(opId));
                    phs[idx].materialStatus = 'missing';
                    phs[idx].materialReady = false;
                    
                    updateData.hasMaterialShortage = true;
                    updateData.isSuspended = true; // Mother is suspended
                    updateData.isProblemReported = true;
                    updateData.problemType = 'MANCA_MATERIALE';
                    updateData.problemReportedBy = (opSnap.data() as any)?.nome || 'Operatore';
                    updateData.problemNotes = notes || 'Segnalato automaticamente dalla pausa.';
                } else if (reason === 'Altro' && notes) {
                    updateData.isSuspended = true;
                    updateData.isProblemReported = true;
                    updateData.problemType = 'ALTRO';
                    updateData.problemNotes = notes;
                } else {
                    // Normal pause (end of shift, breaks)
                    // If all phases are pending or paused (no in-progress left), mark job as suspended
                    const isAnyPhaseInProgress = phs.some((p: any) => p.status === 'in-progress');
                    if (!isAnyPhaseInProgress) {
                         updateData.isSuspended = true;
                    }
                }
                
                transaction.update(itemRef, updateData);

                // --- CASCADE UPDATE TO CHILDREN ---
                if (isGroup && data.jobOrderIds) {
                    for (const childId of data.jobOrderIds) {
                        const lookup = await getJobOrderRefAndSnap(childId, transaction);
                        if (lookup.jobSnap.exists) {
                            transaction.update(lookup.jobRef, updateData);
                        }
                    }
                }
                // ----------------------------------

            transaction.update(adminDb.collection('operators').doc(opId), { 
                activeJobId: data.ordinePF || jobId, 
                activePhaseName: null, 
                stato: 'attivo' 
            });
    });

    revalidatePath('/scan-job');
    revalidatePath('/admin/production-console');
}


export async function markPhaseMaterialReady(jobId: string, phaseId: string, materialInfo: { materialCode: string, lotto?: string }) {
    const isGroup = jobId.startsWith('group-');
    try {
        await adminDb.runTransaction(async (transaction) => {
            let itemRef;
            let snap;
            if (isGroup) {
                itemRef = adminDb.collection('workGroups').doc(jobId);
                snap = await transaction.get(itemRef);
            } else {
                const lookup = await getJobOrderRefAndSnap(jobId, transaction);
                itemRef = lookup.jobRef;
                snap = lookup.jobSnap;
            }
            if (!snap.exists) throw new Error('Elemento non trovato.');
            const data = snap.data() as any;
            
            const phs = (data.phases || []).map((p: any) => 
                p.id === phaseId 
                    ? { 
                        ...p, 
                        materialReady: true,
                        // We still store a lightweight record for UI display in the PhaseCard
                        materialConsumptions: [...(p.materialConsumptions || []), {
                            materialCode: materialInfo.materialCode,
                            lottoBobina: materialInfo.lotto || '',
                            timestamp: new Date()
                        }]
                    } 
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
        return { success: true };
    } catch (error) {
        console.error("Error in markPhaseMaterialReady:", error);
        return { success: false, message: 'Errore durante l\'aggiornamento dello stato materiale.' };
    }
}

export async function forceResetStuckMaterialSession(jobId: string, materialCode: string) {
    const isGroup = jobId.startsWith('group-');
    try {
        await adminDb.runTransaction(async (transaction) => {
            let itemRef;
            let snap;
            if (isGroup) {
                itemRef = adminDb.collection('workGroups').doc(jobId);
                snap = await transaction.get(itemRef);
            } else {
                const lookup = await getJobOrderRefAndSnap(jobId, transaction);
                itemRef = lookup.jobRef;
                snap = lookup.jobSnap;
            }
            if (!snap.exists) throw new Error('Elemento non trovato.');
            const data = snap.data() as any;
            
            const phs = [...(data.phases || [])];
            let modified = false;

            phs.forEach((p, pIdx) => {
                const consumptions = [...(p.materialConsumptions || [])];
                const filtered = consumptions.filter(c => 
                    !(c.materialCode === materialCode && c.grossOpeningWeight !== undefined && c.closingWeight === undefined)
                );
                
                if (filtered.length !== consumptions.length) {
                    phs[pIdx].materialConsumptions = filtered;
                    modified = true;
                }
            });
            
            if (modified) {
                transaction.update(itemRef, { phases: phs });
                
                if (isGroup && data.jobOrderIds) {
                    data.jobOrderIds.forEach((childId: string) => {
                        const sanitizedId = childId.replace(/\//g, '-');
                        transaction.update(adminDb.collection('jobOrders').doc(sanitizedId), { phases: phs });
                    });
                }
            }
        });
        
        revalidatePath('/admin/production-console');
        return { success: true };
    } catch (error) {
        console.error("Error in forceResetStuckMaterialSession:", error);
        return { success: false, message: 'Errore durante il reset del prelievo.' };
    }
}


export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
    await adminDb.collection('operators').doc(opId).update({ activeMaterialSessions: sessions });
    return { success: true };
}

export async function closeMaterialSessionAndUpdateStock(session: ActiveMaterialSessionData, closingGrossWeight: number, opId: string, isFinished: boolean = false) {
    try {
        await adminDb.runTransaction(async (transaction) => {
            const materialRef = adminDb.collection('rawMaterials').doc(session.materialId);
            const [matSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', session.materialId).get()
            ]);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());

            let consumedWeight = 0;
            if (isFinished && session.lotto) {
                const batch = (material.batches || []).find(b => b.lotto === session.lotto);
                if (!batch) throw new Error("Lotto non trovato durante il saldo finale.");
                
                // Calculate remaining weight by deducting already registered withdrawals
                const withdrawn = withdrawals
                    .filter(w => w.lotto === session.lotto && w.status !== 'cancelled')
                    .reduce((sum, w) => sum + (w.consumedWeight || 0), 0);
                
                consumedWeight = Math.max(0, (batch.grossWeight - batch.tareWeight) - withdrawn);
            } else {
                consumedWeight = session.grossOpeningWeight - closingGrossWeight;
                if (consumedWeight < -0.001) throw new Error("Il peso di chiusura non può essere superiore a quello di apertura.");
            }

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
                consumedWeight, 
                'kg',
                false,
                session.lotto as string | undefined,
                withdrawals
            );

            const updates: any = { batches: updatedBatches };
            if (isFinished && usedLotto) {
                const bIdx = updatedBatches.findIndex(b => b.lotto === usedLotto);
                if (bIdx !== -1) {
                    updatedBatches[bIdx].isExhausted = true;
                }
            }
            
            if (Object.keys(updates).length > 0) {
                transaction.update(materialRef, updates);
            }

            // ATOMIC STOCK UPDATE (MANDATORY ARCHITECTURE)
            transaction.update(materialRef, {
                stock: admin.firestore.FieldValue.increment(-unitsToChange),
                currentStockUnits: admin.firestore.FieldValue.increment(-unitsToChange),
                currentWeightKg: admin.firestore.FieldValue.increment(-weightToChange)
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
                isFinal: isFinished, // Flag informativo
                source: 'production'
            });

            // ADDED: DUAL-DYNAMIC A (SESSION EXTINGUISHMENT)
            if (session.associatedJobs.length > 0) {
                const jobIds = session.associatedJobs.map(j => j.jobId);
                await resolveJobBOMCommitmentByMaterialCode(jobIds, session.materialCode, transaction);
                await resolveJobBOMCommitmentsByType(jobIds, [material.type], transaction);
            }
        });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        return { success: true, message: isFinished ? "Materiale segnato come esaurito e magazzino azzerato." : "Sessione chiusa e magazzino aggiornato." };
    } catch (e) {
        console.error("Close material session error:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore chiusura sessione." };
    }
}

export async function logTubiGuainaWithdrawal(formData: FormData, isFinished: boolean = false) {
    const rawData = Object.fromEntries(formData.entries());
    const { materialId, operatorId, jobId, jobOrderPF, phaseId, quantity, unit, lotto } = rawData;
    
    try {
        await adminDb.runTransaction(async (t) => {
            const mRef = adminDb.collection("rawMaterials").doc(materialId as string);
            const [mSnap, wSnap] = await Promise.all([
                t.get(mRef),
                adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
            ]);
            
            if (!mSnap.exists) throw new Error("Materiale non trovato.");
            const material = mSnap.data() as RawMaterial;
            const withdrawals = wSnap.docs.map((d: any) => d.data());
            
            const globalSettings = await getGlobalSettings();
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            let qtyToUse = Number(quantity);
            
            if (!isFinished && qtyToUse <= 0) {
                throw new Error("La quantità prelevata deve essere maggiore di zero.");
            }
            
            if (isFinished && lotto) {
                // MODIFIED: In Lot-Centric model, the balance is already on the batch
                const batch = (material.batches || []).find(b => b.lotto === lotto);
                if (batch) {
                    qtyToUse = Math.max(0, batch.netQuantity || 0);
                }
            }

            const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
                material,
                config,
                qtyToUse,
                unit as any,
                false,
                lotto as string,
                withdrawals
            );

            const updates: any = { batches: updatedBatches };
            if (isFinished && usedLotto) {
                const bIdx = updatedBatches.findIndex(b => b.lotto === usedLotto);
                if (bIdx !== -1) {
                    updatedBatches[bIdx].isExhausted = true;
                }
            }

            if (Object.keys(updates).length > 0) {
                t.update(mRef, updates);
            }

            // ATOMIC STOCK UPDATE (MANDATORY ARCHITECTURE)
            t.update(mRef, {
                stock: admin.firestore.FieldValue.increment(-unitsToChange),
                currentStockUnits: admin.firestore.FieldValue.increment(-unitsToChange),
                currentWeightKg: admin.firestore.FieldValue.increment(-weightToChange)
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
                isFinal: isFinished,
                source: 'production'
            });

            // --- EVASIONE IMPEGNATO (Floor Truth) ---
            // Regola: La realtà di fabbrica vince. Qualsiasi scarico associato a una commessa 
            // estingue il fabbisogno per quella tipologia di materiale, gestendo anche gli equivalenti.
            const sid = (jobId as string);
            const isGroup = sid.startsWith('group-');
            let finalJobIds = [sid];
            
            if (isGroup) {
                const gSnap = await t.get(adminDb.collection('workGroups').doc(sid));
                if (gSnap.exists) {
                    finalJobIds = (gSnap.data() as any).jobOrderIds || [];
                }
            }
            
            await resolveJobBOMCommitmentByMaterialCode(finalJobIds, material.code, t);
            await resolveJobBOMCommitmentsByType(finalJobIds, [material.type], t);
        });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        return { success: true, message: isFinished ? "Lotto esaurito e scaricato." : "Scarico registrato." };
    } catch (e) { 
        console.error("Log tubi/guaina error:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore scarico." }; 
    }
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
            const materialData = { ...mSnap.data(), id: mSnap.id } as RawMaterial;
            
            // Fetch withdrawals for hydration (SSoT)
            const wSnap = await adminDb.collection("materialWithdrawals").where("materialId", "==", materialData.id).get();
            const withdrawals = wSnap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as any));
            const hydratedMaterial = hydrateMaterialWithWithdrawals(materialData, withdrawals);

            return { 
                material: JSON.parse(JSON.stringify(hydratedMaterial)), 
                netWeight: rec.netWeight, 
                packagingId: rec.packagingId || 'none',
                tareWeight: rec.tareWeight || 0,
                tareName: rec.tareName || ''
            };
        }
    }

    const materialsSnap = await adminDb.collection("rawMaterials").get();
    for (const mDoc of materialsSnap.docs) {
        const mData = { ...mDoc.data(), id: mDoc.id } as RawMaterial;
        const matchingBatch = (mData.batches || []).find(b => b.lotto === lotto && !b.isExhausted);
        if (matchingBatch) {
            const netWeight = matchingBatch.netQuantity || (matchingBatch.grossWeight - (matchingBatch.tareWeight || 0));
            // Fetch withdrawals for hydration (SSoT)
            const wSnap = await adminDb.collection("materialWithdrawals").where("materialId", "==", mDoc.id).get();
            const withdrawals = wSnap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as any));
            const hydratedMaterial = hydrateMaterialWithWithdrawals(mData, withdrawals);

            return {
                material: JSON.parse(JSON.stringify(hydratedMaterial)),
                netWeight: netWeight,
                packagingId: matchingBatch.packagingId || 'none',
                tareWeight: matchingBatch.tareWeight || 0,
                tareName: matchingBatch.tareName || ''
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

        const invalidJobs = jobs.filter(j => ['CHIUSO', 'FINE PRODUZIONE', 'FINE_PRODUZIONE', 'completed', 'shipped', 'closed'].includes(j.status));
        if (invalidJobs.length > 0) {
            throw new Error(`Impossibile raggruppare: la commessa ${invalidJobs[0].ordinePF} è in uno stato non compatibile (${invalidJobs[0].status}).`);
        }

        const totalQty = jobs.reduce((sum, j) => sum + (Number(j.qta) || 0), 0);
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
            .map(p1 => {
                let totalExpectedTime = 0;
                let hasValidTime = false;
                
                jobs.forEach(j => {
                    const matchedPhase = (j.phases || []).find(jp => jp.id === p1.id);
                    if (matchedPhase && typeof matchedPhase.expectedMinutesPerPiece === 'number') {
                        totalExpectedTime += matchedPhase.expectedMinutesPerPiece * (Number(j.qta) || 0);
                        hasValidTime = true;
                    }
                });

                const weightedExpectedMinutes = (hasValidTime && totalQty > 0) 
                    ? (totalExpectedTime / totalQty) 
                    : (p1.expectedMinutesPerPiece ?? 0);

                return {
                    ...p1,
                    status: 'pending' as const,
                    workPeriods: [],
                    materialConsumptions: [],
                    expectedMinutesPerPiece: weightedExpectedMinutes ?? 0
                };
            });

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

        // SANITIZZAZIONE TOTALE: Rimuove chiavi undefined native non gestite da Firebase
        const safeGroupPayload = JSON.parse(JSON.stringify(newGroup));
        // Ripristino l'oggetto Timestamp nativo
        safeGroupPayload.createdAt = admin.firestore.Timestamp.now();

        batch.set(groupRef, safeGroupPayload);
        jobIds.forEach(id => batch.update(adminDb.collection("jobOrders").doc(id), { workGroupId: newGroupId }));
        
        await batch.commit();
        revalidatePath('/admin/work-group-management');
        revalidatePath('/admin/production-console');
        return { success: true, workGroupId: newGroupId };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : "Errore creazione gruppo." };
    }
}
