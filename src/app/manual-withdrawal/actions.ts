'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';

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
    const globalSettings = await getGlobalSettings();
    
    await adminDb.runTransaction(async (transaction) => {
        const materialRef = adminDb.collection("rawMaterials").doc(materialId);
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists) throw new Error("Materiale non trovato.");
        const material = materialDoc.data() as RawMaterial;
        
        // Find config for this material type
        const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
            id: material.type,
            label: material.type,
            defaultUnit: material.unitOfMeasure,
            hasConversion: false
        } as any;

        const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
            material,
            config,
            quantity,
            unit as any,
            false, // isAddition = false (Scarico)
            lotto
        );
        
        transaction.update(materialRef, { 
            currentStockUnits: (material.currentStockUnits || 0) - unitsToChange, 
            currentWeightKg: (material.currentWeightKg || 0) - weightToChange,
            batches: updatedBatches
        });
        
        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
        transaction.set(withdrawalRef, {
            jobIds: [],
            jobOrderPFs: jobOrderPF ? [jobOrderPF] : ['SCARICO_MANUALE'],
            materialId,
            materialCode: material.code,
            consumedWeight: weightToChange,
            consumedUnits: unitsToChange,
            operatorId,
            operatorName,
            withdrawalDate: admin.firestore.Timestamp.now(),
            notes: notes || null,
            lotto: usedLotto,
        });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: `Scarico registrato.` };
  } catch (error) {
     return { success: false, message: "Errore durante la registrazione." };
  }
}
