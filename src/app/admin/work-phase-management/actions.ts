
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
  type WorkPhaseTemplate, 
  type Reparto, 
  reparti,
  initialDepartmentMap
} from '@/lib/mock-data';

// --- Schemas ---
const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCode: z.enum(reparti, {
    errorMap: () => ({ message: 'Selezionare un reparto valido.' }),
  }),
});

// --- Actions ---

export async function getWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
  const templatesCol = collection(db, 'workPhaseTemplates');
  const snapshot = await getDocs(templatesCol);
  const list = snapshot.docs.map(doc => doc.data() as WorkPhaseTemplate);
  return list;
}

export async function getDepartmentMap(): Promise<{ [key in Reparto]: string }> {
  const docRef = doc(db, "configuration", "departmentMap");
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as { [key in Reparto]: string };
  } else {
    // Return initial map if not found in DB
    return initialDepartmentMap;
  }
}


export async function saveWorkPhaseTemplate(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = workPhaseSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { id, name, description, departmentCode } = validatedFields.data;
  
  if (id) {
    // Update existing phase
    const phaseRef = doc(db, "workPhaseTemplates", id);
    await setDoc(phaseRef, { name, description, departmentCode }, { merge: true });
  } else {
    // Add new phase
    const newId = `phase-tpl-${Date.now()}`;
    const phaseRef = doc(db, "workPhaseTemplates", newId);
    const newPhase: WorkPhaseTemplate = { id: newId, name, description, departmentCode };
    await setDoc(phaseRef, newPhase);
  }

  revalidatePath('/admin/work-phase-management');
  return { success: true, message: `Fase di lavorazione salvata con successo.` };
}

export async function deleteWorkPhaseTemplate(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await deleteDoc(doc(db, "workPhaseTemplates", id));
    revalidatePath('/admin/work-phase-management');
    return { success: true, message: 'Fase eliminata con successo.' };
  } catch(error) {
     return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}
