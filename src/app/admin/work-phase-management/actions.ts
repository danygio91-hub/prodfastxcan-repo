
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { mockWorkPhaseTemplates, type WorkPhaseTemplate, type Reparto, reparti } from '@/lib/mock-data';

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
  // Return a deep copy to avoid mutations affecting the store directly
  return JSON.parse(JSON.stringify(mockWorkPhaseTemplates));
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
    const index = mockWorkPhaseTemplates.findIndex((phase) => phase.id === id);
    if (index === -1) {
      return { success: false, message: 'Fase non trovata.' };
    }
    mockWorkPhaseTemplates[index] = { id, name, description, departmentCode };
  } else {
    // Add new phase
    const newId = `phase-tpl-${Date.now()}`;
    const newPhase: WorkPhaseTemplate = { id: newId, name, description, departmentCode };
    mockWorkPhaseTemplates.push(newPhase);
  }

  revalidatePath('/admin/work-phase-management');
  return { success: true, message: `Fase di lavorazione salvata con successo.` };
}

export async function deleteWorkPhaseTemplate(id: string): Promise<{ success: boolean; message: string }> {
  const index = mockWorkPhaseTemplates.findIndex((phase) => phase.id === id);
  if (index === -1) {
    return { success: false, message: 'Fase non trovata.' };
  }

  mockWorkPhaseTemplates.splice(index, 1);
  revalidatePath('/admin/work-phase-management');
  return { success: true, message: 'Fase eliminata con successo.' };
}
