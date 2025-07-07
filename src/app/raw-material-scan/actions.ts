
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
  numUnits: z.coerce.number().optional(),
  numPezziGuaina: z.coerce.number().optional(),
  lunghezzaPezzoGuaina: z.coerce.number().optional(),
  lottoBobina: z.string().optional(),
}).refine(data => {
    // Both or neither of the weight fields must be present
    const hasOpening = data.kgApertura !== undefined;
    const hasClosing = data.kgChiusura !== undefined;
    if (hasOpening !== hasClosing) return false;
    if (data.kgApertura !== undefined && (data.kgApertura < 0 || (data.kgChiusura ?? -1) < 0)) return false;
    return true;
}, {
    message: "Se si inserisce un peso, sia apertura che chiusura sono obbligatori e positivi.",
    path: ["kgChiusura"],
}).refine(data => {
    // Both or neither of the guaina piece fields must be present
    const hasNumPezzi = data.numPezziGuaina !== undefined && data.numPezziGuaina > 0;
    const hasLunghezzaPezzo = data.lunghezzaPezzoGuaina !== undefined && data.lunghezzaPezzoGuaina > 0;
    return hasNumPezzi === hasLunghezzaPezzo;
}, {
    message: "Se si consuma a pezzi, sia il numero di pezzi che la lunghezza sono obbligatori.",
    path: ["lunghezzaPezzoGuaina"],
}).refine(data => {
    const weightProvided = data.kgApertura !== undefined;
    const unitsProvided = data.numUnits !== undefined && data.numUnits > 0;
    const guainaPezziProvided = data.numPezziGuaina !== undefined && data.numPezziGuaina > 0;
    
    const methodsUsed = [weightProvided, unitsProvided, guainaPezziProvided].filter(Boolean).length;
    
    return methodsUsed === 1;
}, {
    message: "Inserire il consumo usando un solo metodo: o KG, o Unità totali, o Pezzi x Lunghezza.",
    path: ["numUnits"],
});


export async function logMaterialConsumption(formData: FormData): Promise<{ success: boolean; message: string; }> {
    const rawData = Object.fromEntries(formData.entries());
    
    // Convert empty strings to undefined so zod's optional works correctly
    Object.keys(rawData).forEach(key => {
        if (rawData[key] === '') {
            delete rawData[key];
        }
    });
    
    const validatedFields = consumptionLogSchema.safeParse(rawData);

    if (!validatedFields.success) {
      const issues = validatedFields.error.flatten().fieldErrors;
      const errorMessage = issues.kgChiusura?.[0] || issues.numUnits?.[0] || issues.lunghezzaPezzoGuaina?.[0] || 'Dati del modulo non validi.';
      return { success: false, message: errorMessage };
    }

    const { materialId, kgApertura, kgChiusura, numUnits, numPezziGuaina, lunghezzaPezzoGuaina, lottoBobina } = validatedFields.data;
    
    const materialRef = doc(db, "rawMaterials", materialId);
    const docSnap = await getDoc(materialRef);

    if (!docSnap.exists()) {
      return { success: false, message: 'Materia prima non trovata.' };
    }

    const material = docSnap.data() as RawMaterial;
    let newStockUnits = material.currentStockUnits;
    let newWeightKg = material.currentWeightKg;
    let messageParts: string[] = [];
    const conversionFactor = material.conversionFactor;

    // Handle units consumption (direct meters, pieces, etc.)
    if (numUnits !== undefined && numUnits > 0) {
        if (newStockUnits < numUnits) {
             return { success: false, message: `Stock unità insufficiente. Disponibili: ${newStockUnits}, richiesti: ${numUnits}.` };
        }
        newStockUnits -= numUnits;
        messageParts.push(`${numUnits} ${material.unitOfMeasure} consumati`);

        if (conversionFactor && conversionFactor > 0) {
            const weightConsumedByUnits = numUnits * conversionFactor;
            if (newWeightKg < weightConsumedByUnits) {
                return { success: false, message: `Stock peso insufficiente per il consumo di ${numUnits} unità. Peso disponibile stimato: ${newWeightKg.toFixed(2)}kg, consumo richiesto: ${weightConsumedByUnits.toFixed(2)}kg.` };
            }
            newWeightKg -= weightConsumedByUnits;
            messageParts[messageParts.length - 1] += ` (~${weightConsumedByUnits.toFixed(2)} kg)`;
        }
    }
    // Handle "Guaina" pieces consumption
    else if (numPezziGuaina !== undefined && lunghezzaPezzoGuaina !== undefined && numPezziGuaina > 0) {
        const totalMetersConsumed = numPezziGuaina * lunghezzaPezzoGuaina;
        if (newStockUnits < totalMetersConsumed) {
            return { success: false, message: `Stock unità insufficiente. Disponibili: ${newStockUnits}, richiesti: ${totalMetersConsumed}.` };
        }
        newStockUnits -= totalMetersConsumed;
        messageParts.push(`${numPezziGuaina} pz x ${lunghezzaPezzoGuaina} ${material.unitOfMeasure} = ${totalMetersConsumed} ${material.unitOfMeasure} consumati`);

        if (conversionFactor && conversionFactor > 0) {
            const weightConsumedByUnits = totalMetersConsumed * conversionFactor;
            if (newWeightKg < weightConsumedByUnits) {
                 return { success: false, message: `Stock peso insufficiente per il consumo di ${totalMetersConsumed} unità. Peso disponibile stimato: ${newWeightKg.toFixed(2)}kg, consumo richiesto: ${weightConsumedByUnits.toFixed(2)}kg.` };
            }
            newWeightKg -= weightConsumedByUnits;
            messageParts[messageParts.length - 1] += ` (~${weightConsumedByUnits.toFixed(2)} kg)`;
        }
    }
    // Handle weight consumption
    else if (kgApertura !== undefined && kgChiusura !== undefined) {
        const weightConsumed = kgApertura - kgChiusura;
        if (weightConsumed < 0) {
             return { success: false, message: 'Il peso di chiusura non può essere maggiore di quello di apertura.' };
        }
        if (newWeightKg < weightConsumed) {
             return { success: false, message: `Stock peso insufficiente. Peso disponibile stimato: ${newWeightKg.toFixed(2)} kg, consumo richiesto: ${weightConsumed.toFixed(2)} kg.` };
        }
        newWeightKg -= weightConsumed;
        messageParts.push(`${weightConsumed.toFixed(2)} kg consumati`);

        if (conversionFactor && conversionFactor > 0 && material.unitOfMeasure !== 'kg') {
            const unitsConsumedByWeight = Math.round(weightConsumed / conversionFactor);
             if (newStockUnits < unitsConsumedByWeight) {
                return { success: false, message: `Stock unità insufficiente per il consumo di ${weightConsumed.toFixed(2)} kg. Unità disponibili: ${newStockUnits}, unità richieste stimate: ${unitsConsumedByWeight}.` };
            }
            newStockUnits -= unitsConsumedByWeight;
            messageParts[messageParts.length-1] += ` (~${unitsConsumedByWeight} ${material.unitOfMeasure})`;
        }

        if (material.unitOfMeasure === 'kg') {
            newStockUnits = newWeightKg;
        }
    }

    await setDoc(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg }, { merge: true });

    revalidatePath('/raw-material-scan');
    
    let successMessage = `Consumo per ${material.code} registrato: ${messageParts.join(' e ')}.`;
    if (lottoBobina) {
      successMessage += ` Lotto: ${lottoBobina}.`;
    }

    return { success: true, message: successMessage };
}
