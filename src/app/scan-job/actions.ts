
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, writeBatch, Timestamp, runTransaction, getDocs, query as firestoreQuery, where, orderBy, limit, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, MaterialConsumption, RawMaterialType, ActiveMaterialSessionData, WorkGroup, Operator, WorkPhaseTemplate } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

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
        const result = await dissolveWorkGroup(group.id, true);
        return result;
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
    const isGroup = jobId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Elemento non trovato: " + jobId);
            const up: any = { isProblemReported: false, problemType: deleteField(), problemNotes: deleteField(), problemReportedBy: deleteField() };
            t.update(itemRef, up);
            if (isGroup) {
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
        // 1. ALL READS FIRST
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
        if (consumedWeight < -0.001) throw new Error("Peso finale superiore a apertura.");
        
        const units = mat.unitOfMeasure === 'kg' ? consumedWeight : (mat.conversionFactor && mat.conversionFactor > 0 ? consumedWeight / mat.conversionFactor : 0);
        
        // 2. ALL WRITES AFTER
        const wRef = doc(collection(db, "materialWithdrawals"));
        t.set(wRef, { 
            jobIds: session.associatedJobs.map(j => j.jobId), 
            jobOrderPFs: session.associatedJobs.map(j => j.jobOrderPF), 
            materialId: mSnap.id, 
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
                    ...p, materialConsumptions: (p.materialConsumptions || []).map(mc => (mc.materialId === mSnap.id && (mc.lottoBobina === session.lotto || (!mc.lottoBobina && !session.lotto)) && mc.closingWeight === undefined) ? { ...mc, closingWeight: closing, withdrawalId: wRef.id } : mc)
                }));
                t.update(snap.ref, { phases: phs });
            }
        });
        return { success: true, message: 'Sessione chiusa.' };
    });
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore.' }; 
  }
}

export async function logTubiGuainaWithdrawal(formData: FormData) {
  const data = Object.fromEntries(formData.entries());
  const jobId = data.jobId as string;
  const materialId = data.materialId as string;
  const operatorId = data.operatorId as string;
  const phaseId = data.phaseId as string;
  if (!jobId || !materialId || !operatorId) return { success: false, message: 'Dati incompleti.' };
  
  const isGroup = jobId.startsWith('group-');
  try {
    return await runTransaction(db, async (t) => {
        // 1. ALL READS FIRST
        const mRef = doc(db, "rawMaterials", materialId);
        const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
        const opRef = doc(db, "operators", operatorId);

        const [mSnap, itemSnap, opSnap] = await Promise.all([
            t.get(mRef), 
            t.get(itemRef), 
            t.get(opRef)
        ]);

        if (!mSnap.exists()) throw new Error("Materiale non trovato.");
        if (!itemSnap.exists()) throw new Error("Commessa non trovata.");
        
        const mat = mSnap.data() as RawMaterial;
        const item = itemSnap.data() as JobOrder;
        const qty = Number(data.quantity);
        const w = data.unit === 'kg' ? qty : (mat.conversionFactor ? qty * mat.conversionFactor : 0);
        const u = data.unit === 'kg' ? (mat.conversionFactor ? qty / mat.conversionFactor : qty) : qty;
        
        // 2. ALL WRITES AFTER
        t.update(mRef, { 
            currentStockUnits: (mat.currentStockUnits || 0) - u, 
            currentWeightKg: (mat.currentWeightKg || 0) - w 
        });
        
        const wRef = doc(collection(db, "materialWithdrawals"));
        const jobIds = isGroup ? (item as any).jobOrderIds || [] : [jobId];
        const jobOrderPFs = isGroup ? (item as any).jobOrderPFs || [] : [(data.jobOrderPF as string) || item.ordinePF || 'N/D'];

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
            if (isGroup) await propagateGroupUpdatesToJobs(t, { ...item, phases: phs } as any);
        }
        return { success: true, message: 'Scarico registrato.' };
    });
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore.' }; 
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
    if (batch) {
        return { grossWeight: batch.grossWeight, netWeight: batch.grossWeight - batch.tareWeight, packagingId: batch.packagingId || 'none', material: mat };
    }
    return null;
}

export async function handlePhaseScanResult(jobId: string, phaseId: string, opId: string) {
    if (!jobId || !phaseId || !opId) return { success: false, message: 'Dati incompleti.' };
    const isGroup = jobId.startsWith('group-');
    const avail = await isOperatorActiveOnAnyJob(opId, isGroup ? jobId : undefined);
    if (!avail.available) return { success: false, message: "Operatore già attivo.", error: 'OPERATOR_BUSY' };
    
    try {
        return await runTransaction(db, async (t) => {
            const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
            const opRef = doc(db, 'operators', opId);
            const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(opRef)]);
            
            if (!snap.exists()) throw new Error("Non trovato.");
            const data = convertTimestampsToDates(snap.data()) as JobOrder;
            const phs = [...(data.phases || [])].sort((a, b) => a.sequence - b.sequence);
            const idx = phs.findIndex(p => p.id === phaseId);
            if (idx === -1) throw new Error("Fase non trovata.");
            
            phs[idx].status = 'in-progress';
            if (!phs[idx].workPeriods) phs[idx].workPeriods = [];
            phs[idx].workPeriods.push({ start: new Date(), end: null, operatorId: opId });
            
            const up = { ...data, phases: updatePhasesMaterialReadiness(phs), status: 'production' as const, overallStartTime: data.overallStartTime || new Date() };
            t.update(itemRef, up);
            if (isGroup) await propagateGroupUpdatesToJobs(t, up as any);
            t.update(opRef, { activeJobId: jobId, activePhaseName: phs[idx].name, stato: 'attivo' });
            
            return { success: true, message: 'Fase avviata.' };
        });
    } catch (e) { 
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'avvio.' }; 
    }
}

export async function isOperatorActiveOnAnyJob(opId: string, currentId?: string) {
    if (!opId) return { available: true };
    const snap = await getDoc(doc(db, "operators", opId));
    if (!snap.exists()) return { available: true };
    const op = snap.data() as Operator;
    if (!op.activeJobId || (currentId && op.activeJobId === currentId)) return { available: true };
    
    const isG = op.activeJobId.startsWith('group-');
    const jSnap = await getDoc(doc(db, isG ? 'workGroups' : 'jobOrders', op.activeJobId));
    let active = false;
    if (jSnap.exists()) {
        active = (jSnap.data().phases || []).some((p: any) => p.status === 'in-progress' && (p.workPeriods || []).some((wp: any) => wp.operatorId === opId && wp.end === null));
    }
    if (!active) await updateOperatorStatus(opId, null, null);
    return { available: !active, activeJobId: active ? op.activeJobId : null, activePhaseName: active ? op.activePhaseName : null };
}

export async function startMaterialSessionInJob(itemId: string, phaseId: string, cons: MaterialConsumption) {
    const isGroup = itemId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', itemId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Non trovato.");
            const item = snap.data() as JobOrder;
            const phs = (item.phases || []).map(p => p.id === phaseId ? { ...p, materialConsumptions: [...(p.materialConsumptions || []), cons], materialReady: true } : p);
            t.update(itemRef, { phases: phs });
            if (isGroup) await propagateGroupUpdatesToJobs(t, { ...item, phases: phs } as any);
        });
        return { success: true, message: 'Sessione avviata.' };
    } catch (e) { 
        return { success: false, message: e instanceof Error ? e.message : 'Errore.' }; 
    }
}

export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
  if (!opId) return;
  await updateDoc(doc(db, 'operators', opId), { activeMaterialSessions: sessions || [] });
}

export async function postponeQualityPhase(jobId: string, phaseId: string, currentState: 'default' | 'postponed'): Promise<{ success: boolean; message: string }> {
    const isGroup = jobId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Non trovato.");
            const data = snap.data() as JobOrder;
            const phs = [...data.phases];
            const idx = phs.findIndex(p => p.id === phaseId);
            if (idx === -1) throw new Error("Fase non trovata.");
            
            if (currentState === 'default') {
                const lastProd = phs.filter(p => p.type === 'production').sort((a, b) => a.sequence - b.sequence).pop();
                phs[idx].sequence = lastProd ? lastProd.sequence + 0.1 : 99;
                phs[idx].postponed = true;
            } else {
                const tSnap = await t.get(doc(db, 'workPhaseTemplates', phaseId));
                phs[idx].sequence = tSnap.exists() ? tSnap.data().sequence : 1;
                delete phs[idx].postponed;
            }
            
            const up = { phases: updatePhasesMaterialReadiness(phs) };
            t.update(itemRef, up);
            if (isGroup) {
                const gData = snap.data() as WorkGroup;
                (gData.jobOrderIds || []).forEach(id => t.update(doc(db, 'jobOrders', id), up));
            }
        });
        revalidatePath('/scan-job');
        return { success: true, message: 'Operazione completata.' };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function createWorkGroup(jobIds: string[], opId: string): Promise<{ success: boolean; workGroupId?: string; message?: string }> {
    if (!jobIds || jobIds.length < 2) return { success: false, message: 'Selezionare almeno 2 commesse.' };
    try {
        return await runTransaction(db, async (t) => {
            const opSnap = await t.get(doc(db, 'operators', opId));
            const jobSnaps = await Promise.all(jobIds.map(id => t.get(doc(db, 'jobOrders', id))));
            
            const jobs = jobSnaps.map(s => convertTimestampsToDates(s.data()) as JobOrder);
            const first = jobs[0];
            const totalQta = jobs.reduce((sum, j) => sum + j.qta, 0);
            
            const groupRef = doc(collection(db, 'workGroups'));
            const groupData: WorkGroup = {
                id: groupRef.id,
                jobOrderIds: jobIds,
                jobOrderPFs: jobs.map(j => j.ordinePF),
                status: 'paused',
                createdAt: new Date(),
                createdBy: opSnap.data()?.nome || 'Operatore',
                totalQuantity: totalQta,
                workCycleId: first.workCycleId || '',
                department: first.department,
                cliente: first.cliente,
                phases: JSON.parse(JSON.stringify(first.phases)), // Copy structure
                details: first.details,
            };
            
            t.set(groupRef, JSON.parse(JSON.stringify(groupData)));
            jobIds.forEach(id => t.update(doc(db, 'jobOrders', id), { workGroupId: groupRef.id, status: 'paused' }));
            
            return { success: true, workGroupId: groupRef.id };
        });
    } catch (e) { return { success: false, message: e instanceof Error ? e.message : 'Errore.' }; }
}

export async function reportMaterialMissing(itemId: string, phaseId: string, uid: string, notes?: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const collectionName = isGroup ? 'workGroups' : 'jobOrders';
  const itemRef = doc(db, collectionName, itemId);

  try {
    await runTransaction(db, async (t) => {
      const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(doc(db, 'operators', uid))]);
      if (!snap.exists()) throw new Error("Non trovato.");
      
      const itemData = snap.data() as JobOrder;
      const phases = [...itemData.phases];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);
      if (phaseIndex === -1) throw new Error("Fase non trovata.");
      
      phases[phaseIndex].materialStatus = 'missing';
      phases[phaseIndex].materialReady = false;

      const up = { phases, isProblemReported: true, problemType: 'MANCA_MATERIALE' as const, problemReportedBy: opSnap.data()?.nome || 'Admin', problemNotes: notes || '' };
      t.update(itemRef, up);
      if (isGroup) {
        (itemData.jobOrderIds || []).forEach(id => t.update(doc(db, 'jobOrders', id), up));
      }
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Segnalato.' };
  } catch (e) {
    return { success: false, message: "Errore." };
  }
}

export async function dissolveWorkGroup(groupId: string, forceComplete: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    const groupRef = doc(db, 'workGroups', groupId);
    
    await runTransaction(db, async (transaction) => {
        const groupSnap = await transaction.get(groupRef);

        if (!groupSnap.exists()) {
          throw new Error("Gruppo di lavoro non trovato.");
        }
        
        const groupData = groupSnap.data() as WorkGroup;
        const jobOrderIds = groupData.jobOrderIds || [];
        
        if (jobOrderIds.length === 0) {
            transaction.delete(groupRef);
            return;
        }

        const jobRefs = jobOrderIds.map(id => doc(db, 'jobOrders', id));
        const jobDocs = await Promise.all(jobRefs.map(ref => transaction.get(ref)));
        
        const isGroupCompleted = forceComplete;

        for (const jobDoc of jobDocs) {
             if (!jobDoc.exists()) continue;
             
             const newPhasesForJob: JobPhase[] = JSON.parse(JSON.stringify(groupData.phases));
             for (const phase of newPhasesForJob) {
                phase.materialConsumptions = [];
             }

             const finalStatus = isGroupCompleted ? 'completed' : 'paused';
                
             transaction.update(jobDoc.ref, { 
                workGroupId: deleteField(),
                phases: newPhasesForJob,
                status: finalStatus,
                overallStartTime: groupData.overallStartTime || null,
                overallEndTime: isGroupCompleted ? (groupData.overallEndTime || new Date()) : null, 
                isProblemReported: groupData.isProblemReported || false,
                problemType: groupData.problemType || deleteField(),
                problemNotes: groupData.problemNotes || deleteField(),
                problemReportedBy: groupData.problemReportedBy || deleteField(),
            });
        }
        transaction.delete(groupRef);
    });

    revalidatePath('/admin/work-group-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    
    return { success: true, message: `Gruppo sciolto.` };
  } catch (error) {
    return { success: false, message: "Errore." };
  }
}
