
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc, runTransaction, arrayUnion, limit, orderBy, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, RawMaterialType, MaterialWithdrawal, Department, ManualCommitment, Article, ScrapRecord, JobOrder, JobBillOfMaterialsItem, InventoryRecord, PurchaseOrder } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

/**
 * Helper to convert Firestore Timestamps to JS Dates
 */
function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

export async function getDepartments(): Promise<Department[]> {
  const col = collection(db, "departments");
  const snapshot = await getDocs(col);
  return snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Department));
}

export async function getManualCommitments(): Promise<ManualCommitment[]> {
  const col = collection(db, "manualCommitments");
  const q = query(col, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as ManualCommitment);
}

export async function getRawMaterials(searchTerm?: string): Promise<RawMaterial[]> {
    const materialsCol = collection(db, 'rawMaterials');
    let snapshot;
    if (searchTerm === undefined) {
        snapshot = await getDocs(query(materialsCol, orderBy("code_normalized")));
    } else if (searchTerm && searchTerm.length >= 2) {
        const lowercasedTerm = searchTerm.toLowerCase().trim();
        snapshot = await getDocs(query(materialsCol, where('code_normalized', '>=', lowercasedTerm), where('code_normalized', '<=', lowercasedTerm + '\uf8ff'), limit(50)));
    } else { return []; }
    return snapshot.docs.map(doc => {
        const data = doc.data() as RawMaterial;
        return { ...data, id: doc.id } as RawMaterial;
    });
}

export async function saveRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const id = rawData.id as string;
  const code = String(rawData.code).trim();
  const dataToSave = {
    code,
    code_normalized: code.toLowerCase(),
    type: rawData.type as RawMaterialType,
    description: rawData.description as string,
    unitOfMeasure: rawData.unitOfMeasure as any,
    conversionFactor: rawData.conversionFactor ? Number(rawData.conversionFactor) : null,
    rapportoKgMt: rawData.rapportoKgMt ? Number(rawData.rapportoKgMt) : null,
  };
  if (id) {
    await setDoc(doc(db, "rawMaterials", id), dataToSave, { merge: true });
  } else {
    const newRef = doc(collection(db, "rawMaterials"));
    await setDoc(newRef, { ...dataToSave, id: newRef.id, currentStockUnits: 0, currentWeightKg: 0, batches: [] });
  }
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Materia prima salvata.' };
}

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const materialRef = doc(db, "rawMaterials", rawData.materialId as string);
  try {
      await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) throw new Error('Materiale non trovato.');
          const material = docSnap.data() as RawMaterial;
          const netQty = Number(rawData.netQuantity);
          let netWeight = material.unitOfMeasure === 'kg' ? netQty : (material.conversionFactor ? netQty * material.conversionFactor : 0);
          const newBatch: RawMaterialBatch = {
            id: `batch-${Date.now()}`,
            date: new Date(rawData.date as string).toISOString(),
            ddt: (rawData.ddt as string) || 'CARICO_MANUALE',
            netQuantity: netQty,
            tareWeight: 0,
            grossWeight: netWeight,
            lotto: (rawData.lotto as string) || null,
          };
          transaction.update(materialRef, { 
              batches: [...(material.batches || []), newBatch],
              currentStockUnits: (material.currentStockUnits || 0) + netQty,
              currentWeightKg: (material.currentWeightKg || 0) + netWeight,
          });
      });
      revalidatePath('/admin/raw-material-management');
      return { success: true, message: 'Lotto aggiunto.' };
  } catch (error) { return { success: false, message: 'Errore durante il salvataggio.' }; }
}

export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
    const rawData = Object.fromEntries(formData.entries());
    const materialRef = doc(db, "rawMaterials", rawData.materialId as string);
    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) throw new Error('Materiale non trovato.');
            const material = docSnap.data() as RawMaterial;
            const batches = [...(material.batches || [])];
            const idx = batches.findIndex(b => b.id === rawData.batchId);
            if (idx === -1) throw new Error('Lotto non trovato.');
            const old = batches[idx];
            const netQty = Number(rawData.netQuantity);
            let netWeight = material.unitOfMeasure === 'kg' ? netQty : (material.conversionFactor ? netQty * material.conversionFactor : 0);
            batches[idx] = { ...old, ddt: rawData.ddt as string, lotto: rawData.lotto as string || null, date: new Date(rawData.date as string).toISOString(), netQuantity: netQty, grossWeight: netWeight };
            const unitDiff = netQty - old.netQuantity;
            const weightDiff = netWeight - old.grossWeight;
            transaction.update(materialRef, { batches, currentStockUnits: (material.currentStockUnits || 0) + unitDiff, currentWeightKg: (material.currentWeightKg || 0) + weightDiff });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto aggiornato.' };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function deleteBatchFromRawMaterial(materialId: string, batchId: string): Promise<{ success: boolean; message: string; }> {
    const materialRef = doc(db, "rawMaterials", materialId);
    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) throw new Error("Materiale non trovato.");
            const material = docSnap.data() as RawMaterial;
            const batchToDelete = (material.batches || []).find(b => b.id === batchId);
            if (!batchToDelete) throw new Error("Lotto non trovato.");
            transaction.update(materialRef, { 
                batches: material.batches.filter(b => b.id !== batchId),
                currentStockUnits: (material.currentStockUnits || 0) - batchToDelete.netQuantity,
                currentWeightKg: (material.currentWeightKg || 0) - batchToDelete.grossWeight,
            });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto eliminato.' };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function deleteRawMaterial(id: string): Promise<{ success: boolean; message: string }> {
  await deleteDoc(doc(db, "rawMaterials", id));
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Materia prima eliminata.' };
}

export async function commitImportedRawMaterials(data: any[]): Promise<{ success: boolean; message: string; }> {
    const batch = writeBatch(db);
    let added = 0;
    for (const row of data) {
        const newRef = doc(collection(db, "rawMaterials"));
        const code = String(row.code || row.Codice || "").trim();
        if (!code) continue;
        const uom = (row.unitOfMeasure || row.Unita || 'n').toLowerCase();
        const material = {
            id: newRef.id,
            code,
            code_normalized: code.toLowerCase(),
            type: (row.type || 'BOB') as RawMaterialType,
            description: row.description || row.Descrizione || "N/D",
            unitOfMeasure: uom as any,
            conversionFactor: row.conversionFactor ? Number(row.conversionFactor) : null,
            currentStockUnits: 0,
            currentWeightKg: 0,
            batches: [],
        };
        batch.set(newRef, material);
        added++;
    }
    if (added > 0) await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `${added} materie prime importate.` };
}

export async function getMaterialWithdrawalsForMaterial(materialId: string): Promise<MaterialWithdrawal[]> {
  const q = query(collection(db, "materialWithdrawals"), where("materialId", "==", materialId));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
}

export type MaterialStatus = { id: string; code: string; description: string; stock: number; impegnato: number; disponibile: number; ordinato: number; unitOfMeasure: 'n' | 'mt' | 'kg'; };

/**
 * CORE LOGIC: Recalculates stock and heals the database.
 * This version checks both field names for withdrawals to ensure no data is missed.
 */
export async function getMaterialsStatus(): Promise<MaterialStatus[]> {
    const [jobsSnap, materialsSnap, commitmentsSnap, withdrawalsSnap, articlesSnap, invSnap, posSnap] = await Promise.all([
        getDocs(query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(collection(db, "rawMaterials")),
        getDocs(query(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'materialWithdrawals')),
        getDocs(collection(db, 'articles')),
        getDocs(collection(db, 'inventoryRecords')),
        getDocs(query(collection(db, 'purchaseOrders'), where('status', 'in', ['pending', 'partially_received'])))
    ]);

    const inventoryMap = new Map();
    invSnap.forEach(doc => {
        if (doc.data().status === 'approved') inventoryMap.set(doc.id, doc.data());
    });

    const materialsMap = new Map<string, RawMaterial>();
    const codeToMaterial = new Map<string, RawMaterial>();
    
    const syncBatch = writeBatch(db);
    let syncNeeded = false;

    materialsSnap.forEach(docSnap => {
        const data = docSnap.data() as RawMaterial;
        const matId = docSnap.id;
        const mat = { ...data, id: matId };
        
        let matBatchesChanged = false;
        const restoredBatches = (mat.batches || []).map(batch => {
            if (batch.inventoryRecordId && inventoryMap.has(batch.inventoryRecordId)) {
                const originalInv = inventoryMap.get(batch.inventoryRecordId);
                const originalUnits = originalInv.inputUnit === 'kg' 
                    ? (mat.unitOfMeasure === 'kg' ? originalInv.netWeight : originalInv.netWeight / (mat.conversionFactor || 1)) 
                    : originalInv.inputQuantity;

                if (Math.abs(batch.netQuantity - originalUnits) > 0.001) {
                    matBatchesChanged = true;
                    return { ...batch, netQuantity: originalUnits, grossWeight: originalInv.grossWeight, tareWeight: originalInv.tareWeight };
                }
            }
            return batch;
        });

        if (matBatchesChanged) {
            mat.batches = restoredBatches;
            syncNeeded = true;
        }

        materialsMap.set(matId, mat);
        codeToMaterial.set(data.code.toLowerCase().trim(), mat);
    });

    const withdrawals = withdrawalsSnap.docs.map(d => {
        const data = d.data();
        return { 
            id: d.id, 
            materialId: data.materialId,
            consumedUnits: data.consumedUnits !== undefined ? data.consumedUnits : data.unitsConsumed,
            consumedWeight: data.consumedWeight
        };
    });

    materialsMap.forEach(material => {
        const totalLoadedUnits = (material.batches || []).reduce((sum, b) => sum + (Number(b.netQuantity) || 0), 0);
        const totalLoadedWeight = (material.batches || []).reduce((sum, b) => sum + (Number(b.grossWeight) || 0), 0);
        
        const matWithdrawals = withdrawals.filter(w => w.materialId === material.id);
        const totalWithdrawnUnits = matWithdrawals.reduce((sum, w) => sum + (Number(w.consumedUnits) || 0), 0);
        const totalWithdrawnWeight = matWithdrawals.reduce((sum, w) => sum + (Number(w.consumedWeight) || 0), 0);

        const realStockUnits = totalLoadedUnits - totalWithdrawnUnits;
        const realWeightKg = totalLoadedWeight - totalWithdrawnWeight;

        // Perform permanent fix if database total is out of sync with movements
        if (Math.abs((material.currentStockUnits || 0) - realStockUnits) > 0.001 || 
            Math.abs((material.currentWeightKg || 0) - realWeightKg) > 0.001 || syncNeeded) {
            
            syncBatch.update(doc(db, 'rawMaterials', material.id), { 
                currentStockUnits: realStockUnits, 
                currentWeightKg: realWeightKg,
                batches: material.batches
            });
            syncNeeded = true;
            material.currentStockUnits = realStockUnits;
            material.currentWeightKg = realWeightKg;
        }
    });

    if (syncNeeded) await syncBatch.commit();

    const articlesMap = new Map();
    articlesSnap.forEach(docSnap => articlesMap.set(docSnap.data().code.toLowerCase().trim(), docSnap.data()));

    const impegniMap = new Map<string, number>();
    jobsSnap.forEach(docSnap => {
        const job = docSnap.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.status !== 'withdrawn') {
                const code = item.component.toLowerCase().trim();
                const material = codeToMaterial.get(code);
                let qty = (item.lunghezzaTaglioMm && material?.unitOfMeasure === 'mt') ? (job.qta * item.quantity * item.lunghezzaTaglioMm / 1000) : job.qta * item.quantity;
                impegniMap.set(code, (impegniMap.get(code) || 0) + qty);
            }
        });
    });

    commitmentsSnap.forEach(docSnap => {
        const comm = docSnap.data() as ManualCommitment;
        const artCode = comm.articleCode.toLowerCase().trim();
        const art = articlesMap.get(artCode);
        if (art && art.billOfMaterials) {
            art.billOfMaterials.forEach((bomItem: any) => {
                const matCode = bomItem.component.toLowerCase().trim();
                const material = codeToMaterial.get(matCode);
                let qty = (bomItem.lunghezzaTaglioMm && material?.unitOfMeasure === 'mt') ? (comm.quantity * bomItem.quantity * bomItem.lunghezzaTaglioMm / 1000) : comm.quantity * bomItem.quantity;
                impegniMap.set(matCode, (impegniMap.get(matCode) || 0) + qty);
            });
        } else {
            impegniMap.set(artCode, (impegniMap.get(artCode) || 0) + comm.quantity);
        }
    });

    const ordersMap = new Map<string, number>();
    posSnap.forEach(doc => {
        const po = doc.data() as PurchaseOrder;
        const code = po.materialCode.toLowerCase().trim();
        ordersMap.set(code, (ordersMap.get(code) || 0) + po.quantity);
    });

    return Array.from(materialsMap.values()).map(m => {
        const stock = m.currentStockUnits || 0;
        const imp = impegniMap.get(m.code.toLowerCase().trim()) || 0;
        const ord = ordersMap.get(m.code.toLowerCase().trim()) || 0;
        return { id: m.id, code: m.code, description: m.description, stock, impegnato: imp, disponibile: stock - imp, ordinato: ord, unitOfMeasure: m.unitOfMeasure };
    }).sort((a, b) => a.code.localeCompare(b.code));
}

export async function searchMaterialsAndGetStatus(searchTerm: string) {
  const allStatus = await getMaterialsStatus();
  const lowerTerm = searchTerm.toLowerCase().trim();
  const filteredStatus = allStatus.filter(s => s.code.toLowerCase().includes(lowerTerm));
  const filteredIds = new Set(filteredStatus.map(s => s.id));
  const materials = await getRawMaterials();
  return { materials: materials.filter(m => filteredIds.has(m.id)), status: filteredStatus };
}

export async function saveManualCommitment(data: any, uid: string): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);
  const id = data.id;
  const docRef = id ? doc(db, "manualCommitments", id) : doc(collection(db, "manualCommitments"));
  const deliveryDate = data.deliveryDate instanceof Date ? data.deliveryDate.toISOString() : data.deliveryDate;
  const dataToSave = { ...data, deliveryDate, status: 'pending' };
  if (!id) { dataToSave.id = docRef.id; dataToSave.createdAt = Timestamp.now(); }
  await setDoc(docRef, dataToSave, { merge: true });
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Impegno salvato.' };
}

export async function deleteManualCommitment(id: string): Promise<{ success: boolean; message: string }> {
    try {
        await deleteDoc(doc(db, "manualCommitments", id));
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Impegno eliminato.' };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function importManualCommitments(data: any[], uid: string): Promise<{ success: boolean; message: string }> {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    let added = 0;
    for (const row of data) {
        const jobCode = String(row.Commessa || row.jobOrderCode || "").trim();
        const artCode = String(row["Codice Articolo"] || row.articleCode || "").trim();
        const qty = Number(row.Quantita || row.quantity);
        const dateRaw = row["Data Consegna"] || row.deliveryDate;
        if (!jobCode || !artCode || isNaN(qty)) continue;
        let deliveryDate = dateRaw instanceof Date ? dateRaw.toISOString() : (typeof dateRaw === 'number' ? new Date(new Date(Date.UTC(1899, 11, 30)).getTime() + dateRaw * 86400 * 1000).toISOString() : new Date().toISOString());
        const newRef = doc(collection(db, "manualCommitments"));
        batch.set(newRef, { id: newRef.id, jobOrderCode: jobCode, articleCode: artCode, quantity: qty, deliveryDate, status: 'pending', createdAt: Timestamp.now() });
        added++;
    }
    if (added > 0) await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `Importati ${added} impegni.` };
}

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
    try {
        await runTransaction(db, async (t) => {
            const wRef = doc(db, 'materialWithdrawals', withdrawalId);
            const wSnap = await t.get(wRef);
            if (!wSnap.exists()) throw new Error("Non trovato.");
            const w = wSnap.data() as MaterialWithdrawal;
            const mRef = doc(db, 'rawMaterials', w.materialId);
            const mSnap = await t.get(mRef);
            if (mSnap.exists()) {
                const mat = mSnap.data() as RawMaterial;
                const units = Number(w.consumedUnits !== undefined ? w.consumedUnits : (w as any).unitsConsumed);
                t.update(mRef, { currentStockUnits: (mat.currentStockUnits || 0) + units, currentWeightKg: (mat.currentWeightKg || 0) + Number(w.consumedWeight) });
            }
            t.delete(wRef);
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Eliminato." };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await getDocs(query(collection(db, "scrapRecords"), where("materialId", "==", id), orderBy("declaredAt", "desc")));
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, declaredAt: doc.data().declaredAt.toDate().toISOString() } as ScrapRecord));
}

export async function getMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
    if (!codes || codes.length === 0) return [];
    const normalizedCodes = codes.map(c => c.toLowerCase().trim());
    const q = query(collection(db, "rawMaterials"), where("code_normalized", "in", normalizedCodes));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
}

export type LotInfo = { lotto: string; available: number; totalLoaded: number; batches: RawMaterialBatch[]; };

export async function getLotInfoForMaterial(materialId: string): Promise<LotInfo[]> {
    const materialRef = doc(db, "rawMaterials", materialId);
    const materialSnap = await getDoc(materialRef);
    if (!materialSnap.exists()) return [];
    const material = materialSnap.data() as RawMaterial;
    const withdrawals = await getMaterialWithdrawalsForMaterial(materialId);
    const batchesByLot = (material.batches || []).reduce((acc, b) => { const lot = b.lotto || 'SENZA_LOTTO'; if (!acc[lot]) acc[lot] = []; acc[lot].push(b); return acc; }, {} as Record<string, RawMaterialBatch[]>);
    const lotWMap = withdrawals.reduce((acc, w) => { 
        const lot = w.lotto || 'SENZA_LOTTO'; 
        const units = Number(w.consumedUnits !== undefined ? w.consumedUnits : (w as any).unitsConsumed);
        acc[lot] = (acc[lot] || 0) + units; 
        return acc; 
    }, {} as Record<string, number>);
    return Object.entries(batchesByLot).map(([lotto, batches]) => { const total = batches.reduce((sum, b) => sum + (Number(b.netQuantity) || 0), 0); const used = lotWMap[lotto] || 0; return { lotto, totalLoaded: total, available: total - used, batches }; }).filter(l => l.available > 0.001);
}

export async function declareCommitmentFulfillment(commitmentId: string, goodPieces: number, scrapPieces: number, lotSelections: LotSelectionPayload[], uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await runTransaction(db, async (t) => {
            const cRef = doc(db, 'manualCommitments', commitmentId);
            const cSnap = await t.get(cRef);
            if (!cSnap.exists() || cSnap.data().status === 'fulfilled') throw new Error("Non trovato o già evaso.");
            const opSnap = await t.get(doc(db, 'operators', uid));
            const opName = opSnap.data()?.nome || 'Sconosciuto';
            for (const sel of lotSelections) {
                const mRef = doc(db, 'rawMaterials', sel.materialId);
                const mSnap = await t.get(mRef);
                const mat = mSnap.data() as RawMaterial;
                const weight = mat.conversionFactor ? sel.consumed * mat.conversionFactor : 0;
                t.update(mRef, { currentStockUnits: (mat.currentStockUnits || 0) - sel.consumed, currentWeightKg: (mat.currentWeightKg || 0) - weight });
                const wRef = doc(collection(db, 'materialWithdrawals'));
                t.set(wRef, { materialId: sel.materialId, materialCode: sel.componentCode, consumedWeight: weight, consumedUnits: sel.consumed, lotto: sel.lotto, operatorId: uid, operatorName: opName, withdrawalDate: Timestamp.now(), jobOrderPFs: [cSnap.data().jobOrderCode], commitmentId });
                if (scrapPieces > 0) {
                    const sw = mat.conversionFactor ? (scrapPieces * (sel.consumed / (goodPieces + scrapPieces)) * mat.conversionFactor) : 0;
                    t.set(doc(collection(db, 'scrapRecords')), { commitmentId, jobOrderCode: cSnap.data().jobOrderCode, articleCode: cSnap.data().articleCode, materialId: sel.materialId, materialCode: sel.componentCode, scrappedQuantity: scrapPieces, scrappedWeightKg: sw, declaredAt: Timestamp.now(), operatorId: uid, operatorName: opName });
                }
            }
            t.update(cRef, { status: 'fulfilled', fulfilledAt: Timestamp.now(), fulfilledBy: uid, producedQuantity: goodPieces, scrapQuantity: scrapPieces });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Evaso." };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function revertManualCommitmentFulfillment(commitmentId: string, uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await runTransaction(db, async (t) => {
            const cRef = doc(db, 'manualCommitments', commitmentId);
            const cSnap = await t.get(cRef);
            if (!cSnap.exists()) return;
            const ws = await getDocs(query(collection(db, 'materialWithdrawals'), where('commitmentId', '==', commitmentId)));
            for (const wDoc of ws.docs) {
                const w = wDoc.data();
                const mRef = doc(db, 'rawMaterials', w.materialId);
                const mSnap = await t.get(mRef);
                if (mSnap.exists()) {
                    const mat = mSnap.data() as RawMaterial;
                    const units = Number(w.consumedUnits !== undefined ? w.consumedUnits : (w as any).unitsConsumed);
                    t.update(mRef, { currentStockUnits: (mat.currentStockUnits || 0) + units, currentWeightKg: (mat.currentWeightKg || 0) + Number(w.consumedWeight || 0) });
                }
                t.delete(wDoc.ref);
            }
            const ss = await getDocs(query(collection(db, 'scrapRecords'), where('commitmentId', '==', commitmentId)));
            ss.forEach(s => t.delete(s.ref));
            t.update(cRef, { status: 'pending', fulfilledAt: deleteField(), fulfilledBy: deleteField(), producedQuantity: deleteField(), scrapQuantity: deleteField() });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Annullato." };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export type LotSelectionPayload = { materialId: string; componentCode: string; lotto: string; consumed: number; };
