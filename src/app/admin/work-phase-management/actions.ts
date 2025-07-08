

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc, writeBatch, query, orderBy } from 'firebase/firestore';
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
  departmentCodes: z.array(z.enum(reparti)).min(1, 'Selezionare almeno un reparto.'),
  type: z.enum(['preparation', 'production', 'quality']),
  requiresMaterialScan: z.preprocess((val) => val === 'on' || val === true, z.boolean()).optional(),
});

// --- Actions ---

export async function getWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
  const templatesCol = collection(db, 'workPhaseTemplates');
  const q = query(templatesCol, orderBy("sequence"));
  const snapshot = await getDocs(q);
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
    const rawData = {
        id: formData.get('id') || undefined,
        name: formData.get('name'),
        description: formData.get('description'),
        departmentCodes: formData.getAll('departmentCodes'),
        type: formData.get('type'),
        requiresMaterialScan: formData.get('requiresMaterialScan'),
    };

    const validatedFields = workPhaseSchema.safeParse(rawData);

    if (!validatedFields.success) {
        return {
        success: false,
        message: 'Dati del modulo non validi.',
        errors: validatedFields.error.flatten().fieldErrors,
        };
    }

    const { id, name, description, departmentCodes, type, requiresMaterialScan } = validatedFields.data;

    const dataToSave: Partial<WorkPhaseTemplate> = {
        name,
        description,
        departmentCodes,
        type,
        requiresMaterialScan: type === 'quality' ? false : (requiresMaterialScan || false),
    };

    if (id) {
        // Update existing phase
        const phaseRef = doc(db, "workPhaseTemplates", id);
        await setDoc(phaseRef, dataToSave, { merge: true });
        revalidatePath('/admin/work-phase-management');
        return { success: true, message: 'Fase di lavorazione aggiornata con successo.' };
    } else {
        // Add new phase
        const templatesCol = collection(db, 'workPhaseTemplates');
        const snapshot = await getDocs(templatesCol);
        
        let newSequence: number;
        const sequences = snapshot.docs.map(doc => doc.data().sequence || 0);

        if (type === 'production' || type === 'quality') {
            const prodSequences = sequences.filter(s => s >= 0);
            newSequence = prodSequences.length > 0 ? Math.max(...prodSequences) + 1 : 1;
        } else { // preparation
            const prepSequences = sequences.filter(s => s < 0);
            newSequence = prepSequences.length > 0 ? Math.min(...prepSequences) - 1 : -1;
        }

        const newId = `phase-tpl-${Date.now()}`;
        const phaseRef = doc(db, "workPhaseTemplates", newId);
        const newPhase: WorkPhaseTemplate = { 
            id: newId, 
            name, 
            description, 
            departmentCodes,
            type,
            requiresMaterialScan: dataToSave.requiresMaterialScan,
            sequence: newSequence,
        };
        await setDoc(phaseRef, newPhase);
        revalidatePath('/admin/work-phase-management');
        return { success: true, message: `Fase di lavorazione aggiunta con successo.` };
    }
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

export async function deleteSelectedWorkPhaseTemplates(ids: string[]): Promise<{ success: boolean; message: string }> {
    if (!ids || ids.length === 0) {
        return { success: false, message: 'Nessun ID fornito per l\'eliminazione.' };
    }
    const batch = writeBatch(db);
    ids.forEach(id => {
        const docRef = doc(db, "workPhaseTemplates", id);
        batch.delete(docRef);
    });
    await batch.commit();
    revalidatePath('/admin/work-phase-management');
    return { success: true, message: `${ids.length} fasi eliminate con successo.` };
}


export async function updatePhasesOrder(phases: { id: string; sequence: number }[]): Promise<{ success: boolean; message: string }> {
    if (!phases || phases.length === 0) {
        return { success: false, message: 'Nessuna fase fornita per l\'aggiornamento.' };
    }
    try {
        const batch = writeBatch(db);
        phases.forEach(phase => {
            const docRef = doc(db, "workPhaseTemplates", phase.id);
            batch.update(docRef, { sequence: phase.sequence });
        });
        await batch.commit();
        revalidatePath('/admin/work-phase-management');
        return { success: true, message: 'Ordine delle fasi aggiornato con successo.' };
    } catch (error) {
        return { success: false, message: 'Errore durante l\'aggiornamento dell\'ordine.' };
    }
}
