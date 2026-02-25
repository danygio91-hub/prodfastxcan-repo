
'use server';

import { revalidatePath } from 'next/cache';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  writeBatch, 
  query as firestoreQuery, 
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
  InventoryRecord,
  Operator
} from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

export type LotSelectionPayload = { 
    materialId: string; 
    componentCode: string; 
    lotto: string; 
    consumed: number 
};

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
}

/**
 * Calcola il fabbisogno di materiale convertendolo nell'unità del magazzino (KG, MT o N).
 * Gestisce correttamente la lunghezza di taglio e i rapporti di conversione.
 */
function calculateCommitmentQty(jobQta: number, bomItem: any, material: RawMaterial | undefined): number {
    if (!material) return 0;
    
    const qta = Number(jobQta) || 0;
    const bomQty = Number(bomItem.quantity) || 0;
    const length = Number(bomItem.lunghezzaTaglioMm) || 0;
    
    let requirementInMetri = 0;
    let requirementInPezzi = 0;
    let requirementInKg = 0;

    // 1. Determiniamo la base del fabbisogno dalla BOM
    if (length > 0) {
        requirementInMetri = (qta * bomQty * length) / 1000;
    } else if (bomItem.unit === 'mt') {
        requirementInMetri = qta * bomQty;
    } else if (bomItem.unit === 'kg') {
        requirementInKg = qta * bomQty;
    } else {
        requirementInPezzi = qta * bomQty;
    }

    // 2. Convertiamo la base nell'unità gestita dal magazzino
    if (material.unitOfMeasure === 'kg') {
        if (requirementInKg > 0) return requirementInKg;
        
        // Se abbiamo metri, usiamo rapportoKgMt (prioritario) o conversionFactor
        if (requirementInMetri > 0) {
            const ratio = Number(material.rapportoKgMt) || Number(material.conversionFactor) || 0;
            return requirementInMetri * ratio;
        }
        
        // Se abbiamo pezzi, usiamo il conversionFactor
        const factor = Number(material.conversionFactor) || 0;
        return requirementInPezzi * factor;
    }
    
    if (material.unitOfMeasure === 'mt') {
        if (requirementInMetri > 0) return requirementInMetri;
        if (requirementInKg > 0 && material.rapportoKgMt) return requirementInKg / material.rapportoKgMt;
        return requirementInPezzi; // Fallback pezzi = metri se non specificato
    }
    
    // Default: Pezzi (N)
    return requirementInPezzi || requirementInMetri || requirementInKg;
}

export async function getDepartments(): Promise<Department[]> {
  const snapshot = await getDocs(collection(db, "departments"));
  return snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Department));
}

export async function getManualCommitments(): Promise<ManualCommitment[]> {
  const snapshot = await getDocs(firestoreQuery(collection(db, "manualCommitments"), orderBy("createdAt", "desc")));
  return snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as ManualCommitment);
}

export async function getRawMaterials(searchTerm?: string): Promise<RawMaterial[]> {
    const materialsCol = collection(db, 'rawMaterials');
    let snapshot;
    if (searchTerm === undefined) {
        snapshot = await getDocs(firestoreQuery(materialsCol, orderBy("code_normalized")));
    } else if (searchTerm && searchTerm.length >= 2) {
        const lower = searchTerm.toLowerCase().trim();
        snapshot = await getDocs(firestoreQuery(materialsCol, where('code_normalized', '>=', lower), where('code_normalized', '<=', lower + '\uf8ff'), limit(100)));
    } else { return []; }
    return snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id } as RawMaterial));
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

export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const materialId = rawData.materialId as string;
  const batchId = rawData.batchId as string;
  const materialRef = doc(db, "rawMaterials", materialId);

  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(materialRef);
      if (!docSnap.exists()) throw new Error('Materia prima non trovata per ID: ' + materialId);
      const material = docSnap.data() as RawMaterial;
      const batches = [...(material.batches || [])];
      const idx = batches.findIndex(b => b.id === batchId);
      if (idx === -1) throw new Error('Lotto non trovato per ID: ' + batchId);

      const old = batches[idx];
      const newQty = Number(rawData.netQuantity);
      let newWeight = material.unitOfMeasure === 'kg' ? newQty : (material.conversionFactor ? newQty * material.conversionFactor : 0);

      batches[idx] = { 
        ...old, 
        date: new Date(rawData.date as string).toISOString(), 
        ddt: (rawData.ddt as string) || old.ddt, 
        lotto: (rawData.lotto as string) || old.lotto, 
        netQuantity: newQty, 
        grossWeight: newWeight + (old.tareWeight || 0) 
      };
      
      const diffU = newQty - old.netQuantity;
      const diffW = newWeight - (old.grossWeight - (old.tareWeight || 0));

      transaction.update(materialRef, { 
        batches, 
        currentStockUnits: (material.currentStockUnits || 0) + diffU, 
        currentWeightKg: (material.currentWeightKg || 0) + diffW 
      });
    });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Lotto aggiornato con successo.' };
  } catch (e) { 
    return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'aggiornamento del lotto.' }; 
  }
}

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
  const rawData = Object.fromEntries(formData.entries());
  const materialId = rawData.materialId as string;
  const materialRef = doc(db, "rawMaterials", materialId);
  try {
      await runTransaction(db, async (transaction) => {
          const docSnap = await transaction.get(materialRef);
          if (!docSnap.exists()) throw new Error('Materia prima non trovata per ID: ' + materialId);
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
            lotto: (rawData.lotto as string) || null 
          };
          
          transaction.update(materialRef, { 
            batches: [...(material.batches || []), newBatch], 
            currentStockUnits: (material.currentStockUnits || 0) + netQty, 
            currentWeightKg: (material.currentWeightKg || 0) + netWeight 
          });
      });
      revalidatePath('/admin/raw-material-management');
      return { success: true, message: 'Lotto aggiunto con successo.' };
  } catch (error) { 
    return { success: false, message: error instanceof Error ? error.message : 'Errore durante l\'aggiunta del lotto.' }; 
  }
}

export async function deleteBatchFromRawMaterial(materialId: string, batchId: string): Promise<{ success: boolean; message: string; }> {
    const materialRef = doc(db, "rawMaterials", materialId);
    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists()) throw new Error("Materia prima non trovata per ID: " + materialId);
            const material = docSnap.data() as RawMaterial;
            const batch = (material.batches || []).find(b => b.id === batchId);
            if (!batch) throw new Error("Lotto non trovato per ID: " + batchId);
            
            transaction.update(materialRef, { 
                batches: material.batches.filter(b => b.id !== batchId), 
                currentStockUnits: (material.currentStockUnits || 0) - batch.netQuantity, 
                currentWeightKg: (material.currentWeightKg || 0) - (batch.grossWeight - batch.tareWeight) 
            });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto eliminato con successo.' };
    } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore durante l\'eliminazione del lotto.' }; 
    }
}

export async function deleteRawMaterial(id: string): Promise<{ success: boolean; message: string }> {
  await deleteDoc(doc(db, "rawMaterials", id));
  revalidatePath('/admin/raw-material-management');
  return { success: true, message: 'Materia prima eliminata.' };
}

export async function getMaterialWithdrawalsForMaterial(materialId: string): Promise<MaterialWithdrawal[]> {
  const q = firestoreQuery(collection(db, "materialWithdrawals"), where("materialId", "==", materialId));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
}

export type MaterialStatus = { id: string; code: string; description: string; stock: number; impegnato: number; disponibile: number; ordinato: number; unitOfMeasure: 'n' | 'mt' | 'kg'; };

export async function getMaterialsStatus(searchTerm?: string): Promise<MaterialStatus[]> {
    const materialsCol = collection(db, "rawMaterials");
    let mq;
    const lowerSearch = (searchTerm || '').toLowerCase().trim();
    
    if (lowerSearch.length >= 2) {
        mq = firestoreQuery(materialsCol, where("code_normalized", ">=", lowerSearch), where("code_normalized", "<=", lowerSearch + '\uf8ff'), limit(100));
    } else if (searchTerm !== undefined) { return []; }
    else { mq = firestoreQuery(materialsCol, orderBy("code_normalized"), limit(50)); }

    const [jobsSnap, materialsSnap, commitmentsSnap, articlesSnap, posSnap] = await Promise.all([
        getDocs(firestoreQuery(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(mq),
        getDocs(firestoreQuery(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'articles')),
        getDocs(firestoreQuery(collection(db, 'purchaseOrders'), where('status', 'in', ['pending', 'partially_received'])))
    ]);

    const allMaterialsSnap = await getDocs(collection(db, "rawMaterials"));
    const codeToMat = new Map<string, RawMaterial>();
    allMaterialsSnap.forEach(docSnap => {
        const data = docSnap.data() as RawMaterial;
        codeToMat.set(data.code.toLowerCase().trim(), { ...data, id: docSnap.id });
    });

    const articlesMap = new Map();
    articlesSnap.forEach(d => articlesMap.set(d.data().code.toLowerCase().trim(), d.data()));

    const impMap = new Map<string, number>();
    
    jobsSnap.forEach(d => {
        const job = d.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.status !== 'withdrawn') {
                const code = item.component.toLowerCase().trim();
                const mat = codeToMat.get(code);
                if (mat) {
                    const qty = calculateCommitmentQty(job.qta, item, mat);
                    impMap.set(code, (impMap.get(code) || 0) + qty);
                }
            }
        });
    });

    commitmentsSnap.forEach(d => {
        const comm = d.data() as ManualCommitment;
        const artCode = comm.articleCode.toLowerCase().trim();
        const art = articlesMap.get(artCode);
        if (art && art.billOfMaterials) {
            art.billOfMaterials.forEach((bomItem: any) => {
                const mCode = bomItem.component.toLowerCase().trim();
                const mat = codeToMat.get(mCode);
                if (mat) {
                    const qty = calculateCommitmentQty(comm.quantity, bomItem, mat);
                    impMap.set(mCode, (impMap.get(mCode) || 0) + qty);
                }
            });
        } else {
            const mat = codeToMat.get(artCode);
            if (mat) { 
                impMap.set(artCode, (impMap.get(artCode) || 0) + comm.quantity); 
            }
        }
    });

    const ordMap = new Map<string, number>();
    posSnap.forEach(doc => {
        const po = doc.data() as PurchaseOrder;
        const code = po.materialCode.toLowerCase().trim();
        const rem = po.quantity - (po.receivedQuantity || 0);
        if (rem > 0) ordMap.set(code, (ordMap.get(code) || 0) + rem);
    });

    return materialsSnap.docs.map(docSnap => {
        const m = { ...docSnap.data(), id: docSnap.id } as RawMaterial;
        const normCode = m.code.toLowerCase().trim();
        const stock = m.currentStockUnits || 0;
        const imp = impMap.get(normCode) || 0;
        const ord = ordMap.get(normCode) || 0;
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

export type CommitmentDetail = { jobId: string; type: 'PRODUZIONE' | 'MANUALE'; quantity: number; deliveryDate: string; client: string; articleCode: string; };

export async function getMaterialCommitmentDetails(materialCode: string): Promise<CommitmentDetail[]> {
    const norm = materialCode.toLowerCase().trim();
    const [jobsSnap, commitmentsSnap, articlesSnap, materialsSnap] = await Promise.all([
        getDocs(firestoreQuery(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended", "paused"]))),
        getDocs(firestoreQuery(collection(db, 'manualCommitments'), where('status', '==', 'pending'))),
        getDocs(collection(db, 'articles')),
        getDocs(firestoreQuery(collection(db, 'rawMaterials'), where('code_normalized', '==', norm)))
    ]);
    const mat = materialsSnap.docs[0]?.data() as RawMaterial;
    if (!mat) return [];
    
    const articlesMap = new Map();
    articlesSnap.forEach(d => articlesMap.set(d.data().code.toLowerCase().trim(), d.data()));
    
    const details: CommitmentDetail[] = [];
    jobsSnap.forEach(d => {
        const job = d.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.component.toLowerCase().trim() === norm && item.status !== 'withdrawn') {
                details.push({ 
                    jobId: job.ordinePF, 
                    type: 'PRODUZIONE', 
                    quantity: calculateCommitmentQty(job.qta, item, mat), 
                    deliveryDate: job.dataConsegnaFinale || 'N/D', 
                    client: job.cliente || 'N/D', 
                    articleCode: job.details 
                });
            }
        });
    });
    commitmentsSnap.forEach(d => {
        const comm = d.data() as ManualCommitment;
        const art = articlesMap.get(comm.articleCode.toLowerCase().trim());
        if (art && art.billOfMaterials) {
            art.billOfMaterials.forEach((bomItem: any) => {
                if (bomItem.component.toLowerCase().trim() === norm) {
                    details.push({ 
                        jobId: comm.jobOrderCode, 
                        type: 'MANUALE', 
                        quantity: calculateCommitmentQty(comm.quantity, bomItem, mat), 
                        deliveryDate: comm.deliveryDate || 'N/D', 
                        client: 'N/D', 
                        articleCode: comm.articleCode 
                    });
                }
            });
        } else if (comm.articleCode.toLowerCase().trim() === norm) {
            details.push({ 
                jobId: comm.jobOrderCode, 
                type: 'MANUALE', 
                quantity: comm.quantity, 
                deliveryDate: comm.deliveryDate || 'N/D', 
                client: 'N/D', 
                articleCode: comm.articleCode 
            });
        }
    });
    return details.sort((a, b) => (a.deliveryDate || '').localeCompare(b.deliveryDate || ''));
}

export async function searchMaterialsAndGetStatus(searchTerm: string) {
  const s = await getMaterialsStatus(searchTerm);
  const m = await getRawMaterials(searchTerm);
  const ids = new Set(s.map(item => item.id));
  return { materials: m.filter(item => ids.has(item.id)), status: s };
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await getDocs(firestoreQuery(collection(db, "scrapRecords"), where("materialId", "==", id), orderBy("declaredAt", "desc")));
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, declaredAt: doc.data().declaredAt.toDate().toISOString() } as ScrapRecord));
}

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
    const ref = doc(db, "materialWithdrawals", withdrawalId);
    try {
        await runTransaction(db, async (t) => {
            const wSnap = await t.get(ref);
            if (!wSnap.exists()) throw new Error("Prelievo non trovato.");
            const w = wSnap.data() as MaterialWithdrawal;
            
            const mRef = doc(db, "rawMaterials", w.materialId);
            const mSnap = await t.get(mRef);
            
            if (mSnap.exists()) {
                const m = mSnap.data() as RawMaterial;
                t.update(mRef, { 
                    currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight, 
                    currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0) 
                });
            }
            t.delete(ref);
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Prelievo stornato e stock ripristinato.' };
    } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : 'Errore durante lo storno.' }; 
    }
}

export async function declareCommitmentFulfillment(id: string, good: number, scrap: number, sels: LotSelectionPayload[], uid: string) {
  try {
    await ensureAdmin(uid);
    const opSnap = await getDoc(doc(db, "operators", uid));
    const opData = opSnap.exists() ? opSnap.data() as Operator : null;
    
    await runTransaction(db, async (t) => {
      // 1. ESECUZIONE TUTTE LE LETTURE ALL'INIZIO
      const cRef = doc(db, "manualCommitments", id);
      const cSnap = await t.get(cRef);
      if (!cSnap.exists()) throw new Error("Impegno manuale non trovato.");
      const c = cSnap.data() as ManualCommitment;

      const mRefs = sels.map(s => doc(db, "rawMaterials", s.materialId));
      const mSnaps = await Promise.all(mRefs.map(ref => t.get(ref)));
      const mDataMap = new Map(mSnaps.map(snap => [snap.id, snap.exists() ? snap.data() as RawMaterial : null]));

      // 2. ESECUZIONE TUTTE LE SCRITTURE DOPO LE LETTURE
      for (const s of sels) {
        const m = mDataMap.get(s.materialId);
        if (!m) throw new Error("Materia prima non trovata per ID: " + s.materialId);
        
        let w = m.unitOfMeasure === 'kg' ? s.consumed : (m.conversionFactor ? s.consumed * m.conversionFactor : 0);
        
        t.update(doc(db, "rawMaterials", s.materialId), { 
            currentStockUnits: (m.currentStockUnits || 0) - s.consumed, 
            currentWeightKg: (m.currentWeightKg || 0) - w 
        });
        
        const wRef = doc(collection(db, "materialWithdrawals"));
        t.set(wRef, { 
            jobOrderPFs: [c.jobOrderCode], 
            jobIds: [], 
            materialId: s.materialId, 
            materialCode: s.componentCode, 
            consumedWeight: w, 
            consumedUnits: s.consumed, 
            operatorId: uid, 
            operatorName: opData?.nome || 'Admin', 
            withdrawalDate: Timestamp.now(), 
            lotto: s.lotto, 
            commitmentId: id 
        });
      }
      
      if (scrap > 0) {
          t.set(doc(collection(db, "scrapRecords")), { 
              commitmentId: id, 
              jobOrderCode: c.jobOrderCode, 
              articleCode: c.articleCode, 
              scrappedQuantity: scrap, 
              declaredAt: Timestamp.now(), 
              operatorId: uid, 
              operatorName: opData?.nome || 'Admin' 
          });
      }
      
      t.update(cRef, { status: 'fulfilled', fulfilledAt: Timestamp.now(), fulfilledBy: uid });
    });
    
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: "Evasione registrata con successo." };
  } catch (e) { 
    return { success: false, message: e instanceof Error ? e.message : "Errore durante l'evasione." }; 
  }
}

export async function revertManualCommitmentFulfillment(id: string, uid: string) {
    await ensureAdmin(uid);
    try {
        const wq = firestoreQuery(collection(db, "materialWithdrawals"), where("commitmentId", "==", id));
        const sq = firestoreQuery(collection(db, "scrapRecords"), where("commitmentId", "==", id));
        const [ws, ss] = await Promise.all([getDocs(wq), getDocs(sq)]);

        await runTransaction(db, async (t) => {
            const mIds = [...new Set(ws.docs.map(d => d.data().materialId))].filter(Boolean);
            const mSnaps = await Promise.all(mIds.map(mid => t.get(doc(db, "rawMaterials", mid!))));
            const mMap = new Map(mSnaps.map(s => [s.id, s.exists() ? s.data() as RawMaterial : null]));

            for (const wd of ws.docs) {
                const w = wd.data() as MaterialWithdrawal;
                const m = mMap.get(w.materialId);
                if (m) {
                    t.update(doc(db, "rawMaterials", w.materialId), { 
                        currentStockUnits: (m.currentStockUnits || 0) + (w.consumedUnits || 0), 
                        currentWeightKg: (m.currentWeightKg || 0) + w.consumedWeight 
                    });
                }
                t.delete(wd.ref);
            }
            
            ss.forEach(d => t.delete(d.ref));
            t.update(doc(db, "manualCommitments", id), { status: 'pending', fulfilledAt: deleteField(), fulfilledBy: deleteField() });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Evasione annullata correttamente." };
    } catch (e) { 
      return { success: false, message: e instanceof Error ? e.message : "Errore nell'annullamento dell'evasione." }; 
    }
}

export async function saveManualCommitment(data: any, uid: string) {
    await ensureAdmin(uid);
    await setDoc(doc(collection(db, "manualCommitments")), { 
        ...data, 
        status: 'pending', 
        createdAt: Timestamp.now(), 
        deliveryDate: data.deliveryDate.toISOString() 
    });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Impegno manuale creato con successo.' };
}

export async function deleteManualCommitment(id: string) {
    await deleteDoc(doc(db, "manualCommitments", id));
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Impegno eliminato.' };
}

export async function importManualCommitments(data: any[], uid: string) {
    await ensureAdmin(uid);
    const batch = writeBatch(db);
    data.forEach(r => {
        batch.set(doc(collection(db, "manualCommitments")), { 
            jobOrderCode: String(r.Commessa || "").trim(), 
            articleCode: String(r["Codice Articolo"] || "").trim(), 
            quantity: Number(r.Quantita || 0), 
            deliveryDate: r["Data Consegna"] ? new Date(r["Data Consegna"]).toISOString() : new Date().toISOString(), 
            status: 'pending', 
            createdAt: Timestamp.now() 
        });
    });
    await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Importazione impegni completata.' };
}

export async function getMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
    const validCodes = codes.filter(c => c && typeof c === 'string').map(c => c.trim());
    if (validCodes.length === 0) return [];
    const snap = await getDocs(firestoreQuery(collection(db, "rawMaterials"), where("code", "in", validCodes)));
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
}

export type LotInfo = { lotto: string; available: number; batches: RawMaterialBatch[] };

export async function getLotInfoForMaterial(materialId: string): Promise<LotInfo[]> {
    const mSnap = await getDoc(doc(db, "rawMaterials", materialId));
    if (!mSnap.exists()) return [];
    const mat = mSnap.data() as RawMaterial;
    const wSnap = await getDocs(firestoreQuery(collection(db, "materialWithdrawals"), where("materialId", "==", materialId)));
    const wByLotto = wSnap.docs.reduce((acc, d) => { 
        const w = d.data(); 
        const l = w.lotto || 'SENZA_LOTTO'; 
        acc[l] = (acc[l] || 0) + (w.consumedUnits || 0); 
        return acc; 
    }, {} as Record<string, number>);
    const bByLotto = (mat.batches || []).reduce((acc, b) => { 
        const l = b.lotto || 'SENZA_LOTTO'; 
        if (!acc[l]) acc[l] = []; 
        acc[l].push(b); 
        return acc; 
    }, {} as Record<string, RawMaterialBatch[]>);
    
    return Object.entries(bByLotto).map(([lotto, batches]) => { 
        const tL = batches.reduce((s, b) => s + b.netQuantity, 0); 
        const tW = wByLotto[lotto] || 0; 
        return { lotto, available: tL - tW, batches }; 
    }).filter(l => l.available > 0.001);
}
