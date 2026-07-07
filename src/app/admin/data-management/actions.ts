'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate, Article, JobBillOfMaterialsItem, Department, RawMaterial, ManualCommitment, Client, BillOfMaterialsItem } from '@/types';
import * as z from 'zod';
import { convertTimestampsToDates, normalizeDateStr } from '@/lib/utils';
import { fetchInChunks } from '@/lib/firestore-utils';
import { distributeTheoreticalTimes } from '@/lib/production-time-server-utils';
import { calculateBOMRequirement, syncJobBOMItems } from '@/lib/inventory-utils';


function sanitizeDocumentId(id: string): string {
  return id.replace(/\//g, '-');
}

/**
 * Utility to deeply sanitize objects for Firestore, 
 * converting undefined to null and removing undefined keys.
 */
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


export async function createPhasesFromCycle(cycleId: string, templatesMap?: Map<string, WorkPhaseTemplate>): Promise<JobPhase[]> {
    if (!cycleId) return [];
    const cycleSnap = await adminDb.collection("workCycles").doc(cycleId).get();
    if (!cycleSnap.exists) return [];
    const cycle = cycleSnap.data() as WorkCycle;
    const phaseTemplateIds = cycle.phaseTemplateIds;
    if (!phaseTemplateIds || phaseTemplateIds.length === 0) return [];
    
    let allTemplatesMap = templatesMap;
    if (!allTemplatesMap) {
        const templatesSnap = await adminDb.collection("workPhaseTemplates").get();
        allTemplatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));
    }

    return phaseTemplateIds.map((templateId, index): JobPhase | null => {
        const template = allTemplatesMap!.get(templateId);
        if (!template) return null;
        return {
            id: template.id, name: template.name, status: 'pending' as const, materialReady: template.isIndependent || template.type === 'preparation',
            workPeriods: [], sequence: index + 1, type: template.type || 'production', tracksTime: template.tracksTime !== false, 
            requiresMaterialScan: template.requiresMaterialScan, requiresMaterialSearch: template.requiresMaterialSearch,
            requiresMaterialAssociation: template.requiresMaterialAssociation, allowedMaterialTypes: template.allowedMaterialTypes || [],
            materialConsumptions: [], qualityResult: null, departmentCodes: template.departmentCodes || [], isIndependent: template.isIndependent || false,
            theoreticalWeight: cycle.phaseWeights?.[index] || 1,
        };
    }).filter((p): p is JobPhase => p !== null);
}

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const snap = await adminDb.collection("jobOrders")
    .where("status", "in", ["planned", "IN_ATTESA", "In Pianificazione", "IN_PIANIFICAZIONE", "PIANIFICATE", "PIANIFICATA", "PLANNED", "PIANIFICATO", "PREP", "CONFIRMED"] as any[])
    .get();
  return snap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data() as any), id: doc.id } as JobOrder));
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const snap = await adminDb.collection("jobOrders")
        .where("status", "in", [
            "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
            "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
            "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
            "Manca Materiale", "Problema", "Sospesa", "PRODUCTION", "PAUSED", "SUSPENDED",
            "ATTIVO", "ACTIVE", "IN_PROGRESS", "IN_LAVORAZIONE"
        ])
        .get();
    return snap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data() as any), id: doc.id } as JobOrder));
}

export async function getCompletedJobOrders(): Promise<JobOrder[]> {
    const snap = await adminDb.collection("jobOrders")
        .where("status", "in", ["Completata", "CHIUSO", "completed", "shipped", "closed", "COMPLETATA", "FINE PROD", "SPEDITA"])
        .get(); 
    return snap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data() as any), id: doc.id } as JobOrder));
}


export async function getRequiredDataForJobs(jobs: JobOrder[], commitments: ManualCommitment[] = []): Promise<{ articles: Article[], materials: RawMaterial[] }> {
    const arrArticleCodes = new Set<string>();
    const directMaterialCodes = new Set<string>();
    
    jobs.forEach(j => {
        if (j.details) arrArticleCodes.add(j.details.toUpperCase());
        j.billOfMaterials?.forEach(b => {
            if (b.component) directMaterialCodes.add(b.component.toUpperCase().trim());
        });
    });

    commitments.forEach(c => {
        if (c.articleCode) arrArticleCodes.add(c.articleCode.toUpperCase());
    });

    const uniqueArticles = [...arrArticleCodes];
    const articlesRes = await fetchInChunks<Article>(
        adminDb.collection("articles"),
        "code",
        uniqueArticles
    );
    
    articlesRes.forEach(a => {
        // Add components from fetched articles
        a.billOfMaterials?.forEach(b => {
            if (b.component) directMaterialCodes.add(b.component.toUpperCase().trim());
        });
    });

    const uniqueMaterials = [...directMaterialCodes];
    const materialsRes = await fetchInChunks<RawMaterial>(
        adminDb.collection("rawMaterials"),
        "code",
        uniqueMaterials
    );

    return { articles: articlesRes, materials: materialsRes };
}

export async function getDepartments(): Promise<Department[]> {
    const snap = await adminDb.collection("departments").orderBy("name").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
}

export async function saveManualJobOrder(data: any) {
    const { ordinePF, articleCode, qta, cliente, dataConsegnaFinale, dataFinePreparazione, department, workCycleId, numeroODLInterno } = data;
    
    // Validation
    if (dataFinePreparazione && dataConsegnaFinale && dataFinePreparazione > dataConsegnaFinale) {
        return { success: false, message: "La data fine preparazione non può essere successiva alla consegna finale." };
    }
    
    const sanitizedId = sanitizeDocumentId(ordinePF);
    const docRef = adminDb.collection("jobOrders").doc(sanitizedId);
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
        return { success: false, message: "Esiste già una commessa con questo Ordine PF." };
    }

    const articleSnap = await adminDb.collection("articles").doc(articleCode.toUpperCase()).get();
    if (!articleSnap.exists) {
        return { success: false, message: "Articolo non trovato in anagrafica." };
    }
    const articleData = articleSnap.data() as Article;

    const globalSettingsSnap = await adminDb.collection("settings").doc("global").get();
    const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;

    const compCodes = (articleData.billOfMaterials || []).map(item => item.component.toUpperCase().trim());
    const rawMaterials = compCodes.length > 0 ? await fetchInChunks<RawMaterial>(
        adminDb.collection("rawMaterials"),
        "code",
        compCodes
    ) : [];

    const phases = await createPhasesFromCycle(workCycleId);
    const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => {
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
            status: 'pending', 
            isFromTemplate: true,
            lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
            fabbisognoTotale: req.totalInBaseUnits,
            pesoStimato: req.weightKg
        };
    });

    const now = new Date();
    const shortYear = now.getFullYear().toString().slice(-2);
    
    let odlToAssign = null;
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

    const newJob: JobOrder = {
        id: sanitizedId,
        status: 'IN_PIANIFICAZIONE',
        postazioneLavoro: 'Da Assegnare',
        cliente: cliente || "N/D",
        ordinePF: ordinePF,
        numeroODL: "MANUALE",
        numeroODLInterno: odlToAssign,
        details: articleCode.toUpperCase(),
        qta: Number(qta),
        billOfMaterials: jobBOM,
        phases: phases,
        dataConsegnaFinale: normalizeDateStr(dataConsegnaFinale) || '',
        dataFinePreparazione: normalizeDateStr(dataFinePreparazione) || '',
        department: department || "N/D",
        workCycleId: workCycleId || '',
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
    };

    try {
        await docRef.set(JSON.parse(JSON.stringify(newJob)));
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');
        return { success: true, message: 'Commessa creata con successo.' };
    } catch (error) {
        return { success: false, message: "Errore durante il salvataggio della commessa." };
    }
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean; message: string; newJobs: JobOrder[]; jobsToUpdate: JobOrder[]; blockedJobs: Array<{ row: any; reason: string }>;
}> {
    try {
        const newJobs: JobOrder[] = [];
        const jobsToUpdate: JobOrder[] = [];
        const blockedJobs: Array<{ row: any; reason: string }> = [];
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            return { success: false, message: "Il file è vuoto o non contiene dati validi.", newJobs: [], jobsToUpdate: [], blockedJobs: [] };
        }

        const [articlesSnap, cyclesSnap, templatesSnap, deptsSnap, globalSettingsSnap, rawMaterialsSnap] = await Promise.all([
            adminDb.collection("articles").get(), 
            adminDb.collection("workCycles").get(),
            adminDb.collection("workPhaseTemplates").get(),
            adminDb.collection("departments").get(),
            adminDb.collection("settings").doc("global").get(),
            adminDb.collection("rawMaterials").get()
        ]);
        
        const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;
        const rawMaterialsList = rawMaterialsSnap.docs.map(doc => doc.data() as RawMaterial);
        
        const articlesMap = new Map(articlesSnap.docs
            .filter(d => d.data()?.code)
            .map(d => [String(d.data().code).toUpperCase().trim(), d.data() as Article])
        );
        const cyclesMap = new Map(cyclesSnap.docs
            .filter(d => d.data()?.name)
            .map(d => [String(d.data().name).toUpperCase().trim(), { ...d.data(), id: d.id } as WorkCycle])
        );
        const templatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));

        const allowedDepts = deptsSnap.docs
            .map(d => d.data() as Department)
            .filter(d => d.macroAreas.includes('PRODUZIONE') || d.code === 'MAG');
        
        const allowedDeptIdentifiers = new Set([
            ...allowedDepts.map(d => d.code.toUpperCase().trim()),
            ...allowedDepts.map(d => d.name.toUpperCase().trim())
        ]);
        
        // Helper per trovare valori con nomi colonna flessibili
        const getVal = (row: any, candidates: string[]) => {
            const keys = Object.keys(row || {});
            for (const cand of candidates) {
                const found = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());
                if (found !== undefined) return row[found];
            }
            return undefined;
        };

        const normalizeDateStr = (raw: any): string => {
            if (!raw) return '';
            
            let year: number, month: string, day: string;

            if (raw instanceof Date) {
                // FIX TIMEZONE SHIFT: Ancoraggio a Mezzogiorno (+12h) ed estrazione in UTC
                const anchoredDate = new Date(raw.getTime() + 12 * 60 * 60 * 1000);
                year = anchoredDate.getUTCFullYear();
                month = String(anchoredDate.getUTCMonth() + 1).padStart(2, '0');
                day = String(anchoredDate.getUTCDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            } else if (typeof raw === 'number') {
                // FIX TIMEZONE SHIFT: Excel numeric date, timezone-agnostic in UTC a Mezzogiorno
                const excelEpoch = new Date(Date.UTC(1899, 11, 30)); 
                const anchoredDate = new Date(excelEpoch.getTime() + Math.round(raw) * 86400 * 1000 + 12 * 60 * 60 * 1000);
                year = anchoredDate.getUTCFullYear();
                month = String(anchoredDate.getUTCMonth() + 1).padStart(2, '0');
                day = String(anchoredDate.getUTCDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            } else {
                const s = String(raw).trim();
                if (s.includes('/')) {
                    const parts = s.split('/');
                    if (parts.length === 3) {
                        const dStr = parts[0].padStart(2, '0');
                        const mStr = parts[1].padStart(2, '0');
                        let yStr = parts[2];
                        if (yStr.length === 2) yStr = '20' + yStr;
                        return `${yStr}-${mStr}-${dStr}`;
                    }
                }
                
                // Fallback fallback: se è una stringa ISO convertibile
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    const anchoredDate = new Date(d.getTime() + 12 * 60 * 60 * 1000);
                    year = anchoredDate.getUTCFullYear();
                    month = String(anchoredDate.getUTCMonth() + 1).padStart(2, '0');
                    day = String(anchoredDate.getUTCDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                }
                return s;
            }
        };

        // Identifichiamo tutti gli ID potenziali per caricarli in una volta (bulk existence check)
        const allPotentialIds = data.map(row => {
            const opf = String(getVal(row, ['Ordine PF', 'ordinePF']) || '').trim();
            return opf ? sanitizeDocumentId(opf) : null;
        }).filter((id): id is string => id !== null && id !== '');

        const uniqueIds = [...new Set(allPotentialIds)];
        const existingJobsList = uniqueIds.length > 0 ? await fetchInChunks<JobOrder>(adminDb.collection("jobOrders"), admin.firestore.FieldPath.documentId(), uniqueIds) : [];
        const existingIdsSet = new Set(existingJobsList.map(j => j.id));

        for (const row of data) {
            if (!row || typeof row !== 'object') continue;

            const mappedRow = {
                ordinePF: String(getVal(row, ['Ordine PF', 'ordinePF']) || '').trim(),
                details: String(getVal(row, ['Codice', 'details']) || '').trim(),
                qta: Number(getVal(row, ['Qta', 'qta']) || 0),
                cliente: String(getVal(row, ['Cliente', 'cliente']) || 'N/D').trim(),
                numeroODL: String(getVal(row, ['Ordine Nr Est', 'numeroODL']) || 'N/D').trim(),
                numeroODLInternoImport: String(getVal(row, ['N° ODL', 'numeroODLInternoImport']) || '').trim(),
                dataConsegnaFinale: normalizeDateStr(getVal(row, ['Data Consegna', 'Data Consegna Finale', 'dataConsegnaFinale'])),
                dataFinePreparazione: normalizeDateStr(getVal(row, ['Data Fine Prep', 'Data Fine Preparazione', 'dataFinePreparazione'])),
                department: String(getVal(row, ['Reparto', 'department']) || 'N/D').trim(),
                workCycleName: String(getVal(row, ['Ciclo', 'workCycleName']) || '').trim()
            };

            if (!mappedRow.ordinePF || !mappedRow.details || isNaN(mappedRow.qta) || mappedRow.qta <= 0) {
                blockedJobs.push({ row, reason: "Dati obbligatori mancanti o invalidi (PF, Codice o Qta)." });
                continue;
            }

            if (mappedRow.dataFinePreparazione && mappedRow.dataConsegnaFinale && mappedRow.dataFinePreparazione > mappedRow.dataConsegnaFinale) {
                blockedJobs.push({ row, reason: "La data fine preparazione non può essere successiva alla consegna finale." });
                continue;
            }

            if (mappedRow.department && mappedRow.department !== 'N/D') {
                const deptIdent = mappedRow.department.toUpperCase().trim();
                if (!allowedDeptIdentifiers.has(deptIdent)) {
                    blockedJobs.push({ row, reason: `Reparto "${mappedRow.department}" non valido per nuove commesse.` });
                    continue;
                }
            }
            
            const articleCode = mappedRow.details.toUpperCase().trim();
            const articleData = articlesMap.get(articleCode);
            
            if (!articleData) { 
                blockedJobs.push({ row, reason: `Articolo "${articleCode}" non trovato in Anagrafica.` }); 
                continue; 
            }
            
            const sanitizedId = sanitizeDocumentId(mappedRow.ordinePF);
            if (existingIdsSet.has(sanitizedId)) {
                blockedJobs.push({ row, reason: "Commessa già presente nel sistema (Duplicata)." });
                continue;
            }

            let workCycleId = '';
            if (mappedRow.workCycleName) {
                const foundCycle = cyclesMap.get(mappedRow.workCycleName.toUpperCase().trim());
                workCycleId = foundCycle ? foundCycle.id : '';
            } else {
                workCycleId = articleData.workCycleId || '';
            }

            let phases = workCycleId ? await createPhasesFromCycle(workCycleId, templatesMap) : [];
            
            // SMART REMAINDER TRIGGER (Import)
            const expectedMins = articleData.expectedMinutesDefault;
            if (expectedMins && expectedMins > 0 && phases.length > 0) {
                const historicalAverages = articleData.historicalTimes?.averagePhaseTimes || [];
                phases = distributeTheoreticalTimes(expectedMins, phases, historicalAverages);
            }
            const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => {
                const compCode = item.component.toUpperCase().trim();
                const material = rawMaterialsList.find(m => m.code.toUpperCase() === compCode);
                const typeConfig = material && globalSettings ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
                const requiresCut = typeConfig?.requiresCutLength !== false;

                const req = calculateBOMRequirement(
                    mappedRow.qta,
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
                    status: 'pending', 
                    isFromTemplate: true,
                    lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
                    fabbisognoTotale: req.totalInBaseUnits,
                    pesoStimato: req.weightKg
                };
            });
            
            let odlToAssign = null;
            if (mappedRow.numeroODLInternoImport) {
                const rawVal = mappedRow.numeroODLInternoImport.trim();
                const dashIndex = rawVal.indexOf('-');
                if (dashIndex !== -1) {
                    const numPart = rawVal.substring(0, dashIndex).match(/\d+/)?.[0] || '';
                    const yearPart = rawVal.substring(dashIndex + 1).trim();
                    if (numPart) odlToAssign = `${numPart.padStart(4, '0')}-${yearPart}`;
                } else {
                    const digits = rawVal.match(/\d+/)?.[0] || '';
                    if (digits) {
                        const shortYear = new Date().getFullYear().toString().slice(-2);
                        odlToAssign = `${digits.padStart(4, '0')}-${shortYear}`;
                    }
                }
            }

            newJobs.push({ 
                id: sanitizedId, 
                status: 'In Pianificazione', 
                postazioneLavoro: 'Da Assegnare', 
                cliente: mappedRow.cliente, 
                ordinePF: mappedRow.ordinePF, 
                numeroODL: mappedRow.numeroODL, 
                numeroODLInterno: odlToAssign, 
                details: articleCode, 
                qta: mappedRow.qta, 
                billOfMaterials: jobBOM, 
                phases: phases, 
                dataConsegnaFinale: mappedRow.dataConsegnaFinale, 
                dataFinePreparazione: mappedRow.dataFinePreparazione, 
                department: mappedRow.department, 
                workCycleId: workCycleId,
                expectedMinutesDefault: articleData.expectedMinutesDefault || 0,
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
        }
        return JSON.parse(JSON.stringify({ success: true, message: "Analisi completata.", newJobs, jobsToUpdate, blockedJobs }));
    } catch (error) {
        console.error("Critical error in processAndValidateImport:", error);
        return { 
            success: false, 
            message: error instanceof Error ? error.message : "Errore interno durante il caricamento.",
            newJobs: [], jobsToUpdate: [], blockedJobs: [] 
        };
    }
}

export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }) {
    const batch = adminDb.batch();
    data.newJobs.forEach(j => batch.set(adminDb.collection("jobOrders").doc(j.id), j));
    data.jobsToUpdate.forEach(j => batch.set(adminDb.collection("jobOrders").doc(j.id), j, { merge: true }));
    await batch.commit();
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/resource-planning');
    return { success: true, message: 'Caricamento completato.' };
}

export async function syncJobOrderDates(itemId: string, newDate: string, field: 'delivery' | 'prep', uid?: string) {
    try {
        const normalized = normalizeDateStr(newDate);
        if (!normalized) throw new Error("Data non valida.");

        const isGroup = itemId.startsWith('group-');
        const itemRef = adminDb.collection(isGroup ? 'workGroups' : 'jobOrders').doc(itemId);
        const fieldName = field === 'delivery' ? 'dataConsegnaFinale' : 'dataFinePreparazione';

        await adminDb.runTransaction(async (t) => {
            const snap = await t.get(itemRef);
            if (!snap.exists) throw new Error("Elemento non trovato.");
            
            const updatePayload = { 
                [fieldName]: normalized,
                updatedAt: admin.firestore.Timestamp.now()
            };
            
            t.update(itemRef, updatePayload);

            if (isGroup) {
                const data = snap.data() as any;
                (data.jobOrderIds || []).forEach((id: string) => {
                    t.update(adminDb.collection('jobOrders').doc(id), updatePayload);
                });
            }
        });

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');
        
        return { success: true, message: 'Data sincronizzata con successo.' };
    } catch (error) {
        console.error("Error in syncJobOrderDates:", error);
        return { success: false, message: error instanceof Error ? error.message : "Errore durante la sincronizzazione." };
    }
}

export async function updateJobOrderDeliveryDate(jobId: string, newDate: string) {
    return syncJobOrderDates(jobId, newDate, 'delivery');
}

export async function updateJobOrderPrepDate(jobId: string, newDate: string) {
    return syncJobOrderDates(jobId, newDate, 'prep');
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  try {
    const jobRef = adminDb.collection("jobOrders").doc(jobId);
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    
    const result = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(jobRef);
      if (!snap.exists) throw new Error("Commessa non trovata.");
      
      const job = snap.data() as JobOrder;
      
      // Accettiamo i vecchi stati per compatibilità ma puntiamo a quelli nuovi
      const validBacklogStatuses = [
        'planned', 
        'IN_ATTESA', 
        'In Pianificazione', 
        'IN_PIANIFICAZIONE'
      ];
      
      if (!validBacklogStatuses.includes(job.status)) {
          throw new Error(`Stato non valido per l'avvio (stato attuale: ${job.status}).`);
      }
      
      if (!job.billOfMaterials || job.billOfMaterials.length === 0) throw new Error("Distinta Base vuota.");
      if (!job.phases || job.phases.length === 0) throw new Error("Nessun ciclo di lavorazione presente.");

      // Recuperiamo (o creiamo) il counter per l'ANNO CORRENTE
      const counterRef = adminDb.collection("counters").doc(`odl_${year}`);
      const counterSnap = await t.get(counterRef);
      const currentCounter = (counterSnap.exists) ? (counterSnap.data()?.value || 0) : 0;
      
      let newOdlId: string;
      let newCounterValue: number = currentCounter;
      
      if (manualOdlNumberStr) {
          // Caso: numero inserito manualmente nell'app
          const manualNum = parseInt(manualOdlNumberStr, 10);
          newOdlId = `${String(manualNum).padStart(4, '0')}-${shortYear}`;
          newCounterValue = Math.max(currentCounter, manualNum);
      } else if (job.numeroODLInterno) {
          // Caso: ODL già presente nel record (es. da import Excel)
          newOdlId = job.numeroODLInterno;
          // Non incrementiamo il counter globale ma assicuriamoci che sia almeno allineato 
          // se il numero segue il formato standard
          if (newOdlId.includes('-')) {
              const [numPart] = newOdlId.split('-');
              const numVal = parseInt(numPart, 10);
              if (!isNaN(numVal)) newCounterValue = Math.max(currentCounter, numVal);
          }
      } else {
          // Caso: generazione automatica progressiva
          newCounterValue = currentCounter + 1;
          newOdlId = `${String(newCounterValue).padStart(4, '0')}-${shortYear}`;
      }
      
      // Aggiorniamo la commessa allo stato DA_INIZIARE (nuova pipeline)
      t.update(jobRef, { 
          status: 'DA_INIZIARE', 
          odlCreationDate: admin.firestore.Timestamp.fromDate(now), 
          numeroODLInterno: newOdlId, 
          odlCounter: newCounterValue,
          updatedAt: admin.firestore.Timestamp.fromDate(now)
      });
      
      // Aggiorniamo il counter solo se è aumentato
      if (newCounterValue > currentCounter) {
          t.set(counterRef, { value: newCounterValue, year: year, updatedAt: admin.firestore.Timestamp.fromDate(now) }, { merge: true });
      }
      
      return newOdlId;
    });
    
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/resource-planning');
    
    return { success: true, message: `ODL #${result} avviato con successo.` };
  } catch (error) { 
      console.error("Error in createODL:", error);
      return { success: false, message: error instanceof Error ? error.message : "Errore interno durante l'avvio." }; 
  }
}

export async function createMultipleODLs(jobIds: string[]) {
    let success = 0;
    for (const id of jobIds) { const res = await createODL(id); if (res.success) success++; }
    return { success: success > 0, message: `${success} ODL avviati.` };
}

export async function cancelODL(jobId: string) {
  await adminDb.collection("jobOrders").doc(jobId).update({ 
      status: 'IN_PIANIFICAZIONE', 
      odlCreationDate: null,
      updatedAt: admin.firestore.Timestamp.now()
  });
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  revalidatePath('/admin/resource-planning');
  return { success: true, message: 'ODL annullato e riportato in pianificazione.' };
}

export async function deleteSelectedJobOrders(ids: string[]) {
  const batch = adminDb.batch();
  ids.forEach(id => batch.delete(adminDb.collection("jobOrders").doc(id)));
  await batch.commit();
  revalidatePath('/admin/data-management');
  return { success: true, message: 'Eliminate.' };
}

export async function updateJobOrderCycle(jobId: string, cycleId: string) {
    const phases = await createPhasesFromCycle(cycleId);
    const sanitizedPayload = sanitizeFirestoreData({ workCycleId: cycleId, phases });
    await adminDb.collection("jobOrders").doc(jobId).update(sanitizedPayload);
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Ciclo aggiornato.' };
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const snap = await adminDb.collection('workCycles').get();
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as WorkCycle);
}

export async function markJobAsPrinted(jobId: string) {
  try {
    await adminDb.collection("jobOrders").doc(jobId).update({ isPrinted: true });
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Commessa segnata come stampata.' };
  } catch (error) { return { success: false, message: "Errore." }; }
}

export async function updateJobOrderOdlNumber(jobId: string, newOdl: string) {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({ numeroODLInterno: newOdl });
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/resource-planning');
        return { success: true, message: 'N° ODL aggiornato.' };
    } catch (error) {
        console.error("Error updating ODL:", error);
        return { success: false, message: "Errore durante l'aggiornamento dell'ODL." };
    }
}

export async function getClients(): Promise<Client[]> {
    const snap = await adminDb.collection('clients').orderBy('name').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
}

export async function checkArticleExists(code: string): Promise<boolean> {
    const doc = await adminDb.collection('articles').doc(code.toUpperCase().trim()).get();
    return doc.exists;
}

export async function updateJobOrder(jobId: string, data: {
    cliente: string;
    ordinePF: string;
    qta: number;
    department: string;
    workCycleId: string;
    dataFinePreparazione: string;
    dataConsegnaFinale: string;
    expectedMinutes?: number;
}) {
    try {
        const jobRef = adminDb.collection("jobOrders").doc(jobId);
        const jobSnap = await jobRef.get();
        if (!jobSnap.exists) throw new Error("Commessa non trovata.");
        
        const job = jobSnap.data() as JobOrder;
        // Data Freeze Security
        if (job.status !== 'IN_PIANIFICAZIONE' && job.status !== 'planned' && job.status !== 'IN_ATTESA') {
             throw new Error("Data Freeze: Impossibile modificare una commessa già in produzione.");
        }

        // Logic: Only update phases if the work cycle has changed
        const updatePayload: any = {
            cliente: data.cliente,
            ordinePF: data.ordinePF,
            qta: data.qta,
            department: data.department,
            dataFinePreparazione: normalizeDateStr(data.dataFinePreparazione),
            dataConsegnaFinale: normalizeDateStr(data.dataConsegnaFinale),
            updatedAt: admin.firestore.Timestamp.now()
        };

        if (data.workCycleId !== job.workCycleId) {
            console.log(`Cycle changed from ${job.workCycleId} to ${data.workCycleId}. Regenerating phases...`);
            updatePayload.workCycleId = data.workCycleId;
            updatePayload.phases = await createPhasesFromCycle(data.workCycleId);
        }

        // SMART REMAINDER TRIGGER: If total time changed or phases were regenerated
        const newExpectedMinutes = data.expectedMinutes ?? job.expectedMinutesDefault;
        if (newExpectedMinutes !== undefined && (data.expectedMinutes !== undefined || data.workCycleId !== job.workCycleId)) {
            const articleRef = adminDb.collection("articles").doc(job.details.toUpperCase().trim());
            const articleSnap = await articleRef.get();
            const article = articleSnap.exists ? articleSnap.data() as Article : null;
            const historicalAverages = article?.historicalTimes?.averagePhaseTimes || [];
            
            const currentPhases = updatePayload.phases || job.phases || [];
            updatePayload.phases = distributeTheoreticalTimes(newExpectedMinutes, currentPhases, historicalAverages, data.qta);
            updatePayload.expectedMinutesDefault = newExpectedMinutes;
        }

        // Recalculate/Synchronize BOM when updating the job (to reflect new quantity or material settings)
        const globalSettingsSnap = await adminDb.collection("settings").doc("global").get();
        const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;

        const articleRefForBOM = adminDb.collection("articles").doc(job.details.toUpperCase().trim());
        const articleSnapForBOM = await articleRefForBOM.get();
        const articleForBOM = articleSnapForBOM.exists ? articleSnapForBOM.data() as Article : null;

        const compCodes = (job.billOfMaterials || []).map(item => item.component.toUpperCase().trim());
        const rawMaterials = compCodes.length > 0 ? await fetchInChunks<RawMaterial>(
            adminDb.collection("rawMaterials"),
            "code",
            compCodes
        ) : [];

        if (job.billOfMaterials && job.billOfMaterials.length > 0) {
            updatePayload.billOfMaterials = syncJobBOMItems(
                Number(data.qta),
                job.billOfMaterials,
                articleForBOM?.billOfMaterials || [],
                rawMaterials,
                globalSettings
            );
        }

        // Deep Sanitization to prevent "undefined" Firestore errors
        const sanitizedPayload = sanitizeFirestoreData(updatePayload);

        const newJobId = sanitizeDocumentId(data.ordinePF);
        const batch = adminDb.batch();

        if (newJobId !== jobId) {
            console.log(`[UPDATE_JOB] Renaming document ID from "${jobId}" to "${newJobId}"`);
            
            // Check if a document already exists at the new ID to prevent overwrite collisions
            const newDocRef = adminDb.collection("jobOrders").doc(newJobId);
            const newDocSnap = await newDocRef.get();
            if (newDocSnap.exists) {
                return { success: false, message: "Esiste già una commessa con il nuovo Ordine PF specificato." };
            }

            // Create full migrated document data
            const migratedJob = {
                ...job,
                ...sanitizedPayload,
                id: newJobId,
                ordinePF: data.ordinePF
            };

            batch.set(newDocRef, JSON.parse(JSON.stringify(migratedJob)));
            batch.delete(jobRef);

            // Cascade updates to other collections referencing the old ID or old ordinePF
            // 1. workGroups
            const workGroupsSnap = await adminDb.collection("workGroups")
                .where("jobOrderIds", "array-contains", jobId)
                .get();
            workGroupsSnap.forEach(wgDoc => {
                const groupData = wgDoc.data();
                const jobOrderIds = (groupData.jobOrderIds || []).map((id: string) => id === jobId ? newJobId : id);
                const jobOrderPFs = (groupData.jobOrderPFs || []).map((pf: string) => pf === jobId || pf === job.ordinePF ? data.ordinePF : pf);
                batch.update(wgDoc.ref, { jobOrderIds, jobOrderPFs });
            });

            // 2. materialWithdrawals
            const withdrawalsSnap1 = await adminDb.collection("materialWithdrawals")
                .where("jobIds", "array-contains", jobId)
                .get();
            withdrawalsSnap1.forEach(wDoc => {
                const wData = wDoc.data();
                const jobIds = (wData.jobIds || []).map((id: string) => id === jobId ? newJobId : id);
                const jobOrderPFs = (wData.jobOrderPFs || []).map((pf: string) => pf === jobId || pf === job.ordinePF ? data.ordinePF : pf);
                batch.update(wDoc.ref, { jobIds, jobOrderPFs });
            });

            // 3. manualCommitments
            const commitmentsSnap = await adminDb.collection("manualCommitments")
                .where("jobOrderCode", "==", job.ordinePF)
                .get();
            commitmentsSnap.forEach(cDoc => {
                batch.update(cDoc.ref, { jobOrderCode: data.ordinePF });
            });

            // 4. operators
            const operatorsSnap = await adminDb.collection("operators")
                .where("activeJobId", "==", jobId)
                .get();
            operatorsSnap.forEach(oDoc => {
                batch.update(oDoc.ref, { activeJobId: newJobId });
            });

            // 5. packingLists
            const packingListsSnap = await adminDb.collection("packingLists").get();
            packingListsSnap.forEach(plDoc => {
                const plData = plDoc.data();
                let modified = false;
                const items = (plData.items || []).map((item: any) => {
                    let itemMod = false;
                    let newJobIdVal = item.jobId;
                    let newOrderPFVal = item.orderPF;
                    if (item.jobId === jobId) {
                        newJobIdVal = newJobId;
                        itemMod = true;
                    }
                    if (item.orderPF === jobId || item.orderPF === job.ordinePF) {
                        newOrderPFVal = data.ordinePF;
                        itemMod = true;
                    }
                    if (itemMod) {
                        modified = true;
                        return { ...item, jobId: newJobIdVal, orderPF: newOrderPFVal };
                    }
                    return item;
                });
                if (modified) {
                    batch.update(plDoc.ref, { items });
                }
            });
        } else {
            // Document ID is not changing, just update in place
            batch.update(jobRef, sanitizedPayload);
        }

        await batch.commit();
        console.log(`[UPDATE_JOB] Saved Job ${newJobId}. Phase[0] expectedMins/pc: ${sanitizedPayload.phases?.[0]?.expectedMinutesPerPiece}`);

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
        return { success: true, message: "Commessa aggiornata con successo." };
    } catch (error) {
        console.error("Error updating job order:", error);
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'aggiornamento." };
    }
}


export async function saveSmartJobOrder(data: {
    cliente: string;
    ordinePF: string;
    articleCode: string;
    description: string;
    dataConsegnaFinale: string;
    dataFinePreparazione: string;
    workCycleId: string;
    qta: number;
    billOfMaterials?: BillOfMaterialsItem[];
    expectedMinutes?: number;
    fieldValues?: Record<string, string>;
    department?: string;
    isEdit?: boolean;
}) {
    const { cliente, ordinePF, articleCode, description, dataConsegnaFinale, dataFinePreparazione, workCycleId, qta, billOfMaterials, expectedMinutes, fieldValues, department, isEdit } = data;
    
    try {
        const sanitizedId = sanitizeDocumentId(ordinePF);
        const jobRef = adminDb.collection("jobOrders").doc(sanitizedId);
        
        // Check if job exists
        const existingJob = await jobRef.get();
        if (existingJob.exists && !isEdit) {
            return { success: false, message: "Esiste già una commessa con questo Ordine PF." };
        }

        // Data Freeze Security
        if (existingJob.exists && isEdit) {
            const jobData = existingJob.data() as JobOrder;
            if (jobData.status !== 'IN_PIANIFICAZIONE') {
                return { success: false, message: "Data Freeze: Impossibile modificare una commessa già in produzione." };
            }
        }

        // 1. Prepare Article and Phases
        const articleRef = adminDb.collection("articles").doc(articleCode.toUpperCase().trim());
        const articleSnap = await articleRef.get();
        const article = articleSnap.exists ? articleSnap.data() as Article : null;

        // Create phases and distribute times
        let phases = await createPhasesFromCycle(workCycleId);
        
        if (expectedMinutes && expectedMinutes > 0) {
            console.log(`[SAVE_SMART] Triggering distribution for ${expectedMinutes} mins`);
            const historicalAverages = article?.historicalTimes?.averagePhaseTimes || [];
            phases = distributeTheoreticalTimes(expectedMinutes, phases, historicalAverages, qta);
            console.log(`[SAVE_SMART] Post-distribution phases[0]:`, JSON.stringify(phases[0], null, 2));
        }

        // Generate phaseTimes map for the Article
        const phaseTimes: Record<string, any> = {};
        phases.forEach(p => {
            phaseTimes[p.id] = {
                expectedMinutesPerPiece: p.expectedMinutesPerPiece || 0,
                detectedMinutesPerPiece: 0,
                enabled: true
            };
        });

        const articleData: Partial<Article> = {
            id: articleCode.toUpperCase().trim(),
            code: articleCode.toUpperCase().trim(),
            workCycleId: workCycleId,
            billOfMaterials: billOfMaterials || [],
            expectedMinutesDefault: expectedMinutes,
            phaseTimes: phaseTimes,
        };

        if (!articleSnap.exists) {
            await articleRef.set(articleData);
        } else {
            await articleRef.update(articleData);
        }

        const globalSettingsSnap = await adminDb.collection("settings").doc("global").get();
        const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;

        const compCodes = (billOfMaterials || []).map(item => item.component.toUpperCase().trim());
        const rawMaterials = compCodes.length > 0 ? await fetchInChunks<RawMaterial>(
            adminDb.collection("rawMaterials"),
            "code",
            compCodes
        ) : [];

        // Map BillOfMaterialsItem to JobBillOfMaterialsItem for the JobOrder snapshot
        const jobBOM: JobBillOfMaterialsItem[] = (billOfMaterials || []).map(item => {
            const compCode = item.component.toUpperCase().trim();
            const material = rawMaterials.find(m => m.code.toUpperCase() === compCode);
            const typeConfig = material && globalSettings ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
            const requiresCut = typeConfig?.requiresCutLength !== false;

            const req = calculateBOMRequirement(
                qta,
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
                status: 'pending',
                withdrawn: false,
                isFromTemplate: true,
                lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
                fabbisognoTotale: req.totalInBaseUnits,
                pesoStimato: req.weightKg
            };
        });

        const newJob: any = {
            id: sanitizedId,
            status: 'IN_PIANIFICAZIONE',
            ordinePF: ordinePF,
            numeroODL: "", 
            cliente: cliente,
            qta: qta,
            details: articleCode.toUpperCase().trim(),
            department: department || phases[0]?.departmentCodes[0] || "PRODUZIONE",
            postazioneLavoro: "Da Assegnare",
            phases: phases,
            billOfMaterials: jobBOM,
            dataConsegnaFinale: normalizeDateStr(dataConsegnaFinale) || '',
            dataFinePreparazione: normalizeDateStr(dataFinePreparazione) || '',
            workCycleId: workCycleId,
            isSmartJob: true,
            smartCodeParams: fieldValues || {},
            expectedMinutesDefault: expectedMinutes || 0,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now()
        };

        const finalJobData = JSON.parse(JSON.stringify(newJob));
        await jobRef.set(finalJobData);
        console.log(`[SAVE_SMART] Saved Job ${ordinePF}. Phase[0] expectedMins/pc: ${finalJobData.phases?.[0]?.expectedMinutesPerPiece}`);

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');

        return { success: true, message: 'Commessa Rapida creata con successo.' };
    } catch (error) {
        console.error("Error saving smart job order:", error);
        return { success: false, message: "Errore durante il salvataggio: " + (error instanceof Error ? error.message : "Errore sconosciuto") };
    }
}

/**
 * RETROACTIVITY TOOL: Recalculates missing estimates for planned jobs
 */
export async function forceRecalculateEstimates() {
    try {
        const jobsSnap = await adminDb.collection("jobOrders")
            .where("status", "in", ["planned", "IN_ATTESA", "In Pianificazione", "IN_PIANIFICAZIONE", "PIANIFICATE", "PIANIFICATA", "PLANNED", "PIANIFICATO"])
            .get();

        if (jobsSnap.empty) return { success: true, message: "Nessuna commessa pianificata da processare." };

        const jobs = jobsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as JobOrder));
        const [articlesSnap, cyclesSnap] = await Promise.all([
            adminDb.collection("articles").get(),
            adminDb.collection("workCycles").get()
        ]);

        const articlesMap = new Map(articlesSnap.docs.map(d => [d.id.toUpperCase(), d.data() as Article]));
        const cyclesMap = new Map(cyclesSnap.docs.map(d => [d.id, d.data() as WorkCycle]));

        const batch = adminDb.batch();
        let updatedCount = 0;

        for (const job of jobs) {
            const expectedMins = job.expectedMinutesDefault || 0;
            if (expectedMins <= 0) continue;

            // Check if phases have 0 time
            const needsCalculation = (job.phases || []).every(p => !p.expectedMinutesPerPiece || p.expectedMinutesPerPiece === 0);
            
            if (needsCalculation && job.phases && job.phases.length > 0) {
                const article = articlesMap.get(job.details.toUpperCase());
                const historicalAverages = article?.historicalTimes?.averagePhaseTimes || [];
                
                // If the job has a cycle, ensure weights are up to date
                if (job.workCycleId && cyclesMap.has(job.workCycleId)) {
                    const cycle = cyclesMap.get(job.workCycleId)!;
                    job.phases = job.phases.map((p, idx) => ({
                        ...p,
                        theoreticalWeight: cycle.phaseWeights?.[idx] || 1
                    }));
                }

                // MATH FIX: Pass job.qta to ensure minutes-per-piece division
                const updatedPhases = distributeTheoreticalTimes(expectedMins, job.phases, historicalAverages, job.qta);
                console.log(`[MIGRATE] Job ${job.ordinePF} recalculated. Phases[0] time: ${updatedPhases[0]?.expectedMinutesPerPiece}`);
                
                batch.update(adminDb.collection("jobOrders").doc(job.id), { 
                    phases: updatedPhases,
                    updatedAt: admin.firestore.Timestamp.now()
                });
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            await batch.commit();
            revalidatePath('/admin/data-management');
            revalidatePath('/admin/resource-planning');
        }

        return { success: true, message: `Ricalcolo completato: ${updatedCount} commesse aggiornate.` };
    } catch (error) {
        console.error("Error in forceRecalculateEstimates:", error);
        return { success: false, message: "Errore durante il ricalcolo." };
    }
}

/**
 * Automatically detects and heals any jobOrders whose Document ID does not match
 * the sanitized version of their internal field "ordinePF".
 * It migrates the old document to the new one (if not already existing) and deletes the old one.
 */
export async function healGhostJobOrders(): Promise<{ success: boolean; message: string; healedCount: number }> {
    try {
        const jobsSnap = await adminDb.collection("jobOrders").get();
        let healedCount = 0;
        const batch = adminDb.batch();
        let ops = 0;

        for (const doc of jobsSnap.docs) {
            const job = doc.data() as JobOrder;
            if (!job.ordinePF) continue;

            const correctId = sanitizeDocumentId(job.ordinePF);
            const currentId = doc.id;

            if (currentId !== correctId) {
                console.log(`[HEAL_GHOST] Mismatch detected: Document ID "${currentId}", internal ordinePF "${job.ordinePF}" (correct ID: "${correctId}")`);
                
                // Read correct document to check if it already exists
                const correctDocRef = adminDb.collection("jobOrders").doc(correctId);
                const correctDocSnap = await correctDocRef.get();

                if (!correctDocSnap.exists) {
                    // Migrate data to the correct document ID
                    const migratedJob = {
                        ...job,
                        id: correctId
                    };
                    batch.set(correctDocRef, JSON.parse(JSON.stringify(migratedJob)));
                    ops++;
                }

                // Delete the old mismatched ghost document
                batch.delete(doc.ref);
                ops++;
                healedCount++;

                // Cascade updates to other collections referencing the old ID or old ordinePF
                // 1. workGroups
                const workGroupsSnap = await adminDb.collection("workGroups")
                    .where("jobOrderIds", "array-contains", currentId)
                    .get();
                workGroupsSnap.forEach(wgDoc => {
                    const groupData = wgDoc.data();
                    const jobOrderIds = (groupData.jobOrderIds || []).map((id: string) => id === currentId ? correctId : id);
                    const jobOrderPFs = (groupData.jobOrderPFs || []).map((pf: string) => pf === currentId || pf === job.ordinePF ? job.ordinePF : pf);
                    batch.update(wgDoc.ref, { jobOrderIds, jobOrderPFs });
                    ops++;
                });

                // 2. materialWithdrawals
                const withdrawalsSnap1 = await adminDb.collection("materialWithdrawals")
                    .where("jobIds", "array-contains", currentId)
                    .get();
                withdrawalsSnap1.forEach(wDoc => {
                    const wData = wDoc.data();
                    const jobIds = (wData.jobIds || []).map((id: string) => id === currentId ? correctId : id);
                    const jobOrderPFs = (wData.jobOrderPFs || []).map((pf: string) => pf === currentId || pf === job.ordinePF ? job.ordinePF : pf);
                    batch.update(wDoc.ref, { jobIds, jobOrderPFs });
                    ops++;
                });

                // 3. manualCommitments
                const commitmentsSnap = await adminDb.collection("manualCommitments")
                    .where("jobOrderCode", "==", currentId)
                    .get();
                commitmentsSnap.forEach(cDoc => {
                    batch.update(cDoc.ref, { jobOrderCode: job.ordinePF });
                    ops++;
                });

                // 4. operators
                const operatorsSnap = await adminDb.collection("operators")
                    .where("activeJobId", "==", currentId)
                    .get();
                operatorsSnap.forEach(oDoc => {
                    batch.update(oDoc.ref, { activeJobId: correctId });
                    ops++;
                });

                // 5. packingLists
                const packingListsSnap = await adminDb.collection("packingLists").get();
                packingListsSnap.forEach(plDoc => {
                    const plData = plDoc.data();
                    let modified = false;
                    const items = (plData.items || []).map((item: any) => {
                        let itemMod = false;
                        let newJobIdVal = item.jobId;
                        let newOrderPFVal = item.orderPF;
                        if (item.jobId === currentId) {
                            newJobIdVal = correctId;
                            itemMod = true;
                        }
                        if (item.orderPF === currentId || item.orderPF === job.ordinePF) {
                            newOrderPFVal = job.ordinePF;
                            itemMod = true;
                        }
                        if (itemMod) {
                            modified = true;
                            return { ...item, jobId: newJobIdVal, orderPF: newOrderPFVal };
                        }
                        return item;
                    });
                    if (modified) {
                        batch.update(plDoc.ref, { items });
                        ops++;
                    }
                });

                // Commit batch if it's getting close to the Firestore limit (500 operations)
                if (ops >= 400) {
                    await batch.commit();
                    ops = 0;
                }
            }
        }

        if (ops > 0) {
            await batch.commit();
        }

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
        
        return { success: true, message: `Sanificazione completata: ${healedCount} commesse orfane corrette.`, healedCount };
    } catch (error) {
        console.error("Errore durante healGhostJobOrders:", error);
        return { success: false, message: "Errore durante la riparazione: " + (error instanceof Error ? error.message : "Errore sconosciuto"), healedCount: 0 };
    }
}

/**
 * Scans all job orders in Firestore, dynamically checks if any of their string fields contain
 * hyphens instead of slashes in the "-PF" pattern or miss dots (e.g. converting 268-PF1-2/268/PF1-2 to 268/PF.1-2),
 * restores the original slash and dot format, and cascades the correction across all related collections.
 */
export async function healJobOrdersSanitization(): Promise<{ success: boolean; message: string; healedCount: number }> {
    const isMatchingJobId = (restoredVal: string, currentId: string): boolean => {
        const cleanRestored = restoredVal.toLowerCase().replace(/[\/\-\.]/g, '');
        const cleanId = currentId.toLowerCase().replace(/[\/\-\.]/g, '');
        return cleanRestored === cleanId;
    };

    try {
        const jobsSnap = await adminDb.collection("jobOrders").get();
        let healedCount = 0;
        let batch = adminDb.batch();
        let ops = 0;

        for (const doc of jobsSnap.docs) {
            const rawData = doc.data();
            const currentId = doc.id;
            
            let needsHeal = false;
            const updatePayload: Record<string, any> = {};

            // Dynamically scan all string fields of the document for the "-PF" or "/PF" patterns
            for (const key of Object.keys(rawData)) {
                const val = rawData[key];
                if (typeof val === 'string' && (val.includes('-PF') || val.includes('/PF'))) {
                    let restoredVal = val.replace(/-PF/g, "/PF");
                    restoredVal = restoredVal.replace(/\/PF(\d)/g, "/PF.$1");
                    
                    if (restoredVal !== val) {
                        // Apply self-validation only to the primary ordinePF field
                        if (key === 'ordinePF') {
                            if (isMatchingJobId(restoredVal, currentId)) {
                                updatePayload[key] = restoredVal;
                                needsHeal = true;
                            }
                        } else {
                            updatePayload[key] = restoredVal;
                            needsHeal = true;
                        }
                    }
                }
            }

            if (needsHeal) {
                const oldOrdinePF = rawData.ordinePF || currentId;
                let restoredOrdinePF = updatePayload.ordinePF;
                if (!restoredOrdinePF) {
                    restoredOrdinePF = oldOrdinePF.replace(/-PF/g, "/PF");
                    restoredOrdinePF = restoredOrdinePF.replace(/\/PF(\d)/g, "/PF.$1");
                }

                console.log(`[HEAL_SANITIZATION] Healing job ${currentId}:`, updatePayload);

                updatePayload.updatedAt = admin.firestore.Timestamp.now();
                batch.update(doc.ref, updatePayload);
                ops++;
                healedCount++;

                // Build a set of all possible search patterns for reference queries
                const queryKeys = new Set([
                    oldOrdinePF,
                    currentId,
                    oldOrdinePF.replace(/\//g, '-'),
                    oldOrdinePF.replace(/-/g, '/'),
                    oldOrdinePF.replace('/PF.', '/PF'),
                    oldOrdinePF.replace('/PF', '/PF.')
                ]);

                for (const oldVal of queryKeys) {
                    if (!oldVal) continue;

                    // 1. workGroups (jobOrderPFs array field)
                    const workGroupsSnap = await adminDb.collection("workGroups")
                        .where("jobOrderPFs", "array-contains", oldVal)
                        .get();
                    workGroupsSnap.forEach(wgDoc => {
                        const groupData = wgDoc.data();
                        let modified = false;
                        const jobOrderPFs = (groupData.jobOrderPFs || []).map((pf: string) => {
                            if (isMatchingJobId(pf, currentId)) {
                                modified = true;
                                return restoredOrdinePF;
                            }
                            return pf;
                        });
                        if (modified) {
                            batch.update(wgDoc.ref, { jobOrderPFs });
                            ops++;
                        }
                    });

                    // 2. materialWithdrawals (jobOrderPFs array field)
                    const withdrawalsSnap = await adminDb.collection("materialWithdrawals")
                        .where("jobOrderPFs", "array-contains", oldVal)
                        .get();
                    withdrawalsSnap.forEach(wDoc => {
                        const wData = wDoc.data();
                        let modified = false;
                        const jobOrderPFs = (wData.jobOrderPFs || []).map((pf: string) => {
                            if (isMatchingJobId(pf, currentId)) {
                                modified = true;
                                return restoredOrdinePF;
                            }
                            return pf;
                        });
                        if (modified) {
                            batch.update(wDoc.ref, { jobOrderPFs });
                            ops++;
                        }
                    });

                    // 3. manualCommitments (jobOrderCode field)
                    const commitmentsSnap = await adminDb.collection("manualCommitments")
                        .where("jobOrderCode", "==", oldVal)
                        .get();
                    commitmentsSnap.forEach(cDoc => {
                        batch.update(cDoc.ref, { jobOrderCode: restoredOrdinePF });
                        ops++;
                    });
                }

                // 4. packingLists (sub-items orderPF field)
                const packingListsSnap = await adminDb.collection("packingLists").get();
                packingListsSnap.forEach(plDoc => {
                    const plData = plDoc.data();
                    let modified = false;
                    const items = (plData.items || []).map((item: any) => {
                        let itemMod = false;
                        let newOrderPF = item.orderPF;
                        if (isMatchingJobId(item.orderPF, currentId)) {
                            newOrderPF = restoredOrdinePF;
                            itemMod = true;
                        }
                        if (itemMod) {
                            modified = true;
                            return { ...item, orderPF: newOrderPF };
                        }
                        return item;
                    });
                    if (modified) {
                        batch.update(plDoc.ref, { items });
                        ops++;
                    }
                });

                // Commit batch if it's getting close to the Firestore limit (500 operations)
                if (ops >= 400) {
                    await batch.commit();
                    batch = adminDb.batch();
                    ops = 0;
                }
            }
        }

        if (ops > 0) {
            await batch.commit();
        }

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
        revalidatePath('/admin/resource-planning');

        return { 
            success: true, 
            message: `Sanificazione completata con successo: ${healedCount} commesse ripristinate con slashes '/' e punti '.' originari.`, 
            healedCount 
        };
    } catch (error) {
        console.error("Errore durante healJobOrdersSanitization:", error);
        return { 
            success: false, 
            message: "Errore durante il ripristino: " + (error instanceof Error ? error.message : "Errore sconosciuto"), 
            healedCount: 0 
        };
    }
}

export async function saveSmartPastedJobOrders(data: {
    ordinePF: string;
    details: string; // Article code
    qta: number;
    dataConsegnaFinale: string;
    dataFinePreparazione: string;
    department: string;
}[]) {
    try {
        const [articlesSnap, cyclesSnap, templatesSnap, globalSettingsSnap, rawMaterialsSnap] = await Promise.all([
            adminDb.collection("articles").get(), 
            adminDb.collection("workCycles").get(),
            adminDb.collection("workPhaseTemplates").get(),
            adminDb.collection("settings").doc("global").get(),
            adminDb.collection("rawMaterials").get()
        ]);
        
        const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;
        const rawMaterialsList = rawMaterialsSnap.docs.map(doc => doc.data() as RawMaterial);
        
        const articlesMap = new Map(articlesSnap.docs
            .filter(d => d.data()?.code)
            .map(d => [String(d.data().code).toUpperCase().trim(), d.data() as Article])
        );
        
        const templatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));

        const newJobs: JobOrder[] = [];
        
        // Bulk existence check for job ids
        const allPotentialIds = data.map(row => sanitizeDocumentId(row.ordinePF)).filter(id => id !== '');
        const uniqueIds = [...new Set(allPotentialIds)];
        const existingJobsList = uniqueIds.length > 0 ? await fetchInChunks<JobOrder>(adminDb.collection("jobOrders"), admin.firestore.FieldPath.documentId(), uniqueIds) : [];
        const existingIdsSet = new Set(existingJobsList.map(j => j.id));

        for (const row of data) {
            const sanitizedId = sanitizeDocumentId(row.ordinePF);
            if (existingIdsSet.has(sanitizedId)) {
                return { success: false, message: `La commessa ${row.ordinePF} esiste già.` };
            }

            const articleCode = row.details.toUpperCase().trim();
            const articleData = articlesMap.get(articleCode);
            if (!articleData) {
                return { success: false, message: `L'articolo ${articleCode} non esiste in anagrafica.` };
            }

            const workCycleId = articleData.workCycleId || '';
            let phases = workCycleId ? await createPhasesFromCycle(workCycleId, templatesMap) : [];

            // 2. Propagazione Tempi (phaseTimes)
            const expectedMins = articleData.expectedMinutesDefault;
            if (expectedMins && expectedMins > 0 && phases.length > 0) {
                const historicalAverages = articleData.historicalTimes?.averagePhaseTimes || [];
                phases = distributeTheoreticalTimes(expectedMins, phases, historicalAverages, row.qta);
            }

            const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => {
                const compCode = item.component.toUpperCase().trim();
                const material = rawMaterialsList.find(m => m.code.toUpperCase() === compCode);
                const typeConfig = material && globalSettings ? globalSettings.rawMaterialTypes.find((t: any) => t.id === material.type) : null;
                const requiresCut = typeConfig?.requiresCutLength !== false;

                const req = calculateBOMRequirement(
                    row.qta,
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
                    status: 'pending', 
                    isFromTemplate: true,
                    lunghezzaTaglioMm: requiresCut ? (item.lunghezzaTaglioMm ?? undefined) : undefined,
                    fabbisognoTotale: req.totalInBaseUnits,
                    pesoStimato: req.weightKg
                };
            });

            newJobs.push({
                id: sanitizedId,
                status: 'IN_PIANIFICAZIONE',
                postazioneLavoro: 'Da Assegnare',
                cliente: 'N/D', 
                ordinePF: row.ordinePF,
                numeroODL: 'N/D',
                numeroODLInterno: null,
                details: articleCode,
                qta: row.qta,
                billOfMaterials: jobBOM,
                phases: phases,
                dataConsegnaFinale: row.dataConsegnaFinale,
                dataFinePreparazione: row.dataFinePreparazione,
                department: row.department,
                workCycleId: workCycleId,
                expectedMinutesDefault: articleData.expectedMinutesDefault || 0,
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
        }

        const batch = adminDb.batch();
        newJobs.forEach(j => batch.set(adminDb.collection("jobOrders").doc(j.id), JSON.parse(JSON.stringify(j))));
        await batch.commit();

        revalidatePath('/admin/data-management');
        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');
        return { success: true, message: `${newJobs.length} commesse create con successo.` };
    } catch (error) {
        console.error("Error in saveSmartPastedJobOrders:", error);
        return { success: false, message: error instanceof Error ? error.message : "Errore interno durante il salvataggio." };
    }
}

export async function getOptimizedODLData(jobId: string) {
    const decodedId = decodeURIComponent(jobId);
    const jobSnap = await adminDb.collection("jobOrders").doc(decodedId).get();
    
    if (!jobSnap.exists) {
        return null;
    }

    const job = convertTimestampsToDates(jobSnap.data()) as JobOrder;
    job.id = jobSnap.id;

    // 1. Fetch Article with .select() to reduce payload
    let article: Partial<Article> | null = null;
    if (job.details) {
        const articleSnap = await adminDb.collection("articles")
            .where(admin.firestore.FieldPath.documentId(), "==", job.details.toUpperCase()).select("code", "phaseTimes", "billOfMaterials").limit(1).get();
            
        if (!articleSnap.empty) { article = articleSnap.docs[0].data() as Partial<Article>; }
    }

    // 2. Fetch Materials with chunking and .select()
    const materials: Partial<RawMaterial>[] = [];
    const materialCodes = new Set<string>();
    
    if (job.billOfMaterials) {
        job.billOfMaterials.forEach(item => {
            if (item.component) materialCodes.add(item.component.toUpperCase().trim());
        });
    }

    const uniqueMaterials = Array.from(materialCodes);
    if (uniqueMaterials.length > 0) {
        const CHUNK_SIZE = 30;
        for (let i = 0; i < uniqueMaterials.length; i += CHUNK_SIZE) {
            const chunk = uniqueMaterials.slice(i, i + CHUNK_SIZE);
            const materialsSnap = await adminDb.collection("rawMaterials")
                .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
                .select('code', 'type', 'unitOfMeasure')
                .get();
            
            materialsSnap.forEach(doc => {
                materials.push({ id: doc.id, ...doc.data() } as Partial<RawMaterial>);
            });
        }
    }

    return { job, article, materials };
}
