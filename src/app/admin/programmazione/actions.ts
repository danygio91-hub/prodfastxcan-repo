'use server';

import { getJobOrders as fetchAllJobOrders, getDepartments as fetchAllDepartments } from '@/app/admin/data-management/actions';
import { adminDb } from '@/lib/firebase-admin';
import { convertTimestampsToDates } from '@/lib/utils';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

export async function getJobOrders(): Promise<JobOrder[]> {
    return await fetchAllJobOrders();
}

export async function getDepartments(): Promise<Department[]> {
    return await fetchAllDepartments();
}

/**
 * Targeted Fetching MRP:
 * Scarica SOLO le giacenze e i Purchase Orders per i materiali effettivamente
 * necessari alle commesse attualmente visualizzate nella griglia.
 */
export async function getTargetedMRPData(
    materialCodes: string[],
    articleCodes: string[] = []
): Promise<{
    rawMaterials: RawMaterial[];
    purchaseOrders: PurchaseOrder[];
    articles: Article[];
    globalSettings: GlobalSettings | null;
}> {
    try {
        const uniqueMatCodes = new Set<string>(
            materialCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        );
        const uniqueArtCodes = [...new Set(
            articleCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        )];

        const articles: Article[] = [];
        const chunkSize = 30; // Limite 'in' di Firestore

        // 1. Fetch mirato Articoli (per ricavare distinte base mancanti sulle commesse)
        if (uniqueArtCodes.length > 0) {
            for (let i = 0; i < uniqueArtCodes.length; i += chunkSize) {
                const chunk = uniqueArtCodes.slice(i, i + chunkSize);
                const artSnap = await adminDb.collection("articles")
                    .where("code", "in", chunk)
                    .get();
                artSnap.forEach(d => {
                    const art = { ...convertTimestampsToDates(d.data()), id: d.id } as Article;
                    articles.push(art);
                    // Aggiungi componenti della distinta articolo ai materiali necessari
                    (art.billOfMaterials || []).forEach(b => {
                        if (b.component) uniqueMatCodes.add(b.component.trim().toUpperCase());
                    });
                });
            }
        }

        const finalMatCodes = [...uniqueMatCodes];
        const rawMaterials: RawMaterial[] = [];
        const purchaseOrders: PurchaseOrder[] = [];

        // 2. Fetch mirato RawMaterials e PurchaseOrders in blocchi di max 30
        if (finalMatCodes.length > 0) {
            for (let i = 0; i < finalMatCodes.length; i += chunkSize) {
                const chunk = finalMatCodes.slice(i, i + chunkSize);
                const [matSnap, poSnap] = await Promise.all([
                    adminDb.collection("rawMaterials").where("code", "in", chunk).get(),
                    adminDb.collection("purchaseOrders").where("materialCode", "in", chunk).get(),
                ]);

                matSnap.forEach(d => {
                    rawMaterials.push({ ...convertTimestampsToDates(d.data()), id: d.id } as RawMaterial);
                });

                poSnap.forEach(d => {
                    const po = { ...convertTimestampsToDates(d.data()), id: d.id } as PurchaseOrder;
                    const st = String(po.status || '').toLowerCase();
                    if (st !== 'completed' && st !== 'cancelled' && st !== 'received') {
                        purchaseOrders.push(po);
                    }
                });
            }
        }

        // 3. Global Settings (per unità di misura standard e configurazione tipi)
        let globalSettings: GlobalSettings | null = null;
        try {
            const settingsSnap = await adminDb.collection("settings").doc("global").get();
            if (settingsSnap.exists) {
                globalSettings = convertTimestampsToDates(settingsSnap.data()) as GlobalSettings;
            }
        } catch (e) {
            console.warn("Impossibile caricare impostazioni globali in getTargetedMRPData:", e);
        }

        return { rawMaterials, purchaseOrders, articles, globalSettings };
    } catch (error) {
        console.error("Errore durante getTargetedMRPData:", error);
        return { rawMaterials: [], purchaseOrders: [], articles: [], globalSettings: null };
    }
}

/**
 * Toggle ODL stampato per commessa (Workflow ODL)
 */
export async function toggleJobPrinted(jobId: string, currentStatus: boolean): Promise<boolean> {
    try {
        const nextStatus = !currentStatus;
        await adminDb.collection("jobOrders").doc(jobId).update({
            isPrinted: nextStatus,
            odlPrinted: nextStatus,
        });
        return nextStatus;
    } catch (e) {
        console.error("Errore durante toggleJobPrinted:", e);
        return currentStatus;
    }
}
