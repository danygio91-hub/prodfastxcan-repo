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
  quantity: z.coerce.number().min(0), // Can be 0 if isFinished is true
  unit: z.enum(['n', 'mt', 'kg']),
  notes: z.string().optional(),
  jobOrderPF: z.string().optional(),
  isFinished: z.boolean().optional(),
});

export async function logManualWithdrawal(
  data: z.infer<typeof manualWithdrawalSchema>
): Promise<{ success: boolean; message: string }> {
  const validated = manualWithdrawalSchema.safeParse(data);
  if (!validated.success) return { success: false, message: 'Dati non validi.' };
  
  const { materialId, operatorId, operatorName, lotto, quantity, unit, notes, jobOrderPF, isFinished } = validated.data;
  
  try {
    const globalSettings = await getGlobalSettings();
    
    await adminDb.runTransaction(async (transaction) => {
        const materialRef = adminDb.collection("rawMaterials").doc(materialId);
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists) throw new Error("Materiale non trovato.");
        const material = materialDoc.data() as RawMaterial;
        
        let qtyToUse = quantity;
        if (isFinished && lotto) {
            const batch = (material.batches || []).find(b => b.lotto === lotto);
            if (batch) {
                // Se UOM è kg, il calcolo di calculateInventoryMovement si aspetta KG se unit='kg'
                // Se UOM è altro, si aspetta unità base.
                qtyToUse = batch.netQuantity;
            }
        }

        const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
            id: material.type,
            label: material.type,
            defaultUnit: material.unitOfMeasure,
            hasConversion: false
        } as any;

        const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
            material,
            config,
            qtyToUse,
            unit as any,
            false, 
            lotto
        );

        if (isFinished && usedLotto) {
            const bIdx = updatedBatches.findIndex(b => b.lotto === usedLotto);
            if (bIdx !== -1) {
                updatedBatches[bIdx].isExhausted = true;
                updatedBatches[bIdx].netQuantity = 0;
                updatedBatches[bIdx].grossWeight = 0;
            }
        }
        
        transaction.update(materialRef, { 
            currentStockUnits: Math.max(0, (material.currentStockUnits || 0) - unitsToChange), 
            currentWeightKg: Math.max(0, (material.currentWeightKg || 0) - weightToChange),
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
            isFinal: isFinished
        });
    });

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    return { success: true, message: isFinished ? `Lotto esaurito e scaricato.` : `Scarico registrato.` };
  } catch (error) {
     return { success: false, message: "Errore durante la registrazione." };
  }
}
