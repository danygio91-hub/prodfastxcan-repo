'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { mockOperators, type Operator } from '@/lib/mock-data';

// --- Schemas ---
const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, 'Il nome è obbligatorio.'),
  cognome: z.string().min(1, 'Il cognome è obbligatorio.'),
  reparto: z.enum(['CP', 'CG', 'BF', 'MAG', 'N/D'], {
    errorMap: () => ({ message: 'Selezionare un reparto valido.' }),
  }),
});

// --- Actions ---

export async function getOperators(): Promise<Operator[]> {
  // Return a deep copy to avoid mutations affecting the store directly
  return JSON.parse(JSON.stringify(mockOperators));
}

export async function saveOperator(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = operatorFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }
  
  const { id, nome, cognome, reparto } = validatedFields.data;

  if (id) {
    // Update existing operator
    const index = mockOperators.findIndex((op) => op.id === id);
    if (index === -1) {
      return { success: false, message: 'Operatore non trovato.' };
    }
    mockOperators[index] = { ...mockOperators[index], nome, cognome, reparto };
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore aggiornato con successo.' };
  } else {
    // Add new operator
    const newId = `op-${Date.now()}`;
    const newOperator: Operator = {
      id: newId,
      nome,
      cognome,
      reparto,
      stato: 'inattivo', // Default state for new operators
      password: '1234', // Default password for new operators
      role: 'operator', // Default role for new operators
    };
    mockOperators.push(newOperator);
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore aggiunto con successo.' };
  }
}

export async function deleteOperator(id: string): Promise<{ success: boolean; message: string }> {
  const index = mockOperators.findIndex((op) => op.id === id);
  if (index === -1) {
    return { success: false, message: 'Operatore non trovato.' };
  }

  mockOperators.splice(index, 1);
  revalidatePath('/admin/operator-management');
  return { success: true, message: 'Operatore eliminato con successo.' };
}
