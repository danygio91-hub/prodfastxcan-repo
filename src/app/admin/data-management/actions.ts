'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate, Article, JobBillOfMaterialsItem, Department, RawMaterial, ManualCommitment } from '@/types';
import * as z from 'zod';
import { convertTimestampsToDates } from '@/lib/utils';
import { fetchInChunks } from '@/lib/firestore-utils';


function sanitizeDocumentId(id: string): string {
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}


async function createPhasesFromCycle(cycleId: string): Promise<JobPhase[]> {
    if (!cycleId) return [];
    const cycleSnap = await adminDb.collection("workCycles").doc(cycleId).get();
    if (!cycleSnap.exists) return [];
    const cycle = cycleSnap.data() as WorkCycle;
    const phaseTemplateIds = cycle.phaseTemplateIds;
    if (!phaseTemplateIds || phaseTemplateIds.length === 0) return [];
    const templatesSnap = await adminDb.collection("workPhaseTemplates").get();
    const allTemplatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));
    return phaseTemplateIds.map((templateId, index): JobPhase | null => {
        const template = allTemplatesMap.get(templateId);
        if (!template) return null;
        return {
            id: template.id, name: template.name, status: 'pending' as const, materialReady: template.isIndependent || template.type === 'preparation',
            workPeriods: [], sequence: index + 1, type: template.type || 'production', tracksTime: template.tracksTime !== false, 
            requiresMaterialScan: template.requiresMaterialScan, requiresMaterialSearch: template.requiresMaterialSearch,
            requiresMaterialAssociation: template.requiresMaterialAssociation, allowedMaterialTypes: template.allowedMaterialTypes || [],
            materialConsumptions: [], qualityResult: null, departmentCodes: template.departmentCodes || [], isIndependent: template.isIndependent || false,
        };
    }).filter((p): p is JobPhase => p !== null);
}

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const snap = await adminDb.collection("jobOrders")
    .where("status", "in", ["planned", "IN_ATTESA", "In Pianificazione", "IN_PIANIFICAZIONE"] as any[])
    .get();
  return snap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data() as any), id: doc.id } as JobOrder));
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const snap = await adminDb.collection("jobOrders")
        .where("status", "in", [
            "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
            "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
            "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
            "Manca Materiale", "Problema", "Sospesa", "PRODUCTION", "PAUSED", "SUSPENDED"
        ])
        .get();
    return snap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
}

export async function getCompletedJobOrders(): Promise<JobOrder[]> {
    const snap = await adminDb.collection("jobOrders")
        .where("status", "in", ["Completata", "CHIUSO", "completed", "shipped", "closed", "COMPLETATA", "FINE PROD"])
        .limit(500).get(); 
    return snap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
}


export async function getRequiredDataForJobs(jobs: JobOrder[], commitments: ManualCommitment[] = []): Promise<{ articles: Article[], materials: RawMaterial[] }> {
    const arrArticleCodes = new Set<string>();
    const directMaterialCodes = new Set<string>();
    
    jobs.forEach(j => {
        if (j.details) arrArticleCodes.add(j.details.toUpperCase());
        j.billOfMaterials?.forEach(b => {
            if (b.component) directMaterialCodes.add(b.component.toUpperCase());
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
            if (b.component) directMaterialCodes.add(b.component.toUpperCase());
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

    const phases = await createPhasesFromCycle(workCycleId);
    const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => ({ ...item, status: 'pending', isFromTemplate: true }));

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
        status: 'In Pianificazione',
        postazioneLavoro: 'Da Assegnare',
        cliente: cliente || "N/D",
        ordinePF: ordinePF,
        numeroODL: "MANUALE",
        numeroODLInterno: odlToAssign,
        details: articleCode.toUpperCase(),
        qta: Number(qta),
        billOfMaterials: jobBOM,
        phases: phases,
        dataConsegnaFinale: dataConsegnaFinale || '',
        dataFinePreparazione: dataFinePreparazione || '',
        department: department || "N/D",
        workCycleId: workCycleId || ''
    };

    try {
        await docRef.set(JSON.parse(JSON.stringify(newJob)));
        revalidatePath('/admin/data-management');
        return { success: true, message: 'Commessa creata con successo.' };
    } catch (error) {
        return { success: false, message: "Errore durante il salvataggio della commessa." };
    }
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean; message: string; newJobs: JobOrder[]; jobsToUpdate: JobOrder[]; blockedJobs: Array<{ row: any; reason: string }>;
}> {
    const newJobs: JobOrder[] = [];
    const jobsToUpdate: JobOrder[] = [];
    const blockedJobs: Array<{ row: any; reason: string }> = [];
    
    const [articlesSnap, cyclesSnap] = await Promise.all([
        adminDb.collection("articles").get(), 
        adminDb.collection("workCycles").get()
    ]);
    
    const articlesMap = new Map(articlesSnap.docs.map(d => [d.data().code.toUpperCase(), d.data() as Article]));
    const cyclesMap = new Map(cyclesSnap.docs.map(d => [d.data().name.toUpperCase(), { ...d.data(), id: d.id } as WorkCycle]));
    
    const importSchema = z.object({ 
        ordinePF: z.coerce.string().min(1), 
        details: z.coerce.string().min(1), 
        qta: z.coerce.number().positive(), 
        cliente: z.coerce.string().optional(), 
        numeroODL: z.coerce.string().optional(), 
        numeroODLInternoImport: z.any().optional(), 
        dataConsegnaFinale: z.string().optional(), 
        dataFinePreparazione: z.string().optional(),
        department: z.coerce.string().optional(), 
        workCycleName: z.coerce.string().optional() 
    });
    
    for (const row of data) {
        let rawDate = row['Data Consegna'] || row['dataConsegnaFinale'];
        let dateStr = '';
        if (rawDate instanceof Date) {
            dateStr = rawDate.toISOString().split('T')[0];
        } else if (typeof rawDate === 'number') {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const d = new Date(excelEpoch.getTime() + rawDate * 86400 * 1000);
            dateStr = d.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string') {
            dateStr = rawDate;
        }

        let rawPrepDate = row['Data Fine Prep'] || row['dataFinePreparazione'];
        let prepDateStr = '';
        if (rawPrepDate instanceof Date) {
            prepDateStr = rawPrepDate.toISOString().split('T')[0];
        } else if (typeof rawPrepDate === 'number') {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const d = new Date(excelEpoch.getTime() + rawPrepDate * 86400 * 1000);
            prepDateStr = d.toISOString().split('T')[0];
        } else if (typeof rawPrepDate === 'string') {
            prepDateStr = rawPrepDate;
        }

        const mappedRow = {
            ordinePF: String(row['Ordine PF'] || row['ordinePF'] || '').trim(),
            details: String(row['Codice'] || row['details'] || '').trim(),
            qta: Number(row['Qta'] || row['qta'] || 0),
            cliente: String(row['Cliente'] || row['cliente'] || 'N/D').trim(),
            numeroODL: String(row['Ordine Nr Est'] || row['numeroODL'] || 'N/D').trim(),
            numeroODLInternoImport: String(row['N° ODL'] || row['numeroODLInternoImport'] || '').trim(),
            dataConsegnaFinale: dateStr,
            dataFinePreparazione: prepDateStr,
            department: String(row['Reparto'] || row['department'] || 'N/D').trim(),
            workCycleName: String(row['Ciclo'] || row['workCycleName'] || '').trim()
        };

        const validated = importSchema.safeParse(mappedRow);
        if (!validated.success) { 
            blockedJobs.push({ row, reason: "Dati obbligatori mancanti (PF, Codice o Qta)." }); 
            continue; 
        }

        if (mappedRow.dataFinePreparazione && mappedRow.dataConsegnaFinale && mappedRow.dataFinePreparazione > mappedRow.dataConsegnaFinale) {
            blockedJobs.push({ row, reason: "La data fine preparazione non può essere successiva alla consegna finale." });
            continue;
        }
        
        const { data: validData } = validated;
        const articleCode = validData.details.toUpperCase().trim();
        const articleData = articlesMap.get(articleCode);
        
        if (!articleData) { 
            blockedJobs.push({ row, reason: `Articolo "${articleCode}" non trovato in Anagrafica.` }); 
            continue; 
        }
        
        const sanitizedId = sanitizeDocumentId(validData.ordinePF);
        const docSnap = await adminDb.collection("jobOrders").doc(sanitizedId).get();

        if (docSnap.exists) {
            blockedJobs.push({ row, reason: "Commessa già presente nel sistema (Duplicata)." });
            continue;
        }

        let workCycleId = '';
        if (validData.workCycleName) {
            const foundCycle = cyclesMap.get(validData.workCycleName.toUpperCase().trim());
            workCycleId = foundCycle ? foundCycle.id : '';
        } else {
            workCycleId = articleData.workCycleId || '';
        }

        const phases = workCycleId ? await createPhasesFromCycle(workCycleId) : [];
        const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => ({ ...item, status: 'pending', isFromTemplate: true }));
        
        let odlToAssign = null;
        if (validData.numeroODLInternoImport) {
            const rawVal = String(validData.numeroODLInternoImport).trim();
            const dashIndex = rawVal.indexOf('-');
            if (dashIndex !== -1) {
                const numPart = rawVal.substring(0, dashIndex).match(/\d+/)?.[0] || '';
                const yearPart = rawVal.substring(dashIndex + 1).trim();
                if (numPart) {
                    odlToAssign = `${numPart.padStart(4, '0')}-${yearPart}`;
                }
            } else {
                const digits = rawVal.match(/\d+/)?.[0] || '';
                const shortYear = new Date().getFullYear().toString().slice(-2);
                if (digits) {
                    odlToAssign = `${digits.padStart(4, '0')}-${shortYear}`;
                }
            }
        }

        newJobs.push({ id: sanitizedId, status: 'In Pianificazione', postazioneLavoro: 'Da Assegnare', cliente: validData.cliente || "N/D", ordinePF: validData.ordinePF, numeroODL: validData.numeroODL || "N/D", numeroODLInterno: odlToAssign, details: articleCode, qta: validData.qta, billOfMaterials: jobBOM, phases: phases, dataConsegnaFinale: validData.dataConsegnaFinale || '', dataFinePreparazione: validData.dataFinePreparazione || '', department: validData.department || "N/D", workCycleId: workCycleId });
    }
    return { success: true, message: "Analisi completata.", newJobs, jobsToUpdate, blockedJobs };
}

export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }) {
    const batch = adminDb.batch();
    data.newJobs.forEach(j => batch.set(adminDb.collection("jobOrders").doc(j.id), j));
    data.jobsToUpdate.forEach(j => batch.set(adminDb.collection("jobOrders").doc(j.id), j, { merge: true }));
    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Caricamento completato.' };
}

export async function updateJobOrderDeliveryDate(jobId: string, newDate: string) {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({ dataConsegnaFinale: newDate });
        revalidatePath('/admin/data-management');
        return { success: true, message: 'Data consegna aggiornata.' };
    } catch (error) {
        return { success: false, message: 'Errore durante l\'aggiornamento della data.' };
    }
}

export async function updateJobOrderPrepDate(jobId: string, newDate: string) {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({ dataFinePreparazione: newDate });
        revalidatePath('/admin/data-management');
        return { success: true, message: 'Data preparazione aggiornata.' };
    } catch (error) {
        return { success: false, message: 'Errore durante l\'aggiornamento della data.' };
    }
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  try {
    const jobRef = adminDb.collection("jobOrders").doc(jobId);
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    const result = await adminDb.runTransaction(async (t) => {
      const snap = await t.get(jobRef);
      if (!snap.exists) throw new Error("Non trovata.");
      const job = snap.data() as JobOrder;
      if (job.status !== 'planned' && job.status !== 'IN_ATTESA' && job.status !== 'In Pianificazione' && job.status !== 'IN_PIANIFICAZIONE') {
          throw new Error("Stato non valido per l'avvio (richiesto In Pianificazione).");
      }
      if (!job.billOfMaterials || job.billOfMaterials.length === 0) throw new Error("Distinta Base vuota.");
      if (!job.phases || job.phases.length === 0) throw new Error("Nessun ciclo.");
      const counterRef = adminDb.collection("counters").doc(`odl_${year}`);
      const counterSnap = await t.get(counterRef);
      const currentCounter = counterSnap.data()?.value || 0;
      let newOdlId: string;
      let newCounterValue: number;
      if (manualOdlNumberStr) {
          const manualNum = parseInt(manualOdlNumberStr, 10);
          newOdlId = `${String(manualNum).padStart(4, '0')}-${shortYear}`;
          newCounterValue = Math.max(currentCounter, manualNum);
      } else if (job.numeroODLInterno) {
          newOdlId = job.numeroODLInterno;
          newCounterValue = currentCounter;
      } else {
          newCounterValue = currentCounter + 1;
          newOdlId = `${String(newCounterValue).padStart(4, '0')}-${shortYear}`;
      }
      t.update(jobRef, { status: 'Da Iniziare', odlCreationDate: admin.firestore.Timestamp.fromDate(now), numeroODLInterno: newOdlId, odlCounter: newCounterValue });
      if (newCounterValue > currentCounter) t.set(counterRef, { value: newCounterValue });
      return newOdlId;
    });
    revalidatePath('/admin/data-management');
    return { success: true, message: `ODL #${result} creato.` };
  } catch (error) { return { success: false, message: error instanceof Error ? error.message : "Errore." }; }
}

export async function createMultipleODLs(jobIds: string[]) {
    let success = 0;
    for (const id of jobIds) { const res = await createODL(id); if (res.success) success++; }
    return { success: success > 0, message: `${success} ODL avviati.` };
}

export async function cancelODL(jobId: string) {
  await adminDb.collection("jobOrders").doc(jobId).update({ status: 'In Pianificazione', odlCreationDate: null });
  revalidatePath('/admin/data-management');
  return { success: true, message: 'Annullato.' };
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
    await adminDb.collection("jobOrders").doc(jobId).update({ workCycleId: cycleId, phases });
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
