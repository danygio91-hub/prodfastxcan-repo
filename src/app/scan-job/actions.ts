'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, setDoc, getDocs, query as firestoreQuery, where, updateDoc, orderBy, limit, runTransaction, Timestamp, deleteField, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, RawMaterial, MaterialConsumption, WorkGroup, Operator, MaterialWithdrawal, ActiveMaterialSessionData, InventoryRecord } from '@/lib/mock-data';
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
        const itemRef = doc(db, isGroup ? "workGroups" : "jobOrders", jobId);
        
        await updateDoc(itemRef, {
            isProblemReported: false,
            problemType: deleteField(),
            problemNotes: deleteField(),
            problemReportedBy: deleteField()
        });

        if (isGroup) {
            const gSnap = await getDoc(itemRef);
            if (gSnap.exists()) {
                const gData = gSnap.data() as WorkGroup;
                const batch = writeBatch(db);
                (gData.jobOrderIds || []).forEach(id => {
                    batch.update(doc(db, "jobOrders", id), {
                        isProblemReported: false,
                        problemType: deleteField(),
                        problemNotes: deleteField(),
                        problemReportedBy: deleteField()
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
        for (let i_prev = i - 1; i_prev >= 0; i_prev--) { if (!sorted[i_prev].isIndependent) { prev = sorted[i_prev]; break; } }
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
        return { success: true, message: 'Gruppo aggiornata.' };
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

export async function updateOperatorMaterialSessions(opId: string, sessions: ActiveMaterialSessionData[]) {
    await updateDoc(doc(db, "operators", opId), { activeMaterialSessions: sessions });
    return { success: true };
}

export async function closeMaterialSessionAndUpdateStock(session: ActiveMaterialSessionData, closingGrossWeight: number, opId: string) {
    try {
        await runTransaction(db, async (transaction) => {
            const materialRef = doc(db, 'rawMaterials', session.materialId);
            const matSnap = await transaction.get(materialRef);
            if (!matSnap.exists()) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;

            const consumedWeight = session.grossOpeningWeight - closingGrossWeight;
            if (consumedWeight < -0.001) throw new Error("Il peso di chiusura non può essere superiore a quello di apertura.");

            let unitsConsumed = 0;
            if (material.unitOfMeasure === 'kg') {
                unitsConsumed = consumedWeight;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
                unitsConsumed = consumedWeight / material.conversionFactor;
            }

            transaction.update(materialRef, {
                currentStockUnits: (material.currentStockUnits || 0) - unitsConsumed,
                currentWeightKg: (material.currentWeightKg || 0) - consumedWeight
            });

            const withdrawalRef = doc(collection(db, "materialWithdrawals"));
            transaction.set(withdrawalRef, {
                jobIds: session.associatedJobs.map(j => j.jobId),
                jobOrderPFs: session.associatedJobs.map(j => j.jobOrderPF),
                materialId: session.materialId,
                materialCode: session.materialCode,
                consumedWeight,
                consumedUnits: unitsConsumed,
                operatorId: opId,
                withdrawalDate: Timestamp.now(),
                lotto: session.lotto || null,
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
        await runTransaction(db, async (t) => {
            const mRef = doc(db, "rawMaterials", materialId as string);
            const mSnap = await t.get(mRef);
            if (!mSnap.exists()) throw new Error("Materiale non trovato.");
            const material = mSnap.data() as RawMaterial;
            
            let units = 0;
            let weight = 0;
            const q = Number(quantity);

            if (unit === 'kg') {
                weight = q;
                units = (material.conversionFactor && material.conversionFactor > 0) ? q / material.conversionFactor : q;
            } else {
                units = q;
                weight = (material.conversionFactor && material.conversionFactor > 0) ? q * material.conversionFactor : 0;
            }

            t.update(mRef, { 
                currentStockUnits: (material.currentStockUnits || 0) - units, 
                currentWeightKg: (material.currentWeightKg || 0) - weight 
            });

            const wRef = doc(collection(db, "materialWithdrawals"));
            t.set(wRef, {
                jobIds: [jobId],
                jobOrderPFs: [jobOrderPF],
                materialId,
                materialCode: material.code,
                consumedWeight: weight,
                consumedUnits: units,
                operatorId,
                withdrawalDate: Timestamp.now(),
                lotto: lotto || null,
            });
        });
        return { success: true, message: "Scarico registrato." };
    } catch (e) { return { success: false, message: "Errore scarico." }; }
}

export async function findLastWeightForLotto(materialId: string | undefined, lotto: string): Promise<any> {
    const q = firestoreQuery(collection(db, "inventoryRecords"), where("lotto", "==", lotto), where("status", "==", "approved"), orderBy("recordedAt", "desc"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const rec = snap.docs[0].data() as InventoryRecord;
        const mSnap = await getDoc(doc(db, "rawMaterials", rec.materialId));
        return { material: mSnap.exists() ? { ...mSnap.data(), id: mSnap.id } : null, netWeight: rec.netWeight, packagingId: rec.packagingId };
    }
    return null;
}

export async function createWorkGroup(jobIds: string[], creatorId: string) {
    try {
        const batch = writeBatch(db);
        const newGroupId = `group-${Date.now()}`;
        const groupRef = doc(db, "workGroups", newGroupId);
        
        const jobSnaps = await Promise.all(jobIds.map(id => getDoc(doc(db, "jobOrders", id))));
        const jobs = jobSnaps.map(s => ({ ...s.data(), id: s.id } as JobOrder));
        
        const firstJob = jobs[0];
        if (!firstJob) throw new Error("Nessuna commessa valida.");

        const totalQty = jobs.reduce((sum, j) => sum + j.qta, 0);
        const jobPFs = jobs.map(j => j.ordinePF);
        
        const newGroup: any = {
            id: newGroupId,
            jobOrderIds: jobIds,
            jobOrderPFs: jobPFs,
            status: 'production',
            createdAt: Timestamp.now(),
            createdBy: creatorId,
            totalQuantity: totalQty,
            workCycleId: firstJob.workCycleId || '',
            department: firstJob.department,
            cliente: firstJob.cliente,
            details: firstJob.details,
            phases: firstJob.phases.map(p => ({ ...p, status: 'pending', workPeriods: [], materialConsumptions: [] })),
            numeroODLInterno: firstJob.numeroODLInterno || null,
            dataConsegnaFinale: firstJob.dataConsegnaFinale || '',
        };

        batch.set(groupRef, newGroup);
        jobIds.forEach(id => batch.update(doc(db, "jobOrders", id), { workGroupId: newGroupId }));
        
        await batch.commit();
        revalidatePath('/admin/work-group-management');
        revalidatePath('/admin/production-console');
        return { success: true, workGroupId: newGroupId };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : "Errore creazione gruppo." };
    }
}