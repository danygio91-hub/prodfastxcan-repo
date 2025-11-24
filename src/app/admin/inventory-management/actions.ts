
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
  operatorId: z.string(),
  operatorName: z.string(),
});


export async function registerInventoryBatch(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const validatedFields = inventoryBatchSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }
  
  const { materialId, lotto, grossWeight, packagingId, operatorId, operatorName } = validatedFields.data;
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
            
            const newBatch: RawMaterialBatch = {
                id: `batch-inv-${record.id}`,
                date: new Date(record.recordedAt as any).toISOString(),
                ddt: `INVENTARIO`,
                netQuantity: record.netWeight,
                grossWeight: record.grossWeight,
                tareWeight: record.tareWeight,
                packagingId: record.packagingId,
                lotto: record.lotto,
            };

            const updatedBatches = [...(material.batches || []), newBatch];
            const newStockUnits = (material.currentStockUnits || 0) + record.netWeight;
            const newWeightKg = (material.currentWeightKg || 0) + record.netWeight;

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
