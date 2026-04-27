'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';
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
} from '@/types';
import { ensureAdmin } from '@/lib/server-auth';
import { getGlobalSettings } from '@/lib/settings-actions';
import { calculateBOMRequirement, calculateInventoryMovement } from '@/lib/inventory-utils';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import { fetchInChunks } from '@/lib/firestore-utils';

export async function bulkUpdateRawMaterials(items: any[], uid: string): Promise<{ success: boolean; message: string }> {
    try {
        await ensureAdmin(uid);
        const globalSettings = await getGlobalSettings();
        
        const batch = adminDb.batch();
        
        // Prima recuperiamo tutti i materiali esistenti per capire se fare UPDATE o CREATE
        const codes = items.map(it => String(it.CODICE || it.Codice || it.codice || "").trim()).filter(Boolean);
        if (codes.length === 0) return { success: false, message: "Nessun codice valido trovato nel file." };

        const materialsCol = adminDb.collection("rawMaterials");
        const existingDocs = await materialsCol.get();
        const existingMap = new Map();
        existingDocs.forEach(doc => {
            const data = doc.data();
            existingMap.set(data.code.toLowerCase().trim(), { id: doc.id, ...data });
        });

        for (const item of items) {
            const code = String(item.CODICE || item.Codice || item.codice || "").trim().toUpperCase();
            if (!code) continue;
            
            const code_normalized = code.toLowerCase();
            const uom = String(item.UOM || item.uom || "").toLowerCase().trim();
            const ratioVal = item['RAPPORTO KG/MT'] || item['Rapporto KG/MT'] || item['KG/MT'] || item['KG/PZ'];
            const ratio = Number(ratioVal || 0);

            // Mapping del Tipo (Labels -> ID)
            const excelTipo = String(item.TIPO || item.Tipo || item.tipo || "").trim().toUpperCase();
            let matchedTypeId = excelTipo; // Fallback al valore inserito
            
            if (excelTipo) {
                // Cerchiamo prima corrispondenza esatta con ID, poi per Label
                const foundById = globalSettings.rawMaterialTypes.find(t => t.id.toUpperCase() === excelTipo);
                if (foundById) {
                    matchedTypeId = foundById.id;
                } else {
                    const foundByLabel = globalSettings.rawMaterialTypes.find(t => t.label.toUpperCase() === excelTipo);
                    if (foundByLabel) matchedTypeId = foundByLabel.id;
                }
            }

            const dataToSave: any = {
                code,
                code_normalized,
                description: String(item.DESCRIZIONE || item.Descrizione || item.descrizione || "").trim(),
                type: matchedTypeId,
                unitOfMeasure: uom as any,
            };

            // Salviamo il rapporto se fornito (anche se non è MT/N, lo salviamo comunque per consistenza)
            if (ratioVal !== undefined) {
                dataToSave.rapportoKgMt = ratio;
                dataToSave.conversionFactor = ratio;
            }

            const existing = existingMap.get(code_normalized);
            if (existing) {
                // Per un aggiornamento, filtriamo i campi null/undefined per non cancellare dati esistenti se non forniti nell'Excel
                const cleanData: any = {};
                if (dataToSave.description) cleanData.description = dataToSave.description;
                if (dataToSave.type) cleanData.type = dataToSave.type;
                if (dataToSave.unitOfMeasure) cleanData.unitOfMeasure = dataToSave.unitOfMeasure;
                if (ratioVal !== undefined) {
                    cleanData.rapportoKgMt = ratio;
                    cleanData.conversionFactor = ratio;
                }
                batch.set(materialsCol.doc(existing.id), cleanData, { merge: true });
            } else {
                const newRef = materialsCol.doc();
                batch.set(newRef, {
                    ...dataToSave,
                    id: newRef.id,
                    currentStockUnits: 0,
                    currentWeightKg: 0,
                    batches: []
                });
            }
        }

        await batch.commit();
        
        // --- RECALCULATION TRIGGER ---
        const uniqueMaterialIds = [...new Set(existingMap.values())].map(m => m.id);
        for (const mid of uniqueMaterialIds) { await recalculateMaterialStock(mid); }
        // -----------------------------

        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Importati/Aggiornati ${items.length} elementi.` };
    } catch (error) {
        console.error("Bulk update error:", error);
        return { success: false, message: "Errore durante l'importazione massiva." };
    }
}

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

// Removed local calculateCommitmentQty in favor of centralized calculateBOMRequirement from inventory-utils.ts

export async function getDepartments(): Promise<Department[]> {
    const snapshot = await adminDb.collection("departments").get();
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Department));
}

export async function getManualCommitments(): Promise<ManualCommitment[]> {
    const snapshot = await adminDb.collection("manualCommitments").orderBy("createdAt", "desc").get();
    return snapshot.docs.map(d => convertTimestampsToDates({ id: d.id, ...d.data() }) as ManualCommitment);
}

export async function getRawMaterials(searchTerm?: string, lastCode?: string): Promise<RawMaterial[]> {
    const materialsCol = adminDb.collection('rawMaterials');
    let snapshot;
    if (searchTerm === undefined || searchTerm.trim() === '') {
        let q = materialsCol.orderBy("code_normalized").limit(50);
        if (lastCode) {
            q = q.startAfter(lastCode.toLowerCase().trim());
        }
        snapshot = await q.get();
    } else if (searchTerm && searchTerm.length >= 2) {
        const lower = searchTerm.toLowerCase().trim();
        snapshot = await materialsCol.where('code_normalized', '>=', lower).where('code_normalized', '<=', lower + '\uf8ff').limit(100).get();
    } else { return []; }
    return snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id } as RawMaterial));
}

export async function saveRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin();
    const rawData = Object.fromEntries(formData.entries());
    const id = rawData.id as string;
    const code = String(rawData.code).trim().toUpperCase();
    const code_normalized = code.toLowerCase();

    // CONVALIDA DUPLICATI
    if (!id) {
        const snap = await adminDb.collection("rawMaterials").where("code_normalized", "==", code_normalized).get();
        if (!snap.empty) {
            return { success: false, message: `Codice Articolo '${code}' già presente in anagrafica.` };
        }
    }

    const dataToSave = {
        code,
        code_normalized,
        type: rawData.type as RawMaterialType,
        description: rawData.description as string,
        unitOfMeasure: rawData.unitOfMeasure as any,
        conversionFactor: rawData.conversionFactor ? Number(rawData.conversionFactor) : null,
        rapportoKgMt: rawData.rapportoKgMt ? Number(rawData.rapportoKgMt) : null,
        minStockLevel: rawData.minStockLevel ? Number(rawData.minStockLevel) : null,
        reorderLot: rawData.reorderLot ? Number(rawData.reorderLot) : null,
        leadTimeDays: rawData.leadTimeDays ? Number(rawData.leadTimeDays) : null,
    };

    if (id) {
        await adminDb.collection("rawMaterials").doc(id).set(dataToSave, { merge: true });
    } else {
        const newRef = adminDb.collection("rawMaterials").doc();
        await newRef.set({ ...dataToSave, id: newRef.id, currentStockUnits: 0, currentWeightKg: 0, batches: [] });
    }
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima salvata.' };
}

export async function updateBatchInRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin();
    const rawData = Object.fromEntries(formData.entries());
    const materialId = rawData.materialId as string;
    const batchId = rawData.batchId as string;
    const materialRef = adminDb.collection("rawMaterials").doc(materialId);
    const globalSettings = await getGlobalSettings();
    try {
        await adminDb.runTransaction(async (transaction) => {
            const [docSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
            ]);
            
            if (!docSnap.exists) throw new Error('Materia prima non trovata.');
            const material = docSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
            
            const batches = [...(material.batches || [])];
            const idx = batches.findIndex(b => b.id === batchId);
            if (idx === -1) throw new Error('Lotto non trovato.');
            const old = batches[idx];
            const newQty = Number(rawData.netQuantity);
            const newGross = Number(rawData.grossWeight || 0);
            const newTare = Number(rawData.tareWeight || 0);
            const tareName = (rawData.tareName as string) || 'N/D';
            
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            // Use centralized logic to determine impact
            // Note: In admin modification, we assume input is in KG if it matches the UOM or if it's the weight field.
            // But for absolute consistency, we derive everything from the central utility.
            const { unitsToChange: finalUnits, weightToChange: finalNetWeightKg } = calculateInventoryMovement(
                material,
                config,
                newQty,
                material.unitOfMeasure as any, // In Admin Form, Qty is always in Base UOM
                true // isAddition (to calculate equivalent weight)
            );
            
            // However, the user directive for "KG = KG" and "Lordo = Netto + Tara" is paramount.
            // If the user manually edited Gross/Tare, the Netto (KG) is Gross - Tare.
            const weightFromGross = (newGross > 0) ? (newGross - newTare) : finalNetWeightKg;

            batches[idx] = { 
                ...old, 
                date: new Date(rawData.date as string).toISOString(), 
                ddt: (rawData.ddt as string) || old.ddt, 
                lotto: (rawData.lotto as string) || old.lotto, 
                netQuantity: finalUnits, 
                grossWeight: newGross > 0 ? newGross : (weightFromGross + newTare),
                tareWeight: newTare,
                tareName: tareName,
                packagingId: (rawData.packagingId as string) || old.packagingId
            };

            const diffU = finalUnits - old.netQuantity;
            const oldNetWeight = (old.grossWeight || 0) - (old.tareWeight || 0);
            const diffW = weightFromGross - oldNetWeight;

            transaction.update(materialRef, { 
                batches, 
                stock: admin.firestore.FieldValue.increment(diffU),
                currentStockUnits: admin.firestore.FieldValue.increment(diffU),
                currentWeightKg: admin.firestore.FieldValue.increment(diffW)
            });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto aggiornato.' };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function addBatchToRawMaterial(formData: FormData): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin();
    const rawData = Object.fromEntries(formData.entries());
    const materialId = rawData.materialId as string;
    const materialRef = adminDb.collection("rawMaterials").doc(materialId);
    const globalSettings = await getGlobalSettings();
    try {
        await adminDb.runTransaction(async (transaction) => {
            const [docSnap, withdrawalsSnap] = await Promise.all([
                transaction.get(materialRef),
                adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
            ]);
            
            if (!docSnap.exists) throw new Error('Non trovata.');
            const material = docSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
            const netQty = Number(rawData.netQuantity);
            const grossWeight = Number(rawData.grossWeight || 0);
            const tareWeight = Number(rawData.tareWeight || 0);
            const tareName = (rawData.tareName as string) || 'N/D';
            
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            const { unitsToChange: finalUnits, weightToChange: finalNetWeightKg } = calculateInventoryMovement(
                material,
                config,
                netQty,
                material.unitOfMeasure as any,
                true // isAddition
            );

            // Sacred rules: Lordo = Netto + Tara. Netto (KG) = Gross - Tare if provided.
            const weightFromGross = (grossWeight > 0) ? (grossWeight - tareWeight) : finalNetWeightKg;
            
            const newBatch: RawMaterialBatch = { 
                id: `batch-${Date.now()}`, 
                date: new Date(rawData.date as string).toISOString(), 
                ddt: (rawData.ddt as string) || 'CARICO', 
                netQuantity: finalUnits, 
                tareWeight: tareWeight, 
                grossWeight: grossWeight > 0 ? grossWeight : (weightFromGross + tareWeight),
                tareName: tareName,
                lotto: (rawData.lotto as string) || null,
                packagingId: (rawData.packagingId as string) || undefined
            };
            const updatedBatches = [...(material.batches || []), newBatch];
            transaction.update(materialRef, { 
                batches: updatedBatches, 
                stock: admin.firestore.FieldValue.increment(finalUnits),
                currentStockUnits: admin.firestore.FieldValue.increment(finalUnits),
                currentWeightKg: admin.firestore.FieldValue.increment(weightFromGross)
            });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto aggiunto.' };
    } catch (error) { return { success: false, message: "Errore." }; }
}

export async function returnMaterialToBatch(formData: FormData): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin();
    const rawData = Object.fromEntries(formData.entries());
    const materialId = rawData.materialId as string;
    const batchId = rawData.batchId as string;
    const materialRef = adminDb.collection("rawMaterials").doc(materialId);
    const globalSettings = await getGlobalSettings();
    
    try {
        await adminDb.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(materialRef);
            if (!docSnap.exists) throw new Error('Materiale non trovato.');
            const material = docSnap.data() as RawMaterial;
            
            const batches = [...(material.batches || [])];
            const idx = batches.findIndex(b => b.id === batchId);
            if (idx === -1) throw new Error('Lotto originale non trovato.');
            
            const returnedQty = Number(rawData.returnedQuantity);
            
            const config = globalSettings.rawMaterialTypes.find(t => t.id === material.type) || {
                id: material.type,
                label: material.type,
                defaultUnit: material.unitOfMeasure,
                hasConversion: false
            } as any;

            const { unitsToChange: finalUnits, weightToChange: finalWeightKg } = calculateInventoryMovement(
                material,
                config,
                returnedQty,
                material.unitOfMeasure as any,
                true // isAddition
            );
            
            batches[idx].netQuantity = (batches[idx].netQuantity || 0) + finalUnits;
            batches[idx].grossWeight = (batches[idx].grossWeight || 0) + finalWeightKg;
            if (batches[idx].netQuantity > 0.001) batches[idx].isExhausted = false;

            transaction.update(materialRef, { 
                batches, 
                stock: admin.firestore.FieldValue.increment(finalUnits),
                currentStockUnits: admin.firestore.FieldValue.increment(finalUnits),
                currentWeightKg: admin.firestore.FieldValue.increment(finalWeightKg)
            });
        });
        
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Reso registrato sul lotto originale.' };
    } catch (error) { 
        console.error("Errore in returnMaterialToBatch:", error);
        return { success: false, message: "Errore durante la registrazione del reso." }; 
    }
}

export async function getBatchesForReturn(materialId: string): Promise<{ lotto: string; lottoLabel: string; available: number }[]> {
    const doc = await adminDb.collection("rawMaterials").doc(materialId).get();
    if (!doc.exists) return [];
    const material = doc.data() as RawMaterial;
    return (material.batches || [])
        .map(b => ({
            lotto: b.id, 
            lottoLabel: b.lotto || 'N/D',
            available: b.netQuantity || 0
        }))
        .sort((a,b) => b.available - a.available);
}

export async function deleteBatchFromRawMaterial(materialId: string, batchId: string): Promise<{ success: boolean; message: string; }> {
    await ensureAdmin();
    const materialRef = adminDb.collection("rawMaterials").doc(materialId);
    try {
        await adminDb.runTransaction(async (t) => {
            const [docSnap, withdrawalsSnap] = await Promise.all([
                t.get(materialRef),
                adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get()
            ]);
            
            if (!docSnap.exists) throw new Error("Materia prima non trovata.");
            const material = docSnap.data() as RawMaterial;
            const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
            
            const batch = (material.batches || []).find(b => b.id === batchId);
            if (!batch) throw new Error("Lotto non trovato.");

            const updatedBatches = material.batches.filter(b => b.id !== batchId);
            const oldNetWeight = (batch.grossWeight || 0) - (batch.tareWeight || 0);
            t.update(materialRef, { 
                batches: updatedBatches,
                stock: admin.firestore.FieldValue.increment(-batch.netQuantity),
                currentStockUnits: admin.firestore.FieldValue.increment(-batch.netQuantity),
                currentWeightKg: admin.firestore.FieldValue.increment(-oldNetWeight)
            });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Lotto eliminato.' };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function deleteRawMaterial(id: string): Promise<{ success: boolean; message: string }> {
    await adminDb.collection("rawMaterials").doc(id).delete();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Materia prima eliminata.' };
}

export async function getMaterialWithdrawalsForMaterial(materialId: string): Promise<MaterialWithdrawal[]> {
    const snap = await adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get();
    return snap.docs.map(doc => ({ id: doc.id, ...convertTimestampsToDates(doc.data()) }) as MaterialWithdrawal);
}

export type MaterialStatus = { id: string; code: string; description: string; stock: number; impegnato: number; disponibile: number; ordinato: number; unitOfMeasure: string; };

export async function getMaterialsStatus(searchTerm?: string, lastCode?: string): Promise<MaterialStatus[]> {
    const materialsCol = adminDb.collection("rawMaterials");
    let mq: admin.firestore.Query = materialsCol;
    const lowerSearch = (searchTerm || '').toLowerCase().trim();
    if (lowerSearch.length >= 2) {
        mq = mq.where("code_normalized", ">=", lowerSearch).where("code_normalized", "<=", lowerSearch + '\uf8ff').limit(100);
    } else if (searchTerm !== undefined && searchTerm !== '') { return []; }
    else { 
        mq = mq.orderBy("code_normalized");
        if (lastCode) {
            mq = mq.startAfter(lastCode.toLowerCase().trim());
        }
        mq = mq.limit(50);
    }
    const activeStatuses = [
        "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
        "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
        "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
        "Manca Materiale", "Problema", "Sospesa", "planned", "In Pianificazione", "IN_PIANIFICAZIONE", "IN_ATTESA",
        "PRODUCTION", "PAUSED", "SUSPENDED"
    ];
    const [jobsSnap, materialsSnap, commitmentsSnap, posSnap, settings] = await Promise.all([
        adminDb.collection("jobOrders").where("status", "in", activeStatuses as any[]).get(),
        mq.get(),
        adminDb.collection('manualCommitments').where('status', '==', 'pending').get(),
        adminDb.collection('purchaseOrders').where('status', 'in', ['pending', 'partially_received']).get(),
        getGlobalSettings()
    ]);

    const mIds = materialsSnap.docs.map(doc => doc.id);
    const withdrawalsByMaterial: Record<string, number> = {};
    const withdrawals = await fetchInChunks<MaterialWithdrawal>(
        adminDb.collection("materialWithdrawals"),
        "materialId",
        mIds
    );
    withdrawals.forEach(w => {
        withdrawalsByMaterial[w.materialId] = (withdrawalsByMaterial[w.materialId] || 0) + (w.consumedUnits || 0);
    });

    const codeToMat = new Map<string, RawMaterial>();
    materialsSnap.forEach(docSnap => {
        const data = docSnap.data() as RawMaterial;
        codeToMat.set(data.code.toLowerCase().trim(), { ...data, id: docSnap.id });
    });

    const commitmentArticles = [...new Set(commitmentsSnap.docs.map(d => d.data().articleCode.toUpperCase()))];
    const articlesMap = new Map();
    if (commitmentArticles.length > 0) {
        const artResults = await fetchInChunks<Article>(
            adminDb.collection("articles"),
            "code",
            commitmentArticles
        );
        artResults.forEach(a => articlesMap.set(a.code.toLowerCase().trim(), a));
    }
    const impMap = new Map<string, number>();
    jobsSnap.forEach(d => {
        const job = d.data() as JobOrder;
        (job.billOfMaterials || []).forEach(item => {
            if (item.status !== 'withdrawn') {
                const code = item.component.toLowerCase().trim();
                const mat = codeToMat.get(code);
                if (mat) {
                    // SE presente il campo pre-calcolato (fabbisognoTotale), lo usiamo direttamente
                    // Questo garantisce che il Magazzino Live rifletta esattamente la sync effettuata.
                    let qty = item.fabbisognoTotale;
                    
                    if (qty === undefined || qty === null) {
                        const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        qty = req.totalInBaseUnits;
                    }
                    
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
                    const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                    const req = calculateBOMRequirement(comm.quantity, bomItem, mat, config as any);
                    const qty = req.totalInBaseUnits;
                    impMap.set(mCode, (impMap.get(mCode) || 0) + qty);
                }
            });
        } else {
            const mat = codeToMat.get(artCode);
            if (mat) { impMap.set(artCode, (impMap.get(artCode) || 0) + comm.quantity); }
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
        
        // --- DEFINTIVE SWITCH: READ THE DB FIELD, DON'T RE-CALCULATE ---
        const liveStockUnits = m.currentStockUnits || 0;

        const imp = impMap.get(normCode) || 0;
        const ord = ordMap.get(normCode) || 0;
        return { 
            id: m.id, 
            code: m.code, 
            description: m.description, 
            stock: liveStockUnits, 
            impegnato: imp, 
            disponibile: liveStockUnits - imp, 
            ordinato: ord, 
            unitOfMeasure: m.unitOfMeasure 
        };
    });
}

export type CommitmentDetail = { jobId: string; type: 'PRODUZIONE' | 'MANUALE'; quantity: number; deliveryDate: string; client: string; articleCode: string; };

export async function getMaterialCommitmentDetails(materialCode: string): Promise<CommitmentDetail[]> {
    const norm = materialCode.toLowerCase().trim();
    const activeStatuses = [
        "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
        "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
        "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
        "Manca Materiale", "Problema", "Sospesa", "planned", "In Pianificazione", "IN_PIANIFICAZIONE", "IN_ATTESA",
        "PRODUCTION", "PAUSED", "SUSPENDED"
    ];
    const [jobsSnap, commitmentsSnap, articlesSnap, materialsSnap, settings] = await Promise.all([
        adminDb.collection("jobOrders").where("status", "in", activeStatuses as any[]).get(),
        adminDb.collection('manualCommitments').where('status', '==', 'pending').get(),
        adminDb.collection('articles').get(),
        adminDb.collection('rawMaterials').where('code_normalized', '==', norm).get(),
        getGlobalSettings()
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
                let qty = item.fabbisognoTotale;
                if (qty === undefined || qty === null) {
                    const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                    const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                    qty = req.totalInBaseUnits;
                }
                details.push({ jobId: job.ordinePF, type: 'PRODUZIONE', quantity: qty, deliveryDate: job.dataConsegnaFinale || 'N/D', client: job.cliente || 'N/D', articleCode: job.details });
            }
        });
    });
    commitmentsSnap.forEach(d => {
        const comm = d.data() as ManualCommitment;
        const art = articlesMap.get(comm.articleCode.toLowerCase().trim());
        if (art && art.billOfMaterials) {
            art.billOfMaterials.forEach((bomItem: any) => {
                if (bomItem.component.toLowerCase().trim() === norm) {
                    const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                    const req = calculateBOMRequirement(comm.quantity, bomItem, mat, config as any);
                    details.push({ jobId: comm.jobOrderCode, type: 'MANUALE', quantity: req.totalInBaseUnits, deliveryDate: comm.deliveryDate || 'N/D', client: 'N/D', articleCode: comm.articleCode });
                }
            });
        } else if (comm.articleCode.toLowerCase().trim() === norm) {
            details.push({ jobId: comm.jobOrderCode, type: 'MANUALE', quantity: comm.quantity, deliveryDate: comm.deliveryDate || 'N/D', client: 'N/D', articleCode: comm.articleCode });
        }
    });
    return details.sort((a, b) => (a.deliveryDate || '').localeCompare(b.deliveryDate || ''));
}

export type OrderedDetail = { id: string; orderNumber: string; supplierName: string; quantity: number; receivedQuantity: number; expectedDeliveryDate: string; status: string; unit: string; };

export async function getMaterialOrderedDetails(materialCode: string): Promise<OrderedDetail[]> {
    const snap = await adminDb.collection("purchaseOrders").where("materialCode", "==", materialCode).where("status", "in", ["pending", "partially_received"]).get();
    return snap.docs.map(doc => {
        const data = doc.data() as PurchaseOrder;
        return { id: doc.id, orderNumber: data.orderNumber, supplierName: data.supplierName || 'N/D', quantity: data.quantity, receivedQuantity: data.receivedQuantity || 0, expectedDeliveryDate: data.expectedDeliveryDate, status: data.status, unit: data.unitOfMeasure };
    }).sort((a, b) => a.expectedDeliveryDate.localeCompare(b.expectedDeliveryDate));
}

export async function searchMaterialsAndGetStatus(searchTerm?: string, lastCode?: string) {
    const s = await getMaterialsStatus(searchTerm, lastCode);
    const m = await getRawMaterials(searchTerm, lastCode);
    const ids = new Set(s.map(item => item.id));
    return { materials: m.filter(item => ids.has(item.id)), status: s };
}

export async function getScrapsForMaterial(id: string): Promise<ScrapRecord[]> {
    const snap = await adminDb.collection("scrapRecords").where("materialId", "==", id).orderBy("declaredAt", "desc").get();
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id, declaredAt: (doc.data().declaredAt as admin.firestore.Timestamp).toDate().toISOString() } as ScrapRecord));
}

export async function deleteSingleWithdrawalAndRestoreStock(withdrawalId: string): Promise<{ success: boolean; message: string }> {
    const ref = adminDb.collection("materialWithdrawals").doc(withdrawalId);
    try {
        await adminDb.runTransaction(async (t) => {
            const wSnap = await t.get(ref);
            if (!wSnap.exists) throw new Error("Non trovato.");
            const w = wSnap.data() as MaterialWithdrawal;

            const mRef = adminDb.collection("rawMaterials").doc(w.materialId);
            const [mSnap, withdrawalsSnap] = await Promise.all([
                t.get(mRef),
                adminDb.collection("materialWithdrawals").where("materialId", "==", w.materialId).get()
            ]);

            if (mSnap.exists) {
                const m = mSnap.data() as RawMaterial;
                const withdrawals = withdrawalsSnap.docs.map((d: any) => d.data());
                
                // ATOMIC STOCK RESTORE
                t.update(mRef, {
                    stock: admin.firestore.FieldValue.increment(w.consumedUnits || 0),
                    currentStockUnits: admin.firestore.FieldValue.increment(w.consumedUnits || 0),
                    currentWeightKg: admin.firestore.FieldValue.increment(w.consumedWeight || 0)
                });
            }
            t.delete(ref);
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: 'Stornato.' };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function declareCommitmentFulfillment(id: string, good: number, scrap: number, sels: LotSelectionPayload[], uid: string) {
    try {
        await ensureAdmin(uid);
        await adminDb.runTransaction(async (t) => {
            const opRef = adminDb.collection("operators").doc(uid);
            const cRef = adminDb.collection("manualCommitments").doc(id);
            const uniqueMaterialIds = [...new Set(sels.map(s => s.materialId))];
            const mRefs = uniqueMaterialIds.map(mid => adminDb.collection("rawMaterials").doc(mid));
            const withdrawalsQueries = uniqueMaterialIds.map(mid => adminDb.collection("materialWithdrawals").where("materialId", "==", mid).get());

            const [opSnap, cSnap, mSnaps, wSnaps] = await Promise.all([
                t.get(opRef),
                t.get(cRef),
                Promise.all(mRefs.map(ref => t.get(ref))),
                Promise.all(withdrawalsQueries)
            ]);

            if (!cSnap.exists) throw new Error("Impegno non trovato.");
            const c = cSnap.data() as ManualCommitment;
            const opData = opSnap.exists ? opSnap.data() as Operator : null;

            const mDataMap = new Map(mSnaps.map(snap => [snap.id, snap.exists ? snap.data() as RawMaterial : null]));
            const wDataMap = new Map(wSnaps.map((snap, i) => [uniqueMaterialIds[i], snap.docs.map(d => d.data())]));

            // Keep track of updated batches in memory to pass to RMS
            const updatedBatchesMap = new Map<string, any[]>();

            for (const s of sels) {
                const m = mDataMap.get(s.materialId);
                if (!m) throw new Error("Materia prima non trovata.");
                let w = m.unitOfMeasure === 'kg' ? s.consumed : (m.conversionFactor ? s.consumed * m.conversionFactor : 0);
                
                // ATOMIC STOCK UPDATE (SSoT: Only aggregators, batches are immutable)
                t.update(adminDb.collection("rawMaterials").doc(s.materialId), { 
                    stock: admin.firestore.FieldValue.increment(-s.consumed),
                    currentStockUnits: admin.firestore.FieldValue.increment(-s.consumed),
                    currentWeightKg: admin.firestore.FieldValue.increment(-w)
                });
                // ------------------------------------------------

                const wRef = adminDb.collection("materialWithdrawals").doc();
                t.set(wRef, { jobOrderPFs: [c.jobOrderCode], jobIds: [], materialId: s.materialId, materialCode: s.componentCode, consumedWeight: w, consumedUnits: s.consumed, operatorId: uid, operatorName: opData?.nome || 'Admin', withdrawalDate: admin.firestore.Timestamp.now(), lotto: s.lotto, commitmentId: id });
            }
            if (scrap > 0) t.set(adminDb.collection("scrapRecords").doc(), { commitmentId: id, jobOrderCode: c.jobOrderCode, articleCode: c.articleCode, scrappedQuantity: scrap, declaredAt: admin.firestore.Timestamp.now(), operatorId: uid, operatorName: opData?.nome || 'Admin' });
            t.update(cRef, { status: 'fulfilled', fulfilledAt: admin.firestore.Timestamp.now(), fulfilledBy: uid });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Evasione registrata." };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function revertManualCommitmentFulfillment(id: string, uid: string) {
    await ensureAdmin(uid);
    try {
        const ws = await adminDb.collection("materialWithdrawals").where("commitmentId", "==", id).get();
        const ss = await adminDb.collection("scrapRecords").where("commitmentId", "==", id).get();
        await adminDb.runTransaction(async (t) => {
            const mIds = [...new Set(ws.docs.map(d => d.data().materialId))].filter(Boolean) as string[];
            const mRefs = mIds.map(mid => adminDb.collection("rawMaterials").doc(mid));
            const wQueries = mIds.map(mid => adminDb.collection("materialWithdrawals").where("materialId", "==", mid).get());

            const [mSnaps, wSnaps] = await Promise.all([
                Promise.all(mRefs.map(ref => t.get(ref))),
                Promise.all(wQueries)
            ]);

            const mMap = new Map(mSnaps.map(s => [s.id, s.exists ? s.data() as RawMaterial : null]));
            const wMap = new Map(wSnaps.map((s, i) => [mIds[i], s.docs.map(d => d.data())]));
            
            // Track updated batches in memory
            const updatedBatchesMap = new Map<string, any[]>();

            for (const wd of ws.docs) {
                const w = wd.data() as MaterialWithdrawal;
                const m = mMap.get(w.materialId);
                if (m) {
                    // ATOMIC STOCK RESTORE (SSoT: Only aggregators, batches are immutable)
                    t.update(adminDb.collection("rawMaterials").doc(w.materialId), { 
                        stock: admin.firestore.FieldValue.increment(w.consumedUnits || 0),
                        currentStockUnits: admin.firestore.FieldValue.increment(w.consumedUnits || 0),
                        currentWeightKg: admin.firestore.FieldValue.increment(w.consumedWeight || 0)
                    });
                }
                t.delete(wd.ref);
            }
            ss.forEach(d => t.delete(d.ref));
            t.update(adminDb.collection("manualCommitments").doc(id), { status: 'pending', fulfilledAt: admin.firestore.FieldValue.delete(), fulfilledBy: admin.firestore.FieldValue.delete() });
        });
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: "Annullato." };
    } catch (e) { return { success: false, message: "Errore." }; }
}

export async function saveManualCommitment(data: any, uid: string) {
    await ensureAdmin(uid);
    await adminDb.collection("manualCommitments").doc().set({ ...data, status: 'pending', createdAt: admin.firestore.Timestamp.now(), deliveryDate: data.deliveryDate.toISOString() });
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Creato.' };
}

export async function deleteManualCommitment(id: string) {
    await adminDb.collection("manualCommitments").doc(id).delete();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Eliminato.' };
}

export async function importManualCommitments(data: any[], uid: string) {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    data.forEach(r => {
        batch.set(adminDb.collection("manualCommitments").doc(), { jobOrderCode: String(r.Commessa || "").trim(), articleCode: String(r["Codice Articolo"] || "").trim(), quantity: Number(r.Quantita || 0), deliveryDate: r["Data Consegna"] ? new Date(r["Data Consegna"]).toISOString() : new Date().toISOString(), status: 'pending', createdAt: admin.firestore.Timestamp.now() });
    });
    await batch.commit();
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Importati.' };
}

export async function getMaterialsByCodes(codes: string[]): Promise<RawMaterial[]> {
    const validCodes = codes.filter(c => c && typeof c === 'string').map(c => c.trim());
    return fetchInChunks<RawMaterial>(adminDb.collection("rawMaterials"), "code", validCodes);
}

export type LotInfo = { lotto: string; available: number; batches: RawMaterialBatch[]; unit?: string };

export async function getLotInfoForMaterial(materialId: string): Promise<LotInfo[]> {
    const mSnap = await adminDb.collection("rawMaterials").doc(materialId).get();
    if (!mSnap.exists) return [];
    
    const matData = mSnap.data() as RawMaterial;
    
    // Fetch withdrawals for hydration (SSoT)
    const wSnap = await adminDb.collection("materialWithdrawals").where("materialId", "==", materialId).get();
    const withdrawals = wSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    const mat = hydrateMaterialWithWithdrawals(matData, withdrawals);
    
    // Process hydrated batches
    const activeBatches = (mat.batches || []).filter(b => !b.isExhausted && (b.netQuantity || 0) > 0.001);

    const bByLotto = activeBatches.reduce((acc, b) => { 
        const l = b.lotto || 'SENZA_LOTTO'; 
        if (!acc[l]) acc[l] = []; 
        acc[l].push(b); 
        return acc; 
    }, {} as Record<string, RawMaterialBatch[]>);

    return Object.entries(bByLotto)
        .map(([lotto, batches]) => { 
            const totalAvailable = batches.reduce((s, b) => s + (b.netQuantity || 0), 0); 
            return { lotto, available: totalAvailable, batches, unit: mat.unitOfMeasure }; 
        })
        .filter(l => l.available > 0.001);
}

export async function adjustRawMaterialStock(materialId: string, newStockUnits: number) {
    const materialRef = adminDb.collection("rawMaterials").doc(materialId);
    const mSnap = await materialRef.get();
    if (!mSnap.exists) return { success: false, message: "Materiale non trovato." };
    const material = mSnap.data() as RawMaterial;

    let newWeightKg = 0;
    if (material.unitOfMeasure === 'kg') {
        newWeightKg = newStockUnits;
    } else if (material.unitOfMeasure === 'mt') {
        newWeightKg = newStockUnits * (material.rapportoKgMt || 0);
    } else {
        newWeightKg = newStockUnits * (material.conversionFactor || 0);
    }

    const updateData: any = {
        currentStockUnits: newStockUnits,
        currentWeightKg: newWeightKg
    };

    // If resetting to 0, clear the batches to ensure consistency
    if (newStockUnits === 0) {
        updateData.batches = [];
    }

    await materialRef.update(updateData);
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Stock aggiornato con successo.' };
}


export type ReorderAlert = {
    materialId: string;
    code: string;
    description: string;
    currentStock: number;
    projectedStock: number;
    minStockLevel: number;
    reorderLot: number;
    dateOfNeed: string;
    deadlineDate: string;
    suggestedQuantity: number;
};

export async function getReorderAlerts(): Promise<ReorderAlert[]> {
    const [materialsSnap, jobsSnap, commitmentsSnap, articlesSnap, settings] = await Promise.all([
        adminDb.collection("rawMaterials").get(),
        adminDb.collection("jobOrders").where("status", "in", ["planned", "production", "suspended", "paused"] as any[]).get(),
        adminDb.collection('manualCommitments').where('status', '==', 'pending').get(),
        adminDb.collection('articles').get(),
        getGlobalSettings(),
    ]);

    const materials = materialsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
    const articlesMap = new Map();
    articlesSnap.forEach(d => articlesMap.set(d.data().code.toLowerCase().trim(), d.data()));

    const alerts: ReorderAlert[] = [];

    const { subtractWorkingMinutes } = await import('@/lib/calendar-utils');

    for (const mat of materials) {
        if (!mat.minStockLevel || mat.minStockLevel <= 0) continue;

        let currentBalance = mat.currentStockUnits || 0;
        const normCode = mat.code.toLowerCase().trim();

        // Collect all future consumption events
        type ConsumptionEvent = { date: Date; qty: number; source: string };
        const events: ConsumptionEvent[] = [];

        jobsSnap.forEach(d => {
            const job = d.data() as JobOrder;
            (job.billOfMaterials || []).forEach(item => {
                if (item.component.toLowerCase().trim() === normCode && item.status !== 'withdrawn') {
                    const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                    const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                    const qty = req.totalInBaseUnits;
                    if (qty > 0) {
                        events.push({ 
                            date: job.dataConsegnaFinale ? new Date(job.dataConsegnaFinale) : new Date(), 
                            qty, 
                            source: `ODL ${job.ordinePF}` 
                        });
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
                    if (bomItem.component.toLowerCase().trim() === normCode) {
                        const config = settings.rawMaterialTypes.find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(comm.quantity, bomItem, mat, config as any);
                        const qty = req.totalInBaseUnits;
                        if (qty > 0) {
                            events.push({ 
                                date: new Date(comm.deliveryDate), 
                                qty, 
                                source: `Impegno manuale ${comm.jobOrderCode}` 
                            });
                        }
                    }
                });
            } else if (artCode === normCode) {
                events.push({ 
                    date: new Date(comm.deliveryDate), 
                    qty: comm.quantity, 
                    source: `Impegno diretto ${comm.jobOrderCode}` 
                });
            }
        });

        // Sort events by date
        events.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Check if current stock is already below threshold
        if (currentBalance <= mat.minStockLevel) {
            const leadTimeMins = (mat.leadTimeDays || 0) * 8 * 60; // 8h working day
            const deadline = subtractWorkingMinutes(new Date(), leadTimeMins);
            
            alerts.push({
                materialId: mat.id,
                code: mat.code,
                description: mat.description,
                currentStock: currentBalance,
                projectedStock: currentBalance,
                minStockLevel: mat.minStockLevel,
                reorderLot: mat.reorderLot || 0,
                dateOfNeed: new Date().toISOString(),
                deadlineDate: deadline.toISOString(),
                suggestedQuantity: mat.reorderLot || (mat.minStockLevel - currentBalance + 1),
            });
            continue;
        }

        // Simulate stock depletion
        for (const event of events) {
            currentBalance -= event.qty;
            if (currentBalance <= mat.minStockLevel) {
                const leadTimeMins = (mat.leadTimeDays || 0) * 8 * 60;
                const deadline = subtractWorkingMinutes(event.date, leadTimeMins);

                alerts.push({
                    materialId: mat.id,
                    code: mat.code,
                    description: mat.description,
                    currentStock: mat.currentStockUnits || 0,
                    projectedStock: currentBalance,
                    minStockLevel: mat.minStockLevel,
                    reorderLot: mat.reorderLot || 0,
                    dateOfNeed: event.date.toISOString(),
                    deadlineDate: deadline.toISOString(),
                    suggestedQuantity: Math.max(mat.reorderLot || 0, mat.minStockLevel - currentBalance),
                });
                break; // Only the first alert for each material
            }
        }
    }

    return alerts.sort((a, b) => new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime());
}
