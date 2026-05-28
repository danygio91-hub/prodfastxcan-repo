import * as admin from 'firebase-admin';

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

    // FALLBACK 1: Ricerca per campo testuale esatto (Risolve disallineamento ID/campo)
    if (!jobSnap.exists) {
        const querySnap = await adminDb.collection('jobOrders')
            .where('ordinePF', '==', rawId)
            .limit(1)
            .get();
        
        if (!querySnap.empty) {
            const foundSnap = querySnap.docs[0];
            jobRef = foundSnap.ref;
            jobSnap = transaction ? await transaction.get(jobRef) : foundSnap;
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
