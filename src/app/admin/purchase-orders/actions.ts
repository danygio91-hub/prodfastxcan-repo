'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, Timestamp, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PurchaseOrder } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';
import { parse, isValid, format } from 'date-fns';

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const col = collection(db, "purchaseOrders");
  const q = query(col, orderBy("expectedDeliveryDate", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as PurchaseOrder);
}

export async function savePurchaseOrder(data: {
  orderNumber: string;
  supplierName: string;
  items: Array<{
    materialCode: string;
    quantity: number;
    unitOfMeasure: 'n' | 'mt' | 'kg';
    expectedDeliveryDate: string;
  }>;
}, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    
    for (const item of data.items) {
      const id = `po-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const docRef = doc(db, "purchaseOrders", id);
      
      batch.set(docRef, {
        id,
        orderNumber: data.orderNumber,
        supplierName: data.supplierName || '',
        materialCode: item.materialCode,
        quantity: item.quantity,
        receivedQuantity: 0,
        unitOfMeasure: item.unitOfMeasure,
        expectedDeliveryDate: item.expectedDeliveryDate,
        status: 'pending',
        createdAt: Timestamp.now()
      });
    }

    await batch.commit();
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Ordini salvati con successo.' };
  } catch (e) {
    console.error("Error saving purchase orders:", e);
    return { success: false, message: 'Errore durante il salvataggio.' };
  }
}

export async function closePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    try {
        await updateDoc(doc(db, "purchaseOrders", id), {
            status: 'received'
        });
        revalidatePath('/admin/purchase-orders');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Ordine chiuso correttamente.' };
    } catch (e) {
        return { success: false, message: 'Errore durante la chiusura.' };
    }
}

export async function deletePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  try {
    await deleteDoc(doc(db, "purchaseOrders", id));
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Ordine eliminato.' };
  } catch (e) {
    return { success: false, message: 'Errore.' };
  }
}

export async function importPurchaseOrders(data: any[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    let added = 0;

    for (const row of data) {
        const orderNumber = String(row["N° Ordine"] || row.orderNumber || "").trim();
        const supplierName = String(row["Fornitore"] || row.supplierName || "").trim();
        const materialCode = String(row["Codice Materiale"] || row.materialCode || "").trim();
        const quantity = Number(row["Quantità"] || row.quantity);
        const unit = (row["Unità"] || row.unitOfMeasure || "n").toLowerCase() as 'n'|'mt'|'kg';
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

        const newRef = doc(collection(db, "purchaseOrders"));
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
            createdAt: Timestamp.now()
        });
        added++;
    }

    if (added > 0) await batch.commit();
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `Importati ${added} ordini fornitore.` };
}
