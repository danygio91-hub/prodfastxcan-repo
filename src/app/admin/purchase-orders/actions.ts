
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { PurchaseOrder } from '@/types';
import { ensureAdmin } from '@/lib/server-auth';
import { parse, isValid } from 'date-fns';

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const snapshot = await adminDb.collection("purchaseOrders").orderBy("createdAt", "desc").limit(200).get();
  const list = snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as PurchaseOrder);
  return list.sort((a,b) => {
    const valA = a.expectedDeliveryDate as any;
    const valB = b.expectedDeliveryDate as any;
    const dateA = valA instanceof Date ? valA.toISOString() : String(valA || "");
    const dateB = valB instanceof Date ? valB.toISOString() : String(valB || "");
    return dateA.localeCompare(dateB);
  });
}



export async function closePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const poRef = adminDb.collection("purchaseOrders").doc(id);
        const poSnap = await poRef.get();
        if (!poSnap.exists) throw new Error("Ordine non trovato.");
        
        const data = poSnap.data() as PurchaseOrder;
        const finalQty = data.receivedQuantity || 0;

        await poRef.update({
            quantity: finalQty,
            status: 'received',
            updatedAt: admin.firestore.Timestamp.now()
        });

        revalidatePath('/admin/purchase-orders');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Riga ordine chiusa con successo.' };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante la chiusura.' };
    }
}

export async function savePurchaseOrder(data: {
  orderNumber: string;
  supplierName: string;
  items: Array<{
    id?: string;
    materialCode: string;
    quantity: number;
    unitOfMeasure: string;
    expectedDeliveryDate: string;
  }>;
}, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    
    const existingSnap = await adminDb.collection("purchaseOrders").where("orderNumber", "==", data.orderNumber).get();
    const incomingIds = new Set(data.items.map(i => i.id).filter(Boolean));

    existingSnap.docs.forEach(docSnap => {
        if (!incomingIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    for (const item of data.items) {
      const finalId = item.id || `po-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const docRef = adminDb.collection("purchaseOrders").doc(finalId);
      
      const existingDoc = existingSnap.docs.find(d => d.id === finalId);
      const existingData = existingDoc ? existingDoc.data() : {};

      batch.set(docRef, {
        ...existingData,
        id: finalId,
        orderNumber: data.orderNumber,
        supplierName: data.supplierName || '',
        materialCode: item.materialCode,
        quantity: item.quantity,
        receivedQuantity: existingData.receivedQuantity || 0,
        unitOfMeasure: item.unitOfMeasure,
        expectedDeliveryDate: item.expectedDeliveryDate,
        status: existingData.status || 'pending',
        createdAt: existingData.createdAt || admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
      });
    }

    await batch.commit();
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Ordine salvato correttamente.' };
  } catch (e) {
    return { success: false, message: 'Errore durante il salvataggio.' };
  }
}

export async function deleteOrderGroup(orderNumber: string, uid: string) {
    await ensureAdmin(uid);
    try {
        const snap = await adminDb.collection("purchaseOrders").where("orderNumber", "==", orderNumber).get();
        const batch = adminDb.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        revalidatePath('/admin/purchase-orders');
        return { success: true, message: "Intero ordine eliminato." };
    } catch (e) {
        return { success: false, message: "Errore durante l'eliminazione." };
    }
}

export async function deletePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  try {
    await adminDb.collection("purchaseOrders").doc(id).delete();
    revalidatePath('/admin/purchase-orders');
    return { success: true, message: 'Riga ordine eliminata.' };
  } catch (e) {
    return { success: false, message: 'Errore.' };
  }
}

export async function importPurchaseOrders(data: any[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    let added = 0;

    for (const row of data) {
        const orderNumber = String(row["N° Ordine"] || row.orderNumber || "").trim();
        const supplierName = String(row["Fornitore"] || row.supplierName || "").trim();
        const materialCode = String(row["Codice Materiale"] || row.materialCode || "").trim();
        const quantity = Number(row["Quantità"] || row.quantity);
        const unit = (row["Unità"] || row.unitOfMeasure || "n").toLowerCase();
        const rawDate = row["Data Consegna"] || row.expectedDeliveryDate;

        if (!orderNumber || !materialCode || isNaN(quantity)) continue;

        let deliveryDate = "";
        if (rawDate instanceof Date) {
            deliveryDate = rawDate.toISOString();
        } else if (typeof rawDate === 'number') {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            deliveryDate = new Date(excelEpoch.getTime() + rawDate * 86400 * 1000).toISOString();
        } else if (typeof rawDate === 'string') {
            const formatsToTry = ['dd/MM/yyyy', 'yyyy-MM-dd'];
            let parsed = null;
            for(const fmt of formatsToTry) {
                const temp = parse(rawDate, fmt, new Date());
                if(isValid(temp)) { parsed = temp; break; }
            }
            deliveryDate = parsed ? parsed.toISOString() : new Date().toISOString();
        } else {
            deliveryDate = new Date().toISOString();
        }

        const newRef = adminDb.collection("purchaseOrders").doc();
        batch.set(newRef, {
            id: newRef.id,
            orderNumber,
            supplierName,
            materialCode,
            quantity,
            receivedQuantity: 0,
            unitOfMeasure: unit,
            expectedDeliveryDate: deliveryDate,
            status: 'pending',
            createdAt: admin.firestore.Timestamp.now()
        });
        added++;
    }

    if (added > 0) await batch.commit();
    revalidatePath('/admin/purchase-orders');
    return { success: true, message: `Importati ${added} righe ordine fornitore.` };
}
