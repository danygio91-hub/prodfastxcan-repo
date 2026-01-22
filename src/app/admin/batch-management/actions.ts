
'use server';

import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/lib/mock-data';

export type EnrichedBatch = RawMaterialBatch & {
    materialId: string;
};

export type GroupedBatches = {
    materialId: string;
    materialCode: string;
    materialDescription: string;
    unitOfMeasure: 'n' | 'mt' | 'kg';
    currentStockUnits: number;
    currentWeightKg: number;
    batches: EnrichedBatch[];
}

export async function getAllGroupedBatches(searchTerm?: string): Promise<GroupedBatches[]> {
    const materialsCol = collection(db, 'rawMaterials');
    let materialsSnapshot;

    if (searchTerm && searchTerm.length >= 2) {
        const lowercasedTerm = searchTerm.toLowerCase();
        // This query performs a "starts with" search on the material code.
        const q = query(
            materialsCol, 
            where("code_normalized", ">=", lowercasedTerm), 
            where("code_normalized", "<=", lowercasedTerm + '\uf8ff'),
            limit(25)
        );
        materialsSnapshot = await getDocs(q);
    } else {
        // If no search term, return empty to avoid loading all documents.
        return [];
    }

    if (materialsSnapshot.empty) {
        return [];
    }

    const allGroupedBatches: GroupedBatches[] = [];

    materialsSnapshot.docs.forEach(doc => {
        const material = { id: doc.id, ...doc.data() } as RawMaterial;
        const batches = material.batches || [];
        
        // We only show materials that actually have batches
        if (batches.length > 0) {
            const enrichedBatches = batches.map(batch => ({
                ...batch,
                materialId: material.id,
            })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            allGroupedBatches.push({
                materialId: material.id,
                materialCode: material.code,
                materialDescription: material.description,
                unitOfMeasure: material.unitOfMeasure,
                currentStockUnits: material.currentStockUnits,
                currentWeightKg: material.currentWeightKg,
                batches: enrichedBatches
            });
        }
    });

    // Sort by material code
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
  const withdrawalsRef = collection(db, "materialWithdrawals");
  const q = query(withdrawalsRef, where("materialId", "==", materialId));
  const snapshot = await getDocs(q);
  const withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
  
  if (lotto) {
    if (lotto === 'SENZA_LOTTO') {
      return withdrawals.filter(w => !w.lotto);
    }
    return withdrawals.filter(w => w.lotto === lotto);
  }

  return withdrawals;
}
