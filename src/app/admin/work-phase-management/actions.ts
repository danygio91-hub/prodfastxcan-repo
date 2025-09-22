

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc, writeBatch, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
  type WorkPhaseTemplate, 
  type RawMaterialType, // Import RawMaterialType
  type Department,
} from '@/lib/mock-data';

// --- Schemas ---
const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCodes: z.array(z.string()).min(1, 'Selezionare almeno un reparto.'),
  type: z.enum(['preparation', 'production', 'quality', 'packaging']),
  tracksTime: z.preprocess((val) => val === 'on' || val === true, z.boolean()).optional(),
  requiresMaterialScan: z.preprocess((val) => val === 'on' || val === true, z.boolean()).optional(),
  requiresMaterialSearch: z.preprocess((val) => val === 'on' || val === true, z.boolean()).optional(),
  allowedMaterialTypes: z.array(z.string()).optional(), // Keep as string array
});

// --- Actions ---

export async function getWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
  const templatesCol = collection(db, 'workPhaseTemplates');
  const q = query(templatesCol, orderBy("sequence"));
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => doc.data() as WorkPhaseTemplate);
  return list;
}

export async function getDepartments(): Promise<Department[]> {
  const col = collection(db, "departments");
  const snapshot = await getDocs(col);
  if (snapshot.empty) {
      return [];
  }
  return snapshot.docs.map(d => d.data() as Department);
}


export async function saveWorkPhaseTemplate(formData: FormData) {
    const rawData = {
        id: formData.get('id') || undefined,
        name: formData.get('name'),
        description: formData.get('description'),
        departmentCodes: formData.getAll('departmentCodes'),
        type: formData.get('type'),
        tracksTime: formData.get('tracksTime'),
        requiresMaterialScan: formData.get('requiresMaterialScan'),
        requiresMaterialSearch: formData.get('requiresMaterialSearch'),
        allowedMaterialTypes: formData.getAll('allowedMaterialTypes'),
    };

    // We can't use the enum from mock-data anymore as it's dynamic
    const dynamicWorkPhaseSchema = workPhaseSchema.extend({
        departmentCodes: z.array(z.string()).min(1, 'Selezionare almeno un reparto.'),
    });

    const validatedFields = dynamicWorkPhaseSchema.safeParse(rawData);

    if (!validatedFields.success) {
        return {
        success: false,
        message: 'Dati del modulo non validi.',
        errors: validatedFields.error.flatten().fieldErrors,
        };
    }

    const { id, name, description, departmentCodes, type, tracksTime, requiresMaterialScan, requiresMaterialSearch, allowedMaterialTypes } = validatedFields.data;

    const dataToSave: Partial<WorkPhaseTemplate> = {
        name,
        description,
        departmentCodes,
        type,
        tracksTime: tracksTime || false,
        requiresMaterialScan: type === 'quality' ? false : (requiresMaterialScan || false),
        requiresMaterialSearch: type === 'quality' ? false : (requiresMaterialSearch || false),
        allowedMaterialTypes: (allowedMaterialTypes as RawMaterialType[]) || [],
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

        if (type === 'production' || type === 'quality' || type === 'packaging') {
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
            tracksTime: dataToSave.tracksTime,
            requiresMaterialScan: dataToSave.requiresMaterialScan,
            requiresMaterialSearch: dataToSave.requiresMaterialSearch,
            allowedMaterialTypes: dataToSave.allowedMaterialTypes,
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
