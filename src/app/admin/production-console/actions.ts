
'use server';

// @ts-ignore
import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
// @ts-ignore
import admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, Operator, WorkGroup, MaterialWithdrawal, RawMaterial, WorkPhaseTemplate, Article } from '@/types';
import { getProductionTimeAnalysisReport as fetchProductionTimeAnalysisReport } from '@/app/admin/reports/actions';
import { pulseOperatorsForJob } from '@/lib/job-sync-server';
import { convertTimestampsToDates } from '@/lib/utils';
import { getOverallStatus } from '@/lib/types';


export type ProductionTimeData = {
    averageMinutesPerPiece: number;
    isTimeCalculationReliable: boolean;
    phases: Record<string, { averageMinutesPerPiece: number; confidenceWarning?: string }>;
};

export async function getProductionTimeAnalysisMap(): Promise<Map<string, ProductionTimeData>> {
    const report = await fetchProductionTimeAnalysisReport();
    
    // Optimization: Only fetch articles present in the report instead of the whole collection
    const articleCodes = Array.from(new Set(report.map(r => r.articleCode)));
    const articlesMap = new Map<string, import('@/types').Article>();
    
    if (articleCodes.length > 0) {
        for (let i = 0; i < articleCodes.length; i += 30) {
            const chunk = articleCodes.slice(i, i + 30);
            const aSnap = await adminDb.collection("articles").where("code", "in", chunk).get();
            aSnap.forEach(d => {
                const data = d.data() as import('@/types').Article;
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
    
    // CAMPOS DA SINCRONIZARE (CASCADE)
    const updatePayload: { [key: string]: any } = { 
        phases: groupData.phases, 
        status: groupData.status,
        overallStartTime: groupData.overallStartTime || null,
        overallEndTime: groupData.overallEndTime || null,
        isProblemReported: groupData.isProblemReported || false,
        problemType: (groupData as any).problemType || null,
        problemNotes: (groupData as any).problemNotes || null,
        problemReportedBy: (groupData as any).problemReportedBy || null
    };

    const jobRefs = groupData.jobOrderIds.map(id => {
        const sanitizedId = id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
        return adminDb.collection('jobOrders').doc(sanitizedId);
    });
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
        
        
        const dummyJobForStatus = { ...item, phases: finalPhases };
        let finalStatus = getOverallStatus(dummyJobForStatus);

        // If everything is now finished, close the whole job order
        if (allPhasesDone) {
            finalStatus = 'CHIUSO';
            updates.overallEndTime = admin.firestore.Timestamp.now();
            updates.forcedCompletion = true;
        }

        updates.status = finalStatus;

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
      const dummyJobForStatus = { ...item, phases: updatedPhases };
      const newStatus = getOverallStatus(dummyJobForStatus);
      const upds = { phases: updatedPhases, status: newStatus };
      transaction.update(itemRef, upds);
      if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...item, ...upds } as any);
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
        const dummyJobForStatus = { ...(itemData as any), phases: finalPhases };
        const newStatus = getOverallStatus(dummyJobForStatus);
        const upds = { phases: finalPhases, status: newStatus };
        transaction.update(itemRef, upds);
        if (isGroup) await propagateGroupUpdatesToJobs(transaction, { ...itemData, ...upds } as any);
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
      const dummyJobForStatus = { ...jobData, phases: revertedPhases };
      const newStatus = getOverallStatus(dummyJobForStatus);
      transaction.update(jobRef, { phases: revertedPhases, status: newStatus, overallEndTime: admin.firestore.FieldValue.delete() });
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Fase riaperta.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function forcePauseOperators(jobId: string, operatorIdsToPause: string[], uid: string | undefined | null, reason?: string, notes?: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) throw new Error('Non trovato.');
      const itemData = itemSnap.data() as any;
      
      const updatedPhases = itemData.phases.map((phase: JobPhase) => {
        if (phase.status === 'in-progress') {
          const updatedWorkPeriods = (phase.workPeriods || []).map(wp => { 
            if (wp.end === null && operatorIdsToPause.includes(wp.operatorId)) { 
              return { ...wp, end: new Date(), reason }; 
            } 
            return wp; 
          });
          const isAnyoneStillWorking = updatedWorkPeriods.some(wp => wp.end === null);
          
          let newPhaseStatus = isAnyoneStillWorking ? 'in-progress' : 'paused' as const;
          let newPauseReason = isAnyoneStillWorking ? phase.pauseReason : reason;

          const updatedPhase = { 
            ...phase, 
            workPeriods: updatedWorkPeriods, 
            status: newPhaseStatus,
            pauseReason: newPauseReason
          };

          // Handle 'Manca Materiale' automatically
          if (reason === 'Manca Materiale') {
            updatedPhase.materialStatus = 'missing';
            updatedPhase.materialReady = false;
          }

          return updatedPhase;
        }
        return phase;
      });

      const dummyJobForStatus = { ...itemData, phases: updatedPhases, isProblemReported: reason === 'Manca Materiale' || (reason === 'Altro' && !!notes) };
      const newStatus = getOverallStatus(dummyJobForStatus);
      
      const updatePayload: any = { phases: updatedPhases, status: newStatus };

      // Update global problem status if 'Manca Materiale' or 'Altro' with notes
      if (reason === 'Manca Materiale') {
        updatePayload.isProblemReported = true;
        updatePayload.problemType = 'MANCA_MATERIALE';
        updatePayload.problemNotes = notes || 'Sospeso forzatamente dall\'Admin per mancanza materiale.';
        updatePayload.problemReportedBy = 'Admin';
      } else if (reason === 'Altro' && notes) {
        updatePayload.isProblemReported = true;
        updatePayload.problemType = 'ALTRO';
        updatePayload.problemNotes = notes;
        updatePayload.problemReportedBy = 'Admin';
      }

      transaction.update(itemRef, updatePayload);
      
      // --- CASCADE UPDATE TO CHILDREN ---
      if (isGroup) {
          await propagateGroupUpdatesToJobs(transaction, { ...itemData, ...updatePayload } as WorkGroup);
      }
      // ----------------------------------
      
      operatorIdsToPause.forEach(opId => { 
          transaction.update(adminDb.collection("operators").doc(opId), { stato: 'inattivo', activePhaseName: null, activeJobId: null }); 
      });

    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Pausa forzata registrata con causale.` };

  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

async function internalForceCompleteJob(transaction: admin.firestore.Transaction, jobId: string, uid: string) {
    const isGroup = jobId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(jobId);
    
    const snap = await transaction.get(itemRef);
    if (!snap.exists) throw new Error(`Elemento ${jobId} non trovato.`);
    const item = snap.data() as JobOrder;
    
    const operatorIdsToPulse: Set<string> = new Set();
    const updatedPhases = (item.phases || []).map(phase => {
        // Chiudiamo i periodi aperti se presenti
        const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
            if (wp.end === null) {
                operatorIdsToPulse.add(wp.operatorId);
                return { ...wp, end: new Date(), reason: 'Chiusura Sanatoria' };
            }
            return wp;
        });

        // Forza il completamento della fase se non già completata/saltata
        if (phase.status !== 'completed' && phase.status !== 'skipped') {
            return { 
                ...phase, 
                status: 'completed' as const, 
                workPeriods: updatedWorkPeriods, 
                forced: true,
                isSanatoria: true 
            };
        }
        return { ...phase, workPeriods: updatedWorkPeriods };
    });

    const updates: any = { 
        status: 'completed' as const, 
        overallEndTime: admin.firestore.Timestamp.now(), 
        forcedCompletion: true,
        isSanatoria: true,
        phases: updatedPhases 
    };

    if (item.billOfMaterials && item.billOfMaterials.length > 0) {
        updates.billOfMaterials = item.billOfMaterials.map(bItem => {
            if (!bItem.withdrawn) {
                return { ...bItem, status: 'withdrawn', withdrawn: true, forcedClosure: true };
            }
            return bItem;
        });
    }

    transaction.update(itemRef, updates);
    
    // Se è un gruppo, propaghiamo alle commesse figlie
    if (isGroup) {
        (item.jobOrderIds || []).forEach(id => {
            transaction.update(adminDb.collection('jobOrders').doc(id), updates);
        });
    }

    // Sanatoria Impegni Manuali: Cerca impegni collegati a questo ODL e annullali (senza storno stock)
    // Usiamo l'ordinePF/ODL come chiave per cercare nei manualCommitments
    const jobOrderCodes = isGroup ? (item.jobOrderIds || []) : [item.ordinePF];
    // NOTA: il filtro 'jobOrderCode' in manualCommitments usa l'ordinePF stringa.
    // In questo progetto spesso si usa ordinePF come identificativo parlante.
    
    const mcSnap = await adminDb.collection('manualCommitments')
        .where('jobOrderCode', 'in', isGroup ? (item as any).jobOrderCodes || [] : [item.ordinePF])
        .where('status', '==', 'pending')
        .get();

    mcSnap.forEach(doc => {
        transaction.update(doc.ref, { 
            status: 'cancelled_sanatoria', 
            cancelledAt: admin.firestore.Timestamp.now(),
            cancellationReason: 'Chiusura di Sanatoria Commessa'
        });
    });

    // De-attivazione operatori
    for (const opId of Array.from(operatorIdsToPulse)) {
        transaction.update(adminDb.collection('operators').doc(opId), {
            stato: 'inattivo',
            activePhaseName: null,
            activeJobId: null
        });
    }

    return { operatorIds: Array.from(operatorIdsToPulse) };
}

export async function forceCompleteJob(jobId: string, uid: string | undefined | null): Promise<{ success: boolean, message: string }> {
  try {
    await ensureAdmin(uid);
    if (!uid) throw new Error("ID utente mancante.");
    
    await adminDb.runTransaction(async (transaction: admin.firestore.Transaction) => {
        await internalForceCompleteJob(transaction, jobId, uid);
    });

    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(jobId);
    return { success: true, message: `Sanatoria completata correttamente.` };

  } catch (error) { 
    console.error("Error in forceCompleteJob:", error);
    return { success: false, message: error instanceof Error ? error.message : "Errore durante la sanatoria." }; 
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
              transaction.update(jRef, { status: 'In Pianificazione', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
          });
          transaction.delete(itemRef);
      } else {
          const jData = itemData as JobOrder;
          getActiveOperators(jData.phases || []);
          const updatedPhases: JobPhase[] = (jData.phases || []).map(p => ({ ...p, status: 'pending' as const, workPeriods: [], materialConsumptions: [], qualityResult: null, materialReady: p.isIndependent || p.type === 'preparation', }));
          transaction.update(itemRef, { status: 'In Pianificazione', overallStartTime: null, overallEndTime: null, isProblemReported: false, phases: updatedPhases, workGroupId: admin.firestore.FieldValue.delete() });
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
          const dummyJobForStatus = { ...itemData };
          const newStatus = isAct ? 'In Lavorazione' : getOverallStatus(dummyJobForStatus as any);
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
  const dummyJobForStatus = { phases: finalPhases, status: 'paused' }; // mock
  const newStatus = getOverallStatus(dummyJobForStatus as any);
  
  try {
    await itemRef.update({ phases: finalPhases, status: newStatus });
    if (isGroup) {
        const gSnap = await itemRef.get();
        const gData = gSnap.data() as WorkGroup;
        const batch = adminDb.batch();
        (gData.jobOrderIds || []).forEach(id => batch.update(adminDb.collection('jobOrders').doc(id), { phases: finalPhases, status: newStatus }));
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
  if (!uid) return { success: false, message: "ID utente mancante." };

  let successCount = 0;
  let errorCount = 0;

  for (const id of jobIds) {
    try {
      await adminDb.runTransaction(async (transaction) => {
        await internalForceCompleteJob(transaction, id, uid);
      });
      successCount++;
    } catch (e) {
      console.error(`Error forcing completion for ${id}:`, e);
      errorCount++;
    }
  }

  revalidatePath('/admin/production-console');
  // Pulsiamo tutti (anche se un po' pesante, è necessario per la coerenza della UI degli operatori)
  await Promise.all(jobIds.map(id => pulseOperatorsForJob(id)));

  return { 
    success: errorCount === 0, 
    message: `Sanatoria completata: ${successCount} riuscite, ${errorCount} fallite.` 
  };
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

export async function updateJobPrepDate(itemId: string, newDate: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const isGroup = itemId.startsWith('group-');
    const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
    await adminDb.runTransaction(async (t: admin.firestore.Transaction) => {
        const snap = await t.get(itemRef);
        if (!snap.exists) throw new Error("Non trovato.");
        t.update(itemRef, { dataFinePreparazione: newDate });
        if (isGroup) {
            const data = snap.data() as WorkGroup;
            (data.jobOrderIds || []).forEach(id => { 
                t.update(adminDb.collection('jobOrders').doc(id), { dataFinePreparazione: newDate }); 
            });
        }
    });
    revalidatePath('/admin/production-console');
    await pulseOperatorsForJob(itemId);
    return { success: true, message: "Data preparazione aggiornata." };

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

/**
 * Ottimizzazione Firebase: Recupera l'analisi tempi per un singolo articolo specifico.
 * Sostituisce la necessità di caricare l'intero report per una sola visualizzazione.
 */
export async function getAnalysisForArticle(articleCode: string): Promise<ProductionTimeData | null> {
    const jobsSnap = await adminDb.collection("jobOrders")
        .where("details", "==", articleCode)
        .where("status", "in", ["completed", "production", "suspended", "paused"])
        .limit(50)
        .get();

    if (jobsSnap.empty) return null;

    const jobs = jobsSnap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    
    const articleSnap = await adminDb.collection("articles").where("code", "==", articleCode).limit(1).get();
    const article = articleSnap.empty ? null : (articleSnap.docs[0].data() as Article);

    const [tSnap, settingsDoc] = await Promise.all([
        adminDb.collection("workPhaseTemplates").get(),
        adminDb.collection('configuration').doc('timeTrackingSettings').get()
    ]);
    
    const typeMap = new Map<string, string>();
    tSnap.forEach(d => typeMap.set(d.data().name, d.data().type));
    
    const workGroupIds = [...new Set(jobs.map(j => j.workGroupId).filter(Boolean))] as string[];
    const groupsMap = new Map<string, WorkGroup>();
    if (workGroupIds.length > 0) {
        for (let i = 0; i < workGroupIds.length; i += 30) {
            const chunk = workGroupIds.slice(i, i + 30);
            const snap = await adminDb.collection("workGroups").where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
            snap.forEach(d => groupsMap.set(d.id, convertTimestampsToDates(d.data()) as WorkGroup));
        }
    }

    const timeSettings = settingsDoc.exists ? settingsDoc.data() : { minimumPhaseDurationSeconds: 10 } as any;
    const MIN_MS = (timeSettings.minimumPhaseDurationSeconds || 10) * 1000;

    const phaseData: { [name: string]: { totalMinutes: number, totalQuantity: number, type: string } } = {};
    let totalReliableMs = 0;
    let totalReliableQty = 0;

    for (const job of jobs) {
        if (job.qta <= 0) continue;
        
        let totalMs = 0;
        let isReliable = true;
        let phasesWithDetails: any[] = [];
        const calculateMs = (p: JobPhase) => (p.workPeriods || []).reduce((acc, wp) => wp.start && wp.end ? acc + (new Date(wp.end).getTime() - new Date(wp.start).getTime()) : acc, 0);

        if (job.workGroupId && groupsMap.has(job.workGroupId)) {
            const group = groupsMap.get(job.workGroupId)!;
            isReliable = false;
            phasesWithDetails = (group.phases || []).map(gp => {
                const groupMs = calculateMs(gp);
                const proportionalMs = group.totalQuantity > 0 ? (groupMs / group.totalQuantity) * job.qta : 0;
                if (gp.tracksTime !== false) totalMs += proportionalMs;
                return { phase: gp, timeMs: proportionalMs };
            });
        } else {
            const tracking = (job.phases || []).filter(p => p.tracksTime !== false);
            isReliable = tracking.length > 0 && tracking.every(p => p.status === 'completed') && !tracking.some(p => p.forced || (calculateMs(p) > 0 && calculateMs(p) < MIN_MS));
            phasesWithDetails = (job.phases || []).map(p => {
                const t = calculateMs(p);
                if (p.tracksTime !== false) totalMs += t;
                return { phase: p, timeMs: t };
            });
        }

        if (isReliable) {
            totalReliableMs += totalMs;
            totalReliableQty += job.qta;
        }

        phasesWithDetails.filter(p => p.phase.tracksTime !== false).forEach(p => {
            if (p.phase.status === 'completed' && !p.phase.forced && p.timeMs >= MIN_MS) {
                if (!phaseData[p.phase.name]) phaseData[p.phase.name] = { totalMinutes: 0, totalQuantity: 0, type: typeMap.get(p.phase.name) || 'production' };
                phaseData[p.phase.name].totalMinutes += p.timeMs / 60000;
                phaseData[p.phase.name].totalQuantity += job.qta;
            }
        });
    }

    const phaseTimes: Record<string, { averageMinutesPerPiece: number; confidenceWarning?: string }> = {};
    Object.entries(phaseData).forEach(([name, data]) => {
        const avg = data.totalQuantity > 0 ? data.totalMinutes / data.totalQuantity : 0;
        let warning: string | undefined = undefined;
        const phaseTimesConfig = article?.phaseTimes;
        if (phaseTimesConfig && (phaseTimesConfig as any)[name]) {
            const expected = (phaseTimesConfig as any)[name].expectedMinutesPerPiece;
            if (expected > 0) {
                if (avg > expected * 1.5) warning = "⚠️ Tempo raddoppiato rispetto al Teorico!";
                else if (avg < expected * 0.5) warning = "⚠️ Tempo dimezzato rispetto al Teorico!";
            }
        }
        phaseTimes[name] = { averageMinutesPerPiece: avg, confidenceWarning: warning };
    });

    return {
        averageMinutesPerPiece: totalReliableQty > 0 ? (totalReliableMs / 60000) / totalReliableQty : 0,
        isTimeCalculationReliable: totalReliableQty > 0,
        phases: phaseTimes
    };
}

export async function getArticlesByCodes(codes: string[]): Promise<Article[]> {
    if (codes.length === 0) return [];
    const articles: Article[] = [];
    for (let i = 0; i < codes.length; i += 30) {
        const chunk = codes.slice(i, i + 30);
        const aSnap = await adminDb.collection("articles").where("code", "in", chunk).get();
        aSnap.forEach(d => articles.push({ id: d.id, ...convertTimestampsToDates(d.data()) } as Article));
    }
    return articles;
}

export async function getRawMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
    if (codes.length === 0) return [];
    const materials: RawMaterial[] = [];
    for (let i = 0; i < codes.length; i += 30) {
        const chunk = codes.slice(i, i + 30);
        const mSnap = await adminDb.collection("rawMaterials").where("code", "in", chunk).get();
        mSnap.forEach(d => materials.push({ id: d.id, ...convertTimestampsToDates(d.data()) } as RawMaterial));
    }
    return materials;
}
