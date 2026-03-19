
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, getDocs, query as firestoreQuery, where, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, MaterialConsumption, WorkGroup, Operator, MaterialWithdrawal } from '@/lib/mock-data';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';

export { dissolveWorkGroup };

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

export async function getJobOrderById(id: string): Promise<JobOrder | null> {
    if (!id || typeof id !== 'string') return null;
    const isGroup = id.startsWith('group-');
    const snap = await getDoc(doc(db, isGroup ? 'workGroups' : 'jobOrders', id));
    if (!snap.exists()) return null;
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
  const snap = await getDoc(doc(db, "jobOrders", sanitizedId));
  if (!snap.exists()) return { error: `Commessa ${sanitizedId} non trovata.`, title: 'Errore' };
  const job = convertTimestampsToDates(snap.data()) as JobOrder;
  if (job.workGroupId) {
      const group = await getJobOrderById(job.workGroupId);
      if (group) return JSON.parse(JSON.stringify(group));
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
    if (job.id.startsWith('group-')) return { success: false, message: 'Tentativo di salvataggio errato.' };
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
    const isAnyActive = phases.some(p => p.status === 'in-progress');
    const isAnyPaused = phases.some(p => p.status === 'paused');
    if (phases.filter(p => !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped') && !group.isProblemReported) {
        return await dissolveWorkGroup(group.id, true);
    }
    group.status = isAnyActive ? 'production' : (isAnyPaused ? 'paused' : 'production');
    try {
        await updateDoc(doc(db, "workGroups", group.id), JSON.parse(JSON.stringify(group)));
        revalidatePath('/scan-job');
        return { success: true, message: 'Gruppo aggiornato.' };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function isOperatorActiveOnAnyJob(opId: string, currentJobId: string): Promise<{ available: boolean; activeJobId?: string | null; activePhaseName?: string | null }> {
    const docSnap = await getDoc(doc(db, "operators", opId));
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.activeJobId && data.activeJobId !== currentJobId) return { available: false, activeJobId: data.activeJobId, activePhaseName: data.activePhaseName };
    }
    return { available: true };
}

export async function handlePhaseScanResult(jobId: string, phaseId: string, opId: string) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    const snap = await getDoc(itemRef);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const phs = [...data.phases];
    const idx = phs.findIndex(p => p.id === phaseId);
    if (idx !== -1) {
        phs[idx].status = 'in-progress';
        phs[idx].workPeriods = [...(phs[idx].workPeriods || []), { start: new Date(), end: null, operatorId: opId }];
        await updateDoc(itemRef, { phases: phs, status: 'production', overallStartTime: data.overallStartTime || new Date() });
        await updateDoc(doc(db, 'operators', opId), { activeJobId: jobId, activePhaseName: phs[idx].name, stato: 'attivo' });
    }
}

export async function startMaterialSessionInJob(jobId: string, phaseId: string, consumption: MaterialConsumption) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    const snap = await getDoc(itemRef);
    if (!snap.exists()) return { success: false, message: 'Non trovato.' };
    const data = snap.data() as any;
    const phs = (data.phases || []).map((p: any) => p.id === phaseId ? { ...p, materialConsumptions: [...(p.materialConsumptions || []), consumption], materialReady: true } : p);
    await updateDoc(itemRef, { phases: phs });
    return { success: true, message: 'Sessione avviata.' };
}
