
'use server';

import { revalidatePath } from 'next/cache';
import * as z from 'zod';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where, getDoc, runTransaction, arrayUnion, limit, orderBy, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RawMaterial, RawMaterialBatch, RawMaterialType, MaterialWithdrawal, Department, ManualCommitment, Article, ScrapRecord } from '@/lib/mock-data';
import { formatDisplayStock } from '@/lib/utils';
import { ensureAdmin } from '@/lib/server-auth';

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

export async function getRawMaterials(searchTerm?: string): Promise<RawMaterial[]> {
    const materialsCol = collection(db, 'rawMaterials');
    let snapshot;
    if (searchTerm === undefined) {
        snapshot = await getDocs(query(materialsCol, orderBy("code_normalized")));
    } else if (searchTerm && searchTerm.length >= 2) {
        const lowercasedTerm = searchTerm.toLowerCase();
        snapshot = await getDocs(query(materialsCol, where('code_normalized', '>=', lowercasedTerm), where('code_normalized', '<=', lowercasedTerm + '\uf8ff'), limit(50)));
    } else { return []; }
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as RawMaterial));
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
    details: { sezione: rawData.sezione, filo_el: rawData.filo_el, larghezza: rawData.larghezza, tipologia: rawData.tipologia },
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

export async function deleteSelectedRawMaterials(ids: string[]): Promise<{ success: boolean, message: string }> {
  const batch = writeBatch(db);
  ids.forEach(id => batch.delete(doc(db, 'rawMaterials', id)));
  await batch.commit();
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: `${ids.length} materie prime eliminate.` };
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
            details: { sezione: row.sezione || "", filo_el: row.filo_el || "", larghezza: row.larghezza || "", tipologia: row.tipologia || "" },
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

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
  const withdrawalRef = doc(db, "materialWithdrawals", withdrawalId);
  try {
    await runTransaction(db, async (transaction) => {
      const wSnap = await transaction.get(withdrawalRef);
      if (!wSnap.exists()) throw new Error("Scarico non trovato.");
      const withdrawal = wSnap.data() as MaterialWithdrawal;
      const mRef = doc(db, "rawMaterials", withdrawal.materialId);
      const mSnap = await transaction.get(mRef);
      if (mSnap.exists()) {
        const material = mSnap.data() as RawMaterial;
        const weightToRestore = withdrawal.consumedWeight || 0;
        const unitsToRestore = withdrawal.consumedUnits || (material.conversionFactor ? weightToRestore / material.conversionFactor : 0);
        transaction.update(mRef, {
          currentStockUnits: (material.currentStockUnits || 0) + unitsToRestore,
          currentWeightKg: (material.currentWeightKg || 0) + weightToRestore,
        });
      }
      transaction.delete(withdrawalRef);
    });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Scarico eliminato e stock ripristinato." };
  } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function getMaterialsStatus(): Promise<MaterialStatus[]> {
    const [jobsSnap, materialsSnap, commitmentsSnap, articlesSnap, withdrawalsSnap] = await Promise.all([
        getDocs(query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(collection(db, "rawMaterials")),
        getDocs(query(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'articles')),
        getDocs(collection(db, 'materialWithdrawals'))
    ]);

    const materialsMap = new Map<string, RawMaterial>();
    materialsSnap.forEach(doc => {
        const data = doc.data() as RawMaterial;
        materialsMap.set(data.code.toLowerCase(), { id: doc.id, ...data });
    });
    
    const withdrawals = withdrawalsSnap.docs.map(d => d.data() as MaterialWithdrawal);
    const syncBatch = writeBatch(db);
    let syncNeeded = false;

    materialsMap.forEach(material => {
        const totalLoadedUnits = (material.batches || []).reduce((sum, b) => sum + (b.netQuantity || 0), 0);
        const totalLoadedWeight = (material.batches || []).reduce((sum, b) => sum + (b.grossWeight || 0), 0);
        const matWithdrawals = withdrawals.filter(w => w.materialId === material.id);
        const totalWithdrawnUnits = matWithdrawals.reduce((sum, w) => sum + (w.consumedUnits || (material.conversionFactor ? w.consumedWeight / material.conversionFactor : 0)), 0);
        const totalWithdrawnWeight = matWithdrawals.reduce((sum, w) => sum + (w.consumedWeight || 0), 0);

        const realStockUnits = totalLoadedUnits - totalWithdrawnUnits;
        const realWeightKg = totalLoadedWeight - totalWithdrawnWeight;

        if (Math.abs((material.currentStockUnits || 0) - realStockUnits) > 0.001 || Math.abs((material.currentWeightKg || 0) - realWeightKg) > 0.001) {
            syncBatch.update(doc(db, 'rawMaterials', material.id), { currentStockUnits: realStockUnits, currentWeightKg: realWeightKg });
            syncNeeded = true;
            material.currentStockUnits = realStockUnits;
            material.currentWeightKg = realWeightKg;
        }
    });
    if (syncNeeded) await syncBatch.commit();

    const impegniMap = new Map<string, number>();
    const articlesMap = new Map(articlesSnap.docs.map(d => [d.data().code.toLowerCase(), d.data() as Article]));

    jobsSnap.forEach(docSnap => {
        const job = docSnap.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.status !== 'withdrawn') {
                const code = item.component.toLowerCase();
                const material = materialsMap.get(code);
                let qty = (item.lunghezzaTaglioMm && material?.unitOfMeasure === 'mt') ? (job.qta * item.quantity * item.lunghezzaTaglioMm / 1000) : job.qta * item.quantity;
                impegniMap.set(code, (impegniMap.get(code) || 0) + qty);
            }
        });
    });

    commitmentsSnap.forEach(docSnap => {
        const comm = docSnap.data() as ManualCommitment;
        const art = articlesMap.get(comm.articleCode.toLowerCase());
        art?.billOfMaterials.forEach(item => {
            const code = item.component.toLowerCase();
            const material = materialsMap.get(code);
            let qty = (item.lunghezzaTaglioMm && material?.unitOfMeasure === 'mt') ? (comm.quantity * item.quantity * item.lunghezzaTaglioMm / 1000) : comm.quantity * item.quantity;
            impegniMap.set(code, (impegniMap.get(code) || 0) + qty);
        });
    });

    return Array.from(materialsMap.values()).map(m => {
        const stock = m.currentStockUnits || 0;
        const imp = impegniMap.get(m.code.toLowerCase()) || 0;
        return { id: m.id, code: m.code, description: m.description, stock, impegnato: imp, disponibile: stock - imp, ordinato: 0, unitOfMeasure: m.unitOfMeasure };
    }).sort((a, b) => a.code.localeCompare(b.code));
}

export async function searchMaterialsAndGetStatus(searchTerm: string) {
  const materials = await getRawMaterials(searchTerm);
  if (materials.length === 0) return { materials: [], status: [] };
  const allStatus = await getMaterialsStatus();
  const ids = new Set(materials.map(m => m.id));
  return { materials, status: allStatus.filter(s => ids.has(s.id)) };
}

export async function getLotInfoForMaterial(materialId: string): Promise<LotInfo[]> {
    const mSnap = await getDoc(doc(db, 'rawMaterials', materialId));
    if (!mSnap.exists()) return [];
    const material = mSnap.data() as RawMaterial;
    const wSnap = await getDocs(query(collection(db, "materialWithdrawals"), where("materialId", "==", materialId)));
    const withdrawals = wSnap.docs.map(doc => convertTimestampsToDates(doc.data()) as MaterialWithdrawal);
    const withdrawalsByLotto = withdrawals.reduce((acc, w) => {
        const key = w.lotto || 'SENZA_LOTTO';
        acc[key] = (acc[key] || 0) + (w.consumedUnits || (material.conversionFactor ? w.consumedWeight / material.conversionFactor : 0));
        return acc;
    }, {} as Record<string, number>);
    const batchesByLotto = (material.batches || []).reduce((acc, b) => {
        const key = b.lotto || 'SENZA_LOTTO';
        if (!acc[key]) acc[key] = [];
        acc[key].push(b);
        return acc;
    }, {} as Record<string, RawMaterialBatch[]>);
    return Object.entries(batchesByLotto).map(([lotto, batches]) => {
        const loaded = batches.reduce((sum, b) => sum + (b.netQuantity || 0), 0);
        const withdrawn = withdrawalsByLotto[lotto] || 0;
        return { lotto, totalLoaded: loaded, totalWithdrawn: withdrawn, available: loaded - withdrawn, batches: batches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) };
    }).filter(l => l.available > 0.001);
}

export async function getManualCommitments(): Promise<ManualCommitment[]> {
  const snap = await getDocs(query(collection(db, "manualCommitments"), orderBy("createdAt", "desc")));
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, createdAt: doc.data().createdAt.toDate().toISOString(), deliveryDate: doc.data().deliveryDate }) as ManualCommitment);
}

export async function saveManualCommitment(values: any, uid: string): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);
  const docRef = values.id ? doc(db, "manualCommitments", values.id) : doc(collection(db, "manualCommitments"));
  const data = { ...values, deliveryDate: typeof values.deliveryDate === 'string' ? values.deliveryDate : values.deliveryDate.toISOString(), status: 'pending' };
  if (!values.id) { data.id = docRef.id; data.createdAt = Timestamp.now(); }
  await setDoc(docRef, data, { merge: true });
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Impegno salvato.' };
}

export async function deleteManualCommitment(id: string): Promise<{ success: boolean; message: string; }> {
  await deleteDoc(doc(db, "manualCommitments", id));
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: "Impegno eliminato." };
}

export async function declareCommitmentFulfillment(id: string, good: number, scrap: number, selections: any[], uid: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin(uid);
    const commitmentRef = doc(db, "manualCommitments", id);
    try {
        await runTransaction(db, async (transaction) => {
            const cSnap = await transaction.get(commitmentRef);
            if (!cSnap.exists() || cSnap.data().status !== 'pending') throw new Error("Impegno non valido.");
            const commitment = cSnap.data() as ManualCommitment;
            const opSnap = await transaction.get(doc(db, "operators", uid));
            const opName = opSnap.exists() ? opSnap.data().nome : 'Admin';
            for (const sel of selections) {
                const mRef = doc(db, 'rawMaterials', sel.materialId);
                const mSnap = await transaction.get(mRef);
                if (!mSnap.exists()) continue;
                const material = mSnap.data() as RawMaterial;
                const batches = [...(material.batches || [])];
                let rem = sel.consumed;
                const lotBatches = batches.filter(b => (b.lotto || '').toLowerCase() === (sel.lotto || '').toLowerCase()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                for (const b of lotBatches) {
                    if (rem <= 0.001) break;
                    const avail = b.netQuantity || 0;
                    if (avail <= 0) continue;
                    const cons = Math.min(rem, avail);
                    const bOrig = batches.find(orig => orig.id === b.id);
                    if (bOrig) {
                        bOrig.netQuantity -= cons;
                        let weightCons = material.unitOfMeasure === 'kg' ? cons : (material.conversionFactor ? cons * material.conversionFactor : 0);
                        bOrig.grossWeight = (bOrig.grossWeight || 0) - weightCons;
                    }
                    rem -= cons;
                }
                const weightConsumed = material.unitOfMeasure === 'kg' ? sel.consumed : (material.conversionFactor ? sel.consumed * material.conversionFactor : 0);
                transaction.update(mRef, { batches, currentStockUnits: (material.currentStockUnits || 0) - sel.consumed, currentWeightKg: (material.currentWeightKg || 0) - weightConsumed });
                const wRef = doc(collection(db, "materialWithdrawals"));
                transaction.set(wRef, { jobOrderPFs: [commitment.jobOrderCode], materialId: sel.materialId, materialCode: material.code, consumedWeight: weightConsumed, consumedUnits: sel.consumed, operatorId: uid, operatorName: opName, withdrawalDate: Timestamp.now(), lotto: sel.lotto || null, commitmentId: id });
            }
            if (scrap > 0) transaction.set(doc(collection(db, 'scrapRecords')), { commitmentId: id, jobOrderCode: commitment.jobOrderCode, articleCode: commitment.articleCode, scrappedQuantity: scrap, declaredAt: Timestamp.now(), operatorId: uid, operatorName: opName });
            transaction.update(commitmentRef, { status: 'fulfilled', fulfilledAt: Timestamp.now(), fulfilledBy: uid, declaredGoodPieces: good, declaredScrapPieces: scrap });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Dichiarazione registrata.` };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function revertManualCommitmentFulfillment(id: string, uid: string): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  const cSnap = await getDoc(doc(db, "manualCommitments", id));
  if (!cSnap.exists() || cSnap.data().status !== 'fulfilled') throw new Error("Impegno non evaso.");
  const wSnap = await getDocs(query(collection(db, "materialWithdrawals"), where("commitmentId", "==", id)));
  for (const docSnap of wSnap.docs) await deleteSingleWithdrawalAndRestoreStock(docSnap.id);
  await updateDoc(doc(db, "manualCommitments", id), { status: 'pending', fulfilledAt: deleteField(), fulfilledBy: deleteField(), declaredGoodPieces: deleteField(), declaredScrapPieces: deleteField() });
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: "Evasione annullata." };
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await getDocs(query(collection(db, "scrapRecords"), where("materialId", "==", id), orderBy("declaredAt", "desc")));
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, declaredAt: doc.data().declaredAt.toDate().toISOString() } as ScrapRecord));
}

export async function getMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
  if (!codes.length) return [];
  const q = query(collection(db, "rawMaterials"), where("code_normalized", "in", codes.map(c => c.toLowerCase())));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RawMaterial));
}

export async function getDepartments(): Promise<Department[]> {
  const snap = await getDocs(collection(db, "departments"));
  return snap.docs.map(d => d.data() as Department);
}
