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
