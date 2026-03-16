
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, query, orderBy, Timestamp, writeBatch, updateDoc, where, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PurchaseOrder } from '@/lib/mock-data';
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
  const col = collection(db, "purchaseOrders");
  const q = query(col, orderBy("expectedDeliveryDate", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as PurchaseOrder);
}

export async function closePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const poRef = doc(db, "purchaseOrders", id);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) throw new Error("Ordine non trovato.");
        
        const data = poSnap.data() as PurchaseOrder;
        const finalQty = data.receivedQuantity || 0;

        await updateDoc(poRef, {
            quantity: finalQty,
            status: 'received',
            updatedAt: Timestamp.now()
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
    unitOfMeasure: 'n' | 'mt' | 'kg';
    expectedDeliveryDate: string;
  }>;
}, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    
    const existingQ = query(collection(db, "purchaseOrders"), where("orderNumber", "==", data.orderNumber));
    const existingSnap = await getDocs(existingQ);
    const incomingIds = new Set(data.items.map(i => i.id).filter(Boolean));

    existingSnap.docs.forEach(docSnap => {
        if (!incomingIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    for (const item of data.items) {
      const finalId = item.id || `po-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const docRef = doc(db, "purchaseOrders", finalId);
      
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
        createdAt: existingData.createdAt || Timestamp.now(),
        updatedAt: Timestamp.now()
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
        const q = query(collection(db, "purchaseOrders"), where("orderNumber", "==", orderNumber));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
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
    await deleteDoc(doc(db, "purchaseOrders", id));
    revalidatePath('/admin/purchase-orders');
    return { success: true, message: 'Riga ordine eliminata.' };
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
    return { success: true, message: `Importati ${added} righe ordine fornitore.` };
}
