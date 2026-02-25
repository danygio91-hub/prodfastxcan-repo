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
  if (snap.empty) return { error: `Materia prima non trovata.`, title: 'Materiale non Trovato' };
  const material = { ...snap.docs[0].data(), id: snap.docs[0].id } as RawMaterial;
  return JSON.parse(JSON.stringify(material));
}

async function propagateGroupUpdatesToJobs(transaction: any, groupData: WorkGroup) {
    if (!groupData.jobOrderIds || groupData.jobOrderIds.length === 0) return;
    const updatePayload = { phases: groupData.phases || [], status: groupData.status };
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
            id: group.id, 
            cliente: group.cliente, 
            qta: group.totalQuantity, 
            department: group.department, 
            details: group.details, 
            ordinePF: group.jobOrderPFs?.join(', ') || 'Gruppo', 
            numeroODL: group.numeroODL || 'N/D', 
            numeroODLInterno: group.numeroODLInterno || 'N/D', 
            dataConsegnaFinale: group.dataConsegnaFinale || 'N/D', 
            postazioneLavoro: 'Multi-Commessa', 
            phases: group.phases || [], 
            overallStartTime: group.overallStartTime, 
            overallEndTime: group.overallEndTime, 
            isProblemReported: group.isProblemReported, 
            problemType: group.problemType, 
            problemNotes: group.problemNotes, 
            problemReportedBy: group.problemReportedBy, 
            status: group.status, 
            workCycleId: group.workCycleId, 
            workGroupId: group.id, 
            jobOrderIds: group.jobOrderIds, 
            jobOrderPFs: group.jobOrderPFs 
        };
    }
    return data as JobOrder;
}

export async function verifyAndGetJobOrder(scannedData: { ordinePF: string; codice: string; qta: string; }): Promise<JobOrder | { error: string; title?: string }> {
  const sanitizedId = (scannedData.ordinePF || '').replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
  if (!sanitizedId) return { error: 'ID Commessa non valido.', title: 'Errore' };
  const snap = await getDoc(doc(db, "jobOrders", sanitizedId));
  if (!snap.exists()) return { error: `Commessa non trovata.`, title: 'Errore' };
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
    if (!job || !job.id) return { success: false, message: 'Dati incompleti.' };
    const updated = updatePhasesMaterialReadiness(job.phases || []);
    job.phases = updated;
    if (updated.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped') && !job.isProblemReported) {
        job.status = 'completed';
        if (!job.overallEndTime) job.overallEndTime = new Date();
    }
    await setDoc(doc(db, "jobOrders", job.id), JSON.parse(JSON.stringify(job)), { merge: true });
    revalidatePath('/scan-job');
    return { success: true, message: 'Aggiornata.' };
}

export async function updateWorkGroup(group: WorkGroup, opId: string) {
    if (!group || !group.id) return { success: false, message: 'Dati incompleti.' };
    const phases = group.phases || [];
    if (phases.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped') && !group.isProblemReported) {
        return await dissolveWorkGroup(group.id, true);
    }
    group.status = phases.some(p => p.status === 'in-progress') ? 'production' : 'paused';
    await runTransaction(db, async (t) => {
        const groupRef = doc(db, "workGroups", group.id);
        t.set(groupRef, JSON.parse(JSON.stringify(group)), { merge: true });
        await propagateGroupUpdatesToJobs(t, group);
    });
    revalidatePath('/scan-job');
    return { success: true, message: 'Gruppo aggiornato.' };
}

export async function resolveJobProblem(jobId: string, uid: string) {
    await ensureAdmin(uid);
    if (!jobId || typeof jobId !== 'string') return { success: false, message: 'ID non valido.' };
    const isG = jobId.startsWith('group-');
    await runTransaction(db, async (t) => {
        const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
        const snap = await t.get(itemRef);
        if (!snap.exists()) throw new Error("Non trovato.");
        
        const up: any = { isProblemReported: false, problemType: deleteField(), problemNotes: deleteField(), problemReportedBy: deleteField() };
        t.update(itemRef, up);
        if (isG) {
            const data = snap.data() as WorkGroup;
            data.jobOrderIds?.forEach((id: string) => {
                if (id) t.update(doc(db, 'jobOrders', id), up);
            });
        }
    });
    revalidatePath('/scan-job');
    return { success: true, message: 'Risolto.' };
}

export async function closeMaterialSessionAndUpdateStock(session: ActiveMaterialSessionData, closing: number, opId: string) {
  if (!session || !opId) return { success: false, message: 'Dati sessione o operatore mancanti.' };
  
  try {
    const mRef = doc(db, "rawMaterials", session.materialId);
    const opRef = doc(db, "operators", opId);
    
    // COLLECT ALL REFS BEFORE STARTING TRANSACTION
    const affectedRefs: any[] = [];
    if (session.originatorJobId) {
        const isG = session.originatorJobId.startsWith('group-');
        affectedRefs.push(doc(db, isG ? 'workGroups' : 'jobOrders', session.originatorJobId));
    }
    (session.associatedJobs || []).forEach(j => {
        if (j.jobId && j.jobId !== session.originatorJobId) {
            affectedRefs.push(doc(db, 'jobOrders', j.jobId));
        }
    });

    await runTransaction(db, async (t) => {
        // ALL READS FIRST
        const [mSnap, opSnap, ...jobSnaps] = await Promise.all([
            t.get(mRef), 
            t.get(opRef),
            ...affectedRefs.map(ref => t.get(ref))
        ]);
        
        if (!mSnap.exists()) throw new Error("Materia prima non trovata.");
        const mat = mSnap.data() as RawMaterial;
        const operatorName = opSnap.exists() ? opSnap.data().nome : 'Sconosciuto';

        const consumedWeight = (session.grossOpeningWeight || 0) - (closing || 0);
        if (consumedWeight < -0.001) throw new Error("Il peso finale è superiore all'apertura.");
        
        let consumedUnits = mat.unitOfMeasure === 'kg' ? consumedWeight : (mat.conversionFactor && mat.conversionFactor > 0 ? consumedWeight / mat.conversionFactor : 0);
        
        const wRef = doc(collection(db, "materialWithdrawals"));
        const jobPFs = (session.associatedJobs || []).map(j => j.jobOrderPF).filter(Boolean) as string[];
        const jobIds = (session.associatedJobs || []).map(j => j.jobId).filter(Boolean) as string[];

        // ALL WRITES AFTER
        t.set(wRef, { 
            jobIds, 
            jobOrderPFs: jobPFs, 
            materialId: session.materialId, 
            materialCode: session.materialCode, 
            consumedWeight, 
            consumedUnits, 
            operatorId: opId, 
            operatorName, 
            withdrawalDate: Timestamp.now(), 
            lotto: session.lotto || null 
        });
        
        t.update(mRef, { 
            currentWeightKg: (mat.currentWeightKg || 0) - consumedWeight, 
            currentStockUnits: (mat.currentStockUnits || 0) - consumedUnits 
        });
        
        const updatePhasesConsumptions = (phases: JobPhase[]) => (phases || []).map(p => ({
            ...p,
            materialConsumptions: (p.materialConsumptions || []).map(mc => {
                const matchesMaterial = mc.materialId === session.materialId;
                const matchesLotto = mc.lottoBobina === session.lotto || (!mc.lottoBobina && !session.lotto);
                if (matchesMaterial && matchesLotto && mc.closingWeight === undefined) {
                    return { ...mc, closingWeight: closing, withdrawalId: wRef.id };
                }
                return mc;
            })
        }));

        jobSnaps.forEach(snap => {
            if (snap.exists()) {
                const data = snap.data() as JobOrder;
                t.update(snap.ref, { phases: updatePhasesConsumptions(data.phases) });
            }
        });
    });
    
    revalidatePath('/scan-job');
    return { success: true, message: 'Sessione chiusa correttamente.' };
  } catch (e) { 
      console.error("Closure error:", e);
      return { success: false, message: e instanceof Error ? e.message : 'Errore durante la chiusura.' }; 
  }
}

export async function logTubiGuainaWithdrawal(formData: FormData) {
  const data = Object.fromEntries(formData.entries());
  const jobId = data.jobId as string;
  const materialId = data.materialId as string;
  const operatorId = data.operatorId as string;
  const phaseId = data.phaseId as string;
  
  if (!jobId || !materialId || !operatorId) return { success: false, message: 'Dati incompleti.' };
  
  const isG = jobId.startsWith('group-');
  try {
    await runTransaction(db, async (t) => {
        // ALL READS FIRST
        const [mSnap, itemSnap, opSnap] = await Promise.all([
            t.get(doc(db, "rawMaterials", materialId)),
            t.get(doc(db, isG ? 'workGroups' : 'jobOrders', jobId)),
            t.get(doc(db, "operators", operatorId))
        ]);
        
        if (!mSnap.exists()) throw new Error("Materia prima non trovata.");
        if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato.");
        
        const mat = mSnap.data() as RawMaterial;
        const item = itemSnap.data() as JobOrder;
        const qty = Number(data.quantity);
        if (isNaN(qty) || qty <= 0) throw new Error("Quantità non valida.");

        let consumedWeight = data.unit === 'kg' ? qty : (mat.conversionFactor ? qty * mat.conversionFactor : 0);
        let consumedUnits = data.unit === 'kg' ? (mat.conversionFactor && mat.conversionFactor > 0 ? qty / mat.conversionFactor : qty) : qty;
        
        // ALL WRITES AFTER
        t.update(doc(db, "rawMaterials", mat.id), { 
            currentStockUnits: (mat.currentStockUnits || 0) - consumedUnits, 
            currentWeightKg: (mat.currentWeightKg || 0) - consumedWeight 
        });
        
        const wRef = doc(collection(db, "materialWithdrawals"));
        const jobPFs = isG ? (item as any).jobOrderPFs || [] : [(data.jobOrderPF as string) || item.ordinePF || 'N/D'];
        const jobIds = isG ? (item as any).jobOrderIds || [] : [jobId];
        
        t.set(wRef, { 
            jobIds: jobIds.filter(Boolean), 
            jobOrderPFs: jobPFs.filter(Boolean), 
            materialId: mat.id, 
            materialCode: mat.code, 
            consumedWeight, 
            consumedUnits, 
            operatorId: operatorId, 
            operatorName: opSnap.exists() ? opSnap.data().nome : 'Sconosciuto', 
            withdrawalDate: Timestamp.now(), 
            lotto: (data.lotto as string) || null 
        });
        
        const phases = [...(item.phases || [])];
        const pIdx = phases.findIndex(p => p.id === phaseId);
        if (pIdx !== -1) {
            const mc = phases[pIdx].materialConsumptions || [];
            phases[pIdx].materialConsumptions = [...mc, { withdrawalId: wRef.id, materialId: mat.id, materialCode: mat.code, pcs: consumedUnits }];
            if (phases[pIdx].type === 'preparation') phases[pIdx].materialReady = true;
            t.update(itemSnap.ref, { phases });
            if (isG) await propagateGroupUpdatesToJobs(t, { ...item, phases } as any);
        }
    });
    revalidatePath('/scan-job');
    return { success: true, message: 'Scarico registrato con successo.' };
  } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore registrazione prelievo.' }; 
  }
}

export async function findLastWeightForLotto(matId: string | undefined, lotto: string) {
    if (!lotto) return null;
    const allMats = (await getDocs(collection(db, "rawMaterials"))).docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial));
    let mat = matId ? allMats.find(m => m.id === matId) : allMats.find(m => (m.batches || []).some(b => b.lotto === lotto));
    if (!mat) return null;
    
    const jSnap = await getDocs(collection(db, "jobOrders"));
    const consumptions: any[] = [];
    jSnap.forEach(d => {
        const job = convertTimestampsToDates(d.data()) as JobOrder;
        (job.phases || []).forEach(p => (p.materialConsumptions || []).forEach(c => {
            if (c.materialId === mat!.id && c.lottoBobina === lotto && c.closingWeight !== undefined) {
                const last = (p.workPeriods || []).reduce((lat, wp) => wp.end && (!lat || new Date(wp.end) > lat) ? new Date(wp.end) : lat, null as Date | null);
                if (last) consumptions.push({ closingWeight: c.closingWeight, tareWeight: c.tareWeight || 0, packagingId: c.packagingId || 'none', completedAt: last });
            }
        }));
    });
    
    if (consumptions.length > 0) {
        const last = consumptions.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0];
        return { grossWeight: last.closingWeight, netWeight: last.closingWeight - last.tareWeight, packagingId: last.packagingId, isInitialLoad: false, material: mat };
    }
    const batch = (mat.batches || []).find(b => b.lotto === lotto);
    if (batch) return { grossWeight: batch.grossWeight, netWeight: batch.grossWeight - batch.tareWeight, packagingId: batch.packagingId || 'none', isInitialLoad: true, material: mat };
    return { grossWeight: 0, netWeight: 0, packagingId: 'none', isInitialLoad: false, material: mat };
}

export async function handlePhaseScanResult(jobId: string, phaseId: string, opId: string) {
    if (!jobId || !phaseId || !opId) return { success: false, message: 'Dati scansione incompleti.' };
    const isG = jobId.startsWith('group-');
    
    const avail = await isOperatorActiveOnAnyJob(opId, isG ? jobId : undefined);
    if (!avail.available) return { success: false, message: "Operatore occupato.", error: 'OPERATOR_BUSY' };
    
    await runTransaction(db, async (t) => {
        const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', jobId);
        const snap = await t.get(itemRef);
        if (!snap.exists()) throw new Error("Item non trovato.");
        
        const data = convertTimestampsToDates(snap.data()) as JobOrder;
        const phases = [...(data.phases || [])].sort((a, b) => a.sequence - b.sequence);
        const pIdx = phases.findIndex(p => p.id === phaseId);
        if (pIdx === -1) throw new Error("Fase non trovata.");
        
        const phase = phases[pIdx];
        phase.status = 'in-progress';
        if (!phase.workPeriods) phase.workPeriods = [];
        phase.workPeriods.push({ start: new Date(), end: null, operatorId: opId });
        
        const upData = { 
            ...data, 
            phases: updatePhasesMaterialReadiness(phases), 
            status: 'production' as const, 
            overallStartTime: data.overallStartTime || new Date() 
        };
        
        t.update(itemRef, upData);
        if (isG) await propagateGroupUpdatesToJobs(t, upData as any);
        await updateOperatorStatus(opId, jobId, phase.name);
    });
    revalidatePath('/scan-job');
    return { success: true, message: 'Avviata.' };
}

export async function isOperatorActiveOnAnyJob(opId: string, currentGroupId?: string) {
    if (!opId) return { available: true };
    const snap = await getDoc(doc(db, "operators", opId));
    if (!snap.exists()) return { available: true };
    const op = snap.data() as Operator;
    if (!op.activeJobId || (currentGroupId && op.activeJobId === currentGroupId)) return { available: true };
    const isG = op.activeJobId.startsWith('group-');
    const jSnap = await getDoc(doc(db, isG ? 'workGroups' : 'jobOrders', op.activeJobId));
    let stillAct = false;
    if (jSnap.exists()) {
        stillAct = (jSnap.data().phases || []).some((p: any) => p.status === 'in-progress' && (p.workPeriods || []).some((wp: any) => wp.operatorId === opId && wp.end === null));
    }
    if (stillAct) return { available: false, activeJobId: op.activeJobId, activePhaseName: op.activePhaseName };
    await updateOperatorStatus(opId, null, null);
    return { available: true };
}

export async function startMaterialSessionInJob(itemId: string, phaseId: string, consumption: MaterialConsumption) {
    if (!itemId || !phaseId) return { success: false, message: 'Dati mancanti.' };
    const isG = itemId.startsWith('group-');
    try {
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', itemId);
            const snap = await t.get(itemRef);
            if (!snap.exists()) throw new Error("Commessa o Gruppo non trovato.");
            
            const item = snap.data() as JobOrder;
            const phases = (item.phases || []).map(p => p.id === phaseId ? { ...p, materialConsumptions: [...(p.materialConsumptions || []), consumption], materialReady: true } : p);
            
            t.update(itemRef, { phases });
            if (isG) await propagateGroupUpdatesToJobs(t, { ...item, phases } as any);
        });
        revalidatePath('/scan-job');
        return { success: true, message: 'Sessione avviata.' };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore avvio sessione.' };
    }
}

export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
  if (!opId) return;
  await updateDoc(doc(db, 'operators', opId), { activeMaterialSessions: sessions || [] });
  return { success: true, message: 'OK' };
}

export async function reportMaterialMissing(itemId: string, phaseId: string, uid: string, notes?: string) {
  if (!itemId || !uid) return { success: false, message: 'Dati mancanti.' };
  const isG = itemId.startsWith('group-');
  try {
    await runTransaction(db, async (t) => {
        const itemRef = doc(db, isG ? 'workGroups' : 'jobOrders', itemId);
        const opRef = doc(db, "operators", uid);
        
        const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(opRef)]);
        
        if (!snap.exists()) throw new Error("Commessa o Gruppo non trovato.");
        const item = snap.data() as JobOrder;
        const phases = [...(item.phases || [])];
        const pIdx = phases.findIndex(p => p.id === phaseId);
        if (pIdx === -1) throw new Error("Fase non trovata.");
        
        phases[pIdx].materialStatus = 'missing';
        phases[pIdx].materialReady = false;
        
        const up: any = { phases, isProblemReported: true, problemType: 'MANCA_MATERIALE', problemReportedBy: opSnap.data()?.nome || 'Admin', problemNotes: notes || '' };
        
        if (phases[pIdx].status === 'in-progress') {
            const wpIdx = (phases[pIdx].workPeriods || []).findIndex(wp => wp.operatorId === uid && wp.end === null);
            if (wpIdx !== -1) phases[pIdx].workPeriods[wpIdx].end = new Date();
            if (!(phases[pIdx].workPeriods || []).some(wp => wp.end === null)) phases[pIdx].status = 'paused';
            up.status = phases.some(p => p.status === 'in-progress') ? 'production' : 'paused';
            t.update(opRef, { activeJobId: null, activePhaseName: null, stato: 'inattivo' });
        }
        
        t.update(itemRef, up);
        if (isG) await propagateGroupUpdatesToJobs(t, { ...item, ...up } as any);
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Segnalato.' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Errore.' };
  }
}

export async function searchRawMaterials(term: string, types?: RawMaterialType[]) {
  const snap = await getDocs(firestoreQuery(collection(db, "rawMaterials"), where("type", "in", types || ["BOB", "TUBI", "PF3V0", "GUAINA", "BARRA"])));
  const termL = (term || '').toLowerCase().trim();
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial)).filter(m => m.code.toLowerCase().includes(termL) || m.description.toLowerCase().includes(termL)).slice(0, 10);
}

export async function createWorkGroup(ids: string[], opId: string) {
    if (!ids || ids.length < 2) return { success: false, message: 'Selezionare almeno due commesse.' };
    const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'jobOrders', id))));
    const jobs = docs.map(d => d.data() as JobOrder);
    const first = jobs[0];
    const gId = `group-${Date.now()}`;
    const group: WorkGroup = { 
        id: gId, 
        jobOrderIds: ids, 
        jobOrderPFs: jobs.map(j => j.ordinePF), 
        status: 'production', 
        createdAt: new Date(), 
        createdBy: opId, 
        totalQuantity: jobs.reduce((s, j) => s + j.qta, 0), 
        workCycleId: first.workCycleId || '', 
        department: first.department, 
        cliente: first.cliente, 
        phases: first.phases, 
        details: 'Multi-Commessa', 
        numeroODLInterno: [...new Set(jobs.map(j => j.numeroODLInterno))].join(', '), 
        numeroODL: [...new Set(jobs.map(j => j.numeroODL))].join(', '), 
        dataConsegnaFinale: first.dataConsegnaFinale, 
        ordinePF: jobs.map(j => j.ordinePF).join(', ') 
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'workGroups', gId), group);
    docs.forEach(d => batch.update(d.ref, { workGroupId: gId }));
    await batch.commit();
    return { success: true, message: 'Creato.', workGroupId: gId };
}

export async function postponeQualityPhase(jobId: string, phaseId: string, currentState: 'default' | 'postponed') {
    if (!jobId || !phaseId) return { success: false, message: 'Dati mancanti.' };
    try {
        return await runTransaction(db, async (t) => {
            const itemRef = doc(db, jobId.startsWith('group-') ? 'workGroups' : 'jobOrders', jobId);
            const tRef = doc(db, 'workPhaseTemplates', phaseId);
            
            const [snap, tSnap] = await Promise.all([t.get(itemRef), t.get(tRef)]);
            
            if (!snap.exists()) throw new Error("Non trovato.");
            const data = snap.data() as JobOrder;
            const phases = [...(data.phases || [])];
            const pIdx = phases.findIndex(p => p.id === phaseId);
            if (pIdx === -1) throw new Error("Fase non trovata.");
            
            const isPostponed = currentState === 'postponed';
            if (!isPostponed) {
                const lastProd = phases.filter(p => p.type === 'production').sort((a,b) => a.sequence - b.sequence).pop();
                phases[pIdx].sequence = lastProd ? lastProd.sequence + 0.1 : 99;
                phases[pIdx].postponed = true;
            } else {
                phases[pIdx].sequence = tSnap.exists() ? tSnap.data().sequence : 1;
                delete phases[pIdx].postponed;
            }
            
            const up = { phases: updatePhasesMaterialReadiness(phases) };
            
            t.update(itemRef, up);
            if (jobId.startsWith('group-')) {
                (data as any).jobOrderIds?.forEach((id: string) => {
                    if (id) t.update(doc(db, 'jobOrders', id), up);
                });
            }
            return { success: true, message: 'Aggiornata.' };
        });
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore.' };
    }
}
