
'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/lib/mock-data';

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
    currentStockUnits: number;
    currentWeightKg: number;
    lots: LotInfo[];
};


export async function getAllGroupedBatches(searchTerm?: string): Promise<GroupedBatches[]> {
    let materialsSnapshot;

    if (searchTerm && searchTerm.length >= 2) {
        const lowercasedTerm = searchTerm.toLowerCase();
        materialsSnapshot = await adminDb.collection('rawMaterials')
            .where("code_normalized", ">=", lowercasedTerm)
            .where("code_normalized", "<=", lowercasedTerm + '\uf8ff')
            .limit(25)
            .get();
    } else {
        return [];
    }

    if (materialsSnapshot.empty) {
        return [];
    }

    const materialIds = materialsSnapshot.docs.map(doc => doc.id);
    const allWithdrawals: MaterialWithdrawal[] = [];
    if (materialIds.length > 0) {
        const withdrawalsSnapshot = await adminDb.collection("materialWithdrawals")
            .where("materialId", "in", materialIds)
            .get();
        withdrawalsSnapshot.forEach(doc => {
            allWithdrawals.push({ id: doc.id, ...convertTimestampsToDates(doc.data()) } as MaterialWithdrawal);
        });
    }

    const withdrawalsByMaterial = allWithdrawals.reduce((acc, w) => {
        if (!acc[w.materialId]) {
            acc[w.materialId] = [];
        }
        acc[w.materialId].push(w);
        return acc;
    }, {} as Record<string, MaterialWithdrawal[]>);


    const allGroupedBatches: GroupedBatches[] = [];

    materialsSnapshot.docs.forEach(doc => {
        const material = { id: doc.id, ...doc.data() } as RawMaterial;
        
        const materialWithdrawals = withdrawalsByMaterial[material.id] || [];

        const batchesByLotto = (material.batches || []).reduce((acc, batch) => {
            const lottoKey = batch.lotto || 'SENZA_LOTTO';
            if (!acc[lottoKey]) acc[lottoKey] = [];
            acc[lottoKey].push({ ...batch, materialId: material.id });
            return acc;
        }, {} as Record<string, EnrichedBatch[]>);

        const lotWithdrawalsMap = materialWithdrawals.reduce((acc, w) => {
            const lottoKey = w.lotto || 'SENZA_LOTTO';
            if (!acc[lottoKey])  acc[lottoKey] = 0;
            acc[lottoKey] += w.consumedUnits || 0;
            return acc;
        }, {} as Record<string, number>);

        const lots: LotInfo[] = Object.entries(batchesByLotto).map(([lotto, batchesInLot]) => {
            const totalLoaded = batchesInLot.reduce((sum, b) => sum + (b.netQuantity || 0), 0);
            const totalWithdrawn = lotWithdrawalsMap[lotto] || 0;
            const available = totalLoaded - totalWithdrawn;
            
            const firstLoadDate = batchesInLot.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]?.date;

            return {
                lotto,
                totalLoaded,
                totalWithdrawn,
                available,
                batches: batchesInLot,
                firstLoadDate
            };
        });
        
        const totalStockUnits = lots.reduce((sum, lot) => sum + lot.available, 0);
        let totalWeightKg = 0;
        if (material.unitOfMeasure === 'kg') {
            totalWeightKg = totalStockUnits;
        } else if (material.conversionFactor && material.conversionFactor > 0) {
            totalWeightKg = totalStockUnits * material.conversionFactor;
        }

        allGroupedBatches.push({
            materialId: material.id,
            materialCode: material.code,
            materialDescription: material.description,
            unitOfMeasure: material.unitOfMeasure,
            currentStockUnits: totalStockUnits,
            currentWeightKg: totalWeightKg,
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
