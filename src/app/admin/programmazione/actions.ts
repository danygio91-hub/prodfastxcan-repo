'use server';

import { 
    getJobOrders as fetchAllJobOrders, 
    getDepartments as fetchAllDepartments,
    saveManualJobOrder,
    getWorkCycles,
    createPhasesFromCycle
} from '@/app/admin/data-management/actions';
import { adminDb } from '@/lib/firebase-admin';
import { convertTimestampsToDates, parseRobustDate } from '@/lib/utils';
import { distributeTheoreticalTimes } from '@/lib/production-time-server-utils';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { fetchInChunks } from '@/lib/firestore-utils';
import { getWeek, getYear } from 'date-fns';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article, WorkCycle, JobBillOfMaterialsItem } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

export async function getJobOrders(): Promise<JobOrder[]> {
    return await fetchAllJobOrders();
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
 * Aggiornamento rapido N° ODL (on blur)
 */
export async function updateJobOdlNumber(jobId: string, newOdl: string): Promise<{ success: boolean; message: string }> {
    try {
        const val = (newOdl || '').trim();
        await adminDb.collection("jobOrders").doc(jobId).update({
            numeroODLInterno: val || null,
            numeroODL: val || null,
            updatedAt: new Date().toISOString(),
        });
        return { success: true, message: 'N° ODL aggiornato con successo.' };
    } catch (error) {
        console.error("Errore salvataggio N° ODL:", error);
        return { success: false, message: "Errore durante il salvataggio del N° ODL." };
    }
}

/**
 * Aggiornamento Stato Commessa
 */
export async function updateJobStatus(jobId: string, newStatus: string): Promise<{ success: boolean; message: string }> {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({
            status: newStatus,
            updatedAt: new Date().toISOString(),
        });
        return { success: true, message: `Stato aggiornato a ${newStatus}.` };
    } catch (error) {
        console.error("Errore aggiornamento stato commessa:", error);
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
                isoWeek = getWeek(d, { weekStartsOn: 1 });
                weekYear = getYear(d);
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
                isoWeek = getWeek(d, { weekStartsOn: 1 });
                weekYear = getYear(d);
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

