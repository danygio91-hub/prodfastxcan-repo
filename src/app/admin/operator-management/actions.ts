

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type Operator, type Reparto, reparti } from '@/lib/mock-data';

const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

// --- Schemas ---
const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, 'Il nome è obbligatorio.'),
  cognome: z.string().optional(),
  email: z.string().email("L'email è obbligatoria e deve essere valida."),
  reparto: z.array(z.string()).min(1, "Selezionare almeno un reparto.").max(3, "Massimo 3 reparti."),
  role: z.enum(['admin', 'superadvisor', 'operator'], {
    errorMap: () => ({ message: 'Selezionare un ruolo valido.' }),
  }),
});

// --- Actions ---

export async function getOperators(): Promise<Operator[]> {
  const operatorsCol = collection(db, 'operators');
  const operatorSnapshot = await getDocs(operatorsCol);
  const operatorList = operatorSnapshot.docs.map(doc => doc.data() as Operator);
  return operatorList;
}

export async function saveOperator(formData: FormData) {
  const rawData = {
    id: formData.get('id') || undefined,
    nome: formData.get('nome'),
    cognome: formData.get('cognome'),
    email: formData.get('email'),
    role: formData.get('role'),
    reparto: formData.getAll('reparto'),
  };

  let validatedFields = operatorFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }
  
  if (validatedFields.data.role === 'admin') {
    validatedFields.data.reparto = ['N/D'];
  }

  const { id, email } = validatedFields.data;
  const nome = validatedFields.data.nome.trim();
  const cognome = (validatedFields.data.cognome || '').trim();
  
  // Filter out any reparti that are not in the official list.
  const reparto = validatedFields.data.reparto.filter(r => (reparti as readonly string[]).includes(r)) as Reparto[];

  const role = validatedFields.data.role;
  const nome_normalized = nome.toLowerCase();
  
  const dataToSave: Partial<Operator> = {
      nome,
      cognome,
      reparto,
      role,
      nome_normalized,
      email: email.trim().toLowerCase(), // Use the provided email
  };

  if (id) {
    // Update existing operator
    const operatorRef = doc(db, "operators", id);
    await setDoc(operatorRef, dataToSave, { merge: true });
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore aggiornato con successo.' };
  } else {
    // Add new operator
    const newId = `op-${Date.now()}`;
    const operatorRef = doc(db, "operators", newId);
    const newOperator: Operator = {
      id: newId,
      ...dataToSave,
      stato: 'inattivo', // Default state for new operators
      password: '1234', // Default password for new operators
      privacySigned: false, // Default privacy status
    } as Operator;
    await setDoc(operatorRef, newOperator);
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore aggiunto con successo.' };
  }
}

export async function deleteOperator(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await deleteDoc(doc(db, "operators", id));
    revalidatePath('/admin/operator-management');
    return { success: true, message: 'Operatore eliminato con successo.' };
  } catch (error) {
    console.error("Error deleting operator:", error);
    return { success: false, message: 'Errore durante l\'eliminazione dell\'operatore.' };
  }
}
