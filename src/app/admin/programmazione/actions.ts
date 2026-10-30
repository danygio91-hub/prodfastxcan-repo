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
    markJobAsPrinted as markJobAsPrintedSSoT
} from '@/app/admin/data-management/actions';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { getJobDisplayStatus, type JobDisplayStatus } from '@/lib/job-status';
import { convertTimestampsToDates, parseRobustDate } from '@/lib/utils';
import { distributeTheoreticalTimes } from '@/lib/production-time-server-utils';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { fetchInChunks } from '@/lib/firestore-utils';
import { getISOWeek, getISOWeekYear, format, addWeeks } from 'date-fns';
import { generatePlanningExcelBuffer, type ExportJobData } from '@/lib/excel-export';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article, WorkCycle, JobBillOfMaterialsItem } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

export async function getJobOrders(): Promise<JobOrder[]> {
    return await fetchAllJobOrders();
}

/**
 * Lazy Loading: Carica inizialmente da Firestore SOLO le commesse PIANIFICATE e AVVIATE.
 * Risparmia migliaia di letture Firestore non scaricando lo storico concluso.
 */
export async function getActiveJobOrders(): Promise<JobOrder[]> {
    const [planned, production] = await Promise.all([
        getPlannedJobOrders(),
        getProductionJobOrders(),
    ]);
    return [...planned, ...production];
}

/**
 * Lazy Loading On-Demand: Carica le commesse CONCLUSE solo al click fisico dell'utente sul relativo tab.
 */
export async function fetchCompletedJobOrdersAction(): Promise<JobOrder[]> {
    return await getCompletedJobOrders();
}

export async function getDepartments(): Promise<Department[]> {
    return await fetchAllDepartments();
}

export { saveManualJobOrder, getWorkCycles };

/**
 * Targeted Fetching MRP:
 * Scarica SOLO le giacenze e i Purchase Orders per i materiali effettivamente
 * necessari alle commesse attualmente visualizzate nella griglia.
 */
export async function getTargetedMRPData(
    materialCodes: string[],
    articleCodes: string[] = []
): Promise<{
    rawMaterials: RawMaterial[];
    purchaseOrders: PurchaseOrder[];
    articles: Article[];
    globalSettings: GlobalSettings | null;
}> {
    try {
        const uniqueMatCodes = new Set<string>(
            materialCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        );
        const uniqueArtCodes = [...new Set(
            articleCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
        )];

        const articles: Article[] = [];
        const chunkSize = 30; // Limite 'in' di Firestore

        // 1. Fetch mirato Articoli (per ricavare distinte base mancanti sulle commesse)
        if (uniqueArtCodes.length > 0) {
            for (let i = 0; i < uniqueArtCodes.length; i += chunkSize) {
                const chunk = uniqueArtCodes.slice(i, i + chunkSize);
                const artSnap = await adminDb.collection("articles")
                    .where("code", "in", chunk)
                    .get();
                artSnap.forEach(d => {
                    const art = { ...convertTimestampsToDates(d.data()), id: d.id } as Article;
                    articles.push(art);
                    (art.billOfMaterials || []).forEach(b => {
                        if (b.component) uniqueMatCodes.add(b.component.trim().toUpperCase());
                    });
                });
            }
        }

        const finalMatCodes = [...uniqueMatCodes];
        const rawMaterials: RawMaterial[] = [];
        const purchaseOrders: PurchaseOrder[] = [];

        // 2. Fetch mirato RawMaterials e PurchaseOrders in blocchi di max 30
        if (finalMatCodes.length > 0) {
            for (let i = 0; i < finalMatCodes.length; i += chunkSize) {
                const chunk = finalMatCodes.slice(i, i + chunkSize);
                const [matSnap, poSnap] = await Promise.all([
                    adminDb.collection("rawMaterials").where("code", "in", chunk).get(),
                    adminDb.collection("purchaseOrders").where("materialCode", "in", chunk).get(),
                ]);

                matSnap.forEach(d => {
                    rawMaterials.push({ ...convertTimestampsToDates(d.data()), id: d.id } as RawMaterial);
                });

                poSnap.forEach(d => {
                    const po = { ...convertTimestampsToDates(d.data()), id: d.id } as PurchaseOrder;
                    const st = String(po.status || '').toLowerCase();
                    if (st !== 'completed' && st !== 'cancelled' && st !== 'received') {
                        purchaseOrders.push(po);
                    }
                });
            }
        }

        // 3. Global Settings
        let globalSettings: GlobalSettings | null = null;
        try {
            const settingsSnap = await adminDb.collection("settings").doc("global").get();
            if (settingsSnap.exists) {
                globalSettings = convertTimestampsToDates(settingsSnap.data()) as GlobalSettings;
            }
        } catch (e) {
            console.warn("Impossibile caricare impostazioni globali in getTargetedMRPData:", e);
        }

        return { rawMaterials, purchaseOrders, articles, globalSettings };
    } catch (error) {
        console.error("Errore durante getTargetedMRPData:", error);
        return { rawMaterials: [], purchaseOrders: [], articles: [], globalSettings: null };
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
        revalidatePath('/admin/programmazione');
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
 * Aggiornamento rapido N° ODL (on blur)
 */
export async function updateJobOdlNumber(jobId: string, newOdl: string): Promise<{ success: boolean; message: string }> {
    try {
        const val = (newOdl || '').trim();
        await adminDb.collection("jobOrders").doc(jobId).update({
            numeroODLInterno: val || null,
            numeroODL: val || null,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        return { success: true, message: 'N° ODL aggiornato con successo.' };
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
 * - Riserva e incrementa il contatore odl_${year}
 * - Imposta status: 'DA_INIZIARE', numeroODLInterno e odlCreationDate
 */
export async function startJobProduction(
    jobId: string, 
    manualOdlNumberStr?: string
): Promise<{ success: boolean; message: string; job?: Partial<JobOrder> }> {
    try {
        const res = await createODL(jobId, manualOdlNumberStr);
        if (!res.success) {
            return { success: false, message: res.message };
        }

        const jobSnap = await adminDb.collection("jobOrders").doc(jobId).get();
        const updatedData = jobSnap.data() as JobOrder | undefined;

        revalidatePath('/admin/programmazione');
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        return {
            success: true,
            message: res.message,
            job: updatedData ? {
                status: updatedData.status,
                numeroODLInterno: updatedData.numeroODLInterno,
                odlCreationDate: updatedData.odlCreationDate ? new Date().toISOString() : undefined,
                odlCounter: updatedData.odlCounter,
            } : undefined
        };
    } catch (e: any) {
        console.error("Errore in startJobProduction:", e);
        return { success: false, message: e?.message || "Errore durante l'avvio della commessa." };
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
): Promise<{ success: boolean; message: string; odlNumber?: string }> {
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
            revalidatePath('/admin/programmazione');
            revalidatePath('/admin/data-management');
            revalidatePath('/admin/production-console');
            return { success: true, message: `Commessa ${job.ordinePF || jobId} riportata in pianificazione.` };
        }

        // 2. STATO: IN PRODUZIONE
        if (targetStatus === 'In Produzione') {
            const isBacklogPlanned = [
                'planned', 
                'in_attesa', 
                'in pianificazione', 
                'in_pianificazione', 
                'pianificata', 
                'pianificato'
            ].includes(currentStatusLower);

            if (isBacklogPlanned) {
                // Avvia tramite createODL (genera ODL e verifica distinte)
                const res = await createODL(jobId);
                if (!res.success) {
                    return { success: false, message: res.message };
                }
                const refreshed = await jobRef.get();
                const refreshedData = refreshed.data() as JobOrder;
                return { 
                    success: true, 
                    message: res.message, 
                    odlNumber: refreshedData?.numeroODLInterno || undefined 
                };
            } else {
                // Riapertura da completata o spedita
                const batch = adminDb.batch();
                batch.update(jobRef, {
                    status: 'DA_INIZIARE',
                    forcedCompletion: admin.firestore.FieldValue.delete(),
                    overallEndTime: admin.firestore.FieldValue.delete(),
                    packingListId: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.Timestamp.now()
                });
                await batch.commit();
                revalidatePath('/admin/programmazione');
                revalidatePath('/admin/production-console');
                return { success: true, message: `Commessa ${job.ordinePF || jobId} riaperta in produzione.` };
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
            revalidatePath('/admin/programmazione');
            revalidatePath('/admin/production-console');
            return { success: true, message: `Commessa ${job.ordinePF || jobId} completata con successo.` };
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
            revalidatePath('/admin/programmazione');
            revalidatePath('/admin/production-console');
            revalidatePath('/operator/packing');
            return { success: true, message: `Commessa ${job.ordinePF || jobId} contrassegnata come spedita.` };
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
        return { success: true, message: `Stato aggiornato a ${newStatus}.` };
    } catch (error) {
        return { success: false, message: "Errore durante l'aggiornamento dello stato." };
    }
}

/**
 * Aggiornamento Data Consegna Finale (on blur / Enter)
 */
export async function updateJobDeliveryDate(jobId: string, newDate: string): Promise<{ success: boolean; message: string }> {
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

        const updatePayload: Record<string, any> = {
            dataConsegnaFinale: val,
            updatedAt: new Date().toISOString(),
        };
        if (isoWeek !== null) updatePayload.isoWeek = isoWeek;
        if (weekYear !== null) updatePayload.weekYear = weekYear;
        if (targetWeek !== null) updatePayload.targetWeek = targetWeek;

        await adminDb.collection("jobOrders").doc(jobId).update(updatePayload);
        return { success: true, message: 'Data di consegna aggiornata con successo.' };
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
): Promise<{ success: boolean; message: string }> {
    try {
        const payload: Record<string, any> = {
            assignedDate: assignedDate || null,
            isoWeek: isoWeek || null,
            weekYear: weekYear || null,
            targetWeek: targetWeek || null,
            updatedAt: new Date().toISOString(),
        };
        await adminDb.collection("jobOrders").doc(jobId).update(payload);
        return { success: true, message: 'Settimana aggiornata con successo.' };
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

        const sanitizedId = ordinePF.replace(/\//g, '-').trim();
        const docRef = adminDb.collection("jobOrders").doc(sanitizedId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return { success: false, message: `Esiste già una commessa con Ordine PF ${ordinePF}.` };
        }

        let phases: any[] = [];
        let jobBOM: JobBillOfMaterialsItem[] = [];
        let workCycleId = '';
        let targetDept = department || 'CP';
        let expectedMinutesDefault = 0;

        const artSnap = await adminDb.collection("articles").doc(articleCode.toUpperCase().trim()).get();
        if (artSnap.exists) {
            const artData = artSnap.data() as Article;
            workCycleId = artData.workCycleId || '';
            if ((artData as any).department) targetDept = (artData as any).department;
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

            jobBOM = (artData.billOfMaterials || []).map(item => {
                const compCode = item.component.toUpperCase().trim();
                const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
                const typeConfig = material && globalSettings ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
                const requiresCut = typeConfig?.requiresCutLength !== false;

                const req = calculateBOMRequirement(
                    Number(qta),
                    {
                        quantity: item.quantity,
                        lunghezzaTaglioMm: requiresCut ? item.lunghezzaTaglioMm : undefined,
                        unit: item.unit
                    },
                    material || { unitOfMeasure: item.unit, conversionFactor: 1, rapportoKgMt: 0 } as any,
                    typeConfig || { defaultUnit: item.unit }
                );

                return {
                    ...item,
                    component: compCode,
                    status: 'pending' as const,
                    isFromTemplate: true,
                    lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
                    fabbisognoTotale: req.totalInBaseUnits,
                    pesoStimato: req.weightKg
                };
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
            id: sanitizedId,
            ordinePF: ordinePF.trim(),
            cliente: cliente.trim(),
            details: articleCode.toUpperCase().trim(),
            qta: Number(qta) || 1,
            department: targetDept,
            dataConsegnaFinale: dataConsegnaFinale || '',
            numeroODLInterno: odlToAssign,
            numeroODL: odlToAssign || 'N/D',
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

        // 2. Controllo duplicati interni
        const seenPFs = new Set<string>();
        for (const row of items) {
            const pf = row.ordinePF.trim().toUpperCase();
            if (seenPFs.has(pf)) {
                return { success: false, message: `Ordine PF duplicato nell'elenco inviato: "${row.ordinePF}".` };
            }
            seenPFs.add(pf);
        }

        // 3. Controllo duplicati su Firestore
        const sanitizedIds = items.map(r => r.ordinePF.replace(/\//g, '-').trim());
        const existingDocs = await fetchInChunks<JobOrder>(
            adminDb.collection("jobOrders"),
            admin.firestore.FieldPath.documentId(),
            sanitizedIds
        );
        if (existingDocs.length > 0) {
            const duplicatePFs = existingDocs.map(d => d.ordinePF || d.id).join(', ');
            return { success: false, message: `Commesse già esistenti nel sistema: ${duplicatePFs}.` };
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
            const sanitizedId = row.ordinePF.replace(/\//g, '-').trim();
            const artCode = row.articleCode.trim().toUpperCase();
            const artData = articlesMap.get(artCode)!;
            const qtaNum = Number(row.qta) || 1;

            const workCycleId = artData.workCycleId || '';
            const targetDept = row.department || (artData as any).department || 'CP';
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
            const jobBOM: JobBillOfMaterialsItem[] = (artData.billOfMaterials || []).map(item => {
                const compCode = item.component.toUpperCase().trim();
                const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
                const typeConfig = material && globalSettings ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
                const requiresCut = typeConfig?.requiresCutLength !== false;

                const req = calculateBOMRequirement(
                    qtaNum,
                    {
                        quantity: item.quantity,
                        lunghezzaTaglioMm: requiresCut ? item.lunghezzaTaglioMm : undefined,
                        unit: item.unit
                    },
                    material || { unitOfMeasure: item.unit, conversionFactor: 1, rapportoKgMt: 0 } as any,
                    typeConfig || { defaultUnit: item.unit }
                );

                return {
                    ...item,
                    component: compCode,
                    status: 'pending' as const,
                    isFromTemplate: true,
                    lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
                    fabbisognoTotale: req.totalInBaseUnits,
                    pesoStimato: req.weightKg
                };
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
                id: sanitizedId,
                ordinePF: row.ordinePF.trim(),
                cliente: row.cliente.trim(),
                details: artCode,
                qta: qtaNum,
                department: targetDept,
                dataConsegnaFinale: normalizedDeliveryDate,
                numeroODLInterno: odlToAssign,
                numeroODL: odlToAssign || 'N/D',
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

        // 8. Scrittura Batch Atomica
        const batch = adminDb.batch();
        newJobs.forEach(job => {
            const ref = adminDb.collection("jobOrders").doc(job.id);
            batch.set(ref, sanitizeFirestoreData(job));
        });
        await batch.commit();

        revalidatePath('/admin/programmazione');
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

        revalidatePath('/admin/programmazione');
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

        revalidatePath('/admin/programmazione');
        revalidatePath('/admin/production-console');
        revalidatePath('/operator/packing');
        return { success: true, message: `${jobIds.length} commesse contrassegnate come SPEDITE.`, count: jobIds.length };
    } catch (e: any) {
        console.error("Errore in bulkShipJobs:", e);
        return { success: false, message: e?.message || "Errore durante la spedizione massiva.", count: 0 };
    }
}

/**
 * FASE 16: Avvio e Stampa massiva commesse selezionate
 * Nota logica: le commesse prive di data di consegna vengono escluse in automatico dall'avvio
 */
export async function bulkStartProductionAndPrint(
    jobIds: string[]
): Promise<{ 
    success: boolean; 
    message: string; 
    startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[];
    skippedNoDate: string[];
}> {
    try {
        const startedJobs: { id: string; ordinePF: string; numeroODLInterno?: string }[] = [];
        const skippedNoDate: string[] = [];

        for (const id of jobIds) {
            const docSnap = await adminDb.collection("jobOrders").doc(id).get();
            if (!docSnap.exists) continue;
            const job = docSnap.data() as JobOrder;
            if (!job.dataConsegnaFinale || !job.dataConsegnaFinale.trim()) {
                skippedNoDate.push(job.ordinePF || id);
                continue;
            }

            const currentStatusLower = (job.status || '').toLowerCase().trim();
            const isAlreadyStarted = ['da_iniziare', 'in_preparazione', 'pronto_prod', 'in_produzione', 'fine_produzione', 'qlty_pack', 'chiuso', 'in produzione', 'completato prod.', 'spedito'].includes(currentStatusLower);

            let odlNum = job.numeroODLInterno;
            if (!isAlreadyStarted) {
                const res = await createODL(id);
                if (res.success) {
                    const refreshed = await adminDb.collection("jobOrders").doc(id).get();
                    odlNum = (refreshed.data() as JobOrder)?.numeroODLInterno || odlNum;
                }
            }

            await adminDb.collection("jobOrders").doc(id).update({
                isPrinted: true,
                odlPrinted: true,
                updatedAt: admin.firestore.Timestamp.now()
            });

            startedJobs.push({
                id,
                ordinePF: job.ordinePF || id,
                numeroODLInterno: odlNum || undefined
            });
        }

        revalidatePath('/admin/programmazione');
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');

        const message = startedJobs.length > 0 
            ? `Avviate e segnate come stampate ${startedJobs.length} commesse.${skippedNoDate.length > 0 ? ` Escluse ${skippedNoDate.length} prive di data.` : ''}`
            : `Nessuna commessa avviata.${skippedNoDate.length > 0 ? ` Tutte le ${skippedNoDate.length} commesse selezionate erano prive di data.` : ''}`;

        return {
            success: startedJobs.length > 0,
            message,
            startedJobs,
            skippedNoDate
        };
    } catch (e: any) {
        console.error("Errore in bulkStartProductionAndPrint:", e);
        return { success: false, message: e?.message || "Errore durante l'avvio massivo.", startedJobs: [], skippedNoDate: [] };
    }
}

// =========================================================================
// FASE 18: GESTIONE PERSISTENZA CAPACITÀ SETTIMANALE E AGGREGAZIONE REPARTI
// =========================================================================

export interface DayCapacityConfigData {
    L: number;
    M: number;
    Me: number;
    G: number;
    V: number;
    overtime: number;
}

export async function getCapacityBuckets(year: number, week: number): Promise<Record<string, DayCapacityConfigData>> {
    try {
        const snap = await adminDb.collection("capacityBuckets")
            .where("year", "==", year)
            .where("week", "==", week)
            .get();

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
 * Determina il gruppo macro-reparto (CP, CG, BF, OTHER) per una commessa
 */
function getJobDepartmentGroup(job: JobOrder): 'CP' | 'CG' | 'BF' | 'OTHER' {
    const d = (job.department || '').toUpperCase().trim();
    if (d === 'CP' || d.includes('PICCOL') || d.includes('CONNESSIONI PICCOLE')) return 'CP';
    if (d === 'CG' || d.includes('GRAND') || d.includes('CONNESSIONI GRANDI')) return 'CG';
    if (d === 'BF' || d.includes('BARRE') || d.includes('REPARTO BARRE')) return 'BF';

    if (job.phases && job.phases.length > 0) {
        for (const p of job.phases) {
            const pDepts = (p.departmentCodes || []).map(c => c.toUpperCase());
            const pName = (p.name || '').toUpperCase();
            if (pDepts.includes('CP') || pName.includes('PICCOL')) return 'CP';
            if (pDepts.includes('CG') || pName.includes('GRAND')) return 'CG';
            if (pDepts.includes('BF') || pName.includes('BARRE')) return 'BF';
        }
    }

    return 'OTHER';
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




