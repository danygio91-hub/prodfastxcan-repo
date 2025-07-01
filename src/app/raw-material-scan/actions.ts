
'use server';

import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

export async function getRawMaterialByCode(code: string): Promise<RawMaterial | { error: string; title?: string }> {
  const materialsRef = collection(db, "rawMaterials");
  const q = query(materialsRef, where("code", "==", code));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
     // Let's try to create a mock one if not found for demo purposes
    if (code.startsWith('BOB') || code.startsWith('TUBI')) {
        const type = code.startsWith('BOB') ? 'BOB' : 'TUBI';
        const newMaterial: Omit<RawMaterial, 'id'> = {
            code: code,
            type: type,
            description: `Descrizione per ${code}`,
            details: {
                sezione: "Sezione Placeholder",
                filo_el: "Filo Elettrico Placeholder",
                larghezza: "Larghezza Placeholder",
                tipologia: "Tipologia Placeholder",
            },
            currentStockPcs: 100,
            currentWeightKg: 50,
        };
        const newDocRef = doc(materialsRef); // Create a new doc with auto-generated ID
        await setDoc(newDocRef, newMaterial);
        
        return { ...newMaterial, id: newDocRef.id };
    }

    return {
      error: `Materia prima con codice "${code}" non trovata.`,
      title: 'Materiale non Trovato',
    };
  }

  const docSnap = querySnapshot.docs[0];
  const material = docSnap.data() as RawMaterial;
  material.id = docSnap.id;

  return JSON.parse(JSON.stringify(material)); // Serialize to avoid non-serializable data issues
}

const stockUpdateSchema = z.object({
  materialId: z.string(),
  peso: z.coerce.number().optional(),
  ingresso: z.coerce.number().optional(),
  uscita: z.coerce.number().optional(),
});


export async function updateRawMaterialStock(formData: FormData): Promise<{ success: boolean; message: string; }> {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = stockUpdateSchema.safeParse(rawData);

    if (!validatedFields.success) {
      return { success: false, message: 'Dati del modulo non validi.' };
    }

    const { materialId, peso, ingresso, uscita } = validatedFields.data;
    
    const materialRef = doc(db, "rawMaterials", materialId);
    const docSnap = await getDoc(materialRef);

    if (!docSnap.exists()) {
      return { success: false, message: 'Materia prima non trovata. Impossibile aggiornare.' };
    }

    const material = docSnap.data() as RawMaterial;
    let newStock = material.currentStockPcs || 0;
    let newWeight = material.currentWeightKg; // Keep existing weight unless specified
    
    let messageParts: string[] = [];

    if (ingresso !== undefined && ingresso > 0) {
        newStock += ingresso;
        messageParts.push(`${ingresso} pz in ingresso`);
    }

    if (uscita !== undefined && uscita > 0) {
        if (newStock < uscita) {
            return { success: false, message: `Stock insufficiente. Disponibili: ${newStock}, richiesti in uscita: ${uscita}.` };
        }
        newStock -= uscita;
        messageParts.push(`${uscita} pz in uscita`);
    }
    
    if (peso !== undefined) {
        newWeight = peso;
        messageParts.push(`peso aggiornato a ${peso} kg`);
    }
    
    if (messageParts.length === 0) {
        return { success: false, message: 'Nessuna operazione da eseguire. Compilare almeno un campo.' };
    }
    
    await setDoc(materialRef, { currentStockPcs: newStock, currentWeightKg: newWeight }, { merge: true });

    revalidatePath('/raw-material-scan');
    
    return { success: true, message: `Aggiornamento per ${material.code} completato: ${messageParts.join(', ')}.` };
}
