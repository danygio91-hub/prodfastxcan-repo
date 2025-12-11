
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { format } from 'date-fns';

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
  inputQuantity: z.coerce.number().positive("La quantità inserita è obbligatoria."),
  packagingId: z.string().optional(),
  inputUnit: z.enum(['n', 'mt', 'kg']),
});


export async function registerInventoryBatch(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  
  const validatedFields = inventoryBatchSchema.safeParse(rawData);

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
          
          if (netWeight < 0) {
            throw new Error("Il peso netto calcolato è negativo. Controllare peso e tara.");
          }

          // If the material's primary UoM is NOT kg, we must calculate the number of pieces.
          if (material.unitOfMeasure !== 'kg') {
              if (!material.conversionFactor || material.conversionFactor <= 0) {
                  throw new Error(`Fattore di conversione mancante o non valido per il materiale ${material.code}. Impossibile calcolare le unità dal peso.`);
              }
              finalInputQuantity = netWeight / material.conversionFactor;
          } else {
              // If the material's primary UoM IS kg, then the "quantity in units" is the net weight.
              finalInputQuantity = netWeight;
          }

      } else { // 'n' or 'mt'
          finalInputQuantity = inputQuantity; // The user entered the number of pieces/meters
          
          if (material.conversionFactor && material.conversionFactor > 0) {
              netWeight = finalInputQuantity * material.conversionFactor;
          } else {
               // If no conversion factor, we can't determine weight. Set it to the quantity itself assuming 1:1, but this is a fallback.
               netWeight = finalInputQuantity;
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
          inputUnit: inputUnit, // The unit the user *entered*
          inputQuantity: finalInputQuantity, // The quantity in the material's primary UoM
      };
      
      await addDoc(inventoryRef, newInventoryRecord);
      
      revalidatePath('/admin/inventory-management');
      return { success: true, message: 'Inventario registrato. In attesa di approvazione.' };

  } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Errore sconosciuto." };
  }
}
