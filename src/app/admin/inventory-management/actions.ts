
'use server';

import { collection, doc, runTransaction, getDocs, query, orderBy, addDoc, Timestamp, updateDoc, getDoc, arrayRemove, writeBatch, deleteField, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord, Operator } from '@/lib/mock-data';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';

function convertTimestamps(obj: any): any {
    if (obj instanceof Date) return obj.toISOString();
    if (obj && typeof obj === 'object') {
        if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString();
        for (const key in obj) { obj[key] = convertTimestamps(obj[key]); }
    }
    return obj;
}

export async function getPackagingItems(): Promise<Packaging[]> {
  const snap = await getDocs(query(collection(db, 'packaging'), orderBy("name")));
  return snap.docs.map(doc => doc.data() as Packaging);
}

export async function getInventoryRecords(): Promise<InventoryRecord[]> {
  const snap = await getDocs(query(collection(db, "inventoryRecords"), orderBy("recordedAt", "desc")));
  if (snap.empty) return [];
  const materialIds = [...new Set(snap.docs.map(doc => doc.data().materialId).filter(Boolean))];
  const materialsMap = new Map<string, RawMaterial>();
  if (materialIds.length > 0) {
    const CHUNK_SIZE = 30;
    for (let i = 0; i < materialIds.length; i += CHUNK_SIZE) {
        const chunk = materialIds.slice(i, i + CHUNK_SIZE);
        const mSnap = await getDocs(query(collection(db, 'rawMaterials'), where('__name__', 'in', chunk)));
        mSnap.forEach(doc => materialsMap.set(doc.id, doc.data() as RawMaterial));
    }
  }
  const batch = writeBatch(db);
  let hasUpdates = false;
  const records = snap.docs.map(docSnap => {
    const data = docSnap.data() as Omit<InventoryRecord, 'id'>;
    const material = materialsMap.get(data.materialId);
    if ((data.netWeight === 0 || data.netWeight === undefined) && data.inputQuantity > 0 && data.inputUnit !== 'kg' && material?.conversionFactor) {
        const newNet = data.inputQuantity * material.conversionFactor;
        batch.update(doc(db, 'inventoryRecords', docSnap.id), { netWeight: newNet, grossWeight: newNet + (data.tareWeight || 0) });
        hasUpdates = true;
        return { id: docSnap.id, ...data, netWeight: newNet, grossWeight: newNet + (data.tareWeight || 0), materialUnitOfMeasure: material.unitOfMeasure } as InventoryRecord;
    }
    return { id: docSnap.id, ...data, materialUnitOfMeasure: material?.unitOfMeasure } as InventoryRecord;
  });
  if (hasUpdates) await batch.commit();
  return JSON.parse(JSON.stringify(convertTimestamps(records)));
}

export async function approveInventoryRecord(recordId: string, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = doc(db, 'inventoryRecords', recordId);
    try {
        await runTransaction(db, async (transaction) => {
            const rSnap = await transaction.get(recordRef);
            if (!rSnap.exists() || rSnap.data().status !== 'pending') throw new Error("Gia processata.");
            const record = rSnap.data() as InventoryRecord;
            const mRef = doc(db, 'rawMaterials', record.materialId);
            const mSnap = await transaction.get(mRef);
            if (!mSnap.exists()) throw new Error("Materiale non trovato.");
            const material = mSnap.data() as RawMaterial;
            const unitsToAdd = record.inputUnit === 'kg' ? (material.unitOfMeasure === 'kg' ? record.netWeight : record.netWeight / (material.conversionFactor || 1)) : record.inputQuantity;
            const newBatch: RawMaterialBatch = { id: `batch-inv-${record.id}`, inventoryRecordId: recordId, date: new Date(record.recordedAt).toISOString(), ddt: `Inventario`, netQuantity: unitsToAdd, grossWeight: record.grossWeight, tareWeight: record.tareWeight, lotto: record.lotto };
            transaction.update(mRef, { currentStockUnits: (material.currentStockUnits || 0) + unitsToAdd, currentWeightKg: (material.currentWeightKg || 0) + record.netWeight, batches: [...(material.batches || []), newBatch] });
            transaction.update(recordRef, { status: 'approved', approvedBy: uid, approvedAt: Timestamp.now() });
        });
        revalidatePath('/admin/inventory-management');
        return { success: true, message: `Approvata.` };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function deleteInventoryRecords(ids: string[], uid: string) {
  await ensureAdmin(uid);
  const batch = writeBatch(db);
  ids.forEach(id => batch.delete(doc(db, 'inventoryRecords', id)));
  await batch.commit();
  revalidatePath('/admin/inventory-management');
  return { success: true, message: 'Eliminate.' };
}

export async function getMaterialById(materialId: string): Promise<RawMaterial | null> {
    const materialRef = doc(db, 'rawMaterials', materialId);
    const docSnap = await getDoc(materialRef);
    if (docSnap.exists()) {
        return docSnap.data() as RawMaterial;
    }
    return null;
}

export async function rejectInventoryRecord(id: string, uid: string) {
    await ensureAdmin(uid);
    await updateDoc(doc(db, 'inventoryRecords', id), { status: 'rejected', approvedBy: uid, approvedAt: Timestamp.now() });
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Rifiutata.' };
}

export async function revertInventoryRecordStatus(id: string, uid: string) {
    await ensureAdmin(uid);
    await runTransaction(db, async (transaction) => {
        const rSnap = await transaction.get(doc(db, 'inventoryRecords', id));
        if (!rSnap.exists()) return;
        const rec = rSnap.data() as InventoryRecord;
        if (rec.status === 'approved') {
            const mRef = doc(db, 'rawMaterials', rec.materialId);
            const mSnap = await transaction.get(mRef);
            if (mSnap.exists()) {
                const mat = mSnap.data() as RawMaterial;
                const batch = (mat.batches || []).find(b => b.inventoryRecordId === id);
                if (batch) {
                    transaction.update(mRef, { batches: arrayRemove(batch), currentStockUnits: Math.max(0, (mat.currentStockUnits || 0) - batch.netQuantity), currentWeightKg: Math.max(0, (mat.currentWeightKg || 0) - rec.netWeight) });
                }
            }
        }
        transaction.update(doc(db, 'inventoryRecords', id), { status: 'pending', approvedBy: deleteField(), approvedAt: deleteField() });
    });
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Annullata.' };
}

export async function updateInventoryRecord(id: string, qty: number, unit: string, packId: string, uid: string) {
    await ensureAdmin(uid);
    const snap = await getDoc(doc(db, 'inventoryRecords', id));
    if (!snap.exists()) throw new Error("Documento non trovato.");
    const mat = await getMaterialById(snap.data()?.materialId);
    let tare = 0;
    if (packId && packId !== 'none') {
        const pSnap = await getDoc(doc(db, 'packaging', packId));
        tare = pSnap.data()?.weightKg || 0;
    }
    let net = unit === 'kg' ? qty - tare : (mat?.conversionFactor ? qty * mat.conversionFactor : 0);
    await updateDoc(doc(db, 'inventoryRecords', id), { inputQuantity: qty, inputUnit: unit, packagingId: packId === 'none' ? null : packId, tareWeight: tare, netWeight: net, grossWeight: unit === 'kg' ? qty : net + tare });
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Aggiornata.' };
}

export async function approveMultipleInventoryRecords(ids: string[], uid: string) {
    for (const id of ids) await approveInventoryRecord(id, uid);
    return { success: true, message: 'Completato.' };
}

export async function rejectMultipleInventoryRecords(ids: string[], uid: string) {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'inventoryRecords', id), { status: 'rejected', approvedBy: uid, approvedAt: Timestamp.now() }));
    await batch.commit();
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Rifiutate.' };
}
