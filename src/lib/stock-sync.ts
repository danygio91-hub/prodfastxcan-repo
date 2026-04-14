import { adminDb } from './firebase-admin';
import { RawMaterial, RawMaterialBatch } from '@/types';

/**
 * FORMULA DEFINITIVA: Material.stock = SUM(Batch.netQuantity)
 * Ricalcola la giacenza totale di un materiale basandosi esclusivamente sulla somma 
 * delle giacenze nette attuali di ogni singolo lotto (batch) presente nel documento.
 * 
 * @param materialId ID del materiale da ricalcolare
 * @param transaction Transazione Firestore opzionale per atomicità
 * @param prefetchedData Dati già letti all'inizio della transazione (Materiale, Lotti, Prelievi)
 */
/**
 * FORMULA DEFINITIVA: Material.stock = SUM(Lot.Available)
 * Dove Lot.Available = SUM(Batch.netLoad) - SUM(Withdrawals.forThisLot)
 * 
 * Ricalcola la giacenza totale di un materiale basandosi sulla fonte di verità 
 * dei lotti (Anagrafica Lotti) senza mai alterare l'array storico batches[].
 */
export async function recalculateMaterialStock(
    materialId: string, 
    transaction?: FirebaseFirestore.Transaction,
    prefetchedData?: { material: RawMaterial, batches: RawMaterialBatch[], withdrawals: any[] }
) {
    const materialRef = adminDb.collection('rawMaterials').doc(materialId);
    
    let material: RawMaterial;
    let withdrawals: any[];
    let batches: RawMaterialBatch[];

    if (prefetchedData) {
        material = prefetchedData.material;
        withdrawals = prefetchedData.withdrawals;
        batches = prefetchedData.batches || material.batches || [];
    } else {
        // We need both the material and its withdrawals to apply the Lot-UI formula
        const [docSnap, withdrawalsSnap] = await Promise.all([
            transaction ? transaction.get(materialRef) : materialRef.get(),
            adminDb.collection('materialWithdrawals').where('materialId', '==', materialId).get()
        ]);

        if (!docSnap.exists) {
            console.warn(`[StockSync] Materiale ${materialId} non trovato.`);
            return null;
        }
        
        material = docSnap.data() as RawMaterial;
        withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
        batches = material.batches || [];
    }

    // 1. Group withdrawals by lot (only considering those with a lot code)
    const withdrawalsByLotto = withdrawals.reduce((acc, w) => {
        if (w.lotto) {
            acc[w.lotto] = (acc[w.lotto] || 0) + (w.consumedUnits || 0);
        }
        return acc;
    }, {} as Record<string, number>);

    // 2. Group withdrawals (weight) by lot
    const weightWithdrawalsByLotto = withdrawals.reduce((acc, w) => {
        if (w.lotto) {
            acc[w.lotto] = (acc[w.lotto] || 0) + (w.consumedWeight || 0);
        }
        return acc;
    }, {} as Record<string, number>);

    // 3. Group batches by lot
    const batchesByLotto = batches.reduce((acc, b) => {
        const lottoKey = b.lotto || 'SENZA_LOTTO';
        if (!acc[lottoKey]) acc[lottoKey] = [];
        acc[lottoKey].push(b);
        return acc;
    }, {} as Record<string, any[]>);

    // 4. Calculate Available per Lot (The "Anagrafica Lotti" Brain)
    let totalStockUnits = 0;
    let totalWeightKg = 0;

    Object.entries(batchesByLotto).forEach(([lotto, batchList]) => {
        if (lotto === 'SENZA_LOTTO') return; // Ignore batches without lot if any

        const lotLoadedUnits = batchList.reduce((sum, b) => sum + (b.netQuantity || 0), 0);
        const lotWithdrawnUnits = withdrawalsByLotto[lotto] || 0;
        const availableUnits = Math.max(0, lotLoadedUnits - lotWithdrawnUnits);

        const lotLoadedWeight = batchList.reduce((sum, b) => sum + ((b.grossWeight || 0) - (b.tareWeight || 0)), 0);
        const lotWithdrawnWeight = weightWithdrawalsByLotto[lotto] || 0;
        const availableWeight = Math.max(0, lotLoadedWeight - lotWithdrawnWeight);

        totalStockUnits += availableUnits;
        totalWeightKg += availableWeight;
    });
    
    // Final rounding for UI consistency
    if (material.unitOfMeasure === 'n') {
        totalStockUnits = Math.round(totalStockUnits);
    } else {
        totalStockUnits = Math.round(totalStockUnits * 1000) / 1000;
    }
    totalWeightKg = Math.round(totalWeightKg * 1000) / 1000;

    const updateData = {
        currentStockUnits: totalStockUnits,
        currentWeightKg: totalWeightKg,
        stock: totalStockUnits
    };
    
    if (transaction) {
        transaction.update(materialRef, updateData);
    } else {
        await materialRef.update(updateData);
    }
    
    console.log(`[StockSync] Ricalcolato ${material.code}: Units=${updateData.currentStockUnits}, Weight=${updateData.currentWeightKg}`);
    
    return updateData;
}
