'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial, RawMaterialBatch, Packaging, InventoryRecord, Operator } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';

import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';

function convertTimestamps(obj: any): any {
    if (obj instanceof Date) return obj.toISOString();
    if (obj && typeof obj === 'object') {
        if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString();
        for (const key in obj) { obj[key] = convertTimestamps(obj[key]); }
    }
    return obj;
}

export async function getPackagingItems(): Promise<Packaging[]> {
  const snap = await adminDb.collection('packaging').orderBy("name").get();
  return snap.docs.map(doc => doc.data() as Packaging);
}

export async function getInventoryRecords(): Promise<InventoryRecord[]> {
  const snap = await adminDb.collection("inventoryRecords").orderBy("recordedAt", "desc").get();
  if (snap.empty) return [];
  const materialIds = [...new Set(snap.docs.map(doc => doc.data().materialId).filter(Boolean))];
  const materialsMap = new Map<string, RawMaterial>();
  if (materialIds.length > 0) {
    const CHUNK_SIZE = 30;
    for (let i = 0; i < materialIds.length; i += CHUNK_SIZE) {
        const chunk = materialIds.slice(i, i + CHUNK_SIZE);
        const mSnap = await adminDb.collection('rawMaterials').where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
        mSnap.forEach(doc => materialsMap.set(doc.id, doc.data() as RawMaterial));
    }
  }
  const records = snap.docs.map(docSnap => {
    const data = docSnap.data() as Omit<InventoryRecord, 'id'>;
    const material = materialsMap.get(data.materialId);
    return { 
        id: docSnap.id, 
        ...data, 
        materialUnitOfMeasure: material?.unitOfMeasure,
        // Ensure conversion factors are present even if not in the record itself (legacy support)
        conversionFactor: data.conversionFactor || material?.conversionFactor || undefined,
        rapportoKgMt: data.rapportoKgMt || material?.rapportoKgMt || undefined
    } as InventoryRecord;
  });
  return JSON.parse(JSON.stringify(convertTimestamps(records)));
}

export async function approveInventoryRecord(recordId: string, uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const recordRef = adminDb.collection('inventoryRecords').doc(recordId);
    try {
        const globalSettings = await getGlobalSettings();

        await adminDb.runTransaction(async (transaction) => {
            const rSnap = await transaction.get(recordRef);
            if (!rSnap.exists || rSnap.data()?.status !== 'pending') throw new Error("Gìa processata.");
            const record = rSnap.data() as InventoryRecord;

            const mRef = adminDb.collection('rawMaterials').doc(record.materialId);
            const [mSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(mRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', record.materialId).get()
            ]);

            if (!mSnap.exists) throw new Error("Materiale non trovato.");
            const material = mSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
            
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            const { unitsToChange, weightToChange } = calculateInventoryMovement(
                material,
                config,
                record.inputQuantity,
                record.inputUnit,
                true, // Addition (Carico da inventario)
                record.lotto
            );
            
            const dateStr = (record.recordedAt instanceof admin.firestore.Timestamp) 
                ? record.recordedAt.toDate().toISOString() 
                : (record.recordedAt?.toDate?.())
                    ? record.recordedAt.toDate().toISOString()
                    : new Date(record.recordedAt).toISOString();

            const newBatch: RawMaterialBatch = { 
                id: `batch-inv-${record.id}`, 
                inventoryRecordId: recordId, 
                date: dateStr, 
                ddt: `Inventario`, 
                netQuantity: unitsToChange, 
                grossWeight: weightToChange + record.tareWeight, 
                tareWeight: record.tareWeight, 
                lotto: record.lotto 
            };
            
            const updatedBatches = [...(material.batches || []), newBatch];
            transaction.update(mRef, { 
                batches: updatedBatches 
            });
            await recalculateMaterialStock(record.materialId, transaction, { material, batches: updatedBatches, withdrawals });
            transaction.update(recordRef, { status: 'approved', approvedBy: uid, approvedAt: admin.firestore.Timestamp.now() });
        });
        revalidatePath('/admin/inventory-management');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Approvata.` };
    } catch (e) { 
        console.error("Errore approvazione:", e);
        return { success: false, message: 'Errore durante l\'approvazione.' }; 
    }
}

export async function deleteInventoryRecords(ids: string[], uid: string) {
  await ensureAdmin(uid);
  const batch = adminDb.batch();
  ids.forEach(id => batch.delete(adminDb.collection('inventoryRecords').doc(id)));
  await batch.commit();
  revalidatePath('/admin/inventory-management');
  return { success: true, message: 'Eliminate.' };
}

export async function getMaterialById(materialId: string): Promise<RawMaterial | null> {
    const docSnap = await adminDb.collection('rawMaterials').doc(materialId).get();
    if (docSnap.exists) return docSnap.data() as RawMaterial;
    return null;
}

export async function rejectInventoryRecord(id: string, uid: string) {
    await ensureAdmin(uid);
    await adminDb.collection('inventoryRecords').doc(id).update({ status: 'rejected', approvedBy: uid, approvedAt: admin.firestore.Timestamp.now() });
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Rifiutata.' };
}

export async function revertInventoryRecordStatus(id: string, uid: string) {
    await ensureAdmin(uid);
    await adminDb.runTransaction(async (transaction) => {
        const rSnap = await transaction.get(adminDb.collection('inventoryRecords').doc(id));
        if (!rSnap.exists) return;
        const rec = rSnap.data() as InventoryRecord;
        if (rec.status === 'approved') {
            const mRef = adminDb.collection('rawMaterials').doc(rec.materialId);
            const [mSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(mRef),
                adminDb.collection('materialWithdrawals').where('materialId', '==', rec.materialId).get()
            ]);

            if (mSnap.exists) {
                const mat = mSnap.data() as RawMaterial;
                const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
                const batch = (mat.batches || []).find(b => b.inventoryRecordId === id);
                if (batch) {
                    const updatedBatches = (mat.batches || []).filter(b => b.inventoryRecordId !== id);
                    transaction.update(mRef, { 
                        batches: updatedBatches, 
                    });
                    await recalculateMaterialStock(rec.materialId, transaction, { material: mat, batches: updatedBatches, withdrawals });
                }
            }
        }
        transaction.update(adminDb.collection('inventoryRecords').doc(id), { status: 'pending', approvedBy: admin.firestore.FieldValue.delete(), approvedAt: admin.firestore.FieldValue.delete() });
    });
    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Annullata.' };
}

export async function updateInventoryRecord(id: string, qty: number, unit: string, packId: string, uid: string) {
    await ensureAdmin(uid);
    const snap = await adminDb.collection('inventoryRecords').doc(id).get();
    if (!snap.exists) return { success: false, message: 'Registrazione non trovata.' };
    
    const mat = await getMaterialById(snap.data()?.materialId);
    if (!mat) return { success: false, message: 'Materiale non trovato.' };

    let tare = 0;
    if (packId && packId !== 'none') {
        const pSnap = await adminDb.collection('packaging').doc(packId).get();
        tare = pSnap.data()?.weightKg || 0;
    }

    const factor = (unit === 'mt') 
        ? (mat.rapportoKgMt || mat.conversionFactor || 0)
        : (mat.conversionFactor || 0);

    let net = unit === 'kg' ? qty - tare : qty * factor;
    
    await adminDb.collection('inventoryRecords').doc(id).update({ 
        inputQuantity: qty, 
        inputUnit: unit, 
        packagingId: packId === 'none' ? null : packId, 
        tareWeight: tare, 
        netWeight: net, 
        grossWeight: unit === 'kg' ? qty : net + tare 
    });
    
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Aggiornata.' };
}

export async function approveMultipleInventoryRecords(ids: string[], uid: string) {
    for (const id of ids) await approveInventoryRecord(id, uid);
    return { success: true, message: 'Completato.' };
}

export async function rejectMultipleInventoryRecords(ids: string[], uid: string) {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    ids.forEach(id => batch.update(adminDb.collection('inventoryRecords').doc(id), { status: 'rejected', approvedBy: uid, approvedAt: admin.firestore.Timestamp.now() }));
    await batch.commit();
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Rifiutate.' };
}
