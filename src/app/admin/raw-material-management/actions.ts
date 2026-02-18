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

export async function getMaterialsStatus(): Promise<MaterialStatus[]> {
    const [jobsSnap, materialsSnap, commitmentsSnap, withdrawalsSnap] = await Promise.all([
        getDocs(query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(collection(db, "rawMaterials")),
        getDocs(query(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'materialWithdrawals'))
    ]);

    const materialsMap = new Map<string, RawMaterial>();
    materialsSnap.forEach(doc => {
        const data = doc.data() as RawMaterial;
        materialsMap.set(data.code.toLowerCase(), { id: doc.id, ...data });
    });
    
    const withdrawals = withdrawalsSnap.docs.map(d => ({id: d.id, ...convertTimestampsToDates(d.data())}) as MaterialWithdrawal);
    const syncBatch = writeBatch(db);
    let syncNeeded = false;

    materialsMap.forEach(material => {
        const totalLoadedUnits = (material.batches || []).reduce((sum, b) => sum + (b.netQuantity || 0), 0);
        const totalLoadedWeight = (material.batches || []).reduce((sum, b) => sum + (b.grossWeight || 0), 0);
        
        const matWithdrawals = withdrawals.filter(w => w.materialId === material.id);
        const totalWithdrawnUnits = matWithdrawals.reduce((sum, w) => {
            if (w.consumedUnits !== undefined && w.consumedUnits !== null && w.consumedUnits !== 0) {
                return sum + w.consumedUnits;
            }
            if (material.unitOfMeasure === 'kg') return sum + w.consumedWeight;
            if (material.conversionFactor && material.conversionFactor > 0) {
                return sum + (w.consumedWeight / material.conversionFactor);
            }
            return sum;
        }, 0);
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
        // In un'app reale qui dovremmo recuperare l'articolo e la sua distinta base
        // Per semplicità qui simuliamo l'impegno se il codice articolo è una materia prima
        const code = comm.articleCode.toLowerCase();
        if (materialsMap.has(code)) {
            impegniMap.set(code, (impegniMap.get(code) || 0) + comm.quantity);
        }
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

export async function saveManualCommitment(data: any, uid: string): Promise<{ success: boolean; message: string; }> {
  await ensureAdmin(uid);
  const id = data.id;
  const docRef = id ? doc(db, "manualCommitments", id) : doc(collection(db, "manualCommitments"));
  
  const deliveryDate = data.deliveryDate instanceof Date 
    ? data.deliveryDate.toISOString() 
    : data.deliveryDate;

  const dataToSave = { 
    ...data, 
    deliveryDate,
    status: 'pending' 
  };
  
  if (!id) { 
    dataToSave.id = docRef.id; 
    dataToSave.createdAt = Timestamp.now(); 
  }
  
  await setDoc(docRef, dataToSave, { merge: true });
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Impegno salvato.' };
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await getDocs(query(collection(db, "scrapRecords"), where("materialId", "==", id), orderBy("declaredAt", "desc")));
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, declaredAt: doc.data().declaredAt.toDate().toISOString() } as ScrapRecord));
}

export type MaterialStatus = { id: string; code: string; description: string; stock: number; impegnato: number; disponibile: number; ordinato: number; unitOfMeasure: 'n' | 'mt' | 'kg'; };