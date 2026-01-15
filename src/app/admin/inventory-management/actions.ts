

'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, updateDoc, getDoc, arrayRemove, writeBatch, deleteField, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord, Operator } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';

// Helper function to recalculate stock totals from an array of batches.
function recalculateStock(material: RawMaterial, batches: RawMaterialBatch[]): { currentStockUnits: number; currentWeightKg: number } {
  let newTotalStockUnits = 0;
  let newTotalWeightKg = 0;

  for (const batch of batches) {
    newTotalStockUnits += batch.netQuantity;
    newTotalWeightKg += batch.grossWeight - batch.tareWeight;
  }

  return {
    currentStockUnits: newTotalStockUnits,
    currentWeightKg: newTotalWeightKg,
  };
}


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

      let netWeight: number;
      let grossWeight: number;

      if (inputUnit === 'kg') {
          grossWeight = inputQuantity;
          netWeight = grossWeight - tareWeight;
      } else { // 'n' or 'mt'
          if (material.conversionFactor && material.conversionFactor > 0) {
              netWeight = inputQuantity * material.conversionFactor;
          } else {
               netWeight = 0; // Can't calculate weight without factor, admin must fix
          }
          grossWeight = netWeight + tareWeight;
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
          inputQuantity: inputQuantity, // Store the original input
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
  
  const materialIds = [...new Set(snapshot.docs.map(doc => doc.data().materialId))];
  const materialsMap = new Map<string, RawMaterial>();

  if(materialIds.length > 0) {
    const materialsQuery = query(collection(db, 'rawMaterials'), where('__name__', 'in', materialIds));
    const materialsSnapshot = await getDocs(materialsQuery);
    materialsSnapshot.forEach(doc => {
      materialsMap.set(doc.id, doc.data() as RawMaterial);
    });
  }

  const records = snapshot.docs.map(doc => {
    const data = doc.data() as InventoryRecord;
    const material = materialsMap.get(data.materialId);
    return { 
      id: doc.id,
      ...data,
      conversionFactor: material?.conversionFactor
    } as InventoryRecord & { conversionFactor?: number };
  });

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

            let unitsToAdd: number;

            if (material.unitOfMeasure === 'kg') {
                unitsToAdd = record.netWeight;
            } else { // 'n' or 'mt'
                 if (!material.conversionFactor || material.conversionFactor <= 0) {
                     throw new Error(`Fattore di conversione mancante o non valido per ${material.code}. Inserirlo dalla gestione materie prime prima di approvare.`);
                 }
                 unitsToAdd = record.netWeight / material.conversionFactor;
            }

            const newBatchData: RawMaterialBatch = {
                id: `batch-inv-${record.id}`,
                inventoryRecordId: recordId,
                date: recordDate.toISOString(),
                ddt: `INVENTARIO`,
                netQuantity: unitsToAdd,
                grossWeight: record.grossWeight,
                tareWeight: record.tareWeight,
                packagingId: record.packagingId,
                lotto: record.lotto,
            };
            
            const existingBatches = material.batches || [];
            const updatedBatches = [...existingBatches, newBatchData];
            
            const newStock = {
              currentStockUnits: (material.currentStockUnits || 0) + unitsToAdd,
              currentWeightKg: (material.currentWeightKg || 0) + record.netWeight,
            };

            // Update material stock
            transaction.update(materialRef, { 
                batches: updatedBatches,
                ...newStock
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
            approvedBy: uid,
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
            
            if (record.status === 'approved') {
                const materialRef = doc(db, 'rawMaterials', record.materialId);
                const materialSnap = await transaction.get(materialRef);
                if (!materialSnap.exists()) {
                    throw new Error("Materia prima associata non trovata. Impossibile stornare lo stock.");
                }
                const material = materialSnap.data() as RawMaterial;

                const batchToRemove = (material.batches || []).find(b => b.inventoryRecordId === recordId);
                
                if (batchToRemove) {
                  let unitsToRevert: number;
                  const weightToRevert = record.netWeight;
  
                  if (material.unitOfMeasure === 'kg') {
                      unitsToRevert = weightToRevert;
                  } else {
                      if (material.conversionFactor && material.conversionFactor > 0) {
                         unitsToRevert = record.netWeight / material.conversionFactor;
                      } else {
                         unitsToRevert = record.inputQuantity; // Fallback to original input if no factor
                      }
                  }
              
                  const newStockUnits = (material.currentStockUnits || 0) - unitsToRevert;
                  const newWeightKg = (material.currentWeightKg || 0) - weightToRevert;
  
                  transaction.update(materialRef, {
                    batches: arrayRemove(batchToRemove),
                    currentStockUnits: newStockUnits < 0 ? 0 : newStockUnits,
                    currentWeightKg: newWeightKg < 0 ? 0 : newWeightKg,
                  });
                }
            }
            
            transaction.update(recordRef, {
                status: 'pending',
                approvedBy: deleteField(),
                approvedAt: deleteField(),
            });
        });

        revalidatePath('/admin/inventory-management');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Operazione annullata. La registrazione è di nuovo in attesa." };
    } catch (error) {
         return { success: false, message: error instanceof Error ? error.message : "Errore durante l'annullamento." };
    }
}

export async function updateInventoryRecord(
    recordId: string,
    inputQuantity: number,
    inputUnit: 'n' | 'mt' | 'kg',
    packagingId: string | undefined,
    uid: string
): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);

    try {
        const recordSnap = await getDoc(recordRef);
        if (!recordSnap.exists() || recordSnap.data().status !== 'pending') {
            throw new Error("È possibile modificare solo registrazioni in attesa.");
        }
        
        const material = await getMaterialById(recordSnap.data().materialId);
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
        
        let netWeight: number;
        let grossWeight: number;
        
        if (inputUnit === 'kg') {
            grossWeight = inputQuantity;
            netWeight = grossWeight - tareWeight;
        } else { // 'n' or 'mt'
            if (material.conversionFactor && material.conversionFactor > 0) {
                netWeight = inputQuantity * material.conversionFactor;
            } else {
                netWeight = 0; // Cannot calculate if factor is missing
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
            inputQuantity: inputQuantity, // Store the original input quantity
            inputUnit: inputUnit, // Store the original input unit
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

      for (const { recordRef, recordData, materialRef, materialData } of recordsToDelete) {
        if (recordData.status === 'approved' && materialRef && materialData) {
          const batchToRemove = (materialData.batches || []).find(b => b.inventoryRecordId === recordData.id);
          
          if (batchToRemove) {
                let unitsToRevert: number;
                const weightToRevert = recordData.netWeight;

                if (materialData.unitOfMeasure === 'kg') {
                    unitsToRevert = weightToRevert;
                } else {
                     if (materialData.conversionFactor && materialData.conversionFactor > 0) {
                       unitsToRevert = weightToRevert / materialData.conversionFactor;
                     } else {
                       unitsToRevert = recordData.inputQuantity;
                     }
                }
            
                const newStockUnits = (materialData.currentStockUnits || 0) - unitsToRevert;
                const newWeightKg = (materialData.currentWeightKg || 0) - weightToRevert;

                transaction.update(materialRef, {
                  batches: arrayRemove(batchToRemove),
                  currentStockUnits: newStockUnits < 0 ? 0 : newStockUnits,
                  currentWeightKg: newWeightKg < 0 ? 0 : newWeightKg,
                });
          }
        }
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

export async function approveMultipleInventoryRecords(recordIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    let successCount = 0;
    let errorCount = 0;

    for (const recordId of recordIds) {
        const result = await approveInventoryRecord(recordId, uid);
        if (result.success) {
            successCount++;
        } else {
            errorCount++;
            console.error(`Failed to approve record ${recordId}: ${result.message}`);
        }
    }

    if (errorCount > 0) {
        return { success: false, message: `${successCount} registrazioni approvate. ${errorCount} non sono state approvate a causa di errori.` };
    }
    return { success: true, message: `${successCount} registrazioni approvate con successo.` };
}

export async function rejectMultipleInventoryRecords(recordIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    const recordsQuery = query(collection(db, "inventoryRecords"), where("__name__", "in", recordIds));
    const recordsSnap = await getDocs(recordsQuery);

    let processedCount = 0;
    recordsSnap.forEach(docSnap => {
        if (docSnap.data().status === 'pending') {
            batch.update(docSnap.ref, {
                status: 'rejected',
                approvedBy: uid,
                approvedAt: Timestamp.now(),
            });
            processedCount++;
        }
    });

    try {
        await batch.commit();
        revalidatePath('/admin/inventory-management');
        return { success: true, message: `${processedCount} registrazioni rifiutate con successo.` };
    } catch (error) {
        return { success: false, message: `Errore durante il rifiuto di gruppo: ${error instanceof Error ? error.message : "sconosciuto"}` };
    }
}


    