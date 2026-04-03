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

        await adminDb.collection('materialSessions').doc(sessionId).set(session);
        revalidatePath('/scan-job');
        revalidatePath('/manual-withdrawal');
        revalidatePath('/admin/production-console');
        return { success: true, sessionId };
    } catch (e) {
        console.error("Error starting independent session:", e);
        return { success: false, message: "Errore durante l'avvio della sessione." };
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
        await adminDb.runTransaction(async (transaction) => {
            const sessionRef = adminDb.collection('materialSessions').doc(sessionId);
            const sessionSnap = await transaction.get(sessionRef);
            if (!sessionSnap.exists) throw new Error("Sessione non trovata.");
            const session = sessionSnap.data() as IndependentMaterialSession;

            const materialRef = adminDb.collection('rawMaterials').doc(session.materialId);
            const [matSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', session.materialId).get()
            ]);
            
            if (!matSnap.exists) throw new Error("Materiale non trovato.");
            const material = matSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map(d => d.data());

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

            const globalSettings = await getGlobalSettings();
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

            if (isFinished && usedLotto) {
                const bIdx = updatedBatches.findIndex(b => b.lotto === usedLotto);
                if (bIdx !== -1) {
                    updatedBatches[bIdx].isExhausted = true;
                }
            }

            transaction.update(materialRef, {
                batches: updatedBatches
            });

            await recalculateMaterialStock(session.materialId, transaction, { material, batches: updatedBatches, withdrawals });

            // CREATE SINGLE WITHDRAWAL RECORD
            const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
            
            // Fetch PFs if needed for better reporting (optional but good for UX)
            const jobSnaps = await Promise.all(
                (session.linkedJobOrderIds || []).map(id => adminDb.collection('jobOrders').doc(id).get())
            );
            const jobPFs = jobSnaps.filter(s => s.exists).map(s => (s.data() as any).ordinePF || s.id);

            transaction.set(withdrawalRef, {
                associatedJobIds: session.linkedJobOrderIds, // As requested
                jobIds: session.linkedJobOrderIds, // For compatibility
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
                sessionId: sessionId
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
