'use server';

import { adminDb } from '@/lib/firebase-admin';
import { RawMaterial, InventoryRecord, MaterialWithdrawal } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';

export interface AuditAnomaly {
    id: string;
    type: 'BATCH' | 'RECORD' | 'WITHDRAWAL';
    materialCode: string;
    lotto: string;
    currentWeight: number;
    expectedWeight: number;
    difference: number;
    quantity: number;
    uom: string;
}

/**
 * Stage 1: Dry Run Audit
 * Identifies anomalies where netWeightKg was erroneously set equal to netQuantity for N/MT materials.
 */
export async function auditCorruptedInventoryData(): Promise<{ success: boolean; anomalies: AuditAnomaly[]; summary: any }> {
    const anomalies: AuditAnomaly[] = [];
    const globalSettings = await getGlobalSettings();
    
    try {
        // 1. Audit Raw Materials and their Batches
        const materialsSnap = await adminDb.collection("rawMaterials").get();
        for (const mDoc of materialsSnap.docs) {
            const m = mDoc.data() as RawMaterial;
            if (m.unitOfMeasure === 'kg') continue;

            const config = globalSettings.rawMaterialTypes.find(t => t.id === m.type);
            const factor = (m.unitOfMeasure === 'mt' ? m.rapportoKgMt : m.conversionFactor) || 1;

            if (m.batches) {
                m.batches.forEach(b => {
                    const currentWeight = b.grossWeight - b.tareWeight;
                    const expectedWeight = b.netQuantity * factor;

                    // Tolerance check: if weight is exactly equal to quantity (or very close), it's corrupt
                    if (Math.abs(currentWeight - b.netQuantity) < 0.001 && Math.abs(factor - 1) > 0.0001) {
                         anomalies.push({
                             id: `${m.id}_${b.id}`,
                             type: 'BATCH',
                             materialCode: m.code,
                             lotto: b.lotto || 'N/D',
                             currentWeight,
                             expectedWeight,
                             difference: currentWeight - expectedWeight,
                             quantity: b.netQuantity,
                             uom: m.unitOfMeasure
                         });
                    }
                });
            }
        }

        // 2. Audit Inventory Records
        const recordsSnap = await adminDb.collection("inventoryRecords").get();
        for (const rDoc of recordsSnap.docs) {
            const r = rDoc.data() as InventoryRecord;
            if (r.materialUnitOfMeasure === 'kg') continue;

            const factor = (r.materialUnitOfMeasure === 'mt' ? r.rapportoKgMt : r.conversionFactor) || 1;
            const expectedWeight = r.inputQuantity * factor;

            if (Math.abs(r.netWeight - r.inputQuantity) < 0.001 && Math.abs(factor - 1) > 0.0001) {
                anomalies.push({
                    id: rDoc.id,
                    type: 'RECORD',
                    materialCode: r.materialCode,
                    lotto: r.lotto || 'N/D',
                    currentWeight: r.netWeight,
                    expectedWeight,
                    difference: r.netWeight - expectedWeight,
                    quantity: r.inputQuantity,
                    uom: r.materialUnitOfMeasure || 'N/D'
                });
            }
        }

        // 3. Audit Withdrawals
        const withdrawalsSnap = await adminDb.collection("materialWithdrawals").get();
        for (const wDoc of withdrawalsSnap.docs) {
            const w = wDoc.data() as MaterialWithdrawal;
            
            // For withdrawals, we need to fetch the material to get the factor
            const mRef = adminDb.collection("rawMaterials").doc(w.materialId);
            const mSnap = await mRef.get();
            if (!mSnap.exists) continue;
            const m = mSnap.data() as RawMaterial;
            if (m.unitOfMeasure === 'kg') continue;

            const factor = (m.unitOfMeasure === 'mt' ? m.rapportoKgMt : m.conversionFactor) || 1;
            const expectedWeight = (w.consumedUnits || 0) * factor;

            if (Math.abs(w.consumedWeight - (w.consumedUnits || 0)) < 0.001 && Math.abs(factor - 1) > 0.0001) {
                anomalies.push({
                    id: wDoc.id,
                    type: 'WITHDRAWAL',
                    materialCode: w.materialCode,
                    lotto: w.lotto || 'N/D',
                    currentWeight: w.consumedWeight,
                    expectedWeight,
                    difference: w.consumedWeight - expectedWeight,
                    quantity: w.consumedUnits || 0,
                    uom: m.unitOfMeasure
                });
            }
        }

        const summary = {
            totalAnomalies: anomalies.length,
            totalErroneousWeight: anomalies.reduce((sum, a) => sum + a.currentWeight, 0),
            totalCorrectedWeight: anomalies.reduce((sum, a) => sum + a.expectedWeight, 0),
            savedWeightKg: anomalies.reduce((sum, a) => sum + a.difference, 0)
        };

        return { success: true, anomalies: anomalies.sort((a, b) => b.difference - a.difference), summary };
    } catch (error) {
        console.error("Audit error:", error);
        return { success: false, anomalies: [], summary: null };
    }
}

/**
 * Stage 3: Data Healing Execution
 * Physically overwrites corrupted weights in the database with correct values.
 * Uses chunks and batch writes for safety.
 */
export async function applyInventoryDataHealing(uid: string): Promise<{ success: boolean; message: string }> {
    const globalSettings = await getGlobalSettings();
    const startTime = Date.now();
    let totalCorrectedChunks = 0;
    const correctionLog: any[] = [];

    try {
        const audit = await auditCoroutineForHeal(globalSettings);
        if (audit.anomalies.length === 0) return { success: true, message: "Nessuna anomalia da correggere." };

        // We process in groups of 400 (well within the 500 Firestore limit per batch)
        const CHUNK_SIZE = 400;
        for (let i = 0; i < audit.anomalies.length; i += CHUNK_SIZE) {
            const chunk = audit.anomalies.slice(i, i + CHUNK_SIZE);
            const batch = adminDb.batch();

            for (const a of chunk) {
                if (a.type === 'BATCH') {
                    const [matId] = a.id.split('_');
                    const mRef = adminDb.collection("rawMaterials").doc(matId);
                    const mSnap = await mRef.get();
                    if (!mSnap.exists) continue;
                    const m = mSnap.data() as RawMaterial;
                    
                    const updatedBatches = (m.batches || []).map(b => {
                        if (b.lotto === a.lotto) {
                            return { ...b, grossWeight: a.expectedWeight + (b.tareWeight || 0) };
                        }
                        return b;
                    });
                    
                    const currentWeightKg = updatedBatches.reduce((sum, b) => sum + (b.grossWeight - (b.tareWeight || 0)), 0);
                    batch.update(mRef, { batches: updatedBatches, currentWeightKg });
                    correctionLog.push({ type: 'BATCH', id: a.id, old: a.currentWeight, new: a.expectedWeight });
                } 
                else if (a.type === 'RECORD') {
                    const rRef = adminDb.collection("inventoryRecords").doc(a.id);
                    batch.update(rRef, { netWeight: a.expectedWeight, grossWeight: a.expectedWeight + 0 }); // Simplified tare
                    correctionLog.push({ type: 'RECORD', id: a.id, old: a.currentWeight, new: a.expectedWeight });
                } 
                else if (a.type === 'WITHDRAWAL') {
                    const wRef = adminDb.collection("materialWithdrawals").doc(a.id);
                    batch.update(wRef, { consumedWeight: a.expectedWeight });
                    correctionLog.push({ type: 'WITHDRAWAL', id: a.id, old: a.currentWeight, new: a.expectedWeight });
                }
            }
            await batch.commit();
            totalCorrectedChunks += chunk.length;
        }

        // Final Logging
        await adminDb.collection("system_maintenance_logs").add({
            action: 'DATA_HEALING_UOM_FIX',
            executedBy: uid,
            timestamp: new Date(),
            totalCorrected: totalCorrectedChunks,
            durationMs: Date.now() - startTime,
            // We store only the summary to avoid document size limits if thousands are changed
            summary: `Sanitized ${totalCorrectedChunks} records across Batches, Records and Withdrawals.`
        });

        return { success: true, message: `Sanatoria completata con successo: ${totalCorrectedChunks} record corretti.` };
    } catch (error) {
        console.error("Healing execution error:", error);
        return { success: false, message: error instanceof Error ? error.message : "Errore durante la sanatoria." };
    }
}

/**
 * Internal helper to run the audit logic safely for the healer.
 */
async function auditCoroutineForHeal(globalSettings: any) {
    const anomalies: AuditAnomaly[] = [];
    
    // Exact same logic as auditCorruptedInventoryData
    const materialsSnap = await adminDb.collection("rawMaterials").get();
    for (const mDoc of materialsSnap.docs) {
        const m = mDoc.data() as RawMaterial;
        if (m.unitOfMeasure === 'kg') continue;
        const factor = (m.unitOfMeasure === 'mt' ? m.rapportoKgMt : m.conversionFactor) || 1;
        if (m.batches) {
            m.batches.forEach(b => {
                const cur = b.grossWeight - (b.tareWeight || 0);
                const exp = b.netQuantity * factor;
                if (Math.abs(cur - b.netQuantity) < 0.001 && Math.abs(factor - 1) > 0.0001) {
                    anomalies.push({ id: `${mDoc.id}_${b.lotto}`, type: 'BATCH', materialCode: m.code, lotto: b.lotto || 'N/D', currentWeight: cur, expectedWeight: exp, difference: cur - exp, quantity: b.netQuantity, uom: m.unitOfMeasure });
                }
            });
        }
    }

    const recordsSnap = await adminDb.collection("inventoryRecords").get();
    for (const rDoc of recordsSnap.docs) {
        const r = rDoc.data() as InventoryRecord;
        if (r.materialUnitOfMeasure === 'kg') continue;
        const factor = (r.materialUnitOfMeasure === 'mt' ? r.rapportoKgMt : r.conversionFactor) || 1;
        if (Math.abs(r.netWeight - r.inputQuantity) < 0.001 && Math.abs(factor - 1) > 0.0001) {
            anomalies.push({ id: rDoc.id, type: 'RECORD', materialCode: r.materialCode, lotto: r.lotto || 'N/D', currentWeight: r.netWeight, expectedWeight: r.inputQuantity * factor, difference: r.netWeight - (r.inputQuantity * factor), quantity: r.inputQuantity, uom: r.materialUnitOfMeasure || 'N/D' });
        }
    }

    const withdrawalsSnap = await adminDb.collection("materialWithdrawals").get();
    for (const wDoc of withdrawalsSnap.docs) {
        const w = wDoc.data() as MaterialWithdrawal;
        const mRef = adminDb.collection("rawMaterials").doc(w.materialId);
        const mSnap = await mRef.get();
        if (!mSnap.exists) continue;
        const m = mSnap.data() as RawMaterial;
        if (m.unitOfMeasure === 'kg') continue;
        const factor = (m.unitOfMeasure === 'mt' ? m.rapportoKgMt : m.conversionFactor) || 1;
        if (Math.abs(w.consumedWeight - (w.consumedUnits || 0)) < 0.001 && Math.abs(factor - 1) > 0.0001) {
            anomalies.push({ id: wDoc.id, type: 'WITHDRAWAL', materialCode: w.materialCode, lotto: w.lotto || 'N/D', currentWeight: w.consumedWeight, expectedWeight: (w.consumedUnits || 0) * factor, difference: w.consumedWeight - ((w.consumedUnits || 0) * factor), quantity: w.consumedUnits || 0, uom: m.unitOfMeasure });
        }
    }

    return { anomalies };
}
