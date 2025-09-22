
'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase, WorkPhaseTemplate } from '@/lib/mock-data';

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
          if (phase.type === 'production') {
            return { ...phase, status: 'completed' as const };
          }
          return phase;
        });

        const firstFinishingPhase = updatedPhases
          .filter(p => p.status === 'pending' && p.type !== 'production' && p.type !== 'preparation')
          .sort((a, b) => a.sequence - b.sequence)[0];
        
        if (firstFinishingPhase) {
          firstFinishingPhase.materialReady = true;
        }
        
        transaction.update(jobRef, { phases: updatedPhases });
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
      const phasesSorted = [...originalPhases].sort((a, b) => a.sequence - b.sequence);
      const collaudoPhase = phasesSorted.find(p => p.name.toLowerCase() === 'collaudo');
      
      let targetSequence;
      if (collaudoPhase) {
        targetSequence = collaudoPhase.sequence - 0.1;
      } else {
        const lastProductionPhase = phasesSorted.filter(p => p.type === 'production').pop();
        targetSequence = lastProductionPhase ? lastProductionPhase.sequence + 1 : 99;
      }
      
      updatedPhases[phaseIndex].sequence = targetSequence;

    } else {
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
      
      // Reset the phase
      phaseToRevert.status = 'pending';
      phaseToRevert.workPeriods = [];
      phaseToRevert.qualityResult = null;
      phaseToRevert.materialConsumptions = [];
      
      // If reverting a preparation phase, the material readiness for the first production phase might need to be reset.
      // Or if reverting any phase, the next phase readiness might need to be re-evaluated.
      // Simple approach: reset readiness for all subsequent phases
      const revertedPhaseSequence = phaseToRevert.sequence;
      const updatedPhases = phases.map(p => {
        if (p.sequence > revertedPhaseSequence && p.type !== 'preparation') {
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
    return { success: true, message: `Fase "${phases.find(p=>p.id===phaseId)?.name}" ripristinata con successo.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore.";
    console.error("Error reverting phase completion:", error);
    return { success: false, message: errorMessage };
  }
}
