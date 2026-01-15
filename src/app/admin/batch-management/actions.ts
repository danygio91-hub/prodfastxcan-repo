
'use server';

import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch } from '@/lib/mock-data';

export type EnrichedBatch = RawMaterialBatch & {
    materialId: string;
    materialCode: string;
    materialUnitOfMeasure: 'n' | 'mt' | 'kg';
};

export async function getAllBatches(): Promise<EnrichedBatch[]> {
    const materialsCol = collection(db, 'rawMaterials');
    const materialsSnapshot = await getDocs(materialsCol);

    if (materialsSnapshot.empty) {
        return [];
    }

    const allBatches: EnrichedBatch[] = [];

    materialsSnapshot.docs.forEach(doc => {
        const material = { id: doc.id, ...doc.data() } as RawMaterial;
        const batches = material.batches || [];
        
        batches.forEach(batch => {
            allBatches.push({
                ...batch,
                materialId: material.id,
                materialCode: material.code,
                materialUnitOfMeasure: material.unitOfMeasure,
            });
        });
    });

    // Sort by date, most recent first
    allBatches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return JSON.parse(JSON.stringify(allBatches));
}
