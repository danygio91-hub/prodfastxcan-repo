
'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, updateDoc, runTransaction, writeBatch, collection, getDocs, query, where, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, WorkPhaseTemplate, Operator, WorkGroup, MaterialWithdrawal, RawMaterial } from '@/lib/mock-data';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';
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
        // We consider all data for estimations, reliability is just a flag
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

/**
 * Helper function to propagate state changes from a group to its member job orders.
 * @param transaction Firestore transaction object.
 * @param groupData The WorkGroup data containing the state to propagate.
 */
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


export async function forceFinishProduction(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);

    const jobRef = doc(db, 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
        const jobSnap = await transaction.get(jobRef);
        if (!jobSnap.exists()) {
          throw new Error('Commessa non trovata.');
        }
        const job = jobSnap.data() as JobOrder;

        const updatedPhases = job.phases.map(phase => {
          // Complete only phases of type 'production' that are not yet completed
          if (phase.type === 'production' && phase.status !== 'completed') {
            return { ...phase, status: 'completed' as const, forced: true };
          }
          return phase;
        });
        
        const sortedPhases = [...updatedPhases].sort((a,b) => a.sequence - b.sequence);
        
        // Find the first phase that is NOT production and is still pending
        const firstNonProductionPhaseIndex = sortedPhases.findIndex(p => p.type !== 'production' && p.status === 'pending');

        if (firstNonProductionPhaseIndex !== -1) {
            sortedPhases[firstNonProductionPhaseIndex].materialReady = true;
        }
        
        transaction.update(jobRef, { phases: sortedPhases });
    });


    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);

    return { success: true, message: `Produzione forzata alla finitura per la commessa ${jobId}.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error forcing production finish:", error);
    return { success: false, message: errorMessage };
  }
}

export async function revertForceFinish(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);

    const jobRef = doc(db, 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error('Commessa non trovata.');
      }
      const job = jobSnap.data() as JobOrder;

      let updatedPhases = job.phases.map(phase => {
        if (phase.forced) {
          // Revert the phase to pending and remove the forced flag
          const { forced, ...rest } = phase;
          return { ...rest, status: 'pending' as const };
        }
        return phase;
      });

      // Also reset material readiness for subsequent non-production phases
      updatedPhases = updatePhasesMaterialReadiness(updatedPhases);

      transaction.update(jobRef, { phases: updatedPhases });
    });

    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);

    return { success: true, message: `Annullata forzatura per commessa ${jobId}.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error reverting force finish:", error);
    return { success: false, message: errorMessage };
  }
}


export async function toggleGuainaPhasePosition(jobId: string, phaseId: string): Promise<{ success: boolean; message: string }> {
  try {
    const isGroup = jobId.startsWith('group-');
    
    if (isGroup) {
      await dissolveWorkGroup(jobId);
      return { 
        success: true, 
        message: 'Azione non compatibile con i gruppi. Il gruppo è stato annullato per permettere la modifica individuale delle commesse.' 
      };
    }

    const jobRef = doc(db, 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
        const jobSnap = await transaction.get(jobRef);

        if (!jobSnap.exists()) {
          throw new Error('Commessa non trovata.');
        }

        const job = jobSnap.data() as JobOrder;
        const originalPhases = job.phases || [];
        const phaseIndex = originalPhases.findIndex(p => p.id === phaseId);

        if (phaseIndex === -1) {
          throw new Error('Fase "Taglio Guaina" non trovata in questa commessa.');
        }

        const phaseToMove = originalPhases[phaseIndex];

        if (!['pending', 'paused'].includes(phaseToMove.status)) {
            throw new Error('È possibile spostare la fase solo se non è ancora stata avviata o è in pausa.');
        }
        
        const updatedPhases = [...originalPhases];
        const isCurrentlyPostponed = phaseToMove.postponed === true;

        if (!isCurrentlyPostponed) {
          // Logic to move it after the last 'production' phase
          const phasesSorted = [...originalPhases].sort((a, b) => a.sequence - b.sequence);
          const productionPhases = phasesSorted.filter(p => p.type === 'production');
          
          let targetSequence;
          if (productionPhases.length > 0) {
            const lastProductionPhase = productionPhases[productionPhases.length - 1];
            targetSequence = lastProductionPhase.sequence + 0.1; // Place it right after
          } else {
            // Fallback if no production phases exist: move it towards the end but before quality/packaging
            const firstQualityPhase = phasesSorted.find(p => p.type === 'quality' || p.type === 'packaging');
            targetSequence = firstQualityPhase ? firstQualityPhase.sequence - 0.1 : 99;
          }
          
          updatedPhases[phaseIndex].sequence = targetSequence;
          updatedPhases[phaseIndex].postponed = true;

        } else { // 'postponed' -> revert to original
          const templateRef = doc(db, 'workPhaseTemplates', phaseId);
          const templateSnap = await transaction.get(templateRef);
          if (!templateSnap.exists()) {
              throw new Error('Impossibile trovare il modello originale della fase per ripristinare la sequenza.');
          }
          const originalSequence = (templateSnap.data() as WorkPhaseTemplate).sequence;
          updatedPhases[phaseIndex].sequence = originalSequence;
          delete updatedPhases[phaseIndex].postponed;
        }

        const finalPhases = updatePhasesMaterialReadiness(updatedPhases);

        transaction.update(jobRef, { phases: finalPhases });
    });
    
    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);

    return { 
      success: true, 
      message: `Posizione della fase "Taglio Guaina" aggiornata.` 
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error toggling phase position:", error);
    return { success: false, message: errorMessage };
  }
}

export async function revertPhaseCompletion(jobId: string, phaseId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    
    const jobRef = doc(db, 'jobOrders', jobId);
    
    await runTransaction(db, async (transaction) => {
      const jobSnap = await transaction.get(jobRef);
      if (!jobSnap.exists()) {
        throw new Error('Commessa non trovata.');
      }
      
      const jobData = jobSnap.data() as JobOrder;
      const phases = jobData.phases || [];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);
      
      if (phaseIndex === -1) {
        throw new Error('Fase non trovata nella commessa.');
      }
      
      const phaseToRevert = phases[phaseIndex];
      if (phaseToRevert.status !== 'completed') {
        throw new Error('È possibile ripristinare solo una fase già completata.');
      }
      
      // Re-open the phase to 'paused' state, keeping work periods.
      phaseToRevert.status = 'paused';
      phaseToRevert.qualityResult = null; // Also reset quality result if any
      
      const revertedPhases = updatePhasesMaterialReadiness(phases);

      transaction.update(jobRef, { 
          phases: revertedPhases,
          status: 'production', // Ensure the overall job status is reverted from 'completed' if it was
          overallEndTime: null // Clear end time if it was set
      });
    });

    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);
    const phaseName = (await getDoc(jobRef)).data()?.phases.find((p: JobPhase) => p.id === phaseId)?.name;
    return { success: true, message: `Fase "${phaseName || phaseId}" riaperta con successo e messa in pausa.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error reverting phase completion:", error);
    return { success: false, message: errorMessage };
  }
}


export async function forcePauseOperators(jobId: string, operatorIdsToPause: string[], uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    if (!operatorIdsToPause || operatorIdsToPause.length === 0) {
      throw new Error('Nessun operatore selezionato da mettere in pausa.');
    }

    const isGroup = jobId.startsWith('group-');
    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, jobId);

    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) {
        throw new Error('Commessa o Gruppo non trovato.');
      }
      const itemData = itemSnap.data() as JobOrder | WorkGroup;

      const updatedPhases = itemData.phases.map(phase => {
        if (phase.status === 'in-progress') {
          let phaseWasAffected = false;
          const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
            if (wp.end === null && operatorIdsToPause.includes(wp.operatorId)) {
              phaseWasAffected = true;
              return { ...wp, end: new Date() };
            }
            return wp;
          });

          const isAnyoneStillWorking = updatedWorkPeriods.some(wp => wp.end === null);

          if (phaseWasAffected && !isAnyoneStillWorking) {
            return { ...phase, workPeriods: updatedWorkPeriods, status: 'paused' as const };
          } else if (phaseWasAffected) {
            return { ...phase, workPeriods: updatedWorkPeriods };
          }
        }
        return phase;
      });
      
      const newStatus = isAnyPhaseInProgress(updatedPhases) ? 'production' : 'paused';
      
      const updatedItemData = { ...itemData, phases: updatedPhases, status: newStatus };
      
      transaction.update(itemRef, updatedItemData);
      
      if (isGroup) {
        await propagateGroupUpdatesToJobs(transaction, updatedItemData as WorkGroup);
      }
    });
    
    const batch = writeBatch(db);
    operatorIdsToPause.forEach(opId => {
        const operatorRef = doc(db, "operators", opId);
        batch.update(operatorRef, { stato: 'inattivo' });
    });
    await batch.commit();

    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);
    revalidatePath('/admin/reports/operator');
    revalidatePath('/admin/operator-management');
    
    return { success: true, message: `${operatorIdsToPause.length} operatori sono stati messi in pausa e i loro stati aggiornati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error forcing pause:", error);
    return { success: false, message: errorMessage };
  }
}

function isAnyPhaseInProgress(phases: JobPhase[]): boolean {
    return phases.some(p => p.status === 'in-progress');
}


export async function forceCompleteJob(jobId: string, uid: string | undefined | null): Promise<{ success: boolean, message: string }> {
  try {
    await ensureAdmin(uid);
    const jobRef = doc(db, 'jobOrders', jobId);

    await updateDoc(jobRef, {
      status: 'completed',
      overallEndTime: Timestamp.now(),
      forcedCompletion: true, // Add this flag
    });

    revalidatePath('/admin/production-console');
    revalidatePath(`/admin/reports/${jobId}`);
    revalidatePath('/admin/reports');

    return { success: true, message: `Commessa ${jobId} completata con successo.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error forcing job completion:", error);
    return { success: false, message: errorMessage };
  }
}

export async function resetSingleCompletedJobOrder(jobId: string, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    
    const jobRef = doc(db, "jobOrders", jobId);
    const jobSnap = await getDoc(jobRef);
    if (!jobSnap.exists()) {
        throw new Error("Commessa non trovata.");
    }
    const jobData = jobSnap.data() as JobOrder;

    // Find all withdrawals associated with this job
    const withdrawalsQuery = query(collection(db, "materialWithdrawals"), where("jobIds", "array-contains", jobId));
    const withdrawalsSnapshot = await getDocs(withdrawalsQuery);
    const withdrawalsToDelete = withdrawalsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as MaterialWithdrawal));
    
    await runTransaction(db, async (transaction) => {
      // Restore stock from the withdrawals
      const materialUpdates = new Map<string, { consumedWeight: number; consumedUnits: number }>();
      for (const withdrawal of withdrawalsToDelete) {
        const update = materialUpdates.get(withdrawal.materialId) || { consumedWeight: 0, consumedUnits: 0 };
        update.consumedWeight += (withdrawal.consumedWeight as number) || 0;
        if (typeof (withdrawal as any).consumedUnits === 'number') {
            update.consumedUnits += (withdrawal as any).consumedUnits;
        }
        materialUpdates.set(withdrawal.materialId, update);
      }
      
      const materialIds = Array.from(materialUpdates.keys());
      if (materialIds.length > 0) {
        const materialDocs = await Promise.all(materialIds.map(id => transaction.get(doc(db, 'rawMaterials', id))));
        for (const materialDoc of materialDocs) {
          if (materialDoc.exists()) {
            const materialData = materialDoc.data() as RawMaterial;
            const updates = materialUpdates.get(materialDoc.id)!;
            const newWeight = (materialData.currentWeightKg || 0) + updates.consumedWeight;
            let newUnits = (materialData.currentStockUnits || 0) + updates.consumedUnits;
            
            if (materialData.unitOfMeasure === 'kg') {
              newUnits = newWeight;
            } else if (updates.consumedUnits === 0 && materialData.conversionFactor && materialData.conversionFactor > 0) {
               const unitsToAddBack = Math.round(updates.consumedWeight / materialData.conversionFactor);
               newUnits += unitsToAddBack;
            }

            transaction.update(materialDoc.ref, { currentWeightKg: newWeight, currentStockUnits: newUnits });
          }
        }
      }

      // Delete the withdrawals
      for (const withdrawal of withdrawalsToDelete) {
        transaction.delete(doc(db, 'materialWithdrawals', withdrawal.id));
      }

      // Reset the job
      const updatedPhases: JobPhase[] = (jobData.phases || []).map(phase => ({
          ...phase,
          status: 'pending' as const,
          workPeriods: [],
          materialConsumptions: [],
          qualityResult: null,
          materialReady: phase.isIndependent || phase.type === 'preparation',
      }));
      
      transaction.update(jobRef, {
        status: 'planned',
        overallStartTime: null,
        overallEndTime: null,
        isProblemReported: false,
        phases: updatedPhases,
        workGroupId: deleteField(),
      });
    });

    revalidatePath('/admin/production-console');
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');

    return { success: true, message: `Commessa ${jobId} resettata con successo. Le lavorazioni sono state annullate e lo stock è stato ripristinato.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Errore nel reset della commessa:", error);
    return { success: false, message: errorMessage };
  }
}

export async function revertCompletion(itemId: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const collectionName = isGroup ? 'workGroups' : 'jobOrders';
  const itemRef = doc(db, collectionName, itemId);

  try {
      await runTransaction(db, async (transaction) => {
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists()) {
              throw new Error("Commessa o gruppo non trovato.");
          }
          const itemData = itemSnap.data() as JobOrder | WorkGroup;

          // Crucial Check: Only allow reverting if forcedCompletion is true.
          if (!itemData.forcedCompletion) {
              throw new Error("Impossibile riaprire una commessa completata naturalmente. Usa 'Annulla e Resetta' per azzerarla.");
          }
          
          const isAnyPhaseActive = (itemSnap.data().phases || []).some((p: JobPhase) => p.status === 'in-progress');
          const newStatus = isAnyPhaseActive ? 'production' : 'paused';

          const updatePayload: { [key: string]: any } = {
              status: newStatus,
              overallEndTime: deleteField(),
              forcedCompletion: deleteField(), // Remove the flag
          };
          
          transaction.update(itemRef, updatePayload);
          
          if (isGroup) {
              const groupData = itemSnap.data() as WorkGroup;
              (groupData.jobOrderIds || []).forEach(jobId => {
                  const jobRef = doc(db, 'jobOrders', jobId);
                  transaction.update(jobRef, updatePayload);
              });
          }
      });
      
      revalidatePath('/admin/production-console');
      return { success: true, message: "Commessa riaperta con successo allo stato precedente." };
  } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto.";
      console.error("Error reverting completion:", error);
      return { success: false, message: errorMessage };
  }
}


export async function updatePhasesForJob(jobId: string, phases: JobPhase[], uid: string): Promise<{ success: boolean, message: string }> {
  await ensureAdmin(uid);

  try {
    const isGroup = jobId.startsWith('group-');
    const collectionName = isGroup ? 'workGroups' : 'jobOrders';
    const itemRef = doc(db, collectionName, jobId);
    
    // The client sends the phases in the desired order. Here we just re-assign the sequence numbers.
    const resequencedPhases = phases.map((phase, index) => ({
      ...phase,
      sequence: index + 1,
    }));
    
    const finalPhases = updatePhasesMaterialReadiness(resequencedPhases);

    await updateDoc(itemRef, { phases: finalPhases });

    if (isGroup) {
        const groupData = (await getDoc(itemRef)).data() as WorkGroup;
        const batch = writeBatch(db);
        (groupData.jobOrderIds || []).forEach(individualJobId => {
            const jobRef = doc(db, 'jobOrders', individualJobId);
            batch.update(jobRef, { phases: finalPhases });
        });
        await batch.commit();
    }

    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);
    
    return { success: true, message: 'Fasi della commessa aggiornate.' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento delle fasi." };
  }
}

export async function forceFinishMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const batch = writeBatch(db);

  for (const jobId of jobIds) {
    const jobRef = doc(db, 'jobOrders', jobId);
    // Note: This operates on the last known state from the client. For critical ops, a transaction per job is safer.
    // For this admin action, batch is likely acceptable.
     const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists()) continue;
      const job = jobSnap.data() as JobOrder;

      const updatedPhases = job.phases.map(phase => {
        if (phase.type === 'production' && phase.status !== 'completed') {
          return { ...phase, status: 'completed' as const, forced: true };
        }
        return phase;
      });

      const finalPhases = updatePhasesMaterialReadiness(updatedPhases);
      
    batch.update(jobRef, { phases: finalPhases });
  }

  await batch.commit();
  revalidatePath('/admin/production-console');
  return { success: true, message: `${jobIds.length} commesse forzate a finitura.` };
}

export async function forceCompleteMultiple(jobIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const batch = writeBatch(db);

  jobIds.forEach(jobId => {
    const jobRef = doc(db, 'jobOrders', jobId);
    batch.update(jobRef, { status: 'completed', overallEndTime: Timestamp.now(), forcedCompletion: true });
  });

  await batch.commit();
  revalidatePath('/admin/production-console');
  return { success: true, message: `${jobIds.length} commesse sono state chiuse forzatamente.` };
}
    
function updatePhasesMaterialReadiness(phases: JobPhase[]): JobPhase[] {
    const sortedPhases = [...phases].sort((a, b) => a.sequence - b.sequence);

    // This checks if all *preparation* phases that haven't been postponed are complete.
    const allPrepCompleted = sortedPhases
        .filter(p => p.type === 'preparation' && !p.postponed)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    for (let i = 0; i < sortedPhases.length; i++) {
        const currentPhase = sortedPhases[i];

        // An independent phase is always ready, regardless of anything else.
        if (currentPhase.isIndependent) {
            currentPhase.materialReady = true;
            continue;
        }

        // A preparation phase is always considered ready to start.
        if (currentPhase.type === 'preparation') {
            currentPhase.materialReady = true;
            continue;
        }
        
        // --- For sequential phases (production, quality, packaging) ---
        // Rule 1: All non-postponed preparation phases must be complete.
        if (!allPrepCompleted) {
            currentPhase.materialReady = false;
            continue;
        }

        // Rule 2: Find the true preceding sequential phase.
        let previousSequentialPhase: JobPhase | null = null;
        for (let j = i - 1; j >= 0; j--) {
            if (!sortedPhases[j].isIndependent) {
                previousSequentialPhase = sortedPhases[j];
                break;
            }
        }
        
        if (!previousSequentialPhase) {
             // This is the FIRST sequential phase after preparations, so it's ready.
            currentPhase.materialReady = true;
        } else {
            // It's ready if the previous one has been started, completed or skipped.
            const isPreviousStartedOrDone = ['in-progress', 'completed', 'skipped'].includes(previousSequentialPhase.status);
            currentPhase.materialReady = isPreviousStartedOrDone;
        }
    }

    return sortedPhases;
}

export async function reportMaterialMissing(
  itemId: string,
  phaseId: string,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid); // Or a specific operator permission check
  const isGroup = itemId.startsWith('group-');
  const collectionName = isGroup ? 'workGroups' : 'jobOrders';
  const itemRef = doc(db, collectionName, itemId);

  try {
    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato.");
      
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      const phases = [...itemData.phases];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);

      if (phaseIndex === -1) throw new Error("Fase non trovata.");
      
      phases[phaseIndex].materialStatus = 'missing';
      phases[phaseIndex].materialReady = false; // Explicitly set to false

      const operator = (await getDoc(doc(db, 'operators', uid))).data() as Operator;

      // Also set the main problem flag on the job
      transaction.update(itemRef, { 
        phases,
        isProblemReported: true,
        problemType: 'MANCA_MATERIALE',
        problemReportedBy: operator?.nome || 'Admin'
      });
      
      if (isGroup) {
        await propagateGroupUpdatesToJobs(transaction, { ...itemData, phases } as WorkGroup);
      }
    });

    revalidatePath('/admin/production-console');
    revalidatePath('/scan-job');
    return { success: true, message: 'Mancanza materiale segnalata.' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Errore sconosciuto' };
  }
}

export async function resolveMaterialMissing(
  itemId: string,
  phaseId: string,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const isGroup = itemId.startsWith('group-');
  const collectionName = isGroup ? 'workGroups' : 'jobOrders';
  const itemRef = doc(db, collectionName, itemId);

  try {
    await runTransaction(db, async (transaction) => {
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) throw new Error("Commessa o Gruppo non trovato.");
      
      const itemData = itemSnap.data() as JobOrder | WorkGroup;
      let phases = [...itemData.phases];
      const phaseIndex = phases.findIndex(p => p.id === phaseId);

      if (phaseIndex === -1) throw new Error("Fase non trovata.");
      
      phases[phaseIndex].materialStatus = 'available';
      // Recalculate readiness for all phases after resolving
      phases = updatePhasesMaterialReadiness(phases);
      
      // Check if there are any other phases with missing material or other problems
      const anyOtherMissing = phases.some(p => p.materialStatus === 'missing');
      const isOtherProblemPresent = itemData.problemType && itemData.problemType !== 'MANCA_MATERIALE';


      const updatePayload: { [key: string]: any } = { phases };
      if (!anyOtherMissing && !isOtherProblemPresent) {
        // Only resolve the main problem flag if NO other problems exist.
        updatePayload.isProblemReported = false;
        updatePayload.problemType = deleteField();
        updatePayload.problemReportedBy = deleteField();
        updatePayload.problemNotes = deleteField();
      } else if (!anyOtherMissing && isOtherProblemPresent) {
        // If we resolved the material issue, but another problem exists,
        // we keep the main flag but could clear the material-specific type if needed.
        // For simplicity, we just leave it as is. The main flag indicates *a* problem.
      }


      transaction.update(itemRef, updatePayload);
      
      if (isGroup) {
        await propagateGroupUpdatesToJobs(transaction, { ...itemData, ...updatePayload } as WorkGroup);
      }
    });

    revalidatePath('/admin/production-console');
    return { success: true, message: 'Problema materiale risolto.' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Errore sconosciuto' };
  }
}
