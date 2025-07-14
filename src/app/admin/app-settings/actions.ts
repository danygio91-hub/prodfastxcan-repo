
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, writeBatch, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder } from '@/lib/mock-data';

// The seedDatabase function was moved to the client component
// at /src/app/admin/app-settings/page.tsx to resolve permission errors
// by ensuring the database operation is authenticated with the user's session.

async function deleteAllFromCollection(collectionName: string, batch: FirebaseFirestore.WriteBatch) {
    const ref = collection(db, collectionName);
    const snapshot = await getDocs(ref);
    let count = 0;
    snapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
        count++;
    });
    return count;
}


export async function resetAllJobOrders(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);

    const jobsCount = await deleteAllFromCollection("jobOrders", batch);
    const withdrawalsCount = await deleteAllFromCollection("materialWithdrawals", batch);

    if (jobsCount === 0) {
      return { success: true, message: 'Nessuna commessa trovata. Il database è già pulito.' };
    }

    await batch.commit();

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/reports');
    
    return { success: true, message: `Reset completato. ${jobsCount} commesse e ${withdrawalsCount} prelievi sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle commesse:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllRawMaterials(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
     const batch = writeBatch(db);

    const materialsCount = await deleteAllFromCollection("rawMaterials", batch);
    const withdrawalsCount = await deleteAllFromCollection("materialWithdrawals", batch);
    
    if (materialsCount === 0) {
      return { success: true, message: 'Nessuna materia prima trovata. Il database è già pulito.' };
    }

    await batch.commit();

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/raw-material-scan');
    revalidatePath('/admin/reports'); // Also revalidate reports as withdrawals are gone
    
    return { success: true, message: `Reset completato. ${materialsCount} materie prime e ${withdrawalsCount} prelievi sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle materie prime:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllWithdrawals(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    const deletedCount = await deleteAllFromCollection("materialWithdrawals", batch);

    if (deletedCount === 0) {
      return { success: true, message: 'Nessun prelievo trovato. Il database è già pulito.' };
    }

    await batch.commit();
    revalidatePath('/admin/reports');
    
    return { success: true, message: `Reset completato. ${deletedCount} report di prelievo sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset dei prelievi:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}


export async function resetAllPrivacySignatures(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const operatorsRef = collection(db, "operators");
    
    const querySnapshot = await getDocs(operatorsRef);
    if (querySnapshot.empty) {
      return { success: true, message: 'Nessun operatore trovato.' };
    }

    const batch = writeBatch(db);
    let updatedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
      if (docSnap.data().privacySigned === true) {
        batch.update(docSnap.ref, { privacySigned: false });
        updatedCount++;
      }
    });
    
    if (updatedCount === 0) {
        return { success: true, message: 'Nessuna accettazione della privacy da resettare.' };
    }

    await batch.commit();

    revalidatePath('/admin/operator-management');
    revalidatePath('/operator');
    
    return { success: true, message: `Reset completato. ${updatedCount} firme della privacy sono state annullate.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle firme della privacy:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllWorkInProgress(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);

    // Reset Job Orders in production or suspended
    const jobsRef = collection(db, "jobOrders");
    const jobsQuery = query(jobsRef, where("status", "in", ["production", "suspended"]));
    const jobsSnapshot = await getDocs(jobsQuery);
    
    let jobsResetCount = 0;
    jobsSnapshot.forEach(docSnap => {
      const job = docSnap.data() as JobOrder;
      const updatedPhases = (job.phases || []).map(phase => ({
        ...phase,
        status: 'pending' as const,
        workPeriods: [],
        materialConsumption: null,
        materialReady: !(phase.requiresMaterialScan),
      }));
      
      // Ensure first production phase is ready if no prep phase requires scan
      if (!updatedPhases.some(p => p.type === 'preparation' && p.requiresMaterialScan)) {
          const firstProdPhase = updatedPhases.find(p => p.sequence === 1);
          if (firstProdPhase) {
              firstProdPhase.materialReady = true;
          }
      }

      batch.update(docSnap.ref, {
        status: 'planned',
        overallStartTime: null,
        overallEndTime: null,
        isProblemReported: false,
        phases: updatedPhases,
        postazioneLavoro: 'Da Assegnare',
      });
      jobsResetCount++;
    });

    // Reset Operators' status
    const operatorsRef = collection(db, "operators");
    const opsQuery = query(operatorsRef, where("role", "in", ["operator", "superadvisor"]));
    const operatorsSnapshot = await getDocs(opsQuery);

    let operatorsResetCount = 0;
    operatorsSnapshot.forEach(docSnap => {
      if (docSnap.data().stato !== 'inattivo') {
        batch.update(docSnap.ref, { stato: 'inattivo' });
        operatorsResetCount++;
      }
    });

    if (jobsResetCount === 0 && operatorsResetCount === 0) {
      return { success: true, message: 'Nessuna lavorazione in corso o operatore attivo da resettare.' };
    }

    await batch.commit();

    revalidatePath('/admin/production-console');
    revalidatePath('/admin/data-management');
    revalidatePath('/scan-job');

    return { success: true, message: `Reset completato. ${jobsResetCount} commesse e ${operatorsResetCount} operatori sono stati resettati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle lavorazioni:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

    