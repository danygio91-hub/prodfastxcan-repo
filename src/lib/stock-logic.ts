import { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/types';

/**
 * SOURCE OF TRUTH (SSoT) STOCK LOGIC
 * Re-calculates and hydrates material batches with live residual stock based on recorded withdrawals.
 * Mirroring the logic from Admin's getAllGroupedBatches to ensure 100% parity.
 */
export function hydrateMaterialWithWithdrawals(material: RawMaterial, withdrawals: MaterialWithdrawal[]): RawMaterial {
    const hydratedMaterial = JSON.parse(JSON.stringify(material)) as RawMaterial;
    
    // 1. Group withdrawals by lot (mirrors admin logic)
    const withdrawalsByLotto = withdrawals.reduce((acc, w) => {
        const l = w.lotto || 'SENZA_LOTTO';
        // Admin uses consumedUnits as the primary measure for Stock reconciliation
        acc[l] = (acc[l] || 0) + (w.consumedUnits || 0);
        return acc;
    }, {} as Record<string, number>);

    // 2. Group batches by lot (mirrors admin logic)
    const batchesByLotto = (hydratedMaterial.batches || []).reduce((acc, batch) => {
        const lottoKey = batch.lotto || 'SENZA_LOTTO';
        if (!acc[lottoKey]) acc[lottoKey] = [];
        acc[lottoKey].push(batch);
        return acc;
    }, {} as Record<string, RawMaterialBatch[]>);

    // 3. Hydrate each batch by applying FIFO within the lot
    Object.entries(batchesByLotto).forEach(([lotto, batchList]) => {
        // Sort batches by date (oldest first for FIFO)
        batchList.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        let remainingWithdrawal = withdrawalsByLotto[lotto] || 0;
        
        batchList.forEach(batch => {
            const initialLoad = batch.netQuantity || 0;
            const deduction = Math.min(initialLoad, remainingWithdrawal);
            
            // Apply deduction in memory
            batch.netQuantity = Math.max(0, initialLoad - deduction);
            remainingWithdrawal -= deduction;
            
            // Mark as exhausted if it reaches 0
            if (batch.netQuantity <= 0.001) {
                batch.isExhausted = true;
            }
        });
    });

    // 4. Final consistency check: Recalculate total currentStockUnits
    const finalTotal = (hydratedMaterial.batches || [])
        .filter(b => !b.isExhausted)
        .reduce((sum, b) => sum + (b.netQuantity || 0), 0);
    
    hydratedMaterial.currentStockUnits = hydratedMaterial.unitOfMeasure === 'n' ? Math.round(finalTotal) : finalTotal;
    
    // Calculate totalWeightKg based on currentStockUnits and conversion factors
    if (hydratedMaterial.unitOfMeasure === 'kg') {
        hydratedMaterial.currentWeightKg = hydratedMaterial.currentStockUnits;
    } else {
        const factor = (hydratedMaterial.unitOfMeasure === 'mt' ? hydratedMaterial.rapportoKgMt : hydratedMaterial.conversionFactor) || 1;
        hydratedMaterial.currentWeightKg = hydratedMaterial.currentStockUnits * factor;
    }

    return hydratedMaterial;
}
