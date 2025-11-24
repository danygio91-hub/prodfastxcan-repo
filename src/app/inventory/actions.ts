
"use server";

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
  grossWeight: z.coerce.number().positive("Il peso lordo è obbligatorio."),
  packagingId: z.string().optional(),
  // operatorId and operatorName are passed but not part of this specific form validation
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

