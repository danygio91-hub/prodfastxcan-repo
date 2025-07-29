
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where, writeBatch, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type WorkCycle, type WorkPhaseTemplate } from '@/lib/mock-data';

// --- Schemas ---
const workCycleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome del ciclo deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione è obbligatoria.'),
  phaseTemplateIds: z.array(z.string()).min(1, 'Selezionare almeno una fase di lavorazione.'),
});

// --- Actions ---

export async function getWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
  const templatesCol = collection(db, 'workPhaseTemplates');
  const q = query(templatesCol, orderBy("sequence"));
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => doc.data() as WorkPhaseTemplate);
  return list;
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const cyclesCol = collection(db, 'workCycles');
  const snapshot = await getDocs(cyclesCol);
  const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as WorkCycle);
  return list;
}

export async function saveWorkCycle(formData: FormData) {
  const rawData = {
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    description: formData.get('description'),
    phaseTemplateIds: formData.getAll('phaseTemplateIds'),
  };

  const validatedFields = workCycleSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { id, name, description, phaseTemplateIds } = validatedFields.data;

  const dataToSave: Omit<WorkCycle, 'id'> = {
    name,
    description,
    phaseTemplateIds,
  };

  if (id) {
    // Update existing cycle
    const cycleRef = doc(db, "workCycles", id);
    await setDoc(cycleRef, dataToSave, { merge: true });
    revalidatePath('/admin/work-cycle-management');
    return { success: true, message: 'Ciclo di lavorazione aggiornato con successo.' };
  } else {
    // Add new cycle
    const newId = `wc-${Date.now()}`;
    const cycleRef = doc(db, "workCycles", newId);
    await setDoc(cycleRef, dataToSave);
    revalidatePath('/admin/work-cycle-management');
    return { success: true, message: 'Ciclo di lavorazione creato con successo.' };
  }
}

export async function deleteWorkCycle(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await deleteDoc(doc(db, "workCycles", id));
    revalidatePath('/admin/work-cycle-management');
    return { success: true, message: 'Ciclo di lavorazione eliminato con successo.' };
  } catch(error) {
    console.error("Error deleting work cycle:", error);
    return { success: false, message: 'Errore durante l\'eliminazione del ciclo.' };
  }
}

export async function deleteSelectedWorkCycles(ids: string[]): Promise<{ success: boolean; message: string }> {
    if (!ids || ids.length === 0) {
        return { success: false, message: 'Nessun ID fornito per l\'eliminazione.' };
    }
    const batch = writeBatch(db);
    ids.forEach(id => {
        const docRef = doc(db, "workCycles", id);
        batch.delete(docRef);
    });
    await batch.commit();
    revalidatePath('/admin/work-cycle-management');
    return { success: true, message: `${ids.length} cicli eliminati con successo.` };
}

    
