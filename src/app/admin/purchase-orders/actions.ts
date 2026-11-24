
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { PurchaseOrder } from '@/types';
import { ensureAdmin } from '@/lib/server-auth';
import { parse, isValid } from 'date-fns';
import { bumpMrpSyncVersion } from '@/lib/mrp-sync';
import { parseRobustDate } from '@/lib/utils';
import {
  isOrderDateValidNotFuture,
  normalizeOrderNumber,
  resolvePurchaseOrderYear,
} from '@/lib/purchase-order-utils';

const FIRESTORE_BATCH_LIMIT = 400;

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

async function commitBatchedOperations(operations: Array<(batch: admin.firestore.WriteBatch) => void>) {
    for (let i = 0; i < operations.length; i += FIRESTORE_BATCH_LIMIT) {
        const chunk = operations.slice(i, i + FIRESTORE_BATCH_LIMIT);
        const batch = adminDb.batch();
        chunk.forEach(op => op(batch));
        await batch.commit();
    }
}

function parseImportDate(rawDate: any): Date | null {
    if (rawDate === undefined || rawDate === null || String(rawDate).trim() === '') {
        return null;
    }
    if (rawDate instanceof Date) {
        return isNaN(rawDate.getTime()) ? null : rawDate;
    }
    if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + rawDate * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof rawDate === 'string') {
        const trimmed = rawDate.trim();
        const formatsToTry = ['dd/MM/yyyy', 'dd/MM/yy', 'yyyy-MM-dd'];
        for (const fmt of formatsToTry) {
            const temp = parse(trimmed, fmt, new Date());
            if (isValid(temp)) return temp;
        }
        return parseRobustDate(trimmed);
    }
    return parseRobustDate(rawDate);
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  // FIX 3: Rimozione Limite 200 per garantire visibilità totale
  // FIX CRITICO: Rimozione orderBy("createdAt", "desc") per evitare che Firestore nasconda i documenti privi del campo createdAt!
  const snapshot = await adminDb.collection("purchaseOrders").get();
  const list = snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as PurchaseOrder);
  return list.sort((a,b) => {
    const valA = a.expectedDeliveryDate as any;
    const valB = b.expectedDeliveryDate as any;
    const dateA = valA instanceof Date ? valA.toISOString() : String(valA || "");
    const dateB = valB instanceof Date ? valB.toISOString() : String(valB || "");
    return dateA.localeCompare(dateB);
  });
}


export async function getTargetedPOs(materialCodes: string[]): Promise<PurchaseOrder[]> {
    if (!materialCodes || materialCodes.length === 0) return [];

    const uniqueCodes = [...new Set(materialCodes.map(c => c.trim().toUpperCase()))].filter(Boolean);
    if (uniqueCodes.length === 0) return [];

    let allPOs: PurchaseOrder[] = [];
    const chunkSize = 30; // Firestore IN limit is 30
    
    for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
        const chunk = uniqueCodes.slice(i, i + chunkSize);
        
        // Zero Sprechi: Filtraggio chirurgico
        const snapshot = await adminDb.collection("purchaseOrders")
            .where('materialCode', 'in', chunk)
            .get();
            
        const chunkPOs = snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as PurchaseOrder);
        allPOs = allPOs.concat(chunkPOs);
    }

    // Filtriamo gli stati pendenti in-memory (inclusi pending, ORDINATO, APERTO)
    const filtered = allPOs.filter(po => {
        const status = (po.status || '').toLowerCase();
        return status !== 'completed' && status !== 'cancelled' && status !== 'received';
    });

    console.log(`[MRP-TARGETED-FETCH] PO Scaricati per ${uniqueCodes.length} codici: ${allPOs.length}, Pendenti filtrati: ${filtered.length}`);

    return filtered.sort((a,b) => {
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

        await bumpMrpSyncVersion('po', 'purchase-orders:closePurchaseOrder');
        revalidatePath('/admin/purchase-orders');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Riga ordine chiusa con successo.' };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Errore durante la chiusura.' };
    }
}

export async function savePurchaseOrder(data: {
  mode?: 'create' | 'edit';
  orderNumber: string;
  orderDate?: string;
  originalOrderNumber?: string;
  originalOrderYear?: number;
  supplierName: string;
  items: Array<{
    id?: string;
    materialCode: string;
    materialType?: string;
    description?: string;
    quantity: number;
    unitOfMeasure?: string;
    unit?: 'kg' | 'mt' | 'n' | string;
    expectedDeliveryDate: string;
  }>;
}, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);

    const cleanOrderNumber = normalizeOrderNumber(data.orderNumber);
    if (!cleanOrderNumber) {
      return { success: false, message: 'Numero ordine obbligatorio.' };
    }

    const cleanSupplierName = String(data.supplierName || '').trim();
    if (!data.items || data.items.length === 0) {
      return { success: false, message: 'Aggiungere almeno una riga materiale.' };
    }

    let resolvedOrderDate: string;
    if (data.orderDate !== undefined && data.orderDate !== null && String(data.orderDate).trim() !== '') {
      const parsedOrderDate = parseRobustDate(data.orderDate);
      if (!parsedOrderDate || !isOrderDateValidNotFuture(parsedOrderDate)) {
        return { success: false, message: 'La Data Ordine non può essere nel futuro.' };
      }
      resolvedOrderDate = parsedOrderDate.toISOString();
    } else {
      resolvedOrderDate = new Date().toISOString();
    }

    const targetOrderYear = new Date(resolvedOrderDate).getFullYear();
    const mode = data.mode ?? 'create';
    const rawOrderNumber = String(data.orderNumber || '').trim();
    const rawOriginalOrderNumber = String(data.originalOrderNumber || '').trim();
    const origOrderNumber = normalizeOrderNumber(data.originalOrderNumber || cleanOrderNumber);
    const origOrderYear =
      typeof data.originalOrderYear === 'number' && Number.isFinite(data.originalOrderYear)
        ? Math.trunc(data.originalOrderYear)
        : targetOrderYear;

    const queryNumbers = Array.from(
      new Set(
        [
          cleanOrderNumber,
          origOrderNumber,
          rawOrderNumber,
          rawOriginalOrderNumber,
          cleanOrderNumber.toLowerCase(),
          origOrderNumber.toLowerCase(),
        ].filter(Boolean)
      )
    );

    const candidatesSnap = await adminDb
      .collection("purchaseOrders")
      .where("orderNumber", "in", queryNumbers)
      .get();

    const docsInTargetKey = candidatesSnap.docs.filter((docSnap) => {
      const docData = docSnap.data();
      return (
        normalizeOrderNumber(docData.orderNumber) === cleanOrderNumber &&
        resolvePurchaseOrderYear(docData) === targetOrderYear
      );
    });

    const docsInOriginalKey = candidatesSnap.docs.filter((docSnap) => {
      const docData = docSnap.data();
      return (
        normalizeOrderNumber(docData.orderNumber) === origOrderNumber &&
        resolvePurchaseOrderYear(docData) === origOrderYear
      );
    });

    if (mode === 'create' && docsInTargetKey.length > 0) {
      return {
        success: false,
        message: `Esiste già l'ordine N° ${cleanOrderNumber} per l'anno ${targetOrderYear}. Aprilo in modifica per aggiungere o variare le righe.`,
      };
    }

    if (mode === 'edit' && (cleanOrderNumber !== origOrderNumber || targetOrderYear !== origOrderYear)) {
      const originalDocIds = new Set(docsInOriginalKey.map(d => d.id));
      const conflictingTargetDocs = docsInTargetKey.filter(d => !originalDocIds.has(d.id));
      if (conflictingTargetDocs.length > 0) {
        return {
          success: false,
          message: `Esiste già l'ordine N° ${cleanOrderNumber} per l'anno ${targetOrderYear}. Aprilo in modifica per aggiungere o variare le righe.`,
        };
      }
    }

    const existingMap = new Map<string, Record<string, any>>();
    if (mode === 'edit') {
      docsInOriginalKey.forEach((docSnap) => {
        existingMap.set(docSnap.id, docSnap.data());
      });
    }

    const incomingIds = new Set(
      mode === 'edit'
        ? data.items.map(i => i.id).filter((id): id is string => Boolean(id))
        : []
    );

    const operations: Array<(batch: admin.firestore.WriteBatch) => void> = [];

    // Zero cross-year deletions: in edit mode, cancella esclusivamente righe rimosse appartenenti a (origOrderNumber, origOrderYear)
    if (mode === 'edit') {
      docsInOriginalKey.forEach((docSnap) => {
        if (!incomingIds.has(docSnap.id)) {
          operations.push((batch) => batch.delete(docSnap.ref));
        }
      });
    }

    for (const item of data.items) {
      const finalId =
        mode === 'edit' && item.id
          ? item.id
          : `po-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const docRef = adminDb.collection("purchaseOrders").doc(finalId);
      const existingData = existingMap.get(finalId) || {};
      const resolvedUnit = item.unitOfMeasure || item.unit || existingData.unitOfMeasure || 'kg';

      const payload: Record<string, any> = {
        ...existingData,
        id: finalId,
        orderNumber: cleanOrderNumber,
        orderDate: resolvedOrderDate,
        orderYear: targetOrderYear,
        supplierName: cleanSupplierName,
        materialCode: String(item.materialCode || '').trim(),
        quantity: Number(item.quantity),
        receivedQuantity: existingData.receivedQuantity || 0,
        unitOfMeasure: resolvedUnit,
        expectedDeliveryDate: item.expectedDeliveryDate,
        status: existingData.status || 'pending',
        createdAt: existingData.createdAt || admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };

      if (item.materialType !== undefined) {
        payload.materialType = item.materialType;
      }
      if (item.description !== undefined) {
        payload.description = item.description;
      }

      operations.push((batch) => batch.set(docRef, payload));
    }

    await commitBatchedOperations(operations);
    await bumpMrpSyncVersion('po', 'purchase-orders:savePurchaseOrder');
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Ordine salvato correttamente.' };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Errore durante il salvataggio.' };
  }
}

export async function deleteOrderGroup(orderNumber: string, orderYear: number, uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    try {
        const cleanOrderNumber = normalizeOrderNumber(orderNumber);
        const rawOrderNumber = String(orderNumber || '').trim();
        const targetYear =
          typeof orderYear === 'number' && Number.isFinite(orderYear) && orderYear > 2000
            ? Math.trunc(orderYear)
            : 2026;

        const queryNumbers = Array.from(
          new Set([cleanOrderNumber, rawOrderNumber, cleanOrderNumber.toLowerCase()].filter(Boolean))
        );
        if (queryNumbers.length === 0) {
          return { success: false, message: "Numero ordine mancante." };
        }

        const snap = await adminDb.collection("purchaseOrders").where("orderNumber", "in", queryNumbers).get();
        const docsToDelete = snap.docs.filter((docSnap) => {
          const d = docSnap.data();
          return (
            normalizeOrderNumber(d.orderNumber) === cleanOrderNumber &&
            resolvePurchaseOrderYear(d) === targetYear
          );
        });

        if (docsToDelete.length > 0) {
          await commitBatchedOperations(docsToDelete.map(d => (batch) => batch.delete(d.ref)));
          await bumpMrpSyncVersion('po', 'purchase-orders:deleteOrderGroup');
        }

        revalidatePath('/admin/purchase-orders');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Ordine ${cleanOrderNumber} (${targetYear}) eliminato.` };
    } catch (e) {
        return { success: false, message: "Errore durante l'eliminazione." };
    }
}

export async function deletePurchaseOrder(id: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  try {
    await adminDb.collection("purchaseOrders").doc(id).delete();
    await bumpMrpSyncVersion('po', 'purchase-orders:deletePurchaseOrder');
    revalidatePath('/admin/purchase-orders');
    return { success: true, message: 'Riga ordine eliminata.' };
  } catch (e) {
    return { success: false, message: 'Errore.' };
  }
}

export async function importPurchaseOrders(data: any[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);

    const existingSnap = await adminDb.collection("purchaseOrders").get();
    const seenKeys = new Set<string>();
    existingSnap.docs.forEach((docSnap) => {
      const d = docSnap.data();
      const num = normalizeOrderNumber(d.orderNumber);
      const year = resolvePurchaseOrderYear(d);
      const mat = String(d.materialCode || '').trim().toUpperCase();
      const qty = Number(d.quantity || 0);
      const parsedExp = parseImportDate(d.expectedDeliveryDate);
      const expKey = parsedExp ? parsedExp.toISOString().slice(0, 10) : String(d.expectedDeliveryDate || '').slice(0, 10);
      if (num && mat) {
        seenKeys.add(`${num}__${year}__${mat}__${qty}__${expKey}`);
      }
    });

    const today = new Date();
    const operations: Array<(batch: admin.firestore.WriteBatch) => void> = [];
    let added = 0;
    let skippedDuplicates = 0;

    for (const row of data) {
        const orderNumber = normalizeOrderNumber(
          row["N° Ordine"] ?? row["N. Ordine"] ?? row["OrderNumber"] ?? row["Ordine"] ?? row.orderNumber
        );
        const supplierName = String(row["Fornitore"] ?? row["Supplier"] ?? row.supplierName ?? "").trim();
        const materialCode = String(row["Codice Materiale"] ?? row["MaterialCode"] ?? row.materialCode ?? "").trim();
        const quantity = Number(row["Quantità"] ?? row["Quantity"] ?? row.quantity);
        const unit = String(row["Unità"] ?? row["UM"] ?? row.unitOfMeasure ?? "n").trim().toLowerCase();
        const rawDate = row["Data Consegna"] ?? row["ExpectedDeliveryDate"] ?? row.expectedDeliveryDate;
        const rawOrderDate = row["Data Ordine"] ?? row["OrderDate"] ?? row["Data Emissione"] ?? row.orderDate;

        if (!orderNumber || !materialCode || isNaN(quantity) || quantity <= 0) continue;

        let parsedOrderDate: Date;
        const hasRawOrderDate = rawOrderDate !== undefined && rawOrderDate !== null && String(rawOrderDate).trim() !== '';
        if (hasRawOrderDate) {
            const parsed = parseImportDate(rawOrderDate);
            if (!parsed) {
                return {
                    success: false,
                    message: `Data Ordine non valida per l'ordine ${orderNumber}: "${String(rawOrderDate)}".`,
                };
            }
            if (!isOrderDateValidNotFuture(parsed, today)) {
                return {
                    success: false,
                    message: `La Data Ordine per l'ordine ${orderNumber} non può essere nel futuro.`,
                };
            }
            parsedOrderDate = parsed;
        } else {
            parsedOrderDate = today;
        }

        const orderDate = parsedOrderDate.toISOString();
        const orderYear = parsedOrderDate.getFullYear();

        const parsedDelivery = parseImportDate(rawDate) ?? parsedOrderDate;
        const deliveryDate = parsedDelivery.toISOString();
        const dedupeKey = `${orderNumber}__${orderYear}__${materialCode.toUpperCase()}__${quantity}__${deliveryDate.slice(0, 10)}`;

        if (seenKeys.has(dedupeKey)) {
            skippedDuplicates++;
            continue;
        }
        seenKeys.add(dedupeKey);

        const newRef = adminDb.collection("purchaseOrders").doc();
        operations.push((batch) =>
          batch.set(newRef, {
            id: newRef.id,
            orderNumber,
            orderDate,
            orderYear,
            supplierName,
            materialCode,
            quantity,
            receivedQuantity: 0,
            unitOfMeasure: unit,
            expectedDeliveryDate: deliveryDate,
            status: 'pending',
            createdAt: admin.firestore.Timestamp.now(),
          })
        );
        added++;
    }

    if (added > 0) {
        await commitBatchedOperations(operations);
        await bumpMrpSyncVersion('po', 'purchase-orders:importPurchaseOrders');
    }
    revalidatePath('/admin/purchase-orders');
    revalidatePath('/admin/raw-material-management');
    const skippedNote = skippedDuplicates > 0 ? ` (${skippedDuplicates} duplicati ignorati)` : '';
    return { success: true, message: `Importate ${added} righe ordine fornitore${skippedNote}.` };
}
