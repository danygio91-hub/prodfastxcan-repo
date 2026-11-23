
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Article, ArticlePhaseTime, WorkCycle, RawMaterial, JobOrder } from '@/types';
import * as z from 'zod';
import { syncJobBOMItems } from '@/lib/inventory-utils';
import { getGlobalSettings } from '@/lib/settings-actions';
import { updateArticleHistoricalTimes } from '@/lib/production-time-server-utils';
import { getWorkPhaseTemplates } from '../work-phase-management/actions';
import { isJobEligibleForArticleSync, computeArticleCycleSyncForJob } from '@/lib/article-cycle-sync';
import { bumpMrpSyncVersion } from '@/lib/mrp-sync';
import { normalizeDepartmentCode } from '@/lib/department-utils';
import { optionalCutLengthMmSchema } from '@/lib/bom-import-utils';
import { invalidateOdlArticleMemoCache } from '@/app/admin/programmazione/actions';
import type { ArticleMasterData } from '@/lib/quick-article-cache';
export type { ArticleMasterData };

async function fetchJobDocsByArticleKeys(articleId: string, articleCode: string): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const cleanCode = (articleCode || articleId || '').toString().trim();
    const cleanId = (articleId || articleCode || '').toString().trim();
    const upperCode = cleanCode.toUpperCase();
    const lowerCode = cleanCode.toLowerCase();

    const searchKeys = Array.from(new Set([
        cleanId,
        cleanId.toUpperCase(),
        cleanCode,
        upperCode,
        lowerCode,
        `${upperCode} `,
        ` ${upperCode}`,
    ].filter(Boolean))).slice(0, 30);

    if (searchKeys.length === 0) return [];

    // FASE 95: Query allargata su articleCode, details, articolo e articleId per catturare anche commesse manuali (es. REINTEGRO.NC)
    const [snapByArticleCode, snapByDetails, snapByArticolo, snapByArticleId] = await Promise.all([
        adminDb.collection('jobOrders').where('articleCode', 'in', searchKeys).get(),
        adminDb.collection('jobOrders').where('details', 'in', searchKeys).get(),
        adminDb.collection('jobOrders').where('articolo', 'in', searchKeys).get(),
        adminDb.collection('jobOrders').where('articleId', 'in', searchKeys).get(),
    ]);

    const docsMap = new Map<string, admin.firestore.QueryDocumentSnapshot>();
    snapByArticleCode.docs.forEach(d => docsMap.set(d.id, d));
    snapByDetails.docs.forEach(d => docsMap.set(d.id, d));
    snapByArticolo.docs.forEach(d => docsMap.set(d.id, d));
    snapByArticleId.docs.forEach(d => docsMap.set(d.id, d));
    return Array.from(docsMap.values());
}

const bomItemSchema = z.object({
    component: z.string().min(1, "Componente obbligatorio."),
    unit: z.enum(['n', 'mt', 'kg']),
    quantity: z.coerce.number().positive("Quantità obbligatoria."),
    lunghezzaTaglioMm: optionalCutLengthMmSchema,
    note: z.string().optional(),
});

const articleSchema = z.object({
    id: z.string().optional(),
    code: z.string().min(3, "Il codice articolo è obbligatorio."),
    defaultDepartmentId: z.string().nullable().optional(),
    defaultDepartmentCode: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    billOfMaterials: z.array(bomItemSchema).optional().default([]),
    workCycleId: z.string().optional(),
    secondaryWorkCycleId: z.string().optional(),
    expectedMinutesDefault: z.coerce.number().optional(),
    expectedMinutesSecondary: z.coerce.number().optional(),
    technicalNotes: z.string().optional().default(''),
    technicalDrawingUrl: z.string().optional().default(''),
    packagingType: z.string().optional(),
    packingInstructions: z.string().optional(),
    unitWeightKg: z.coerce.number().min(0).optional(),
    packagingTareWeightKg: z.coerce.number().min(0).optional(),
});

export async function getArticles(searchTerm?: string, lastCode?: string, limitCount: number = 50): Promise<Article[]> {
    let q: admin.firestore.Query = adminDb.collection('articles');
    const searchPart = (searchTerm || '').toUpperCase().trim();
    if (searchPart.length >= 1) {
        q = q.where('code', '>=', searchPart).where('code', '<=', searchPart + '\uf8ff').limit(100);
    } else if (searchTerm !== undefined && searchTerm.trim() !== '') {
        return [];
    } else {
        q = q.orderBy("code");
        if (lastCode) {
            q = q.startAfter(lastCode.toUpperCase().trim());
        }
        q = q.limit(limitCount);
    }
    const articlesSnapshot = await q.get();
    let articles = articlesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Article));

    // Fallback: se la query a prefisso non ha trovato corrispondenze, prova ricerca diretta per ID documento
    if (articles.length === 0 && searchPart) {
        const docSnap = await adminDb.collection('articles').doc(searchPart).get();
        if (docSnap.exists) {
            articles = [{ ...docSnap.data(), id: docSnap.id } as Article];
        }
    }

    return JSON.parse(JSON.stringify(articles));
}

export async function saveArticle(data: any): Promise<{ success: boolean; message: string; }> {
    try {
        // Filter out empty components before validation to allow partial forms and ensure uppercase
        if (data.billOfMaterials && Array.isArray(data.billOfMaterials)) {
            data.billOfMaterials = data.billOfMaterials
                .filter((item: any) => item.component && item.component.trim() !== '')
                .map((item: any) => ({ ...item, component: item.component.toUpperCase().trim() }));
        }

        const validatedFields = articleSchema.safeParse(data);
        if (!validatedFields.success) {
            console.error('Validation error:', validatedFields.error.format());
            return { success: false, message: 'Dati non validi: ' + validatedFields.error.errors.map(e => e.message).join(', ') };
        }

        const {
            code, defaultDepartmentId, defaultDepartmentCode, department,
            billOfMaterials, workCycleId, secondaryWorkCycleId,
            expectedMinutesDefault, expectedMinutesSecondary,
            technicalNotes, technicalDrawingUrl,
            packagingType, packingInstructions, unitWeightKg, packagingTareWeightKg
        } = validatedFields.data;

        // Check if components exist in rawMaterials and resolve their canonical unitOfMeasure
        const uniqueCodes = [...new Set(billOfMaterials.map(i => i.component).filter(Boolean))];
        const materialCodes = new Set<string>();
        const materialByCodeMap = new Map<string, RawMaterial>();

        for (let i = 0; i < uniqueCodes.length; i += 30) {
            const chunk = uniqueCodes.slice(i, i + 30);
            const snap = await adminDb.collection("rawMaterials").where("code", "in", chunk).get();
            snap.forEach(d => {
                const matData = { ...d.data(), id: d.id } as RawMaterial;
                const upper = (matData.code || '').toUpperCase().trim();
                if (upper) {
                    materialCodes.add(upper);
                    materialByCodeMap.set(upper, matData);
                }
            });
        }

        const invalid = billOfMaterials.filter(item => item.component && !materialCodes.has(item.component.toUpperCase()));
        if (invalid.length > 0) {
            return { success: false, message: `Componenti non trovati in anagrafica: ${invalid.map(i => i.component).join(', ')}` };
        }

        const docId = code.toUpperCase();
        const normalizedBillOfMaterials = billOfMaterials.map((item) => {
            const compUpper = item.component.toUpperCase().trim();
            const mat = materialByCodeMap.get(compUpper);
            const resolvedUnit = (mat?.unitOfMeasure as 'n' | 'mt' | 'kg') || item.unit;
            const validCut =
                typeof item.lunghezzaTaglioMm === 'number' && item.lunghezzaTaglioMm > 0
                    ? item.lunghezzaTaglioMm
                    : null;
            return {
                ...item,
                component: compUpper,
                unit: resolvedUnit,
                lunghezzaTaglioMm: validCut,
            };
        });

        // Build articleData carefully to avoid undefined values
        const articleData: any = {
            id: docId,
            code: docId,
            billOfMaterials: normalizedBillOfMaterials,
            technicalNotes: technicalNotes ?? '',
            technicalDrawingUrl: technicalDrawingUrl ?? '',
        };

        if (
            defaultDepartmentId !== undefined ||
            defaultDepartmentCode !== undefined ||
            department !== undefined
        ) {
            const normalizedDept = normalizeDepartmentCode(
                defaultDepartmentId ?? defaultDepartmentCode ?? department
            );
            articleData.defaultDepartmentId = normalizedDept || null;
            articleData.defaultDepartmentCode = normalizedDept || null;
            articleData.department = normalizedDept || '';
        }

        if (workCycleId !== undefined) articleData.workCycleId = workCycleId;
        if (secondaryWorkCycleId !== undefined) articleData.secondaryWorkCycleId = secondaryWorkCycleId;
        if (expectedMinutesDefault !== undefined) articleData.expectedMinutesDefault = expectedMinutesDefault;
        if (expectedMinutesSecondary !== undefined) articleData.expectedMinutesSecondary = expectedMinutesSecondary;
        if (packagingType !== undefined) articleData.packagingType = packagingType;
        if (packingInstructions !== undefined) articleData.packingInstructions = packingInstructions;
        if (unitWeightKg !== undefined) articleData.unitWeightKg = unitWeightKg;
        if (packagingTareWeightKg !== undefined) articleData.packagingTareWeightKg = packagingTareWeightKg;

        await adminDb.collection('articles').doc(docId).set(articleData, { merge: true });

        // --- AUTO-SYNC JOBS LISTENER (Solo commesse PIANIFICATA - Ciclo Congelato) ---
        try {
            const shouldSyncCycles =
                workCycleId !== undefined ||
                secondaryWorkCycleId !== undefined ||
                expectedMinutesDefault !== undefined ||
                expectedMinutesSecondary !== undefined;

            const [linkedJobDocs, globalSettings, articleSnap, workCycles, phaseTemplates] = await Promise.all([
                fetchJobDocsByArticleKeys(docId, docId),
                getGlobalSettings(),
                shouldSyncCycles ? adminDb.collection('articles').doc(docId).get() : Promise.resolve(null),
                shouldSyncCycles ? getWorkCycles() : Promise.resolve([] as WorkCycle[]),
                shouldSyncCycles ? getWorkPhaseTemplates() : Promise.resolve([]),
            ]);

            const plannedJobDocs = linkedJobDocs.filter(doc =>
                isJobEligibleForArticleSync(doc.data() as JobOrder)
            );

            if (plannedJobDocs.length > 0) {
                // FASE 90: Carica solo i materiali effettivamente coinvolti nelle distinte delle commesse pianificate
                const neededMaterialCodes = new Set<string>(uniqueCodes.map(c => c.toUpperCase()));
                plannedJobDocs.forEach(doc => {
                    const job = doc.data() as JobOrder;
                    (job.billOfMaterials || []).forEach(item => {
                        if (item.component) neededMaterialCodes.add(item.component.trim().toUpperCase());
                    });
                });

                const neededCodesArr = Array.from(neededMaterialCodes).filter(Boolean);
                const matChunks: string[][] = [];
                for (let i = 0; i < neededCodesArr.length; i += 30) {
                    matChunks.push(neededCodesArr.slice(i, i + 30));
                }
                const matSnaps = await Promise.all(
                    matChunks.map(chunk =>
                        adminDb.collection("rawMaterials")
                            .where("code", "in", chunk)
                            .select("code", "description", "type", "unitOfMeasure", "conversionFactor", "rapportoKgMt")
                            .get()
                    )
                );
                const rawMaterials = matSnaps.flatMap(snap =>
                    snap.docs.map(d => ({ ...d.data(), id: d.id, batches: [] } as unknown as RawMaterial))
                );

                const mergedArticle: Partial<Article> = {
                    ...(articleSnap?.data() || {}),
                    ...articleData,
                    id: docId,
                    code: docId,
                };

                for (let i = 0; i < plannedJobDocs.length; i += 450) {
                    const chunk = plannedJobDocs.slice(i, i + 450);
                    const batch = adminDb.batch();

                    chunk.forEach(doc => {
                        const job = doc.data() as JobOrder;
                        const syncedBOMRaw = syncJobBOMItems(
                            job.qta,
                            job.billOfMaterials || [],
                            normalizedBillOfMaterials,
                            rawMaterials,
                            globalSettings
                        );

                        // Sanitizzazione Payload per Firestore (No undefined)
                        const syncedBOM = syncedBOMRaw.map(item => ({
                            ...item,
                            lunghezzaTaglioMm: item.lunghezzaTaglioMm ?? null,
                            fabbisognoTotale: item.fabbisognoTotale ?? 0,
                            pesoStimato: item.pesoStimato ?? 0,
                            note: item.note ?? ""
                        }));

                        const updatePayload: Record<string, any> = {
                            billOfMaterials: syncedBOM,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        };

                        if (shouldSyncCycles) {
                            const cycleSync = computeArticleCycleSyncForJob({
                                job,
                                article: mergedArticle,
                                workCycles,
                                phaseTemplates,
                            });
                            updatePayload.phases = cycleSync.phases;
                            updatePayload.workCycleId = cycleSync.workCycleId;
                            updatePayload.expectedMinutesDefault = cycleSync.expectedMinutesDefault;
                            updatePayload.orePreviste = cycleSync.orePreviste;
                            updatePayload.expectedHours = cycleSync.expectedHours;
                        }

                        updatePayload.articleCode = docId;
                        updatePayload.details = docId;
                        updatePayload.articolo = docId;

                        batch.update(doc.ref, updatePayload);
                    });

                    await batch.commit();
                }
            }
        } catch (syncError) {
            console.error("Auto-sync jobs error:", syncError);
            // Non blocchiamo il salvataggio dell'articolo se fallisce la sync delle commesse, 
            // ma logghiamo l'errore.
        }
        // -------------------------------
        // FASE 90 & FASE 105-BIS: Invalida memo cache ODL e aggiorna version token MRP
        await invalidateOdlArticleMemoCache(docId);
        await bumpMrpSyncVersion('jobsBom', 'article-management:saveArticle');

        return { success: true, message: 'Articolo salvato e impegni commesse sincronizzati.' };
    } catch (error: any) {
        console.error('Error in saveArticle:', error);
        return { success: false, message: "Errore durante il salvataggio: " + (error.message || "Errore sconosciuto") };
    }
}

export async function refreshArticleHistoricalTimes(articleCode: string) {
    try {
        await updateArticleHistoricalTimes(articleCode);
        const doc = await adminDb.collection("articles").where("code", "==", articleCode.trim().toUpperCase()).limit(1).get();
        if (doc.empty) return { success: false };
        const data = doc.docs[0].data() as Article;
        return { success: true, historicalTimes: JSON.parse(JSON.stringify(data.historicalTimes || null)) };
    } catch (e) {
        console.error('Error refreshing historical times:', e);
        return { success: false };
    }
}

export async function deleteArticle(id: string): Promise<{ success: boolean; message: string; }> {
    await adminDb.collection("articles").doc(id).delete();
    await bumpMrpSyncVersion('jobsBom', 'article-management:deleteArticle');
    revalidatePath('/admin/article-management');
    return { success: true, message: 'Articolo eliminato.' };
}

export async function validateArticlesImport(articles: Omit<Article, 'id'>[]) {
    const allImportedComponents = new Set<string>();
    articles.forEach(art => art.billOfMaterials?.forEach(item => {
        if (item.component) {
            item.component = item.component.toUpperCase().trim();
            allImportedComponents.add(item.component);
        }
    }));
    const uniqueComponents = [...allImportedComponents];

    const validCodes = new Set<string>();
    const materialUnitsByCode = new Map<string, 'n' | 'mt' | 'kg'>();
    for (let i = 0; i < uniqueComponents.length; i += 30) {
        const chunk = uniqueComponents.slice(i, i + 30);
        const snap = await adminDb.collection("rawMaterials").where("code", "in", chunk).get();
        snap.forEach(d => {
            const data = d.data();
            const upper = String(data.code || '').toUpperCase().trim();
            if (upper) {
                validCodes.add(upper);
                if (data.unitOfMeasure) {
                    materialUnitsByCode.set(upper, data.unitOfMeasure as 'n' | 'mt' | 'kg');
                }
            }
        });
    }

    const existingCodes = new Set<string>();
    const importedCodes = articles.map(a => a.code.toUpperCase()).filter(Boolean);

    for (let i = 0; i < importedCodes.length; i += 30) {
        const chunk = importedCodes.slice(i, i + 30);
        const snap = await adminDb.collection("articles").where("code", "in", chunk).get();
        snap.forEach(d => existingCodes.add(d.data().code.toUpperCase()));
    }

    const newArticles: Omit<Article, 'id'>[] = [];
    const updatedArticles: Omit<Article, 'id'>[] = [];
    const invalidArticles: { code: string; errors: string[] }[] = [];

    for (const art of articles) {
        const errors: string[] = [];
        if (!art.code || art.code.length < 3) errors.push("Codice troppo corto.");
        if (!art.billOfMaterials || art.billOfMaterials.length === 0) errors.push("Distinta vuota.");
        else {
            art.billOfMaterials = art.billOfMaterials.map((item: any, idx) => {
                const compUpper = (item.component || '').toUpperCase().trim();
                if (!validCodes.has(compUpper)) {
                    errors.push(`Componente riga ${idx + 1} non in anagrafica: ${item.component}`);
                }
                const canonicalUnit = materialUnitsByCode.get(compUpper);
                const { _hasExplicitUnit, ...cleanItem } = item;
                return {
                    ...cleanItem,
                    component: compUpper,
                    unit: canonicalUnit || cleanItem.unit || 'n',
                };
            });
        }

        if (errors.length > 0) {
            invalidArticles.push({ code: art.code || 'N/D', errors });
        } else {
            if (existingCodes.has(art.code.toUpperCase())) {
                updatedArticles.push(art);
            } else {
                newArticles.push(art);
            }
        }
    }
    return { success: true, newArticles, updatedArticles, invalidArticles };
}

export async function bulkSaveArticles(articles: Omit<Article, 'id'>[]) {
    const FIRESTORE_BATCH_LIMIT = 400;

    // Pre-carica una sola volta i materiali coinvolti e le impostazioni globali
    const [rawMaterialsSnap, globalSettings] = await Promise.all([
        adminDb.collection("rawMaterials").get(),
        getGlobalSettings(),
    ]);
    const rawMaterials = rawMaterialsSnap.docs.map(d => ({ ...d.data(), id: d.id } as RawMaterial));
    const materialByCodeMap = new Map<string, RawMaterial>();
    rawMaterials.forEach(m => {
        if (m.code) materialByCodeMap.set(m.code.toUpperCase().trim(), m);
    });

    type PendingWriteOp =
        | { type: 'set'; ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }
        | { type: 'update'; ref: FirebaseFirestore.DocumentReference; data: Record<string, any> };

    const pendingOps: PendingWriteOp[] = [];

    for (const art of articles) {
        const id = art.code.toUpperCase().trim();
        // Ensure BOM components are uppercase and aligned with canonical unitOfMeasure
        const normalizedBOM = (art.billOfMaterials || []).map((item: any) => {
            const compUpper = (item.component || '').toUpperCase().trim();
            const mat = materialByCodeMap.get(compUpper);
            const { _hasExplicitUnit, ...cleanItem } = item;
            const validCut =
                typeof cleanItem.lunghezzaTaglioMm === 'number' && cleanItem.lunghezzaTaglioMm > 0
                    ? cleanItem.lunghezzaTaglioMm
                    : null;
            return {
                ...cleanItem,
                component: compUpper,
                unit: (mat?.unitOfMeasure as 'n' | 'mt' | 'kg') || cleanItem.unit || 'n',
                lunghezzaTaglioMm: validCut,
            };
        });

        pendingOps.push({
            type: 'set',
            ref: adminDb.collection('articles').doc(id),
            data: { ...art, id, code: id, billOfMaterials: normalizedBOM },
        });

        // --- CASCADING SYNC FOR BULK (Commesse attive eleggibili) ---
        const allLinkedJobs = await fetchJobDocsByArticleKeys(id, id);
        const plannedJobs = allLinkedJobs.filter(doc =>
            isJobEligibleForArticleSync(doc.data() as JobOrder)
        );

        if (plannedJobs.length > 0) {
            plannedJobs.forEach(doc => {
                const job = doc.data() as JobOrder;
                const syncedBOMRaw = syncJobBOMItems(
                    job.qta,
                    job.billOfMaterials || [],
                    normalizedBOM,
                    rawMaterials,
                    globalSettings
                );

                const syncedBOM = syncedBOMRaw.map(item => ({
                    ...item,
                    lunghezzaTaglioMm: item.lunghezzaTaglioMm ?? null,
                    fabbisognoTotale: item.fabbisognoTotale ?? 0,
                    pesoStimato: item.pesoStimato ?? 0,
                    note: item.note ?? ""
                }));

                pendingOps.push({
                    type: 'update',
                    ref: doc.ref,
                    data: { billOfMaterials: syncedBOM },
                });
            });
        }
    }

    for (let i = 0; i < pendingOps.length; i += FIRESTORE_BATCH_LIMIT) {
        const chunk = pendingOps.slice(i, i + FIRESTORE_BATCH_LIMIT);
        const batch = adminDb.batch();
        chunk.forEach((op) => {
            if (op.type === 'set') {
                batch.set(op.ref, op.data, { merge: true });
            } else {
                batch.update(op.ref, op.data);
            }
        });
        await batch.commit();
    }

    await invalidateOdlArticleMemoCache();
    await bumpMrpSyncVersion('jobsBom', 'article-management:bulkSaveArticles');
    revalidatePath('/admin/article-management');
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/resource-planning');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/programmazione');
    revalidatePath('/admin/data-management');
    return { success: true, message: `${articles.length} articoli elaborati e commesse dinamiche sincronizzate.` };
}

export async function validateArticleSettingsImport(rows: any[]) {
    const codes = [...new Set(rows.map(row =>
        String(row['CODICE ARTICOLO'] || row['codice articolo'] || '').trim().toUpperCase()
    ).filter(Boolean))];

    const articlesMap = new Map<string, Article>();
    for (let i = 0; i < codes.length; i += 30) {
        const chunk = codes.slice(i, i + 30);
        const snap = await adminDb.collection("articles").where("code", "in", chunk).get();
        snap.forEach(d => articlesMap.set(d.data().code.toUpperCase(), d.data() as Article));
    }

    const [cyclesSnap, phasesSnap] = await Promise.all([
        adminDb.collection("workCycles").get(),
        adminDb.collection("workPhaseTemplates").get()
    ]);
    const cyclesMap = new Map<string, WorkCycle>(cyclesSnap.docs.map(d => [String(d.data().name).toUpperCase(), { ...d.data(), id: d.id } as WorkCycle]));
    const phasesMap = new Map<string, string>(phasesSnap.docs.map(d => [String(d.data().name).toUpperCase(), d.id]));

    const validUpdates: Partial<Article>[] = [];
    const invalidRows: { code: string; reason: string }[] = [];

    for (const row of rows) {
        const code = String(row['CODICE ARTICOLO'] || row['codice articolo'] || '').trim().toUpperCase();
        if (!code) continue;

        const article = articlesMap.get(code);
        if (!article) {
            invalidRows.push({ code, reason: "Articolo non trovato in anagrafica." });
            continue;
        }

        const cycleDefName = String(row['CICLO PREDEFINITO'] || row['ciclo predefinito'] || '').trim().toUpperCase();
        const cycleSecName = String(row['CICLO SECONDARIO'] || row['ciclo secondario'] || '').trim().toUpperCase();

        const cycleDef = cycleDefName ? cyclesMap.get(cycleDefName) : undefined;
        const cycleSec = cycleSecName ? cyclesMap.get(cycleSecName) : undefined;

        if (cycleDefName && !cycleDef) {
            invalidRows.push({ code, reason: `Ciclo Predefinito "${cycleDefName}" non trovato.` });
            continue;
        }

        const primaryCycleId = cycleDef?.id || article.workCycleId;
        const activeCycle = primaryCycleId && primaryCycleId !== 'manual' ? cyclesMap.get([...cyclesMap.keys()].find(k => cyclesMap.get(k)?.id === primaryCycleId) || '') : null;
        const allowedPhaseIds = activeCycle ? new Set(activeCycle.phaseTemplateIds) : null;

        const secCycleId = cycleSec?.id || article.secondaryWorkCycleId;
        const activeSecCycle = secCycleId && secCycleId !== 'manual' ? cyclesMap.get([...cyclesMap.keys()].find(k => cyclesMap.get(k)?.id === secCycleId) || '') : null;
        const allowedSecPhaseIds = activeSecCycle ? new Set(activeSecCycle.phaseTemplateIds) : null;

        // Filtriamo phaseTimes (Default)
        const phaseTimes: Record<string, ArticlePhaseTime> = {};
        if (article.phaseTimes) {
            Object.entries(article.phaseTimes).forEach(([pid, pdata]) => {
                if (!allowedPhaseIds || allowedPhaseIds.has(pid)) {
                    phaseTimes[pid] = { ...pdata };
                }
            });
        }

        // Filtriamo phaseTimesSecondary (Secondario)
        const phaseTimesSecondary: Record<string, ArticlePhaseTime> = {};
        if (article.phaseTimesSecondary) {
            Object.entries(article.phaseTimesSecondary).forEach(([pid, pdata]) => {
                if (!allowedSecPhaseIds || allowedSecPhaseIds.has(pid)) {
                    phaseTimesSecondary[pid] = { ...pdata };
                }
            });
        }

        let hasPhaseUpdates = false;

        // Cerca colonne dinamiche "TEMPO FASE: NOME_FASE"
        const rowKeys = Object.keys(row);
        for (const key of rowKeys) {
            const upKey = key.toUpperCase().trim();
            if (upKey.startsWith('TEMPO FASE:')) {
                const phaseName = upKey.replace('TEMPO FASE:', '').trim();
                const mappedPhaseId = phasesMap.get(phaseName);
                if (mappedPhaseId) {
                    // Aggiorniamo i tempi solo se la fase è nel ciclo attivo (o se siamo in manuale)
                    if (!allowedPhaseIds || allowedPhaseIds.has(mappedPhaseId)) {
                        const minutesStr = row[key];
                        if (minutesStr !== undefined && minutesStr !== null && minutesStr !== '') {
                            const mins = Number(minutesStr);
                            if (!isNaN(mins)) {
                                phaseTimes[mappedPhaseId] = {
                                    expectedMinutesPerPiece: mins,
                                    detectedMinutesPerPiece: phaseTimes[mappedPhaseId]?.detectedMinutesPerPiece || 0,
                                    enabled: true
                                };
                                hasPhaseUpdates = true;
                            }
                        }
                    }
                }
            }
        }

        const updateObj: Partial<Article> = {
            id: code,
            code: code,
            workCycleId: cycleDef?.id || article.workCycleId,
            secondaryWorkCycleId: cycleSec?.id || article.secondaryWorkCycleId,
            phaseTimes: phaseTimes,
            phaseTimesSecondary: phaseTimesSecondary
        };

        const expectedDef = Number(row['TEMPO PREVISTO CICLO PREDEFINITO'] || row['tempo previsto ciclo predefinito']);
        if (!isNaN(expectedDef) && expectedDef > 0) updateObj.expectedMinutesDefault = expectedDef;

        const expectedSec = Number(row['TEMPO PREVISTO CICLO SECONDARIO'] || row['tempo previsto ciclo secondario']);
        if (!isNaN(expectedSec) && expectedSec > 0) updateObj.expectedMinutesSecondary = expectedSec;

        validUpdates.push(updateObj);
    }

    return { validUpdates, invalidRows };
}

export async function bulkUpdateArticleSettings(updates: Partial<Article>[]) {
    const batch = adminDb.batch();
    updates.forEach(upd => {
        if (upd.id) {
            const { id, ...data } = upd;
            // Usiamo update invece di set(..., {merge:true}) per SOSTITUIRE le mappe phaseTimes/phaseTimesSecondary
            // Questo garantisce che le fasi rimosse dal ciclo spariscano effettivamente da Firestore.
            batch.update(adminDb.collection('articles').doc(id), data as any);
        }
    });
    await batch.commit();
    await bumpMrpSyncVersion('jobsBom', 'article-management:bulkUpdateArticleSettings');
    revalidatePath('/admin/article-management');
    revalidatePath('/admin/data-management');
    return { success: true, message: `${updates.length} articoli aggiornati.` };
}

export async function saveArticleStandardTimes(articleId: string, data: Partial<Article>) {
    try {
        const payloadToSave: Partial<Article> = { ...data };
        if (
            data.defaultDepartmentId !== undefined ||
            data.defaultDepartmentCode !== undefined ||
            data.department !== undefined
        ) {
            const normalizedDept = normalizeDepartmentCode(
                data.defaultDepartmentId ?? data.defaultDepartmentCode ?? data.department
            );
            payloadToSave.defaultDepartmentId = normalizedDept || null;
            payloadToSave.defaultDepartmentCode = normalizedDept || null;
            payloadToSave.department = normalizedDept || '';
        }

        await adminDb.collection('articles').doc(articleId).set(payloadToSave, { merge: true });

        let syncedCount = 0;
        let skippedFrozenCount = 0;

        // --- FASE 95: PROPAGAZIONE GLOBALE TEMPI/CICLI SU TUTTE LE COMMESSE ATTIVE ---
        // Esclude solo le commesse "Conclusa" e inietta con Hard-Override l'intero array fasi e il ricalcolo ore.
        try {
            const [articleDoc, phaseTemplates, workCycles] = await Promise.all([
                adminDb.collection('articles').doc(articleId).get(),
                getWorkPhaseTemplates(),
                getWorkCycles(),
            ]);
            const articleDocData = articleDoc.data() || {};
            const articleCode = (data.code || articleDocData.code || articleId || '').toString().trim().toUpperCase();
            const mergedArticle: Partial<Article> = {
                ...articleDocData,
                ...data,
                id: articleId,
                code: articleCode,
            };

            const allJobDocs = await fetchJobDocsByArticleKeys(articleId, articleCode);

            if (allJobDocs.length > 0) {
                const eligibleDocs: admin.firestore.QueryDocumentSnapshot[] = [];

                allJobDocs.forEach((doc) => {
                    const job = doc.data() as JobOrder;
                    if (!isJobEligibleForArticleSync(job)) {
                        skippedFrozenCount++;
                        return;
                    }
                    eligibleDocs.push(doc);
                });

                // FASE 95 (3): Partizionamento in chunk da max 450 operazioni e commit parallelo con Promise.all
                const BATCH_CHUNK_SIZE = 450;
                const commitPromises: Promise<admin.firestore.WriteResult[]>[] = [];

                for (let i = 0; i < eligibleDocs.length; i += BATCH_CHUNK_SIZE) {
                    const currentChunk = eligibleDocs.slice(i, i + BATCH_CHUNK_SIZE);
                    const batch = adminDb.batch();

                    currentChunk.forEach((doc) => {
                        const job = doc.data() as JobOrder;
                        const syncResult = computeArticleCycleSyncForJob({
                            job,
                            article: mergedArticle,
                            workCycles,
                            phaseTemplates,
                        });

                        const updatePayload: Record<string, any> = {
                            phases: syncResult.phases,
                            workCycleId: syncResult.workCycleId,
                            expectedMinutesDefault: syncResult.expectedMinutesDefault,
                            orePreviste: syncResult.orePreviste,
                            expectedHours: syncResult.expectedHours,
                            articleCode,
                            details: articleCode,
                            articolo: articleCode,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        };

                        batch.update(doc.ref, updatePayload);
                        syncedCount++;
                    });

                    commitPromises.push(batch.commit());
                }

                if (commitPromises.length > 0) {
                    await Promise.all(commitPromises);
                }
            }
        } catch (syncErr) {
            console.error("Error during mass sync of job expected times:", syncErr);
        }
        // ------------------------------------------------
        // FASE 90: Rimossi revalidatePath massivi che bloccavano la coda Server Actions sul client.
        await bumpMrpSyncVersion('jobsBom', 'article-management:saveArticleStandardTimes');

        const freezeSuffix = skippedFrozenCount > 0
            ? ` (${skippedFrozenCount} commesse concluse escluse)`
            : '';
        return {
            success: true,
            message: `Standard Tempi e Cicli aggiornati. ${syncedCount > 0 ? `${syncedCount} commesse attive sincronizzate` : 'Commesse attive sincronizzate'} con successo.${freezeSuffix}`,
            syncedCount,
            skippedFrozenCount,
        };
    } catch (e) {
        console.error("Error saving article standard times:", e);
        return { success: false, message: 'Errore durante il salvataggio.' };
    }
}

/**
 * FASE 82 & FASE 90: Caricamento Dati Completi Anagrafica Rapida Articolo (Eliminazione Waterfall).
 * Raggruppa in parallelo via Promise.all() le query per:
 * - Dati Articolo (lettura diretta per docId con fallback su code)
 * - Cicli di lavorazione standard (workCycles)
 * - Template fasi di lavoro (phaseTemplates)
 * - Impostazioni globali (globalSettings)
 * - Pre-caricamento parallelo dei materiali distinti (BOM rawMaterials leggeri senza array batches)
 *
 * ESCLUDE categoricamente qualsiasi interrogazione alla collection 'jobOrders' (Lazy Job Lookup),
 * garantendo tempi di risposta immediati durante il render e l'apertura del modale.
 */
export async function getArticleMasterData(articleCode: string): Promise<ArticleMasterData> {
    const cleanCode = (articleCode || '').trim();
    if (!cleanCode) {
        return {
            article: null,
            workCycles: [],
            phaseTemplates: [],
            globalSettings: null,
            materials: [],
        };
    }

    const upper = cleanCode.toUpperCase();

    // 1. Parallelizzazione di tutte le query indipendenti (Eliminazione Waterfall)
    const [articleSnap, articleQuerySnap, workCyclesSnap, phaseTemplates, globalSettings] = await Promise.all([
        adminDb.collection('articles').doc(upper).get(),
        adminDb.collection('articles').where('code', '==', upper).limit(1).get(),
        adminDb.collection('workCycles').orderBy('name').get(),
        getWorkPhaseTemplates(),
        getGlobalSettings(),
    ]);

    let article: Article | null = null;
    if (articleSnap.exists) {
        article = { ...articleSnap.data(), id: articleSnap.id } as Article;
    } else if (!articleQuerySnap.empty) {
        article = { ...articleQuerySnap.docs[0].data(), id: articleQuerySnap.docs[0].id } as Article;
    }

    const workCycles: WorkCycle[] = workCyclesSnap.docs.map(
        d => ({ ...d.data(), id: d.id } as WorkCycle)
    );

    // 2. Pre-caricamento parallelo dei materiali BOM (senza lo storico pesante dei batches)
    let materials: RawMaterial[] = [];
    if (article?.billOfMaterials && article.billOfMaterials.length > 0) {
        const uniqueComponents = Array.from(
            new Set(article.billOfMaterials.map(i => (i.component || '').trim().toUpperCase()).filter(Boolean))
        );
        if (uniqueComponents.length > 0) {
            const materialChunks: string[][] = [];
            for (let i = 0; i < uniqueComponents.length; i += 30) {
                materialChunks.push(uniqueComponents.slice(i, i + 30));
            }
            const matSnaps = await Promise.all(
                materialChunks.map(chunk =>
                    adminDb.collection('rawMaterials')
                        .where('code', 'in', chunk)
                        .select('code', 'description', 'type', 'unitOfMeasure', 'conversionFactor', 'rapportoKgMt')
                        .get()
                )
            );
            materials = matSnaps.flatMap(s =>
                s.docs.map(d => ({ ...d.data(), id: d.id, batches: [] } as unknown as RawMaterial))
            );
        }
    }

    if (!article) {
        article = {
            id: upper,
            code: upper,
            billOfMaterials: [],
            phaseTimes: {},
        } as Article;
    }

    return JSON.parse(JSON.stringify({
        article,
        workCycles,
        phaseTemplates,
        globalSettings,
        materials,
    }));
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
    const snap = await adminDb.collection("workCycles").orderBy("name").get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as WorkCycle));
}

export async function syncAllHistoricalToTargets(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    try {
        const [articlesSnap, phases] = await Promise.all([
            adminDb.collection('articles').get(),
            getWorkPhaseTemplates()
        ]);

        const phaseMap = new Map(phases.map(p => [p.name.toUpperCase().trim(), p.id]));

        let currentBatch = adminDb.batch();
        let batchCount = 0;
        let totalUpdated = 0;

        for (const doc of articlesSnap.docs) {
            const article = doc.data() as Article;
            if (!article.historicalTimes?.averagePhaseTimes || article.historicalTimes.averagePhaseTimes.length === 0) continue;

            let articleModified = false;
            // Clona la mappa esistente o creane una nuova
            const phaseTimes = article.phaseTimes ? { ...article.phaseTimes } : {};

            article.historicalTimes.averagePhaseTimes.forEach(hist => {
                if (hist.averageMinutesPerPiece > 0) {
                    const phaseId = phaseMap.get(hist.name.toUpperCase().trim());
                    if (phaseId) {
                        // Sovrascriviamo o popoliamo se mancante
                        if (!phaseTimes[phaseId] || phaseTimes[phaseId].expectedMinutesPerPiece !== hist.averageMinutesPerPiece) {
                            phaseTimes[phaseId] = {
                                expectedMinutesPerPiece: hist.averageMinutesPerPiece,
                                detectedMinutesPerPiece: phaseTimes[phaseId]?.detectedMinutesPerPiece || 0,
                                enabled: phaseTimes[phaseId]?.enabled ?? true
                            };
                            articleModified = true;
                        }
                    }
                }
            });

            if (articleModified) {
                currentBatch.update(doc.ref, { phaseTimes });
                batchCount++;
                totalUpdated++;

                if (batchCount === 500) {
                    await currentBatch.commit();
                    currentBatch = adminDb.batch();
                    batchCount = 0;
                }
            }
        }

        if (batchCount > 0) {
            await currentBatch.commit();
        }

        if (totalUpdated > 0) {
            await bumpMrpSyncVersion('jobsBom', 'article-management:syncAllHistoricalToTargets');
        }

        revalidatePath('/admin/article-management');
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-time-analysis');

        return {
            success: true,
            message: `Sincronizzazione completata. Aggiornati ${totalUpdated} articoli.`,
            updatedCount: totalUpdated
        };
    } catch (error: any) {
        console.error('Error in syncAllHistoricalToTargets:', error);
        return { success: false, message: "Errore durante la sincronizzazione: " + error.message, updatedCount: 0 };
    }
}
