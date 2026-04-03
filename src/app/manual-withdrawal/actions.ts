'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';

const manualWithdrawalSchema = z.object({
  materialId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  lotto: z.string().optional(),
  quantity: z.coerce.number().min(0), // Can be 0 if isFinished is true
  unit: z.enum(['n', 'mt', 'kg']),
  notes: z.string().optional(),
  jobOrderPFs: z.array(z.string()).optional(),
  isFinished: z.boolean().optional(),
});

export async function logManualWithdrawal(
  data: z.infer<typeof manualWithdrawalSchema>
): Promise<{ success: boolean; message: string }> {
  const validated = manualWithdrawalSchema.safeParse(data);
  if (!validated.success) return { success: false, message: 'Dati non validi.' };
  
  const { materialId, operatorId, operatorName, lotto, quantity, unit, notes, jobOrderPFs, isFinished } = validated.data;
  
  try {
    const globalSettings = await getGlobalSettings();
    
    await adminDb.runTransaction(async (transaction) => {
        const materialRef = adminDb.collection("rawMaterials").doc(materialId);
        const [materialDoc, withdrawalsSnap] = await Promise.all([
            transaction.get(materialRef),
            adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
        ]);
        
        if (!materialDoc.exists) throw new Error("Materiale non trovato.");
        const material = materialDoc.data() as RawMaterial;
        const withdrawals = withdrawalsSnap.docs.map(d => d.data());
        
        let qtyToUse = quantity;
        if (isFinished && lotto) {
            const batch = (material.batches || []).find(b => b.lotto === lotto);
            if (batch) {
                // MODIFIED: In Lot-Centric model, the balance is already on the batch
                qtyToUse = Math.max(0, batch.netQuantity || 0);
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
            lotto,
            withdrawals
        );

        if (isFinished && usedLotto) {
            const bIdx = updatedBatches.findIndex(b => b.lotto === usedLotto);
            if (bIdx !== -1) {
                updatedBatches[bIdx].isExhausted = true;
                // SACRED QUANTITY: no zeroing
            }
        }
        
        transaction.update(materialRef, { 
            batches: updatedBatches
            // currentStockUnits/currentWeightKg will be overwritten by recalculateMaterialStock below
        });

        await recalculateMaterialStock(materialId, transaction, { material, batches: updatedBatches, withdrawals });
        
        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
        transaction.set(withdrawalRef, {
            jobIds: [],
            jobOrderPFs: (jobOrderPFs && jobOrderPFs.length > 0) ? jobOrderPFs : ['SCARICO_MANUALE'],
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
     console.error("Manual withdrawal error:", error);
     const message = error instanceof Error ? error.message : "Errore durante la registrazione.";
     return { success: false, message };
  }
}
