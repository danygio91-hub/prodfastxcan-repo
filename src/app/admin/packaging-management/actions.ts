
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Packaging, PackagingAssociation } from '@/lib/mock-data';

// --- Schemas ---
const packagingSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().optional(),
  weightKg: z.coerce.number().min(0, 'Il peso non può essere negativo.'),
  associatedTypes: z.array(z.string()).optional(),
});

// --- Actions ---

export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const snapshot = await getDocs(packagingCol);
  return snapshot.docs.map(d => d.data() as Packaging);
}

export async function savePackagingItem(formData: FormData) {
  const rawData = {
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    description: formData.get('description'),
    weightKg: formData.get('weightKg'),
    associatedTypes: formData.getAll('associatedTypes'),
  };
  
  const validatedFields = packagingSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { id, ...dataToSave } = validatedFields.data;
  
  const finalId = id || `pack-${Date.now()}`;
  const packagingRef = doc(db, 'packaging', finalId);

  const fullData: Packaging = { 
    id: finalId, 
    ...dataToSave,
    associatedTypes: (dataToSave.associatedTypes || []) as PackagingAssociation[],
  };
  
  await setDoc(packagingRef, fullData, { merge: true });
  
  revalidatePath('/admin/packaging-management');
  return { success: true, message: 'Imballo salvato con successo.' };
}

export async function deletePackagingItem(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await deleteDoc(doc(db, 'packaging', id));
    revalidatePath('/admin/packaging-management');
    return { success: true, message: 'Imballo eliminato con successo.' };
  } catch (error) {
    console.error("Error deleting packaging item:", error);
    return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}
