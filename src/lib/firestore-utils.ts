import * as admin from 'firebase-admin';
import { generateJobDocumentId, extractAnnoCompetenza } from '@/lib/utils';

/**
 * FASE 31: Verifica unicità composita (ordinePF + annoCompetenza) su Firestore.
 * Esegue la query where('ordinePF', '==', ...).where('annoCompetenza', '==', ...)
 * e verifica sia l'ID composito sia eventuali record legacy dello stesso anno.
 */
export async function checkJobOrderExists(
    adminDb: admin.firestore.Firestore,
    ordinePF: string,
    annoCompetenza: number
): Promise<{ exists: boolean; existingJobId?: string }> {
    const cleanPF = (ordinePF || '').trim();
    if (!cleanPF) return { exists: false };

    // 1. Query combinata Firestore su campo ordinePF e annoCompetenza
    const querySnap = await adminDb.collection('jobOrders')
        .where('ordinePF', '==', cleanPF)
        .where('annoCompetenza', '==', annoCompetenza)
        .limit(1)
        .get();

    if (!querySnap.empty) {
        return { exists: true, existingJobId: querySnap.docs[0].id };
    }

    // 2. Controllo diretto su ID documento composito (es. 840-PF_2026)
    const compositeId = generateJobDocumentId(cleanPF, annoCompetenza);
    const docSnap = await adminDb.collection('jobOrders').doc(compositeId).get();
    if (docSnap.exists) {
        return { exists: true, existingJobId: docSnap.id };
    }

    // 3. Controllo retrocompatibilità record legacy (senza anno nell'ID)
    const legacyId = cleanPF.replace(/\//g, '-').trim();
    const legacySnap = await adminDb.collection('jobOrders').doc(legacyId).get();
    if (legacySnap.exists) {
        const legacyData = legacySnap.data() as any;
        const legacyYear = legacyData?.annoCompetenza ?? extractAnnoCompetenza(
            legacyData?.dataConsegnaFinale,
            legacyData?.createdAt ? (legacyData.createdAt.toDate ? legacyData.createdAt.toDate() : new Date(legacyData.createdAt)) : undefined
        );
        if (legacyYear === annoCompetenza) {
            return { exists: true, existingJobId: legacySnap.id };
        }
    }

    return { exists: false };
}

/**
 * Executes a Firestore 'in' query in chunks to overcome the 30-item limit.
 * 
 * @param collection - The collection or query to search in.
 * @param field - The field to filter on.
 * @param values - The array of values to check against.
 * @param chunkSize - Number of items per chunk (max 30).
 * @returns A flattened array of document data with IDs.
 */
export async function fetchInChunks<T>(
    collection: admin.firestore.CollectionReference | admin.firestore.Query,
    field: string | admin.firestore.FieldPath,
    values: any[],
    chunkSize: number = 30
): Promise<T[]> {
    // Sanitize and deduplicate inputs
    const uniqueValues = [...new Set(values.filter(v => v !== undefined && v !== null))];
    
    if (uniqueValues.length === 0) return [];

    const chunks: any[][] = [];
    for (let i = 0; i < uniqueValues.length; i += chunkSize) {
        chunks.push(uniqueValues.slice(i, i + chunkSize));
    }

    // Execute queries in parallel
    const snapshots = await Promise.all(
        chunks.map(chunk => collection.where(field, 'in', chunk).get())
    );

    // Collect results and ensure unique IDs (just in case)
    const resultsMap = new Map<string, T>();
    
    snapshots.forEach(snap => {
        snap.docs.forEach(doc => {
            resultsMap.set(doc.id, { id: doc.id, ...doc.data() } as T);
        });
    });

    return Array.from(resultsMap.values());
}

/**
 * Helper to perform a hybrid, fallback-safe lookup for a Job Order.
 * Supports standard fetches and Firestore transactions.
 */
export async function getJobOrderRefAndSnap(
    adminDb: admin.firestore.Firestore,
    rawId: string, 
    transaction?: admin.firestore.Transaction
): Promise<{ jobRef: admin.firestore.DocumentReference; jobSnap: admin.firestore.DocumentSnapshot }> {
    const sanitizedId = rawId.replace(/\//g, '-');
    let jobRef = adminDb.collection('jobOrders').doc(sanitizedId);
    let jobSnap = transaction ? await transaction.get(jobRef) : await jobRef.get();

    // FALLBACK 1: Ricerca per campo testuale esatto (Risolve disallineamento ID/campo e ID compositi)
    if (!jobSnap.exists) {
        const querySnap = await adminDb.collection('jobOrders')
            .where('ordinePF', '==', rawId)
            .get();
        
        if (!querySnap.empty) {
            let selectedDoc = querySnap.docs[0];
            if (querySnap.docs.length > 1) {
                const finishedStatuses = ['completed', 'CHIUSO', 'FINE PRODUZIONE', 'FINE_PRODUZIONE', 'SPEDITA', 'Spedito', 'shipped'];
                const activeDoc = querySnap.docs.find(d => !finishedStatuses.includes(d.data().status));
                if (activeDoc) {
                    selectedDoc = activeDoc;
                } else {
                    const sorted = [...querySnap.docs].sort((a, b) => {
                        const yearA = a.data().annoCompetenza || 0;
                        const yearB = b.data().annoCompetenza || 0;
                        return yearB - yearA;
                    });
                    selectedDoc = sorted[0];
                }
            }
            jobRef = selectedDoc.ref;
            jobSnap = transaction ? await transaction.get(jobRef) : selectedDoc;
        }
    }

    // FALLBACK 2: Ricerca legacy assoluta (Senza punti)
    if (!jobSnap.exists) {
        const legacyId = sanitizedId.replace(/[\.#$\[\]]/g, '');
        const legacyRef = adminDb.collection('jobOrders').doc(legacyId);
        const legacySnap = transaction ? await transaction.get(legacyRef) : await legacyRef.get();
        if (legacySnap.exists) {
            jobRef = legacyRef;
            jobSnap = legacySnap;
        }
    }

    return { jobRef, jobSnap };
}

/**
 * High-level helper that resolves a group or a job order, applying the hybrid fallback for job orders.
 */
export async function getItemRefAndSnap(
    adminDb: admin.firestore.Firestore,
    itemId: string,
    transaction?: admin.firestore.Transaction
): Promise<{ itemRef: admin.firestore.DocumentReference; itemSnap: admin.firestore.DocumentSnapshot }> {
    if (itemId.startsWith('group-')) {
        const itemRef = adminDb.collection('workGroups').doc(itemId);
        const itemSnap = transaction ? await transaction.get(itemRef) : await itemRef.get();
        return { itemRef, itemSnap };
    }
    const { jobRef, jobSnap } = await getJobOrderRefAndSnap(adminDb, itemId, transaction);
    return { itemRef: jobRef, itemSnap: jobSnap };
}
