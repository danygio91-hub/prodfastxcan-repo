
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, RawMaterialType } from '@/lib/mock-data';
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
  unitOfMeasure: z.enum(['n', 'mt', 'kg']),
  conversionFactor: z.coerce.number().optional().nullable(),
});

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  batchId: z.string().optional(),
  lotto: z.string().optional(),
  date: z.string().min(1, "La data è obbligatoria."),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
});


// --- Actions ---

export async function getRawMaterials(): Promise<RawMaterial[]> {
  const materialsCol = collection(db, 'rawMaterials');
  const snapshot = await getDocs(materialsCol);
  const list = snapshot.docs.map(doc => {
    const data = doc.data() as RawMaterial;
    // The `stock` property is for display purposes on the client.
    // It is calculated from `currentStockUnits` which is the source of truth from Firestore.
    return {
      ...data,
      id: doc.id,
      stock: data.currentStockUnits || 0,
    };
  });
  return list;
}

export async function saveRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; savedMaterial?: RawMaterial; }> {
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
  const conversionFactor = data.unitOfMeasure === 'kg' ? null : data.conversionFactor || null;

  let materialData: Omit<RawMaterial, 'id' | 'batches' | 'stock' | 'currentStockUnits' | 'currentWeightKg'> & { code_normalized: string } = {
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
    conversionFactor: conversionFactor,
  };

  if (data.id) {
    // Update existing material
    const materialRef = doc(db, "rawMaterials", data.id);
    await setDoc(materialRef, materialData, { merge: true });
    
    const updatedDoc = await getDoc(materialRef);
    const savedMaterial = { id: updatedDoc.id, ...updatedDoc.data() } as RawMaterial;

    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiornata con successo.', savedMaterial };
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
    const fullMaterialData: RawMaterial = {
        id: newDocRef.id,
        ...materialData,
        stock: 0,
        currentStockUnits: 0,
        currentWeightKg: 0,
        batches: [],
    }
    await setDoc(newDocRef, fullMaterialData);
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima aggiunta con successo. Aggiungi un lotto per aggiornare lo stock.', savedMaterial: fullMaterialData };
  }
}


export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
  }
  
  const { materialId, date, ddt, quantity, lotto } = validatedFields.data;
  
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      const finalMaterialState = await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          const existingBatches = material.batches || [];
          
          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt,
            quantity,
            lotto: lotto || '', // Ensure lotto is at least an empty string
          };

          const updatedBatches = [...existingBatches, newBatch];
          
          const currentStockUnits = material.currentStockUnits || 0;
          const currentWeightKg = material.currentWeightKg || 0;
          const newStockUnits = currentStockUnits + quantity;
          
          let newWeightKg = currentWeightKg;
          if (material.unitOfMeasure === 'kg') {
              newWeightKg = newStockUnits;
          } else if (material.conversionFactor && material.conversionFactor > 0) {
              newWeightKg += quantity * material.conversionFactor;
          }

          transaction.update(materialRef, { 
              batches: updatedBatches,
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg || 0, // Ensure weight is never undefined
          });

          return { 
              ...material, 
              batches: updatedBatches, 
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg || 0,
              stock: newStockUnits
          };
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/raw-material-scan');
      return { success: true, message: 'Lotto aggiunto con successo. Stock aggiornato.', updatedMaterial: finalMaterialState };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}


export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; }> {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = batchFormSchema.safeParse(rawData);

    if (!validatedFields.success) {
        return { success: false, message: 'Dati del lotto non validi.', errors: validatedFields.error.flatten().fieldErrors };
    }
    const { materialId, batchId, ...newBatchData } = validatedFields.data;
    if (!batchId) {
        return { success: false, message: 'ID del lotto da modificare non fornito.' };
    }

    const materialRef = doc(db, "rawMaterials", materialId);

    try {
        const finalMaterialState = await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) {
                throw new Error('Materia prima non trovata.');
            }

            const material = docSnap.data() as RawMaterial;
            const existingBatches = material.batches || [];
            const batchIndex = existingBatches.findIndex(b => b.id === batchId);

            if (batchIndex === -1) {
                throw new Error('Lotto da modificare non trovato.');
            }

            const updatedBatches = [...existingBatches];
            updatedBatches[batchIndex] = {
                ...updatedBatches[batchIndex],
                ...newBatchData,
                lotto: newBatchData.lotto || '',
                date: new Date(newBatchData.date).toISOString(),
            };
            
            // Recalculate total stock from all batches
            const newStockUnits = updatedBatches.reduce((sum, b) => sum + b.quantity, 0);
            let newWeightKg = 0;
            if (material.unitOfMeasure === 'kg') {
                newWeightKg = newStockUnits;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
                newWeightKg = newStockUnits * material.conversionFactor;
            } else {
                // Cannot calculate weight without a factor, sum up individual weights if they existed
                 newWeightKg = material.currentWeightKg || 0; // Fallback to avoid wiping data
            }

            transaction.update(materialRef, {
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg
            });

            return {
                ...material,
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg,
                stock: newStockUnits
            };
        });

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto aggiornato con successo. Stock ricalcolato.', updatedMaterial: finalMaterialState };

    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento del lotto." };
    }
}

export async function deleteBatchFromRawMaterial(materialId: string, batchId: string): Promise<{ success: boolean; message: string; updatedMaterial?: RawMaterial; }> {
    const materialRef = doc(db, "rawMaterials", materialId);
    
    try {
        const finalMaterialState = await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) {
                throw new Error("Materia prima non trovata.");
            }
            
            const material = docSnap.data() as RawMaterial;
            const existingBatches = material.batches || [];
            const updatedBatches = existingBatches.filter(b => b.id !== batchId);

            if (existingBatches.length === updatedBatches.length) {
                throw new Error("Lotto da eliminare non trovato.");
            }

            const newStockUnits = updatedBatches.reduce((sum, b) => sum + b.quantity, 0);
            let newWeightKg = 0;
            if (material.unitOfMeasure === 'kg') {
                newWeightKg = newStockUnits;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
                newWeightKg = newStockUnits * material.conversionFactor;
            }

            transaction.update(materialRef, { 
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg
            });

             return {
                ...material,
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg,
                stock: newStockUnits
            };
        });

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto eliminato con successo. Stock ricalcolato.', updatedMaterial: finalMaterialState };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'eliminazione del lotto." };
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
      code: z.coerce.string().min(1, "Il campo 'code' è obbligatorio.").optional(),
      type: z.enum(['BOB', 'TUB', 'TUBI', 'PF3V0', 'GUAINA']).optional(),
      description: z.coerce.string().optional(),
      sezione: z.coerce.string().optional(),
      filo_el: z.coerce.string().optional(),
      larghezza: z.coerce.string().optional(),
      tipologia: z.coerce.string().optional(),
      unitOfMeasure: z.enum(['n', 'mt', 'kg']).optional(),
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
        
        let unitOfMeasure: 'n' | 'mt' | 'kg' = 'n';
        const rawUoM = (validData.unitOfMeasure || 'n').toLowerCase();
        if (rawUoM === 'kg') {
            unitOfMeasure = 'kg';
        } else if (rawUoM === 'm' || rawUoM === 'mt') {
            unitOfMeasure = 'mt';
        } else if (rawUoM === 'n') {
            unitOfMeasure = 'n';
        }

        let type: RawMaterialType = 'BOB';
        const rawType = (validData.type || 'BOB').toUpperCase();
        if (rawType === 'TUB' || rawType === 'TUBI') {
            type = 'TUBI';
        } else if (rawType === 'PF3V0') {
            type = 'PF3V0';
        } else if (rawType === 'GUAINA') {
            type = 'GUAINA';
        } else {
            type = 'BOB';
        }


        const newDocRef = doc(materialsRef);
        
        const stockUnits = validData.stock ?? 0;
        const conversionFactor = unitOfMeasure === 'kg' ? null : (validData.conversionFactor || null);
        
        let stockKg = 0;
        if (unitOfMeasure === 'kg') {
            stockKg = stockUnits;
        } else if (conversionFactor && conversionFactor > 0) {
            stockKg = stockUnits * conversionFactor;
        }

        const initialBatch: RawMaterialBatch = {
            id: `batch-import-${Date.now()}`,
            date: new Date().toISOString(),
            ddt: 'Importazione Iniziale',
            quantity: stockUnits,
            lotto: 'IMPORT-INIZIALE',
        };

        const newMaterial: Omit<RawMaterial, 'id'|'stock'> = {
            code: trimmedCode,
            code_normalized: normalizedCode,
            type: type,
            description: validData.description || "N/D",
            details: {
                sezione: validData.sezione || '',
                filo_el: validData.filo_el || '',
                larghezza: validData.larghezza || '',
                tipologia: validData.tipologia || '',
            },
            unitOfMeasure: unitOfMeasure,
            conversionFactor: conversionFactor,
            batches: stockUnits > 0 ? [initialBatch] : [],
            currentStockUnits: stockUnits,
            currentWeightKg: stockKg,
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
