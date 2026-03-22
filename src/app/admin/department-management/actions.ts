
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Department } from '@/lib/mock-data';

export async function getDepartments(): Promise<Department[]> {
  const snapshot = await adminDb.collection("departments").get();
  if (snapshot.empty) {
      return [];
  }
  return snapshot.docs.map(d => d.data() as Department);
}

export async function saveDepartment(formData: FormData): Promise<{ success: boolean; message: string; }> {
  try {
    const id = formData.get('id') as string | null;
    const code = formData.get('code') as string;
    const name = formData.get('name') as string;
    
    if (!code || !name) {
        return { success: false, message: 'Codice e Nome sono obbligatori.' };
    }

    const docId = id || code; // Use code as ID if new
    const docRef = adminDb.collection("departments").doc(docId);

    if (!id) { // It's a new department, check if code already exists
        const existingDoc = await docRef.get();
        if (existingDoc.exists) {
            return { success: false, message: `Un reparto con codice '${code}' esiste già.` };
        }
    }

    const data: Department = { id: docId, code, name };
    await docRef.set(data, { merge: true });

    revalidatePath('/admin/department-management');
    revalidatePath('/admin/operator-management');

    return { success: true, message: 'Reparto salvato con successo.' };
  } catch (error) {
    return { success: false, message: "Si è verificato un errore durante il salvataggio." };
  }
}

export async function deleteDepartments(ids: string[]): Promise<{ success: boolean; message: string; }> {
    if (!ids || ids.length === 0) {
        return { success: false, message: 'Nessun reparto selezionato.' };
    }
    try {
        const batch = adminDb.batch();
        ids.forEach(id => {
            batch.delete(adminDb.collection("departments").doc(id));
        });
        await batch.commit();

        revalidatePath('/admin/department-management');
        revalidatePath('/admin/operator-management');
        
        return { success: true, message: `${ids.length} reparti eliminati.` };
    } catch (error) {
         return { success: false, message: "Si è verificato un errore durante l'eliminazione." };
    }
}
