
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


const consumptionLogSchema = z.object({
  materialId: z.string(),
  kgApertura: z.coerce.number().optional(),
  kgChiusura: z.coerce.number().optional(),
  notaLordoNetto: z.string().optional(),
  numPz: z.coerce.number().optional(),
}).refine(data => {
    // If kgApertura is provided, kgChiusura must also be provided
    if (data.kgApertura !== undefined && data.kgChiusura === undefined) return false;
    // If kgChiusura is provided, kgApertura must also be provided
    if (data.kgChiusura !== undefined && data.kgApertura === undefined) return false;
    return true;
}, {
    message: "Se si inserisce un peso, sia apertura che chiusura sono obbligatori.",
    path: ["kgChiusura"],
});


export async function logMaterialConsumption(formData: FormData): Promise<{ success: boolean; message: string; }> {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = consumptionLogSchema.safeParse(rawData);

    if (!validatedFields.success) {
      return { success: false, message: 'Dati del modulo non validi.', errors: validatedFields.error.flatten().fieldErrors };
    }

    const { materialId, kgApertura, kgChiusura, numPz } = validatedFields.data;
    
    if (kgApertura === undefined && numPz === undefined) {
         return { success: false, message: 'Nessun dato di consumo inserito (Pezzi o Pesi).' };
    }
    
    const materialRef = doc(db, "rawMaterials", materialId);
    const docSnap = await getDoc(materialRef);

    if (!docSnap.exists()) {
      return { success: false, message: 'Materia prima non trovata.' };
    }

    const material = docSnap.data() as RawMaterial;
    let newStockPcs = material.currentStockPcs;
    let newWeightKg = material.currentWeightKg;
    let messageParts: string[] = [];

    // Handle pieces consumption
    if (numPz !== undefined && numPz > 0) {
        if (newStockPcs < numPz) {
             return { success: false, message: `Stock pezzi insufficiente. Disponibili: ${newStockPcs}, richiesti: ${numPz}.` };
        }
        newStockPcs -= numPz;
        messageParts.push(`${numPz} pz consumati`);
    }

    // Handle weight consumption
    if (kgApertura !== undefined && kgChiusura !== undefined) {
        const weightConsumed = kgApertura - kgChiusura;
        if (weightConsumed < 0) {
             return { success: false, message: 'Il peso di chiusura non può essere maggiore di quello di apertura.' };
        }
        if (newWeightKg < weightConsumed) {
             return { success: false, message: `Stock peso insufficiente. Peso disponibile stimato: ${newWeightKg} kg, consumo richiesto: ${weightConsumed.toFixed(2)} kg.` };
        }
        newWeightKg -= weightConsumed;
        messageParts.push(`${weightConsumed.toFixed(2)} kg consumati`);
    }

    if (messageParts.length === 0) {
        return { success: false, message: 'Nessun consumo valido da registrare. Controllare i campi.' };
    }

    await setDoc(materialRef, { currentStockPcs: newStockPcs, currentWeightKg: newWeightKg }, { merge: true });

    revalidatePath('/raw-material-scan');
    
    return { success: true, message: `Consumo per ${material.code} registrato: ${messageParts.join(' e ')}.` };
}
