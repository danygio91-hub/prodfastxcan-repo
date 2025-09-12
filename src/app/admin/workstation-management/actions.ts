

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
    type Workstation, 
    type Reparto, 
    initialDepartmentMap 
} from '@/lib/mock-data';

// --- Schemas ---
const workstationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  departmentCode: z.string().min(1, 'Selezionare un reparto.'),
});

// --- Actions ---

export async function getWorkstations(): Promise<Workstation[]> {
  const workstationsCol = collection(db, 'workstations');
  const snapshot = await getDocs(workstationsCol);
  const list = snapshot.docs.map(doc => doc.data() as Workstation);
  return list;
}

export async function getDepartmentMap(): Promise<Record<Reparto, string>> {
    const docRef = doc(db, "configuration", "departmentMap");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as Record<Reparto, string>;
    }
    return initialDepartmentMap;
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
    const wsRef = doc(db, "workstations", id);
    await setDoc(wsRef, { name, departmentCode }, { merge: true });
  } else {
    // Add new - check for uniqueness
    const q = query(collection(db, "workstations"), where("name", "==", name));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        return { success: false, message: `Una postazione con nome "${name}" esiste già.` };
    }

    const newId = `ws-${Date.now()}`;
    const wsRef = doc(db, "workstations", newId);
    const newWorkstation: Workstation = { id: newId, name, departmentCode };
    await setDoc(wsRef, newWorkstation);
  }

  revalidatePath('/admin/workstation-management');
  return { success: true, message: `Postazione salvata con successo.` };
}

export async function deleteWorkstation(id: string): Promise<{ success: boolean; message: string }> {
    try {
        await deleteDoc(doc(db, "workstations", id));
        revalidatePath('/admin/workstation-management');
        return { success: true, message: 'Postazione eliminata con successo.' };
    } catch(e) {
        return { success: false, message: 'Errore durante l\'eliminazione.' };
    }
}
