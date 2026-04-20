'use server';

import { revalidatePath } from 'next/cache';
import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import type { RawMaterial, RawMaterialBatch, Packaging, Operator } from '@/types';
import { ensureAdmin } from '@/lib/server-auth';
import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';

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

  const globalSettings = await getGlobalSettings();
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
        
        const config = globalSettings.rawMaterialTypes.find(t => t.id === currentMaterial.type) || {
            id: currentMaterial.type,
            label: currentMaterial.type,
            defaultUnit: currentMaterial.unitOfMeasure,
            hasConversion: false
        } as any;

        const { unitsToChange, weightToChange } = calculateInventoryMovement(
            currentMaterial,
            config,
            netQuantity,
            currentMaterial.unitOfMeasure === 'kg' ? 'kg' : (currentMaterial.unitOfMeasure as any),
            true, // isAddition
            lotto
        );

        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const day = String(parsedDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        const newBatch: RawMaterialBatch = {
          id: `batch-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          date: parsedDate.toISOString(), // ISO is fine for full timestamps if handled correctly, but ddt needs the visual date
          ddt: ddt || `IMPORT-${dateStr}`,
          lotto,
          netQuantity: unitsToChange,
          tareWeight,
          grossWeight: weightToChange + tareWeight,
          packagingId: packagingId,
        };

        transaction.update(materialRef, {
          batches: admin.firestore.FieldValue.arrayUnion(newBatch),
          currentStockUnits: (currentMaterial.currentStockUnits || 0) + unitsToChange,
          currentWeightKg: (currentMaterial.currentWeightKg || 0) + weightToChange
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

  const globalSettings = await getGlobalSettings();
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
        const [materialDoc, withdrawalsSnap] = await Promise.all([
          transaction.get(materialRef),
          adminDb.collection("materialWithdrawals").where("materialId", "==", materialLookup.id).get()
        ]);

        if (!materialDoc.exists) throw new Error(`Documento ID ${materialLookup.id} non trovato.`);
        const currentMaterial = materialDoc.data() as RawMaterial;
        const currentWithdrawals = withdrawalsSnap.docs.map(d => d.data());

        const config = globalSettings.rawMaterialTypes.find(t => t.id === currentMaterial.type) || {
            id: currentMaterial.type,
            label: currentMaterial.type,
            defaultUnit: currentMaterial.unitOfMeasure,
            hasConversion: false
        } as any;

        const { unitsToChange, weightToChange, updatedBatches, usedLotto } = calculateInventoryMovement(
            currentMaterial,
            config,
            quantity,
            unit as any,
            false,
            lotto,
            currentWithdrawals
        );

        transaction.update(materialRef, {
          currentStockUnits: (currentMaterial.currentStockUnits || 0) - unitsToChange,
          currentWeightKg: (currentMaterial.currentWeightKg || 0) - weightToChange,
          batches: updatedBatches
        });

        const withdrawalRef = adminDb.collection("materialWithdrawals").doc();
        transaction.set(withdrawalRef, {
          jobIds: [],
          jobOrderPFs: row['Commessa Associata'] ? [row['Commessa Associata'].toString()] : ['SCARICO_DA_FILE'],
          materialId: materialLookup.id,
          materialCode: currentMaterial.code,
          consumedWeight: weightToChange,
          consumedUnits: unitsToChange,
          operatorId: uid,
          operatorName: adminProfile?.nome || 'Admin Import',
          withdrawalDate: admin.firestore.Timestamp.now(),
          notes: row['Note'] || 'Scarico da file',
          lotto: usedLotto,
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
