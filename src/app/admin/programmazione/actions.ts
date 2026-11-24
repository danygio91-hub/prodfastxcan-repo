'use server';

import { revalidatePath } from 'next/cache';
import { 
    getJobOrders as fetchAllJobOrders, 
    getPlannedJobOrders,
    getProductionJobOrders,
    getCompletedJobOrders,
    getDepartments as fetchAllDepartments,
    saveManualJobOrder,
    getWorkCycles,
    createPhasesFromCycle,
    createODL,
    cancelODL,
    getNextOdlNumber,
    ensureOdlNumeratorInitialized,
    markJobAsPrinted as markJobAsPrintedSSoT
} from '@/app/admin/data-management/actions';
import { parseStandardOdl, getCleanOdlValue, getJobCleanOdl } from '@/lib/odl-numerator';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import {
    getJobDisplayStatus,
    rollbackLastCompletedPhase,
    isPlannedStatusValue,
    evaluateJobStartEligibility,
    type JobDisplayStatus,
} from '@/lib/job-status';
import { convertTimestampsToDates, parseRobustDate, extractAnnoCompetenza, generateJobDocumentId, serializeForClient } from '@/lib/utils';
import { distributeTheoreticalTimes } from '@/lib/production-time-server-utils';
import { buildJobBOMItemsFromArticle, calculateBOMRequirement } from '@/lib/inventory-utils';
import { fetchInChunks, checkJobOrderExists, getJobOrderRefAndSnap } from '@/lib/firestore-utils';
import { getISOWeek, getISOWeekYear, format, addWeeks } from 'date-fns';
import { generatePlanningExcelBuffer, type ExportJobData } from '@/lib/excel-export';
import { formatBulkStartFeedback } from '@/lib/bulk-start-feedback';
import {
    computeNextChildOrdinePF,
    computeSplitJobPayloads,
    normalizeChildJobId,
} from '@/lib/job-split-logic';
import {
    getJobDepartmentGroup,
    ALL_TRACKED_CAPACITY_DEPTS,
    isCapacityPeriodAtOrAfter,
    resolveBucketWithBaseline,
    type DayCapacityConfigData,
    type DefaultCapacityBaselineData,
} from '@/lib/capacity-utils';
export type { DayCapacityConfigData };
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';
import { bumpMrpSyncVersion, readMrpSyncMeta, DEFAULT_MRP_SYNC_META, type MrpSyncMeta } from '@/lib/mrp-sync';
import { resolveDepartmentForNewJob } from '@/lib/department-utils';
import type { JobOrder, JobPhase, Department, RawMaterial, PurchaseOrder, Article, WorkCycle, JobBillOfMaterialsItem, MaterialWithdrawal } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

/**
 * FASE 96 & FASE 97-TER: Helper di Idratazione SSoT Magazzino Aggregata e Parallela + Raccolta Scarichi Attivi.
 * Esegue il fetch di `materialWithdrawals` in modo aggregato e parallelo (Promise.all su chunk <= 30)
 * sia per `materialId` sia per `materialCode`, filtra `status !== 'cancelled'`, applica `hydrateMaterialWithWithdrawals`
 * e restituisce sia i materiali idratati sia i `materialWithdrawals` validi per l'override MRP.
 */
async function hydrateMaterialsAndCollectWithdrawalsInParallel(
    rawMaterials: RawMaterial[],
    extraMaterialCodes: string[] = []
): Promise<{
    hydratedMaterials: RawMaterial[];
    materialWithdrawals: MaterialWithdrawal[];
}> {
    if ((!rawMaterials || rawMaterials.length === 0) && extraMaterialCodes.length === 0) {
        return { hydratedMaterials: [], materialWithdrawals: [] };
    }

    const uniqueMaterialIds = Array.from(
        new Set((rawMaterials || []).map((m) => (m?.id || '').trim()).filter(Boolean))
    );
    const uniqueMaterialCodes = Array.from(
        new Set([
            ...(rawMaterials || []).map((m) => (m?.code || '').trim().toUpperCase()),
            ...(extraMaterialCodes || []).map((c) => (c || '').trim().toUpperCase()),
        ].filter(Boolean))
    );

    const CHUNK_SIZE = 30;
    const idChunks: string[][] = [];
    for (let i = 0; i < uniqueMaterialIds.length; i += CHUNK_SIZE) {
        idChunks.push(uniqueMaterialIds.slice(i, i + CHUNK_SIZE));
    }

    const codeChunks: string[][] = [];
    for (let i = 0; i < uniqueMaterialCodes.length; i += CHUNK_SIZE) {
        codeChunks.push(uniqueMaterialCodes.slice(i, i + CHUNK_SIZE));
    }

    const [byIdSnaps, byCodeSnaps] = await Promise.all([
        idChunks.length > 0
            ? Promise.all(
                idChunks.map((chunk) =>
                    adminDb.collection('materialWithdrawals').where('materialId', 'in', chunk).get()
                )
            )
            : Promise.resolve([]),
        codeChunks.length > 0
            ? Promise.all(
                codeChunks.map((chunk) =>
                    adminDb.collection('materialWithdrawals').where('materialCode', 'in', chunk).get()
                )
            )
            : Promise.resolve([]),
    ]);

    const seenDocIds = new Set<string>();
    const validWithdrawals: MaterialWithdrawal[] = [];
    const withdrawalsByMaterialId = new Map<string, MaterialWithdrawal[]>();
    const withdrawalsByMaterialCode = new Map<string, MaterialWithdrawal[]>();

    const registerSnapDoc = (docSnap: FirebaseFirestore.QueryDocumentSnapshot) => {
        if (seenDocIds.has(docSnap.id)) return;
        seenDocIds.add(docSnap.id);

        const rawData = docSnap.data();
        if (String(rawData?.status || '').toLowerCase().trim() === 'cancelled') return;

        const w = serializeForClient({
            id: docSnap.id,
            ...convertTimestampsToDates(rawData),
        }) as MaterialWithdrawal;

        validWithdrawals.push(w);

        const mId = (w.materialId || '').trim();
        if (mId) {
            const list = withdrawalsByMaterialId.get(mId);
            if (list) list.push(w);
            else withdrawalsByMaterialId.set(mId, [w]);
        }

        const mCode = (w.materialCode || '').trim().toUpperCase();
        if (mCode) {
            const list = withdrawalsByMaterialCode.get(mCode);
            if (list) list.push(w);
            else withdrawalsByMaterialCode.set(mCode, [w]);
        }
    };

    for (const snap of byIdSnaps) {
        snap.forEach(registerSnapDoc);
    }
    for (const snap of byCodeSnaps) {
        snap.forEach(registerSnapDoc);
    }

    const hydratedMaterials = (rawMaterials || []).map((rawMat) => {
        if (!rawMat?.id || !Array.isArray(rawMat.batches) || rawMat.batches.length === 0) {
            return rawMat;
        }
        const byId = withdrawalsByMaterialId.get(rawMat.id) || [];
        const byCode = rawMat.code ? withdrawalsByMaterialCode.get(rawMat.code.trim().toUpperCase()) || [] : [];
        const mergedMap = new Map<string, MaterialWithdrawal>();
        byId.forEach((w) => mergedMap.set(w.id, w));
        byCode.forEach((w) => mergedMap.set(w.id, w));
        return hydrateMaterialWithWithdrawals(rawMat, Array.from(mergedMap.values()));
    });

    return {
        hydratedMaterials,
        materialWithdrawals: validWithdrawals,
    };
}

async function hydrateMaterialsSSoTInParallel(rawMaterials: RawMaterial[]): Promise<RawMaterial[]> {
    const { hydratedMaterials } = await hydrateMaterialsAndCollectWithdrawalsInParallel(rawMaterials);
    return hydratedMaterials;
}

export async function getJobOrders(): Promise<JobOrder[]> {
    return serializeForClient(await fetchAllJobOrders());
}

/**
 * Carica da Firestore le commesse PIANIFICATE, AVVIATE e COMPLETATE.
 * Include le commesse concluse/spedite affinché la Vista Settimana e il Secchiello (Capacità)
 * mantengano la corretta visibilità del carico settimanale anche a fronte di avanzamenti di stato.
 */
export async function getActiveJobOrders(): Promise<JobOrder[]> {
    const [planned, production, completed] = await Promise.all([
        getPlannedJobOrders(),
        getProductionJobOrders(),
        getCompletedJobOrders(),
    ]);
    return serializeForClient([...planned, ...production, ...completed]);
}

/**
 * Lazy Loading On-Demand: Carica le commesse CONCLUSE solo al click fisico dell'utente sul relativo tab.
 */
export async function fetchCompletedJobOrdersAction(): Promise<JobOrder[]> {
    return serializeForClient(await getCompletedJobOrders());
}

export async function getDepartments(): Promise<Department[]> {
    return await fetchAllDepartments();
}

export { saveManualJobOrder, getWorkCycles, checkJobOrderExists, getNextOdlNumber };
export async function checkJobExists(ordinePF: string, annoCompetenza?: number) {
    const year = annoCompetenza ?? new Date().getFullYear();
    return await checkJobOrderExists(adminDb, ordinePF, year);
}

/**
 * FASE 100-BIS: Server Action leggerissima per leggere il Version Token MRP
 * (`settings/mrp_sync_meta`) con 1 singola lettura Firestore.
 */
export async function getMrpSyncMeta(): Promise<MrpSyncMeta> {
    return serializeForClient(await readMrpSyncMeta());
}

/**
 * Targeted Fetching MRP:
 * Scarica SOLO le giacenze e i Purchase Orders per i materiali effettivamente
 * necessari alle commesse attualmente visualizzate nella griglia.
 */
export async function getTargetedMRPData(
    materialCodes: string[],
    articleCodes: string[] = [],
    options?: { includeOpenSessions?: boolean }
): Promise<{
    rawMaterials: RawMaterial[];
    purchaseOrders: PurchaseOrder[];
    articles: Article[];
    globalSettings: GlobalSettings | null;
    materialWithdrawals: MaterialWithdrawal[];
    activeSessions?: any[];
    syncMeta: MrpSyncMeta;
}> {
    try {
        const uniqueMatCodes = new Set<string>(
            materialCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        );
        const uniqueArtCodes = [...new Set(
            articleCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        )];

        const articlesById = new Map<string, Article>();
        const chunkSize = 30; // Limite 'in' di Firestore

        // 1. Fetch mirato Articoli in parallelo (Promise.all su tutti i chunk)
        if (uniqueArtCodes.length > 0) {
            const artChunks: string[][] = [];
            for (let i = 0; i < uniqueArtCodes.length; i += chunkSize) {
                artChunks.push(uniqueArtCodes.slice(i, i + chunkSize));
            }

            const artSnaps = await Promise.all(
                artChunks.map(chunk =>
                    adminDb.collection("articles").where("code", "in", chunk).get()
                )
            );

            for (const artSnap of artSnaps) {
                artSnap.forEach(d => {
                    const art = { ...convertTimestampsToDates(d.data()), id: d.id } as Article;
                    articlesById.set(d.id, art);
                    (art.billOfMaterials || []).forEach(b => {
                        if (b.component) uniqueMatCodes.add(b.component.trim().toUpperCase());
                    });
                });
            }
        }

        const articles = Array.from(articlesById.values());
        const finalMatCodes = [...uniqueMatCodes];
        const rawMaterialsById = new Map<string, RawMaterial>();
        const purchaseOrdersById = new Map<string, PurchaseOrder>();

        const matChunks: string[][] = [];
        for (let i = 0; i < finalMatCodes.length; i += chunkSize) {
            matChunks.push(finalMatCodes.slice(i, i + chunkSize));
        }

        // 2. Fetch mirato RawMaterials, PurchaseOrders, GlobalSettings, Version Token e (opz.) Sessioni aperte in parallelo
        const [matSnaps, poSnaps, settingsSnap, openSessionsSnap, syncMeta] = await Promise.all([
            matChunks.length > 0
                ? Promise.all(
                    matChunks.map(chunk =>
                        adminDb.collection("rawMaterials").where("code", "in", chunk).get()
                    )
                )
                : Promise.resolve([]),
            matChunks.length > 0
                ? Promise.all(
                    matChunks.map(chunk =>
                        adminDb.collection("purchaseOrders").where("materialCode", "in", chunk).get()
                    )
                )
                : Promise.resolve([]),
            adminDb.collection("settings").doc("global").get().catch(e => {
                console.warn("Impossibile caricare impostazioni globali in getTargetedMRPData:", e);
                return null;
            }),
            options?.includeOpenSessions
                ? adminDb.collection("materialSessions").where("status", "==", "open").get().catch(() => null)
                : Promise.resolve(null),
            readMrpSyncMeta(),
        ]);

        for (const matSnap of matSnaps) {
            matSnap.forEach(d => {
                rawMaterialsById.set(d.id, { ...convertTimestampsToDates(d.data()), id: d.id } as RawMaterial);
            });
        }

        for (const poSnap of poSnaps) {
            poSnap.forEach(d => {
                const po = { ...convertTimestampsToDates(d.data()), id: d.id } as PurchaseOrder;
                const st = String(po.status || '').toLowerCase();
                if (st !== 'completed' && st !== 'cancelled' && st !== 'received') {
                    purchaseOrdersById.set(d.id, po);
                }
            });
        }

        // 3. FASE 96 & FASE 97-TER: Idratazione SSoT Magazzino aggregata e parallela + raccolta materialWithdrawals validi
        const { hydratedMaterials: rawMaterials, materialWithdrawals } =
            await hydrateMaterialsAndCollectWithdrawalsInParallel(
                Array.from(rawMaterialsById.values()),
                finalMatCodes
            );
        const purchaseOrders = Array.from(purchaseOrdersById.values());

        let globalSettings: GlobalSettings | null = null;
        if (settingsSnap && settingsSnap.exists) {
            globalSettings = convertTimestampsToDates(settingsSnap.data()) as GlobalSettings;
        }

        const activeSessions = openSessionsSnap
            ? openSessionsSnap.docs.map((doc) =>
                serializeForClient({ id: doc.id, ...convertTimestampsToDates(doc.data()) })
            )
            : undefined;

        return {
            rawMaterials,
            purchaseOrders,
            articles,
            globalSettings,
            materialWithdrawals,
            ...(activeSessions !== undefined ? { activeSessions } : {}),
            syncMeta,
        };
    } catch (error) {
        console.error("Errore durante getTargetedMRPData:", error);
        return {
            rawMaterials: [],
            purchaseOrders: [],
            articles: [],
            globalSettings: null,
            materialWithdrawals: [],
            syncMeta: { ...DEFAULT_MRP_SYNC_META },
        };
    }
}

/**
 * FASE 37, FASE 97-TER & FASE 100-BIS: Server Action per forzare la rilettura completa dello stock,
 * dei prelievi materiali, degli ordini fornitore, delle sessioni aperte e ricalcolare lo stato MRP.
 */
export async function forceRecalculateMRPAction(): Promise<{
    success: boolean;
    jobs: JobOrder[];
    rawMaterials: RawMaterial[];
    purchaseOrders: PurchaseOrder[];
    articles: Article[];
    globalSettings: GlobalSettings | null;
    materialWithdrawals: MaterialWithdrawal[];
    activeSessions: any[];
    syncMeta: MrpSyncMeta;
    message: string;
}> {
    try {
        console.log("[MRP-RECALC] Avvio ricalcolo forzato MRP...");
        
        // 1. Rileggi tutte le commesse attive (inclusi inserimenti massivi recenti)
        const jobs = await getActiveJobOrders();
        
        // 2. Raccogli tutti i codici materiale e articolo
        const matCodes = new Set<string>();
        const artCodes = new Set<string>();

        jobs.forEach(job => {
            if (job.billOfMaterials && job.billOfMaterials.length > 0) {
                job.billOfMaterials.forEach(b => {
                    if (b.component) matCodes.add(b.component.trim().toUpperCase());
                });
            } else if (job.details) {
                artCodes.add(job.details.trim().toUpperCase());
            }
        });

        // 3. Esegui la rilettura mirata e profonda di articoli, stock materie prime, prelievi, PO fornitori e sessioni aperte
        const mrpData = await getTargetedMRPData(Array.from(matCodes), Array.from(artCodes), {
            includeOpenSessions: true,
        });

        return {
            success: true,
            jobs,
            rawMaterials: mrpData.rawMaterials,
            purchaseOrders: mrpData.purchaseOrders,
            articles: mrpData.articles,
            globalSettings: mrpData.globalSettings,
            materialWithdrawals: mrpData.materialWithdrawals,
            activeSessions: mrpData.activeSessions || [],
            syncMeta: mrpData.syncMeta,
            message: `Ricalcolo completato: verificate ${jobs.length} commesse con ${mrpData.rawMaterials.length} materie prime e ${mrpData.purchaseOrders.length} ordini fornitore.`,
        };
    } catch (error: any) {
        console.error("[MRP-RECALC] Errore ricalcolo MRP:", error);
        return {
            success: false,
            jobs: [],
            rawMaterials: [],
            purchaseOrders: [],
            articles: [],
            globalSettings: null,
            materialWithdrawals: [],
            activeSessions: [],
            syncMeta: { ...DEFAULT_MRP_SYNC_META },
            message: error?.message || "Errore durante il ricalcolo forzato dell'MRP.",
        };
    }
}

/**
 * Toggle ODL stampato per commessa (Workflow ODL)
 * Se autoMoveToProduction è true, aggiorna anche lo stato della commessa a 'In Produzione'.
 */
export async function toggleJobPrinted(
    jobId: string, 
    currentStatus: boolean, 
    autoMoveToProduction: boolean = false
): Promise<boolean> {
    try {
        const nextStatus = !currentStatus;
        const payload: Record<string, any> = {
            isPrinted: nextStatus,
            odlPrinted: nextStatus,
            updatedAt: new Date().toISOString(),
        };
        if (nextStatus && autoMoveToProduction) {
            payload.status = 'In Produzione';
        }
        await adminDb.collection("jobOrders").doc(jobId).update(payload);
        return nextStatus;
    } catch (e) {
        console.error("Errore durante toggleJobPrinted:", e);
        return currentStatus;
    }
}

/**
 * Segna la commessa come stampata (allineato con Gestione Dati Commesse)
 * Non forza lo stato a 'In Produzione', ma imposta solo isPrinted e odlPrinted.
 */
export async function markJobAsPrinted(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({
            isPrinted: true,
            odlPrinted: true,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        revalidatePath('/admin/data-management');
        return { success: true, message: 'Commessa segnata come stampata.' };
    } catch (e: any) {
        console.error("Errore durante markJobAsPrinted:", e);
        return { success: false, message: e?.message || "Errore durante la marcatura di stampa." };
    }
}

/**
 * Backward compatibility alias
 */
export async function markJobAsPrintedAndInProduction(jobId: string): Promise<boolean> {
    const res = await markJobAsPrinted(jobId);
    return res.success;
}

/**
 * Server Action: Validazione Unicità Numero ODL (Anti-Doppione)
 * Interroga Firestore per verificare se esiste già un documento con quel numeroODL.
 * Esclude la commessa corrente (l'id non deve coincidere) per evitare falsi positivi.
 */
export async function checkUniqueODL(
    numeroODL: string, 
    currentJobId: string
): Promise<{ isUnique: boolean; message?: string; conflictingJob?: { id: string; ordinePF: string } }> {
    try {
        const val = (numeroODL || '').trim();
        const isPlaceholderVal = !val || val === 'N/D' || val === 'N/A' || val === 'MANUALE' || val === '---';
        if (isPlaceholderVal) {
            return { isUnique: true };
        }

        // Query Firestore sia su numeroODLInterno che su numeroODL
        const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
            adminDb.collection("jobOrders").where("numeroODLInterno", "==", val).get(),
            adminDb.collection("jobOrders").where("numeroODL", "==", val).get(),
        ];

        // Se è un numero puro (es. "2396"), interroga anche il tipo numerico per retrocompatibilità
        if (!isNaN(Number(val)) && !val.includes('-') && !val.includes('/')) {
            const num = Number(val);
            queries.push(
                adminDb.collection("jobOrders").where("numeroODLInterno", "==", num).get(),
                adminDb.collection("jobOrders").where("numeroODL", "==", num).get()
            );
        }

        const snapshots = await Promise.all(queries);
        const conflictDocs = new Map<string, FirebaseFirestore.DocumentData>();

        for (const snap of snapshots) {
            snap.forEach(doc => {
                if (doc.id !== currentJobId) {
                    conflictDocs.set(doc.id, doc.data());
                }
            });
        }

        if (conflictDocs.size > 0) {
            const [conflictId, conflictData] = Array.from(conflictDocs.entries())[0];
            const pf = conflictData?.ordinePF ? ` (${conflictData.ordinePF})` : '';
            return {
                isUnique: false,
                message: `Errore: Il numero ODL '${val}' è già assegnato a un'altra commessa${pf}.`,
                conflictingJob: {
                    id: conflictId,
                    ordinePF: conflictData?.ordinePF || conflictId,
                }
            };
        }

        return { isUnique: true };
    } catch (error: any) {
        console.error("Errore validazione unicità ODL:", error);
        return { isUnique: false, message: "Errore durante la verifica di unicità dell'ODL." };
    }
}

/**
 * Aggiornamento rapido N° ODL (on blur)
 */
export async function updateJobOdlNumber(jobId: string, newOdl: string): Promise<{ success: boolean; message: string; nextOdl?: string }> {
    try {
        const val = (newOdl || '').trim();
        const isPlaceholderVal = !val || val === 'N/D' || val === 'N/A' || val === 'MANUALE' || val === '---';
        const finalVal = isPlaceholderVal ? null : val;

        // Validazione server-side unicità ODL
        if (finalVal) {
            const check = await checkUniqueODL(finalVal, jobId);
            if (!check.isUnique) {
                return {
                    success: false,
                    message: check.message || `Errore: Il numero ODL '${finalVal}' è già assegnato a un'altra commessa.`
                };
            }
        }

        const parsedStandard = parseStandardOdl(finalVal);
        if (parsedStandard) {
            await ensureOdlNumeratorInitialized();
            const numeratorsRef = adminDb.collection("settings").doc("numerators");
            await adminDb.runTransaction(async (t) => {
                const numSnap = await t.get(numeratorsRef);
                const currentLast = numSnap.exists ? (Number(numSnap.data()?.lastOdlNumber) || 0) : 0;
                const currentYear = numSnap.exists ? (Number(numSnap.data()?.lastOdlYear) || parsedStandard.yearTwoDigits) : parsedStandard.yearTwoDigits;
                const nextMax = parsedStandard.yearTwoDigits === currentYear
                    ? Math.max(currentLast, parsedStandard.progressive)
                    : parsedStandard.progressive;

                t.update(adminDb.collection("jobOrders").doc(jobId), {
                    numeroODLInterno: finalVal,
                    numeroODL: finalVal,
                    odlCounter: parsedStandard.progressive,
                    updatedAt: admin.firestore.Timestamp.now(),
                });

                t.set(
                    numeratorsRef,
                    {
                        lastOdlNumber: nextMax,
                        lastOdlYear: parsedStandard.yearTwoDigits,
                        updatedAt: admin.firestore.Timestamp.now(),
                    },
                    { merge: true }
                );
            });
        } else {
            await adminDb.collection("jobOrders").doc(jobId).update({
                numeroODLInterno: finalVal,
                numeroODL: finalVal,
                updatedAt: admin.firestore.Timestamp.now(),
            });
        }

        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobOdlNumber');
        const nextOdl = await getNextOdlNumber();
        return { success: true, message: 'N° ODL aggiornato con successo.', nextOdl };
    } catch (error) {
        console.error("Errore salvataggio N° ODL:", error);
        return { success: false, message: "Errore durante il salvataggio del N° ODL." };
    }
}

/**
 * Avvia Commessa in Produzione (Workflow ODL standard del sistema)
 * Richiama la Server Action transazionale createODL usata in Gestione Dati Commesse:
 * - Valida stato backlog (planned/in attesa/in pianificazione)
 * - Valida presenza di Ciclo e Distinta Base
 * - Riserva e incrementa il contatore settings/numerators (solo se formato standard /^(\d+)-(\d{2})$/)
 * - Imposta status: 'DA_INIZIARE', numeroODL, numeroODLInterno e odlCreationDate
 */
export async function startJobProduction(
    jobId: string, 
    manualOdlNumberStr?: string
): Promise<{ success: boolean; message: string; error?: string; job?: Partial<JobOrder>; nextOdl?: string }> {
    try {
        const cleanInputOdl = getCleanOdlValue(manualOdlNumberStr);
        if (cleanInputOdl) {
            const { jobSnap } = await getJobOrderRefAndSnap(adminDb, jobId);
            const existingOnJob = jobSnap.exists ? getJobCleanOdl(jobSnap.data() as JobOrder) : '';
            // FASE 98-BIS: Non bloccare con checkUniqueODL se si sta mantenendo lo stesso ODL già assegnato sulla commessa
            if (!existingOnJob || cleanInputOdl !== existingOnJob) {
                const uniqueCheck = await checkUniqueODL(cleanInputOdl, jobSnap.exists ? jobSnap.id : jobId);
                if (!uniqueCheck.isUnique) {
                    const dupErr = uniqueCheck.message || "Attenzione: il numero ODL inserito è già in uso su un'altra commessa.";
                    return { success: false, error: dupErr, message: dupErr };
                }
            }
        }

        const res = await createODL(jobId, cleanInputOdl || undefined);
        if (!res.success) {
            return {
                success: false,
                error: res.error || res.message,
                message: res.message,
            };
        }

        const [{ jobSnap }, nextOdl] = await Promise.all([
            getJobOrderRefAndSnap(adminDb, jobId),
            getNextOdlNumber(),
        ]);
        const updatedData = jobSnap.exists ? (jobSnap.data() as JobOrder) : undefined;

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        return {
            success: true,
            message: res.message,
            nextOdl,
            job: updatedData ? {
                status: updatedData.status,
                numeroODL: updatedData.numeroODLInterno || updatedData.numeroODL,
                numeroODLInterno: updatedData.numeroODLInterno || updatedData.numeroODL,
                odlCreationDate: updatedData.odlCreationDate ? new Date().toISOString() : undefined,
                odlCounter: updatedData.odlCounter,
            } : undefined
        };
    } catch (e: any) {
        console.error("Errore in startJobProduction:", e);
        const msg = e?.message || "Errore durante l'avvio della commessa.";
        return { success: false, error: msg, message: msg };
    }
}

/**
 * Allineamento Rigoroso: Modifica Stato Commessa (4 stati SSoT)
 * Applica gli stessi identici payload e logiche usati da Console Operatore,
 * Gestione Dati Commesse e Console Produzione Admin.
 */
export async function updateJobExecutionStatus(
    jobId: string, 
    targetStatus: JobDisplayStatus
): Promise<{ success: boolean; message: string; odlNumber?: string; nextOdl?: string; updatedPhases?: JobPhase[]; updatedStatus?: string }> {
    try {
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const jobSnap = await jobRef.get();
        if (!jobSnap.exists) {
            return { success: false, message: "Commessa non trovata." };
        }
        const job = jobSnap.data() as JobOrder;
        const currentStatusLower = (job.status || '').toLowerCase().trim();

        // 1. STATO: PIANIFICATA
        if (targetStatus === 'Pianificata') {
            const activeOpSnaps = await adminDb.collection("operators")
                .where("activeJobId", "in", [jobId, job.ordinePF].filter(Boolean))
                .get();

            const batch = adminDb.batch();
            activeOpSnaps.forEach(opDoc => {
                batch.update(opDoc.ref, { stato: 'inattivo', activePhaseName: null, activeJobId: null });
            });

            const resetPhases = (job.phases || []).map(p => ({
                ...p,
                status: 'pending' as const,
                forced: false,
                workPeriods: [],
                materialConsumptions: [],
                qualityResult: null,
                materialReady: p.isIndependent || p.type === 'preparation'
            }));

            batch.update(jobRef, {
                status: 'IN_PIANIFICAZIONE',
                odlCreationDate: admin.firestore.FieldValue.delete(),
                overallStartTime: admin.firestore.FieldValue.delete(),
                overallEndTime: admin.firestore.FieldValue.delete(),
                forcedCompletion: admin.firestore.FieldValue.delete(),
                packingListId: admin.firestore.FieldValue.delete(),
                isProblemReported: false,
                phases: resetPhases,
                updatedAt: admin.firestore.Timestamp.now()
            });

            await batch.commit();
            await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobExecutionStatus:Pianificata');
            revalidatePath('/admin/data-management');
            revalidatePath('/admin/production-console');
            return {
                success: true,
                message: `Commessa ${job.ordinePF || jobId} riportata in pianificazione.`,
                updatedPhases: serializeForClient(resetPhases),
                updatedStatus: 'IN_PIANIFICAZIONE'
            };
        }

        // 2. STATO: IN PRODUZIONE
        if (targetStatus === 'In Produzione') {
            const hasAnyPhaseInProgress = (job.phases || []).some(p => p.status === 'in-progress');
            const hasAnyPhaseCompleted = (job.phases || []).some(p => p.status === 'completed');
            const isUnstartedSplitChild = Boolean(job.parentJobId) && !job.odlCreationDate;
            const isBacklogPlanned =
                !hasAnyPhaseInProgress &&
                (!hasAnyPhaseCompleted || isUnstartedSplitChild) &&
                isPlannedStatusValue(currentStatusLower);

            if (isBacklogPlanned) {
                // Avvia tramite createODL (mantiene eventuale ODL già presente o genera nuovo progressivo)
                const existingOdl = getJobCleanOdl(job);
                const res = await createODL(jobId, existingOdl || undefined);
                if (!res.success) {
                    return { success: false, message: res.message };
                }
                const [refreshed, nextOdl] = await Promise.all([
                    jobRef.get(),
                    getNextOdlNumber().catch(() => undefined),
                ]);
                const refreshedData = refreshed.data() as JobOrder;
                return { 
                    success: true, 
                    message: res.message, 
                    odlNumber: refreshedData?.numeroODLInterno || refreshedData?.numeroODL || undefined,
                    nextOdl,
                    updatedPhases: refreshedData?.phases ? serializeForClient(refreshedData.phases) : undefined,
                    updatedStatus: refreshedData?.status || 'DA_INIZIARE'
                };
            } else {
                // FASE 78: Riapertura da stato chiuso/completato (FINE_PRODUZIONE, QLTY_PACK, SPEDITO, CHIUSO, completed, ecc.)
                // Rollback dell'ultima fase completata (es. Imballo/Collaudo/Fine Linea) a 'pending' (es. da 10/10 a 9/10)
                const { updatedPhases } = rollbackLastCompletedPhase(job.phases || []);
                const nextRawStatus = 'IN_PRODUZIONE';

                const batch = adminDb.batch();
                batch.update(jobRef, {
                    status: nextRawStatus,
                    phases: updatedPhases,
                    forcedCompletion: admin.firestore.FieldValue.delete(),
                    overallEndTime: admin.firestore.FieldValue.delete(),
                    packingListId: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.Timestamp.now()
                });
                await batch.commit();
                await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobExecutionStatus:InProduzione');
                revalidatePath('/admin/data-management');
                revalidatePath('/admin/production-console');
                return {
                    success: true,
                    message: `Commessa ${job.ordinePF || jobId} riaperta in produzione.`,
                    updatedPhases: serializeForClient(updatedPhases),
                    updatedStatus: nextRawStatus
                };
            }
        }

        // 3. STATO: COMPLETATO PROD.
        if (targetStatus === 'Completato Prod.') {
            const updatedPhases = (job.phases || []).map(phase => {
                const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
                    if (wp.end === null) return { ...wp, end: new Date() };
                    return wp;
                });
                return {
                    ...phase,
                    status: 'completed' as const,
                    forced: true,
                    isEstimated: false,
                    workPeriods: updatedWorkPeriods
                };
            });

            const activeOpSnaps = await adminDb.collection("operators")
                .where("activeJobId", "in", [jobId, job.ordinePF].filter(Boolean))
                .get();

            const batch = adminDb.batch();
            activeOpSnaps.forEach(opDoc => {
                batch.update(opDoc.ref, { stato: 'inattivo', activePhaseName: null, activeJobId: null });
            });

            batch.update(jobRef, {
                status: 'completed',
                overallEndTime: admin.firestore.Timestamp.now(),
                forcedCompletion: true,
                phases: updatedPhases,
                updatedAt: admin.firestore.Timestamp.now()
            });

            await batch.commit();
            await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobExecutionStatus:Completato');
            revalidatePath('/admin/production-console');
            return {
                success: true,
                message: `Commessa ${job.ordinePF || jobId} completata con successo.`,
                updatedPhases: serializeForClient(updatedPhases),
                updatedStatus: 'completed'
            };
        }

        // 4. STATO: SPEDITO
        if (targetStatus === 'Spedito') {
            const updatedPhases = (job.phases || []).map(phase => {
                const updatedWorkPeriods = (phase.workPeriods || []).map(wp => {
                    if (wp.end === null) return { ...wp, end: new Date() };
                    return wp;
                });
                return {
                    ...phase,
                    status: 'completed' as const,
                    forced: true,
                    isEstimated: false,
                    workPeriods: updatedWorkPeriods
                };
            });

            const activeOpSnaps = await adminDb.collection("operators")
                .where("activeJobId", "in", [jobId, job.ordinePF].filter(Boolean))
                .get();

            const batch = adminDb.batch();
            activeOpSnaps.forEach(opDoc => {
                batch.update(opDoc.ref, { stato: 'inattivo', activePhaseName: null, activeJobId: null });
            });

            batch.update(jobRef, {
                status: 'SPEDITA',
                overallEndTime: admin.firestore.Timestamp.now(),
                forcedCompletion: true,
                phases: updatedPhases,
                lastStatusChange: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.Timestamp.now()
            });

            await batch.commit();
            await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobExecutionStatus:Spedito');
            revalidatePath('/admin/production-console');
            revalidatePath('/operator/packing');
            return {
                success: true,
                message: `Commessa ${job.ordinePF || jobId} contrassegnata come spedita.`,
                updatedPhases: serializeForClient(updatedPhases),
                updatedStatus: 'SPEDITA'
            };
        }

        return { success: false, message: `Stato non riconosciuto: ${targetStatus}` };
    } catch (e: any) {
        console.error("Errore in updateJobExecutionStatus:", e);
        return { success: false, message: e?.message || "Errore durante l'aggiornamento dello stato." };
    }
}

/**
 * Backward compatibility alias per updateJobStatus
 */
export async function updateJobStatus(jobId: string, newStatus: string): Promise<{ success: boolean; message: string }> {
    const validTargets: JobDisplayStatus[] = ['Pianificata', 'In Produzione', 'Completato Prod.', 'Spedito'];
    if (validTargets.includes(newStatus as JobDisplayStatus)) {
        return await updateJobExecutionStatus(jobId, newStatus as JobDisplayStatus);
    }
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobStatus');
        return { success: true, message: `Stato aggiornato a ${newStatus}.` };
    } catch (error) {
        return { success: false, message: "Errore durante l'aggiornamento dello stato." };
    }
}

/**
 * FASE 93: Aggiornamento Nota Rapida della Commessa
 */
export async function updateJobNote(
    jobId: string,
    note: string
): Promise<{ success: boolean; message: string; note?: string }> {
    try {
        const cleanId = (jobId || '').trim();
        if (!cleanId) {
            return { success: false, message: "ID commessa mancante." };
        }
        const cleanNote = (note || '').trim();
        const { jobRef, jobSnap } = await getJobOrderRefAndSnap(adminDb, cleanId);

        if (!jobSnap.exists) {
            return { success: false, message: "Commessa non trovata su Firestore." };
        }

        await jobRef.update({
            note: cleanNote,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobNote');

        return {
            success: true,
            message: cleanNote ? "Nota commessa salvata con successo." : "Nota commessa rimossa.",
            note: cleanNote,
        };
    } catch (error: any) {
        console.error("Errore in updateJobNote:", error);
        return {
            success: false,
            message: error?.message || "Errore durante il salvataggio della nota commessa.",
        };
    }
}

/**
 * Aggiornamento Data Consegna Finale (on blur / Enter)
 */
export async function updateJobDeliveryDate(
    jobId: string,
    newDate: string
): Promise<{ success: boolean; message: string; updatedFields?: Partial<JobOrder> }> {
    try {
        const val = (newDate || '').trim();
        let isoWeek: number | null = null;
        let weekYear: number | null = null;
        let targetWeek: string | null = null;
        if (val) {
            const d = parseRobustDate(val) || new Date(val);
            if (d && !isNaN(d.getTime())) {
                isoWeek = getISOWeek(d);
                weekYear = getISOWeekYear(d);
                targetWeek = `${weekYear}-W${String(isoWeek).padStart(2, '0')}`;
            }
        }

        const nowIso = new Date().toISOString();
        const updatePayload: Record<string, any> = {
            dataConsegnaFinale: val,
            updatedAt: nowIso,
        };
        if (isoWeek !== null) updatePayload.isoWeek = isoWeek;
        if (weekYear !== null) updatePayload.weekYear = weekYear;
        if (targetWeek !== null) updatePayload.targetWeek = targetWeek;

        await adminDb.collection("jobOrders").doc(jobId).update(updatePayload);
        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobDeliveryDate');
        return {
            success: true,
            message: 'Data di consegna aggiornata con successo.',
            updatedFields: {
                dataConsegnaFinale: val,
                isoWeek,
                weekYear,
                targetWeek,
                updatedAt: nowIso,
            },
        };
    } catch (error) {
        console.error("Errore aggiornamento data consegna:", error);
        return { success: false, message: "Errore durante il salvataggio della data." };
    }
}

/**
 * Riassegnazione manuale settimana per una commessa
 */
export async function updateJobAssignedWeek(
    jobId: string, 
    assignedDate: string | null,
    isoWeek: number | null, 
    weekYear: number | null,
    targetWeek: string | null
): Promise<{ success: boolean; message: string; updatedFields?: Partial<JobOrder> }> {
    try {
        const nowIso = new Date().toISOString();
        const payload: Record<string, any> = {
            assignedDate: assignedDate || null,
            isoWeek: isoWeek || null,
            weekYear: weekYear || null,
            targetWeek: targetWeek || null,
            updatedAt: nowIso,
        };
        await adminDb.collection("jobOrders").doc(jobId).update(payload);
        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateJobAssignedWeek');
        return {
            success: true,
            message: 'Settimana aggiornata con successo.',
            updatedFields: {
                assignedDate: assignedDate || undefined,
                isoWeek: isoWeek || null,
                weekYear: weekYear || null,
                targetWeek: targetWeek || null,
                updatedAt: nowIso,
            },
        };
    } catch (error) {
        console.error("Errore aggiornamento settimana commessa:", error);
        return { success: false, message: "Errore durante il salvataggio della settimana." };
    }
}

/**
 * Inserimento Rapido Commessa da Riga Vuota
 * Eredita automaticamente la BOM calcolata e i tempi/fasi del ciclo dal codice articolo.
 */
export async function saveQuickJobOrder(data: {
    ordinePF: string;
    cliente: string;
    articleCode: string;
    qta: number;
    dataConsegnaFinale?: string;
    department?: string;
    numeroODLInterno?: string;
}): Promise<{ success: boolean; message: string; job?: JobOrder }> {
    try {
        const { ordinePF, cliente, articleCode, qta, dataConsegnaFinale, department, numeroODLInterno } = data;
        if (!ordinePF?.trim() || !cliente?.trim() || !articleCode?.trim() || !qta) {
            return { success: false, message: "Compilare Ordine, Cliente, Articolo e Quantità." };
        }

        const annoCompetenza = extractAnnoCompetenza(dataConsegnaFinale);
        const compositeId = generateJobDocumentId(ordinePF, annoCompetenza);
        
        const checkRes = await checkJobOrderExists(adminDb, ordinePF, annoCompetenza);
        if (checkRes.exists) {
            return { success: false, message: `Esiste già una commessa con Ordine PF ${ordinePF} per l'anno ${annoCompetenza}.` };
        }

        const docRef = adminDb.collection("jobOrders").doc(compositeId);

        let phases: any[] = [];
        let jobBOM: JobBillOfMaterialsItem[] = [];
        let workCycleId = '';
        let targetDept = resolveDepartmentForNewJob({
            explicitDepartment: department,
            fallback: 'CP',
        });
        let expectedMinutesDefault = 0;

        const artSnap = await adminDb.collection("articles").doc(articleCode.toUpperCase().trim()).get();
        if (artSnap.exists) {
            const artData = artSnap.data() as Article;
            workCycleId = artData.workCycleId || '';
            targetDept = resolveDepartmentForNewJob({
                explicitDepartment: department,
                article: artData,
                fallback: 'CP',
            });
            expectedMinutesDefault = artData.expectedMinutesDefault || 0;

            // 1. Eredita Ciclo e Fasi con ripartizione tempi teorici
            if (workCycleId) {
                phases = await createPhasesFromCycle(workCycleId);
                if (expectedMinutesDefault > 0 && phases.length > 0) {
                    const historicalAverages = artData.historicalTimes?.averagePhaseTimes || [];
                    phases = distributeTheoreticalTimes(expectedMinutesDefault, phases, historicalAverages, Number(qta));
                }
            }

            // 2. Eredita BOM (Distinta Base) con calcolo fabbisogno materiali
            const compCodes = (artData.billOfMaterials || []).map(item => item.component.toUpperCase().trim());
            const [globalSettingsSnap, rawMaterials] = await Promise.all([
                adminDb.collection("settings").doc("global").get(),
                compCodes.length > 0 ? fetchInChunks<RawMaterial>(
                    adminDb.collection("rawMaterials"),
                    "code",
                    compCodes
                ) : Promise.resolve([])
            ]);
            const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;

            jobBOM = buildJobBOMItemsFromArticle({
                jobQta: Number(qta),
                articleBOM: artData.billOfMaterials || [],
                rawMaterials,
                globalSettings: globalSettings as Partial<GlobalSettings> | null,
            });
        }

        // 3. Calcolo Settimana ISO da Data Consegna
        let isoWeek: number | null = null;
        let weekYear: number | null = null;
        let targetWeek: string | null = null;
        if (dataConsegnaFinale) {
            const d = parseRobustDate(dataConsegnaFinale) || new Date(dataConsegnaFinale);
            if (d && !isNaN(d.getTime())) {
                isoWeek = getISOWeek(d);
                weekYear = getISOWeekYear(d);
                targetWeek = `${weekYear}-W${String(isoWeek).padStart(2, '0')}`;
            }
        }

        const now = new Date();
        const shortYear = now.getFullYear().toString().slice(-2);
        let odlToAssign: string | null = null;
        if (numeroODLInterno) {
            const rawVal = String(numeroODLInterno).trim();
            const dashIndex = rawVal.indexOf('-');
            if (dashIndex !== -1) {
                const numPart = rawVal.substring(0, dashIndex).match(/\d+/)?.[0] || '';
                const yearPart = rawVal.substring(dashIndex + 1).trim();
                if (numPart) {
                    odlToAssign = `${numPart.padStart(4, '0')}-${yearPart}`;
                }
            } else {
                const digits = rawVal.match(/\d+/)?.[0] || '';
                if (digits) {
                    odlToAssign = `${digits.padStart(4, '0')}-${shortYear}`;
                }
            }
        }

        const newJob: any = {
            id: compositeId,
            ordinePF: ordinePF.trim(),
            annoCompetenza: annoCompetenza,
            cliente: cliente.trim(),
            details: articleCode.toUpperCase().trim(),
            qta: Number(qta) || 1,
            department: targetDept,
            dataConsegnaFinale: dataConsegnaFinale || '',
            numeroODLInterno: odlToAssign,
            numeroODL: odlToAssign || null,
            status: 'Pianificata',
            phases,
            billOfMaterials: jobBOM,
            workCycleId,
            expectedMinutesDefault,
            isoWeek,
            weekYear,
            targetWeek,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            isPrinted: false,
            odlPrinted: false,
        };

        await docRef.set(newJob);
        await bumpMrpSyncVersion('jobsBom', 'programmazione:saveQuickJobOrder');
        return { success: true, message: `Commessa ${ordinePF} creata con successo.`, job: newJob as JobOrder };
    } catch (e: any) {
        console.error("Errore saveQuickJobOrder:", e);
        return { success: false, message: e.message || "Errore durante la creazione." };
    }
}

function sanitizeFirestoreData(data: any): any {
    if (data === undefined) return null;
    if (data === null) return null;
    if (Array.isArray(data)) return data.map(sanitizeFirestoreData);
    if (typeof data === 'object' && data.constructor === Object) {
        const sanitized: any = {};
        for (const key in data) {
            const val = data[key];
            if (val !== undefined) {
                sanitized[key] = sanitizeFirestoreData(val);
            }
        }
        return sanitized;
    }
    return data;
}

/**
 * FASE 26: Salvataggio in Batch di Commesse da Inserimento Manuale Multiplo
 * Regole di Blocco (Rosso):
 * - Articolo deve esistere in anagrafica.
 * - Articolo deve possedere una Distinta Base (BOM) configurata.
 * Regole di Tolleranza (Verde/Warning):
 * - L'assenza di Ciclo di Lavorazione o Tempi Previsti NON blocca l'inserimento.
 */
export async function saveManualMultiJobOrders(items: {
    department?: string;
    ordinePF: string;
    cliente: string;
    articleCode: string;
    qta: number;
    dataConsegnaFinale: string;
    numeroODLInterno?: string;
}[]): Promise<{ success: boolean; message: string; jobs?: JobOrder[] }> {
    try {
        if (!items || !items.length) {
            return { success: false, message: "Nessuna commessa da salvare." };
        }

        // 1. Validazione dati obbligatori
        for (let i = 0; i < items.length; i++) {
            const row = items[i];
            if (!row.ordinePF?.trim()) {
                return { success: false, message: `Riga ${i + 1}: Ordine PF mancante.` };
            }
            if (!row.cliente?.trim()) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Cliente mancante.` };
            }
            if (!row.articleCode?.trim()) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Codice Articolo mancante.` };
            }
            if (!row.qta || Number(row.qta) <= 0) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Quantità non valida.` };
            }
            if (!row.dataConsegnaFinale?.trim()) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Data Consegna mancante.` };
            }
        }

        // 2. Controllo duplicati interni (Unicità per Ordine PF + Anno di Competenza)
        const seenKeys = new Set<string>();
        for (const row of items) {
            const anno = extractAnnoCompetenza(row.dataConsegnaFinale);
            const key = `${row.ordinePF.trim().toUpperCase()}__${anno}`;
            if (seenKeys.has(key)) {
                return { success: false, message: `Ordine PF duplicato nell'elenco inviato per l'anno ${anno}: "${row.ordinePF}".` };
            }
            seenKeys.add(key);
        }

        // 3. Controllo duplicati su Firestore (Unicità combinata ordinePF + annoCompetenza)
        for (const row of items) {
            const anno = extractAnnoCompetenza(row.dataConsegnaFinale);
            const checkRes = await checkJobOrderExists(adminDb, row.ordinePF, anno);
            if (checkRes.exists) {
                return { success: false, message: `Commessa già esistente nel sistema: "${row.ordinePF}" per l'anno ${anno}.` };
            }
        }

        // 4. Caricamento Anagrafiche Articoli
        const uniqueArticleCodes = [...new Set(items.map(r => r.articleCode.trim().toUpperCase()))];
        const articlesSnap = await fetchInChunks<Article>(
            adminDb.collection("articles"),
            "code",
            uniqueArticleCodes
        );
        const articlesMap = new Map<string, Article>();
        articlesSnap.forEach(a => {
            if (a.code) articlesMap.set(a.code.toUpperCase().trim(), a);
        });

        // Fallback per articoli con ID documento uguale al codice
        const missingCodes = uniqueArticleCodes.filter(c => !articlesMap.has(c));
        if (missingCodes.length > 0) {
            const byIdSnap = await fetchInChunks<Article>(
                adminDb.collection("articles"),
                admin.firestore.FieldPath.documentId(),
                missingCodes
            );
            byIdSnap.forEach(a => {
                const code = String(a.code || a.id).toUpperCase().trim();
                if (code) articlesMap.set(code, a);
            });
        }

        // 5. Verifica Bloccante (Rosso) di Anagrafica e Distinta Base (BOM)
        for (let i = 0; i < items.length; i++) {
            const row = items[i];
            const artCode = row.articleCode.trim().toUpperCase();
            const art = articlesMap.get(artCode);
            if (!art) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Articolo "${artCode}" non trovato in Anagrafica.` };
            }
            if (!art.billOfMaterials || art.billOfMaterials.length === 0) {
                return { success: false, message: `Riga ${i + 1} (${row.ordinePF}): Articolo "${artCode}" privo di Distinta Base (BOM) configurata.` };
            }
        }

        // 6. Pre-caricamento Materiali per calcolo Fabbisogni BOM
        const allCompCodes = new Set<string>();
        articlesSnap.forEach(a => {
            (a.billOfMaterials || []).forEach(item => {
                if (item.component) allCompCodes.add(item.component.toUpperCase().trim());
            });
        });

        const [globalSettingsSnap, rawMaterials] = await Promise.all([
            adminDb.collection("settings").doc("global").get(),
            allCompCodes.size > 0 ? fetchInChunks<RawMaterial>(
                adminDb.collection("rawMaterials"),
                "code",
                [...allCompCodes]
            ) : Promise.resolve([])
        ]);
        const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;

        // 7. Costruzione oggetti JobOrder completi
        const now = new Date();
        const shortYear = now.getFullYear().toString().slice(-2);
        const newJobs: JobOrder[] = [];

        for (const row of items) {
            const annoCompetenza = extractAnnoCompetenza(row.dataConsegnaFinale);
            const compositeId = generateJobDocumentId(row.ordinePF, annoCompetenza);
            const artCode = row.articleCode.trim().toUpperCase();
            const artData = articlesMap.get(artCode)!;
            const qtaNum = Number(row.qta) || 1;

            const workCycleId = artData.workCycleId || '';
            const targetDept = resolveDepartmentForNewJob({
                explicitDepartment: row.department,
                article: artData,
                fallback: 'CP',
            });
            const expectedMinutesDefault = artData.expectedMinutesDefault || 0;

            // Ciclo e fasi: Regola di Tolleranza (Verde/Warning) - non blocca
            let phases: any[] = [];
            if (workCycleId) {
                try {
                    phases = await createPhasesFromCycle(workCycleId);
                    if (expectedMinutesDefault > 0 && phases.length > 0) {
                        const historicalAverages = artData.historicalTimes?.averagePhaseTimes || [];
                        phases = distributeTheoreticalTimes(expectedMinutesDefault, phases, historicalAverages, qtaNum);
                    }
                } catch (cycleErr) {
                    console.warn(`Avviso creazione fasi ciclo ${workCycleId}:`, cycleErr);
                    phases = [];
                }
            }

            // Distinta Base (BOM)
            const jobBOM: JobBillOfMaterialsItem[] = buildJobBOMItemsFromArticle({
                jobQta: qtaNum,
                articleBOM: artData.billOfMaterials || [],
                rawMaterials,
                globalSettings: globalSettings as Partial<GlobalSettings> | null,
            });

            // Calcolo Settimana ISO da Data Consegna
            let isoWeek: number | null = null;
            let weekYear: number | null = null;
            let targetWeek: string | null = null;
            let normalizedDeliveryDate = '';
            if (row.dataConsegnaFinale) {
                const d = parseRobustDate(row.dataConsegnaFinale) || new Date(row.dataConsegnaFinale);
                if (d && !isNaN(d.getTime())) {
                    isoWeek = getISOWeek(d);
                    weekYear = getISOWeekYear(d);
                    targetWeek = `${weekYear}-W${String(isoWeek).padStart(2, '0')}`;
                    normalizedDeliveryDate = format(d, 'yyyy-MM-dd');
                } else {
                    normalizedDeliveryDate = row.dataConsegnaFinale;
                }
            }

            let odlToAssign: string | null = null;
            if (row.numeroODLInterno) {
                const rawVal = String(row.numeroODLInterno).trim();
                const dashIndex = rawVal.indexOf('-');
                if (dashIndex !== -1) {
                    const numPart = rawVal.substring(0, dashIndex).match(/\d+/)?.[0] || '';
                    const yearPart = rawVal.substring(dashIndex + 1).trim();
                    if (numPart) odlToAssign = `${numPart.padStart(4, '0')}-${yearPart}`;
                } else {
                    const digits = rawVal.match(/\d+/)?.[0] || '';
                    if (digits) odlToAssign = `${digits.padStart(4, '0')}-${shortYear}`;
                }
            }

            newJobs.push({
                id: compositeId,
                ordinePF: row.ordinePF.trim(),
                annoCompetenza: annoCompetenza,
                cliente: row.cliente.trim(),
                details: artCode,
                articleCode: artCode,
                articolo: artCode,
                qta: qtaNum,
                department: targetDept,
                dataConsegnaFinale: normalizedDeliveryDate,
                dataFinePreparazione: normalizedDeliveryDate,
                assignedDate: normalizedDeliveryDate,
                postazioneLavoro: 'Da Assegnare',
                sortIndex: 0,
                numeroODLInterno: odlToAssign,
                numeroODL: odlToAssign || null,
                status: 'Pianificata', // SSoT Pianificata
                phases,
                billOfMaterials: jobBOM,
                workCycleId,
                expectedMinutesDefault,
                isoWeek,
                weekYear,
                targetWeek,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                isPrinted: false,
                odlPrinted: false,
            } as JobOrder);
        }

        // 8. Scrittura Batch Atomica con Timestamp nativi Firestore
        const batch = adminDb.batch();
        newJobs.forEach(job => {
            const ref = adminDb.collection("jobOrders").doc(job.id);
            const firestorePayload = {
                ...job,
                createdAt: admin.firestore.Timestamp.fromDate(now),
                updatedAt: admin.firestore.Timestamp.fromDate(now),
            };
            batch.set(ref, sanitizeFirestoreData(firestorePayload));
        });
        await batch.commit();
        await bumpMrpSyncVersion('jobsBom', 'programmazione:saveManualMultiJobOrders');

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        return {
            success: true,
            message: `${newJobs.length} commesse inserite con successo con stato Pianificata.`,
            jobs: JSON.parse(JSON.stringify(newJobs))
        };
    } catch (e: any) {
        console.error("Errore saveManualMultiJobOrders:", e);
        return { success: false, message: e.message || "Errore durante il salvataggio massivo delle commesse." };
    }
}

/**
 * FASE 16: Aggiornamento massivo Data di Consegna per più commesse selezionate
 */
export async function bulkUpdateJobDeliveryDate(
    jobIds: string[],
    newDate: string
): Promise<{ success: boolean; message: string; updatedCount: number }> {
    try {
        const val = (newDate || '').trim();
        let isoWeek: number | null = null;
        let weekYear: number | null = null;
        let targetWeek: string | null = null;
        if (val) {
            const d = parseRobustDate(val) || new Date(val);
            if (d && !isNaN(d.getTime())) {
                isoWeek = getISOWeek(d);
                weekYear = getISOWeekYear(d);
                targetWeek = `${weekYear}-W${String(isoWeek).padStart(2, '0')}`;
            }
        }

        const batchSize = 450;
        for (let i = 0; i < jobIds.length; i += batchSize) {
            const chunk = jobIds.slice(i, i + batchSize);
            const batch = adminDb.batch();
            chunk.forEach(id => {
                const ref = adminDb.collection("jobOrders").doc(id);
                const updatePayload: Record<string, any> = {
                    dataConsegnaFinale: val,
                    updatedAt: new Date().toISOString(),
                };
                if (isoWeek !== null) updatePayload.isoWeek = isoWeek;
                if (weekYear !== null) updatePayload.weekYear = weekYear;
                if (targetWeek !== null) updatePayload.targetWeek = targetWeek;
                batch.update(ref, updatePayload);
            });
            await batch.commit();
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:bulkUpdateJobDeliveryDate');
        revalidatePath('/admin/data-management');
        return { success: true, message: `Data consegna aggiornata su ${jobIds.length} commesse.`, updatedCount: jobIds.length };
    } catch (error: any) {
        console.error("Errore bulkUpdateJobDeliveryDate:", error);
        return { success: false, message: error?.message || "Errore durante l'aggiornamento massivo della data.", updatedCount: 0 };
    }
}

/**
 * FASE 16: Spedizione massiva commesse selezionate
 */
export async function bulkShipJobs(
    jobIds: string[]
): Promise<{ success: boolean; message: string; count: number }> {
    try {
        const batchSize = 250;
        for (let i = 0; i < jobIds.length; i += batchSize) {
            const chunk = jobIds.slice(i, i + batchSize);
            const batch = adminDb.batch();
            chunk.forEach(id => {
                const ref = adminDb.collection("jobOrders").doc(id);
                batch.update(ref, {
                    status: 'SPEDITA',
                    overallEndTime: admin.firestore.Timestamp.now(),
                    forcedCompletion: true,
                    lastStatusChange: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.Timestamp.now()
                });
            });
            await batch.commit();
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:bulkShipJobs');
        revalidatePath('/admin/production-console');
        revalidatePath('/operator/packing');
        return { success: true, message: `${jobIds.length} commesse contrassegnate come SPEDITE.`, count: jobIds.length };
    } catch (e: any) {
        console.error("Errore in bulkShipJobs:", e);
        return { success: false, message: e?.message || "Errore durante la spedizione massiva.", count: 0 };
    }
}

/**
 * FASE 16 & FASE 81: Avvio e Stampa massiva commesse selezionate
 * Verifica e tiene traccia dei motivi di esclusione (data consegna mancante, ciclo mancante, errori ODL)
 */
export async function bulkStartProductionAndPrint(
    jobIds: string[]
): Promise<{ 
    success: boolean; 
    message: string; 
    error?: string;
    nextOdl?: string;
    startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[];
    skippedNoDate: string[];
    skippedNoCycle: string[];
    skippedOther?: { ordinePF: string; reason: string }[];
}> {
    try {
        const startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[] = [];
        const skippedNoDate: string[] = [];
        const skippedNoCycle: string[] = [];
        const skippedOther: { ordinePF: string; reason: string }[] = [];

        const cleanIds = Array.from(new Set((jobIds || []).map((id) => (id || '').trim()).filter(Boolean)));
        if (cleanIds.length === 0) {
            return {
                success: false,
                message: "Nessuna commessa selezionata.",
                startedJobs: [],
                skippedNoDate: [],
                skippedNoCycle: [],
                skippedOther: [],
            };
        }

        // FASE 96 & FASE 98: Fetch primario in parallelo con fallback sicuro su slash/id composito
        const lookups = await Promise.all(
            cleanIds.map((id) => getJobOrderRefAndSnap(adminDb, id))
        );

        const printedJobIdsToUpdate: string[] = [];

        for (let idx = 0; idx < cleanIds.length; idx++) {
            const rawId = cleanIds[idx];
            const { jobRef, jobSnap } = lookups[idx];
            if (!jobSnap?.exists) {
                skippedOther.push({ ordinePF: rawId, reason: `${rawId}: commessa non trovata` });
                continue;
            }
            const id = jobRef.id;
            const job = { ...convertTimestampsToDates(jobSnap.data()), id } as JobOrder;
            const jobLabel = job.ordinePF || id;

            const displayStatus = getJobDisplayStatus(job);
            if (displayStatus === 'Completato Prod.' || displayStatus === 'Spedito') {
                skippedOther.push({
                    ordinePF: jobLabel,
                    reason: `${jobLabel}: già conclusa (${displayStatus})`,
                });
                continue;
            }

            if (!job.dataConsegnaFinale || !String(job.dataConsegnaFinale).trim()) {
                skippedNoDate.push(jobLabel);
                continue;
            }

            const existingOdl = getJobCleanOdl(job);
            let odlNum = existingOdl;

            if (displayStatus !== 'In Produzione' || isPlannedStatusValue(job.status)) {
                const res = await createODL(id, existingOdl || undefined);
                if (res.success) {
                    // FASE 96: Usa direttamente res.odlNumber senza eseguire una seconda query .get() ridondante
                    odlNum = res.odlNumber || odlNum;
                } else {
                    console.warn(`Impossibile avviare commessa ${id}:`, res.message);
                    const msgLower = (res.message || '').toLowerCase();
                    if (msgLower.includes('ciclo')) {
                        skippedNoCycle.push(jobLabel);
                    } else if (msgLower.includes('data')) {
                        skippedNoDate.push(jobLabel);
                    } else {
                        skippedOther.push({ ordinePF: jobLabel, reason: `${jobLabel}: ${res.message}` });
                    }
                    continue;
                }
            }

            printedJobIdsToUpdate.push(id);
            startedJobs.push({
                id,
                ordinePF: jobLabel,
                numeroODLInterno: odlNum || undefined
            });
        }

        // FASE 96: Aggiornamento flag isPrinted / odlPrinted in parallelo tramite WriteBatch chunked
        if (printedJobIdsToUpdate.length > 0) {
            const batchSize = 250;
            const commitPromises: Promise<FirebaseFirestore.WriteResult[]>[] = [];
            const nowTs = admin.firestore.Timestamp.now();
            for (let i = 0; i < printedJobIdsToUpdate.length; i += batchSize) {
                const chunk = printedJobIdsToUpdate.slice(i, i + batchSize);
                const batch = adminDb.batch();
                chunk.forEach((id) => {
                    batch.update(adminDb.collection("jobOrders").doc(id), {
                        isPrinted: true,
                        odlPrinted: true,
                        updatedAt: nowTs,
                    });
                });
                commitPromises.push(batch.commit());
            }
            await Promise.all(commitPromises);
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        const nextOdl = await getNextOdlNumber().catch(() => undefined);

        const feedback = formatBulkStartFeedback({
            startedCount: startedJobs.length,
            skippedNoCycleCount: skippedNoCycle.length,
            skippedNoDateCount: skippedNoDate.length,
            skippedOtherReasons: skippedOther.map((o) => o.reason),
            actionType: 'print',
        });

        return {
            success: feedback.success,
            message: feedback.message,
            error: feedback.error,
            nextOdl,
            startedJobs,
            skippedNoDate,
            skippedNoCycle,
            skippedOther,
        };
    } catch (e: any) {
        console.error("Errore in bulkStartProductionAndPrint:", e);
        const err = e?.message || "Errore durante l'avvio massivo.";
        return {
            success: false,
            message: err,
            error: err,
            startedJobs: [],
            skippedNoDate: [],
            skippedNoCycle: [],
            skippedOther: [],
        };
    }
}

/**
 * FASE 33, FASE 81 & FASE 96: Avvio massivo commesse in produzione (Solo Avvio Produzione)
 * Transiziona le commesse a DA_INIZIARE e genera i timestamp/ODL SSoT senza marcare come stampate.
 * Traccia puntualmente i motivi di scarto (mancanza ciclo, data mancante, errori specifici).
 */
export async function bulkStartProduction(
    jobIds: string[]
): Promise<{ 
    success: boolean; 
    message: string; 
    error?: string;
    nextOdl?: string;
    startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[];
    skippedNoDate: string[];
    skippedNoCycle: string[];
    skippedOther?: { ordinePF: string; reason: string }[];
}> {
    try {
        const startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[] = [];
        const skippedNoDate: string[] = [];
        const skippedNoCycle: string[] = [];
        const skippedOther: { ordinePF: string; reason: string }[] = [];

        const cleanIds = Array.from(new Set((jobIds || []).map((id) => (id || '').trim()).filter(Boolean)));
        if (cleanIds.length === 0) {
            return {
                success: false,
                message: "Nessuna commessa selezionata.",
                startedJobs: [],
                skippedNoDate: [],
                skippedNoCycle: [],
                skippedOther: [],
            };
        }

        // FASE 96 & FASE 98: Fetch primario di tutte le commesse selezionate rigorosamente in parallelo
        const lookups = await Promise.all(
            cleanIds.map((id) => getJobOrderRefAndSnap(adminDb, id))
        );

        for (let idx = 0; idx < cleanIds.length; idx++) {
            const rawId = cleanIds[idx];
            const { jobRef, jobSnap } = lookups[idx];
            if (!jobSnap?.exists) {
                skippedOther.push({ ordinePF: rawId, reason: `${rawId}: commessa non trovata` });
                continue;
            }
            const id = jobRef.id;
            const job = { ...convertTimestampsToDates(jobSnap.data()), id } as JobOrder;
            const jobLabel = job.ordinePF || id;

            // Controllo preliminare stato e data consegna tramite helper SSoT (FASE 98)
            const preCheck = evaluateJobStartEligibility(job, { hasArticleWorkCycle: true });
            if (!preCheck.eligible) {
                if (preCheck.skipCategory === 'no_date') {
                    skippedNoDate.push(jobLabel);
                } else if (preCheck.skipCategory === 'no_cycle') {
                    skippedNoCycle.push(jobLabel);
                } else {
                    skippedOther.push({
                        ordinePF: jobLabel,
                        reason: `${jobLabel}: ${preCheck.reason || `stato "${job.status}"`}`,
                    });
                }
                continue;
            }

            // FASE 98-BIS: Mantiene l'ODL già assegnato senza consumare numeratore;
            // genera un nuovo progressivo solo per commesse prive di ODL (N/D o vuoto).
            const existingOdl = getJobCleanOdl(job);
            const res = await createODL(id, existingOdl || undefined);
            if (res.success) {
                const odlNum = res.odlNumber || existingOdl || undefined;
                startedJobs.push({
                    id,
                    ordinePF: jobLabel,
                    numeroODLInterno: odlNum,
                });
            } else {
                console.warn(`Impossibile avviare commessa ${id}:`, res.message);
                const msgLower = (res.message || '').toLowerCase();
                if (msgLower.includes('ciclo')) {
                    skippedNoCycle.push(jobLabel);
                } else if (msgLower.includes('data')) {
                    skippedNoDate.push(jobLabel);
                } else {
                    skippedOther.push({ ordinePF: jobLabel, reason: `${jobLabel}: ${res.message}` });
                }
            }
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        const nextOdl = await getNextOdlNumber().catch(() => undefined);

        const feedback = formatBulkStartFeedback({
            startedCount: startedJobs.length,
            skippedNoCycleCount: skippedNoCycle.length,
            skippedNoDateCount: skippedNoDate.length,
            skippedOtherReasons: skippedOther.map((o) => o.reason),
            actionType: 'production',
        });

        return {
            success: feedback.success,
            message: feedback.message,
            error: feedback.error,
            nextOdl,
            startedJobs,
            skippedNoDate,
            skippedNoCycle,
            skippedOther,
        };
    } catch (e: any) {
        console.error("Errore in bulkStartProduction:", e);
        const err = e?.message || "Errore durante l'avvio massivo in produzione.";
        return {
            success: false,
            message: err,
            error: err,
            startedJobs: [],
            skippedNoDate: [],
            skippedNoCycle: [],
            skippedOther: [],
        };
    }
}

/**
 * FASE 33 & FASE 96: Marcatura massiva commesse come stampate (Solo Stampa ODL)
 * Imposta isPrinted: true e odlPrinted: true senza modificare lo stato della commessa
 */
export async function bulkMarkJobsAsPrinted(
    jobIds: string[]
): Promise<{ success: boolean; message: string }> {
    try {
        const cleanIds = Array.from(new Set((jobIds || []).map((id) => (id || '').trim()).filter(Boolean)));
        const batchSize = 250;
        const commitPromises: Promise<FirebaseFirestore.WriteResult[]>[] = [];
        const nowTs = admin.firestore.Timestamp.now();

        for (let i = 0; i < cleanIds.length; i += batchSize) {
            const chunk = cleanIds.slice(i, i + batchSize);
            const batch = adminDb.batch();
            chunk.forEach(id => {
                const ref = adminDb.collection("jobOrders").doc(id);
                batch.update(ref, {
                    isPrinted: true,
                    odlPrinted: true,
                    updatedAt: nowTs,
                });
            });
            commitPromises.push(batch.commit());
        }

        if (commitPromises.length > 0) {
            await Promise.all(commitPromises);
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        revalidatePath('/admin/data-management');
        return { success: true, message: `${cleanIds.length} commesse contrassegnate come stampate.` };
    } catch (e: any) {
        console.error("Errore durante bulkMarkJobsAsPrinted:", e);
        return { success: false, message: e?.message || "Errore durante la marcatura di stampa massiva." };
    }
}

// =========================================================================
// FASE 18 & FASE 92: GESTIONE PERSISTENZA CAPACITÀ SETTIMANALE, BASELINE E PROPAGAZIONE
// =========================================================================

export async function getCapacityBuckets(year: number, week: number): Promise<Record<string, DayCapacityConfigData>> {
    try {
        const baselineRefs = ALL_TRACKED_CAPACITY_DEPTS.map((dept) =>
            adminDb.collection("settings").doc(`default_capacity_${dept}`)
        );

        const [snap, ...baselineSnaps] = await Promise.all([
            adminDb.collection("capacityBuckets")
                .where("year", "==", year)
                .where("week", "==", week)
                .get(),
            ...baselineRefs.map((ref) => ref.get()),
        ]);

        const result: Record<string, DayCapacityConfigData> = {};
        snap.docs.forEach(doc => {
            const data = doc.data();
            const dept = (data.dept || data.department || doc.id.split('_')[0] || '').toUpperCase().trim();
            const key = `${dept}_${year}_W${week}`;
            result[key] = {
                L: Number(data.L) || 0,
                M: Number(data.M) || 0,
                Me: Number(data.Me) || 0,
                G: Number(data.G) || 0,
                V: Number(data.V) || 0,
                overtime: Number(data.overtime) || 0,
            };
        });

        // FASE 92: Se la settimana è vuota per un reparto, applica la baseline globale settings/default_capacity_${reparto}
        ALL_TRACKED_CAPACITY_DEPTS.forEach((dept, idx) => {
            const key = `${dept}_${year}_W${week}`;
            const baselineSnap = baselineSnaps[idx];
            const baselineData = baselineSnap?.exists
                ? (baselineSnap.data() as DefaultCapacityBaselineData)
                : undefined;

            const resolved = resolveBucketWithBaseline(result[key], baselineData, year, week);
            if (resolved) {
                result[key] = resolved;
            }
        });

        return result;
    } catch (err) {
        console.error("Error fetching capacity buckets:", err);
        return {};
    }
}

export async function saveCapacityBucket(
    dept: string,
    year: number,
    week: number,
    config: DayCapacityConfigData
): Promise<{ success: boolean; message?: string }> {
    try {
        const cleanDept = dept.toUpperCase().trim();
        const docId = `${cleanDept}_${year}_W${week}`;
        await adminDb.collection("capacityBuckets").doc(docId).set({
            dept: cleanDept,
            year,
            week,
            L: Math.max(0, Number(config.L) || 0),
            M: Math.max(0, Number(config.M) || 0),
            Me: Math.max(0, Number(config.Me) || 0),
            G: Math.max(0, Number(config.G) || 0),
            V: Math.max(0, Number(config.V) || 0),
            overtime: Math.max(0, Number(config.overtime) || 0),
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        return { success: true };
    } catch (err: any) {
        console.error("Error saving capacity bucket:", err);
        return { success: false, message: err?.message || "Errore nel salvataggio della capacità." };
    }
}

/**
 * FASE 92: Propaga la dotazione addetti giornalieri dalla settimana visualizzata in avanti ("Da qui in avanti"):
 * 1. Aggiorna la baseline globale settings/default_capacity_${reparto} per le future settimane vuote.
 * 2. Sovrascrive gli addetti in tutti i record di capacityBuckets del reparto dove year > currentYear
 *    oppure (year == currentYear && week >= startWeek), preservando tutte le settimane storiche passate.
 */
export async function propagateCapacityForward(
    dept: string,
    currentYear: number,
    startWeek: number,
    workers: Pick<DayCapacityConfigData, 'L' | 'M' | 'Me' | 'G' | 'V'>
): Promise<{ success: boolean; message: string; updatedDocsCount?: number }> {
    try {
        const cleanDept = (dept || '').toUpperCase().trim();
        if (!cleanDept || cleanDept === 'ALL') {
            return {
                success: false,
                message: 'Seleziona un reparto specifico (CP, CG, BF o MAG) per propagare gli addetti.',
            };
        }

        const sanitizedWorkers = {
            L: Math.max(0, Number(workers.L) || 0),
            M: Math.max(0, Number(workers.M) || 0),
            Me: Math.max(0, Number(workers.Me) || 0),
            G: Math.max(0, Number(workers.G) || 0),
            V: Math.max(0, Number(workers.V) || 0),
        };

        const nowTs = admin.firestore.Timestamp.now();

        // 1. Aggiorna baseline globale settings/default_capacity_${reparto}
        await adminDb.collection("settings").doc(`default_capacity_${cleanDept}`).set({
            dept: cleanDept,
            ...sanitizedWorkers,
            overtime: 0,
            effectiveFromYear: currentYear,
            effectiveFromWeek: startWeek,
            updatedAt: nowTs,
        }, { merge: true });

        // 2. Assicura il salvataggio della settimana di partenza
        const startDocId = `${cleanDept}_${currentYear}_W${startWeek}`;
        await adminDb.collection("capacityBuckets").doc(startDocId).set({
            dept: cleanDept,
            year: currentYear,
            week: startWeek,
            ...sanitizedWorkers,
            updatedAt: nowTs,
        }, { merge: true });

        // 3. Query a singolo campo (nessun indice composito richiesto) sui record dall'anno corrente in poi
        const futureSnap = await adminDb.collection("capacityBuckets")
            .where("year", ">=", currentYear)
            .get();

        const docsToUpdate = futureSnap.docs.filter((d) => {
            const data = d.data();
            const docDept = String(data.dept || data.department || d.id.split('_')[0] || '').toUpperCase().trim();
            const docYear = Number(data.year);
            const docWeek = Number(data.week);
            return (
                docDept === cleanDept &&
                Number.isFinite(docYear) &&
                Number.isFinite(docWeek) &&
                isCapacityPeriodAtOrAfter(docYear, docWeek, currentYear, startWeek)
            );
        });

        let updatedCount = 0;
        for (let i = 0; i < docsToUpdate.length; i += 450) {
            const chunk = docsToUpdate.slice(i, i + 450);
            const batch = adminDb.batch();
            chunk.forEach((docSnap) => {
                batch.set(docSnap.ref, {
                    ...sanitizedWorkers,
                    updatedAt: nowTs,
                }, { merge: true });
                updatedCount += 1;
            });
            await batch.commit();
        }

        return {
            success: true,
            updatedDocsCount: updatedCount,
            message: `Baseline ${cleanDept} aggiornata dalla Sett. ${startWeek}/${currentYear} in avanti (${updatedCount} record settimanali allineati).`,
        };
    } catch (err: any) {
        console.error("Error propagating capacity forward:", err);
        return {
            success: false,
            message: err?.message || "Errore durante la propagazione futura degli addetti.",
        };
    }
}

export interface ExportPlanningReportOptions {
    scope: 'current' | 'next' | 'both';
    dept: 'ALL' | 'CP' | 'CG' | 'BF' | string;
    referenceDateIso?: string;
    clientJobs?: JobOrder[];
}

export interface ExportPlanningReportResult {
    success: boolean;
    base64?: string;
    filename?: string;
    totalJobs?: number;
    message?: string;
}

/**
 * FASE 27: Server Action per l'esportazione del Report Excel (Programmazione Settimanale)
 * Filtra tramite standard SSoT (getJobDisplayStatus === 'Pianificata' | 'In Produzione')
 * ed esegue il ricalcolo ISO delle settimane con roll-over al presente.
 */
export async function exportPlanningReportAction(
    options: ExportPlanningReportOptions
): Promise<ExportPlanningReportResult> {
    try {
        const refDate = options.referenceDateIso ? new Date(options.referenceDateIso) : new Date();
        const currentIsoWeek = getISOWeek(refDate);
        const currentIsoYear = getISOWeekYear(refDate);

        const nextDate = addWeeks(refDate, 1);
        const nextIsoWeek = getISOWeek(nextDate);
        const nextIsoYear = getISOWeekYear(nextDate);

        // 1. Sorgente Dati: se il client passa le commesse attuali usiamo quelle, altrimenti query Firestore
        let sourceJobs: JobOrder[] = [];
        if (options.clientJobs && options.clientJobs.length > 0) {
            sourceJobs = options.clientJobs;
        } else {
            const rawJobs = await fetchAllJobOrders();
            sourceJobs = rawJobs;
        }

        // 2. Filtraggio SSoT: solo commesse 'Pianificata' e 'In Produzione'
        const activeJobs = sourceJobs.filter(job => {
            const displayStatus = getJobDisplayStatus(job);
            return displayStatus === 'Pianificata' || displayStatus === 'In Produzione';
        });

        // 3. Filtraggio per Settimana ISO e Roll-over
        const matchedJobs = activeJobs.filter(job => {
            const targetDateStr = job.assignedDate || job.dataConsegnaFinale;
            if (!targetDateStr) return false;
            const parsed = parseRobustDate(targetDateStr);
            if (!parsed) return false;

            const jobWeek = getISOWeek(parsed);
            const jobYear = getISOWeekYear(parsed);

            // Roll-over: commesse attive nel passato slittano alla settimana corrente
            const isPast = jobYear < currentIsoYear || (jobYear === currentIsoYear && jobWeek < currentIsoWeek);
            const effectiveWeek = isPast ? currentIsoWeek : jobWeek;
            const effectiveYear = isPast ? currentIsoYear : jobYear;

            if (options.scope === 'current') {
                return effectiveWeek === currentIsoWeek && effectiveYear === currentIsoYear;
            }
            if (options.scope === 'next') {
                return effectiveWeek === nextIsoWeek && effectiveYear === nextIsoYear;
            }
            if (options.scope === 'both') {
                return (
                    (effectiveWeek === currentIsoWeek && effectiveYear === currentIsoYear) ||
                    (effectiveWeek === nextIsoWeek && effectiveYear === nextIsoYear)
                );
            }
            return false;
        });

        // 4. Filtraggio per Reparto
        const deptFilteredJobs = matchedJobs.filter(job => {
            if (options.dept === 'ALL') return true;
            const group = getJobDepartmentGroup(job);
            return group === options.dept;
        });

        if (deptFilteredJobs.length === 0) {
            return {
                success: true,
                totalJobs: 0,
                message: 'Nessuna commessa trovata per i criteri selezionati.'
            };
        }

        // 5. Etichette e Nomi
        let weekTitle = '';
        if (options.scope === 'current') {
            weekTitle = `Settimana ${currentIsoWeek}`;
        } else if (options.scope === 'next') {
            weekTitle = `Settimana ${nextIsoWeek}`;
        } else {
            weekTitle = `Settimane ${currentIsoWeek}-${nextIsoWeek}`;
        }

        let deptName = 'PRODUZIONE';
        if (options.dept === 'CP') deptName = 'CONNESSIONI PICCOLE (CP)';
        else if (options.dept === 'CG') deptName = 'CONNESSIONI GRANDI (CG)';
        else if (options.dept === 'BF') deptName = 'REPARTO BARRE (BF)';

        // 6. Generazione Excel con lo standard di formattazione Power Planning
        const exportJobs: ExportJobData[] = deptFilteredJobs.map(j => ({
            id: j.id,
            cliente: j.cliente || '',
            ordinePF: j.ordinePF || '',
            details: j.details || '',
            qta: j.qta || 0,
            dataConsegnaFinale: j.dataConsegnaFinale,
            numeroODLInterno: j.numeroODLInterno || (j as any).numeroODL || '',
            department: j.department || ''
        }));

        const buffer = await generatePlanningExcelBuffer(
            exportJobs,
            options.dept === 'ALL' ? 'CORE' : options.dept,
            weekTitle,
            deptName
        );

        const base64 = Buffer.from(buffer as any).toString('base64');
        const filename = `Report_Planning_${options.dept}_${weekTitle.replace(/\s+/g, '_')}.xlsx`;

        return {
            success: true,
            base64,
            filename,
            totalJobs: deptFilteredJobs.length
        };
    } catch (err: any) {
        console.error("Errore esportazione report planning:", err);
        return {
            success: false,
            message: err?.message || 'Errore imprevisto durante la generazione del report Excel.'
        };
    }
}

/**
 * FASE 28: Eliminazione Singola Commessa
 * Regola di sicurezza: Solo le commesse in stato 'Pianificata' possono essere eliminate.
 * Se la commessa è in produzione, completata o spedita, viene bloccata.
 */
export async function deleteJobOrder(
    jobId: string
): Promise<{ success: boolean; message: string }> {
    try {
        const cleanId = (jobId || '').trim();
        if (!cleanId) {
            return { success: false, message: 'ID commessa mancante o non valido.' };
        }

        const docRef = adminDb.collection('jobOrders').doc(cleanId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return { success: false, message: 'Commessa non trovata nel database.' };
        }

        const job = docSnap.data() as JobOrder;
        const displayStatus = getJobDisplayStatus(job);

        if (displayStatus !== 'Pianificata') {
            return {
                success: false,
                message: `Impossibile eliminare una commessa in stato "${displayStatus}". Esegui prima il rollback a "Pianificata".`
            };
        }

        await docRef.delete();
        await bumpMrpSyncVersion('jobsBom', 'programmazione:deleteJobOrder');

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        return {
            success: true,
            message: `Commessa ${job.ordinePF || cleanId} eliminata con successo.`
        };
    } catch (error: any) {
        console.error('Errore deleteJobOrder:', error);
        return {
            success: false,
            message: error?.message || "Errore imprevisto durante l'eliminazione della commessa."
        };
    }
}

/**
 * FASE 28: Eliminazione Massiva Commesse Selezionate
 * Regola di sicurezza: Elimina solo ed esclusivamente le commesse nello stato 'Pianificata'.
 */
export async function bulkDeleteJobOrders(
    jobIds: string[]
): Promise<{ success: boolean; message: string; deletedCount: number; deletedIds: string[] }> {
    try {
        if (!jobIds || jobIds.length === 0) {
            return { success: false, message: 'Nessuna commessa specificata per l\'eliminazione.', deletedCount: 0, deletedIds: [] };
        }

        const eligibleIds: string[] = [];
        const skippedNonPlanned: string[] = [];

        // Validazione preventiva su Firestore di ogni commessa
        for (const id of jobIds) {
            const cleanId = (id || '').trim();
            if (!cleanId) continue;
            const docSnap = await adminDb.collection('jobOrders').doc(cleanId).get();
            if (!docSnap.exists) continue;

            const job = docSnap.data() as JobOrder;
            const displayStatus = getJobDisplayStatus(job);

            if (displayStatus === 'Pianificata') {
                eligibleIds.push(cleanId);
            } else {
                skippedNonPlanned.push(job.ordinePF || cleanId);
            }
        }

        if (eligibleIds.length === 0) {
            return {
                success: false,
                message: 'Nessuna delle commesse selezionate è in stato "Pianificata". L\'eliminazione è stata bloccata per salvaguardare i dati di produzione.',
                deletedCount: 0,
                deletedIds: []
            };
        }

        // Esecuzione batch deletion (a blocchi di 250)
        const batchSize = 250;
        for (let i = 0; i < eligibleIds.length; i += batchSize) {
            const chunk = eligibleIds.slice(i, i + batchSize);
            const batch = adminDb.batch();
            chunk.forEach(id => {
                batch.delete(adminDb.collection('jobOrders').doc(id));
            });
            await batch.commit();
        }

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:bulkDeleteJobOrders');
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        let msg = `${eligibleIds.length} commesse eliminate definitivamente.`;
        if (skippedNonPlanned.length > 0) {
            msg += ` (${skippedNonPlanned.length} non eliminate poiché non pianificate)`;
        }

        return {
            success: true,
            message: msg,
            deletedCount: eligibleIds.length,
            deletedIds: eligibleIds
        };
    } catch (error: any) {
        console.error('Errore bulkDeleteJobOrders:', error);
        return {
            success: false,
            message: error?.message || "Errore imprevisto durante l'eliminazione massiva delle commesse.",
            deletedCount: 0,
            deletedIds: []
        };
    }
}

/**
 * FASE 29: Ricerca Server-Side Debounced per Anagrafica Articoli
 * Supporta query su Firestore con operatori di range (prefix matching) su code e description
 */
export async function searchArticlesAction(searchTerm: string): Promise<Article[]> {
    try {
        const rawTerm = (searchTerm || '').trim();
        if (!rawTerm || rawTerm.length < 2) {
            // Se il termine è troppo breve, restituisce i primi 30 articoli
            const snap = await adminDb.collection("articles")
                .select("code", "description", "department", "defaultDepartmentId", "defaultDepartmentCode", "billOfMaterials", "workCycleId", "expectedMinutesDefault")
                .limit(30)
                .get();

            const articles = snap.docs.map(doc => {
                const data = doc.data();
                return {
                    ...convertTimestampsToDates(data),
                    id: doc.id,
                    code: String(data.code || doc.id).trim(),
                    defaultDepartmentId: data.defaultDepartmentId ?? data.defaultDepartmentCode ?? data.department ?? null,
                    defaultDepartmentCode: data.defaultDepartmentCode ?? data.defaultDepartmentId ?? data.department ?? null,
                    department: data.defaultDepartmentId || data.defaultDepartmentCode || data.department || data.reparto || '',
                } as Article;
            });
            return JSON.parse(JSON.stringify(articles));
        }

        const upperTerm = rawTerm.toUpperCase();
        const resultsMap = new Map<string, Article>();

        const addDocToResults = (doc: admin.firestore.DocumentSnapshot) => {
            if (!resultsMap.has(doc.id)) {
                const data = doc.data();
                if (data) {
                    const resolvedDefaultDept = data.defaultDepartmentId ?? data.defaultDepartmentCode ?? data.department ?? data.reparto ?? null;
                    resultsMap.set(doc.id, {
                        ...convertTimestampsToDates(data),
                        id: doc.id,
                        code: String(data.code || data.codice || doc.id).trim(),
                        description: data.description || data.descrizione || '',
                        defaultDepartmentId: resolvedDefaultDept,
                        defaultDepartmentCode: data.defaultDepartmentCode ?? resolvedDefaultDept,
                        department: resolvedDefaultDept || '',
                        billOfMaterials: data.billOfMaterials || data.distintaBase || [],
                        workCycleId: data.workCycleId || data.cicloLavorazioneId || undefined,
                        expectedMinutesDefault: Number(data.expectedMinutesDefault) || 0,
                    } as Article);
                }
            }
        };

        // 1. Ricerca per 'code' in maiuscolo (prefix search)
        const codeSnap = await adminDb.collection("articles")
            .where("code", ">=", upperTerm)
            .where("code", "<=", upperTerm + "\uf8ff")
            .limit(30)
            .get();
        codeSnap.docs.forEach(addDocToResults);

        // 2. Ricerca per document ID
        if (resultsMap.size < 30) {
            const idSnap = await adminDb.collection("articles")
                .where(admin.firestore.FieldPath.documentId(), ">=", upperTerm)
                .where(admin.firestore.FieldPath.documentId(), "<=", upperTerm + "\uf8ff")
                .limit(30)
                .get();
            idSnap.docs.forEach(addDocToResults);
        }

        // 3. Ricerca per 'description' (se non abbiamo ancora 30 risultati)
        if (resultsMap.size < 30) {
            try {
                const descSnap = await adminDb.collection("articles")
                    .where("description", ">=", rawTerm)
                    .where("description", "<=", rawTerm + "\uf8ff")
                    .limit(20)
                    .get();
                descSnap.docs.forEach(addDocToResults);
            } catch {
                // Ignore se description non è indicizzato
            }
        }

        // 4. Ricerca per 'codice' (italiano)
        if (resultsMap.size < 30) {
            try {
                const codiceSnap = await adminDb.collection("articles")
                    .where("codice", ">=", upperTerm)
                    .where("codice", "<=", upperTerm + "\uf8ff")
                    .limit(20)
                    .get();
                codiceSnap.docs.forEach(addDocToResults);
            } catch {
                // Ignore
            }
        }

        return JSON.parse(JSON.stringify(Array.from(resultsMap.values())));
    } catch (error) {
        console.error("Errore in searchArticlesAction:", error);
        return [];
    }
}

/**
 * FASE 44: Silenzia un materiale per una specifica commessa (arrayUnion su mutedMaterials)
 */
export async function muteMaterialOnJob(jobId: string, materialCode: string): Promise<{ success: boolean; message: string }> {
    try {
        if (!jobId || !materialCode) {
            return { success: false, message: "Commessa o codice materiale mancante." };
        }
        const cleanCode = materialCode.trim().toUpperCase();
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const snap = await jobRef.get();
        if (!snap.exists) {
            return { success: false, message: "Commessa non trovata." };
        }

        await jobRef.update({
            mutedMaterials: admin.firestore.FieldValue.arrayUnion(cleanCode),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:muteMaterialOnJob');
        revalidatePath('/admin/data-management');
        return { success: true, message: `Materiale ${cleanCode} silenziato con successo per la commessa.` };
    } catch (error: any) {
        console.error("Errore in muteMaterialOnJob:", error);
        return { success: false, message: error?.message || "Errore durante il silenziamento del materiale." };
    }
}

/**
 * FASE 44: Riattiva un materiale silenziato per una specifica commessa (arrayRemove su mutedMaterials)
 */
export async function unmuteMaterialOnJob(jobId: string, materialCode: string): Promise<{ success: boolean; message: string }> {
    try {
        if (!jobId || !materialCode) {
            return { success: false, message: "Commessa o codice materiale mancante." };
        }
        const cleanCode = materialCode.trim().toUpperCase();
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const snap = await jobRef.get();
        if (!snap.exists) {
            return { success: false, message: "Commessa non trovata." };
        }

        await jobRef.update({
            mutedMaterials: admin.firestore.FieldValue.arrayRemove(cleanCode),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:unmuteMaterialOnJob');
        revalidatePath('/admin/data-management');
        return { success: true, message: `Materiale ${cleanCode} riattivato con successo per la commessa.` };
    } catch (error: any) {
        console.error("Errore in unmuteMaterialOnJob:", error);
        return { success: false, message: error?.message || "Errore durante la riattivazione del materiale." };
    }
}

/**
 * FASE 45: Gestione Semplificata C.to Lavoro (Silenziatore Impegni per Commessa)
 * Aggiunge o rimuove un codice articolo dall'array externalizedMaterials della commessa.
 */
export async function toggleExternalizedMaterial(
    jobId: string,
    materialCode: string,
    isExternalized: boolean
): Promise<{ success: boolean; message: string }> {
    try {
        if (!jobId || !materialCode) {
            return { success: false, message: "Commessa o codice materiale mancante." };
        }
        const cleanCode = materialCode.trim().toUpperCase();
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const snap = await jobRef.get();
        if (!snap.exists) {
            return { success: false, message: "Commessa non trovata." };
        }

        const updateOperation = isExternalized
            ? admin.firestore.FieldValue.arrayUnion(cleanCode)
            : admin.firestore.FieldValue.arrayRemove(cleanCode);

        await jobRef.update({
            externalizedMaterials: updateOperation,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:toggleExternalizedMaterial');
        revalidatePath('/admin/data-management');
        return { 
            success: true, 
            message: isExternalized 
                ? `Materiale ${cleanCode} inviato in C.to Lavoro (impegno silenziato).` 
                : `Materiale ${cleanCode} rimosso da C.to Lavoro (impegno ripristinato).` 
        };
    } catch (error: any) {
        console.error("Errore in toggleExternalizedMaterial:", error);
        return { success: false, message: error?.message || "Errore durante l'aggiornamento del Conto Lavoro." };
    }
}

/**
 * FASE 53: Salvataggio in blocco (Batch Save) dei materiali in C.to Lavoro
 * Aggiorna l'intero array externalizedMaterials della commessa in una singola operazione atomica su Firestore.
 */
export async function updateExternalizedMaterials(
    jobId: string,
    externalizedMaterials: string[]
): Promise<{ success: boolean; message: string }> {
    try {
        if (!jobId) {
            return { success: false, message: "ID commessa mancante." };
        }
        const cleanMaterials = Array.from(
            new Set((externalizedMaterials || []).map((m) => (m || '').trim().toUpperCase()).filter(Boolean))
        );
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const snap = await jobRef.get();
        if (!snap.exists) {
            return { success: false, message: "Commessa non trovata." };
        }

        await jobRef.update({
            externalizedMaterials: cleanMaterials,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
        await bumpMrpSyncVersion('jobsBom', 'programmazione:updateExternalizedMaterials');
        revalidatePath('/admin/data-management');
        return { 
            success: true, 
            message: cleanMaterials.length > 0 
                ? `${cleanMaterials.length} materiali contrassegnati in Conto Lavoro.` 
                : "Nessun materiale contrassegnato in Conto Lavoro per questa commessa." 
        };
    } catch (error: any) {
        console.error("Errore in updateExternalizedMaterials:", error);
        return { success: false, message: error?.message || "Errore durante l'aggiornamento del Conto Lavoro." };
    }
}

export interface SplitJobOrderResponse {
    success: boolean;
    message: string;
    error?: string;
    updatedOriginalJob?: JobOrder;
    childJob?: JobOrder;
}

/**
 * FASE 83: Motore Transazionale di "Split Commessa" (Lato Admin)
 * Divide una commessa esistente in due:
 * 1. Aggiorna la commessa originale con newQuantityOriginal e ricalcola proporzionalmente orePreviste e BOM.
 * 2. Crea la commessa figlia (es. 860/PF.6_1, _2, ...) con newQuantityChild, orePreviste complementari,
 *    stato resettato a "Pianificata" e fasi azzerate a pending.
 */
export async function splitJobOrder(
    jobId: string,
    newQuantityOriginal: number,
    newQuantityChild: number
): Promise<SplitJobOrderResponse> {
    try {
        const cleanJobId = (jobId || '').trim();
        if (!cleanJobId) {
            return {
                success: false,
                message: 'ID commessa mancante.',
                error: 'ID commessa mancante.',
            };
        }

        const qtyOrig = Number(newQuantityOriginal);
        const qtyChild = Number(newQuantityChild);

        const txResult = await adminDb.runTransaction(async (transaction): Promise<SplitJobOrderResponse> => {
            // 1. Lettura commessa originale in transazione
            const { jobRef, jobSnap } = await getJobOrderRefAndSnap(adminDb, cleanJobId, transaction);
            if (!jobSnap.exists) {
                return {
                    success: false,
                    message: 'Commessa originale non trovata.',
                    error: 'Commessa originale non trovata.',
                };
            }

            const originalJob = {
                ...convertTimestampsToDates(jobSnap.data()),
                id: jobSnap.id,
            } as JobOrder;

            const currentDisplayStatus = getJobDisplayStatus(originalJob);
            if (currentDisplayStatus === 'Completato Prod.' || currentDisplayStatus === 'Spedito') {
                const msg = `Impossibile dividere una commessa già conclusa (${currentDisplayStatus}).`;
                return {
                    success: false,
                    message: msg,
                    error: msg,
                };
            }

            // 2. FASE 83-BIS: Ricerca figli già esistenti il cui ordinePF inizia esattamente per `${job.ordinePF}_`
            const parentOrdinePF = (originalJob.ordinePF || '').trim();

            const childrenByPfQuery = adminDb
                .collection('jobOrders')
                .where('ordinePF', '>=', `${parentOrdinePF}_`)
                .where('ordinePF', '<=', `${parentOrdinePF}_\uf8ff`);

            const childrenPfSnap = await transaction.get(childrenByPfQuery);

            const existingChildOrdiniPF: string[] = [];
            childrenPfSnap.docs.forEach((d) => {
                const pf = d.data()?.ordinePF;
                if (pf && String(pf).trim().startsWith(`${parentOrdinePF}_`)) {
                    existingChildOrdiniPF.push(String(pf).trim());
                }
            });

            let { childOrdinePF, suffixNumber, childDocId } = computeNextChildOrdinePF(
                parentOrdinePF,
                existingChildOrdiniPF
            );

            let childRef = adminDb.collection('jobOrders').doc(childDocId);
            let childCheckSnap = await transaction.get(childRef);

            // Salvaguardia anti-collisione sull'ID documento normalizzato (es. 779-PF.2_1)
            while (childCheckSnap.exists) {
                suffixNumber += 1;
                childOrdinePF = `${parentOrdinePF}_${suffixNumber}`;
                childDocId = normalizeChildJobId(childOrdinePF);
                childRef = adminDb.collection('jobOrders').doc(childDocId);
                childCheckSnap = await transaction.get(childRef);
            }

            const annoCompetenza =
                originalJob.annoCompetenza || extractAnnoCompetenza(originalJob.dataConsegnaFinale);

            // 3. Validazione quantità e ricalcolo proporzionale (orePreviste, qtaRichiesta, BOM, fasi)
            const splitComputation = computeSplitJobPayloads({
                originalJob,
                newQuantityOriginal: qtyOrig,
                newQuantityChild: qtyChild,
                childId: childDocId,
                childOrdinePF,
            });

            if (!splitComputation.valid || !splitComputation.originalUpdatePayload || !splitComputation.childJobPayload) {
                const errMsg = splitComputation.error || 'Impossibile completare lo split della commessa.';
                return {
                    success: false,
                    message: errMsg,
                    error: errMsg,
                };
            }

            const now = new Date();
            const nowTs = admin.firestore.Timestamp.fromDate(now);

            const originalFirestoreUpdate = sanitizeFirestoreData({
                ...splitComputation.originalUpdatePayload,
                updatedAt: nowTs,
            });

            const childFirestoreDoc = sanitizeFirestoreData({
                ...splitComputation.childJobPayload,
                annoCompetenza,
                createdAt: nowTs,
                updatedAt: nowTs,
            });

            // 4. Scritture transazionali atomiche (update originale + set figlia)
            transaction.update(jobRef, originalFirestoreUpdate);
            transaction.set(childRef, childFirestoreDoc);

            const updatedOriginalClient: JobOrder = serializeForClient({
                ...originalJob,
                ...splitComputation.originalUpdatePayload,
                updatedAt: now.toISOString(),
            });

            const childClient: JobOrder = serializeForClient({
                ...splitComputation.childJobPayload,
                annoCompetenza,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });

            return {
                success: true,
                message: `Commessa divisa con successo: ${originalJob.ordinePF} (${qtyOrig} pz) + nuova commessa ${childOrdinePF} (${qtyChild} pz).`,
                updatedOriginalJob: updatedOriginalClient,
                childJob: childClient,
            };
        });

        if (txResult.success) {
            // FASE 91: Evita RSC revalidation massiva di /admin/programmazione dentro la Server Action
            await bumpMrpSyncVersion('jobsBom', 'programmazione:splitJobOrder');
            revalidatePath('/admin/data-management');
            revalidatePath('/admin/production-console');
        }

        return txResult;
    } catch (error: any) {
        console.error('Errore in splitJobOrder:', error);
        const msg = error?.message || 'Errore imprevisto durante lo split della commessa.';
        return {
            success: false,
            message: msg,
            error: msg,
        };
    }
}

const ODL_MEMO_TTL_MS = 15_000;
const odlArticleMemoCache = new Map<string, { article: Article; expiresAt: number }>();
const odlMaterialMemoCache = new Map<string, { material: RawMaterial; expiresAt: number }>();

/**
 * FASE 105-BIS: Invalida la cache server-side di breve durata degli articoli usata da `getOdlPrintData`,
 * così una stampa ODL immediatamente successiva al salvataggio BOM legge sempre la nuova distinta.
 */
export async function invalidateOdlArticleMemoCache(articleCode?: string): Promise<void> {
    if (articleCode) {
        odlArticleMemoCache.delete(articleCode.trim().toUpperCase());
    } else {
        odlArticleMemoCache.clear();
    }
}

/**
 * FASE 88 & FASE 96: Bulk Pre-fetcher Parallelo, Deduplicazione Anagrafiche/BOM In-Memory e Costruzione Dizionari O(1) per Stampa ODL.
 * Elimina completamente query sequenziali (waterfall) e fetch ridondanti:
 * 1. Esegue in parallelo (Promise.all) le query primarie per le commesse selezionate, gli articoli unici già noti e i materiali già noti.
 * 2. Deduplica/memoizza in memoria gli articleCode / articleId (se 5 ODL condividono lo stesso articolo, esegue 1 sola query e distribuisce in O(1)).
 * 3. Esegue una sola query delta parallela per eventuali codici articolo o componenti BOM scoperti dai documenti appena letti.
 * 4. Supporta l'idratazione SSoT aggregata e parallela dei materiali (hydrateMaterialsSSoTInParallel) senza query N+1.
 */
const ODL_JOB_SELECT_FIELDS: string[] = [
    'ordinePF',
    'numeroODL',
    'numeroODLInterno',
    'odlCounter',
    'cliente',
    'details',
    'articolo',
    'articleCode',
    'articleId',
    'qta',
    'department',
    'status',
    'workCycleId',
    'dataFinePreparazione',
    'dataConsegnaFinale',
    'dataConsegnaCliente',
    'billOfMaterials',
    'externalizedMaterials',
    'note',
    'technicalNotes',
    'technicalDrawingUrl',
    'isPrinted',
    'odlPrinted',
];

const ODL_ARTICLE_SELECT_FIELDS: string[] = [
    'code',
    'description',
    'name',
    'billOfMaterials',
    'phaseTimes',
    'workCycleId',
    'defaultDepartment',
    'department',
    'expectedMinutesDefault',
    'technicalNotes',
    'technicalDrawingUrl',
];

export async function getOdlPrintData(
    jobIds: string[],
    fallbackArticleCodes: string[] = [],
    fallbackMaterialCodes: string[] = [],
    options?: { includeStockHydration?: boolean }
): Promise<{
    jobsById: Record<string, JobOrder>;
    articlesByCode: Record<string, Article>;
    materialsByCode: Record<string, RawMaterial>;
    contoLavoroMap: Record<string, string[]>;
}> {
    const CHUNK_SIZE = 30;
    const nowMs = Date.now();
    const jobsById: Record<string, JobOrder> = {};
    const articlesByCode: Record<string, Article> = {};
    const materialsByCode: Record<string, RawMaterial> = {};
    const contoLavoroMap: Record<string, string[]> = {};

    const chunkArray = (arr: string[]): string[][] => {
        const res: string[][] = [];
        for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
            res.push(arr.slice(i, i + CHUNK_SIZE));
        }
        return res;
    };

    const registerArticleInMemory = (art: Article, discoveredMaterials?: Set<string>) => {
        const normCode = (art.code || '').trim().toUpperCase();
        const normId = (art.id || '').trim().toUpperCase();
        if (normCode) {
            articlesByCode[normCode] = art;
            odlArticleMemoCache.set(normCode, { article: art, expiresAt: nowMs + ODL_MEMO_TTL_MS });
        }
        if (normId) {
            articlesByCode[normId] = art;
            odlArticleMemoCache.set(normId, { article: art, expiresAt: nowMs + ODL_MEMO_TTL_MS });
        }
        if (discoveredMaterials) {
            (art.billOfMaterials || []).forEach((b) => {
                if (b?.component) {
                    discoveredMaterials.add(b.component.trim().toUpperCase());
                }
            });
        }
    };

    const registerMaterialInMemory = (mat: RawMaterial) => {
        const normCode = (mat.code || '').trim().toUpperCase();
        const normId = (mat.id || '').trim().toUpperCase();
        if (normCode) {
            materialsByCode[normCode] = mat;
            odlMaterialMemoCache.set(normCode, { material: mat, expiresAt: nowMs + ODL_MEMO_TTL_MS });
        }
        if (normId) {
            materialsByCode[normId] = mat;
            odlMaterialMemoCache.set(normId, { material: mat, expiresAt: nowMs + ODL_MEMO_TTL_MS });
        }
    };

    const fetchArticlesBatchParallel = async (codesToFetch: string[], discoveredMaterials: Set<string>) => {
        const uncached = Array.from(new Set(codesToFetch.filter(Boolean))).filter((code) => {
            if (articlesByCode[code]) return false;
            const cached = odlArticleMemoCache.get(code);
            if (cached && cached.expiresAt > nowMs) {
                registerArticleInMemory(cached.article, discoveredMaterials);
                return false;
            }
            return true;
        });

        if (uncached.length === 0) return;

        const artChunks = chunkArray(uncached);
        const validArtDocRefs = uncached
            .filter((code) => !code.includes('/'))
            .map((code) => adminDb.collection('articles').doc(code));

        const [byCodeSnaps, byIdDocs] = await Promise.all([
            Promise.all(
                artChunks.map((chunk) =>
                    adminDb
                        .collection('articles')
                        .where('code', 'in', chunk)
                        .select(...ODL_ARTICLE_SELECT_FIELDS)
                        .get()
                )
            ),
            validArtDocRefs.length > 0
                ? adminDb.getAll(...validArtDocRefs, { fieldMask: ODL_ARTICLE_SELECT_FIELDS })
                : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
        ]);

        const seenDocIds = new Set<string>();
        const handleSnap = (docSnap: FirebaseFirestore.DocumentSnapshot) => {
            if (!docSnap.exists || seenDocIds.has(docSnap.id)) return;
            seenDocIds.add(docSnap.id);
            const raw = docSnap.data() || {};
            const art = serializeForClient({
                ...convertTimestampsToDates(raw),
                id: docSnap.id,
                code: (raw.code || docSnap.id || '').trim(),
            }) as Article;
            registerArticleInMemory(art, discoveredMaterials);
        };

        byCodeSnaps.forEach((snap) => snap.forEach(handleSnap));
        byIdDocs.forEach(handleSnap);
    };

    const fetchMaterialsBatchParallel = async (codesToFetch: string[]) => {
        const uncached = Array.from(new Set(codesToFetch.filter(Boolean))).filter((code) => {
            if (materialsByCode[code]) return false;
            if (!options?.includeStockHydration) {
                const cached = odlMaterialMemoCache.get(code);
                if (cached && cached.expiresAt > nowMs) {
                    registerMaterialInMemory(cached.material);
                    return false;
                }
            }
            return true;
        });

        if (uncached.length === 0) return;

        const matChunks = chunkArray(uncached);
        const buildQuery = (field: string | FirebaseFirestore.FieldPath, chunk: string[]) => {
            const base = adminDb.collection('rawMaterials').where(field, 'in', chunk);
            if (options?.includeStockHydration) {
                return base.get();
            }
            return base
                .select(
                    'code',
                    'type',
                    'unitOfMeasure',
                    'conversionFactor',
                    'rapportoKgMt',
                    'description'
                )
                .get();
        };

        const [matByCodeSnaps, matByIdSnaps] = await Promise.all([
            Promise.all(matChunks.map((chunk) => buildQuery('code', chunk))),
            Promise.all(
                matChunks.map((chunk) =>
                    buildQuery(admin.firestore.FieldPath.documentId(), chunk)
                )
            ),
        ]);

        const seenDocIds = new Set<string>();
        const fetchedMaterials: RawMaterial[] = [];

        const handleMatSnap = (docSnap: FirebaseFirestore.QueryDocumentSnapshot) => {
            if (seenDocIds.has(docSnap.id)) return;
            seenDocIds.add(docSnap.id);
            const raw = docSnap.data();
            const mat = serializeForClient({
                ...convertTimestampsToDates(raw),
                id: docSnap.id,
                code: (raw.code || docSnap.id || '').trim(),
            }) as RawMaterial;
            fetchedMaterials.push(mat);
        };

        matByCodeSnaps.forEach((snap) => snap.forEach(handleMatSnap));
        matByIdSnaps.forEach((snap) => snap.forEach(handleMatSnap));

        const finalMaterials = options?.includeStockHydration
            ? await hydrateMaterialsSSoTInParallel(fetchedMaterials)
            : fetchedMaterials;

        finalMaterials.forEach(registerMaterialInMemory);
    };

    try {
        const cleanJobIds = Array.from(
            new Set((jobIds || []).map((id) => (id || '').trim()).filter((id) => id.length > 0 && !id.includes('/')))
        );

        const initialArticleCodes = Array.from(
            new Set((fallbackArticleCodes || []).map((c) => (c || '').trim().toUpperCase()).filter(Boolean))
        );
        const initialMaterialCodes = Array.from(
            new Set((fallbackMaterialCodes || []).map((c) => (c || '').trim().toUpperCase()).filter(Boolean))
        );

        const discoveredArticleCodes = new Set<string>(initialArticleCodes);
        const discoveredMaterialCodes = new Set<string>(initialMaterialCodes);

        const jobRefs = cleanJobIds.map((id) => adminDb.collection('jobOrders').doc(id));

        // 1. WAVE 1 PARALLELA: adminDb.getAll con fieldMask mirato su jobOrders + articoli noti + materiali noti
        const [jobDocSnapshots] = await Promise.all([
            jobRefs.length > 0
                ? adminDb.getAll(...jobRefs, { fieldMask: ODL_JOB_SELECT_FIELDS })
                : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
            fetchArticlesBatchParallel(initialArticleCodes, discoveredMaterialCodes),
            fetchMaterialsBatchParallel(initialMaterialCodes),
        ]);

        for (const docSnap of jobDocSnapshots) {
            if (!docSnap.exists) continue;
            const rawData = docSnap.data() || {};
            const jobData = serializeForClient({
                ...convertTimestampsToDates(rawData),
                id: docSnap.id,
            }) as JobOrder;

            jobsById[jobData.id] = jobData;

            // Pre-compila il dizionario Conto Lavoro O(1): Record<JobId, MaterialId[]>
            const extList = Array.from(
                new Set(
                    (jobData.externalizedMaterials || [])
                        .map((m) => (m || '').trim().toUpperCase())
                        .filter(Boolean)
                )
            );
            contoLavoroMap[jobData.id] = extList;
            if (jobData.ordinePF) {
                contoLavoroMap[jobData.ordinePF] = extList;
            }

            const artCode = (
                (jobData as any).articolo ||
                jobData.details ||
                (jobData as any).articleCode ||
                ''
            )
                .trim()
                .toUpperCase();
            if (artCode) {
                discoveredArticleCodes.add(artCode);
            }

            (jobData.billOfMaterials || []).forEach((item) => {
                if (item?.component) {
                    discoveredMaterialCodes.add(item.component.trim().toUpperCase());
                }
            });
        }

        // 2. WAVE 2 PARALLELA: fetch simultaneo degli articoli delta e dei materiali già scoperti dalle commesse
        const missingDeltaArticles = Array.from(discoveredArticleCodes).filter(
            (code) => !articlesByCode[code]
        );
        const missingKnownMaterials = Array.from(discoveredMaterialCodes).filter(
            (code) => !materialsByCode[code]
        );
        const extraArticleMaterials = new Set<string>();

        if (missingDeltaArticles.length > 0 || missingKnownMaterials.length > 0) {
            await Promise.all([
                missingDeltaArticles.length > 0
                    ? fetchArticlesBatchParallel(missingDeltaArticles, extraArticleMaterials)
                    : Promise.resolve(),
                missingKnownMaterials.length > 0
                    ? fetchMaterialsBatchParallel(missingKnownMaterials)
                    : Promise.resolve(),
            ]);
        }

        // Eventuale mini-wave 3 solo per materiali scoperti dalle BOM degli articoli appena caricati
        const remainingExtraMaterials = Array.from(extraArticleMaterials).filter(
            (code) => !materialsByCode[code]
        );
        if (remainingExtraMaterials.length > 0) {
            await fetchMaterialsBatchParallel(remainingExtraMaterials);
        }

        return {
            jobsById,
            articlesByCode,
            materialsByCode,
            contoLavoroMap,
        };
    } catch (error) {
        console.error('Errore durante getOdlPrintData:', error);
        return {
            jobsById,
            articlesByCode,
            materialsByCode,
            contoLavoroMap,
        };
    }
}

export const getBulkOdlPrintData = getOdlPrintData;
export const getMassiveOdlPrintData = getOdlPrintData;
export const fetchMultipleJobsForPrint = getOdlPrintData;
