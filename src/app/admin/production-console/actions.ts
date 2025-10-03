

'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, updateDoc, runTransaction, writeBatch, collection, getDocs, query, where, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, WorkPhaseTemplate, Operator, WorkGroup, MaterialWithdrawal, RawMaterial } from '@/lib/mock-data';
import { dissolveWorkGroup } from '../work-group-management/actions';

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
            return { ...phase, status: 'completed' as const };
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


export async function toggleGuainaPhasePosition(jobId: string, phaseId: string, currentState: 'default' | 'postponed'): Promise<{ success: boolean; message: string }> {
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
    const jobSnap = await getDoc(jobRef);

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

    if (phaseToMove.status !== 'pending') {
      throw new Error('È possibile spostare la fase solo se non è ancora stata avviata.');
    }
    
    const updatedPhases = [...originalPhases];

    if (currentState === 'default') {
      // Logic to move it before 'Collaudo'
      const phasesSorted = [...originalPhases].sort((a, b) => a.sequence - b.sequence);
      const collaudoPhase = phasesSorted.find(p => p.name.toLowerCase() === 'collaudo' || p.type === 'quality');
      
      let targetSequence;
      if (collaudoPhase) {
        targetSequence = collaudoPhase.sequence - 0.1;
      } else {
        // Fallback: move it to the end of production phases
        const lastProductionPhase = phasesSorted.filter(p => p.type === 'production').pop();
        targetSequence = lastProductionPhase ? lastProductionPhase.sequence + 1 : 99;
      }
      
      updatedPhases[phaseIndex].sequence = targetSequence;

    } else {
      // Restore original sequence from template
      const templateRef = doc(db, 'workPhaseTemplates', phaseId);
      const templateSnap = await getDoc(templateRef);
      if (!templateSnap.exists()) {
          throw new Error('Impossibile trovare il modello originale della fase per ripristinare la sequenza.');
      }
      const originalSequence = (templateSnap.data() as WorkPhaseTemplate).sequence;
      updatedPhases[phaseIndex].sequence = originalSequence;
    }

    await updateDoc(jobRef, { phases: updatedPhases });
    
    revalidatePath('/admin/production-console');
    revalidatePath(`/scan-job?jobId=${jobId}`);

    return { 
      success: true, 
      message: `Posizione della fase "Taglio Guaina" ${currentState === 'default' ? 'posticipata' : 'ripristinata'}.` 
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
      
      // Reset readiness for all subsequent phases to ensure flow integrity
      const revertedPhaseSequence = phaseToRevert.sequence;
      const updatedPhases = phases.map(p => {
        if (p.sequence > revertedPhaseSequence) {
            // Keep material readiness for preparation phases
            if (p.type === 'preparation') {
                return p;
            }
            return {...p, materialReady: false};
        }
        if (p.id === phaseId) {
            return phaseToRevert;
        }
        return p;
      });

      transaction.update(jobRef, { 
          phases: updatedPhases,
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
          materialReady: phase.type === 'preparation',
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
    

    



