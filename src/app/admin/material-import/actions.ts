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

async function getOperatorByUid(uid: string): Promise<Operator | null> {
    const q = query(collection(db, "operators"), where("uid", "==", uid));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const operatorDoc = querySnapshot.docs[0];
        return { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
    }
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
    const date = row['Data']; 
    const packagingName = row['Tara (Imballo)']?.toLowerCase();
    
    if (!materialCode || !lotto || isNaN(netQuantity) || netQuantity <= 0) {
      errors.push(`Riga con codice "${materialCode || 'N/D'}": Dati mancanti o non validi.`);
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
    if (typeof date === 'number') {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      parsedDate = new Date(excelEpoch.getTime() + date * 86400 * 1000);
    } else if (typeof date === 'string') {
      parsedDate = new Date(date);
    } else {
      parsedDate = new Date();
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
            const currentMaterial = freshMaterialDoc.data() as RawMaterial;
            
            let netWeightForCalc = currentMaterial.unitOfMeasure === 'kg' ? netQuantity : (currentMaterial.conversionFactor ? netQuantity * currentMaterial.conversionFactor : 0);

            const newBatch: RawMaterialBatch = {
                id: `batch-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                date: parsedDate.toISOString(),
                ddt: ddt || `IMPORT-${parsedDate.toISOString().split('T')[0]}`,
                lotto,
                netQuantity,
                tareWeight,
                grossWeight: netWeightForCalc + tareWeight,
                packagingId: packagingId,
            };
            
            transaction.update(materialRef, {
                batches: arrayUnion(newBatch),
                currentStockUnits: (currentMaterial.currentStockUnits || 0) + netQuantity,
                currentWeightKg: (currentMaterial.currentWeightKg || 0) + netWeightForCalc
            });
        });
        successCount++;
    } catch (e: any) {
        failedRows.push(row);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/batch-management');
  return { success: failedRows.length === 0, message: `Importazione completata. ${successCount} lotti caricati.`, failedRows };
}


export async function importScaricoFromFile(data: any[], uid: string): Promise<{ success: boolean; message: string; failedRows?: any[] }> {
  await ensureAdmin(uid);
  const admin = await getOperatorByUid(uid);

  if (!data || data.length === 0) return { success: false, message: 'Nessun dato.' };

  const materialsSnapshot = await getDocs(collection(db, 'rawMaterials'));
  const materialsMap = new Map(materialsSnapshot.docs.map(doc => [doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial]));

  let successCount = 0;
  const failedRows: any[] = [];

  for (const row of data) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const quantity = parseFloat(row['Quantita da Scaricare']);
    const unit = row['Unita']?.toLowerCase();
    
    if (!materialCode || !lotto || isNaN(quantity) || quantity <= 0) {
      failedRows.push(row); continue;
    }

    const materialLookup = materialsMap.get(materialCode.toLowerCase());
    if (!materialLookup) { failedRows.push(row); continue; }

    try {
      await runTransaction(db, async (transaction) => {
        const materialRef = doc(db, "rawMaterials", materialLookup.id);
        const materialDoc = await transaction.get(materialRef);
        const currentMaterial = materialDoc.data() as RawMaterial;
        
        let unitsConsumed = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          consumedUnits = (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) ? quantity / currentMaterial.conversionFactor : quantity;
        } else {
          unitsConsumed = quantity;
          consumedWeight = (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) ? quantity * currentMaterial.conversionFactor : 0;
        }

        transaction.update(materialRef, { 
            currentStockUnits: (currentMaterial.currentStockUnits || 0) - unitsConsumed, 
            currentWeightKg: (currentMaterial.currentWeightKg || 0) - consumedWeight 
        });
        
        const withdrawalRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(withdrawalRef, {
            jobIds: [],
            jobOrderPFs: row['Commessa Associata'] ? [row['Commessa Associata']] : ['SCARICO_DA_FILE'],
            materialId: currentMaterial.id,
            materialCode: currentMaterial.code,
            consumedWeight,
            consumedUnits: unitsConsumed,
            operatorId: uid,
            operatorName: admin?.nome || 'Admin Import',
            withdrawalDate: Timestamp.now(),
            notes: row['Note'] || 'Scarico da file',
            lotto: lotto || null,
        });
      });
      successCount++;
    } catch (e: any) {
        failedRows.push(row);
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/reports');
  return { success: failedRows.length === 0, message: `Completato. ${successCount} scarichi registrati.`, failedRows };
}