'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, Article } from '@/types';

/**
 * Recupera tutte le commesse che sono nello stato 'completed' (prontte per la spedizione).
 */
export async function getCompletedJobs(): Promise<JobOrder[]> {
    try {
        const snap = await adminDb.collection('jobOrders')
            .where('status', '==', 'completed')
            .get();
        
        // Helper to convert Firestore Timestamps to JS Dates if needed, 
        // though for the UI completed list we mostly need strings and IDs.
        return snap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                // In un vero scenario convertiremmo i timestamp qui
            } as JobOrder;
        });
    } catch (error) {
        console.error("Error fetching completed jobs:", error);
        return [];
    }
}

/**
 * Recupera gli articoli per calcolare pesi e visualizzare istruzioni imballo.
 */
export async function getArticlesByCodes(codes: string[]): Promise<Article[]> {
    if (!codes || codes.length === 0) return [];
    
    try {
        const uniqueCodes = [...new Set(codes.map(c => c.toUpperCase()))];
        const chunks = [];
        for (let i = 0; i < uniqueCodes.length; i += 30) {
            chunks.push(uniqueCodes.slice(i, i + 30));
        }
        
        let allArticles: Article[] = [];
        for (const chunk of chunks) {
            const snap = await adminDb.collection('articles')
                .where('code', 'in', chunk)
                .get();
            allArticles = [...allArticles, ...snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as Article))];
        }
        return allArticles;
    } catch (error) {
        console.error("Error fetching articles:", error);
        return [];
    }
}

/**
 * Conferma la Packing List e aggiorna lo stato delle commesse a 'shipped'.
 */
export async function confirmPackingAndShip(packingData: { jobId: string, actualWeightKg: number, numberOfPackages: number }[]) {
    try {
        const batch = adminDb.batch();
        
        packingData.forEach(item => {
            const docRef = adminDb.collection('jobOrders').doc(item.jobId);
            batch.update(docRef, {
                status: 'shipped',
                actualWeightKg: item.actualWeightKg,
                numberOfPackages: item.numberOfPackages,
                shippedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        await batch.commit();
        
        revalidatePath('/operator/packing');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/reports');
        
        return { success: true, message: "Spedizione confermata con successo." };
    } catch (error: any) {
        console.error("Error confirming packing:", error);
        return { success: false, message: "Errore durante la conferma: " + error.message };
    }
}
