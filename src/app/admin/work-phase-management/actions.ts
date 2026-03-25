

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
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
  tracksTime: z.boolean().default(true).optional(),
  requiresMaterialScan: z.boolean().default(false).optional(),
  requiresMaterialSearch: z.boolean().default(false).optional(),
  requiresMaterialAssociation: z.boolean().default(false).optional(),
  allowedMaterialTypes: z.array(z.string()).optional(), // Keep as string array
  isIndependent: z.boolean().default(false).optional(),
});

// --- Actions ---

export async function getWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
  const snapshot = await adminDb.collection('workPhaseTemplates').orderBy("name").get();
  const list = snapshot.docs.map(doc => doc.data() as WorkPhaseTemplate);
  return list;
}

export async function getDepartments(): Promise<Department[]> {
  const snapshot = await adminDb.collection("departments").get();
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
        tracksTime: formData.get('tracksTime') === 'on',
        requiresMaterialScan: formData.get('requiresMaterialScan') === 'on',
        requiresMaterialSearch: formData.get('requiresMaterialSearch') === 'on',
        requiresMaterialAssociation: formData.get('requiresMaterialAssociation') === 'on',
        allowedMaterialTypes: formData.getAll('allowedMaterialTypes'),
        isIndependent: formData.get('isIndependent') === 'on',
    };

    const validatedFields = workPhaseSchema.safeParse(rawData);

    if (!validatedFields.success) {
        return {
        success: false,
        message: 'Dati del modulo non validi.',
        errors: validatedFields.error.flatten().fieldErrors,
        };
    }

    const { id, name, description, departmentCodes, type, tracksTime, requiresMaterialScan, requiresMaterialSearch, requiresMaterialAssociation, allowedMaterialTypes, isIndependent } = validatedFields.data;

    const dataToSave: Partial<WorkPhaseTemplate> = {
        name,
        description,
        departmentCodes,
        type,
        tracksTime: tracksTime,
        requiresMaterialScan: type === 'quality' ? false : requiresMaterialScan,
        requiresMaterialSearch: type === 'quality' ? false : requiresMaterialSearch,
        requiresMaterialAssociation: requiresMaterialAssociation,
        allowedMaterialTypes: (allowedMaterialTypes as RawMaterialType[]) || [],
        isIndependent: isIndependent,
    };

    if (id) {
        // Update existing phase
        await adminDb.collection("workPhaseTemplates").doc(id).set(dataToSave, { merge: true });
        revalidatePath('/admin/work-phase-management');
        return { success: true, message: 'Fase di lavorazione aggiornata con successo.' };
    } else {
        // Add new phase
        const newId = `phase-tpl-${Date.now()}`;
        const phaseRef = adminDb.collection("workPhaseTemplates").doc(newId);
        const newPhase: WorkPhaseTemplate = { 
            id: newId, 
            name, 
            description, 
            departmentCodes,
            type,
            tracksTime: dataToSave.tracksTime,
            requiresMaterialScan: dataToSave.requiresMaterialScan,
            requiresMaterialSearch: dataToSave.requiresMaterialSearch,
            requiresMaterialAssociation: dataToSave.requiresMaterialAssociation,
            allowedMaterialTypes: dataToSave.allowedMaterialTypes,
            isIndependent: dataToSave.isIndependent,
            // Sequence removed
        };
        await phaseRef.set(newPhase);
        revalidatePath('/admin/work-phase-management');
        return { success: true, message: `Fase di lavorazione aggiunta con successo.` };
    }
}


export async function deleteWorkPhaseTemplate(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await adminDb.collection("workPhaseTemplates").doc(id).delete();
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
    const batch = adminDb.batch();
    ids.forEach(id => {
        const docRef = adminDb.collection("workPhaseTemplates").doc(id);
        batch.delete(docRef);
    });
    await batch.commit();
    revalidatePath('/admin/work-phase-management');
    return { success: true, message: `${ids.length} fasi eliminate con successo.` };
}

