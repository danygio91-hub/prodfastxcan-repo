

"use server";

import { doc, runTransaction, Timestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

const manualWithdrawalSchema = z.object({
  materialId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  lotto: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unit: z.enum(['n', 'mt', 'kg']),
  notes: z.string().optional(),
  jobOrderPF: z.string().optional(),
});

export async function logManualWithdrawal(
  data: z.infer<typeof manualWithdrawalSchema>
): Promise<{ success: boolean; message: string }> {
  const validated = manualWithdrawalSchema.safeParse(data);
  if (!validated.success) {
    return { success: false, message: validated.error.errors[0]?.message || 'Dati non validi.' };
  }
  
  const { materialId, operatorId, operatorName, lotto, quantity, unit, notes, jobOrderPF } = validated.data;
  const materialRef = doc(db, "rawMaterials", materialId);
  
  try {
    await runTransaction(db, async (transaction) => {
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists()) throw new Error("Materia prima non trovata.");
        
        const material = materialDoc.data() as RawMaterial;
        
        let unitsConsumed = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          // If a conversion factor exists, we can estimate the units consumed.
          if (material.conversionFactor && material.conversionFactor > 0) {
            unitsConsumed = quantity / material.conversionFactor;
          }
        } else { // 'n' or 'mt'
          unitsConsumed = quantity;
          consumedWeight = (material.conversionFactor && material.conversionFactor > 0) ? quantity * material.conversionFactor : 0;
        }
        
        const currentStockUnits = material.currentStockUnits ?? 0;
        const currentWeightKg = material.currentWeightKg ?? 0;

        if (currentStockUnits < unitsConsumed) {
            throw new Error(`Stock a unità insufficiente. Disponibile: ${currentStockUnits}, Richiesto: ${unitsConsumed}.`);
        }
         if (currentWeightKg < consumedWeight) {
             throw new Error(`Stock a peso insufficiente. Disponibile: ${currentWeightKg.toFixed(2)}kg, Richiesto: ${consumedWeight.toFixed(2)}kg.`);
        }
        
        const newStockUnits = currentStockUnits - unitsConsumed;
        const newWeightKg = currentWeightKg - consumedWeight;

        transaction.update(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg });
        
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: [],
            jobOrderPFs: jobOrderPF ? [jobOrderPF] : ['SCARICO_MANUALE'],
            materialId,
            materialCode: material.code,
            consumedWeight,
            consumedUnits: unitsConsumed,
            operatorId,
            operatorName,
            withdrawalDate: Timestamp.now(),
            notes: notes,
            lotto: lotto || null,
        });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Scarico di ${quantity} ${unit} registrato con successo.` };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la registrazione del prelievo.";
     return { success: false, message: errorMessage };
  }
}
