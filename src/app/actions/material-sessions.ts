'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { IndependentMaterialSession, RawMaterial } from '@/types';
import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';

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

        // TRANSACTIONAL LOCK
        await adminDb.runTransaction(async (transaction) => {
            const materialRef = adminDb.collection('rawMaterials').doc(data.materialId);
            const matSnap = await transaction.get(materialRef);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;
            
            if (data.lotto) {
                const batches = [...(material.batches || [])];
                const batchIdx = batches.findIndex(b => b.lotto === data.lotto);
                
                if (batchIdx === -1) throw new Error(`Lotto "${data.lotto}" non trovato a magazzino.`);
                
                const batch = batches[batchIdx];
                if (batch.activeSessionId) {
                    throw new Error("Questo lotto è già impegnato in una sessione attiva. Chiudi la sessione esistente per procedere.");
                }
                
                // Set the lock
                batches[batchIdx].activeSessionId = sessionId;
                transaction.update(materialRef, { batches });
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
                    const sanitizedId = id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
                    return transaction.get(adminDb.collection('jobOrders').doc(sanitizedId));
                })
            ]);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map(d => d.data());

            // 2. CALCULATIONS
            let consumedWeight = 0;
            if (isFinished && session.lotto) {
                const batch = (material.batches || []).find(b => b.lotto === session.lotto);
                if (!batch) throw new Error("Lotto non trovato durante il saldo finale.");
                
                const withdrawn = withdrawals
                    .filter(w => w.lotto === session.lotto && w.status !== 'cancelled')
                    .reduce((sum, w) => sum + (w.consumedWeight || 0), 0);
                
                const initialWeight = batch.grossWeight - batch.tareWeight;
                consumedWeight = Math.max(0, initialWeight - withdrawn);
            } else {
                consumedWeight = session.grossOpeningWeight - closingGrossWeight;
                if (consumedWeight < -0.001) throw new Error("Il peso di chiusura non può essere superiore a quello di apertura.");
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
                consumedWeight, 
                'kg',
                false,
                session.lotto || undefined,
                withdrawals
            );

            // 3. START WRITES - NO READS ALLOWED AFTER THIS
            const matUpdates: any = {
                stock: admin.firestore.FieldValue.increment(-unitsToChange),
                currentStockUnits: admin.firestore.FieldValue.increment(-unitsToChange),
                currentWeightKg: admin.firestore.FieldValue.increment(-weightToChange)
            };

            // UNLOCK LOGIC
            if (session.lotto) {
                const bIdx = updatedBatches.findIndex(b => b.lotto === session.lotto);
                if (bIdx !== -1) {
                    // Clear the lock
                    updatedBatches[bIdx].activeSessionId = null;
                    
                    if (isFinished) {
                        updatedBatches[bIdx].isExhausted = true;
                    }
                    matUpdates.batches = updatedBatches;
                }
            } else {
                // If no specific lot but we have updatedBatches (FIFO), we should still pass them if we made any changes
                matUpdates.batches = updatedBatches;
            }
            
            transaction.update(materialRef, matUpdates);

            // Update Job Orders using pre-fetched snapshots
            jobSnaps.forEach((jSnap, idx) => {
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

            // Create withdrawal record
            const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
            // Map snapshots back to PFs for the report
            const jobPFs = jobSnaps.filter(s => s.exists).map(s => (s.data() as any).ordinePF || s.id);

            transaction.set(withdrawalRef, {
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
            });

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
