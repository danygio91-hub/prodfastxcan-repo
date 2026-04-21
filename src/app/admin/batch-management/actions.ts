
'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/types';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';

export type EnrichedBatch = RawMaterialBatch & {
    materialId: string;
};

export type LotInfo = {
    lotto: string;
    totalLoaded: number;
    totalWithdrawn: number;
    available: number;
    batches: EnrichedBatch[]; // The individual loads for this lot
    firstLoadDate: string;
};

export type GroupedBatches = {
    materialId: string;
    materialCode: string;
    materialDescription: string;
    unitOfMeasure: string; // 'n' | 'mt' | 'kg' (configurable)
    conversionFactor?: number;
    rapportoKgMt?: number;
    currentStockUnits: number;
    currentWeightKg: number;
    lots: LotInfo[];
};


export async function getAllGroupedBatches(searchTerm?: string): Promise<GroupedBatches[]> {
    const materialsCol = adminDb.collection('rawMaterials');
    let materialsSnapshot;

    const searchTermLower = (searchTerm || '').toLowerCase().trim();

    // If search term is too short, return empty array to save reads
    if (searchTerm !== undefined && searchTermLower.length < 2) {
        return [];
    }

    let q = materialsCol.limit(100);

    if (searchTermLower) {
        // Use prefix matching for optimized server-side filtering
        q = q.where('code_normalized', '>=', searchTermLower)
             .where('code_normalized', '<=', searchTermLower + '\uf8ff');
    } else {
        // Default sort for the main list
        q = q.orderBy('code_normalized').limit(50);
    }

    materialsSnapshot = await q.get();

    if (materialsSnapshot.empty) {
        return [];
    }

    const materials = materialsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RawMaterial));
    const materialIds = materials.map(m => m.id);
    
    // Fetch withdrawals ONLY for the materials we are about to display
    const withdrawalsByMaterial: Record<string, MaterialWithdrawal[]> = {};
    for (let i = 0; i < materialIds.length; i += 30) {
        const chunk = materialIds.slice(i, i + 30);
        const wSnap = await adminDb.collection("materialWithdrawals").where("materialId", "in", chunk).get();
        wSnap.forEach(d => {
            const w = { id: d.id, ...convertTimestampsToDates(d.data()) } as MaterialWithdrawal;
            if (!withdrawalsByMaterial[w.materialId]) withdrawalsByMaterial[w.materialId] = [];
            withdrawalsByMaterial[w.materialId].push(w);
        });
    }

    const allGroupedBatches: GroupedBatches[] = [];

    materials.forEach(rawMaterial => {
        const materialWithdrawals = withdrawalsByMaterial[rawMaterial.id] || [];
        
        // Hydrate the material with live residual quantities (SSoT Logic)
        const material = hydrateMaterialWithWithdrawals(rawMaterial, materialWithdrawals);

        const withdrawalsByLotto = materialWithdrawals.reduce((acc, w) => {
            const l = w.lotto || 'SENZA_LOTTO';
            acc[l] = (acc[l] || 0) + (w.consumedUnits || 0);
            return acc;
        }, {} as Record<string, number>);

        const batchesByLotto = (material.batches || []).reduce((acc, batch) => {
            const lottoKey = batch.lotto || 'SENZA_LOTTO';
            if (!acc[lottoKey]) acc[lottoKey] = [];
            acc[lottoKey].push({ ...batch, materialId: material.id });
            return acc;
        }, {} as Record<string, EnrichedBatch[]>);

        const lots: LotInfo[] = Object.entries(batchesByLotto).map(([lotto, batchesInLot]) => {
            const totalLoadedForLot = batchesInLot.reduce((sum, b) => {
                // IMPORTANT: Since we hydrated the material, netQuantity might be 0 already.
                // But Admin logic "totalLoaded" should probably represent the initial load of currently active batches?
                // Actually, to keep it simple and match Admin's previous logic, we can still use the hydrated netQuantity.
                return sum + (b.netQuantity || 0);
            }, 0);
            
            // Wait, if I use the hydrated material, totalLoaded - totalWithdrawn would double-subtract.
            // I should either:
            // a) Use the hydrated netQuantity as the "Available".
            // b) Use the original quantities for loaded/withdrawn display but hydrated for batches.
            
            // Admin's goal here is to show "Available", "Total Loaded", "Total Withdrawn".
            const initialLoadForLot = (rawMaterial.batches || [])
                .filter(b => (b.lotto || 'SENZA_LOTTO') === lotto)
                .reduce((sum, b) => sum + (b.netQuantity || 0), 0);
            
            const totalWithdrawn = withdrawalsByLotto[lotto] || 0;
            const available = initialLoadForLot - totalWithdrawn;
            
            const firstLoadDate = batchesInLot.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]?.date;

            return {
                lotto,
                totalLoaded: initialLoadForLot,
                totalWithdrawn,
                available,
                batches: batchesInLot,
                firstLoadDate
            };
        });
        
        allGroupedBatches.push({
            materialId: material.id,
            materialCode: material.code,
            materialDescription: material.description,
            unitOfMeasure: material.unitOfMeasure,
            conversionFactor: material.conversionFactor || undefined,
            rapportoKgMt: material.rapportoKgMt || undefined,
            currentStockUnits: material.currentStockUnits,
            currentWeightKg: material.currentWeightKg,
            lots: lots.sort((a, b) => new Date(b.firstLoadDate).getTime() - new Date(a.firstLoadDate).getTime()),
        });
    });

    allGroupedBatches.sort((a, b) => a.materialCode.localeCompare(b.materialCode));

    return JSON.parse(JSON.stringify(allGroupedBatches));
}


function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj.toDate && typeof obj.toDate === 'function') {
        return obj.toDate();
    }
    if (Array.isArray(obj)) {
        return obj.map(item => convertTimestampsToDates(item));
    }
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
        newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
}

export async function getMaterialWithdrawalsForMaterial(materialId: string, lotto?: string | null): Promise<MaterialWithdrawal[]> {
  const snapshot = await adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get();
  const withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
  
  if (lotto) {
    if (lotto === 'SENZA_LOTTO') {
      return withdrawals.filter(w => !w.lotto);
    }
    return withdrawals.filter(w => w.lotto === lotto);
  }

  return withdrawals;
}
