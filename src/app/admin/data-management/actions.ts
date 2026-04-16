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


async function createPhasesFromCycle(cycleId: string, templatesMap?: Map<string, WorkPhaseTemplate>): Promise<JobPhase[]> {
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
        dataConsegnaFinale: dataConsegnaFinale || '',
        dataFinePreparazione: dataFinePreparazione || '',
        department: department || "N/D",
        workCycleId: workCycleId || '',
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
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
    try {
        const newJobs: JobOrder[] = [];
        const jobsToUpdate: JobOrder[] = [];
        const blockedJobs: Array<{ row: any; reason: string }> = [];
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            return { success: false, message: "Il file è vuoto o non contiene dati validi.", newJobs: [], jobsToUpdate: [], blockedJobs: [] };
        }

        const [articlesSnap, cyclesSnap, templatesSnap] = await Promise.all([
            adminDb.collection("articles").get(), 
            adminDb.collection("workCycles").get(),
            adminDb.collection("workPhaseTemplates").get()
        ]);
        
        const articlesMap = new Map(articlesSnap.docs
            .filter(d => d.data()?.code)
            .map(d => [String(d.data().code).toUpperCase().trim(), d.data() as Article])
        );
        const cyclesMap = new Map(cyclesSnap.docs
            .filter(d => d.data()?.name)
            .map(d => [String(d.data().name).toUpperCase().trim(), { ...d.data(), id: d.id } as WorkCycle])
        );
        const templatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));
        
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
            if (raw instanceof Date) return raw.toISOString().split('T')[0];
            if (typeof raw === 'number') {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                return new Date(excelEpoch.getTime() + raw * 86400 * 1000).toISOString().split('T')[0];
            }
            const s = String(raw).trim();
            if (s.includes('/')) {
                const parts = s.split('/');
                if (parts.length === 3) {
                    const day = parts[0].padStart(2, '0');
                    const month = parts[1].padStart(2, '0');
                    let year = parts[2];
                    if (year.length === 2) year = '20' + year;
                    return `${year}-${month}-${day}`;
                }
            }
            return s;
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

            const phases = workCycleId ? await createPhasesFromCycle(workCycleId, templatesMap) : [];
            const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => ({ ...item, status: 'pending', isFromTemplate: true }));
            
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
