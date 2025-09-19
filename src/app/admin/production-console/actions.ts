
'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, JobPhase } from '@/lib/mock-data';

export async function forceFinishProduction(jobId: string, uid: string | undefined | null): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);

    const jobRef = doc(db, 'jobOrders', jobId);
    const jobSnap = await getDoc(jobRef);

    if (!jobSnap.exists()) {
      throw new Error('Commessa non trovata.');
    }

    const job = jobSnap.data() as JobOrder;

    // Set all 'production' phases to 'completed'
    const updatedPhases = job.phases.map(phase => {
      if (phase.type === 'production') {
        return { ...phase, status: 'completed' as const };
      }
      return phase;
    });

    // Make the first quality or packaging phase ready
    const firstFinishingPhase = updatedPhases
      .filter(p => p.type === 'quality' || p.type === 'packaging')
      .sort((a, b) => a.sequence - b.sequence)[0];
    
    if (firstFinishingPhase) {
      firstFinishingPhase.materialReady = true;
    }

    await updateDoc(jobRef, { phases: updatedPhases });

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
      // Postpone it. Find the sequence of the "Collaudo" phase or the last production phase.
      const phasesSorted = [...originalPhases].sort((a, b) => a.sequence - b.sequence);
      const collaudoPhase = phasesSorted.find(p => p.name.toLowerCase() === 'collaudo');
      
      let targetSequence;
      if (collaudoPhase) {
        targetSequence = collaudoPhase.sequence + 0.1; // Place it right after "Collaudo"
      } else {
        // Fallback: place it after the last production phase
        const lastProductionPhase = phasesSorted.filter(p => p.type === 'production').pop();
        targetSequence = lastProductionPhase ? lastProductionPhase.sequence + 1 : 99;
      }
      
      updatedPhases[phaseIndex].sequence = targetSequence;

    } else {
      // Restore it to its original sequence of -1.
      updatedPhases[phaseIndex].sequence = -1;
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
