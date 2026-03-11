
'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, updateDoc, runTransaction, writeBatch, collection, getDocs, query as firestoreQuery, where, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, WorkGroup, MaterialWithdrawal, RawMaterial, WorkPhaseTemplate, Operator } from '@/lib/mock-data';
import { getProductionTimeAnalysisReport as fetchProductionTimeAnalysisReport } from '@/app/admin/reports/actions';

export type ProductionTimeData = {
    averageMinutesPerPiece: number;
    isTimeCalculationReliable: boolean;
    phases: Record<string, { averageMinutesPerPiece: number }>;
};

export async function getProductionTimeAnalysisMap(): Promise<Map<string, ProductionTimeData>> {
    const report = await fetchProductionTimeAnalysisReport();
    const analysisMap = new Map<string, ProductionTimeData>();

    for (const articleReport of report) {
        const phaseTimes: Record<string, { averageMinutesPerPiece: number }> = {};
        articleReport.averagePhaseTimes.forEach(phase => {
            if (phase.averageMinutesPerPiece > 0) {
                phaseTimes[phase.name] = { averageMinutesPerPiece: phase.averageMinutesPerPiece };
            }
        });

        analysisMap.set(articleReport.articleCode, {
            averageMinutesPerPiece: articleReport.averageMinutesPerPiece,
            isTimeCalculationReliable: report.some(r => r.jobs.some(j => j.isTimeCalculationReliable)),
            phases: phaseTimes,
        });
    }
    return analysisMap;
}

async function propagateGroupUpdatesToJobs(transaction: any, groupData: WorkGroup) {
    if (!groupData.jobOrderIds || groupData.jobOrderIds.length === 0) return;
    const updatePayload: { [key: string]: any } = {
        phases: groupData.phases,
        status: groupData.status,
    };
    const jobRefs = groupData.jobOrderIds.map(id => doc(db, 'jobOrders', id));
    jobRefs.forEach(jobRef => {
        transaction.update(jobRef, updatePayload);
    });
}

function updatePhasesMaterialReadiness(phases: JobPhase[]): JobPhase[] {
    const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
    const allPrepDone = sorted.filter(p => p.type === 'preparation' && !p.postponed).every(p => p.status === 'completed' || p.status === 'skipped');
    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        if (curr.isIndependent || curr.type === 'preparation') { curr.materialReady = true; continue; }
        if (!allPrepDone) { curr.materialReady = false; continue; }
        let prev: JobPhase | null = null;
        for (let j = i - 1; j >= 0; j--) { if (!sorted[j].isIndependent) { prev = sorted[j]; break; } }
        if (!prev) curr.materialReady = true;
        else curr.materialReady = ['in-progress', 'completed', 'skipped', 'paused'].includes(prev.status);
    }
    return sorted;
}

export async function forceFinishProduction(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists()) throw new Error('Elemento non trovato.');
        const item = snap.data() as JobOrder;
        const updatedPhases = item.phases.map(phase => {
          if (phase.type === 'production' && phase.status !== 'completed') {
            return { ...phase, status: 'completed' as const, forced: true };
          }
          return phase;
        });
        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        transaction.update(itemRef, { phases: finalPhases });
        if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...item, phases: finalPhases } as any);
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Produzione forzata.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function revertForceFinish(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(itemRef);
      if (!snap.exists()) throw new Error('Elemento non trovato.');
      const item = snap.data() as JobOrder;
      let updatedPhases = item.phases.map(phase => {
        if (phase.forced) {
          const { forced, ...rest } = phase;
          return { ...rest, status: 'pending' as const };
        }
        return phase;
      });
      updatedPhases = updatePhasesMaterialReadiness(updatedPhases);
      transaction.update(itemRef, { phases: updatedPhases });
      if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...item, phases: updatedPhases } as any);
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Annullata forzatura.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function toggleGuainaPhasePosition(itemId: string, phaseId: string, currentState: 'default' | 'postponed'): Promise<{ success: boolean; message: string }> {
  try {
    const isGroup = itemId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', itemId);
    const templateRef = doc(db, 'workPhaseTemplates', phaseId);
    await runTransaction(db, async (transaction) => {
        const [itemSnap, tSnap] = await Promise.all([transaction.get(itemRef), transaction.get(templateRef)]);
        if (!itemSnap.exists()) throw new Error('Non trovato.');
        const itemData = itemSnap.data() as JobOrder | WorkGroup;
        const updatedPhases = [...(itemData.phases || [])];
        const phaseIndex = updatedPhases.findIndex(p => p.id === phaseId);
        if (phaseIndex === -1) throw new Error('Fase non trovata.');
        if (currentState === 'default') {
          const lastProd = updatedPhases.filter(p => p.type === 'production').sort((a, b) => a.sequence - b.sequence).pop();
          updatedPhases[phaseIndex].sequence = lastProd ? lastProd.sequence + 0.1 : 99;
          updatedPhases[phaseIndex].postponed = true;
        } else {
          const tData = tSnap.exists() ? (tSnap.data() as WorkPhaseTemplate) : null;
          updatedPhases[phaseIndex].sequence = tData ? tData.sequence : 1;
          delete updatedPhases[phaseIndex].postponed;
        }
        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        transaction.update(itemRef, { phases: finalPhases });
        if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...itemData, phases: finalPhases } as WorkGroup);
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Posizione aggiornata.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function revertPhaseCompletion(jobId: string, phaseId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobRef = doc(db, 'jobOrders', jobId);
    await runTransaction(db, async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists()) throw new Error('Commessa non trovata.');
      const jobData = jobSnap.data() as JobOrder;
      const phases = [...(jobData.phases || [])];
      const idx = phases.findIndex(p => p.id === phaseId);
      if (idx === -1) throw new Error('Fase non trovata.');
      if (phases[idx].status !== 'completed') throw new Error('Fase non completata.');
      phases[idx].status = 'paused';
      phases[idx].qualityResult = null;
      const revertedPhases = updatePhasesMaterialReadiness(phases);
      transaction.update(jobRef, { phases: revertedPhases, status: 'production', overallEndTime: deleteField() });
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Fase riaperta.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function forcePauseOperators(jobId: string, operatorIdsToPause: string[], uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) throw new Error('Non trovato.');
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const updatedPhases = itemData.phases.map(phase => {
        if (phase.status === 'in-progress') {
          const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
            if (wp.end === null && operatorIdsToPause.includes(wp.operatorId)) {
              return { ...wp, end: new Date() };
            }
            return wp;
          });
          const isAnyoneStillWorking = updatedWorkPeriods.some(wp => wp.end === null);
          return { ...phase, workPeriods: updatedWorkPeriods, status: isAnyoneStillWorking ? 'in-progress' : 'paused' as const };
        }
        return phase;
      });
      const isAnyActive = updatedPhases.some(p => p.status === 'in-progress');
      const isAnyPaused = updatedPhases.some(p => p.status === 'paused');
      const newStatus = isAnyActive ? 'production' : (isAnyPaused ? 'paused' : 'production');
      
      transaction.update(itemRef, { phases: updatedPhases, status: newStatus });
      if (isGroup) {
        (itemData.jobOrderIds || []).forEach(id => {
            transaction.update(doc(db, 'jobOrders', id), { phases: updatedPhases, status: newStatus });
        });
      }
      operatorIdsToPause.forEach(opId => {
          transaction.update(doc(db, "operators", opId), { stato: 'inattivo', activeJobId: null, activePhaseName: null });
      });
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Operatori messi in pausa.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function forceCompleteJob(jobId: string, uid: string | undefined | null): Promise<{ success: boolean, message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists()) throw new Error("Non trovato.");
        transaction.update(itemRef, { status: 'completed', overallEndTime: Timestamp.now(), forcedCompletion: true });
        if (isGroup) {
            const data = snap.data() as WorkGroup;
            (data.jobOrderIds || []).forEach(id => transaction.update(doc(db, 'jobOrders', id), { status: 'completed', overallEndTime: Timestamp.now(), forcedCompletion: true }));
        }
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Chiusa.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function resetSingleCompletedJobOrder(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) throw new Error("Non trovata.");
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const jobIds = isGroup ? (itemData as WorkGroup).jobOrderIds : [jobId];
      const withdrawalsQuery = firestoreQuery(collection(db, "materialWithdrawals"), where("jobIds", "array-contains-any", jobIds || []));
      const wSnap = await getDocs(withdrawalsQuery);
      const matIds = [...new Set(wSnap.docs.map(d => d.data().materialId))].filter(Boolean) as string[];
      const matSnaps = await Promise.all(matIds.map(id => transaction.get(doc(db, 'rawMaterials', id))));
      const matMap = new Map(matSnaps.map(s => [s.id, s.data() as RawMaterial]));
      for (const wd of wSnap.docs) {
        const w = wd.data() as MaterialWithdrawal;
        const m = matMap.get(w.materialId);
        if (m) {
            transaction.update(doc(db, 'rawMaterials', w.materialId), { 
                currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight, 
                currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0) 
            });
        }
        transaction.delete(wd.ref);
      }
      if (isGroup) {
          const gData = itemData as WorkGroup;
          (gData.jobOrderIds || []).forEach(id => {
              const jRef = doc(db, 'jobOrders', id);
              const updatedPhases: JobPhase[] = (gData.phases || []).map(p => ({
                  ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null,
                  materialReady: p.isIndependent || p.type === 'preparation',
              }));
              transaction.update(jRef, { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: deleteField() });
          });
          transaction.delete(itemRef);
      } else {
          const jData = itemData as JobOrder;
          const updatedPhases: JobPhase[] = (jData.phases || []).map(p => ({
              ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null,
              materialReady: p.isIndependent || p.type === 'preparation',
          }));
          transaction.update(itemRef, { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: deleteField() });
      }
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Resettato.` };
  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function revertCompletion(itemId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', itemId);
  try {
      await runTransaction(db, async (transaction) => {
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists()) throw new Error("Non trovato.");
          const itemData = itemSnap.data() as JobOrder | WorkGroup;
          if (!itemData.forcedCompletion) throw new Error("Solo chiusure forzate riapribili.");
          const isAct = (itemData.phases || []).some(p => p.status === 'in-progress');
          const newStatus = isAct ? 'production' : 'paused';
          transaction.update(itemRef, { status: newStatus, overallEndTime: deleteField(), forcedCompletion: deleteField() });
          if (isGroup) {
              (itemData.jobOrderIds || []).forEach(id => {
                  transaction.update(doc(db, 'jobOrders', id), { status: newStatus, overallEndTime: deleteField(), forcedCompletion: deleteField() });
              });
          }
      });
      revalidatePath('/admin/production-console');
      return { success: true, message: "Riaperta." };
  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function updatePhasesForJob(jobId: string, phases: JobPhase[], uid: string): Promise<{ success: boolean, message: string }> {
  await ensureAdmin(uid);
  const isGroup = jobId.startsWith('group-');
  const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', jobId);
  const finalPhases = updatePhasesMaterialReadiness(phases.map((p, i) => ({ ...p, sequence: i + 1 })));
  try {
    await updateDoc(itemRef, { phases: finalPhases });
    if (isGroup) {
        const gSnap = await getDoc(itemRef);
        const gData = gSnap.data() as WorkGroup;
        const batch = writeBatch(db);
        (gData.jobOrderIds || []).forEach(id => batch.update(doc(db, 'jobOrders', id), { phases: finalPhases }));
        await batch.commit();
    }
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Fasi aggiornate.' };
  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function forceFinishMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  try {
      for (const id of jobIds) await forceFinishProduction(id, uid);
      return { success: true, message: 'Completato.' };
  } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function forceCompleteMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const batch = writeBatch(db);
  jobIds.forEach(id => {
      const isGroup = id.startsWith('group-');
      const collectionName = isGroup ? 'workGroups' : 'jobOrders';
      batch.update(doc(db, collectionName, id), { status: 'completed', overallEndTime: Timestamp.now(), forcedCompletion: true });
  });
  await batch.commit();
  revalidatePath('/admin/production-console');
  return { success: true, message: 'Completato.' };
}

export async function updateJobDeliveryDate(itemId: string, newDate: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = itemId.startsWith('group-');
    const itemRef = doc(db, isGroup ? 'workGroups' : 'jobOrders', itemId);
    await runTransaction(db, async (t) => {
        const snap = await t.get(itemRef);
        if (!snap.exists()) throw new Error("Non trovato.");
        t.update(itemRef, { dataConsegnaFinale: newDate });
        if (isGroup) {
            const data = snap.data() as WorkGroup;
            (data.jobOrderIds || []).forEach(id => { t.update(doc(db, 'jobOrders', id), { dataConsegnaFinale: newDate }); });
        }
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: "Data aggiornata." };
  } catch (error) { return { success: false, message: "Errore." }; }
}
