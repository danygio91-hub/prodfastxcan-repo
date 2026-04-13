'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, PackingList, PackingListItem } from '@/types';

/**
 * Recupera tutte le commesse candidabili per la Packing List.
 * Candidabili: macroArea 'QLTY_PACK' o stato 'QLTY & PACK', e NON ancora spedite.
 */
export async function getAvailableJobsForPacking(): Promise<JobOrder[]> {
    try {
        const snap = await adminDb.collection('jobOrders')
            .where('status', 'not-in', ['SPEDITA', 'CHIUSO']) // Escludi già chiuse o spedite
            .get();
        
        // Ulteriore filtro manuale per macroArea o specifici stati se necessario
        // Il cliente vuole che siano candidabili dopo l'ultima fase produttiva.
        const jobs = snap.docs.map(doc => ({
            ...doc.data(),
            id: doc.id
        } as JobOrder));

        // Filtriamo per macroArea o per chi ha terminato le fasi
        return jobs.filter(j => 
            j.macroArea === 'QLTY_PACK' || 
            j.status === 'QLTY & PACK' || 
            j.status === 'FINE PROD.' ||
            j.status === 'PRONTO PROD.' // Inclusione conservativa per sicurezza
        );
    } catch (error) {
        console.error("Error fetching available jobs for packing:", error);
        return [];
    }
}

/**
 * Genera l'ID mnemonico incrementale PL-GGMMAAAA-XXX
 */
async function generatePackingListId(transaction: admin.firestore.Transaction): Promise<string> {
    const now = new Date();
    const gg = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const aaaa = String(now.getFullYear());
    const dateStr = `${gg}${mm}${aaaa}`;
    
    const counterRef = adminDb.collection('counters').doc('packingLists');
    const counterSnap = await transaction.get(counterRef);
    
    let count = 1;
    if (counterSnap.exists) {
        const data = counterSnap.data();
        if (data?.lastDate === dateStr) {
            count = (data.lastCount || 0) + 1;
        }
    }
    
    transaction.set(counterRef, {
        lastDate: dateStr,
        lastCount: count
    }, { merge: true });
    
    const countStr = String(count).padStart(3, '0');
    return `PL-${dateStr}-${countStr}`;
}

/**
 * Crea una nuova Packing List e aggiorna lo stato delle commesse.
 */
export async function createPackingList(
    operatorId: string, 
    operatorName: string, 
    items: { jobId: string, quantity: number, weight?: number, packages?: number }[]
): Promise<{ success: boolean; message: string; packingListId?: string }> {
    try {
        const result = await adminDb.runTransaction(async (transaction) => {
            const plId = await generatePackingListId(transaction);
            const plRef = adminDb.collection('packingLists').doc(plId);
            
            const packingListItems: PackingListItem[] = [];
            
            for (const item of items) {
                const jobRef = adminDb.collection('jobOrders').doc(item.jobId);
                const jobSnap = await transaction.get(jobRef);
                
                if (!jobSnap.exists) throw new Error(`Commessa ${item.jobId} non trovata.`);
                const jobData = jobSnap.data() as JobOrder;
                
                // Salviamo le info necessarie per il report e il rollback
                packingListItems.push({
                    jobId: item.jobId,
                    orderPF: jobData.ordinePF,
                    odl: jobData.numeroODLInterno || jobData.numeroODL || 'N/D',
                    articleCode: jobData.details,
                    client: jobData.cliente || 'Sconosciuto',
                    quantity: item.quantity,
                    previousStatus: jobData.status
                });
                
                // Aggiorniamo la commessa
                transaction.update(jobRef, {
                    status: 'SPEDITA',
                    lastStatusChange: admin.firestore.FieldValue.serverTimestamp(),
                    packingListId: plId,
                    actualWeightKg: item.weight || 0,
                    numberOfPackages: item.packages || 0
                });
            }
            
            const newPL: PackingList = {
                id: plId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                operatorId,
                operatorName,
                items: packingListItems,
                status: 'active'
            };
            
            transaction.set(plRef, newPL);
            return { plId };
        });

        revalidatePath('/operator/packing');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/resource-planning');
        
        return { 
            success: true, 
            message: `Packing List ${result.plId} creata con successo.`,
            packingListId: result.plId 
        };
    } catch (error: any) {
        console.error("Error creating packing list:", error);
        return { success: false, message: error.message || "Errore durante la creazione." };
    }
}

/**
 * Recupera lo storico delle Packing List (attive)
 */
export async function getPackingLists(): Promise<PackingList[]> {
    const snap = await adminDb.collection('packingLists')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
        
    return snap.docs.map(doc => doc.data() as PackingList);
}

/**
 * Annulla una Packing List e ripristina lo stato delle commesse.
 */
export async function cancelPackingList(packingListId: string): Promise<{ success: boolean; message: string }> {
    try {
        await adminDb.runTransaction(async (transaction) => {
            const plRef = adminDb.collection('packingLists').doc(packingListId);
            const plSnap = await transaction.get(plRef);
            
            if (!plSnap.exists) throw new Error("Packing List non trovata.");
            const plData = plSnap.data() as PackingList;
            
            if (plData.status === 'cancelled') throw new Error("Packing List già annullata.");
            
            // Ripristino commesse
            for (const item of plData.items) {
                const jobRef = adminDb.collection('jobOrders').doc(item.jobId);
                transaction.update(jobRef, {
                    status: item.previousStatus,
                    packingListId: admin.firestore.FieldValue.delete(),
                    lastStatusChange: admin.firestore.FieldValue.serverTimestamp()
                });
            }
            
            // Marca PL come annullata
            transaction.update(plRef, {
                status: 'cancelled',
                cancelledAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        revalidatePath('/operator/packing');
        revalidatePath('/admin/production-console');
        
        return { success: true, message: "Packing List annullata e stati ripristinati." };
    } catch (error: any) {
        console.error("Error cancelling packing list:", error);
        return { success: false, message: error.message || "Errore durante l'annullamento." };
    }
}

/**
 * Recupera gli articoli per calcolare pesi.
 */
export async function getArticlesByCodes(codes: string[]) {
    if (!codes || codes.length === 0) return [];
    
    const uniqueCodes = [...new Set(codes.map(c => c.toUpperCase()))];
    const results: any[] = [];
    
    // Firestore 'in' query limit is 30
    for (let i = 0; i < uniqueCodes.length; i += 30) {
        const chunk = uniqueCodes.slice(i, i + 30);
        const snap = await adminDb.collection('articles').where('code', 'in', chunk).get();
        snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
    }
    
    return results;
}
