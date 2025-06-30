
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { mockWorkstations, type Workstation, type Reparto, reparti } from '@/lib/mock-data';

// --- Schemas ---
const workstationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  departmentCode: z.enum(reparti, {
    errorMap: () => ({ message: 'Selezionare un reparto valido.' }),
  }),
});

// --- Actions ---

export async function getWorkstations(): Promise<Workstation[]> {
  // Return a deep copy
  return JSON.parse(JSON.stringify(mockWorkstations));
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
    const index = mockWorkstations.findIndex((ws) => ws.id === id);
    if (index === -1) {
      return { success: false, message: 'Postazione non trovata.' };
    }
    mockWorkstations[index] = { id, name, departmentCode };
  } else {
    // Add new
    // Check for duplicate name
    if (mockWorkstations.some(ws => ws.name.toLowerCase() === name.toLowerCase())) {
        return { success: false, message: `Una postazione con nome "${name}" esiste già.` };
    }
    const newId = `ws-${Date.now()}`;
    const newWorkstation: Workstation = { id: newId, name, departmentCode };
    mockWorkstations.push(newWorkstation);
  }

  revalidatePath('/admin/workstation-management');
  return { success: true, message: `Postazione salvata con successo.` };
}

export async function deleteWorkstation(id: string): Promise<{ success: boolean; message: string }> {
  const index = mockWorkstations.findIndex((ws) => ws.id === id);
  if (index === -1) {
    return { success: false, message: 'Postazione non trovata.' };
  }

  mockWorkstations.splice(index, 1);
  revalidatePath('/admin/workstation-management');
  return { success: true, message: 'Postazione eliminata con successo.' };
}
