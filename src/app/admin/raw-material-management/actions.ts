
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
  type: z.enum(['BOB', 'TUBI'], { errorMap: () => ({ message: 'Selezionare un tipo valido.' }) }),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  sezione: z.string().optional(),
  filo_el: z.string().optional(),
  larghezza: z.string().optional(),
  tipologia: z.string().optional(),
});

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  date: z.string().min(1, "La data è obbligatoria."),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantityPcs: z.coerce.number().min(0, "La quantità non può essere negativa."),
  weightKg: z.coerce.number().min(0, "Il peso non può essere negativo."),
});


// --- Actions ---

export async function getRawMaterials(): Promise<RawMaterial[]> {
  const materialsCol = collection(db, 'rawMaterials');
  const snapshot = await getDocs(materialsCol);
  const list = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as RawMaterial);
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
  const materialData = {
    code: data.code,
    code_normalized: data.code.toLowerCase(),
    type: data.type,
    description: data.description,
    details: {
      sezione: data.sezione || '',
      filo_el: data.filo_el || '',
      larghezza: data.larghezza || '',
      tipologia: data.tipologia || '',
    },
  };

  if (data.id) {
    // Update existing material (only descriptive fields)
    const materialRef = doc(db, "rawMaterials", data.id);
    await setDoc(materialRef, materialData, { merge: true });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiornata con successo.' };
  } else {
    // Add new material - check for unique code first
    const q = query(collection(db, "rawMaterials"), where("code", "==", data.code));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return { success: false, message: `Una materia prima con codice "${data.code}" esiste già.` };
    }

    const newDocRef = doc(collection(db, "rawMaterials"));
    // Initialize with empty stock, which will be updated by adding batches
    const fullMaterialData = {
        ...materialData,
        currentStockPcs: 0,
        currentWeightKg: 0,
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
  
  const { materialId, date, ddt, quantityPcs, weightKg } = validatedFields.data;
  
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
    quantityPcs,
    weightKg,
  };

  const updatedBatches = [...existingBatches, newBatch];
  
  // Recalculate totals based on all batches
  const newTotalPcs = updatedBatches.reduce((sum, batch) => sum + batch.quantityPcs, 0);
  const newTotalKg = updatedBatches.reduce((sum, batch) => sum + (batch.weightKg || 0), 0);

  await setDoc(materialRef, {
    batches: updatedBatches,
    currentStockPcs: newTotalPcs,
    currentWeightKg: newTotalKg,
  }, { merge: true });

  revalidatePath('/admin/raw-material-management');
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
      code: z.coerce.string().min(1, "Il campo 'code' è obbligatorio."),
      type: z.enum(['BOB', 'TUBI']),
      description: z.coerce.string().optional(),
      sezione: z.coerce.string().optional(),
      filo_el: z.coerce.string().optional(),
      larghezza: z.coerce.string().optional(),
      tipologia: z.coerce.string().optional(),
      stock_pcs: z.coerce.number().min(0).optional().default(0),
      weight_kg: z.coerce.number().min(0).optional().default(0),
    });

    const materialsRef = collection(db, "rawMaterials");
    const existingCodesSnap = await getDocs(query(materialsRef));
    const existingCodes = new Set(existingCodesSnap.docs.map(doc => doc.data().code));
    
    const batch = writeBatch(db);
    let addedCount = 0;
    let skippedCount = 0;

    for (const row of data) {
        const codeToCheck = row && row.code ? String(row.code) : null;
        const validated = importSchema.safeParse(row);
        
        if (!validated.success || !codeToCheck || existingCodes.has(codeToCheck)) {
            skippedCount++;
            continue;
        }

        const { data: validData } = validated;
        const newDocRef = doc(materialsRef);
        
        const initialBatch: RawMaterialBatch = {
            id: `batch-import-${Date.now()}`,
            date: new Date().toISOString(),
            ddt: 'Importazione Iniziale',
            quantityPcs: validData.stock_pcs,
            weightKg: validData.weight_kg,
        };

        const newMaterial: Omit<RawMaterial, 'id'> = {
            code: validData.code,
            code_normalized: validData.code.toLowerCase(),
            type: validData.type,
            description: validData.description || "N/D",
            details: {
                sezione: validData.sezione || '',
                filo_el: validData.filo_el || '',
                larghezza: validData.larghezza || '',
                tipologia: validData.tipologia || '',
            },
            currentStockPcs: initialBatch.quantityPcs,
            currentWeightKg: initialBatch.weightKg,
            batches: [initialBatch],
        };
        batch.set(newDocRef, newMaterial);
        addedCount++;
    }

    if (addedCount > 0) {
        await batch.commit();
    }
    
    let message = `Importazione completata. ${addedCount} materie prime aggiunte.`;
    if (skippedCount > 0) {
        message += ` ${skippedCount} righe ignorate (dati mancanti, non validi o codici duplicati).`;
    }
    
    revalidatePath('/admin/raw-material-management');
    return { success: true, message };
}
