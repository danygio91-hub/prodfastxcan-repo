'use server';

import { revalidatePath } from 'next/cache';
import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import type { RawMaterial, RawMaterialBatch, Packaging, Operator } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

export async function getPackagingItems(): Promise<Packaging[]> {
  const snapshot = await adminDb.collection('packaging').orderBy("name").get();
  return snapshot.docs.map(doc => doc.data() as Packaging);
}

async function getOperatorByUid(uid: string): Promise<Operator | null> {
  const querySnapshot = await adminDb.collection("operators").where("uid", "==", uid).limit(1).get();
  if (!querySnapshot.empty) {
    const operatorDoc = querySnapshot.docs[0];
    return { ...operatorDoc.data(), id: operatorDoc.id } as Operator;
  }
  const docRef = adminDb.collection("operators").doc(uid);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
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

  const uniqueMaterialCodes = Array.from(new Set(data.map(r => r['Codice Materiale']?.toString().trim().toLowerCase()).filter(Boolean)));
  const materialsMap = new Map<string, RawMaterial>();

  const CHUNK_SIZE = 30;
  for (let i = 0; i < uniqueMaterialCodes.length; i += CHUNK_SIZE) {
    const chunk = uniqueMaterialCodes.slice(i, i + CHUNK_SIZE);
    const snapshot = await adminDb.collection('rawMaterials').where('code_normalized', 'in', chunk).get();
    snapshot.docs.forEach(doc => {
      materialsMap.set(doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial);
    });
  }

  const packagingSnapshot = await adminDb.collection('packaging').get();
  const packagingMap = new Map(packagingSnapshot.docs.map(doc => [doc.data().name.toLowerCase(), { id: doc.id, weight: doc.data().weightKg as number }]));

  const failedRows: any[] = [];
  let successCount = 0;

  for (const row of data) {
    const materialCode = row['Codice Materiale'];
    const lotto = row['Lotto'];
    const ddt = row['DDT'];
    const netQuantity = parseFloat(row['Quantita Netta']);
    const date = row['Data'];
    const packagingName = row['Tara (Imballo)']?.toLowerCase();

    if (!materialCode || !lotto || isNaN(netQuantity) || netQuantity <= 0) {
      failedRows.push({ ...row, reason: "Dati obbligatori mancanti o quantità non valida." });
      continue;
    }

    const material = materialsMap.get(materialCode.toLowerCase());
    if (!material) {
      failedRows.push({ ...row, reason: `Materiale "${materialCode}" non trovato in anagrafica.` });
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

    const materialRef = adminDb.collection('rawMaterials').doc(material.id);

    try {
      await adminDb.runTransaction(async (transaction) => {
        const freshMaterialDoc = await transaction.get(materialRef);
        if (!freshMaterialDoc.exists) throw new Error("Documento materiale sparito dal DB.");
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
          batches: admin.firestore.FieldValue.arrayUnion(newBatch),
          currentStockUnits: (currentMaterial.currentStockUnits || 0) + netQuantity,
          currentWeightKg: (currentMaterial.currentWeightKg || 0) + netWeightForCalc
        });
      });
      successCount++;
    } catch (e: any) {
      failedRows.push({ ...row, reason: e instanceof Error ? e.message : "Errore transazione." });
    }
  }

  revalidatePath('/admin/raw-material-management');
  return { success: failedRows.length === 0, message: `Importazione completata. ${successCount} lotti caricati.`, failedRows };
}

export async function importScaricoFromFile(data: any[], uid: string): Promise<{ success: boolean; message: string; failedRows?: any[] }> {
  await ensureAdmin(uid);
  const adminProfile = await getOperatorByUid(uid);

  if (!data || data.length === 0) return { success: false, message: 'Nessun dato.' };

  const uniqueMaterialCodes = Array.from(new Set(data.map(r => r['Codice Materiale']?.toString().trim().toLowerCase()).filter(Boolean)));
  const materialsMap = new Map<string, RawMaterial>();

  const CHUNK_SIZE = 30;
  for (let i = 0; i < uniqueMaterialCodes.length; i += CHUNK_SIZE) {
    const chunk = uniqueMaterialCodes.slice(i, i + CHUNK_SIZE);
    const snapshot = await adminDb.collection('rawMaterials').where('code_normalized', 'in', chunk).get();
    snapshot.docs.forEach(doc => {
      materialsMap.set(doc.data().code_normalized, { id: doc.id, ...doc.data() } as RawMaterial);
    });
  }

  let successCount = 0;
  const failedRows: any[] = [];

  for (const row of data) {
    const materialCode = row['Codice Materiale']?.toString().trim();
    const lotto = row['Lotto']?.toString().trim();
    const quantity = parseFloat(row['Quantita da Scaricare']);
    const unit = row['Unita']?.toLowerCase();

    if (!materialCode || isNaN(quantity) || quantity <= 0) {
      failedRows.push({ ...row, reason: "Dati obbligatori (Codice/Quantità) mancanti o non validi." });
      continue;
    }

    const materialLookup = materialsMap.get(materialCode.toLowerCase());
    if (!materialLookup) {
      failedRows.push({ ...row, reason: `Materiale "${materialCode}" non trovato in anagrafica.` });
      continue;
    }

    try {
      await adminDb.runTransaction(async (transaction) => {
        const materialRef = adminDb.collection("rawMaterials").doc(materialLookup.id);
        const materialDoc = await transaction.get(materialRef);

        if (!materialDoc.exists) throw new Error(`Documento ID ${materialLookup.id} non trovato.`);
        const currentMaterial = materialDoc.data() as RawMaterial;

        let consumedUnits = 0;
        let consumedWeight = 0;

        if (unit === 'kg') {
          consumedWeight = quantity;
          if (currentMaterial.unitOfMeasure === 'kg') {
            consumedUnits = quantity;
          } else {
            if (!currentMaterial.conversionFactor || currentMaterial.conversionFactor <= 0) {
              throw new Error(`Conversione KG in ${currentMaterial.unitOfMeasure} non configurata.`);
            }
            consumedUnits = quantity / currentMaterial.conversionFactor;
          }
        } else {
          consumedUnits = quantity;
          if (currentMaterial.unitOfMeasure === 'kg') {
            consumedWeight = quantity;
          } else if (currentMaterial.conversionFactor && currentMaterial.conversionFactor > 0) {
            consumedWeight = quantity * currentMaterial.conversionFactor;
          } else if (currentMaterial.unitOfMeasure === 'mt' && currentMaterial.rapportoKgMt) {
            consumedWeight = quantity * currentMaterial.rapportoKgMt;
          } else {
            throw new Error(`Impossibile calcolare il peso in KG per l'unità ${unit}.`);
          }
        }

        transaction.update(materialRef, {
          currentStockUnits: (currentMaterial.currentStockUnits || 0) - consumedUnits,
          currentWeightKg: (currentMaterial.currentWeightKg || 0) - consumedWeight
        });

        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
        transaction.set(withdrawalRef, {
          jobIds: [],
          jobOrderPFs: row['Commessa Associata'] ? [row['Commessa Associata'].toString()] : ['SCARICO_DA_FILE'],
          materialId: materialLookup.id,
          materialCode: currentMaterial.code,
          consumedWeight,
          consumedUnits: consumedUnits,
          operatorId: uid,
          operatorName: adminProfile?.nome || 'Admin Import',
          withdrawalDate: admin.firestore.Timestamp.now(),
          notes: row['Note'] || 'Scarico da file',
          lotto: lotto || null,
        });
      });
      successCount++;
    } catch (e: any) {
      failedRows.push({ ...row, reason: e instanceof Error ? e.message : "Errore critico durante lo scarico." });
    }
  }

  revalidatePath('/admin/raw-material-management');
  revalidatePath('/admin/reports');
  return { success: failedRows.length === 0, message: `Operazione terminata. ${successCount} scarichi registrati correttamente.`, failedRows };
}
