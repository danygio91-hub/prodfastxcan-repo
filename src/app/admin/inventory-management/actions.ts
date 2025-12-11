
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, updateDoc, getDoc, arrayRemove, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord, Operator } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';


// Helper to convert Timestamps for JSON serialization
function convertTimestamps(obj: any): any {
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    if (obj && typeof obj === 'object') {
        if (obj.toDate && typeof obj.toDate === 'function') {
            return obj.toDate().toISOString();
        }
        for (const key in obj) {
            obj[key] = convertTimestamps(obj[key]);
        }
    }
    return obj;
}


// This function is now also used by the inventory page
export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const q = query(packagingCol, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Packaging);
}

const inventoryBatchSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().optional(),
  grossWeight: z.coerce.number().positive("Il peso lordo è obbligatorio."),
  packagingId: z.string().optional(),
});


export async function registerInventoryBatch(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  
  // We manually add operator data here as it's not part of the form fields filled by the user directly.
  const dataToValidate = {
      materialId: rawData.materialId,
      lotto: rawData.lotto,
      inputQuantity: rawData.inputQuantity,
      packagingId: rawData.packagingId,
      inputUnit: rawData.inputUnit,
  };

  const inventorySchema = z.object({
      materialId: z.string().min(1),
      lotto: z.string().optional(),
      inputQuantity: z.coerce.number().positive(),
      packagingId: z.string().optional(),
      inputUnit: z.enum(['n', 'mt', 'kg']),
  });
  
  const validatedFields = inventorySchema.safeParse(dataToValidate);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }
  
  const { materialId, lotto, inputQuantity, packagingId, inputUnit } = validatedFields.data;
  const operatorId = rawData.operatorId as string;
  const operatorName = rawData.operatorName as string;

  if (!operatorId || !operatorName) {
      return { success: false, message: 'Dati operatore mancanti.' };
  }

  const materialRef = doc(db, "rawMaterials", materialId);
  const inventoryRef = collection(db, "inventoryRecords");
  
  try {
      const materialSnap = await getDoc(materialRef);
      if (!materialSnap.exists()) {
        throw new Error('Materia prima non trovata.');
      }
      const material = materialSnap.data() as RawMaterial;

      let tareWeight = 0;
      if (packagingId && packagingId !== 'none') {
        const packagingRef = doc(db, 'packaging', packagingId);
        const packagingSnap = await getDoc(packagingRef);
        if (packagingSnap.exists()) {
          tareWeight = packagingSnap.data().weightKg || 0;
        }
      }

      let finalInputQuantity: number;
      let netWeight: number;
      let grossWeight: number;

      if (inputUnit === 'kg') {
          grossWeight = inputQuantity;
          netWeight = grossWeight - tareWeight;
          const conversionFactor = material.unitOfMeasure === 'kg' 
              ? 1 
              : (material.unitOfMeasure === 'n' ? material.conversionFactor : material.secondaryConversionFactor);

          if (conversionFactor && conversionFactor > 0) {
              finalInputQuantity = Math.round(netWeight / conversionFactor);
          } else if (material.unitOfMeasure === 'kg') {
              finalInputQuantity = netWeight;
          } else {
              throw new Error("Fattore di conversione mancante per calcolare le unità dal peso.");
          }
      } else { // 'n' or 'mt'
          finalInputQuantity = inputQuantity;
          const conversionFactor = inputUnit === material.unitOfMeasure
            ? material.conversionFactor
            : material.secondaryConversionFactor;
            
          if (conversionFactor && conversionFactor > 0) {
              netWeight = finalInputQuantity * conversionFactor;
              grossWeight = netWeight + tareWeight;
          } else {
               throw new Error("Fattore di conversione mancante per calcolare il peso dalle unità.");
          }
      }


      if (netWeight < 0) {
          throw new Error("Il peso netto calcolato è negativo. Controllare peso e tara.");
      }
      
      const newInventoryRecord: Omit<InventoryRecord, 'id'> = {
          materialId,
          materialCode: material.code,
          lotto: lotto || 'INV',
          grossWeight,
          tareWeight,
          netWeight,
          packagingId,
          operatorId,
          operatorName,
          recordedAt: Timestamp.now(),
          status: 'pending',
          inputUnit: inputUnit,
          inputQuantity: finalInputQuantity,
      };
      
      await addDoc(inventoryRef, newInventoryRecord);
      
      revalidatePath('/admin/inventory-management');
      return { success: true, message: 'Inventario registrato. In attesa di approvazione.' };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}

export async function getInventoryRecords(): Promise<InventoryRecord[]> {
  const recordsRef = collection(db, "inventoryRecords");
  const q = query(recordsRef, orderBy("recordedAt", "desc"));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return [];
  }
  
  const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryRecord));
  // Convert Firestore Timestamps to serializable format (ISO string)
  return JSON.parse(JSON.stringify(convertTimestamps(records)));
}

export async function approveInventoryRecord(recordId: string, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const recordSnap = await transaction.get(recordRef);
            if (!recordSnap.exists() || recordSnap.data().status !== 'pending') {
                throw new Error("Registrazione non trovata o già processata.");
            }
            
            const record = recordSnap.data() as InventoryRecord;
            const materialRef = doc(db, 'rawMaterials', record.materialId);
            const materialSnap = await transaction.get(materialRef);

            if (!materialSnap.exists()) {
                throw new Error("Materia prima associata non trovata. Impossibile caricare lo stock.");
            }
            
            const material = materialSnap.data() as RawMaterial;
            
            const recordDate = record.recordedAt && typeof (record.recordedAt as any).toDate === 'function' 
                ? (record.recordedAt as any).toDate()
                : new Date(record.recordedAt);

            const newBatchData: RawMaterialBatch = {
                id: `batch-inv-${record.id}`,
                inventoryRecordId: recordId,
                date: recordDate.toISOString(),
                ddt: `INVENTARIO`,
                netQuantity: record.inputQuantity,
                grossWeight: record.grossWeight,
                tareWeight: record.tareWeight,
                packagingId: record.packagingId,
                lotto: record.lotto,
            };
            
            const existingBatches = material.batches || [];
            const updatedBatches = [...existingBatches, newBatchData];
            
            // Correctly add the units and the net weight.
            const unitsToAdd = record.inputQuantity;
            const weightToAdd = record.netWeight;

            const newStockUnits = (material.currentStockUnits || 0) + unitsToAdd;
            const newWeightKg = (material.currentWeightKg || 0) + weightToAdd;

            // Update material stock
            transaction.update(materialRef, { 
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg,
            });
            
            // Update record status
            transaction.update(recordRef, { 
                status: 'approved',
                approvedBy: uid,
                approvedAt: Timestamp.now(),
            });
        });

        revalidatePath('/admin/inventory-management');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Registrazione approvata. Stock aggiornato.` };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'approvazione." };
    }
}

export async function rejectInventoryRecord(recordId: string, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);
    
    try {
        const recordSnap = await getDoc(recordRef);
        if (!recordSnap.exists() || recordSnap.data().status !== 'pending') {
            throw new Error("Registrazione non trovata o già processata.");
        }
        
        await updateDoc(recordRef, { 
            status: 'rejected',
            approvedBy: uid, // Use the same field to know who rejected it
            approvedAt: Timestamp.now(),
        });
        
        revalidatePath('/admin/inventory-management');
        return { success: true, message: `Registrazione rifiutata.` };
    } catch (error) {
         return { success: false, message: error instanceof Error ? error.message : "Errore durante il rifiuto della registrazione." };
    }
}

export async function revertInventoryRecordStatus(recordId: string, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);

    try {
        await runTransaction(db, async (transaction) => {
            const recordSnap = await transaction.get(recordRef);
            if (!recordSnap.exists()) {
                throw new Error("Registrazione inventario non trovata.");
            }
            const record = recordSnap.data() as InventoryRecord;
            if (record.status === 'pending') {
                throw new Error("La registrazione è già in attesa.");
            }
            
            // Only revert stock if it was approved
            if (record.status === 'approved') {
                const materialRef = doc(db, 'rawMaterials', record.materialId);
                const materialSnap = await transaction.get(materialRef);
                if (!materialSnap.exists()) {
                    throw new Error("Materia prima associata non trovata. Impossibile stornare lo stock.");
                }
                const material = materialSnap.data() as RawMaterial;

                // Find and remove the specific batch created by this inventory record
                const batchToRemove = (material.batches || []).find(b => b.inventoryRecordId === recordId);
                
                if (batchToRemove) {
                    const unitsToRevert = record.inputQuantity;
                    const weightToRevert = record.netWeight;

                    const newStockUnits = (material.currentStockUnits || 0) - unitsToRevert;
                    const newWeightKg = (material.currentWeightKg || 0) - weightToRevert;

                    transaction.update(materialRef, {
                        batches: arrayRemove(batchToRemove),
                        currentStockUnits: newStockUnits < 0 ? 0 : newStockUnits,
                        currentWeightKg: newWeightKg < 0 ? 0 : newWeightKg,
                    });
                } else {
                    console.warn(`Could not find inventory batch to remove for record ${recordId}. Stock may be inaccurate.`);
                }
            }
            
            // Reset the record's status
            transaction.update(recordRef, {
                status: 'pending',
                approvedBy: null,
                approvedAt: null,
            });
        });

        revalidatePath('/admin/inventory-management');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Operazione annullata. La registrazione è di nuovo in attesa." };
    } catch (error) {
         return { success: false, message: error instanceof Error ? error.message : "Errore durante l'annullamento." };
    }
}

export async function updateInventoryRecord(recordId: string, inputQuantity: number, inputUnit: 'n' | 'mt' | 'kg', grossWeight: number, packagingId: string | undefined, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);

    try {
        const recordSnap = await getDoc(recordRef);
        if (!recordSnap.exists() || recordSnap.data().status !== 'pending') {
            throw new Error("È possibile modificare solo registrazioni in attesa.");
        }
        const record = recordSnap.data() as InventoryRecord;
        const material = await getMaterialById(record.materialId);
        if (!material) {
             throw new Error("Materia prima associata non trovata.");
        }

        let tareWeight = 0;
        if (packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await getDoc(packagingRef);
            if (packagingSnap.exists()) {
                tareWeight = packagingSnap.data().weightKg || 0;
            }
        }
        
        let netWeight = 0;
        
        if (inputUnit === 'kg') {
            netWeight = inputQuantity - tareWeight;
            grossWeight = inputQuantity;
        } else {
             const conversionFactor = inputUnit === material.unitOfMeasure
                ? material.conversionFactor
                : material.secondaryConversionFactor;
            
            if (conversionFactor && conversionFactor > 0) {
                 netWeight = inputQuantity * conversionFactor;
            }
            grossWeight = netWeight + tareWeight;
        }


        if (netWeight < 0) {
            throw new Error("Il peso netto risultante è negativo.");
        }

        await updateDoc(recordRef, {
            grossWeight: grossWeight,
            tareWeight: tareWeight,
            netWeight: netWeight,
            packagingId: packagingId || null,
            inputQuantity: inputQuantity,
            inputUnit: inputUnit,
        });
        
        revalidatePath('/admin/inventory-management');
        return { success: true, message: `Registrazione aggiornata.` };

    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento." };
    }
}


export async function deleteInventoryRecords(recordIds: string[], uid: string): Promise<{ success: boolean, message: string }> {
  if (!recordIds || recordIds.length === 0) {
    return { success: false, message: 'Nessuna registrazione selezionata.' };
  }

  try {
    await ensureAdmin(uid);
  } catch (error) {
    return { success: false, message: "Permesso negato. Azione riservata ad amministratori o supervisori." };
  }

  try {
    await runTransaction(db, async (transaction) => {
      const recordsToDelete: { recordRef: any, recordData: InventoryRecord, materialRef?: any, materialData?: RawMaterial }[] = [];

      // Step 1: Read all necessary documents first.
      for (const recordId of recordIds) {
        const recordRef = doc(db, 'inventoryRecords', recordId);
        const recordSnap = await transaction.get(recordRef);
        
        if (!recordSnap.exists()) {
          console.warn(`Record ${recordId} not found, skipping.`);
          continue;
        }

        const recordData = recordSnap.data() as InventoryRecord;
        let materialRef, materialData;

        if (recordData.status === 'approved') {
          materialRef = doc(db, 'rawMaterials', recordData.materialId);
          const materialSnap = await transaction.get(materialRef);
          if (materialSnap.exists()) {
            materialData = materialSnap.data() as RawMaterial;
          }
        }
        
        recordsToDelete.push({ recordRef, recordData, materialRef, materialData });
      }

      // Step 2: Perform all write operations.
      for (const { recordRef, recordData, materialRef, materialData } of recordsToDelete) {
        if (recordData.status === 'approved' && materialRef && materialData) {
          const batchToRemove = (materialData.batches || []).find(b => b.inventoryRecordId === recordData.id);
          
          if (batchToRemove) {
                const unitsToRevert = recordData.inputQuantity;
                const weightToRevert = recordData.netWeight;
            
            const newStockUnits = (materialData.currentStockUnits || 0) - unitsToRevert;
            const newWeightKg = (materialData.currentWeightKg || 0) - weightToRevert;

            transaction.update(materialRef, {
              batches: arrayRemove(batchToRemove),
              currentStockUnits: newStockUnits < 0 ? 0 : newStockUnits,
              currentWeightKg: newWeightKg < 0 ? 0 : newWeightKg,
            });
          }
        }
        // Finally, delete the inventory record itself.
        transaction.delete(recordRef);
      }
    });

    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${recordIds.length} registrazioni eliminate con successo.` };
  } catch (error) {
    console.error("Error deleting inventory records:", error);
    return { success: false, message: error instanceof Error ? error.message : "Errore durante l'eliminazione." };
  }
}

export async function getMaterialById(materialId: string): Promise<RawMaterial | null> {
    const materialRef = doc(db, 'rawMaterials', materialId);
    const docSnap = await getDoc(materialRef);
    if (docSnap.exists()) {
        return docSnap.data() as RawMaterial;
    }
    return null;
}
    

    

    
