'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial } from '@/lib/mock-data';

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
  currentStockPcs: z.coerce.number().min(0, 'Lo stock non può essere negativo.').default(0),
  currentWeightKg: z.coerce.number().min(0, 'Il peso non può essere negativo.').default(0),
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
  const materialData: Omit<RawMaterial, 'id'> = {
    code: data.code,
    type: data.type,
    description: data.description,
    details: {
      sezione: data.sezione || '',
      filo_el: data.filo_el || '',
      larghezza: data.larghezza || '',
      tipologia: data.tipologia || '',
    },
    currentStockPcs: data.currentStockPcs,
    currentWeightKg: data.currentWeightKg,
  };

  if (data.id) {
    // Update existing material
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
    await setDoc(newDocRef, materialData);
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiunta con successo.' };
  }
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
      currentStockPcs: z.coerce.number().min(0).optional().default(0),
      currentWeightKg: z.coerce.number().min(0).optional().default(0),
    });

    const materialsRef = collection(db, "rawMaterials");
    const existingCodesSnap = await getDocs(query(materialsRef, where('code', 'in', data.map(d => d.code).filter(Boolean))));
    const existingCodes = new Set(existingCodesSnap.docs.map(doc => doc.data().code));
    
    const batch = writeBatch(db);
    let addedCount = 0;
    let skippedCount = 0;
    let errorMessages: string[] = [];

    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success || existingCodes.has(row.code)) {
            skippedCount++;
            if(!validated.success) {
              errorMessages.push(`Riga per codice ${row.code || 'sconosciuto'} ignorata: ${validated.error.flatten().fieldErrors.code}`);
            } else {
              errorMessages.push(`Riga per codice ${row.code} ignorata: codice già esistente.`);
            }
            continue;
        }

        const { data: validData } = validated;
        const newDocRef = doc(materialsRef);
        const newMaterial: Omit<RawMaterial, 'id'> = {
            code: validData.code,
            type: validData.type,
            description: validData.description || "N/D",
            details: {
                sezione: validData.sezione || '',
                filo_el: validData.filo_el || '',
                larghezza: validData.larghezza || '',
                tipologia: validData.tipologia || '',
            },
            currentStockPcs: validData.currentStockPcs,
            currentWeightKg: validData.currentWeightKg,
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
