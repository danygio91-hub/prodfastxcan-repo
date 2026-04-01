'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { RawMaterial, InventoryRecord, MaterialWithdrawal, JobOrder, Operator, JobPhase } from '@/types';
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
export async function healZombieSessions(uid: string): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    let count = 0;
    
    try {
        const audit = await auditZombieSessions();
        if (audit.anomalies.length === 0) return { success: true, message: "Nessuna sessione zombie da chiudere." };

        const batch = adminDb.batch();

        for (const a of audit.anomalies) {
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

            t.update(groupRef, { phases: updatedPhases });
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
        return await dissolveWorkGroup(groupId, false);

    } catch (e) {
        console.error("Force Unlock Error:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore durante lo sblocco forzato." };
    }
}
