
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, MaterialConsumption, RawMaterialType, ActiveMaterialSessionData, WorkGroup, Operator, WorkPhaseTemplate } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';
import { dissolveWorkGroup } from '../admin/work-group-management/actions';

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

export async function getRawMaterialByCode(code: string | undefined): Promise<RawMaterial | { error: string; title?: string }> {
  const trimmed = (code || '').trim();
  if (!trimmed) return { error: `Il codice inserito è vuoto.`, title: 'Codice Vuoto' };
  const q = firestoreQuery(collection(db, "rawMaterials"), where("code_normalized", "==", trimmed.toLowerCase()));
  const snap = await getDocs(q);
  if (snap.empty) return { error: `Materia prima "${trimmed}" non trovata a sistema.`, title: 'Materiale non Trovato' };
  const material = { ...snap.docs[0].data(), id: snap.docs[0].id } as RawMaterial;
  return JSON.parse(JSON.stringify(material));
}

async function propagateGroupUpdatesToJobs(transaction: any, groupData: WorkGroup) {
    if (!groupData.jobOrderIds || groupData.jobOrderIds.length === 0) return;
    const updatePayload = { 
        phases: groupData.phases || [], 
        status: groupData.status || 'production'
    };
    groupData.jobOrderIds.forEach(id => {
        if (id) transaction.update(doc(db, 'jobOrders', id), updatePayload);
    });
}

export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    if (!id || typeof id !== 'string') return null;
    const isGroup = id.startsWith('group-');
    const snap = await getDoc(doc(db, isGroup ? 'workGroups' : 'jobOrders', id));
    if (!snap.exists()) return null;
    const data = convertTimestampsToDates(snap.data());
    if (isGroup) {
        const group = data as WorkGroup;
        return { 
            id: group.id, cliente: group.cliente, qta: group.totalQuantity, department: group.department, details: group.details, ordinePF: group.jobOrderPFs?.join(', ') || 'Gruppo', 
            numeroODL: group.numeroODL || 'N/D', numeroODLInterno: group.numeroODLInterno || 'N/D', dataConsegnaFinale: group.dataConsegnaFinale || 'N/D', 
            postazioneLavoro: 'Multi-Commessa', phases: group.phases || [], overallStartTime: group.overallStartTime, overallEndTime: group.overallEndTime, 
            isProblemReported: group.isProblemReported, problemType: group.problemType, problemNotes: group.problemNotes, problemReportedBy: group.problemReportedBy, 
            status: group.status, workCycleId: group.workCycleId, workGroupId: group.id, jobOrderIds: group.jobOrderIds, jobOrderPFs: group.jobOrderPFs 
        };
    }
    return data as JobOrder;
}

export async function verifyAndGetJobOrder(scannedData: { ordinePF: string; codice: string; qta: string; }): Promise<JobOrder | { error: string; title?: string }> {
  const sanitizedId = (scannedData.ordinePF || '').replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
  if (!sanitizedId) return { error: 'ID Commessa non valido.', title: 'Errore' };
  const snap = await getDoc(doc(db, "jobOrders", sanitizedId));
  if (!snap.exists()) return { error: `Commessa ${sanitizedId} non trovata.`, title: 'Errore' };
  const job = convertTimestampsToDates(snap.data()) as JobOrder;
  if (job.workGroupId) {
    const gSnap = await getDoc(doc(db, 'workGroups', job.workGroupId));
    if (gSnap.exists()) return await getJobOrderById(job.workGroupId) as JobOrder;
  }
  return JSON.parse(JSON.stringify(job));
}

function updatePhasesMaterialReadiness(phases: JobPhase[]): JobPhase[] {
    const sorted = [...(phases || [])].sort((a, b) => a.sequence - b.sequence);
    const allPrepDone = sorted.filter(p => p.type === 'preparation' && !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped');
    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        if (curr.materialStatus === 'missing') { curr.materialReady = false; continue; }
        if (curr.requiresMaterialAssociation || curr.isIndependent || curr.type === 'preparation') { curr.materialReady = true; continue; }
        if (!allPrepDone) { curr.materialReady = false; continue; }
        let prev: JobPhase | null = null;
        for (let j = i - 1; j >= 0; j--) { if (!sorted[j].isIndependent) { prev = sorted[j]; break; } }
        if (!prev) curr.materialReady = true;
        else curr.materialReady = ['in-progress', 'completed', 'skipped', 'paused'].includes(prev.status);
    }
    return sorted;
}

export async function updateOperatorStatus(opId: string, jobId: string | null, phaseName: string | null) {
  if (!opId) return;
  await updateDoc(doc(db, 'operators', opId), { activeJobId: jobId || null, activePhaseName: phaseName || null, stato: jobId ? 'attivo' : 'inattivo' });
  return { success: true };
}

export async function updateJob(job: JobOrder) {
    if (!job || !job.id) return { success: false, message: 'Dati commessa incompleti.' };
    job.phases = updatePhasesMaterialReadiness(job.phases || []);
    if (job.phases.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped') && !job.isProblemReported) {
        job.status = 'completed';
        if (!job.overallEndTime) job.overallEndTime = new Date();
    }
    await setDoc(doc(db, "jobOrders", job.id), JSON.parse(JSON.stringify(job)), { merge: true });
    revalidatePath('/scan-job');
    return { success: true, message: 'Commessa aggiornata.' };
}

export async function updateWorkGroup(group: WorkGroup, opId: string) {
    if (!group || !group.id) return { success: false, message: 'Dati gruppo incompleti.' };
    const phases = group.phases || [];
    if (phases.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped') && !group.isProblemReported) {
        return await dissolveWorkGroup(group.id, true);
    }
    group.status = phases.some(p => p.status === 'in-progress') ? 'production' : 'paused';
    try {
        await runTransaction(db, async (t) => {
            const groupRef = doc(db, "workGroups", group.id);
            const groupSnap = await t.get(groupRef);
            if (!groupSnap.exists()) throw new Error("Gruppo non trovato: " + group.id);
            t.set(groupRef, JSON.parse(JSON.stringify(group)), { merge: true });
            await propagateGroupUpdatesToJobs(t, group);
        });
        revalidatePath('/scan-job');
        return { success: true, message: 'Gruppo aggiornato.' };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'aggiornamento del gruppo.' };
    }
}

export async function resolveJobProblem(jobId: string, uid: string) {
    await ensureAdmin(uid);
    if (!jobId) return { success: false, message: 'ID Commessa non valido.' };
    const isG = jobId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Elemento non trovato: " + jobId);
            const up: any = { isProblemReported: false, problemType: deleteField(), problemNotes: deleteField(), problemReportedBy: deleteField() };
            t.update(itemRef, up);
            if (isG) {
                const data = snap.data() as WorkGroup;
                (data.jobOrderIds || []).forEach(id => { if(id) t.update(doc(db, 'jobOrders', id), up); });
            }
        });
        revalidatePath('/scan-job');
        return { success: true, message: 'Problema risolto.' };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante la risoluzione del problema.' };
    }
}

export async function closeMaterialSessionAndUpdateStock(session: ActiveMaterialSessionData, closing: number, opId: string) {
  if (!session || !opId) return { success: false, message: 'Dati sessione o operatore mancanti.' };
  try {
    const affectedRefs: any[] = [];
    if (session.originatorJobId) affectedRefs.push(doc(db, session.originatorJobId.startsWith('group-') ? 'workGroups' : 'jobOrders', session.originatorJobId));
    (session.associatedJobs || []).forEach(j => { 
        if (j.jobId && j.jobId !== session.originatorJobId) {
            affectedRefs.push(doc(db, 'jobOrders', j.jobId));
        }
    });

    return await runTransaction(db, async (t) => {
        // 1. TUTTE LE LETTURE ALL'INIZIO
        const mRef = doc(db, "rawMaterials", session.materialId);
        const opRef = doc(db, "operators", opId);
        
        const [mSnap, opSnap, ...itemSnaps] = await Promise.all([
            t.get(mRef), 
            t.get(opRef), 
            ...affectedRefs.map(ref => t.get(ref))
        ]);
        
        if (!mSnap.exists()) throw new Error("Materiale non trovato: " + session.materialCode);
        const mat = mSnap.data() as RawMaterial;
        const operatorName = opSnap.exists() ? opSnap.data().nome : 'Sconosciuto';
        
        const consumedWeight = (session.grossOpeningWeight || 0) - (closing || 0);
        if (consumedWeight < -0.001) throw new Error("Errore: il peso finale inserito (" + closing + "kg) è superiore a quello di apertura (" + session.grossOpeningWeight + "kg).");
        
        const units = mat.unitOfMeasure === 'kg' ? consumedWeight : (mat.conversionFactor && mat.conversionFactor > 0 ? consumedWeight / mat.conversionFactor : 0);
        
        // 2. TUTTE LE SCRITTURE DOPO LE LETTURE
        const wRef = doc(collection(db, "materialWithdrawals"));
        t.set(wRef, { 
            jobIds: session.associatedJobs.map(j => j.jobId), 
            jobOrderPFs: session.associatedJobs.map(j => j.jobOrderPF), 
            materialId: session.materialId, 
            materialCode: session.materialCode, 
            consumedWeight, 
            consumedUnits: units, 
            operatorId: opId, 
            operatorName, 
            withdrawalDate: Timestamp.now(), 
            lotto: session.lotto || null 
        });
        
        t.update(mRef, { 
            currentWeightKg: (mat.currentWeightKg || 0) - consumedWeight, 
            currentStockUnits: (mat.currentStockUnits || 0) - units 
        });
        
        itemSnaps.forEach(snap => {
            if (snap.exists()) {
                const data = snap.data() as JobOrder;
                const phs = (data.phases || []).map(p => ({
                    ...p, materialConsumptions: (p.materialConsumptions || []).map(mc => (mc.materialId === session.materialId && (mc.lottoBobina === session.lotto || (!mc.lottoBobina && !session.lotto)) && mc.closingWeight === undefined) ? { ...mc, closingWeight: closing, withdrawalId: wRef.id } : mc)
                }));
                t.update(snap.ref, { phases: phs });
            }
        });
        return { success: true, message: 'Sessione chiusa e stock aggiornato.' };
    });
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore critico durante la chiusura della sessione.' }; 
  }
}

export async function logTubiGuainaWithdrawal(formData: FormData) {
  const data = Object.fromEntries(formData.entries());
  const jobId = data.jobId as string;
  const materialId = data.materialId as string;
  const operatorId = data.operatorId as string;
  const phaseId = data.phaseId as string;
  if (!jobId || !materialId || !operatorId) return { success: false, message: 'Parametri obbligatori mancanti.' };
  
  const isG = jobId.startsWith('group-');
  try {
    return await runTransaction(db, async (t) => {
        // 1. TUTTE LE LETTURE ALL'INIZIO
        const mRef = doc(db, "rawMaterials", materialId);
        const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
        const opRef = doc(db, "operators", operatorId);

        const [mSnap, itemSnap, opSnap] = await Promise.all([
            t.get(mRef), 
            t.get(itemRef), 
            t.get(opRef)
        ]);

        if (!mSnap.exists()) throw new Error("Materia prima non trovata: " + materialId);
        if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato: " + jobId);
        
        const mat = mSnap.data() as RawMaterial;
        const item = itemSnap.data() as JobOrder;
        const qty = Number(data.quantity);
        const w = data.unit === 'kg' ? qty : (mat.conversionFactor ? qty * mat.conversionFactor : 0);
        const u = data.unit === 'kg' ? (mat.conversionFactor ? qty / mat.conversionFactor : qty) : qty;
        
        // 2. TUTTE LE SCRITTURE DOPO
        t.update(mRef, { 
            currentStockUnits: (mat.currentStockUnits || 0) - u, 
            currentWeightKg: (mat.currentWeightKg || 0) - w 
        });
        
        const wRef = doc(collection(db, "materialWithdrawals"));
        const jobIds = isG ? (item as any).jobOrderIds || [] : [jobId];
        const jobOrderPFs = isG ? (item as any).jobOrderPFs || [] : [(data.jobOrderPF as string) || item.ordinePF || 'N/D'];

        t.set(wRef, { 
            jobIds, 
            jobOrderPFs, 
            materialId: mSnap.id, 
            materialCode: mat.code, 
            consumedWeight: w, 
            consumedUnits: u, 
            operatorId, 
            operatorName: opSnap.exists() ? opSnap.data().nome : 'Sconosciuto', 
            withdrawalDate: Timestamp.now(), 
            lotto: (data.lotto as string) || null 
        });
        
        const phs = [...(item.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        if (idx !== -1) {
            phs[idx].materialConsumptions = [...(phs[idx].materialConsumptions || []), { withdrawalId: wRef.id, materialId: mSnap.id, materialCode: mat.code, pcs: u }];
            if (phs[idx].type === 'preparation') phs[idx].materialReady = true;
            t.update(itemRef, { phases: phs });
            if (isG) await propagateGroupUpdatesToJobs(t, { ...item, phases: phs } as any);
        }
        return { success: true, message: 'Scarico materiale registrato.' };
    });
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore durante la registrazione dello scarico.' }; 
  }
}

export async function findLastWeightForLotto(matId: string | undefined, lotto: string) {
    if (!lotto) return null;
    const allMats = (await getDocs(collection(db, "rawMaterials"))).docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial));
    let mat = matId ? allMats.find(m => m.id === matId) : allMats.find(m => (m.batches || []).some(b => b.lotto === lotto));
    if (!mat) return null;
    const jSnap = await getDocs(collection(db, "jobOrders"));
    const cons: any[] = [];
    jSnap.forEach(d => {
        const job = convertTimestampsToDates(d.data()) as JobOrder;
        (job.phases || []).forEach(p => (p.materialConsumptions || []).forEach(c => {
            if (c.materialId === mat!.id && c.lottoBobina === lotto && c.closingWeight !== undefined) {
                const last = (p.workPeriods || []).reduce((lat, wp) => wp.end && (!lat || new Date(wp.end) > lat) ? new Date(wp.end) : lat, null as Date | null);
                if (last) cons.push({ weight: c.closingWeight, tare: c.tareWeight || 0, packId: c.packagingId || 'none', date: last });
            }
        }));
    });
    if (cons.length > 0) {
        const last = cons.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
        return { grossWeight: last.weight, netWeight: last.weight - last.tare, packagingId: last.packId, material: mat };
    }
    const batch = (mat.batches || []).find(b => b.lotto === lotto);
    return batch ? { grossWeight: batch.grossWeight, netWeight: batch.grossWeight - batch.tareWeight, packagingId: batch.packagingId || 'none', material: mat } : null;
}

export async function handlePhaseScanResult(jobId: string, phaseId: string, opId: string) {
    if (!jobId || !phaseId || !opId) return { success: false, message: 'Dati scansione fase incompleti.' };
    const avail = await isOperatorActiveOnAnyJob(opId, jobId.startsWith('group-') ? jobId : undefined);
    if (!avail.available) return { success: false, message: "Operatore già attivo su un'altra commessa.", error: 'OPERATOR_BUSY' };
    
    try {
        return await runTransaction(db, async (t) => {
            const isG = jobId.startsWith('group-');
            const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
            const opRef = doc(db, 'operators', opId);
            
            const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(opRef)]);
            
            if (!snap.exists()) throw new Error("Commessa o Gruppo non trovato: " + jobId);
            const data = convertTimestampsToDates(snap.data()) as JobOrder;
            const phs = [...(data.phases || [])].sort((a, b) => a.sequence - b.sequence);
            const idx = phs.findIndex(p => p.id === phaseId);
            if (idx === -1) throw new Error("Fase non trovata nell'ordine: " + phaseId);
            
            phs[idx].status = 'in-progress';
            if (!phs[idx].workPeriods) phs[idx].workPeriods = [];
            phs[idx].workPeriods.push({ start: new Date(), end: null, operatorId: opId });
            
            const up = { ...data, phases: updatePhasesMaterialReadiness(phs), status: 'production' as const, overallStartTime: data.overallStartTime || new Date() };
            t.update(itemRef, up);
            if (isG) await propagateGroupUpdatesToJobs(t, up as any);
            t.update(opRef, { activeJobId: jobId, activePhaseName: phs[idx].name, stato: 'attivo' });
            
            return { success: true, message: 'Fase avviata correttamente.' };
        });
    } catch (e) { 
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'avvio della fase.' }; 
    }
}

export async function isOperatorActiveOnAnyJob(opId: string, currentId?: string) {
    if (!opId) return { available: true };
    const snap = await getDoc(doc(db, "operators", opId));
    if (!snap.exists()) return { available: true };
    const op = snap.data() as Operator;
    if (!op.activeJobId || (currentId && op.activeJobId === currentId)) return { available: true };
    
    const isGroup = op.activeJobId.startsWith('group-');
    const jSnap = await getDoc(doc(db, isGroup ? 'workGroups' : 'jobOrders', op.activeJobId));
    let active = false;
    if (jSnap.exists()) {
        active = (jSnap.data().phases || []).some((p: any) => p.status === 'in-progress' && (p.workPeriods || []).some((wp: any) => wp.operatorId === opId && wp.end === null));
    }
    if (!active) await updateOperatorStatus(opId, null, null);
    return { 
        available: !active, 
        activeJobId: active ? op.activeJobId : null, 
        activePhaseName: active ? op.activePhaseName : null 
    };
}

export async function startMaterialSessionInJob(itemId: string, phaseId: string, cons: MaterialConsumption) {
    const isG = itemId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', itemId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Commessa o Gruppo non trovato: " + itemId);
            const item = snap.data() as JobOrder;
            const phs = (item.phases || []).map(p => p.id === phaseId ? { ...p, materialConsumptions: [...(p.materialConsumptions || []), cons], materialReady: true } : p);
            t.update(itemRef, { phases: phs });
            if (isG) await propagateGroupUpdatesToJobs(t, { ...item, phases: phs } as any);
        });
        return { success: true, message: 'Sessione materiale avviata.' };
    } catch (e) { 
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'avvio della sessione.' }; 
    }
}

export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
  if (!opId) return;
  await updateDoc(doc(db, 'operators', opId), { activeMaterialSessions: sessions || [] });
}

export async function reportMaterialMissing(itemId: string, phaseId: string, uid: string, notes?: string) {
  const isG = itemId.startsWith('group-');
  try {
    await runTransaction(db, async (t) => {
        const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', itemId);
        const opRef = doc(db, 'operators', uid);
        const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(opRef)]);
        
        if (!snap.exists()) throw new Error("Elemento non trovato: " + itemId);
        const item = snap.data() as JobOrder;
        const phs = [...(item.phases || [])];
        const idx = phs.findIndex(p => p.id === phaseId);
        if (idx === -1) throw new Error("Fase non trovata: " + phaseId);
        
        phs[idx].materialStatus = 'missing';
        phs[idx].materialReady = false;
        
        if (phs[idx].status === 'in-progress') {
            const wpIdx = (phs[idx].workPeriods || []).findIndex(wp => wp.operatorId === uid && wp.end === null);
            if (wpIdx !== -1) phs[idx].workPeriods[wpIdx].end = new Date();
            if (!(phs[idx].workPeriods || []).some(wp => wp.end === null)) phs[idx].status = 'paused';
            t.update(opRef, { activeJobId: null, activePhaseName: null, stato: 'inattivo' });
        }
        
        const up: any = { 
            phases: phs, 
            isProblemReported: true, 
            problemType: 'MANCA_MATERIALE', 
            problemReportedBy: opSnap.data()?.nome || 'Admin', 
            problemNotes: notes || '', 
            status: phs.some(p => p.status === 'in-progress') ? 'production' : 'paused' 
        };
        t.update(itemRef, up);
        if (isG) (item.jobOrderIds || []).forEach(id => t.update(doc(db, 'jobOrders', id), up));
    });
    return { success: true, message: 'Mancanza materiale segnalata.' };
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore durante la segnalazione materiale.' }; 
  }
}

export async function createWorkGroup(ids: string[], opId: string) {
    if (!ids || ids.length < 2) return { success: false, message: 'Selezionare almeno 2 commesse per creare un gruppo.' };
    try {
        const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'jobOrders', id))));
        const jobs = docs.map(d => d.data() as JobOrder);
        const first = jobs[0];
        const gId = `group-${Date.now()}`;
        const group: WorkGroup = { 
            id: gId, jobOrderIds: ids, jobOrderPFs: jobs.map(j => j.ordinePF), status: 'production', createdAt: new Date(), createdBy: opId, 
            totalQuantity: jobs.reduce((s, j) => s + j.qta, 0), workCycleId: first.workCycleId || '', department: first.department, 
            cliente: first.cliente, phases: first.phases, details: 'Multi-Commessa', numeroODLInterno: [...new Set(jobs.map(j => j.numeroODLInterno))].join(', '), 
            numeroODL: [...new Set(jobs.map(j => j.numeroODL))].join(', '), dataConsegnaFinale: first.dataConsegnaFinale, ordinePF: jobs.map(j => j.ordinePF).join(', ') 
        };
        const batch = writeBatch(db);
        batch.set(doc(db, 'workGroups', gId), group);
        docs.forEach(d => batch.update(d.ref, { workGroupId: gId }));
        await batch.commit();
        return { success: true, message: 'Gruppo creato.', workGroupId: gId };
    } catch (e) {
        return { success: false, message: 'Errore durante la creazione del gruppo.' };
    }
}

export async function postponeQualityPhase(jobId: string, phaseId: string, currentState: 'default' | 'postponed') {
    try {
        return await runTransaction(db, async (t) => {
            const isG = jobId.startsWith('group-');
            const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
            const [snap, tSnap] = await Promise.all([t.get(itemRef), t.get(doc(db, 'workPhaseTemplates', phaseId))]);
            if (!snap.exists()) throw new Error("Elemento non trovato: " + jobId);
            const data = snap.data() as JobOrder;
            const phs = [...(data.phases || [])];
            const idx = phs.findIndex(p => p.id === phaseId);
            if (idx === -1) throw new Error("Fase non trovata: " + phaseId);
            if (currentState === 'default') {
                const lastProd = phs.filter(p => p.type === 'production').sort((a,b) => a.sequence - b.sequence).pop();
                phs[idx].sequence = lastProd ? lastProd.sequence + 0.1 : 99;
                phs[idx].postponed = true;
            } else {
                phs[idx].sequence = tSnap.exists() ? tSnap.data().sequence : 1;
                delete phs[idx].postponed;
            }
            const up = { phases: updatePhasesMaterialReadiness(phs) };
            t.update(itemRef, up);
            if (isG) (data as any).jobOrderIds?.forEach((id: string) => { if(id) t.update(doc(db, 'jobOrders', id), up); });
            return { success: true, message: 'Fase spostata correttamente.' };
        });
    } catch (e) { 
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante lo spostamento della fase.' }; 
    }
}
