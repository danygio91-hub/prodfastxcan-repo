
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, updateDoc, getDoc, arrayRemove, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord } from '@/lib/mock-data';
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
      grossWeight: rawData.grossWeight,
      packagingId: rawData.packagingId,
  };

  const validatedFields = inventoryBatchSchema.safeParse(dataToValidate);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }
  
  const { materialId, lotto, grossWeight, packagingId } = validatedFields.data;
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

      const netWeight = grossWeight - tareWeight;
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
            const existingBatches = material.batches || [];
            let updatedBatches = [...existingBatches];
            let stockChange = record.netWeight; // Default change is adding the new amount

            const batchToUpdateIndex = record.lotto && record.lotto !== 'INV' 
                ? existingBatches.findIndex(b => b.lotto === record.lotto) 
                : -1;
            
            const recordDate = record.recordedAt && typeof (record.recordedAt as any).toDate === 'function' 
                ? (record.recordedAt as any).toDate()
                : new Date(record.recordedAt);


            const newBatchData: RawMaterialBatch = {
                id: `batch-inv-${record.id}`,
                inventoryRecordId: recordId, // Crucial link to the original record
                date: recordDate.toISOString(),
                ddt: `INVENTARIO`,
                netQuantity: record.netWeight,
                grossWeight: record.grossWeight,
                tareWeight: record.tareWeight,
                packagingId: record.packagingId,
                lotto: record.lotto,
            };

            if (batchToUpdateIndex > -1) {
                // UPDATE/REPLACE logic
                const oldBatch = updatedBatches[batchToUpdateIndex];
                stockChange = record.netWeight - (oldBatch.netQuantity || 0); // Calculate the difference
                newBatchData.id = oldBatch.id; // Preserve the original batch ID
                updatedBatches[batchToUpdateIndex] = newBatchData;
            } else {
                // ADD logic
                updatedBatches.push(newBatchData);
            }

            const newStockUnits = (material.currentStockUnits || 0) + stockChange;
            const newWeightKg = (material.currentWeightKg || 0) + stockChange;

            // Update material stock
            transaction.update(materialRef, { 
                batches: updatedBatches,
                currentStockUnits: material.unitOfMeasure === 'kg' ? newWeightKg : newStockUnits,
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
                    const newStockUnits = (material.currentStockUnits || 0) - record.netWeight;
                    const newWeightKg = (material.currentWeightKg || 0) - record.netWeight;

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

export async function updateInventoryRecord(recordId: string, newGrossWeight: number, newPackagingId: string | undefined, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);

    try {
        const recordSnap = await getDoc(recordRef);
        if (!recordSnap.exists() || recordSnap.data().status !== 'pending') {
            throw new Error("È possibile modificare solo registrazioni in attesa.");
        }
        
        let newTareWeight = 0;
        if (newPackagingId && newPackagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', newPackagingId);
            const packagingSnap = await getDoc(packagingRef);
            if (packagingSnap.exists()) {
                newTareWeight = packagingSnap.data().weightKg || 0;
            }
        }
        
        const newNetWeight = newGrossWeight - newTareWeight;

        if (newNetWeight < 0) {
            throw new Error("Il peso netto risultante è negativo.");
        }

        await updateDoc(recordRef, {
            grossWeight: newGrossWeight,
            tareWeight: newTareWeight,
            netWeight: newNetWeight,
            packagingId: newPackagingId || null,
        });
        
        revalidatePath('/admin/inventory-management');
        return { success: true, message: `Registrazione aggiornata.` };

    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento." };
    }
}


export async function deleteInventoryRecords(recordIds: string[]): Promise<{ success: boolean, message: string }> {
  if (!recordIds || recordIds.length === 0) {
    return { success: false, message: 'Nessuna registrazione selezionata.' };
  }

  await ensureAdmin(undefined); // Check for admin rights without UID from form

  try {
    await runTransaction(db, async (transaction) => {
      for (const recordId of recordIds) {
        const recordRef = doc(db, 'inventoryRecords', recordId);
        const recordSnap = await transaction.get(recordRef);

        if (!recordSnap.exists()) {
          console.warn(`Record ${recordId} not found, skipping.`);
          continue;
        }

        const record = recordSnap.data() as InventoryRecord;

        // If the record was approved, revert the stock changes
        if (record.status === 'approved') {
          const materialRef = doc(db, 'rawMaterials', record.materialId);
          const materialSnap = await transaction.get(materialRef);
          if (materialSnap.exists()) {
            const material = materialSnap.data() as RawMaterial;
            const batchToRemove = (material.batches || []).find(b => b.inventoryRecordId === recordId);
            
            if (batchToRemove) {
              const newStockUnits = (material.currentStockUnits || 0) - record.netWeight;
              const newWeightKg = (material.currentWeightKg || 0) - record.netWeight;

              transaction.update(materialRef, {
                batches: arrayRemove(batchToRemove),
                currentStockUnits: newStockUnits < 0 ? 0 : newStockUnits,
                currentWeightKg: newWeightKg < 0 ? 0 : newWeightKg,
              });
            }
          }
        }

        // Delete the inventory record itself
        transaction.delete(recordRef);
      }
    });

    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${recordIds.length} registrazioni eliminate con successo.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore durante l'eliminazione." };
  }
}
