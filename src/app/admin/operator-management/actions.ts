
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type Operator, type Department } from '@/lib/mock-data';

const AUTH_EMAIL_DOMAIN = 'prodfastxcan.app';

// --- Schemas ---
const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, 'Il nome è obbligatorio.'),
  email: z.string().email("L'email è obbligatoria e deve essere valida.").refine(email => email.endsWith('@prodfastxcan.app'), {
    message: "L'email deve terminare con @prodfastxcan.app",
  }),
  reparto: z.array(z.string()).max(3, "Massimo 3 reparti.").optional(),
  role: z.enum(['admin', 'supervisor', 'operator'], {
    errorMap: () => ({ message: 'Selezionare un ruolo valido.' }),
  }),
  canAccessInventory: z.boolean().optional(),
}).refine(data => {
    // If the role is 'operator', 'reparto' must be an array with at least one item.
    if (data.role === 'operator') {
        return data.reparto && data.reparto.length > 0;
    }
    // For other roles, this validation is not needed.
    return true;
}, {
    // This message will be shown if the refinement fails.
    message: "Selezionare almeno un reparto per il ruolo operatore.",
    // We target the 'reparto' field for displaying the error.
    path: ["reparto"],
});

// --- Actions ---

export async function getOperators(): Promise<Operator[]> {
  const operatorsCol = collection(db, 'operators');
  const operatorSnapshot = await getDocs(operatorsCol);
  const operatorList = operatorSnapshot.docs.map(doc => doc.data() as Operator);
  return operatorList;
}

export async function getDepartments(): Promise<Department[]> {
  const col = collection(db, "departments");
  const snapshot = await getDocs(col);
  if (snapshot.empty) {
      return [];
  }
  return snapshot.docs.map(d => d.data() as Department);
}

export async function saveOperator(rawData: z.infer<typeof operatorFormSchema>): Promise<{ success: boolean; message: string; errors?: any }> {
  
  const validatedFields = operatorFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }
  
  const { id, email } = validatedFields.data;
  const nome = validatedFields.data.nome.trim();
  const role = validatedFields.data.role;
  const nome_normalized = nome.toLowerCase();
  
  const dataToSave: Partial<Operator> = {
      nome,
      reparto: validatedFields.data.reparto || [],
      role,
      nome_normalized,
      email: email.trim().toLowerCase(), // Use the provided email
      canAccessInventory: validatedFields.data.canAccessInventory || false,
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
