"use server";

import { collection, doc, runTransaction, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

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
  const validatedFields = inventoryBatchSchema.safeParse(rawData);

  if (!validatedFields.success) {
    return { success: false, message: 'Dati non validi.' };
  }
  
  const { materialId, lotto, grossWeight, packagingId } = validatedFields.data;
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
      await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) {
            throw new Error('Materia prima non trovata.');
          }

          const material = docSnap.data() as RawMaterial;
          const existingBatches = material.batches || [];
          
          let tareWeight = 0;
          if (packagingId && packagingId !== 'none') {
            const packagingRef = doc(db, 'packaging', packagingId);
            const packagingSnap = await transaction.get(packagingRef);
            if (packagingSnap.exists()) {
              tareWeight = packagingSnap.data().weightKg || 0;
            }
          }

          const netWeight = grossWeight - tareWeight;
          if (netWeight < 0) {
              throw new Error("Il peso netto calcolato è negativo. Controllare peso e tara.");
          }
          
          const newBatch: RawMaterialBatch = {
            id: `batch-inv-${Date.now()}`,
            date: new Date().toISOString(),
            ddt: `INVENTARIO-${format(new Date(), 'yyyy-MM-dd')}`,
            netQuantity: netWeight, // For KG materials, net quantity is the net weight
            grossWeight: grossWeight,
            tareWeight: tareWeight,
            packagingId: packagingId,
            lotto: lotto || 'INV',
          };
          
          let newStockUnits: number;
          let newWeightKg: number;
          
          if (material.unitOfMeasure === 'kg') {
              newStockUnits = (material.currentStockUnits || 0) + netWeight;
              newWeightKg = newStockUnits;
          } else {
              // We are adding weight, so we need to convert it to the material's native unit
              if (material.conversionFactor && material.conversionFactor > 0) {
                 const unitsToAdd = Math.round(netWeight / material.conversionFactor);
                 newStockUnits = (material.currentStockUnits || 0) + unitsToAdd;
                 newWeightKg = (material.currentWeightKg || 0) + netWeight;
              } else {
                  // Cannot convert, only update weight if it's already being tracked
                  newStockUnits = material.currentStockUnits;
                  newWeightKg = (material.currentWeightKg || 0) + netWeight;
              }
          }
          
          transaction.update(materialRef, { 
              batches: [...existingBatches, newBatch],
              currentStockUnits: newStockUnits,
              currentWeightKg: newWeightKg,
          });
      });
      
      revalidatePath('/admin/raw-material-management');
      revalidatePath('/inventory');
      return { success: true, message: 'Inventario registrato. Lo stock è stato aggiornato.' };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}
