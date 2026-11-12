'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { hydrateMaterialWithWithdrawals, getLotResidualSummary, normStockLot } from '@/lib/stock-logic';
import { convertTimestampsToDates } from '@/lib/utils';

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
): Promise<{ success: boolean; message: string; hydratedMaterial?: RawMaterial; updatedMaterial?: RawMaterial }> {
  const validated = manualWithdrawalSchema.safeParse(data);
  if (!validated.success) return { success: false, message: 'Dati non validi.' };
  
  const { materialId, operatorId, operatorName, lotto, quantity, unit, notes, jobOrderPFs, isFinished } = validated.data;
  
  if (!isFinished && quantity <= 0) {
      return { success: false, message: "La quantità prelevata deve essere maggiore di zero." };
  }
  
  try {
    const globalSettings = await getGlobalSettings();
    let hydratedAfter: RawMaterial | undefined;
    
    await adminDb.runTransaction(async (transaction) => {
        const materialRef = adminDb.collection("rawMaterials").doc(materialId);
        const [materialDoc, withdrawalsSnap] = await Promise.all([
            transaction.get(materialRef),
            adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
        ]);
        
        if (!materialDoc.exists) throw new Error("Materiale non trovato.");
        const material = { id: materialDoc.id, ...convertTimestampsToDates(materialDoc.data()) } as RawMaterial;
        const withdrawals = withdrawalsSnap.docs.map(d => ({ id: d.id, ...convertTimestampsToDates(d.data()) }));
        
        // FASE 80: Idratazione SSoT prima del calcolo isFinished per leggere sempre currentQuantity residuo reale
        const hydratedPre = hydrateMaterialWithWithdrawals(material, withdrawals as any);
        const targetLottoStr = lotto ? String(lotto) : '';
        const residual = targetLottoStr ? getLotResidualSummary(hydratedPre, targetLottoStr) : null;
        const canonicalLotto = residual?.matchingBatches[0]?.lotto || (targetLottoStr || undefined);

        let qtyToUse = quantity;
        let unitToUse = unit;
        if (isFinished && targetLottoStr) {
            qtyToUse = Math.max(0, residual?.availableUnits ?? 0);
            unitToUse = material.unitOfMeasure;
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
            unitToUse as any,
            false, 
            canonicalLotto,
            withdrawals
        );

        let finalBatches = updatedBatches;
        const updates: any = {};
        if (isFinished && usedLotto) {
            const targetNorm = normStockLot(usedLotto);
            finalBatches = updatedBatches.map((b) =>
                normStockLot(b.lotto) === targetNorm ? { ...b, isExhausted: true } : b
            );
            updates.batches = finalBatches;
        }
        
        if (Object.keys(updates).length > 0) {
            transaction.update(materialRef, updates);
        }

        // ATOMIC STOCK UPDATE (MANDATORY ARCHITECTURE)
        transaction.update(materialRef, {
            stock: admin.firestore.FieldValue.increment(-unitsToChange),
            currentStockUnits: admin.firestore.FieldValue.increment(-unitsToChange),
            currentWeightKg: admin.firestore.FieldValue.increment(-weightToChange)
        });
        
        const nowTs = admin.firestore.Timestamp.now();
        const newWithdrawalDoc = {
            jobIds: [],
            jobOrderPFs: (jobOrderPFs && jobOrderPFs.length > 0) ? jobOrderPFs : ['SCARICO_MANUALE'],
            materialId,
            materialCode: material.code,
            consumedWeight: weightToChange,
            consumedUnits: unitsToChange,
            operatorId,
            operatorName,
            withdrawalDate: nowTs,
            notes: notes || null,
            lotto: usedLotto,
            isFinal: isFinished,
            source: 'manual'
        };
        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
        transaction.set(withdrawalRef, newWithdrawalDoc);

        const postMaterialRaw: RawMaterial = {
            ...material,
            batches: finalBatches,
            stock: Math.max(0, (material.stock || 0) - unitsToChange),
            currentStockUnits: Math.max(0, (material.currentStockUnits || 0) - unitsToChange),
            currentWeightKg: Math.max(0, (material.currentWeightKg || 0) - weightToChange),
        };
        const postWithdrawals = [
            ...withdrawals,
            { id: withdrawalRef.id, ...newWithdrawalDoc, withdrawalDate: new Date() },
        ];
        hydratedAfter = hydrateMaterialWithWithdrawals(postMaterialRaw, postWithdrawals as any);
    });

    const serializedHydrated = hydratedAfter ? JSON.parse(JSON.stringify(hydratedAfter)) : undefined;

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    revalidatePath('/manual-withdrawal');
    revalidatePath('/material-check');
    revalidatePath('/scan-job');
    return {
        success: true,
        message: isFinished ? `Lotto esaurito e scaricato.` : `Scarico registrato.`,
        hydratedMaterial: serializedHydrated,
        updatedMaterial: serializedHydrated,
    };
  } catch (error) {
     console.error("Manual withdrawal error:", error);
     const message = error instanceof Error ? error.message : "Errore durante la registrazione.";
     return { success: false, message };
  }
}
