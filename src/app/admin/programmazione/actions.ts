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
import type { JobDisplayStatus } from '@/lib/job-status';
import { convertTimestampsToDates, parseRobustDate } from '@/lib/utils';
import { distributeTheoreticalTimes } from '@/lib/production-time-server-utils';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { fetchInChunks } from '@/lib/firestore-utils';
import { getISOWeek, getISOWeekYear } from 'date-fns';
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
                odlCreationDate: null,
                overallStartTime: null,
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


