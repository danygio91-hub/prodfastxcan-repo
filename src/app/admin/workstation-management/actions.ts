

'use server';

// @ts-ignore
import { revalidatePath } from 'next/cache';
// @ts-ignore
import * as z from 'zod';
import { adminDb } from '@/lib/firebase-admin';
// @ts-ignore
import admin from 'firebase-admin';
import {
  type Workstation,
  type Department,
} from '@/types';

// --- Schemas ---
const workstationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  departmentCode: z.string().min(1, 'Selezionare un reparto.'),
});

// --- Actions ---

export async function getWorkstations(): Promise<Workstation[]> {
  const snapshot = await adminDb.collection('workstations').get();
  const list = snapshot.docs.map((doc: any) => doc.data() as Workstation);
  return list;
}

export async function getDepartments(): Promise<Department[]> {
  const snapshot = await adminDb.collection("departments").get();
  if (snapshot.empty) {
    return [];
  }
  return snapshot.docs.map((d: any) => d.data() as Department);
}

export async function saveWorkstation(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = workstationSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { id, name, departmentCode } = validatedFields.data;

  if (id) {
    // Update
    await adminDb.collection("workstations").doc(id).set({ name, departmentCode }, { merge: true });
  } else {
    // Add new - check for uniqueness
    const querySnapshot = await adminDb.collection("workstations").where("name", "==", name).get();
    if (!querySnapshot.empty) {
      return { success: false, message: `Una postazione con nome "${name}" esiste già.` };
    }

    const newId = `ws-${Date.now()}`;
    const wsRef = adminDb.collection("workstations").doc(newId);
    const newWorkstation: Workstation = { id: newId, name, departmentCode };
    await wsRef.set(newWorkstation);
  }

  revalidatePath('/admin/workstation-management');
  return { success: true, message: `Postazione salvata con successo.` };
}

export async function deleteWorkstation(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await adminDb.collection("workstations").doc(id).delete();
    revalidatePath('/admin/workstation-management');
    return { success: true, message: 'Postazione eliminata con successo.' };
  } catch (e) {
    return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}
