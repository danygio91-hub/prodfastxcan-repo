'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, runTransaction, getDocs, query, orderBy, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';


export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const q = query(packagingCol, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Packaging);
}


export async function importStockFromFile(
  data: any[],
  uid: string
): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);

  if (!data || data.length === 0) {
    return { success: false, message: 'Nessun dato da importare.' };
  }

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code, { id: doc.id, ...doc.data() } as RawMaterial]));

  const packagingSnapshot = await getDocs(collection(db, 'packaging'));
  const packagingMap = new Map(packagingSnapshot.docs.map(doc => [doc.data().name.toLowerCase(), doc.data().weightKg as number]));


  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const [index, row] of data.entries()) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const ddt = row['DDT'];
    const netQuantity = parseFloat(row['Quantita Netta']);
    const date = row['Data']; // Assuming it's an Excel date number or a string
    const packagingName = row['Tara (Imballo)']?.toLowerCase();
    
    if (!materialCode || !lotto || isNaN(netQuantity) || netQuantity <= 0) {
      errorCount++;
      errors.push(`Riga ${index + 2}: Dati mancanti o non validi (Codice, Lotto, Quantità).`);
      continue;
    }

    const material = materialsMap.get(materialCode);
    if (!material) {
      errorCount++;
      errors.push(`Riga ${index + 2}: Materiale con codice "${materialCode}" non trovato.`);
      continue;
    }

    let parsedDate: Date;
    if (typeof date === 'number') { // Excel date number
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      parsedDate = new Date(excelEpoch.getTime() + date * 86400 * 1000);
    } else if (typeof date === 'string') {
      parsedDate = new Date(date);
    } else {
      parsedDate = new Date(); // Fallback to now
    }

    if (isNaN(parsedDate.getTime())) {
       errorCount++;
       errors.push(`Riga ${index + 2}: Data non valida per il lotto ${lotto}.`);
       continue;
    }

    let tareWeight = 0;
    if (packagingName && packagingMap.has(packagingName)) {
        tareWeight = packagingMap.get(packagingName) ?? 0;
    }

    const materialRef = doc(db, 'rawMaterials', material.id);

    try {
        await runTransaction(db, async (transaction) => {
            const freshMaterialDoc = await transaction.get(materialRef);
            if (!freshMaterialDoc.exists()) {
                throw new Error(`Materiale ${materialCode} non trovato durante la transazione.`);
            }
            const currentMaterial = freshMaterialDoc.data() as RawMaterial;
            
            let netWeightForCalc: number;
            if (currentMaterial.unitOfMeasure === 'kg') {
                netWeightForCalc = netQuantity;
            } else if (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) {
                netWeightForCalc = netQuantity * currentMaterial.conversionFactor;
            } else {
                netWeightForCalc = 0; // cannot calculate weight
            }

            const newBatch: RawMaterialBatch = {
                id: `batch-import-${Date.now()}-${index}`,
                date: parsedDate.toISOString(),
                ddt: ddt || `IMPORT-${parsedDate.toISOString().split('T')[0]}`,
                lotto,
                netQuantity,
                tareWeight,
                grossWeight: netWeightForCalc + tareWeight,
            };
            
            const updatedBatches = [...(currentMaterial.batches || []), newBatch];

            const unitsToAdd = newBatch.netQuantity || 0;
            const weightToAdd = newBatch.grossWeight - newBatch.tareWeight;

            const newStockUnits = (currentMaterial.currentStockUnits || 0) + unitsToAdd;
            const newWeightKg = (currentMaterial.currentWeightKg || 0) + weightToAdd;

            transaction.update(materialRef, {
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg
            });
        });
        successCount++;
    } catch (e: any) {
        errorCount++;
        errors.push(`Riga ${index + 2} (Lotto ${lotto}): ${e.message}`);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/batch-management');

  const message = `Importazione completata. ${successCount} lotti caricati, ${errorCount} errori.`;
  if (errors.length > 0) {
    return { success: errorCount === 0, message: `${message}\n\nDettagli errori:\n${errors.slice(0, 5).join('\n')}` };
  }

  return { success: true, message };
}
