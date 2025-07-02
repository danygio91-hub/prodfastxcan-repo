
'use server';

import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

export async function getRawMaterialByCode(code: string): Promise<RawMaterial | { error: string; title?: string }> {
  const materialsRef = collection(db, "rawMaterials");
  const normalizedCode = code.trim().toLowerCase();
  
  if (!normalizedCode) {
     return {
      error: `Il codice inserito è vuoto.`,
      title: 'Codice Vuoto',
    };
  }
  
  const q = query(materialsRef, where("code_normalized", "==", normalizedCode));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return {
      error: `Materia prima con codice "${code}" non trovata. Verificare il codice o aggiungerla dall'area amministrazione.`,
      title: 'Materiale non Trovato',
    };
  }

  const docSnap = querySnapshot.docs[0];
  const material = docSnap.data() as RawMaterial;
  material.id = docSnap.id;

  return JSON.parse(JSON.stringify(material)); // Serialize to avoid non-serializable data issues
}

export async function searchRawMaterials(searchTerm: string): Promise<Pick<RawMaterial, 'id' | 'code' | 'description'>[]> {
  if (!searchTerm || searchTerm.trim().length < 2) { // Only search if term is long enough
    return [];
  }
  const lowerCaseSearchTerm = searchTerm.toLowerCase();
  const materialsRef = collection(db, "rawMaterials");
  
  // Query for codes starting with the search term (case-insensitive)
  const q = query(
    materialsRef,
    where("code_normalized", ">=", lowerCaseSearchTerm),
    where("code_normalized", "<=", lowerCaseSearchTerm + '\uf8ff'),
    limit(10)
  );

  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return [];
  }

  const materials = querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      code: data.code,
      description: data.description,
    };
  }) as Pick<RawMaterial, 'id' | 'code' | 'description'>[];

  return JSON.parse(JSON.stringify(materials));
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
