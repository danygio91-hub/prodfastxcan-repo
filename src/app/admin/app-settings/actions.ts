
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';

// The seedDatabase function was moved to the client component
// at /src/app/admin/app-settings/page.tsx to resolve permission errors
// by ensuring the database operation is authenticated with the user's session.

export async function resetAllJobOrders(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobOrdersRef = collection(db, "jobOrders");
    
    const querySnapshot = await getDocs(jobOrdersRef);
    if (querySnapshot.empty) {
      return { success: true, message: 'Nessuna commessa trovata. Il database è già pulito.' };
    }

    const batch = writeBatch(db);
    let deletedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
      batch.delete(docSnap.ref);
      deletedCount++;
    });

    await batch.commit();

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/reports');
    
    return { success: true, message: `Reset completato. ${deletedCount} commesse sono state eliminate.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle commesse:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllRawMaterials(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const rawMaterialsRef = collection(db, "rawMaterials");
    
    const querySnapshot = await getDocs(rawMaterialsRef);
    if (querySnapshot.empty) {
      return { success: true, message: 'Nessuna materia prima trovata. Il database è già pulito.' };
    }

    const batch = writeBatch(db);
    let deletedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
      batch.delete(docSnap.ref);
      deletedCount++;
    });

    await batch.commit();

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/raw-material-scan');
    
    return { success: true, message: `Reset completato. ${deletedCount} materie prime sono state eliminate.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle materie prime:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}
