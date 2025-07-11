
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch } from '@/lib/mock-data';
import { format } from 'date-fns';

// --- Schemas ---
const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.enum(['BOB', 'TUBI', 'PF3V0', 'GUAINA'], { errorMap: () => ({ message: 'Selezionare un tipo valido.' }) }),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  sezione: z.string().optional(),
  filo_el: z.string().optional(),
  larghezza: z.string().optional(),
  tipologia: z.string().optional(),
  unitOfMeasure: z.enum(['pz', 'mt', 'kg']),
  conversionFactor: z.coerce.number().optional().nullable(),
});

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  date: z.string().min(1, "La data è obbligatoria."),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
});


// --- Actions ---

export async function getRawMaterials(): Promise<RawMaterial[]> {
  const materialsCol = collection(db, 'rawMaterials');
  const snapshot = await getDocs(materialsCol);
  const list = snapshot.docs.map(doc => {
    const data = doc.data();
    // Provide default values for potentially missing fields to prevent runtime errors
    return {
      id: doc.id,
      type: data.type || 'BOB',
      code: data.code || 'CODICE MANCANTE',
      code_normalized: data.code_normalized || (data.code || '').toLowerCase(),
      description: data.description || 'Nessuna descrizione',
      details: data.details || {},
      unitOfMeasure: data.unitOfMeasure || 'pz',
      conversionFactor: data.conversionFactor === undefined ? null : data.conversionFactor,
      stock: data.stock ?? 0,
      batches: data.batches || [],
    } as RawMaterial;
  });
  return list;
}

export async function saveRawMaterial(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = rawMaterialFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return {
      success: false,
      message: 'Dati del modulo non validi.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const data = validatedFields.data;
  const trimmedCode = data.code.trim();

  const materialData = {
    code: trimmedCode,
    code_normalized: trimmedCode.toLowerCase(),
    type: data.type,
    description: data.description,
    details: {
      sezione: data.sezione || '',
      filo_el: data.filo_el || '',
      larghezza: data.larghezza || '',
      tipologia: data.tipologia || '',
    },
    unitOfMeasure: data.unitOfMeasure,
    conversionFactor: data.unitOfMeasure === 'kg' ? null : data.conversionFactor || null,
  };

  if (data.id) {
    // Update existing material
    const materialRef = doc(db, "rawMaterials", data.id);
    await setDoc(materialRef, materialData, { merge: true });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiornata con successo.' };
  } else {
    // Add new material - check for unique normalized code first
    const normalizedCode = trimmedCode.toLowerCase();
    const q = query(collection(db, "rawMaterials"), where("code_normalized", "==", normalizedCode));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return { success: false, message: `Una materia prima con codice "${trimmedCode}" (o una sua variante maiuscole/minuscole) esiste già.` };
    }

    const newDocRef = doc(collection(db, "rawMaterials"));
    // Initialize with empty stock, which will be updated by adding batches
    const fullMaterialData = {
        ...materialData,
        stock: 0,
        batches: [],
    }
    await setDoc(newDocRef, fullMaterialData);
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiunta con successo. Aggiungi un lotto per aggiornare lo stock.' };
  }
}


export async function addBatchToRawMaterial(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity } = validatedFields.data;
  
  const materialRef = doc(db, "rawMaterials", materialId);
  const docSnap = await getDoc(materialRef);

  if (!docSnap.exists()) {
    return { success: false, message: 'Materia prima non trovata.' };
  }

  const material = docSnap.data() as RawMaterial;
  const existingBatches = material.batches || [];
  
  const newBatch: RawMaterialBatch = {
    id: `batch-${Date.now()}`,
    date: new Date(date).toISOString(),
    ddt,
    quantity,
  };

  const updatedBatches = [...existingBatches, newBatch];
  
  // Recalculate totals based on all batches
  const newTotalStock = updatedBatches.reduce((sum, batch) => sum + batch.quantity, 0);

  await setDoc(materialRef, {
    batches: updatedBatches,
    stock: newTotalStock,
  }, { merge: true });

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/raw-material-scan');
  return { success: true, message: 'Lotto aggiunto con successo. Stock aggiornato.' };
}


export async function deleteRawMaterial(id: string): Promise<{ success: boolean; message: string }> {
  try {
    await deleteDoc(doc(db, "rawMaterials", id));
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima eliminata con successo.' };
  } catch (error) {
    return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}

export async function commitImportedRawMaterials(data: any[]): Promise<{ success: boolean; message: string; }> {
    const importSchema = z.object({
      code: z.coerce.string().min(1, "Il campo 'code' è obbligatorio.").optional(),
      type: z.enum(['BOB', 'TUBI', 'PF3V0', 'GUAINA']).optional(),
      description: z.coerce.string().optional(),
      sezione: z.coerce.string().optional(),
      filo_el: z.coerce.string().optional(),
      larghezza: z.coerce.string().optional(),
      tipologia: z.coerce.string().optional(),
      unitOfMeasure: z.enum(['pz', 'mt', 'kg', 'n', 'm']).optional(),
      conversionFactor: z.coerce.number().optional().nullable(),
      stock: z.coerce.number().min(0).optional(),
    });

    const materialsRef = collection(db, "rawMaterials");
    const existingCodesSnap = await getDocs(query(materialsRef));
    const existingCodes = new Set(existingCodesSnap.docs.map(doc => doc.data().code_normalized));
    
    const batch = writeBatch(db);
    let addedCount = 0;
    let skippedCount = 0;

    for (const row of data) {
        const validated = importSchema.safeParse(row);
        
        if (!validated.success || !validated.data.code) {
            skippedCount++;
            continue;
        }

        const { data: validData } = validated;
        const trimmedCode = validData.code.trim();
        const normalizedCode = trimmedCode.toLowerCase();

        if (!trimmedCode || existingCodes.has(normalizedCode)) {
            skippedCount++;
            continue;
        }
        
        let unitOfMeasure: 'pz' | 'mt' | 'kg' = 'pz';
        const rawUoM = (validData.unitOfMeasure || 'pz').toLowerCase();
        if (rawUoM === 'kg') {
            unitOfMeasure = 'kg';
        } else if (rawUoM === 'm' || rawUoM === 'mt') {
            unitOfMeasure = 'mt';
        } else if (rawUoM === 'n' || rawUoM === 'pz') {
            unitOfMeasure = 'pz';
        }

        const newDocRef = doc(materialsRef);
        
        const stock = validData.stock ?? 0;

        const initialBatch: RawMaterialBatch = {
            id: `batch-import-${Date.now()}`,
            date: new Date().toISOString(),
            ddt: 'Importazione Iniziale',
            quantity: stock,
        };

        const newMaterial: Omit<RawMaterial, 'id'> = {
            code: trimmedCode,
            code_normalized: normalizedCode,
            type: validData.type || 'BOB',
            description: validData.description || "N/D",
            details: {
                sezione: validData.sezione || '',
                filo_el: validData.filo_el || '',
                larghezza: validData.larghezza || '',
                tipologia: validData.tipologia || '',
            },
            unitOfMeasure: unitOfMeasure,
            conversionFactor: unitOfMeasure === 'kg' ? null : (validData.conversionFactor || null),
            stock: initialBatch.quantity,
            batches: [initialBatch],
        };
        batch.set(newDocRef, newMaterial);
        addedCount++;
        existingCodes.add(normalizedCode); // Add to set to prevent duplicates within the same file
    }

    if (addedCount > 0) {
        await batch.commit();
    }
    
    let message = `Importazione completata. ${addedCount} materie prime aggiunte.`;
    if (skippedCount > 0) {
        message += ` ${skippedCount} righe ignorate (dati non validi o codici duplicati/mancanti).`;
    }
    
    revalidatePath('/admin/raw-material-management');
    return { success: true, message };
}
