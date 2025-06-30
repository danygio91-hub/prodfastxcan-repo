
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { 
    getWorkstationsStore, 
    saveWorkstationsStore, 
    getDepartmentMapStore,
    type Workstation, 
    type Reparto, 
    reparti 
} from '@/lib/mock-data';

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
  const workstations = await getWorkstationsStore();
  return JSON.parse(JSON.stringify(workstations));
}

export async function getDepartmentMap(): Promise<{ [key in Reparto]: string }> {
    const map = await getDepartmentMapStore();
    return JSON.parse(JSON.stringify(map));
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
  const mockWorkstations = await getWorkstationsStore();

  if (id) {
    // Update
    const index = mockWorkstations.findIndex((ws) => ws.id === id);
    if (index === -1) {
      return { success: false, message: 'Postazione non trovata.' };
    }
    mockWorkstations[index] = { id, name, departmentCode };
  } else {
    // Add new
    if (mockWorkstations.some(ws => ws.name.toLowerCase() === name.toLowerCase())) {
        return { success: false, message: `Una postazione con nome "${name}" esiste già.` };
    }
    const newId = `ws-${Date.now()}`;
    const newWorkstation: Workstation = { id: newId, name, departmentCode };
    mockWorkstations.push(newWorkstation);
  }

  await saveWorkstationsStore(mockWorkstations);
  revalidatePath('/admin/workstation-management');
  return { success: true, message: `Postazione salvata con successo.` };
}

export async function deleteWorkstation(id: string): Promise<{ success: boolean; message: string }> {
  const mockWorkstations = await getWorkstationsStore();
  const index = mockWorkstations.findIndex((ws) => ws.id === id);
  if (index === -1) {
    return { success: false, message: 'Postazione non trovata.' };
  }

  mockWorkstations.splice(index, 1);
  await saveWorkstationsStore(mockWorkstations);
  revalidatePath('/admin/workstation-management');
  return { success: true, message: 'Postazione eliminata con successo.' };
}
