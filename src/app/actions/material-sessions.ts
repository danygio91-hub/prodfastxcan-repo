'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { IndependentMaterialSession, RawMaterial } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';
import {
    prepareWithdrawalMovement,
    finalizePostWithdrawalMaterialState,
} from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import {
    hydrateMaterialWithWithdrawals,
    getLotResidualSummary,
    normStockLot,
} from '@/lib/stock-logic';

export async function startIndependentSession(data: Omit<IndependentMaterialSession, 'id' | 'startedAt' | 'status'>) {
    try {
        const sessionId = `ms-${Date.now()}`;
        
        // Resolve IDs if PFs are provided in the input list
        const resolvedIds: string[] = [];
        const resolvedPFs: string[] = [];
        
        const inputIds = data.linkedJobOrderIds || [];
        for (const input of inputIds) {
            if (input && input.includes('/PF')) {
                const jobSnap = await adminDb.collection('jobOrders').where('ordinePF', '==', input).limit(1).get();
                if (!jobSnap.empty) {
                    resolvedIds.push(jobSnap.docs[0].id);
                    resolvedPFs.push(input);
                }
            } else if (input) {
                resolvedIds.push(input);
                const jobSnap = await adminDb.collection('jobOrders').doc(input).get();
                if (jobSnap.exists) {
                    resolvedPFs.push((jobSnap.data() as any).ordinePF || input);
                } else {
                    resolvedPFs.push(input);
                }
            }
        }

        const session: IndependentMaterialSession = {
            ...data,
            id: sessionId,
            startedAt: admin.firestore.Timestamp.now(),
            status: 'open',
            linkedJobOrderIds: resolvedIds,
            linkedJobOrderPFs: resolvedPFs
        };

        // TRANSACTIONAL LOCK (FASE 89: Multiple-Batch SSoT Hydration)
        await adminDb.runTransaction(async (transaction) => {
            const materialRef = adminDb.collection('rawMaterials').doc(data.materialId);
            const [matSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', data.materialId).get()
            ]);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = { ...(matSnap.data() as RawMaterial), id: matSnap.id };
            const withdrawals = withdrawalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
            
            // Idratazione SSoT del materiale per calcolare la disponibilità reale aggregata del lotto padre
            const hydratedMaterial = hydrateMaterialWithWithdrawals(material, withdrawals);

            if (data.lotto) {
                const targetNorm = normStockLot(data.lotto);
                const residual = getLotResidualSummary(hydratedMaterial, data.lotto);
                
                if (residual.matchingBatches.length === 0) {
                    throw new Error(`Lotto "${data.lotto}" non trovato a magazzino.`);
                }
                
                const isAlreadyLocked = (material.batches || []).some(
                    b => normStockLot(b.lotto) === targetNorm && Boolean(b.activeSessionId)
                );
                if (isAlreadyLocked) {
                    throw new Error("Questo lotto è già impegnato in una sessione attiva. Chiudi la sessione esistente per procedere.");
                }
                
                // FASE 89: Controlla isExhausted o giacenza zero ESCLUSIVAMENTE su residual.availableUnits / residual.availableWeightKg
                if (residual.isExhausted || residual.availableUnits <= 0.001 || residual.availableWeightKg <= 0.001) {
                    throw new Error("Impossibile aprire una sessione su un lotto esaurito (giacenza zero).");
                }

                // Imposta activeSessionId = sessionId su TUTTI i sub-batch appartenenti al lotto normalizzato
                // e riallinea il flag isExhausted sul singolo sub-batch in base al suo residuo idratato
                const hydratedById = new Map((hydratedMaterial.batches || []).map(b => [b.id, b]));
                const updatedBatches = (material.batches || []).map(b => {
                    if (normStockLot(b.lotto) !== targetNorm) return b;
                    const hb = hydratedById.get(b.id);
                    return {
                        ...b,
                        activeSessionId: sessionId,
                        isExhausted: hb ? Boolean(hb.isExhausted) : b.isExhausted,
                    };
                });

                transaction.update(materialRef, { batches: updatedBatches });
            }
            
            transaction.set(adminDb.collection('materialSessions').doc(sessionId), session);
        });

        revalidatePath('/scan-job');
        revalidatePath('/manual-withdrawal');
        revalidatePath('/admin/production-console');
        return { success: true, sessionId };
    } catch (e) {
        console.error("Error starting independent session:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore durante l'avvio della sessione." };
    }
}

export const startMaterialSession = startIndependentSession;

export async function addJobsToSession(sessionId: string, jobIdsOrPFs: string[]) {
    try {
        const sessionRef = adminDb.collection('materialSessions').doc(sessionId);
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(sessionRef);
            if (!snap.exists) throw new Error("Sessione non trovata.");
            const data = snap.data() as IndependentMaterialSession;
            
            // Resolve IDs if PFs are provided
            const resolvedIds: string[] = [];
            for (const input of jobIdsOrPFs) {
                if (input.includes('/PF')) {
                    const jobSnap = await adminDb.collection('jobOrders').where('ordinePF', '==', input).limit(1).get();
                    if (!jobSnap.empty) {
                        resolvedIds.push(jobSnap.docs[0].id);
                    } else {
                        throw new Error(`Commessa con PF ${input} non trovata.`);
                    }
                } else {
                    resolvedIds.push(input);
                }
            }

            const currentIds = data.linkedJobOrderIds || [];
            const newIds = Array.from(new Set([...currentIds, ...resolvedIds]));
            
            // Fetch PFs for UI
            const jobSnaps = await Promise.all(newIds.map(id => transaction.get(adminDb.collection('jobOrders').doc(id))));
            const newPFs = jobSnaps.filter(s => s.exists).map(s => (s.data() as any).ordinePF || s.id);

            transaction.update(sessionRef, { 
                linkedJobOrderIds: newIds,
                linkedJobOrderPFs: newPFs
            });
        });
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        return { success: true };
    } catch (e) {
        console.error("Error adding jobs to session:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore durante l'aggiornamento della sessione." };
    }
}

export async function closeIndependentSession(sessionId: string, closingGrossWeight: number, isFinished: boolean = false) {
    try {
        const globalSettings = await getGlobalSettings();
        
        await adminDb.runTransaction(async (transaction) => {
            const sessionRef = adminDb.collection('materialSessions').doc(sessionId);
            const sessionSnap = await transaction.get(sessionRef);
            if (!sessionSnap.exists) throw new Error("Sessione non trovata.");
            const session = sessionSnap.data() as IndependentMaterialSession;

            const materialRef = adminDb.collection('rawMaterials').doc(session.materialId);
            
            // 1. COLLECT ALL READS AT THE START
            const jobIds = session.linkedJobOrderIds || [];
            const [matSnap, withdrawalsSnap, ...jobSnaps] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', session.materialId).get(),
                ...jobIds.map(id => {
                    const sanitizedId = id.replace(/\//g, '-');
                    return transaction.get(adminDb.collection('jobOrders').doc(sanitizedId));
                })
            ]);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = { ...(matSnap.data() as RawMaterial), id: matSnap.id };
            const withdrawals = withdrawalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

            // 2. CALCULATIONS (FASE 89: Idratazione SSoT e singola tara attiva, senza sommare tare storiche)
            const hydratedMaterial = hydrateMaterialWithWithdrawals(material, withdrawals);
            const residual = session.lotto ? getLotResidualSummary(hydratedMaterial, session.lotto) : null;

            const currentRealNet = session.lotto
                ? (residual?.availableWeightKg ?? 0)
                : Math.max(0, hydratedMaterial.currentWeightKg || 0);

            const activeRefBatch = residual?.activeBatch;
            const effectiveTareWeight =
                session.tareWeight !== undefined && session.tareWeight !== null
                    ? Number(session.tareWeight)
                    : Number(activeRefBatch?.tareWeight || 0);

            const currentRealGross = Number((currentRealNet + effectiveTareWeight).toFixed(3));

            let consumedWeight = 0;
            if (isFinished && session.lotto) {
                if (!residual || residual.matchingBatches.length === 0) {
                    throw new Error("Lotto non trovato durante il saldo finale.");
                }
            } else if (!isFinished) {
                // SSoT VALIDATION: Compare input Gross vs Real-time Calculated Gross
                consumedWeight = currentRealGross - closingGrossWeight;
                
                // Tolerance of 0.01 to allow for small scale fluctuations
                if (consumedWeight < -0.01) {
                    throw new Error(`Il peso di chiusura (${closingGrossWeight}) non può essere superiore al Lordo Atteso (${currentRealGross.toFixed(3)}).`);
                }
                consumedWeight = Math.max(0, consumedWeight);
            }

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
                quantity: consumedWeight,
                inputUom: 'kg',
                lotto: session.lotto || undefined,
                isFinished,
                clearActiveSession: true,
            });

            // Create withdrawal record
            const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
            const jobPFs = jobSnaps.filter(s => s.exists).map(s => (s.data() as any).ordinePF || s.id);
            const newWithdrawalDoc = {
                associatedJobIds: jobIds, 
                jobIds: jobIds, 
                jobOrderPFs: jobPFs, 
                materialId: session.materialId,
                materialCode: session.materialCode,
                consumedWeight: weightToChange,
                consumedUnits: unitsToChange,
                operatorId: session.operatorId,
                operatorName: session.operatorName,
                withdrawalDate: admin.firestore.Timestamp.now(),
                lotto: usedLotto,
                isFinal: isFinished,
                sessionId: sessionId,
                source: 'session'
            };

            const postState = finalizePostWithdrawalMaterialState(
                material,
                updatedBatches,
                withdrawals,
                { id: withdrawalRef.id, ...newWithdrawalDoc }
            );

            // 3. START WRITES - NO READS ALLOWED AFTER THIS
            transaction.update(materialRef, {
                batches: postState.syncedBatches,
                stock: postState.currentStockUnits,
                currentStockUnits: postState.currentStockUnits,
                currentWeightKg: postState.currentWeightKg,
            });

            // Update Job Orders using pre-fetched snapshots
            jobSnaps.forEach((jSnap) => {
                if (jSnap.exists) {
                    const jData = jSnap.data() as any;
                    let modified = false;
                    const updatedBOM = (jData.billOfMaterials || []).map((item: any) => {
                        const match = item.component?.trim().toUpperCase() === session.materialCode.trim().toUpperCase();
                        if (match && !item.withdrawn) {
                            modified = true;
                            return { ...item, status: 'withdrawn', withdrawn: true };
                        }
                        return item;
                    });
                    if (modified) {
                        transaction.update(jSnap.ref, { billOfMaterials: updatedBOM });
                    }
                }
            });

            transaction.set(withdrawalRef, newWithdrawalDoc);

            transaction.update(sessionRef, { status: 'closed' });
        });

        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/reports'); // Revalidate reports as per requirement 3
        return { success: true, message: "Sessione chiusa e magazzino aggiornato correttamente." };
    } catch (e) {
        console.error("Close independent session error:", e);
        return { success: false, message: e instanceof Error ? e.message : "Errore chiusura sessione." };
    }
}

export async function abortMaterialSession(sessionId: string, materialId: string, lotto: string | null) {
    try {
        await adminDb.runTransaction(async (transaction) => {
            const sessionRef = adminDb.collection("materialSessions").doc(sessionId);
            const materialRef = adminDb.collection("rawMaterials").doc(materialId);
            const matSnap = await transaction.get(materialRef);
            
            // EMERGENCY LOCK RELEASE (FASE 89: Rimuove activeSessionId: null su TUTTI i sub-batch del lotto normalizzato)
            if (matSnap.exists && lotto) {
                const material = matSnap.data() as RawMaterial;
                const targetNorm = normStockLot(lotto);
                let modified = false;
                const batches = (material.batches || []).map(b => {
                    if (normStockLot(b.lotto) === targetNorm) {
                        modified = true;
                        return { ...b, activeSessionId: null };
                    }
                    return b;
                });
                if (modified) {
                    transaction.update(materialRef, { batches });
                }
            }
            
            // BRUTE DELETE - No checks
            transaction.delete(sessionRef);
        });
        
        revalidatePath('/scan-job');
        revalidatePath('/admin/production-console');
        return { success: true, message: "Sessione annullata e lotto sbloccato con successo." };
    } catch (e) {
        console.error("Abort session error:", e);
        return { success: false, message: "Errore durante l'annullamento della sessione." };
    }
}

export async function getOpenSessions(): Promise<IndependentMaterialSession[]> {
    try {
        const snap = await adminDb.collection('materialSessions')
            .where('status', '==', 'open')
            .orderBy('startedAt', 'desc')
            .get();
        
        return snap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                startedAt: data.startedAt?.toDate ? data.startedAt.toDate() : data.startedAt
            } as IndependentMaterialSession;
        });
    } catch (e) {
        console.error("Error fetching open material sessions:", e);
        return [];
    }
}
