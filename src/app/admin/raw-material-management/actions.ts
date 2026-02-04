
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc, runTransaction, arrayUnion, arrayRemove, limit, orderBy, Timestamp, deleteField, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, RawMaterialType, MaterialWithdrawal, Packaging, JobOrder, Department, ManualCommitment, Article, ScrapRecord } from '@/lib/mock-data';
import { format } from 'date-fns';
import { formatDisplayStock } from '@/lib/utils';
import { ensureAdmin } from '@/lib/server-auth';


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
  rapportoKgMt: z.coerce.number().optional().nullable(),
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

export async function getDepartments(): Promise<Department[]> {
  const col = collection(db, "departments");
  const snapshot = await getDocs(col);
  if (snapshot.empty) {
      return [];
  }
  return snapshot.docs.map(d => d.data() as Department);
}

export async function getRawMaterials(searchTerm?: string): Promise<RawMaterial[]> {
    const materialsCol = collection(db, 'rawMaterials');
    
    // If a search term is provided and is long enough, perform a search
    if (searchTerm && searchTerm.length >= 2) {
        const lowercasedTerm = searchTerm.toLowerCase();
        const q = query(materialsCol, 
            where('code_normalized', '>=', lowercasedTerm), 
            where('code_normalized', '<=', lowercasedTerm + '\uf8ff'), 
            limit(50)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return [];
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

    // If no search term is provided (e.g., called from article management page), fetch all
    if (!searchTerm) {
        const snapshot = await getDocs(materialsCol);
        if (snapshot.empty) return [];
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

    // If search term is too short or an empty string, return nothing
    return [];
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
    rapportoKgMt: data.rapportoKgMt || null,
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
          
          if (packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists()) {
              tareWeight = packagingSnap.data().weightKg || 0;
            }
          }

          let netWeightForCalc: number;
          if (material.unitOfMeasure === 'kg') {
              netWeightForCalc = netQuantity;
          } else if (material.conversionFactor && material.conversionFactor > 0) {
              netWeightForCalc = netQuantity * material.conversionFactor;
          } else {
              netWeightForCalc = 0; // Cannot determine weight if no conversion factor
          }
          const grossWeight = netWeightForCalc + tareWeight;
          
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
          
          const existingBatches = material.batches || [];
          const newStockUnits = (material.currentStockUnits || 0) + newBatch.netQuantity;
          const newWeightKg = (material.currentWeightKg || 0) + (newBatch.grossWeight - newBatch.tareWeight);


          transaction.update(materialRef, { 
              batches: [...existingBatches, newBatch],
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg,
          });
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/raw-material-scan');
      revalidatePath('/admin/batch-management'); // Added revalidation for batch page
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
            if (newBatchData.packagingId && newBatchData.packagingId !== 'none') {
                const packagingRef = doc(db, 'packaging', newBatchData.packagingId);
                const packagingSnap = await transaction.get(packagingRef);
                if (packagingSnap.exists()) {
                    tareWeight = packagingSnap.data().weightKg || 0;
                }
            }
            
            let netWeightForCalc: number;
            if (material.unitOfMeasure === 'kg') {
                netWeightForCalc = newBatchData.netQuantity;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
                netWeightForCalc = newBatchData.netQuantity * material.conversionFactor;
            } else {
                netWeightForCalc = 0;
            }
            const grossWeight = netWeightForCalc + tareWeight;
            
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

            const unitsDiff = updatedBatch.netQuantity - oldBatch.netQuantity;
            const oldNetWeight = (oldBatch.grossWeight || 0) - (oldBatch.tareWeight || 0);
            const newNetWeight = updatedBatch.grossWeight - updatedBatch.tareWeight;
            const weightDiff = newNetWeight - oldNetWeight;

            const newStockUnits = (material.currentStockUnits || 0) + unitsDiff;
            const newWeightKg = (material.currentWeightKg || 0) + weightDiff;


            transaction.update(materialRef, {
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg
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

            const unitsToRemove = batchToDelete.netQuantity || 0;
            const weightToRemove = (batchToDelete.grossWeight || 0) - (batchToDelete.tareWeight || 0);

            const newStockUnits = (material.currentStockUnits || 0) - unitsToRemove;
            const newWeightKg = (material.currentWeightKg || 0) - weightToRemove;

            transaction.update(materialRef, { 
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg,
            });
        });

        revalidatePath('/admin/raw-material-management');
        revalidatePath('/admin/batch-management');
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
      stockInUnits: z.coerce.number().min(0).optional(),
      stockInKg: z.coerce.number().min(0).optional(),
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

        if (validData.stockInKg !== undefined) {
            stockKg = validData.stockInKg;
            if (unitOfMeasure === 'kg') {
                stockUnits = stockKg;
            } else if (conversionFactor && conversionFactor > 0) {
                stockUnits = stockKg / conversionFactor;
            }
        } else if (validData.stockInUnits !== undefined) {
            stockUnits = validData.stockInUnits;
            if (unitOfMeasure === 'kg') {
                stockKg = stockUnits;
            } else if (conversionFactor && conversionFactor > 0) {
                stockKg = stockUnits * conversionFactor;
            }
        }
        
        const initialBatch: RawMaterialBatch | null = (stockUnits > 0 || stockKg > 0) ? {
            id: `batch-import-${Date.now()}-${addedCount}`,
            date: new Date().toISOString(),
            ddt: 'Importazione Iniziale',
            netQuantity: stockUnits,
            grossWeight: stockKg,
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
      // --- ALL READS MUST BE AT THE TOP ---
      const withdrawalSnap = await transaction.get(withdrawalRef);
      if (!withdrawalSnap.exists()) {
        throw new Error("Movimento di scarico non trovato.");
      }
      const withdrawal = withdrawalSnap.data() as MaterialWithdrawal;

      const materialRef = doc(db, "rawMaterials", withdrawal.materialId);
      const materialSnap = await transaction.get(materialRef);
      if (!materialSnap.exists()) {
        // If material doesn't exist, we can't restore stock, but we can still delete the withdrawal.
        // This prevents an error loop if a material was deleted but withdrawals remain.
        transaction.delete(withdrawalRef);
        return;
      }
      
      const jobSnaps = [];
      if (withdrawal.jobIds && withdrawal.jobIds.length > 0) {
        for (const jobId of withdrawal.jobIds) {
          const jobRef = doc(db, 'jobOrders', jobId);
          jobSnaps.push(await transaction.get(jobRef));
        }
      }
      
      // --- ALL WRITES/LOGIC AFTER READS ---
      const material = materialSnap.data() as RawMaterial;
      const weightToRevert = withdrawal.consumedWeight || 0;
      let unitsToRevert = withdrawal.consumedUnits ?? 0;

      if (unitsToRevert === 0 && material.unitOfMeasure !== 'kg' && material.conversionFactor && material.conversionFactor > 0) {
        unitsToRevert = weightToRevert / material.conversionFactor;
      }
      
      const newWeightKg = (material.currentWeightKg || 0) + weightToRevert;
      let newStockUnits = (material.currentStockUnits || 0) + unitsToRevert;

      transaction.update(materialRef, {
        currentStockUnits: newStockUnits,
        currentWeightKg: newWeightKg,
      });

      if (jobSnaps.length > 0) {
        for (const jobSnap of jobSnaps) {
          if (jobSnap.exists()) {
            const jobData = jobSnap.data() as JobOrder;
            const updatedPhases = jobData.phases.map(phase => {
              const consumptions = phase.materialConsumptions || [];
              const updatedConsumptions = consumptions.filter(
                c => c.withdrawalId !== withdrawalId
              );
              if (updatedConsumptions.length < consumptions.length) {
                   return { ...phase, materialConsumptions: updatedConsumptions };
              }
              return phase;
            });
            transaction.update(jobSnap.ref, { phases: updatedPhases });
          }
        }
      }

      transaction.delete(withdrawalRef);
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/batch-management');
    revalidatePath('/scan-job');
    return { success: true, message: "Scarico eliminato e stock ripristinato." };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}

export interface MaterialStatus {
    id: string;
    code: string;
    description: string;
    stock: number;
    impegnato: number;
    disponibile: number;
    ordinato: number; // Placeholder for now
    unitOfMeasure: 'n' | 'mt' | 'kg';
}

export async function getMaterialsStatus(): Promise<MaterialStatus[]> {
    const jobsQuery = query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]));
    const materialsQuery = query(collection(db, "rawMaterials"));
    const manualCommitmentsQuery = query(collection(db, 'manualCommitments'), where('status', '==', 'pending'));
    const articlesQuery = query(collection(db, 'articles'));

    const [jobsSnapshot, materialsSnapshot, manualCommitmentsSnapshot, articlesSnapshot] = await Promise.all([
        getDocs(jobsQuery),
        getDocs(materialsQuery),
        getDocs(manualCommitmentsQuery),
        getDocs(articlesQuery),
    ]);

    const materialsMap = new Map<string, RawMaterial>();
    materialsSnapshot.forEach(doc => {
        const data = doc.data();
        const normalizedCode = data.code_normalized || (data.code ? data.code.toLowerCase() : null);
        if (normalizedCode) {
            materialsMap.set(normalizedCode, { id: doc.id, ...data } as RawMaterial);
        } else {
            console.warn(`Raw material document with ID ${doc.id} is missing a valid 'code' field. Skipping.`);
        }
    });

    const articlesMap = new Map<string, Article>();
    articlesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.code && typeof data.code === 'string') {
             articlesMap.set(data.code.toLowerCase(), data as Article);
        }
    });

    const impegniMap = new Map<string, number>();

    // Calculate commitments from production jobs
    jobsSnapshot.forEach(doc => {
        const job = doc.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item && item.component && typeof item.component === 'string' && item.status !== 'withdrawn') {
                let requiredQty = 0;
                const material = materialsMap.get(item.component.toLowerCase());

                if (item.lunghezzaTaglioMm && item.lunghezzaTaglioMm > 0 && material && material.unitOfMeasure === 'mt') {
                    requiredQty = (item.quantity || 0) * (job.qta || 0) * item.lunghezzaTaglioMm / 1000;
                } else {
                    requiredQty = (item.quantity || 0) * (job.qta || 0);
                }
               
                if (!isNaN(requiredQty) && requiredQty > 0) {
                    const normalizedComponent = item.component.toLowerCase();
                    const currentImpegno = impegniMap.get(normalizedComponent) || 0;
                    impegniMap.set(normalizedComponent, currentImpegno + requiredQty);
                }
            }
        });
    });

    // Calculate commitments from manual entries
    manualCommitmentsSnapshot.forEach(doc => {
        const commitment = doc.data() as ManualCommitment;
        const article = commitment.articleCode ? articlesMap.get(commitment.articleCode.toLowerCase()) : undefined;
        
        if (article && article.billOfMaterials) {
            article.billOfMaterials.forEach(bomItem => {
                if (bomItem && bomItem.component && typeof bomItem.component === 'string') {
                    let totalRequired = 0;
                    const material = materialsMap.get(bomItem.component.toLowerCase());
                    
                    if (bomItem.lunghezzaTaglioMm && bomItem.lunghezzaTaglioMm > 0 && material && material.unitOfMeasure === 'mt') {
                         totalRequired = (commitment.quantity || 0) * (bomItem.quantity || 0) * (bomItem.lunghezzaTaglioMm / 1000);
                    } else {
                         totalRequired = (bomItem.quantity || 0) * (commitment.quantity || 0);
                    }

                    if (!isNaN(totalRequired) && totalRequired > 0) {
                        const normalizedComponent = bomItem.component.toLowerCase();
                        const currentImpegno = impegniMap.get(normalizedComponent) || 0;
                        impegniMap.set(normalizedComponent, currentImpegno + totalRequired);
                    }
                }
            });
        }
    });

    const statusList: MaterialStatus[] = [];
    materialsMap.forEach((material, normalizedCode) => {
        const stock = material.currentStockUnits || 0;
        const impegnato = impegniMap.get(normalizedCode) || 0;
        statusList.push({
            id: material.id,
            code: material.code,
            description: material.description,
            stock: stock,
            impegnato: impegnato,
            disponibile: stock - impegnato,
            ordinato: 0, // Placeholder
            unitOfMeasure: material.unitOfMeasure,
        });
    });

    return statusList.sort((a, b) => a.code.localeCompare(b.code));
}

// --- MANUAL COMMITMENTS ---

export async function getManualCommitments(): Promise<ManualCommitment[]> {
  const commitmentsRef = collection(db, "manualCommitments");
  const q = query(commitmentsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return [];
  
  return snapshot.docs.map(doc => {
    const data = doc.data();
    // Ensure date fields are ISO strings for serialization
    return {
      ...data,
      id: doc.id,
      createdAt: data.createdAt.toDate().toISOString(),
      deliveryDate: data.deliveryDate instanceof Timestamp ? data.deliveryDate.toDate().toISOString() : data.deliveryDate,
      fulfilledAt: data.fulfilledAt ? data.fulfilledAt.toDate().toISOString() : undefined,
    }
  }) as ManualCommitment[];
}

const commitmentFormSchema = z.object({
  id: z.string().optional(),
  jobOrderCode: z.string().min(1, "Il codice commessa è obbligatorio."),
  articleCode: z.string().min(1, "Selezionare un articolo."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  deliveryDate: z.date({ required_error: "La data di consegna è obbligatoria." }),
});

export async function saveManualCommitment(
  values: z.infer<typeof commitmentFormSchema>,
  uid: string
): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);
  const validated = commitmentFormSchema.safeParse(values);
  if (!validated.success) {
    return { success: false, message: "Dati non validi." };
  }
  const { id, ...data } = validated.data;
  
  const docRef = id ? doc(db, "manualCommitments", id) : doc(collection(db, "manualCommitments"));
  
  try {
    const dataToSave: Omit<ManualCommitment, 'id'> = {
      ...data,
      status: 'pending',
      createdAt: id ? undefined : Timestamp.now(), // Keep original createdAt on edit
    } as Omit<ManualCommitment, 'id'>;

    await setDoc(docRef, {
      ...dataToSave,
      id: docRef.id
    }, { merge: true });
    
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `Impegno ${id ? 'aggiornato' : 'creato'} con successo.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore nel salvataggio." };
  }
}

export async function deleteManualCommitment(commitmentId: string): Promise<{ success: boolean; message: string; }> {
  try {
    const commitmentRef = doc(db, "manualCommitments", commitmentId);
    await deleteDoc(commitmentRef);
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Impegno eliminato." };
  } catch (error) {
    return { success: false, message: "Errore durante l'eliminazione." };
  }
}

export interface LotSelectionPayload {
  materialId: string;
  batchId: string;
  lotto: string;
  consumed: number; // in primary UoM of the material
}

export async function declareCommitmentFulfillment(
  commitmentId: string,
  goodPieces: number,
  scrapPieces: number,
  lotSelections: LotSelectionPayload[],
  uid: string
): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const commitmentRef = doc(db, "manualCommitments", commitmentId);

    try {
        await runTransaction(db, async (transaction) => {
            const commitmentSnap = await transaction.get(commitmentRef);
            if (!commitmentSnap.exists() || commitmentSnap.data().status !== 'pending') {
                throw new Error("Impegno non trovato o già evaso.");
            }
            const commitment = commitmentSnap.data() as ManualCommitment;
            
            const operatorSnap = await getDoc(doc(db, "operators", uid));
            const operatorName = operatorSnap.exists() ? operatorSnap.data().nome : 'Admin';

            for (const selection of lotSelections) {
                const materialRef = doc(db, 'rawMaterials', selection.materialId);
                const materialSnap = await transaction.get(materialRef);
                if (!materialSnap.exists()) throw new Error(`Materiale ${selection.materialId} non trovato.`);
                
                const material = materialSnap.data() as RawMaterial;
                const batches = material.batches || [];
                const batchIndex = batches.findIndex(b => b.id === selection.batchId);
                if (batchIndex === -1) throw new Error(`Lotto ${selection.batchId} non trovato per materiale ${material.code}.`);
                
                const batch = batches[batchIndex];
                if (batch.netQuantity < selection.consumed) throw new Error(`Stock insufficiente per lotto ${batch.lotto}. Richiesti: ${selection.consumed}, disponibili: ${batch.netQuantity}`);

                const unitsConsumed = selection.consumed;
                let consumedWeight = 0;
                if (material.unitOfMeasure === 'kg') {
                    consumedWeight = unitsConsumed;
                } else if (material.conversionFactor && material.conversionFactor > 0) {
                    consumedWeight = unitsConsumed * material.conversionFactor;
                }

                // Update batch and material stock
                batch.netQuantity -= unitsConsumed;
                batch.grossWeight -= consumedWeight; // Assuming tare stays the same
                material.currentStockUnits -= unitsConsumed;
                material.currentWeightKg -= consumedWeight;

                batches[batchIndex] = batch;
                transaction.update(materialRef, { 
                    batches,
                    currentStockUnits: material.currentStockUnits,
                    currentWeightKg: material.currentWeightKg,
                });
                
                // Log withdrawal
                const withdrawalRef = doc(collection(db, "materialWithdrawals"));
                transaction.set(withdrawalRef, {
                    jobOrderPFs: [commitment.jobOrderCode],
                    materialId: material.id,
                    materialCode: material.code,
                    consumedWeight,
                    consumedUnits: unitsConsumed,
                    operatorId: uid,
                    operatorName,
                    withdrawalDate: Timestamp.now(),
                    notes: `Scarico da impegno manuale: ${commitment.id}`,
                    lotto: batch.lotto || null,
                    commitmentId: commitmentId,
                });
            }

            if (scrapPieces > 0) {
              const scrapRef = doc(collection(db, 'scrapRecords'));
              transaction.set(scrapRef, {
                  commitmentId: commitment.id,
                  jobOrderCode: commitment.jobOrderCode,
                  articleCode: commitment.articleCode,
                  scrappedQuantity: scrapPieces,
                  declaredAt: Timestamp.now(),
                  operatorId: uid,
                  operatorName: operatorName,
              });
            }

            transaction.update(commitmentRef, {
                status: 'fulfilled',
                fulfilledAt: Timestamp.now(),
                fulfilledBy: uid,
                declaredGoodPieces: goodPieces,
                declaredScrapPieces: scrapPieces,
            });
        });
        
        revalidatePath('/admin/raw-material-management');
        revalidatePath('/admin/reports');

        return { success: true, message: `Dichiarazione per impegno ${commitmentId} registrata con successo. Stock aggiornato.` };

    } catch (error) {
         const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la dichiarazione.";
         return { success: false, message: errorMessage };
    }
}


export async function importManualCommitments(
  data: any[],
  uid: string
): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);

    if (!data || data.length === 0) {
        return { success: false, message: 'Nessun dato da importare.' };
    }

    const articlesSnap = await getDocs(collection(db, "articles"));
    const articlesMap = new Map(articlesSnap.docs.map(d => [d.data().code, d.id]));

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    const commitmentSchema = z.object({
        Commessa: z.string().min(1),
        "Codice Articolo": z.string().min(1),
        Quantita: z.coerce.number().positive(),
        "Data Consegna": z.any(),
    });

    const batch = writeBatch(db);

    for (const row of data) {
        const validated = commitmentSchema.safeParse(row);
        if (!validated.success) {
            errorCount++;
            errors.push(`Riga con dati non validi: ${JSON.stringify(row)}`);
            continue;
        }

        const { Commessa, "Codice Articolo": articleCode, Quantita, "Data Consegna": rawDate } = validated.data;

        if (!articlesMap.has(articleCode)) {
            errorCount++;
            errors.push(`Articolo "${articleCode}" non trovato in anagrafica.`);
            continue;
        }

        let parsedDate: Date;
        if (typeof rawDate === 'number') { // Excel date number
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            parsedDate = new Date(excelEpoch.getTime() + rawDate * 86400 * 1000);
        } else if (typeof rawDate === 'string') {
            const dateParts = rawDate.split('/');
            if (dateParts.length === 3) {
                 parsedDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
            } else {
                 parsedDate = new Date(rawDate);
            }
        } else {
            parsedDate = new Date(); // Fallback
        }

        if (isNaN(parsedDate.getTime())) {
            errorCount++;
            errors.push(`Data non valida per commessa "${Commessa}".`);
            continue;
        }

        const docRef = doc(collection(db, "manualCommitments"));
        const newCommitment: Omit<ManualCommitment, 'id'> = {
            jobOrderCode: Commessa,
            articleCode,
            quantity: Quantita,
            deliveryDate: parsedDate.toISOString(),
            status: 'pending',
            createdAt: Timestamp.now(),
        };
        batch.set(docRef, { ...newCommitment, id: docRef.id });
        successCount++;
    }
    
    if (successCount > 0) {
        await batch.commit();
    }
    
    let message = `${successCount} impegni importati.`;
    if (errorCount > 0) {
        message += ` ${errorCount} righe ignorate. Primo errore: ${errors[0]}`;
    }

    revalidatePath('/admin/raw-material-management');

    return { success: errorCount === 0, message };
}


export async function revertManualCommitmentFulfillment(
  commitmentId: string,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const commitmentRef = doc(db, "manualCommitments", commitmentId);

  try {
    const commitmentSnap = await getDoc(commitmentRef);
    if (!commitmentSnap.exists() || commitmentSnap.data().status !== 'fulfilled') {
      throw new Error("Impegno non trovato o non è in stato 'Evaso'.");
    }
    
    // Find the withdrawal associated with this commitment
    const withdrawalsQuery = query(collection(db, "materialWithdrawals"), where("commitmentId", "==", commitmentId));
    const withdrawalSnapshot = await getDocs(withdrawalsQuery);

    if (withdrawalSnapshot.empty) {
      // If no withdrawal is found, we can't revert stock, but we can reset the status.
      await updateDoc(commitmentRef, {
          status: 'pending',
          fulfilledAt: deleteField(),
          fulfilledBy: deleteField(),
          declaredGoodPieces: deleteField(),
          declaredScrapPieces: deleteField(),
      });
      revalidatePath('/admin/raw-material-management');
      return { success: true, message: "Evasione annullata. Attenzione: impossibile trovare il movimento di scarico associato per ripristinare lo stock."};
    }
    
    const withdrawalIds = withdrawalSnapshot.docs.map(doc => doc.id);
    for (const withdrawalId of withdrawalIds) {
       const result = await deleteSingleWithdrawalAndRestoreStock(withdrawalId);
       if (!result.success) {
         throw new Error(`Errore durante l'annullamento dello scarico ${withdrawalId}: ${result.message}`);
       }
    }

    // Now, also update the commitment status
    await updateDoc(commitmentRef, {
        status: 'pending',
        fulfilledAt: deleteField(),
        fulfilledBy: deleteField(),
        declaredGoodPieces: deleteField(),
        declaredScrapPieces: deleteField(),
    });

    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Evasione annullata con successo. Lo stock è stato ripristinato." };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto.";
     return { success: false, message: errorMessage };
  }
}

export async function getScrapsForMaterial(materialId: string): Promise<ScrapRecord[]> {
    const scrapsRef = collection(db, "scrapRecords");
    const q = query(scrapsRef, where("materialId", "==", materialId), orderBy("declaredAt", "desc"));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];
    
    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            ...data,
            id: doc.id,
            declaredAt: (data.declaredAt as Timestamp).toDate().toISOString(),
        } as ScrapRecord;
    });
}
    

    