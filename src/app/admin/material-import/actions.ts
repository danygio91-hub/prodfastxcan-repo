
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDoc, runTransaction, getDocs, query, orderBy, arrayUnion, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, Operator } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';
import { formatDisplayStock } from '@/lib/utils';


export async function getPackagingItems(): Promise<Packaging[]> {
  const packagingCol = collection(db, 'packaging');
  const q = query(packagingCol, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Packaging);
}

// Helper to get operator by UID for logging purposes
async function getOperatorByUid(uid: string): Promise<Operator | null> {
    const q = query(collection(db, "operators"), where("uid", "==", uid));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const operatorDoc = querySnapshot.docs[0];
        return { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
    }
    // Fallback to check by ID if UID is not set
    const docRef = doc(db, "operators", uid);
    const docSnap = await getDoc(docRef);
    if(docSnap.exists()){
        return { ...docSnap.data(), id: docSnap.id } as Operator;
    }
    return null;
}


export async function importCaricoFromFile(
  data: any[],
  uid: string
): Promise<{ success: boolean; message: string; failedRows?: any[] }> {
  await ensureAdmin(uid);

  if (!data || data.length === 0) {
    return { success: false, message: 'Nessun dato da importare.' };
  }

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial]));

  const packagingSnapshot = await getDocs(collection(db, 'packaging'));
  const packagingMap = new Map(packagingSnapshot.docs.map(doc => [doc.data().name.toLowerCase(), {id: doc.id, weight: doc.data().weightKg as number}]));

  const failedRows: any[] = [];
  const errors: string[] = [];
  let successCount = 0;

  for (const row of data) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const ddt = row['DDT'];
    const netQuantity = parseFloat(row['Quantita Netta']);
    const date = row['Data']; // Assuming it's an Excel date number or a string
    const packagingName = row['Tara (Imballo)']?.toLowerCase();
    
    if (!materialCode || !lotto || isNaN(netQuantity) || netQuantity <= 0) {
      errors.push(`Riga con codice "${materialCode || 'N/D'}": Dati mancanti o non validi (Codice, Lotto, Quantità).`);
      failedRows.push(row);
      continue;
    }

    const material = materialsMap.get(materialCode.toLowerCase());
    if (!material) {
      errors.push(`Riga con codice "${materialCode}": Materiale non trovato.`);
      failedRows.push(row);
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
       errors.push(`Riga con lotto "${lotto}": Data non valida.`);
       failedRows.push(row);
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
                id: `batch-import-${Date.now()}-${data.indexOf(row)}`,
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
        errors.push(`Riga con lotto "${lotto}": ${e.message}`);
        failedRows.push(row);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/batch-management');

  let message = `Importazione completata. ${successCount} lotti caricati, ${failedRows.length} errori.`;
  if (errors.length > 0) {
    message = `${message} Dettagli errori: ${errors.slice(0, 5).join('; ')}`;
  }

  return { success: failedRows.length === 0, message, failedRows };
}


export async function importScaricoFromFile(data: any[], uid: string): Promise<{ success: boolean; message: string; failedRows?: any[] }> {
  await ensureAdmin(uid);
  const admin = await getOperatorByUid(uid);

  if (!data || data.length === 0) {
    return { success: false, message: 'Nessun dato da importare.' };
  }

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial]));

  let successCount = 0;
  const failedRows: any[] = [];
  const errors: string[] = [];

  for (const row of data) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const quantity = parseFloat(row['Quantita da Scaricare']);
    const unit = row['Unita']?.toLowerCase();
    const jobOrderPF = row['Commessa Associata'];
    const notes = row['Note'];
    
    if (!materialCode || isNaN(quantity) || quantity <= 0 || !['n', 'mt', 'kg'].includes(unit)) {
      errors.push(`Riga con codice "${materialCode || 'N/D'}": Dati mancanti o non validi (Codice, Quantità, Unità).`);
      failedRows.push(row);
      continue;
    }

    const material = materialsMap.get(materialCode.toLowerCase());
    if (!material) {
      errors.push(`Riga con codice "${materialCode}": Materiale non trovato.`);
      failedRows.push(row);
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

        if (currentStockUnits < unitsConsumed) {
          throw new Error(`Stock insufficiente. Disponibile: ${formatDisplayStock(currentStockUnits, currentMaterial.unitOfMeasure)} ${currentMaterial.unitOfMeasure}, Richiesto: ${unitsConsumed}.`);
        }
         if (currentWeightKg < consumedWeight) {
             throw new Error(`Stock a peso insufficiente. Disponibile: ${formatDisplayStock(currentWeightKg, 'kg')} kg, Richiesto: ${consumedWeight.toFixed(2)}kg.`);
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
            notes: notes || 'Scarico da file',
            lotto: lotto || null,
        });
      });
      successCount++;
    } catch (e: any) {
        errors.push(`Riga con codice "${materialCode}": ${e.message}`);
        failedRows.push(row);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/reports');

  let message = `Importazione completata. ${successCount} scarichi registrati, ${failedRows.length} errori.`;
  if (errors.length > 0) {
    message += ` Dettagli errori: ${errors.slice(0, 5).join('; ')}`;
  }

  return { success: failedRows.length === 0, message, failedRows };
}
