
'use server';

// @ts-ignore
import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
// @ts-ignore
import admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, Operator, WorkGroup, MaterialWithdrawal, RawMaterial, WorkPhaseTemplate } from '@/lib/mock-data';
import { getProductionTimeAnalysisReport as fetchProductionTimeAnalysisReport } from '@/app/admin/reports/actions';
import { pulseOperatorsForJob } from '@/lib/job-sync-server';


export type ProductionTimeData = {
    averageMinutesPerPiece: number;
    isTimeCalculationReliable: boolean;
    phases: Record<string, { averageMinutesPerPiece: number; confidenceWarning?: string }>;
};

export async function getProductionTimeAnalysisMap(): Promise<Map<string, ProductionTimeData>> {
    const report = await fetchProductionTimeAnalysisReport();
    
    // Optimization: Only fetch articles present in the report instead of the whole collection
    const articleCodes = Array.from(new Set(report.map(r => r.articleCode)));
    const articlesMap = new Map<string, import('@/lib/mock-data').Article>();
    
    if (articleCodes.length > 0) {
        for (let i = 0; i < articleCodes.length; i += 30) {
            const chunk = articleCodes.slice(i, i + 30);
            const aSnap = await adminDb.collection("articles").where("code", "in", chunk).get();
            aSnap.forEach(d => {
                const data = d.data() as import('@/lib/mock-data').Article;
                articlesMap.set(data.code, data);
            });
        }
    }

    const analysisMap = new Map<string, ProductionTimeData>();
    for (const articleReport of report) {
        const article = articlesMap.get(articleReport.articleCode);
        const phaseTimes: Record<string, { averageMinutesPerPiece: number; confidenceWarning?: string }> = {};
        
        articleReport.averagePhaseTimes.forEach(phase => { 
            if (phase.averageMinutesPerPiece > 0) {
                let warning: string | undefined = undefined;
                // Add defensive checks for phaseTimes existence
                const phaseTimesConfig = article?.phaseTimes;
                if (phaseTimesConfig && phaseTimesConfig[phase.name]) {
                    const expected = phaseTimesConfig[phase.name].expectedMinutesPerPiece;
                    if (expected > 0) {
                        if (phase.averageMinutesPerPiece > expected * 1.5) {
                            warning = "⚠️ Tempo raddoppiato rispetto al Teorico!";
                        } else if (phase.averageMinutesPerPiece < expected * 0.5) {
                            warning = "⚠️ Tempo dimezzato rispetto al Teorico!";
                        }
                    }
                }
                phaseTimes[phase.name] = { 
                    averageMinutesPerPiece: phase.averageMinutesPerPiece,
                    confidenceWarning: warning
                }; 
            }
        });
        analysisMap.set(articleReport.articleCode, { 
            averageMinutesPerPiece: articleReport.averageMinutesPerPiece, 
            isTimeCalculationReliable: articleReport.jobs.some(j => j.isTimeCalculationReliable), 
            phases: phaseTimes 
        });
    }
    return analysisMap;
}

async function propagateGroupUpdatesToJobs(transaction: admin.firestore.Transaction, groupData: WorkGroup) {
    if (!groupData.jobOrderIds || groupData.jobOrderIds.length === 0) return;
    const updatePayload: { [key: string]: any } = { phases: groupData.phases, status: groupData.status };
    const jobRefs = groupData.jobOrderIds.map(id => adminDb.collection('jobOrders').doc(id));
    jobRefs.forEach(jobRef => { transaction.update(jobRef, updatePayload); });
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
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists) throw new Error('Elemento non trovato.');
        const item = snap.data() as JobOrder;
        
        let allPhasesDone = true;
        const operatorIdsToPulse: Set<string> = new Set();

        const updatedPhases = item.phases.map(phase => {
            const isProductionOrPrep = phase.type === 'production' || phase.type === 'preparation';
            const isQualityOrPack = phase.type === 'quality' || phase.type === 'packaging';

            if (isProductionOrPrep && phase.status !== 'completed' && phase.status !== 'skipped') {
                // Close any active work periods for these phases
                const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
                    if (wp.end === null) {
                        operatorIdsToPulse.add(wp.operatorId);
                        return { ...wp, end: new Date() };
                    }
                    return wp;
                });
                
                return { 
                    ...phase, 
                    status: 'completed' as const, 
                    forced: true,
                    workPeriods: updatedWorkPeriods 
                };
            }
            
            // If it's quality/pack or already done, we check if it blocks "allPhasesDone"
            if (phase.status !== 'completed' && phase.status !== 'skipped') {
                allPhasesDone = false;
            }
            return phase;
        });


        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        const updates: any = { phases: finalPhases };
        
        // If everything is now finished, close the whole job order
        if (allPhasesDone) {
            updates.status = 'completed';
            updates.overallEndTime = admin.firestore.Timestamp.now();
            updates.forcedCompletion = true;
        }

        transaction.update(itemRef, updates);

        if (isGroup) {
            await propagateGroupUpdatesToJobs(transaction, { ...item, ...updates } as any);
        }

        // Also update operators' status if they were working on these phases
        for (const opId of Array.from(operatorIdsToPulse)) {
            transaction.update(adminDb.collection('operators').doc(opId), {
                stato: 'inattivo',
                activePhaseName: null
                // We keep activeJobId for persistence
            });
        }
    });

    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Produzione forzata con successo.` };

  } catch (error) { 
    return { success: false, message: error instanceof Error ? error.message : "Errore durante la forzatura." }; 
  }
}


export async function revertForceFinish(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
      const snap = await transaction.get(itemRef);
      if (!snap.exists) throw new Error('Elemento non trovato.');
      const item = snap.data() as JobOrder;
      let updatedPhases = item.phases.map(phase => { if (phase.forced) { const { forced, ...rest } = phase; return { ...rest, status: 'pending' as const }; } return phase; });
      updatedPhases = updatePhasesMaterialReadiness(updatedPhases);
      transaction.update(itemRef, { phases: updatedPhases });
      if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...item, phases: updatedPhases } as any);
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Annullata forzatura.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function toggleGuainaPhasePosition(itemId: string, phaseId: string, currentState: 'default' | 'postponed'): Promise<{ success: boolean; message: string }> {
  try {
    const isGroup = itemId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
    const templateRef = adminDb.collection('workPhaseTemplates').doc(phaseId);
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
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
          const tData = tSnap.exists ? (tSnap.data() as WorkPhaseTemplate) : null;
          updatedPhases[phaseIndex].sequence = tData?.sequence ?? 1;

          delete updatedPhases[phaseIndex].postponed;
        }
        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
        transaction.update(itemRef, { phases: finalPhases });
        if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...itemData, phases: finalPhases } as WorkGroup);
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(itemId);
    return { success: true, message: `Posizione aggiornata.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function revertPhaseCompletion(jobId: string, phaseId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobRef = adminDb.collection('jobOrders').doc(jobId);
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists) throw new Error('Commessa non trovata.');
      const jobData = jobSnap.data() as JobOrder;
      const phases = [...(jobData.phases || [])];
      const idx = phases.findIndex(p => p.id === phaseId);
      if (idx === -1) throw new Error('Fase non trovata.');
      if (phases[idx].status !== 'completed') throw new Error('Fase non completata.');
      phases[idx].status = 'paused';
      phases[idx].qualityResult = null;
      const revertedPhases = updatePhasesMaterialReadiness(phases);
      transaction.update(jobRef, { phases: revertedPhases, status: 'production', overallEndTime: admin.firestore.FieldValue.delete() });
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Fase riaperta.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function forcePauseOperators(jobId: string, operatorIdsToPause: string[], uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) throw new Error('Non trovato.');
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const updatedPhases = itemData.phases.map(phase => {
        if (phase.status === 'in-progress') {
          const updatedWorkPeriods = (phase.workPeriods || []).map(wp => { if (wp.end === null && operatorIdsToPause.includes(wp.operatorId)) { return { ...wp, end: new Date() }; } return wp; });
          const isAnyoneStillWorking = updatedWorkPeriods.some(wp => wp.end === null);
          return { ...phase, workPeriods: updatedWorkPeriods, status: isAnyoneStillWorking ? 'in-progress' : 'paused' as const };
        }
        return phase;
      });
      const isAnyActive = updatedPhases.some(p => p.status === 'in-progress');
      const isAnyPaused = updatedPhases.some(p => p.status === 'paused');
      const newStatus = isAnyActive ? 'production' : (isAnyPaused ? 'paused' : 'production');
      transaction.update(itemRef, { phases: updatedPhases, status: newStatus });
      if (isGroup) (itemData.jobOrderIds || []).forEach(id => { transaction.update(adminDb.collection('jobOrders').doc(id), { phases: updatedPhases, status: newStatus }); });
      operatorIdsToPause.forEach(opId => { transaction.update(adminDb.collection("operators").doc(opId), { stato: 'inattivo', activePhaseName: null }); });

    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Operatori messi in pausa.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function forceCompleteJob(jobId: string, uid: string | undefined | null): Promise<{ success: boolean, message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists) throw new Error("Non trovato.");
        const item = snap.data() as JobOrder;
        
        const operatorIdsToPulse: Set<string> = new Set();
        const updatedPhases = (item.phases || []).map(phase => {
            if (phase.status === 'in-progress' || phase.status === 'paused' || phase.status === 'pending') {
                const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
                    if (wp.end === null) {
                        operatorIdsToPulse.add(wp.operatorId);
                        return { ...wp, end: new Date() };
                    }
                    return wp;
                });
                return { ...phase, status: 'completed' as const, workPeriods: updatedWorkPeriods, forced: true };
            }
            return phase;
        });

        const updates = { 
            status: 'completed' as const, 
            overallEndTime: admin.firestore.Timestamp.now(), 
            forcedCompletion: true,
            phases: updatedPhases 
        };

        transaction.update(itemRef, updates);
        
        if (isGroup) {
            (item.jobOrderIds || []).forEach(id => {
                transaction.update(adminDb.collection('jobOrders').doc(id), updates);
            });
        }

        // De-activate operators
        for (const opId of Array.from(operatorIdsToPulse)) {
            transaction.update(adminDb.collection('operators').doc(opId), {
                stato: 'inattivo',
                activePhaseName: null
            });
        }
    });

    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Commessa chiusa correttamente.` };

  } catch (error) { 
    return { success: false, message: error instanceof Error ? error.message : "Errore durante la chiusura." }; 
  }
}


export async function resetSingleCompletedJobOrder(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) throw new Error("Non trovata.");
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const jobIds = isGroup ? (itemData as WorkGroup).jobOrderIds : [jobId];
      if (!jobIds || jobIds.length === 0) return;
      const withdrawalsQuery = adminDb.collection("materialWithdrawals").where("jobIds", "array-contains-any", jobIds);
      const wSnap = await withdrawalsQuery.get();
      const matIds = [...new Set(wSnap.docs.map((d: any) => d.data().materialId))].filter(Boolean) as string[];
      const matSnaps = await Promise.all(matIds.map(id => transaction.get(adminDb.collection('rawMaterials').doc(id))));
      const matMap = new Map<string, RawMaterial>(matSnaps.map((s: any) => [s.id, s.data() as RawMaterial]));
      for (const wd of wSnap.docs) {
        const w = wd.data() as MaterialWithdrawal;
        const m = matMap.get(w.materialId);
        if (m) { transaction.update(adminDb.collection('rawMaterials').doc(w.materialId), { currentWeightKg: ((m as RawMaterial).currentWeightKg || 0) + w.consumedWeight, currentStockUnits: ((m as RawMaterial).currentStockUnits || 0) + (w.consumedUnits || 0) }); }
        transaction.delete(wd.ref);
      }
      const operatorIdsToPulse: Set<string> = new Set();
      const getActiveOperators = (phs: JobPhase[]) => {
          phs.forEach(p => {
              (p.workPeriods || []).forEach(wp => {
                  if (wp.end === null) operatorIdsToPulse.add(wp.operatorId);
              });
          });
      };

      if (isGroup) {
          const gData = itemData as WorkGroup;
          getActiveOperators(gData.phases || []);
          (gData.jobOrderIds || []).forEach(id => {
              const jRef = adminDb.collection('jobOrders').doc(id);
              const updatedPhases: JobPhase[] = (gData.phases || []).map(p => ({ ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null, materialReady: p.isIndependent || p.type === 'preparation', }));
              transaction.update(jRef, { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
          });
          transaction.delete(itemRef);
      } else {
          const jData = itemData as JobOrder;
          getActiveOperators(jData.phases || []);
          const updatedPhases: JobPhase[] = (jData.phases || []).map(p => ({ ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null, materialReady: p.isIndependent || p.type === 'preparation', }));
          transaction.update(itemRef, { status: 'planned', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
      }

      // De-activate operators
      for (const opId of Array.from(operatorIdsToPulse)) {
          transaction.update(adminDb.collection('operators').doc(opId), {
              stato: 'inattivo',
              activePhaseName: null,
              activeJobId: null // For reset, we actually want to kick them out as the job is now 'planned' or deleted (if group)
          });
      }
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Resettato correttamente.` };
  } catch (error) { 
    return { success: false, message: error instanceof Error ? error.message : "Errore durante il reset." }; 
  }
}


export async function revertCompletion(itemId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
      await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists) throw new Error("Non trovato.");
          const itemData = itemSnap.data() as JobOrder | WorkGroup;
          if (!itemData.forcedCompletion) throw new Error("Solo chiusure forzate riapribili.");
          const isAct = (itemData.phases || []).some(p => p.status === 'in-progress');
          const newStatus = isAct ? 'production' : 'paused';
          transaction.update(itemRef, { status: newStatus, overallEndTime: admin.firestore.FieldValue.delete(), forcedCompletion: admin.firestore.FieldValue.delete() });
          if (isGroup) { (itemData.jobOrderIds || []).forEach(id => { transaction.update(adminDb.collection('jobOrders').doc(id), { status: newStatus, overallEndTime: admin.firestore.FieldValue.delete(), forcedCompletion: admin.firestore.FieldValue.delete() }); }); }
      });
      revalidatePath('/admin/production-console');
      await pulseOperatorsForJob(itemId);
      return { success: true, message: "Riaperta." };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
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
    await pulseOperatorsForJob(jobId);
    return { success: true, message: 'Fasi aggiornate.' };

  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function forceFinishMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  try { for (const id of jobIds) await forceFinishProduction(id, uid); return { success: true, message: 'Completato.' }; } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function forceCompleteMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const batch = adminDb.batch();
  jobIds.forEach(id => {
      const isGroup = id.startsWith('group-');
      const collectionName = isGroup ? 'workGroups' : 'jobOrders';
      batch.update(adminDb.collection(collectionName).doc(id), { status: 'completed', overallEndTime: admin.firestore.Timestamp.now(), forcedCompletion: true });
  });
  await batch.commit();
  revalidatePath('/admin/production-console');
  await pulseOperatorsForJob(jobIds);
  return { success: true, message: 'Completato.' };

}

export async function reportMaterialMissing(itemId: string, phaseId: string, uid: string, notes?: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
    await adminDb.runTransaction(async (t: admin.firestore.Transaction) => {
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
    await pulseOperatorsForJob(itemId);
    return { success: true, message: 'Segnalato.' };

  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function resolveMaterialMissing(itemId: string, phaseId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
  try {
    await adminDb.runTransaction(async (t: admin.firestore.Transaction) => {
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
    await pulseOperatorsForJob(itemId);
    return { success: true, message: 'Risolto.' };

  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function updateJobDeliveryDate(itemId: string, newDate: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = itemId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
    await adminDb.runTransaction(async (t: admin.firestore.Transaction) => {
        const snap = await t.get(itemRef);
        if (!snap.exists) throw new Error("Non trovato.");
        t.update(itemRef, { dataConsegnaFinale: newDate });
        if (isGroup) {
            const data = snap.data() as WorkGroup;
            (data.jobOrderIds || []).forEach(id => { t.update(adminDb.collection('jobOrders').doc(id), { dataConsegnaFinale: newDate }); });
        }
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(itemId);
    return { success: true, message: "Data aggiornata." };

  } catch (error) { return { success: false, message: "Errore." }; }
}
export async function bulkUpdateJobOrders(jobs: JobOrder[], uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    jobs.forEach(job => {
      const ref = adminDb.collection('jobOrders').doc(job.id);
      batch.update(ref, { phases: job.phases });
    });
    await batch.commit();
    revalidatePath('/admin/production-console');
    return { success: true, message: `${jobs.length} commesse aggiornate correttamente.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore nell'aggiornamento massivo." };
  }
}
