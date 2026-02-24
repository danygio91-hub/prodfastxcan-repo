'use server';

import { revalidatePath } from 'next/cache';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  writeBatch, 
  query, 
  where, 
  getDoc, 
  runTransaction, 
  limit, 
  orderBy, 
  Timestamp, 
  deleteField 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { 
  RawMaterial, 
  RawMaterialBatch, 
  RawMaterialType, 
  MaterialWithdrawal, 
  Department, 
  ManualCommitment, 
  Article, 
  ScrapRecord, 
  JobOrder, 
  PurchaseOrder,
  InventoryRecord
} from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

export type LotSelectionPayload = { materialId: string; componentCode: string; lotto: string; consumed: number };

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

/**
 * Core calculation logic for committed quantities based on material and BOM units.
 */
function calculateCommitmentQty(jobQta: number, bomItem: any, material: RawMaterial | undefined): number {
    const totalBomUnits = jobQta * bomItem.quantity;
    
    if (!material) return totalBomUnits;

    // Case 1: Raw Material is managed in KG
    if (material.unitOfMeasure === 'kg') {
        // If BOM unit is Meters, use rapportoKgMt
        if (bomItem.unit === 'mt' && material.rapportoKgMt) {
            return totalBomUnits * material.rapportoKgMt;
        }
        // If BOM unit is Pieces (n), use conversionFactor (Kg/Piece)
        if (bomItem.unit === 'n' && material.conversionFactor) {
            return totalBomUnits * material.conversionFactor;
        }
        return totalBomUnits;
    }
    
    // Case 2: Raw Material is managed in MT
    if (material.unitOfMeasure === 'mt') {
        if (bomItem.lunghezzaTaglioMm && bomItem.lunghezzaTaglioMm > 0) {
            return totalBomUnits * (bomItem.lunghezzaTaglioMm / 1000);
        }
        return totalBomUnits;
    }
    
    // Case 3: Standard pieces or units match
    return totalBomUnits;
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
        snapshot = await getDocs(query(materialsCol, where('code_normalized', '>=', lowercasedTerm), where('code_normalized', '<=', lowercasedTerm + '\uf8ff'), limit(100)));
    } else { return []; }
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data() as RawMaterial;
        return { ...data, id: docSnap.id } as RawMaterial;
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
      revalidatePath('/admin/batch-management');
      return { success: true, message: 'Lotto aggiunto.' };
  } catch (error) { return { success: false, message: 'Errore durante il salvataggio.' }; }
}

export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const materialId = rawData.materialId as string;
  const batchId = rawData.batchId as string;
  const materialRef = doc(db, "rawMaterials", materialId);

  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(materialRef);
      if (!docSnap.exists()) throw new Error('Materiale non trovato.');
      const material = docSnap.data() as RawMaterial;
      const batches = [...(material.batches || [])];
      const batchIndex = batches.findIndex(b => b.id === batchId);
      if (batchIndex === -1) throw new Error('Lotto non trovato.');

      const oldBatch = batches[batchIndex];
      const newNetQty = Number(rawData.netQuantity);
      
      let newNetWeight: number;
      if (material.unitOfMeasure === 'kg') {
        newNetWeight = newNetQty;
      } else if (material.conversionFactor && material.conversionFactor > 0) {
        newNetWeight = newNetQty * material.conversionFactor;
      } else {
        newNetWeight = 0;
      }

      const updatedBatch: RawMaterialBatch = {
        ...oldBatch,
        date: new Date(rawData.date as string).toISOString(),
        ddt: (rawData.ddt as string) || oldBatch.ddt,
        lotto: (rawData.lotto as string) || oldBatch.lotto,
        netQuantity: newNetQty,
        grossWeight: newNetWeight + (oldBatch.tareWeight || 0),
      };

      batches[batchIndex] = updatedBatch;

      const diffUnits = newNetQty - oldBatch.netQuantity;
      const diffWeight = newNetWeight - (oldBatch.grossWeight - (oldBatch.tareWeight || 0));

      transaction.update(materialRef, {
        batches: batches,
        currentStockUnits: (material.currentStockUnits || 0) + diffUnits,
        currentWeightKg: (material.currentWeightKg || 0) + diffWeight,
      });
    });
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/batch-management');
    return { success: true, message: 'Lotto aggiornato con successo.' };
  } catch (error) {
    console.error("Error updating batch:", error);
    return { success: false, message: 'Errore durante l\'aggiornamento del lotto.' };
  }
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
        revalidatePath('/admin/batch-management');
        return { success: true, message: 'Lotto eliminato.' };
    } catch (e) { return { success: false, message: 'Errore.' }; }
}

export async function deleteRawMaterial(id: string): Promise<{ success: boolean; message: string }> {
  await deleteDoc(doc(db, "rawMaterials", id));
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Materia prima eliminata.' };
}

export async function getMaterialWithdrawalsForMaterial(materialId: string): Promise<MaterialWithdrawal[]> {
  const q = query(collection(db, "materialWithdrawals"), where("materialId", "==", materialId));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
}

export type MaterialStatus = { id: string; code: string; description: string; stock: number; impegnato: number; disponibile: number; ordinato: number; unitOfMeasure: 'n' | 'mt' | 'kg'; };

/**
 * Calculates stock status and performs auto-healing if discrepancies are found.
 */
export async function getMaterialsStatus(searchTerm?: string): Promise<MaterialStatus[]> {
    const materialsCol = collection(db, "rawMaterials");
    let materialsQuery;
    
    if (searchTerm && searchTerm.length >= 2) {
        const lower = searchTerm.toLowerCase().trim();
        materialsQuery = query(
            materialsCol, 
            where("code_normalized", ">=", lower),
            where("code_normalized", "<=", lower + '\uf8ff'),
            limit(100)
        );
    } else if (searchTerm !== undefined) {
        return [];
    } else {
        materialsQuery = query(materialsCol, orderBy("code_normalized"), limit(50));
    }

    const [jobsSnap, materialsSnap, commitmentsSnap, withdrawalsSnap, articlesSnap, invSnap, posSnap] = await Promise.all([
        getDocs(query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(materialsQuery),
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
        const mat = { ...data, id: docSnap.id };
        let matBatchesChanged = false;
        
        const restoredBatches = (mat.batches || []).map(batch => {
            if (batch.inventoryRecordId && inventoryMap.has(batch.inventoryRecordId)) {
                const originalInv = inventoryMap.get(batch.inventoryRecordId) as InventoryRecord;
                
                let originalUnits: number;
                if (originalInv.inputUnit === 'kg') {
                    originalUnits = (mat.unitOfMeasure === 'kg') ? originalInv.netWeight : originalInv.netWeight / (mat.conversionFactor || 1);
                } else {
                    originalUnits = originalInv.inputQuantity;
                }

                if (Math.abs(batch.netQuantity - originalUnits) > 0.001) {
                    matBatchesChanged = true;
                    return { ...batch, netQuantity: originalUnits, grossWeight: originalInv.grossWeight, tareWeight: originalInv.tareWeight };
                }
            }
            return batch;
        });
        
        if (matBatchesChanged) { mat.batches = restoredBatches; syncNeeded = true; }
        materialsMap.set(mat.id, mat);
        codeToMaterial.set(data.code.toLowerCase().trim(), mat);
    });

    const withdrawals = withdrawalsSnap.docs.map(d => {
        const data = d.data();
        return { 
            materialId: data.materialId,
            consumedUnits: data.consumedUnits !== undefined ? data.consumedUnits : (data.unitsConsumed || 0),
            consumedWeight: data.consumedWeight || 0
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

        if (Math.abs((material.currentStockUnits || 0) - realStockUnits) > 0.001 || Math.abs((material.currentWeightKg || 0) - realWeightKg) > 0.001 || syncNeeded) {
            syncBatch.update(doc(db, 'rawMaterials', material.id), { 
              currentStockUnits: realStockUnits, 
              currentWeightKg: realWeightKg, 
              batches: material.batches 
            });
            syncNeeded = true;
            material.currentStockUnits = realStockUnits;
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
                const qty = calculateCommitmentQty(job.qta, item, material);
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
                const qty = calculateCommitmentQty(comm.quantity, bomItem, material);
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
        const remaining = po.quantity - (po.receivedQuantity || 0);
        if (remaining > 0) ordersMap.set(code, (ordersMap.get(code) || 0) + remaining);
    });

    return Array.from(materialsMap.values()).map(m => {
        const stock = m.currentStockUnits || 0;
        const imp = impegniMap.get(m.code.toLowerCase().trim()) || 0;
        const ord = ordersMap.get(m.code.toLowerCase().trim()) || 0;
        return { 
          id: m.id, 
          code: m.code, 
          description: m.description, 
          stock, 
          impegnato: imp, 
          disponibile: stock - imp, 
          ordinato: ord, 
          unitOfMeasure: m.unitOfMeasure 
        };
    });
}

export type CommitmentDetail = { 
  jobId: string; 
  type: 'PRODUZIONE' | 'MANUALE'; 
  quantity: number; 
  deliveryDate: string; 
  client: string; 
  articleCode: string; 
};

export async function getMaterialCommitmentDetails(materialCode: string): Promise<CommitmentDetail[]> {
    const normCode = materialCode.toLowerCase().trim();
    const [jobsSnap, commitmentsSnap, articlesSnap, materialsSnap] = await Promise.all([
        getDocs(query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(query(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'articles')),
        getDocs(query(collection(db, 'rawMaterials'), where('code_normalized', '==', normCode)))
    ]);
    const material = materialsSnap.docs[0]?.data() as RawMaterial;
    if (!material) return [];
    
    const articlesMap = new Map();
    articlesSnap.forEach(doc => articlesMap.set(doc.data().code.toLowerCase().trim(), doc.data()));
    
    const details: CommitmentDetail[] = [];
    jobsSnap.forEach(docSnap => {
        const job = docSnap.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.component.toLowerCase().trim() === normCode && item.status !== 'withdrawn') {
                const qty = calculateCommitmentQty(job.qta, item, material);
                details.push({ jobId: job.ordinePF, type: 'PRODUZIONE', quantity: qty, deliveryDate: job.dataConsegnaFinale || 'N/D', client: job.cliente || 'N/D', articleCode: job.details });
            }
        });
    });
    commitmentsSnap.forEach(docSnap => {
        const comm = docSnap.data() as ManualCommitment;
        const artCode = comm.articleCode.toLowerCase().trim();
        const art = articlesMap.get(artCode);
        if (art && art.billOfMaterials) {
            art.billOfMaterials.forEach((bomItem: any) => {
                if (bomItem.component.toLowerCase().trim() === normCode) {
                    const qty = calculateCommitmentQty(comm.quantity, bomItem, material);
                    details.push({ jobId: comm.jobOrderCode, type: 'MANUALE', quantity: qty, deliveryDate: comm.deliveryDate || 'N/D', client: 'N/D (Impegno Manuale)', articleCode: comm.articleCode });
                }
            });
        } else if (artCode === normCode) {
            details.push({ jobId: comm.jobOrderCode, type: 'MANUALE', quantity: comm.quantity, deliveryDate: comm.deliveryDate || 'N/D', client: 'N/D (Impegno Manuale)', articleCode: comm.articleCode });
        }
    });
    return details.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
}

export async function searchMaterialsAndGetStatus(searchTerm: string) {
  const filteredStatus = await getMaterialsStatus(searchTerm);
  const materials = await getRawMaterials(searchTerm);
  const filteredIds = new Set(filteredStatus.map(s => s.id));
  return { 
    materials: materials.filter(m => filteredIds.has(m.id)), 
    status: filteredStatus 
  };
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await getDocs(query(collection(db, "scrapRecords"), where("materialId", "==", id), orderBy("declaredAt", "desc")));
    return snap.docs.map(doc => ({ 
      ...doc.data(), 
      id: doc.id, 
      declaredAt: doc.data().declaredAt.toDate().toISOString() 
    } as ScrapRecord));
}

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
    const withdrawalRef = doc(db, "materialWithdrawals", withdrawalId);
    try {
        await runTransaction(db, async (transaction) => {
            const wSnap = await transaction.get(withdrawalRef);
            if (!wSnap.exists()) throw new Error("Prelievo non trovato.");
            const w = wSnap.data() as MaterialWithdrawal;
            
            const mRef = doc(db, "rawMaterials", w.materialId);
            const mSnap = await transaction.get(mRef);
            if (mSnap.exists()) {
                const m = mSnap.data() as RawMaterial;
                transaction.update(mRef, {
                    currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight,
                    currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0)
                });
            }
            transaction.delete(withdrawalRef);
        });
        revalidatePath('/admin/raw-material-management');
        revalidatePath('/admin/batch-management');
        return { success: true, message: 'Stornato con successo.' };
    } catch (e) { return { success: false, message: 'Errore durante lo storno.' }; }
}

export async function declareCommitmentFulfillment(
  commitmentId: string,
  goodPieces: number,
  scrapPieces: number,
  lotSelections: LotSelectionPayload[],
  uid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const opSnap = await getDoc(doc(db, "operators", uid));
    const operatorName = opSnap.exists() ? opSnap.data().nome : "Admin";

    await runTransaction(db, async (transaction) => {
      const commitmentRef = doc(db, "manualCommitments", commitmentId);
      const cSnap = await transaction.get(commitmentRef);
      if (!cSnap.exists()) throw new Error("Impegno non trovato.");
      
      const comm = cSnap.data() as ManualCommitment;

      for (const sel of lotSelections) {
        const mRef = doc(db, "rawMaterials", sel.materialId);
        const mSnap = await transaction.get(mRef);
        if (!mSnap.exists()) continue;
        const mat = mSnap.data() as RawMaterial;

        let weightConsumed = 0;
        if (mat.unitOfMeasure === 'kg') weightConsumed = sel.consumed;
        else if (mat.conversionFactor) weightConsumed = sel.consumed * mat.conversionFactor;

        transaction.update(mRef, {
          currentStockUnits: (mat.currentStockUnits || 0) - sel.consumed,
          currentWeightKg: (mat.currentWeightKg || 0) - weightConsumed
        });

        const wRef = doc(collection(db, "materialWithdrawals"));
        transaction.set(wRef, {
          jobOrderPFs: [comm.jobOrderCode],
          jobIds: [],
          materialId: sel.materialId,
          materialCode: sel.componentCode,
          consumedWeight: weightConsumed,
          consumedUnits: sel.consumed,
          operatorId: uid,
          operatorName,
          withdrawalDate: Timestamp.now(),
          lotto: sel.lotto,
          commitmentId: commitmentId
        });
      }

      if (scrapPieces > 0) {
        const scrapRef = doc(collection(db, "scrapRecords"));
        transaction.set(scrapRef, {
          commitmentId,
          jobOrderCode: comm.jobOrderCode,
          articleCode: comm.articleCode,
          scrappedQuantity: scrapPieces,
          declaredAt: Timestamp.now(),
          operatorId: uid,
          operatorName
        });
      }

      transaction.update(commitmentRef, { status: 'fulfilled', fulfilledAt: Timestamp.now(), fulfilledBy: uid });
    });

    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Produzione dichiarata e stock scaricato." };
  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function revertManualCommitmentFulfillment(commitmentId: string, uid: string) {
    await ensureAdmin(uid);
    try {
        await runTransaction(db, async (transaction) => {
            const cRef = doc(db, "manualCommitments", commitmentId);
            const cSnap = await transaction.get(cRef);
            if (!cSnap.exists()) return;

            const wQuery = query(collection(db, "materialWithdrawals"), where("commitmentId", "==", commitmentId));
            const wSnap = await getDocs(wQuery);
            
            for (const wDoc of wSnap.docs) {
                const w = wDoc.data() as MaterialWithdrawal;
                const mRef = doc(db, "rawMaterials", w.materialId);
                const mSnap = await transaction.get(mRef);
                if (mSnap.exists()) {
                    const m = mSnap.data() as RawMaterial;
                    transaction.update(mRef, {
                        currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0),
                        currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight
                    });
                }
                transaction.delete(wDoc.ref);
            }

            const sQuery = query(collection(db, "scrapRecords"), where("commitmentId", "==", commitmentId));
            const sSnap = await getDocs(sQuery);
            sSnap.forEach(d => transaction.delete(d.ref));

            transaction.update(cRef, { status: 'pending', fulfilledAt: deleteField(), fulfilledBy: deleteField() });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Annullato." };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function saveManualCommitment(data: any, uid: string) {
    await ensureAdmin(uid);
    const newRef = doc(collection(db, "manualCommitments"));
    await setDoc(newRef, { ...data, status: 'pending', createdAt: Timestamp.now(), deliveryDate: data.deliveryDate.toISOString() });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Impegno creato.' };
}

export async function deleteManualCommitment(id: string) {
    await deleteDoc(doc(db, "manualCommitments", id));
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Eliminato.' };
}

export async function importManualCommitments(data: any[], uid: string) {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    data.forEach(row => {
        const ref = doc(collection(db, "manualCommitments"));
        batch.set(ref, { 
            jobOrderCode: String(row.Commessa || ""), 
            articleCode: String(row["Codice Articolo"] || ""), 
            quantity: Number(row.Quantita || 0), 
            deliveryDate: row["Data Consegna"] ? new Date(row["Data Consegna"]).toISOString() : new Date().toISOString(),
            status: 'pending',
            createdAt: Timestamp.now()
        });
    });
    await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Importati.' };
}

export async function getMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
    if (!codes.length) return [];
    const q = query(collection(db, "rawMaterials"), where("code", "in", codes));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
}

export type LotInfo = { lotto: string; available: number; batches: RawMaterialBatch[] };

export async function getLotInfoForMaterial(materialId: string): Promise<LotInfo[]> {
    const mSnap = await getDoc(doc(db, "rawMaterials", materialId));
    if (!mSnap.exists()) return [];
    const mat = mSnap.data() as RawMaterial;
    
    const wSnap = await getDocs(query(collection(db, "materialWithdrawals"), where("materialId", "==", materialId)));
    const withdrawalsByLotto = wSnap.docs.reduce((acc, d) => {
        const w = d.data();
        const l = w.lotto || 'SENZA_LOTTO';
        acc[l] = (acc[l] || 0) + (w.consumedUnits || 0);
        return acc;
    }, {} as Record<string, number>);

    const batchesByLotto = (mat.batches || []).reduce((acc, b) => {
        const l = b.lotto || 'SENZA_LOTTO';
        if (!acc[l]) acc[l] = [];
        acc[l].push(b);
        return acc;
    }, {} as Record<string, RawMaterialBatch[]>);

    return Object.entries(batchesByLotto).map(([lotto, batches]) => {
        const totalLoaded = batches.reduce((s, b) => s + b.netQuantity, 0);
        const totalWithdrawn = withdrawalsByLotto[lotto] || 0;
        return { lotto, available: totalLoaded - totalWithdrawn, batches };
    }).filter(l => l.available > 0.001);
}
