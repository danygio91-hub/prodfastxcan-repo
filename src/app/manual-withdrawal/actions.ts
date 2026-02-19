'use server';

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
  if (!validated.success) return { success: false, message: 'Dati non validi.' };
  
  const { materialId, operatorId, operatorName, lotto, quantity, unit, notes, jobOrderPF } = validated.data;
  
  try {
    await runTransaction(db, async (transaction) => {
        const materialRef = doc(db, "rawMaterials", materialId);
        const materialDoc = await transaction.get(materialRef);
        const material = materialDoc.data() as RawMaterial;
        
        let unitsConsumed = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          unitsConsumed = (material.conversionFactor && material.conversionFactor > 0) ? quantity / material.conversionFactor : quantity;
        } else {
          unitsConsumed = quantity;
          consumedWeight = (material.conversionFactor && material.conversionFactor > 0) ? quantity * material.conversionFactor : 0;
        }
        
        transaction.update(materialRef, { 
            currentStockUnits: (material.currentStockUnits || 0) - unitsConsumed, 
            currentWeightKg: (material.currentWeightKg || 0) - consumedWeight 
        });
        
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
            notes: notes || null,
            lotto: lotto || null,
        });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Scarico registrato.` };
  } catch (error) {
     return { success: false, message: "Errore durante la registrazione." };
  }
}