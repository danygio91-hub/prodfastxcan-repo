

'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc, runTransaction, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, RawMaterialType, MaterialWithdrawal, Packaging } from '@/lib/mock-data';
import { format } from 'date-fns';

// Helper to convert Firestore Timestamps to Dates in nested objects
function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj.toDate && typeof obj.toDate === 'function') {
        return obj.toDate();
    }
    if (Array.isArray(obj)) {
        return obj.map(item => convertTimestampsToDates(item));
    }
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
        newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
}

/**
 * Centralized function to recalculate stock totals from batches.
 * This is the single source of truth for stock calculation.
 * @param material The raw material object.
 * @param batches The array of batches to calculate from.
 * @returns An object with the new currentStockUnits and currentWeightKg.
 */
function recalculateStock(material: RawMaterial, batches: RawMaterialBatch[]): { currentStockUnits: number; currentWeightKg: number } {
  let newTotalStockUnits = 0;
  let newTotalWeightKg = 0;

  for (const batch of batches) {
    const batchNetQuantity = batch.netQuantity || 0;
    if (material.unitOfMeasure === 'kg') {
      newTotalStockUnits += batchNetQuantity;
      newTotalWeightKg += batchNetQuantity;
    } else { // 'n' or 'mt'
      newTotalStockUnits += batchNetQuantity;
      if (material.conversionFactor && material.conversionFactor > 0) {
        newTotalWeightKg += batchNetQuantity * material.conversionFactor;
      }
    }
  }

  return {
    currentStockUnits: newTotalStockUnits,
    currentWeightKg: newTotalWeightKg,
  };
}


// --- Schemas ---
const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.enum(['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA'], { errorMap: () => ({ message: 'Selezionare un tipo valido.' }) }),
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
  netQuantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
  packagingId: z.string().optional(),
});


// --- Actions ---

export async function getRawMaterials(): Promise<RawMaterial[]> {
  const materialsCol = collection(db, 'rawMaterials');
  const snapshot = await getDocs(materialsCol);
  const list = snapshot.docs.map(doc => {
    const data = doc.data() as RawMaterial;
    return {
      ...data,
      id: doc.id,
      currentStockUnits: data.currentStockUnits ?? 0,
      currentWeightKg: data.currentWeightKg ?? 0,
    };
  });
  return list;
}

export async function saveRawMaterial(formData: FormData): Promise<{
    success: boolean;
    message: string;
    errors?: any;
}> {
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
    conversionFactor: data.conversionFactor || null,
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
    return { success: true, message: 'Materia prima aggiunta con successo. Aggiungi un lotto per aggiornare lo stock.' };
  }
}


export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = batchFormSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati del lotto non validi.' };
  }
  
  const { materialId, date, ddt, netQuantity, lotto, packagingId } = validatedFields.data;
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          let tareWeight = 0;
          
          if (material.unitOfMeasure === 'kg' && packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists()) {
              tareWeight = packagingSnap.data().weightKg || 0;
            }
          }

          const grossWeight = netQuantity + tareWeight;
          
          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(date).toISOString(),
            ddt: ddt || 'CARICO_MANUALE',
            netQuantity: netQuantity,
            tareWeight: tareWeight,
            grossWeight: grossWeight,
            packagingId: packagingId,
            lotto: lotto || null,
          };

          const updatedBatches = [...(material.batches || []), newBatch];
          const newStock = recalculateStock(material, updatedBatches);
          
          transaction.update(materialRef, { 
              batches: updatedBatches,
              ...newStock,
          });
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/raw-material-scan');
      return { success: true, message: 'Lotto aggiunto con successo. Stock aggiornato.' };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}


export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
    const rawData = Object.fromEntries(formData.entries());
    const validatedFields = batchFormSchema.safeParse(rawData);

    if (!validatedFields.success) {
        return { success: false, message: 'Dati del lotto non validi.' };
    }
    const { materialId, batchId, ...newBatchData } = validatedFields.data;
    if (!batchId) {
        return { success: false, message: 'ID del lotto da modificare non fornito.' };
    }

    const materialRef = doc(db, "rawMaterials", materialId);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) {
                throw new Error('Materia prima non trovata.');
            }

            const material = docSnap.data() as RawMaterial;
            const existingBatches = material.batches || [];
            const oldBatchIndex = existingBatches.findIndex(b => b.id === batchId);

            if (oldBatchIndex === -1) {
                throw new Error('Lotto da modificare non trovato.');
            }
            
            const oldBatch = existingBatches[oldBatchIndex];

            let tareWeight = 0;
            if (material.unitOfMeasure === 'kg' && newBatchData.packagingId && newBatchData.packagingId !== 'none') {
                const packagingRef = doc(db, 'packaging', newBatchData.packagingId);
                const packagingSnap = await transaction.get(packagingRef);
                if (packagingSnap.exists()) {
                    tareWeight = packagingSnap.data().weightKg || 0;
                }
            }
            
            const grossWeight = newBatchData.netQuantity + tareWeight;
            
            const updatedBatch: RawMaterialBatch = {
                ...oldBatch,
                ddt: newBatchData.ddt,
                lotto: newBatchData.lotto || null,
                date: new Date(newBatchData.date).toISOString(),
                netQuantity: newBatchData.netQuantity,
                tareWeight: tareWeight,
                grossWeight: grossWeight,
                packagingId: newBatchData.packagingId,
            };
            
            const updatedBatches = [...existingBatches];
            updatedBatches[oldBatchIndex] = updatedBatch;

            const newStock = recalculateStock(material, updatedBatches);

            transaction.update(materialRef, {
                batches: updatedBatches,
                ...newStock
            });
        });

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto aggiornato con successo. Stock ricalcolato.' };

    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento del lotto." };
    }
}

export async function deleteBatchFromRawMaterial(materialId: string, batchId: string): Promise<{ success: boolean; message: string; }> {
    const materialRef = doc(db, "rawMaterials", materialId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) {
                throw new Error("Materia prima non trovata.");
            }
            
            const material = docSnap.data() as RawMaterial;
            const existingBatches = material.batches || [];
            
            const batchToDelete = existingBatches.find(b => b.id === batchId);
            if (!batchToDelete) throw new Error("Lotto da eliminare non trovato.");

            const updatedBatches = existingBatches.filter(b => b.id !== batchId);

            const newStock = recalculateStock(material, updatedBatches);

            transaction.update(materialRef, { 
                batches: updatedBatches,
                ...newStock
            });
        });

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto eliminato con successo. Stock ricalcolato.' };
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

export async function deleteSelectedRawMaterials(ids: string[]): Promise<{ success: boolean, message: string }> {
  if (!ids || ids.length === 0) {
    return { success: false, message: 'Nessuna materia prima selezionata.' };
  }

  const batch = writeBatch(db);
  ids.forEach(id => {
    const docRef = doc(db, 'rawMaterials', id);
    batch.delete(docRef);
  });

  try {
    await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${ids.length} materie prime sono state eliminate.` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore durante l'eliminazione.";
    return { success: false, message: errorMessage };
  }
}


export async function commitImportedRawMaterials(data: any[]): Promise<{ success: boolean; message: string; }> {
    const importSchema = z.object({
      code: z.coerce.string().min(1, "Il campo 'code' è obbligatorio.").optional(),
      type: z.enum(['BOB', 'TUB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA']).optional(),
      description: z.coerce.string().optional(),
      sezione: z.coerce.string().optional(),
      filo_el: z.coerce.string().optional(),
      larghezza: z.coerce.string().optional(),
      tipologia: z.coerce.string().optional(),
      unitOfMeasure: z.enum(['n', 'mt', 'kg', 'm']).optional(),
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
        
        if (!validated.success) {
            skippedCount++;
            continue;
        }

        const { data: validData } = validated;
        
        if (!validData.code) {
          skippedCount++;
          continue;
        }

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
        } else {
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
        } else if (rawType === 'BARRA') {
            type = 'BARRA';
        } else {
            type = 'BOB';
        }


        const newDocRef = doc(materialsRef);
        
        const conversionFactor = unitOfMeasure === 'kg' ? null : (validData.conversionFactor || null);
        
        let stockKg = 0;
        let stockUnits = 0;

        if (validData.stock) {
            if (unitOfMeasure === 'kg') {
                stockKg = validData.stock;
                stockUnits = validData.stock; 
            } else { // Unit is 'n' or 'mt'
                stockUnits = validData.stock;
                // Calculate weight from units if possible
                if (conversionFactor && conversionFactor > 0) {
                    stockKg = stockUnits * conversionFactor;
                }
            }
        }
        
        const initialBatch: RawMaterialBatch | null = stockUnits > 0 ? {
            id: `batch-import-${Date.now()}-${addedCount}`,
            date: new Date().toISOString(),
            ddt: 'Importazione Iniziale',
            netQuantity: stockUnits,
            grossWeight: stockKg, // Assume gross = net for initial import if no other info
            tareWeight: 0,
            lotto: 'IMPORT-INIZIALE',
        } : null;

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
            batches: initialBatch ? [initialBatch] : [],
            currentStockUnits: stockUnits,
            currentWeightKg: stockKg,
        };
        batch.set(newDocRef, newMaterial);
        addedCount++;
        existingCodes.add(normalizedCode);
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

export async function getMaterialWithdrawalsForMaterial(materialId: string): Promise<MaterialWithdrawal[]> {
  const withdrawalsRef = collection(db, "materialWithdrawals");
  const q = query(withdrawalsRef, where("materialId", "==", materialId));
  const snapshot = await getDocs(q);
  const withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
  return withdrawals;
}

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
  const withdrawalRef = doc(db, "materialWithdrawals", withdrawalId);
  try {
    await runTransaction(db, async (transaction) => {
      const withdrawalSnap = await transaction.get(withdrawalRef);
      if (!withdrawalSnap.exists()) {
        throw new Error("Movimento di scarico non trovato.");
      }
      const withdrawal = withdrawalSnap.data() as MaterialWithdrawal;

      const materialRef = doc(db, "rawMaterials", withdrawal.materialId);
      const materialSnap = await transaction.get(materialRef);
      if (!materialSnap.exists()) {
        throw new Error("Materia prima associata allo scarico non trovata.");
      }
      const material = materialSnap.data() as RawMaterial;
      
      const weightToRestore = withdrawal.consumedWeight || 0;
      const unitsToRestore = withdrawal.consumedUnits || 0;

      const newWeightKg = (material.currentWeightKg || 0) + weightToRestore;
      let newStockUnits = (material.currentStockUnits || 0) + unitsToRestore;

      // Ensure consistency if units were not logged but can be recalculated
      if (unitsToRestore === 0 && material.unitOfMeasure !== 'kg' && material.conversionFactor && material.conversionFactor > 0) {
        const recalculatedUnits = Math.round(weightToRestore / material.conversionFactor);
        newStockUnits += recalculatedUnits;
      }
      
      if (material.unitOfMeasure === 'kg') {
          newStockUnits = newWeightKg;
      }

      transaction.update(materialRef, {
        currentStockUnits: newStockUnits,
        currentWeightKg: newWeightKg,
      });

      transaction.delete(withdrawalRef);
    });

    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Scarico eliminato e stock ripristinato." };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}
