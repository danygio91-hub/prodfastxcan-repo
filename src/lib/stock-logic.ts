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
            
            // Popolamento campo dinamico "currentQuantity" (residuo vivo)
            // netQuantity RESTA l'originale immutabile per lo storico
            batch.currentQuantity = Number((initialLoad - deduction).toFixed(3));
            remainingWithdrawal = Number((remainingWithdrawal - deduction).toFixed(3));
            
            // Calcolo proporzionale del peso residuo per il batch
            if (hydratedMaterial.unitOfMeasure === 'kg') {
                batch.currentWeightKg = batch.currentQuantity;
            } else {
                const batchFactor = (hydratedMaterial.unitOfMeasure === 'mt' ? hydratedMaterial.rapportoKgMt : hydratedMaterial.conversionFactor) || 1;
                batch.currentWeightKg = Number((batch.currentQuantity * batchFactor).toFixed(3));
            }

            // TASSATIVO: Ricalcola l'estenuazione in base al residuo reale idratato
            // Evita che un batch con stock positivo sia nascosto se il flag nel DB è stale
            batch.isExhausted = batch.currentQuantity <= 0.001;
        });
    });

    // 4. Final consistency check: Recalculate total currentStockUnits
    const finalTotal = (hydratedMaterial.batches || [])
        .reduce((sum, b) => sum + (b.currentQuantity || 0), 0);
    
    hydratedMaterial.currentStockUnits = hydratedMaterial.unitOfMeasure === 'n' ? Math.round(finalTotal) : Number(finalTotal.toFixed(3));
    
    // Calculate totalWeightKg based on currentStockUnits and conversion factors
    if (hydratedMaterial.unitOfMeasure === 'kg') {
        hydratedMaterial.currentWeightKg = hydratedMaterial.currentStockUnits;
    } else {
        const factor = (hydratedMaterial.unitOfMeasure === 'mt' ? hydratedMaterial.rapportoKgMt : hydratedMaterial.conversionFactor) || 1;
        hydratedMaterial.currentWeightKg = Number((hydratedMaterial.currentStockUnits * factor).toFixed(3));
    }

    return hydratedMaterial;
}
