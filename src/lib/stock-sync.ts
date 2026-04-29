import { adminDb } from './firebase-admin';
import { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/types';
import { hydrateMaterialWithWithdrawals } from './stock-logic';

/**
 * SOURCE OF TRUTH (SSoT) SYNC ENGINE
 * Ricalcola la giacenza totale di un materiale basandosi sulla somma 
 * reale dei lotti attuali (Load - Withdrawals).
 * 
 * Aggiorna i campi fisici del documento Materiale per garantire performance in lettura.
 * 
 * @param materialId ID del materiale da ricalcolare
 * @param transaction Transazione Firestore opzionale per atomicità
 * @param prefetchedData Dati già letti all'inizio della transazione
 */
export async function recalculateMaterialStock(
    materialId: string, 
    transaction?: FirebaseFirestore.Transaction,
    prefetchedData?: { material: RawMaterial, withdrawals: MaterialWithdrawal[] }
) {
    const materialRef = adminDb.collection('rawMaterials').doc(materialId);
    
    let material: RawMaterial;
    let withdrawals: MaterialWithdrawal[];

    if (prefetchedData) {
        material = prefetchedData.material;
        withdrawals = prefetchedData.withdrawals;
    } else {
        const [docSnap, withdrawalsSnap] = await Promise.all([
            transaction ? transaction.get(materialRef) : materialRef.get(),
            adminDb.collection('materialWithdrawals').where('materialId', '==', materialId).get()
        ]);

        if (!docSnap.exists) {
            console.warn(`[StockSync] Materiale ${materialId} non trovato.`);
            return null;
        }
        
        material = { ...docSnap.data(), id: docSnap.id } as RawMaterial;
        withdrawals = withdrawalsSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    }

    // 1. Use the shared logic to hydrate and calculate the live stock
    const hydrated = hydrateMaterialWithWithdrawals(material, withdrawals);

    // 2. Extract values for update
    const updateData = {
        currentStockUnits: hydrated.currentStockUnits,
        currentWeightKg: hydrated.currentWeightKg,
        stock: hydrated.currentStockUnits // Legacy field sync
    };
    
    if (transaction) {
        transaction.update(materialRef, updateData);
    } else {
        await materialRef.update(updateData);
    }
    
    console.log(`[StockSync] SSoT Sync ${material.code}: Units=${updateData.currentStockUnits}, Weight=${updateData.currentWeightKg}`);
    
    return updateData;
}

