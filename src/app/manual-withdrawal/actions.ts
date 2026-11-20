'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';

import { getGlobalSettings } from '@/lib/settings-actions';
import {
  prepareWithdrawalMovement,
  finalizePostWithdrawalMaterialState,
} from '@/lib/inventory-utils';
import { hydrateMaterialWithWithdrawals, getLotResidualSummary } from '@/lib/stock-logic';
import { convertTimestampsToDates } from '@/lib/utils';
import { bumpMrpSyncVersion } from '@/lib/mrp-sync';

const manualWithdrawalSchema = z.object({
  materialId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  lotto: z.string().optional(),
  quantity: z.preprocess(
    (val) => (val === undefined || val === null || val === '' || Number.isNaN(Number(val)) ? 0 : val),
    z.coerce.number().min(0)
  ), // Can be 0 / omitted if isFinished is true
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
            transaction.get(adminDb.collection("materialWithdrawals").where("materialId", "==", materialId))
        ]);
        
        if (!materialDoc.exists) throw new Error("Materiale non trovato.");
        const material = { id: materialDoc.id, ...convertTimestampsToDates(materialDoc.data()) } as RawMaterial;
        const withdrawals = withdrawalsSnap.docs.map(d => ({ id: d.id, ...convertTimestampsToDates(d.data()) }));
        
        // FASE 99: Calcolo SSoT diretto in transazione; se isFinished = true, scarica esattamente residual.availableUnits / availableWeightKg ignorando arrotondamenti client.
        const targetLottoStr = lotto ? String(lotto).trim() : '';
        const hydratedPre = hydrateMaterialWithWithdrawals(material, withdrawals as any);
        const residual = targetLottoStr ? getLotResidualSummary(hydratedPre, targetLottoStr) : null;
        const canonicalLotto = residual?.matchingBatches[0]?.lotto || (targetLottoStr || undefined);

        const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
            id: material.type,
            label: material.type,
            defaultUnit: material.unitOfMeasure,
            hasConversion: false
        } as any;

        const { unitsToChange, weightToChange, updatedBatches, usedLotto } = prepareWithdrawalMovement({
            material,
            config,
            withdrawals,
            quantity,
            inputUom: unit as any,
            lotto: canonicalLotto,
            isFinished: Boolean(isFinished),
        });
        
        const nowTs = admin.firestore.Timestamp.now();
        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
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
            isFinal: Boolean(isFinished),
            source: 'manual'
        };

        const postState = finalizePostWithdrawalMaterialState(
            material,
            updatedBatches,
            withdrawals,
            { id: withdrawalRef.id, ...newWithdrawalDoc }
        );
        hydratedAfter = postState.hydratedAfter;

        transaction.update(materialRef, {
            batches: postState.syncedBatches,
            stock: postState.currentStockUnits,
            currentStockUnits: postState.currentStockUnits,
            currentWeightKg: postState.currentWeightKg,
        });
        transaction.set(withdrawalRef, newWithdrawalDoc);
    });

    const serializedHydrated = hydratedAfter ? JSON.parse(JSON.stringify(hydratedAfter)) : undefined;

    await bumpMrpSyncVersion('stock', 'manual-withdrawal:logManualWithdrawal');
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
