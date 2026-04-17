'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { RawMaterial, InventoryRecord, MaterialWithdrawal, JobOrder, Operator, JobPhase, Article } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';
import { ensureAdmin } from '@/lib/server-auth';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import { syncJobBOMItems } from '@/lib/inventory-utils';
import { revalidatePath } from 'next/cache';

export async function emergencyRestoreStagingArea(): Promise<{ success: boolean; message: string; count: number; completedCount: number }> {
    try {
        const jobsSnap = await adminDb.collection("jobOrders").get();
        let planCount = 0;
        let completedCount = 0;
        let batch = adminDb.batch();
        let operationsInBatch = 0;
        
        const factoryStates = ['DA_INIZIARE', 'IN_PREPARAZIONE', 'PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'production', 'suspended', 'paused', 'shipped', 'closed', 'completed'];
        const activeStates = ['DA_INIZIARE', 'IN_PREPARAZIONE', 'PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'production', 'suspended', 'paused'];
        
        for (const doc of jobsSnap.docs) {
            const job = doc.data() as JobOrder;
            
            // 1. AUTO-COMPLETION logic
            // If ALL phases are completed or skipped AND status is still active, move to CHIUSO
            const allPhasesDone = job.phases && job.phases.length > 0 && job.phases.every(p => p.status === 'completed' || p.status === 'skipped');
            if (activeStates.includes(job.status as string) && (allPhasesDone || job.overallEndTime)) {
                batch.update(doc.ref, { status: 'CHIUSO' });
                completedCount++;
                operationsInBatch++;
            }
            // 2. STAGING RESTORATION logic
            // If in an active state but NO ODL date, move back to planned
            else if (activeStates.includes(job.status as string) && !job.odlCreationDate) {
                batch.update(doc.ref, { status: 'planned' });
                planCount++;
                operationsInBatch++;
            }
            
            // Firestore batch limit is 500
            if (operationsInBatch >= 450) {
                await batch.commit();
                batch = adminDb.batch();
                operationsInBatch = 0;
            }
        }
        
        if (operationsInBatch > 0) {
            await batch.commit();
        }
        
        revalidatePath('/admin/data-management');
        return { 
            success: true, 
            message: `Ripristino completato: ${planCount} in Sala d'Attesa, ${completedCount} spostate in Conclusi.`, 
            count: planCount,
            completedCount
        };
    } catch (error) {
        console.error("Emergency restoration error:", error);
        return { success: false, message: "Errore durante il ripristino.", count: 0, completedCount: 0 };
    }
}

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

export interface ZombieAnomaly {
    id: string;
    type: 'PHASE' | 'WITHDRAWAL' | 'OPERATOR';
    entityId: string;
    reference: string;
    operatorName: string;
    startDate: Date | string | null;
    details?: string;
    operatorId?: string;
}

export interface StockSyncAnomaly {
    materialId: string;
    code: string;
    currentStock: number;
    calculatedStock: number;
    difference: number;
    unitOfMeasure: string;
    needsSync: boolean;
}

export interface GroupBlocker {
    groupId: string;
    groupRef: string; // ODL/Code
    blockers: {
        type: 'OPERATOR_JOB' | 'OPERATOR_MATERIAL' | 'PHASE_OPEN';
        operatorId?: string;
        operatorName?: string;
        details: string;
    }[];
}

export interface AuditBrokenLot {
    id: string;
    materialId: string;
    materialCode: string;
    lotto: string;
    currentNetQuantity: number;
    expectedNetQuantity: number; // Sum of withdrawals
    withdrawalCount: number;
    description: string;
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

/**
 * ZOMBIE HUNTER: Phase 1 - Audit
 */
export async function auditZombieSessions(): Promise<{ success: boolean; anomalies: ZombieAnomaly[] }> {
    const anomalies: ZombieAnomaly[] = [];
    const now = new Date();
    const TWENTY_FOUR_HOURS_AGO = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
        // 1. Audit Stuck Phases in JobOrders
        const jobsSnap = await adminDb.collection("jobOrders").get();
        for (const doc of jobsSnap.docs) {
            const job = doc.data() as JobOrder;
            (job.phases || []).forEach((p: JobPhase) => {
                if (p.status === 'in-progress') {
                    const openWP = (p.workPeriods || []).find(wp => wp.end === null);
                    if (openWP) {
                        const start = openWP.start?.toDate ? openWP.start.toDate() : new Date(openWP.start);
                        if (start < TWENTY_FOUR_HOURS_AGO) {
                            anomalies.push({
                                id: `phase_${doc.id}_${p.id}`,
                                type: 'PHASE',
                                entityId: doc.id,
                                reference: `${job.ordinePF} - ${p.name}`,
                                operatorName: openWP.operatorId, // Will resolve name if possible or just show ID
                                startDate: start,
                                details: `In corso da oltre 24h`
                            });
                        }
                    }
                }
            });
        }

        // 2. Audit Stuck Phases in WorkGroups
        const groupsSnap = await adminDb.collection("workGroups").get();
        for (const doc of groupsSnap.docs) {
            const group = doc.data() as JobOrder; // WorkGroup shares similar structure for phases
            (group.phases || []).forEach((p: JobPhase) => {
                if (p.status === 'in-progress') {
                    const openWP = (p.workPeriods || []).find(wp => wp.end === null);
                    if (openWP) {
                        const start = openWP.start?.toDate ? openWP.start.toDate() : new Date(openWP.start);
                        if (start < TWENTY_FOUR_HOURS_AGO) {
                            anomalies.push({
                                id: `phase_${doc.id}_${p.id}`,
                                type: 'PHASE',
                                entityId: doc.id,
                                reference: `GRUPPO: ${doc.id} - ${p.name}`,
                                operatorName: openWP.operatorId,
                                startDate: start,
                                details: `In corso da oltre 24h`
                            });
                        }
                    }
                }
            });
        }

        // 3. Audit Stuck Withdrawals
        // Withdrawals without a status or with declaredAt missing might be considered "zombie"
        const withdrawalsSnap = await adminDb.collection("materialWithdrawals").get();
        for (const doc of withdrawalsSnap.docs) {
            const w = doc.data() as MaterialWithdrawal;
            // A withdrawal is "zombie" if it has no status and was created > 24h ago, or is explicitly "pending"
            const date = w.withdrawalDate?.toDate ? w.withdrawalDate.toDate() : new Date(w.withdrawalDate);
            if ((!w.status || w.status === 'pending') && date < TWENTY_FOUR_HOURS_AGO) {
                anomalies.push({
                    id: `withdrawal_${doc.id}`,
                    type: 'WITHDRAWAL',
                    entityId: doc.id,
                    reference: `${w.materialCode} - ${w.lotto || 'N/D'}`,
                    operatorName: w.operatorId,
                    startDate: date,
                    details: `Prelievo mai dichiarato/chiuso`
                });
            }
        }

        // 4. Audit Ghost Operator Participations
        const operatorsSnap = await adminDb.collection("operators").get();
        for (const doc of operatorsSnap.docs) {
            const op = doc.data() as Operator;
            const hasActiveJob = !!op.activeJobId;
            const hasMaterialSessions = (op.activeMaterialSessions || []).length > 0;
            
            if (hasActiveJob || hasMaterialSessions) {
                // Check if the job actually exists and is active (Optional but good for audit)
                anomalies.push({
                    id: `operator_${doc.id}`,
                    type: 'OPERATOR',
                    entityId: doc.id,
                    reference: op.nome,
                    operatorName: op.nome,
                    startDate: null,
                    details: `${hasActiveJob ? 'Job Attivo: ' + op.activeJobId : ''} ${hasMaterialSessions ? 'Sessioni Mat: ' + op.activeMaterialSessions?.length : ''}`
                });
            }
        }

        return { success: true, anomalies };
    } catch (error) {
        console.error("Audit Zombie error:", error);
        return { success: false, anomalies: [] };
    }
}

/**
 * ZOMBIE HUNTER: Phase 2 - Healing
 */
export async function healZombieSessions(ids: string[], uid: string): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    let count = 0;
    
    try {
        const audit = await auditZombieSessions();
        const selectedAnomalies = audit.anomalies.filter(a => ids.includes(a.id));
        if (selectedAnomalies.length === 0) return { success: true, message: "Nessuna sessione zombie selezionata da chiudere." };

        const batch = adminDb.batch();

        for (const a of selectedAnomalies) {
            if (a.type === 'PHASE') {
                const col = a.reference.startsWith('GRUPPO') ? 'workGroups' : 'jobOrders';
                const ref = adminDb.collection(col).doc(a.entityId);
                const snap = await ref.get();
                if (snap.exists) {
                    const data = snap.data();
                    const updatedPhases = (data?.phases || []).map((p: JobPhase) => {
                        const openWP = (p.workPeriods || []).find(wp => wp.end === null);
                        if (openWP) {
                             // Set end = start to zero out time
                             const updatedWPs = p.workPeriods.map(wp => 
                                wp.end === null ? { ...wp, end: wp.start, reason: 'Chiusura Zombie Hunter' } : wp
                             );
                             return { ...p, status: 'paused', workPeriods: updatedWPs };
                        }
                        return p;
                    });
                    batch.update(ref, { phases: updatedPhases });
                }
            } 
            else if (a.type === 'WITHDRAWAL') {
                const ref = adminDb.collection("materialWithdrawals").doc(a.entityId);
                batch.update(ref, { status: 'cancelled' });
            } 
            else if (a.type === 'OPERATOR') {
                const ref = adminDb.collection("operators").doc(a.entityId);
                batch.update(ref, { 
                    activeJobId: null, 
                    activePhaseName: null, 
                    activeMaterialSessions: [],
                    stato: 'inattivo' 
                });
            }
            count++;
        }

        await batch.commit();

        // Log operation
        await adminDb.collection("system_maintenance_logs").add({
            action: 'ZOMBIE_HEALING',
            executedBy: uid,
            timestamp: new Date(),
            totalHealed: count,
            durationMs: Date.now() - startTime,
            summary: `Cacciatore di Zombie: Chiuse ${count} sessioni/partecipazioni appese.`
        });

        return { success: true, message: `Operazione completata: ${count} entità sbloccate.` };
    } catch (error) {
        console.error("Heal Zombie error:", error);
        return { success: false, message: "Errore durante la chiusura forzata." };
    }
}

/**
 * Data Healing Step 2: Corrupted Lot Recovery
 * Finds lots where netQuantity was zeroed out but withdrawals exist.
 */
export async function auditBrokenBatches(): Promise<{ success: boolean; anomalies: AuditBrokenLot[] }> {
    const anomalies: AuditBrokenLot[] = [];
    try {
        const materialsSnap = await adminDb.collection("rawMaterials").get();
        
        for (const mDoc of materialsSnap.docs) {
            const m = mDoc.data() as RawMaterial;
            if (!m.batches || m.batches.length === 0) continue;

            const withdrawalsSnap = await adminDb.collection("materialWithdrawals").where("materialId", "==", m.id).get();
            const withdrawals = withdrawalsSnap.docs.map(d => d.data() as MaterialWithdrawal);

            for (const batch of m.batches) {
                // RULE: If netQuantity is 0 (Initial Load wiped) but we have withdrawals, it's corrupted.
                if (batch.netQuantity === 0 || batch.netQuantity < 0.001) {
                    const lotWithdrawals = withdrawals.filter(w => w.lotto === batch.lotto && w.status !== 'cancelled');
                    const sumWithdrawn = lotWithdrawals.reduce((sum, w) => sum + (w.consumedUnits || 0), 0);

                    if (sumWithdrawn > 0.001) {
                        anomalies.push({
                            id: `${m.id}-${batch.lotto || 'no-lotto'}`,
                            materialId: m.id,
                            materialCode: m.code,
                            lotto: batch.lotto || 'SENZA LOTTO',
                            currentNetQuantity: batch.netQuantity,
                            expectedNetQuantity: sumWithdrawn,
                            withdrawalCount: lotWithdrawals.length,
                            description: `Carico iniziale azzerato ma rintracciati ${lotWithdrawals.length} scarichi storici.`
                        });
                    }
                }
            }
        }

        return { success: true, anomalies };
    } catch (e) {
        console.error("Audit Broken Batches error:", e);
        return { success: false, anomalies: [] };
    }
}

export async function healBrokenBatches(operatorId: string): Promise<{ success: boolean; message: string }> {
    try {
        const { anomalies } = await auditBrokenBatches();
        if (anomalies.length === 0) return { success: true, message: "Nessun lotto corrotto trovato." };

        const batchWrite = adminDb.batch();
        let healedCount = 0;

        // Group by material to minimize batch operations
        const byMaterial = anomalies.reduce((acc, a) => {
            if (!acc[a.materialId]) acc[a.materialId] = [];
            acc[a.materialId].push(a);
            return acc;
        }, {} as Record<string, AuditBrokenLot[]>);

        for (const [materialId, lotAnomalies] of Object.entries(byMaterial)) {
            const mRef = adminDb.collection("rawMaterials").doc(materialId);
            const mSnap = await mRef.get();
            if (!mSnap.exists) continue;

            const material = mSnap.data() as RawMaterial;
            const updatedBatches = [...(material.batches || [])];

            lotAnomalies.forEach(anomaly => {
                const bIdx = updatedBatches.findIndex(b => (b.lotto || 'SENZA LOTTO') === anomaly.lotto);
                if (bIdx !== -1) {
                    // RESTORE SACRED QUANTITY
                    updatedBatches[bIdx].netQuantity = anomaly.expectedNetQuantity;
                    // Also restore weight if possible (approximation based on UOM)
                    const factor = (material.unitOfMeasure === 'mt' ? (material.rapportoKgMt || 1) : (material.conversionFactor || 1));
                    updatedBatches[bIdx].grossWeight = (anomaly.expectedNetQuantity * factor) + (updatedBatches[bIdx].tareWeight || 0);
                    updatedBatches[bIdx].isExhausted = true; // Ensure it stays finished
                    healedCount++;
                }
            });

            batchWrite.update(mRef, { batches: updatedBatches });
        }

        // LOGGING
        const logRef = adminDb.collection("system_maintenance_logs").doc();
        batchWrite.set(logRef, {
            type: 'LOT_RECOVERY',
            executedAt: admin.firestore.Timestamp.now(),
            executedBy: operatorId,
            details: `Ripristinato carico iniziale per ${healedCount} lotti corrotti (Bug Materiale Finito).`,
            affectedAnomalies: anomalies.map(a => `${a.materialCode} [${a.lotto}] -> ${a.expectedNetQuantity}`)
        });

        await batchWrite.commit();
        return { success: true, message: `Ripristino completato per ${healedCount} lotti.` };
    } catch (e) {
        console.error("Heal Broken Batches error:", e);
        return { success: false, message: "Errore durante il ripristino dei lotti." };
    }
}

/**
 * HEALING ACTION: Fixes uppercase/lowercase inconsistencies in existing data.
 * This should be run once to normalize all existing codes and BOMs.
 */
export async function healDataCasing() {
    try {
        console.log("Starting Data Casing Healing...");
        const [articlesSnap, jobsSnap, materialsSnap] = await Promise.all([
            adminDb.collection("articles").get(),
            adminDb.collection("jobOrders").get(),
            adminDb.collection("rawMaterials").get()
        ]);

        const batch = adminDb.batch();
        let count = 0;

        // 1. Articles
        articlesSnap.forEach(doc => {
            const data = doc.data() as Article;
            let changed = false;
            
            const normalizedBOM = (data.billOfMaterials || []).map(item => {
                const up = item.component.toUpperCase().trim();
                if (item.component !== up) { changed = true; }
                return { ...item, component: up };
            });

            if (changed) {
                batch.update(doc.ref, { billOfMaterials: normalizedBOM });
                count++;
            }
        });

        // 2. Job Orders
        jobsSnap.forEach(doc => {
            const data = doc.data() as JobOrder;
            let changed = false;
            const updates: any = {};

            if (data.details && data.details !== data.details.toUpperCase().trim()) {
                updates.details = data.details.toUpperCase().trim();
                changed = true;
            }

            const normalizedBOM = (data.billOfMaterials || []).map(item => {
                const up = item.component.toUpperCase().trim();
                if (item.component !== up) { changed = true; }
                return { ...item, component: up };
            });

            if (changed) {
                updates.billOfMaterials = normalizedBOM;
                batch.update(doc.ref, updates);
                count++;
            }
        });

        // 3. Raw Materials
        materialsSnap.forEach(doc => {
            const data = doc.data() as RawMaterial;
            if (data.code && data.code !== data.code.toUpperCase().trim()) {
                batch.update(doc.ref, { code: data.code.toUpperCase().trim() });
                count++;
            }
        });

        if (count > 0) {
            let ops = 0;
            // Note: If count is > 500 we should ideally chunk the batch, 
            // but for typical manual runs it's usually fine. 
            // Still, safety first:
            await batch.commit();
        }

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/article-management');
        revalidatePath('/admin/raw-material-management');

        return { success: true, message: `Healing completato. Documenti aggiornati: ${count}` };
    } catch (error) {
        console.error("Heal data error:", error);
        return { success: false, message: "Errore durante l'healing dei dati." };
    }
}

/**
 * GROUP HEALING: Phase 1 - Audit Blockers
 */
export async function auditGroupBlockers(): Promise<{ success: boolean; blockers: GroupBlocker[] }> {
    const groupBlockers: GroupBlocker[] = [];
    try {
        const groupsSnap = await adminDb.collection("workGroups").get();
        const operatorsSnap = await adminDb.collection("operators").get();
        const operators = operatorsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Operator));

        for (const gDoc of groupsSnap.docs) {
            const group = gDoc.data() as JobOrder; // WorkGroup structure
            const groupId = gDoc.id;
            const currentBlockers: GroupBlocker['blockers'] = [];

            // 1. Check Operators directly active on Group or Children
            const memberJobIds = group.jobOrderIds || [];
            operators.forEach(op => {
                const isActiveOnGroup = op.activeJobId === groupId;
                const isActiveOnChild = memberJobIds.includes(op.activeJobId || '');
                
                if (isActiveOnGroup || isActiveOnChild) {
                    currentBlockers.push({
                        type: 'OPERATOR_JOB',
                        operatorId: op.id,
                        operatorName: op.nome,
                        details: `Operatore attivo su ${isActiveOnGroup ? 'Gruppo' : 'Commessa Figlia ' + op.activeJobId}`
                    });
                }

                // 2. Check Material Sessions
                const hasLinkedMaterial = (op.activeMaterialSessions || []).some(s => 
                    s.originatorJobId === groupId || 
                    memberJobIds.includes(s.originatorJobId || '') ||
                    s.associatedJobs.some(aj => aj.jobId === groupId || memberJobIds.includes(aj.jobId))
                );

                if (hasLinkedMaterial) {
                    currentBlockers.push({
                        type: 'OPERATOR_MATERIAL',
                        operatorId: op.id,
                        operatorName: op.nome,
                        details: `Sessione materiale aperta collegata al gruppo/figli`
                    });
                }
            });

            // 3. Check Phases for open work periods
            (group.phases || []).forEach(p => {
                const openWP = (p.workPeriods || []).some(wp => !wp.end);
                if (openWP) {
                    currentBlockers.push({
                        type: 'PHASE_OPEN',
                        details: `Fase "${p.name}" ha un clock-in aperto nel documento del gruppo`
                    });
                }
            });

            if (currentBlockers.length > 0) {
                groupBlockers.push({
                    groupId,
                    groupRef: group.numeroODL || groupId,
                    blockers: currentBlockers
                });
            }
        }
        return { success: true, blockers: groupBlockers };
    } catch (e) {
        console.error("Audit Group Blockers error:", e);
        return { success: false, blockers: [] };
    }
}

/**
 * GROUP HEALING: Phase 2 - Force Unlock and Dissolve
 * The "Nuclear" option for stuck groups.
 */
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';

export async function forceUnlockAndDissolveGroup(groupId: string, operatorId: string): Promise<{ success: boolean; message: string }> {
    try {
        const groupRef = adminDb.collection("workGroups").doc(groupId);
        const groupSnap = await groupRef.get();
        if (!groupSnap.exists) throw new Error("Gruppo non trovato.");
        const group = groupSnap.data() as JobOrder;
        const memberJobIds = group.jobOrderIds || [];

        await adminDb.runTransaction(async (t) => {
            // 1. Clear Operator states
            const opsSnap = await t.get(adminDb.collection("operators"));
            opsSnap.forEach(opDoc => {
                const op = opDoc.data() as Operator;
                let modified = false;
                const update: any = {};

                if (op.activeJobId === groupId || memberJobIds.includes(op.activeJobId || '')) {
                    update.activeJobId = null;
                    update.activePhaseName = null;
                    update.stato = 'inattivo';
                    modified = true;
                }

                const filteredSessions = (op.activeMaterialSessions || []).filter(s => {
                    const isLinked = s.originatorJobId === groupId || 
                                     memberJobIds.includes(s.originatorJobId || '') ||
                                     s.associatedJobs.some(aj => aj.jobId === groupId || memberJobIds.includes(aj.jobId));
                    return !isLinked;
                });

                if (filteredSessions.length !== (op.activeMaterialSessions || []).length) {
                    update.activeMaterialSessions = filteredSessions;
                    modified = true;
                }

                if (modified) {
                    t.update(opDoc.ref, update);
                }
            });

            // 2. Heal Group Phases (Close open work periods)
            const updatedPhases = (group.phases || []).map(p => {
                const hasOpen = (p.workPeriods || []).some(wp => !wp.end);
                if (hasOpen) {
                    const correctedWPs = p.workPeriods.map(wp => 
                        !wp.end ? { ...wp, end: wp.start, reason: 'Chiusura Forzata Healing' } : wp
                    );
                    return { ...p, status: 'paused', workPeriods: correctedWPs };
                }
                return p;
            });

            // CRITICAL: Filter out any 'undefined' values that crash Firestore update()
            const cleanedPhases = JSON.parse(JSON.stringify(updatedPhases));
            t.update(groupRef, { phases: cleanedPhases });
        });

        // 3. LOGGING
        await adminDb.collection("system_maintenance_logs").add({
            type: 'FORCE_GROUP_UNLOCK',
            executedAt: admin.firestore.Timestamp.now(),
            executedBy: operatorId,
            details: `Sblocco forzato eseguito sul gruppo ${groupId}. Sessioni operatore e fasi rimosse.`,
        });

        // 4. Proceed to standard dissolution
        // We use the already existing logic but now it should pass the safety checks
        return await dissolveWorkGroup(groupId, false, true);

    } catch (e) {
        console.error("Force Unlock Error:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore durante lo sblocco forzato." };
    }
}

/**
 * STEP 1: PREVIEW (DRY RUN)
 * Iterates through all materials and identifies discrepancies.
 * Rounds to 3 decimal places (0.001) to ignore floating point noise.
 */
export async function previewStockSync(uid: string): Promise<{ success: boolean; anomalies: StockSyncAnomaly[] }> {
    await ensureAdmin(uid);
    const anomalies: StockSyncAnomaly[] = [];
    
    try {
        const [materialsSnap, allWithdrawalsSnap] = await Promise.all([
            adminDb.collection("rawMaterials").get(),
            adminDb.collection("materialWithdrawals").get()
        ]);

        // Group withdrawals by material and lot
        const withdrawalsMap = new Map<string, Record<string, number>>();
        allWithdrawalsSnap.docs.forEach(doc => {
            const w = doc.data();
            if (w.materialId && w.lotto) {
                if (!withdrawalsMap.has(w.materialId)) {
                    withdrawalsMap.set(w.materialId, {});
                }
                const materialMap = withdrawalsMap.get(w.materialId)!;
                materialMap[w.lotto] = (materialMap[w.lotto] || 0) + (w.consumedUnits || 0);
            }
        });

        for (const doc of materialsSnap.docs) {
            const m = doc.data() as RawMaterial;
            const current = m.currentStockUnits || 0;
            const batches = m.batches || [];
            const withdrawalsForMaterial = withdrawalsMap.get(doc.id) || {};
            
            // --- LOT-BY-LOT CALCULATION (Matching Anagrafica Lotti UI) ---
            const batchesByLotto = batches.reduce((acc, b) => {
                const l = b.lotto || 'SENZA_LOTTO';
                if (!acc[l]) acc[l] = [];
                acc[l].push(b);
                return acc;
            }, {} as Record<string, any[]>);

            let calculatedTotal = 0;
            Object.entries(batchesByLotto).forEach(([lotto, batchList]) => {
                if (lotto === 'SENZA_LOTTO') return; // Ignore lottoless logic
                const loaded = batchList.reduce((sum, b) => sum + (b.netQuantity || 0), 0);
                const withdrawn = withdrawalsForMaterial[lotto] || 0;
                const available = Math.max(0, loaded - withdrawn);
                calculatedTotal += available;
            });

            // Apply Rounding (0.001 threshold)
            const roundedCurrent = Math.round(current * 1000) / 1000;
            const roundedCalculated = Math.round(calculatedTotal * 1000) / 1000;
            const diff = roundedCalculated - roundedCurrent;

            anomalies.push({
                materialId: doc.id,
                code: m.code,
                currentStock: roundedCurrent,
                calculatedStock: roundedCalculated,
                difference: diff,
                unitOfMeasure: m.unitOfMeasure || 'N/D',
                needsSync: Math.abs(diff) > 0.001
            });
        }
        
        return { success: true, anomalies: anomalies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)) };
    } catch (e) {
        console.error("Preview Stock Sync Error:", e);
        return { success: false, anomalies: [] };
    }
}

/**
 * STEP 2: SELECTIVE EXECUTION (Write)
 * Forces a ricalcolo of stock units ONLY for selected materials.
 */
export async function resyncAllMaterialStock(materialIds: string[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    const startTime = Date.now();
    let count = 0;
    
    try {
        if (!materialIds || materialIds.length === 0) {
            return { success: false, message: "Nessun materiale selezionato per il ricalcolo." };
        }

        // We process sequentially for safety
        for (const materialId of materialIds) {
            await recalculateMaterialStock(materialId);
            count++;
        }
        
        await adminDb.collection("system_maintenance_logs").add({
            action: 'SELECTIVE_STOCK_RESYNC',
            executedBy: uid,
            timestamp: admin.firestore.Timestamp.now(),
            totalProcessed: count,
            durationMs: Date.now() - startTime,
            summary: `Ricalcolo selettivo completato per ${count} materiali basandosi sulla somma dei lotti.`
        });
        
        return { success: true, message: `Ricalcolo completato con successo per ${count} materiali.` };
    } catch (error) {
        console.error("Selective resync error:", error);
        return { success: false, message: "Errore durante il ricalcolo selettivo del magazzino." };
    }
}
/**
 * DATA HEALING: Level 3 - Restore Corrupted Lot Loads
 * REWRITTEN EMERGENCY FIX: Sum(Current + Withdrawals) logic.
 * This restores the "Sacred Quantity" (Initial Load) by adding back all registered withdrawals.
 */
export async function fixCorruptedBatchLoads(uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const startTime = Date.now();
        
        // 1. Fetch EVERYTHING needed to avoid read-after-write transaction issues
        const [materialsSnap, withdrawalsSnap] = await Promise.all([
            adminDb.collection("rawMaterials").get(),
            adminDb.collection("materialWithdrawals").get()
        ]);

        const materials = materialsSnap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() as RawMaterial }));
        const withdrawals = withdrawalsSnap.docs.map(d => d.data() as MaterialWithdrawal);

        // 2. Map withdrawals by Material and Lotto for fast lookup
        const wMap = new Map<string, number>(); // "matId_lotto" -> totalUnits
        const wWeightMap = new Map<string, number>(); // "matId_lotto" -> totalWeight
        
        withdrawals.forEach(w => {
            if (!w.materialId || !w.lotto || w.status === 'cancelled') return;
            const key = `${w.materialId}_${w.lotto.trim()}`;
            wMap.set(key, (wMap.get(key) || 0) + (w.consumedUnits || 0));
            wWeightMap.set(key, (wWeightMap.get(key) || 0) + (w.consumedWeight || 0));
        });

        let healedLotsCount = 0;
        let materialsUpdatedCount = 0;
        let currentBatch = adminDb.batch();
        let opsInBatch = 0;

        // 3. Process every Material and its Batches
        for (const m of materials) {
            if (!m.data.batches || m.data.batches.length === 0) continue;

            const updatedBatches = JSON.parse(JSON.stringify(m.data.batches));
            let materialModified = false;

            updatedBatches.forEach((b: any) => {
                const lot = (b.lotto || '').trim();
                const key = `${m.id}_${lot}`;
                const totalWithdrawnUnits = wMap.get(key) || 0;
                const totalWithdrawnWeight = wWeightMap.get(key) || 0;

                // If withdrawals exist, we restore the initial load: Correct = Current + Withdrawn
                if (totalWithdrawnUnits > 0.001) {
                    const oldNet = b.netQuantity || 0;
                    const restoredNet = oldNet + totalWithdrawnUnits;
                    
                    // We only apply if there was a discrepancy (erosion detected)
                    // If the difference is significant (> 0.001)
                    if (totalWithdrawnUnits > 0.001) {
                        b.netQuantity = restoredNet;
                        
                        // Restore Weight: Initial Gross = Current Gross + Consumed Weight
                        // We use the withdrawal weight to be precise if recorded
                        b.grossWeight = (b.grossWeight || 0) + totalWithdrawnWeight;
                        
                        materialModified = true;
                        healedLotsCount++;
                    }
                }
            });

            if (materialModified) {
                // OVERWRITE ENTIRE ARRAY
                currentBatch.update(m.ref, { batches: updatedBatches });
                opsInBatch++;
                materialsUpdatedCount++;

                // Firestore batch limit is 500. We commit every 400 for safety.
                if (opsInBatch >= 400) {
                    await currentBatch.commit();
                    currentBatch = adminDb.batch(); // START A NEW BATCH
                    opsInBatch = 0;
                }
            }
        }

        // 4. Final commit for the remaining operations
        if (opsInBatch > 0) {
            await currentBatch.commit();
        }

        // 5. Log the healing operation
        await adminDb.collection("system_maintenance_logs").add({
            action: 'FIX_CORRUPTED_BATCH_LOADS_REWRITTEN',
            executedBy: uid,
            timestamp: new Date(),
            totalHealedLots: healedLotsCount,
            totalMaterialsUpdated: materialsUpdatedCount,
            durationMs: Date.now() - startTime,
            summary: `Sanatoria Massiva: Ripristinati i carichi iniziali (Somma Consumi) per ${healedLotsCount} lotti in ${materialsUpdatedCount} materiali.`
        });

        return { 
            success: true, 
            message: `Sanatoria Eseguita: ${healedLotsCount} lotti ripristinati con successo in ${materialsUpdatedCount} materiali. Ora i carichi riflettono il valore iniziale ante-erosione.` 
        };
    } catch (error) {
        console.error("Fix Corrupted Batches Error:", error);
        return { success: false, message: error instanceof Error ? error.message : "Errore durante il ripristino dei dati." };
    }
}

/**
 * HEALING: Sincronizzazione Globale Impegni Commesse ("CARRO ARMATO")
 * Allinea le commesse aperte alla Distinta Base attuale in Anagrafica.
 * Resistente agli errori su singole commesse, riporta successi e fallimenti.
 */
export async function syncAllJobOrderCommitments(uid: string): Promise<{ 
    success: boolean; 
    message: string; 
    processed: number; 
    failed: number; 
    errors: string[] 
}> {
    await ensureAdmin(uid);
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    try {
        const globalSettings = await getGlobalSettings();
        
        // 1. Recupera tutte le commesse aperte
        const jobsSnap = await adminDb.collection("jobOrders")
            .where("status", "in", ["planned", "production", "suspended", "paused"] as any[])
            .get();
        
        if (jobsSnap.empty) {
            return { success: true, message: "Nessuna commessa aperta da sincronizzare.", processed: 0, failed: 0, errors: [] };
        }

        // 2. Recupera Articoli e Materie Prime necessari
        const articleCodes = new Set<string>();
        jobsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.details) articleCodes.add(data.details.toUpperCase());
        });

        // Recuperiamo i dati in parallelo per velocità
        const [articles, rawMaterials] = await Promise.all([
            fetchInChunks<Article>(adminDb.collection("articles"), "code", Array.from(articleCodes)),
            adminDb.collection("rawMaterials").get().then(s => s.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial)))
        ]);

        const articlesMap = new Map(articles.map(a => [a.code.toUpperCase(), a]));

        // 3. Iterazione Resiliente (Carro Armato)
        // Usiamo un ciclo for...of per poter gestire i try-catch individuali
        for (const doc of jobsSnap.docs) {
            const job = doc.data() as JobOrder;
            const jobId = job.ordinePF || doc.id;

            try {
                // CONTROLLI RIGOROSI (Strict Null Checks)
                if (!job.details) {
                    throw new Error(`Commessa senza codice articolo (details mancante).`);
                }

                const article = articlesMap.get(job.details.toUpperCase());
                if (!article) {
                    throw new Error(`Articolo '${job.details}' non trovato in Anagrafica.`);
                }

                if (!Array.isArray(article.billOfMaterials)) {
                    throw new Error(`Articolo '${job.details}' ha una Distinta Base corrotta o mancante.`);
                }

                const originalBOM = job.billOfMaterials || [];
                const syncedBOMRaw = syncJobBOMItems(
                    job.qta,
                    originalBOM,
                    article.billOfMaterials,
                    rawMaterials,
                    globalSettings
                );

                // Sanitizzazione Payload per Firestore (No undefined)
                const syncedBOM = syncedBOMRaw.map(item => ({
                    ...item,
                    lunghezzaTaglioMm: item.lunghezzaTaglioMm ?? null,
                    fabbisognoTotale: item.fabbisognoTotale ?? 0,
                    pesoStimato: item.pesoStimato ?? 0,
                    note: item.note ?? ""
                }));

                // Update individuale per massimizzare il reporting e la stabilità
                await doc.ref.update({ 
                    billOfMaterials: syncedBOM,
                    lastSyncAction: 'GLOBAL_HEALING',
                    lastSyncTimestamp: admin.firestore.Timestamp.now()
                });

                processed++;
            } catch (jobError: any) {
                failed++;
                const errorMsg = `Commessa ${jobId}: ${jobError.message || "Errore sconosciuto"}`;
                errors.push(errorMsg);
                console.error(`[SYNC_HEALING_FAIL] ${errorMsg}`);
            }
        }

        // 4. Logging finale dell'operazione
        await adminDb.collection("system_maintenance_logs").add({
            action: 'SYNC_JOB_COMMITMENTS_GLOBAL_ROBUST',
            executedBy: uid,
            timestamp: new Date(),
            processed,
            failed,
            errorCount: errors.length,
            durationMs: Date.now() - startTime,
            summary: `Sync Global: ${processed} OK, ${failed} Falliti.`
        });

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/raw-material-management');

        return { 
            success: failed === 0, 
            message: failed === 0 
                ? `Sincronizzazione completata: tutte le ${processed} commesse aggiornate correttamente.`
                : `Sincronizzazione parziale: ${processed} commesse aggiornate, ${failed} errori riscontrati.`,
            processed,
            failed,
            errors
        };
    } catch (globalError: any) {
        console.error("Critical Sync Error:", globalError);
        return { 
            success: false, 
            message: "Errore critico durante l'inizializzazione dello script: " + (globalError.message || "Sconosciuto"),
            processed,
            failed,
            errors: [...errors, "CRASH GLOBALE: " + globalError.message]
        };
    }
}

// Helper per fetch in chunks se non già presente nel file (ma lo è in firestore-utils)
async function fetchInChunks<T>(collection: admin.firestore.CollectionReference, field: string, values: string[]): Promise<T[]> {
    const results: T[] = [];
    const CHUNK_SIZE = 30;
    for (let i = 0; i < values.length; i += CHUNK_SIZE) {
        const chunk = values.slice(i, i + CHUNK_SIZE);
        const snap = await collection.where(field, "in", chunk).get();
        snap.forEach(d => results.push({ id: d.id, ...d.data() } as T));
    }
    return results;
}

export interface GhostCommitmentAnomaly {
    id: string; // jobId + materialCode
    jobId: string;
    jobOrderPF: string;
    status: string;
    materialCode: string;
    neededQuantity: number;
    unit: string;
}

const FINISHED_STATUSES = [
    'FINE PROD.', 'FINE_PRODUZIONE', 'QLTY_PACK', 'QLTY & PACK', 
    'CHIUSO', 'CHIUSA', 'SPEDITA', 'COMPLETATA', 'COMPLETATO'
];

/**
 * RECONCILIATION: Step 1 - Audit Ghost Commitments
 * Finds jobs in finished status that still have unfulfilled BOM entries.
 */
export async function auditGhostCommitments(uid: string): Promise<{ success: boolean; anomalies: GhostCommitmentAnomaly[] }> {
    await ensureAdmin(uid);
    const anomalies: GhostCommitmentAnomaly[] = [];

    try {
        const jobsSnap = await adminDb.collection("jobOrders")
            .where("status", "in", FINISHED_STATUSES)
            .get();

        jobsSnap.forEach(doc => {
            const job = doc.data() as JobOrder;
            (job.billOfMaterials || []).forEach(item => {
                // If the BOM item is not withdrawn despite the job being "finished"
                if (item.status !== 'withdrawn' && ((item.fabbisognoTotale || 0) > 0 || (item.quantity || 0) > 0)) {
                    anomalies.push({
                        id: `${doc.id}_${item.component}`.replace(/\s+/g, '_'),
                        jobId: doc.id,
                        jobOrderPF: job.ordinePF,
                        status: job.status as string,
                        materialCode: item.component,
                        neededQuantity: item.fabbisognoTotale || item.quantity,
                        unit: item.unit
                    });
                }
            });
        });
        return { success: true, anomalies: anomalies.sort((a, b) => a.jobOrderPF.localeCompare(b.jobOrderPF)) };
    } catch (e) {
        console.error("Audit ghost commitments error:", e);
        return { success: false, anomalies: [] };
    }
}

/**
 * RECONCILIATION: Step 2 - Resolve Single Ghost Commitment
 * Manually marks a BOM item as 'withdrawn' for a specific job using a robust Read-Modify-Write pattern.
 */
export async function resolveSingleGhostCommitment(jobId: string, materialCode: string, uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    try {
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        let resultMessage = "";
        
        await adminDb.runTransaction(async (t) => {
            const snap = await t.get(jobRef);
            if (!snap.exists) throw new Error("Commessa non trovata.");
            const job = snap.data() as JobOrder;
            
            let modified = false;
            const newBOM = (job.billOfMaterials || []).map(item => {
                // Case insensitive check and check if not already withdrawn
                if (item.component.trim().toUpperCase() === materialCode.trim().toUpperCase() && item.status !== 'withdrawn') {
                    modified = true;
                    return { ...item, status: 'withdrawn' as const };
                }
                return item;
            });

            if (modified) {
                t.update(jobRef, { billOfMaterials: newBOM });
                resultMessage = `RICONCILIAZIONE: Chiuso impegno [${materialCode}] per ODL [${job.numeroODL || job.ordinePF}] - Esito: SUCCESS`;
            } else {
                resultMessage = `RICONCILIAZIONE: Impegno [${materialCode}] per ODL [${job.numeroODL || job.ordinePF}] già evaso o non trovato.`;
            }
        });
        
        console.log(resultMessage);
        return { success: true, message: resultMessage };
    } catch (e: any) {
        const errorMsg = `RICONCILIAZIONE ERROR: Fallimento chiusura impegno [${materialCode}] per ODL [${jobId}] - ${e.message}`;
        console.error(errorMsg);
        return { success: false, message: errorMsg };
    }
}

/**
 * RECONCILIATION: Step 3 - Combined Stock & Commitment Sync
 * First recalculates global stock, then scans all finished jobs to close matching commitments.
 * Mandatory Coupling version.
 */
export async function resyncSingleMaterialStock(materialId: string, uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    try {
        // 1. Recalculate Stock
        await recalculateMaterialStock(materialId);
        
        // 2. Load Material Code for the scan
        const matSnap = await adminDb.collection("rawMaterials").doc(materialId).get();
        if (!matSnap.exists) throw new Error("Materiale non trovato.");
        const matCode = matSnap.data()?.code;
        if (!matCode) throw new Error("Codice materiale mancante.");

        // 3. Scan & Heal Finished Jobs (Mandatory Coupling)
        const jobsSnap = await adminDb.collection("jobOrders")
            .where("status", "in", FINISHED_STATUSES)
            .get();

        let healedCount = 0;
        
        // Use sequential processing for transactions to ensure stability
        for (const doc of jobsSnap.docs) {
            const job = doc.data() as JobOrder;
            const hasPending = (job.billOfMaterials || []).some(
                item => item.component.trim().toUpperCase() === matCode.trim().toUpperCase() && item.status !== 'withdrawn'
            );

            if (hasPending) {
                const res = await resolveSingleGhostCommitment(doc.id, matCode, uid);
                if (res.success) healedCount++;
            }
        }

        const finalMsg = `Sincronizzazione completata per ${matCode}. Ricalcolato Stock Master e chiusi ${healedCount} impegni fantasma.`;
        console.log(`RICONCILIAZIONE TOTALE: ${matCode} - Stock ricalcolato - Impegni chiusi: ${healedCount}`);
        
        return { success: true, message: finalMsg };
    } catch (e: any) {
        console.error("Combined resync error:", e);
        return { success: false, message: `Errore nella sincronizzazione accoppiata: ${e.message}` };
    }
}

/**
 * STEP 2: ALLINEAMENTO SPUNTE BOM DA STORICO PRELIEVI
 * Legge i log dei prelievi e forza lo stato 'withdrawn' sulle BOM delle commesse.
 * NON tocca le giacenze di magazzino.
 */
export async function alignBOMFromWithdrawalHistory(uid: string): Promise<{ success: boolean; message: string; jobsProcessed: number }> {
    await ensureAdmin(uid);
    const startTime = Date.now();
    let jobsProcessed = 0;
    
    try {
        // 1. Pre-fetch materiale e tipi per matching rapido
        const materialsSnap = await adminDb.collection('rawMaterials').get();
        const materialTypeMap = new Map<string, string>();
        materialsSnap.docs.forEach(d => {
            const m = d.data();
            if (m.code) materialTypeMap.set(m.code.toUpperCase(), m.type.toUpperCase());
        });

        // 2. Recupera tutti i prelievi che hanno un jobId associato
        const withdrawalsSnap = await adminDb.collection('materialWithdrawals').get();
        
        // Mappa: jobId -> { codes: Set<string>, types: Set<string> }
        const jobWithdrawals = new Map<string, { codes: Set<string>, types: Set<string> }>();

        withdrawalsSnap.docs.forEach(doc => {
            const w = doc.data() as MaterialWithdrawal;
            // Un prelievo può essere associato a più jobIds (sessioni condivise)
            const ids = w.jobIds || w.associatedJobIds || [];
            
            ids.forEach((id: string) => {
                if (!id) return;
                if (!jobWithdrawals.has(id)) {
                    jobWithdrawals.set(id, { codes: new Set(), types: new Set() });
                }
                
                const entry = jobWithdrawals.get(id)!;
                if (w.materialCode) {
                    const codeUpper = w.materialCode.toUpperCase();
                    entry.codes.add(codeUpper);
                    const type = materialTypeMap.get(codeUpper);
                    if (type) entry.types.add(type);
                }
            });
        });

        const jobIds = Array.from(jobWithdrawals.keys());
        
        // 3. Iterazione su ogni JobOrder per allineare la BOM
        for (const rawId of jobIds) {
            const sanitizedId = rawId.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
            const jobRef = adminDb.collection('jobOrders').doc(sanitizedId);
            
            await adminDb.runTransaction(async (t) => {
                const snap = await t.get(jobRef);
                if (!snap.exists) return;
                
                const job = snap.data() as JobOrder;
                if (!job.billOfMaterials || job.billOfMaterials.length === 0) return;

                const withdrawalData = jobWithdrawals.get(rawId)!;
                let modified = false;

                const updatedBOM = job.billOfMaterials.map(item => {
                    const compCode = (item.component || '').toUpperCase();
                    const compType = materialTypeMap.get(compCode);

                    const matchCode = withdrawalData.codes.has(compCode);
                    const matchType = compType && withdrawalData.types.has(compType);

                    // Se abbiamo trovato un prelievo storico per questo codice o tipo
                    if ((matchCode || matchType) && (item.status !== 'withdrawn' || !item.withdrawn)) {
                        modified = true;
                        return { 
                            ...item, 
                            status: 'withdrawn' as const, 
                            withdrawn: true 
                        };
                    }
                    return item;
                });

                if (modified) {
                    t.update(jobRef, { billOfMaterials: updatedBOM });
                }
            });
            jobsProcessed++;
        }

        // 4. Logging dell'operazione di sanatoria
        await adminDb.collection("system_maintenance_logs").add({
            action: 'BOM_ALIGNMENT_FROM_HISTORY',
            executedBy: uid,
            timestamp: admin.firestore.Timestamp.now(),
            jobsProcessed,
            durationMs: Date.now() - startTime,
            summary: `Allineate spunte BOM (withdrawn) per ${jobsProcessed} commesse analizzando lo storico prelievi.`
        });

        return { 
            success: true, 
            message: `Allineamento completato: analizzate ${jobIds.length} commesse, aggiornate ${jobsProcessed} commesse.`, 
            jobsProcessed 
        };
    } catch (e: any) {
        console.error("BOM alignment history error:", e);
        return { success: false, message: `Errore: ${e.message}`, jobsProcessed: 0 };
    }
}

/**
 * RISOLUTORE RACE CONDITION CHIRURGICO (Safe Sync)
 * Forza lo stato 'withdrawn' su un singolo componente di una singola commessa.
 * NON tocca le giacenze.
 */
export async function surgicalBOMSync(
    jobId: string, 
    materialCode: string, 
    uid: string
): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    try {
        const sanitizedId = jobId.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
        const jobRef = adminDb.collection('jobOrders').doc(sanitizedId);
        const targetMaterial = materialCode.trim().toUpperCase();

        const result = await adminDb.runTransaction(async (t) => {
            const snap = await t.get(jobRef);
            if (!snap.exists) throw new Error(`Commessa ${jobId} non trovata.`);

            const job = snap.data() as JobOrder;
            if (!job.billOfMaterials) throw new Error("La commessa non ha una distinta base.");

            let modified = false;
            const updatedBOM = job.billOfMaterials.map(item => {
                const comp = (item.component || '').trim().toUpperCase();
                if (comp === targetMaterial && (item.status !== 'withdrawn' || !item.withdrawn)) {
                    modified = true;
                    return { ...item, status: 'withdrawn' as const, withdrawn: true };
                }
                return item;
            });

            if (modified) {
                t.update(jobRef, { billOfMaterials: updatedBOM });
                return true;
            }
            return false;
        });

        if (result) {
            await adminDb.collection("system_maintenance_logs").add({
                action: 'SURGICAL_BOM_SYNC',
                executedBy: uid,
                timestamp: admin.firestore.Timestamp.now(),
                details: `Sincronizzato chirurgicamente ${materialCode} per Job ${jobId}`,
            });
            return { success: true, message: `Sincronizzazione completata per ${materialCode} nel Job ${jobId}.` };
        } else {
            return { success: true, message: `L'item ${materialCode} era già marcato come prelevato.` };
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

/**
 * SANATORIA MASSIVA STOCK (Healing)
 * Esegue il ricalcolo per TUTTE le materie prime, applicando la nuova logica FIFO
 * che riassorbe i prelievi anonimi nei lotti esistenti.
 */
export async function runMassiveStockRecalculation(uid: string): Promise<{ success: boolean; message: string; processed: number }> {
    await ensureAdmin(uid);
    try {
        const materialsSnap = await adminDb.collection("rawMaterials").get();
        let processed = 0;
        
        for (const doc of materialsSnap.docs) {
            await recalculateMaterialStock(doc.id);
            processed++;
        }

        await adminDb.collection("system_maintenance_logs").add({
            action: 'MASSIVE_RECALCULATION_FIFO',
            executedBy: uid,
            timestamp: admin.firestore.Timestamp.now(),
            details: `Ricalcolo massivo FIFO completato per ${processed} materiali.`,
        });

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Ricalcolo completato per ${processed} materiali.`, processed };
    } catch (e: any) {
        console.error("Massive recalculation error:", e);
        return { success: false, message: e.message, processed: 0 };
    }
}



