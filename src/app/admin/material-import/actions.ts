'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, runTransaction, getDocs, query, orderBy, arrayUnion, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';
import { getOperatorByUid } from '@/app/scan-job/actions';
import { formatDisplayStock } from '@/lib/utils';


export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const q = query(packagingCol, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Packaging);
}


export async function importCaricoFromFile(
  data: any[],
  uid: string
): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);

  if (!data || data.length === 0) {
    return { success: false, message: 'Nessun dato da importare.' };
  }

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial]));

  const packagingSnapshot = await getDocs(collection(db, 'packaging'));
  const packagingMap = new Map(packagingSnapshot.docs.map(doc => [doc.data().name.toLowerCase(), {id: doc.id, weight: doc.data().weightKg as number}]));


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

    const material = materialsMap.get(materialCode.toLowerCase());
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
    let packagingId: string | undefined = undefined;
    if (packagingName && packagingMap.has(packagingName)) {
        const pack = packagingMap.get(packagingName)!;
        tareWeight = pack.weight;
        packagingId = pack.id;
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
                packagingId: packagingId,
            };
            
            const unitsToAdd = newBatch.netQuantity || 0;
            const weightToAdd = newBatch.grossWeight - newBatch.tareWeight;

            const newStockUnits = (currentMaterial.currentStockUnits || 0) + unitsToAdd;
            const newWeightKg = (currentMaterial.currentWeightKg || 0) + weightToAdd;

            transaction.update(materialRef, {
                batches: arrayUnion(newBatch),
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

  let message = `Importazione completata. ${successCount} lotti caricati, ${errorCount} errori.`;
  if (errors.length > 0) {
    message = `${message} Dettagli errori: ${errors.slice(0, 5).join('; ')}`;
  }

  return { success: errorCount === 0, message };
}


export async function importScaricoFromFile(data: any[], uid: string): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);
  const admin = await getOperatorByUid(uid);

  if (!data || data.length === 0) {
    return { success: false, message: 'Nessun dato da importare.' };
  }

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial]));

  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const [index, row] of data.entries()) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const quantity = parseFloat(row['Quantita da Scaricare']);
    const unit = row['Unita']?.toLowerCase();
    const jobOrderPF = row['Commessa Associata'];
    const notes = row['Note'];
    
    if (!materialCode || isNaN(quantity) || quantity <= 0 || !['n', 'mt', 'kg'].includes(unit)) {
      errorCount++;
      errors.push(`Riga ${index + 2}: Dati mancanti o non validi (Codice, Quantità, Unità).`);
      continue;
    }

    const material = materialsMap.get(materialCode.toLowerCase());
    if (!material) {
      errorCount++;
      errors.push(`Riga ${index + 2}: Materiale con codice "${materialCode}" non trovato.`);
      continue;
    }

    const materialRef = doc(db, "rawMaterials", material.id);

    try {
      await runTransaction(db, async (transaction) => {
        const materialDoc = await transaction.get(materialRef);
        if (!materialDoc.exists()) throw new Error("Materia prima non trovata durante la transazione.");
        
        const currentMaterial = materialDoc.data() as RawMaterial;
        
        let unitsConsumed = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          if (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) {
            unitsConsumed = quantity / currentMaterial.conversionFactor;
          } else if (currentMaterial.unitOfMeasure === 'kg') {
            unitsConsumed = quantity;
          }
        } else { // 'n' or 'mt'
          if (unit !== currentMaterial.unitOfMeasure) {
            throw new Error(`Unità di misura non corrispondente. Prevista: ${currentMaterial.unitOfMeasure}, fornita: ${unit}`);
          }
          unitsConsumed = quantity;
          consumedWeight = (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) ? quantity * currentMaterial.conversionFactor : 0;
        }
        
        const currentStockUnits = currentMaterial.currentStockUnits ?? 0;
        const currentWeightKg = currentMaterial.currentWeightKg ?? 0;

        if (currentStockUnits < unitsConsumed || currentWeightKg < consumedWeight) {
          throw new Error(`Stock insufficiente. Disponibile: ${formatDisplayStock(currentStockUnits, currentMaterial.unitOfMeasure)} ${currentMaterial.unitOfMeasure} / ${formatDisplayStock(currentWeightKg, 'kg')} kg.`);
        }
        
        const newStockUnits = currentStockUnits - unitsConsumed;
        const newWeightKg = currentWeightKg - consumedWeight;

        transaction.update(materialRef, { currentStockUnits: newStockUnits, currentWeightKg: newWeightKg });
        
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: [],
            jobOrderPFs: jobOrderPF ? [jobOrderPF] : ['SCARICO_DA_FILE'],
            materialId: material.id,
            materialCode: material.code,
            consumedWeight,
            consumedUnits: unitsConsumed,
            operatorId: uid,
            operatorName: admin?.nome || 'Admin Import',
            withdrawalDate: Timestamp.now(),
            notes: notes || `Scarico da file. Riga ${index + 2}`,
            lotto: lotto || null,
        });
      });
      successCount++;
    } catch (e: any) {
        errorCount++;
        errors.push(`Riga ${index + 2} (${materialCode}): ${e.message}`);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/reports');

  let message = `Importazione completata. ${successCount} scarichi registrati, ${errorCount} errori.`;
  if (errors.length > 0) {
    message += ` Dettagli errori: ${errors.slice(0, 5).join('; ')}`;
  }

  return { success: errorCount === 0, message };
}
