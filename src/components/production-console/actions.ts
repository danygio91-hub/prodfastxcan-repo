
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, Operator, WorkGroup, MaterialWithdrawal, RawMaterial } from '@/lib/mock-data';
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

export async function forceFinishProduction(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobRef = adminDb.collection('jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
        const jobSnap = await transaction.get(jobRef);
        if (!jobSnap.exists) throw new Error('Commessa non trovata.');
        const job = jobSnap.data() as JobOrder;

        const updatedPhases = job.phases.map(phase => {
          if (phase.type === 'production' && phase.status !== 'completed') {
            return { ...phase, status: 'completed' as const, forced: true };
          }
          return phase;
        });
        
        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        transaction.update(jobRef, { phases: finalPhases });
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
    const jobRef = adminDb.collection('jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists) throw new Error('Commessa non trovata.');
      const job = jobSnap.data() as JobOrder;

      let updatedPhases = job.phases.map(phase => {
        if (phase.forced) {
          const { forced, ...rest } = phase;
          return { ...rest, status: 'pending' as const };
        }
        return phase;
      });

      updatedPhases = updatePhasesMaterialReadiness(updatedPhases);
      transaction.update(jobRef, { phases: updatedPhases });
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
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
    const templateRef = adminDb.collection('workPhaseTemplates').doc(phaseId);
    
    await adminDb.runTransaction(async (transaction) => {
        const [itemSnap, tSnap] = await Promise.all([transaction.get(itemRef), transaction.get(templateRef)]);
        if (!itemSnap.exists) throw new Error('Non trovato.');

        const itemData = itemSnap.data() as JobOrder | WorkGroup;
        const updatedPhases = [...(itemData.phases || [])];
        const phaseIndex = updatedPhases.findIndex(p => p.id === phaseId);
        if (phaseIndex === -1) throw new Error('Fase non trovata.');

        if (currentState === 'default') {
          const lastProd = updatedPhases.filter(p => p.type === 'production').sort((a, b) => a.sequence - b.sequence).pop();
          updatedPhases[phaseIndex].sequence = lastProd ? lastProd.sequence + 0.1 : 99;
          updatedPhases[phaseIndex].postponed = true;
        } else {
          const tData = tSnap.exists ? tSnap.data() : null;
          updatedPhases[phaseIndex].sequence = tData ? tData.sequence : 1;
          delete updatedPhases[phaseIndex].postponed;
        }

        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        transaction.update(itemRef, { phases: finalPhases });
        if (isGroup) {
            const groupData = itemData as WorkGroup;
            (groupData.jobOrderIds || []).forEach(id => transaction.update(adminDb.collection('jobOrders').doc(id), { phases: finalPhases }));
        }
    });
    
    revalidatePath('/admin/production-console');
    return { success: true, message: `Posizione fase aggiornata.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore." };
  }
}

export async function revertPhaseCompletion(jobId: string, phaseId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobRef = adminDb.collection('jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists) throw new Error('Commessa non trovata.');
      
      const jobData = jobSnap.data() as JobOrder;
      const phases = [...(jobData.phases || [])];
      const idx = phases.findIndex(p => p.id === phaseId);
      if (idx === -1) throw new Error('Fase non trovata.');
      
      phases[idx].status = 'paused';
      phases[idx].qualityResult = null;
      
      const revertedPhases = updatePhasesMaterialReadiness(phases);
      transaction.update(jobRef, { phases: revertedPhases, status: 'production', overallEndTime: admin.firestore.FieldValue.delete() });
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
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);

    await adminDb.runTransaction(async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) throw new Error('Non trovato.');
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
      const newStatus = isAnyActive ? 'production' : 'paused';
      
      transaction.update(itemRef, { phases: updatedPhases, status: newStatus });
      if (isGroup) {
        (itemData.jobOrderIds || []).forEach(id => transaction.update(adminDb.collection('jobOrders').doc(id), { phases: updatedPhases, status: newStatus }));
      }
      
      operatorIdsToPause.forEach(opId => {
          transaction.update(adminDb.collection("operators").doc(opId), { stato: 'inattivo', activeJobId: null, activePhaseName: null });
      });
    });
    
    revalidatePath('/admin/production-console');
    return { success: true, message: `Operatori in pausa.` };
  } catch (error) {
    return { success: false, message: "Errore." };
  }
}

export async function forceCompleteJob(jobId: string, uid: string | undefined | null): Promise<{ success: boolean, message: string }> {
  try {
    await ensureAdmin(uid);
    await adminDb.collection('jobOrders').doc(jobId).update({ status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });
    revalidatePath('/admin/production-console');
    return { success: true, message: `Chiusa.` };
  } catch (e) { return { success: false, message: "Errore." }; }
}

export async function resetSingleCompletedJobOrder(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) throw new Error("Non trovata.");
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const jobIds = isGroup ? (itemData as WorkGroup).jobOrderIds : [jobId];

      const wSnap = await adminDb.collection("materialWithdrawals").where("jobIds", "array-contains-any", jobIds).get();
      
      const matIds = [...new Set(wSnap.docs.map(d => d.data().materialId))].filter(Boolean) as string[];
      const matSnaps = await Promise.all(matIds.map(id => transaction.get(adminDb.collection('rawMaterials').doc(id))));
      const matMap = new Map(matSnaps.map(s => [s.id, s.data() as RawMaterial]));

      for (const wd of wSnap.docs) {
        const w = wd.data() as MaterialWithdrawal;
        const m = matMap.get(w.materialId);
        if (m) {
            transaction.update(adminDb.collection('rawMaterials').doc(w.materialId), { 
                currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight, 
                currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0) 
            });
        }
        transaction.delete(wd.ref);
      }

      if (isGroup) {
          const gData = itemData as WorkGroup;
          (gData.jobOrderIds || []).forEach(id => {
              const updatedPhases: JobPhase[] = (gData.phases || []).map(p => ({
                  ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null,
                  materialReady: p.isIndependent || p.type === 'preparation',
              }));
              transaction.update(adminDb.collection('jobOrders').doc(id), { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
          });
          transaction.delete(itemRef);
      } else {
          const updatedPhases: JobPhase[] = (itemData.phases || []).map(p => ({
              ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null,
              materialReady: p.isIndependent || p.type === 'preparation',
          }));
          transaction.update(itemRef, { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
      }
    });

    revalidatePath('/admin/production-console');
    revalidatePath('/admin/data-management');
    return { success: true, message: `Resettato.` };
  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function revertCompletion(itemId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
      await adminDb.runTransaction(async (transaction) => {
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists) throw new Error("Non trovato.");
          const itemData = itemSnap.data() as JobOrder | WorkGroup;
          if (!itemData.forcedCompletion) throw new Error("Solo chiusure forzate riapribili.");
          
          const isAnyActive = (itemData.phases || []).some(p => p.status === 'in-progress');
          const newStatus = isAnyActive ? 'production' : 'paused';
          transaction.update(itemRef, { status: newStatus, overallEndTime: admin.firestore.FieldValue.delete(), forcedCompletion: admin.firestore.FieldValue.delete() });
          if (isGroup) {
              (itemData.jobOrderIds || []).forEach(id => transaction.update(adminDb.collection('jobOrders').doc(id), { status: newStatus, overallEndTime: admin.firestore.FieldValue.delete(), forcedCompletion: admin.firestore.FieldValue.delete() }));
          }
      });
      revalidatePath('/admin/production-console');
      return { success: true, message: "Riaperta." };
  } catch (e) { return { success: false, message: "Errore." }; }
}

export async function updatePhasesForJob(jobId: string, phases: JobPhase[], uid: string): Promise<{ success: boolean, message: string }> {
  await ensureAdmin(uid);
  const isGroup = jobId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
  const finalPhases = updatePhasesMaterialReadiness(phases.map((p, i) => ({ ...p, sequence: i + 1 })));
  try {
    await itemRef.update({ phases: finalPhases });
    if (isGroup) {
        const gSnap = await itemRef.get();
        const gData = gSnap.data() as WorkGroup;
        const batch = adminDb.batch();
        (gData.jobOrderIds || []).forEach(id => batch.update(adminDb.collection('jobOrders').doc(id), { phases: finalPhases }));
        await batch.commit();
    }
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Fasi aggiornate.' };
  } catch (e) { return { success: false, message: "Errore." }; }
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
  const batch = adminDb.batch();
  jobIds.forEach(id => {
      const isGroup = id.startsWith('group-');
      batch.update(adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(id), { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });
  });
  await batch.commit();
  revalidatePath('/admin/production-console');
  return { success: true, message: 'Completato.' };
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

export async function reportMaterialMissing(itemId: string, phaseId: string, uid: string, notes?: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
    await adminDb.runTransaction(async (t) => {
      const [snap, opSnap] = await Promise.all([t.get(itemRef), t.get(adminDb.collection('operators').doc(uid))]);
      if (!snap.exists) throw new Error("Non trovato.");
      const itemData = snap.data() as JobOrder;
      const phases = [...itemData.phases];
      const idx = phases.findIndex(p => p.id === phaseId);
      if (idx === -1) throw new Error("Fase non trovata.");
      phases[idx].materialStatus = 'missing';
      phases[idx].materialReady = false;
      const up = { phases, isProblemReported: true, problemType: 'MANCA_MATERIALE' as const, problemReportedBy: (opSnap.data() as any)?.nome || 'Admin', problemNotes: notes || '' };
      t.update(itemRef, up);
      if (isGroup) (itemData.jobOrderIds || []).forEach(id => t.update(adminDb.collection('jobOrders').doc(id), up));
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Segnalato.' };
  } catch (e) { return { success: false, message: "Errore." }; }
}

export async function resolveMaterialMissing(itemId: string, phaseId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
    await adminDb.runTransaction(async (t) => {
      const snap = await t.get(itemRef);
      if (!snap.exists) throw new Error("Non trovato.");
      const itemData = snap.data() as JobOrder;
      let phases = [...itemData.phases];
      const idx = phases.findIndex(p => p.id === phaseId);
      if (idx === -1) throw new Error("Fase non trovata.");
      phases[idx].materialStatus = 'available';
      phases = updatePhasesMaterialReadiness(phases);
      const anyLeft = phases.some(p => p.materialStatus === 'missing');
      const otherProb = itemData.problemType && itemData.problemType !== 'MANCA_MATERIALE';
      const up: any = { phases };
      if (!anyLeft && !otherProb) { up.isProblemReported = false; up.problemType = admin.firestore.FieldValue.delete(); up.problemReportedBy = admin.firestore.FieldValue.delete(); }
      t.update(itemRef, up);
      if (isGroup) (itemData.jobOrderIds || []).forEach(id => t.update(adminDb.collection('jobOrders').doc(id), up));
    });
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Risolto.' };
  } catch (e) { return { success: false, message: "Errore." }; }
}

export async function updateJobDeliveryDate(itemId: string, newDate: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = itemId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);

    await adminDb.runTransaction(async (t) => {
        const snap = await t.get(itemRef);
        if (!snap.exists) throw new Error("Non trovato.");
        
        t.update(itemRef, { dataConsegnaFinale: newDate });
        
        if (isGroup) {
            const data = snap.data() as WorkGroup;
            (data.jobOrderIds || []).forEach(id => {
                t.update(adminDb.collection('jobOrders').doc(id), { dataConsegnaFinale: newDate });
            });
        }
    });

    revalidatePath('/admin/production-console');
    return { success: true, message: "Data aggiornata." };
  } catch (error) {
    return { success: false, message: "Errore." };
  }
}
