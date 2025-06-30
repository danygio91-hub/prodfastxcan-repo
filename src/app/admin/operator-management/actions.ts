
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { getOperatorsStore, saveOperatorsStore, type Operator } from '@/lib/mock-data';

// --- Schemas ---
const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, 'Il nome è obbligatorio.'),
  cognome: z.string().min(1, 'Il cognome è obbligatorio.'),
  reparto: z.enum(['CP', 'CG', 'BF', 'MAG', 'N/D', 'Officina'], {
    errorMap: () => ({ message: 'Selezionare un reparto valido.' }),
  }),
  role: z.enum(['admin', 'superadvisor', 'operator'], {
    errorMap: () => ({ message: 'Selezionare un ruolo valido.' }),
  }),
});

// --- Actions ---

export async function getOperators(): Promise<Operator[]> {
  const operators = await getOperatorsStore();
  // Return a deep copy to avoid mutations affecting the store directly
  return JSON.parse(JSON.stringify(operators));
}

export async function saveOperator(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  let validatedFields = operatorFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }
  
  if (validatedFields.data.role === 'admin') {
    validatedFields.data.reparto = 'N/D';
  } else if (validatedFields.data.role === 'superadvisor') {
    validatedFields.data.reparto = 'Officina';
  }

  const { id, nome, cognome, reparto, role } = validatedFields.data;
  const mockOperators = await getOperatorsStore();

  if (id) {
    // Update existing operator
    const index = mockOperators.findIndex((op) => op.id === id);
    if (index === -1) {
      return { success: false, message: 'Operatore non trovato.' };
    }
    mockOperators[index] = { ...mockOperators[index], nome, cognome, reparto, role };
    await saveOperatorsStore(mockOperators);
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
      role,
      stato: 'inattivo', // Default state for new operators
      password: '1234', // Default password for new operators
      privacySigned: false, // Default privacy status
    };
    mockOperators.push(newOperator);
    await saveOperatorsStore(mockOperators);
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore aggiunto con successo.' };
  }
}

export async function deleteOperator(id: string): Promise<{ success: boolean; message: string }> {
  const mockOperators = await getOperatorsStore();
  const index = mockOperators.findIndex((op) => op.id === id);
  if (index === -1) {
    return { success: false, message: 'Operatore non trovato.' };
  }

  mockOperators.splice(index, 1);
  await saveOperatorsStore(mockOperators);
  revalidatePath('/admin/operator-management');
  return { success: true, message: 'Operatore eliminato con successo.' };
}
