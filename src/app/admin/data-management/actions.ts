
'use server';

import { revalidatePath } from 'next/cache';
import { collection, query as firestoreQuery, where, getDocs, doc, setDoc, getDoc, writeBatch, Timestamp, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import * as z from 'zod';

// Helper function to sanitize Firestore document IDs
function sanitizeDocumentId(id: string): string {
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}

// Helper function to convert Firestore Timestamps to Dates
function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
        newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
}

async function createPhasesFromCycle(cycleId: string): Promise<JobPhase[]> {
    if (!cycleId) return [];
    const cycleRef = doc(db, "workCycles", cycleId);
    const cycleSnap = await getDoc(cycleRef);
    if (!cycleSnap.exists()) return [];
    
    const cycle = cycleSnap.data() as WorkCycle;
    const phaseTemplateIds = cycle.phaseTemplateIds;
    if (!phaseTemplateIds || phaseTemplateIds.length === 0) return [];
    
    const templatesSnap = await getDocs(collection(db, "workPhaseTemplates"));
    const allTemplatesMap = new Map(templatesSnap.docs.map(d => [d.id, d.data() as WorkPhaseTemplate]));

    return phaseTemplateIds.map((templateId, index): JobPhase | null => {
        const template = allTemplatesMap.get(templateId);
        if (!template) return null;
        return {
            id: template.id,
            name: template.name,
            status: 'pending' as const,
            materialReady: template.isIndependent || template.requiresMaterialAssociation || template.type === 'preparation',
            workPeriods: [],
            sequence: index + 1, 
            type: template.type || 'production',
            tracksTime: template.tracksTime !== false, 
            requiresMaterialScan: template.requiresMaterialScan,
            requiresMaterialSearch: template.requiresMaterialSearch,
            requiresMaterialAssociation: template.requiresMaterialAssociation,
            allowedMaterialTypes: template.allowedMaterialTypes || [],
            materialConsumptions: [],
            qualityResult: null,
            departmentCodes: template.departmentCodes || [],
            isIndependent: template.isIndependent || false,
        };
    }).filter((p): p is JobPhase => p !== null);
}

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const q = firestoreQuery(collection(db, "jobOrders"), where("status", "==", "planned"));
  const snap = await getDocs(q);
  return snap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const q = firestoreQuery(collection(db, "jobOrders"), where("status", "in", ["production", "suspended", "paused"]));
    const snap = await getDocs(q);
    return snap.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean;
    message: string;
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    blockedJobs: Array<{ row: any; reason: string }>;
}> {
    const newJobs: JobOrder[] = [];
    const jobsToUpdate: JobOrder[] = [];
    const blockedJobs: Array<{ row: any; reason: string }> = [];

    // 1. Fetch all articles and work cycles for validation
    const [articlesSnap, cyclesSnap] = await Promise.all([
        getDocs(collection(db, "articles")),
        getDocs(collection(db, "workCycles"))
    ]);
    
    const articlesMap = new Map(articlesSnap.docs.map(d => [d.data().code.toUpperCase(), { ...d.data(), id: d.id } as Article]));
    const cyclesMap = new Map(cyclesSnap.docs.map(d => [d.data().name.toUpperCase(), { ...d.data(), id: d.id } as WorkCycle]));

    const importSchema = z.object({
      ordinePF: z.coerce.string().min(1, "ID Commessa obbligatorio."),
      details: z.coerce.string().min(1, "Codice Articolo obbligatorio."),
      qta: z.coerce.number().positive("Quantità non valida."),
      cliente: z.coerce.string().optional(),
      numeroODL: z.coerce.string().optional(),
      numeroODLInternoImport: z.any().optional(),
      dataConsegnaFinale: z.string().optional(),
      department: z.coerce.string().optional(),
      workCycleName: z.coerce.string().optional(),
    });

    const now = new Date();
    const shortYear = now.getFullYear().toString().slice(-2);
    
    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success) {
            blockedJobs.push({ row, reason: "Dati mancanti o formato errato (Ordine PF / Codice / Qta)." });
            continue;
        }
        
        const { data: validData } = validated;
        const articleCode = validData.details.toUpperCase().trim();
        const articleData = articlesMap.get(articleCode);

        // RULE 1: Article MUST exist in anagrafica
        if (!articleData) {
            blockedJobs.push({ row, reason: `Articolo "${articleCode}" non trovato in Anagrafica Articoli.` });
            continue;
        }

        const sanitizedId = sanitizeDocumentId(validData.ordinePF);
        const jobRef = doc(db, "jobOrders", sanitizedId);
        const docSnap = await getDoc(jobRef);
        
        const workCycle = validData.workCycleName ? cyclesMap.get(validData.workCycleName.toUpperCase().trim()) : undefined;
        const phases = workCycle ? await createPhasesFromCycle(workCycle.id) : [];

        // BOM Population
        const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || [])
            .filter(item => item.component && item.quantity > 0)
            .map(item => ({
                ...item,
                status: 'pending',
                isFromTemplate: true,
            }));

        let odlToAssign: string | null = null;
        if (validData.numeroODLInternoImport) {
            const odlString = String(validData.numeroODLInternoImport);
            const match = odlString.match(/\d+/);
            if (match) odlToAssign = `${match[0]}/${shortYear}`;
        }
        
        if (docSnap.exists()) {
            const existingJob = convertTimestampsToDates(docSnap.data()) as JobOrder;
            if (existingJob.status === 'planned') {
                jobsToUpdate.push({
                    ...existingJob,
                    ...validData,
                    id: sanitizedId,
                    billOfMaterials: jobBOM,
                    phases: phases.length > 0 ? phases : existingJob.phases,
                    workCycleId: workCycle?.id || existingJob.workCycleId,
                    numeroODLInterno: odlToAssign || existingJob.numeroODLInterno,
                });
            } else {
                blockedJobs.push({ row, reason: "Commessa già esistente e in produzione/conclusa." });
            }
        } else {
            newJobs.push({
                id: sanitizedId,
                status: 'planned',
                postazioneLavoro: 'Da Assegnare',
                cliente: validData.cliente || "N/D",
                ordinePF: validData.ordinePF,
                numeroODL: validData.numeroODL || "N/D",
                numeroODLInterno: odlToAssign,
                details: articleCode,
                qta: validData.qta,
                billOfMaterials: jobBOM,
                phases: phases,
                dataConsegnaFinale: validData.dataConsegnaFinale || '',
                department: validData.department || "N/D",
                workCycleId: workCycle?.id || '',
            });
        }
    }
    
    return { 
        success: true, 
        message: "Analisi completata.",
        newJobs, 
        jobsToUpdate, 
        blockedJobs
    };
}

export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }): Promise<{ success: boolean; message: string; }> {
    const batch = writeBatch(db);
    data.newJobs.forEach(j => batch.set(doc(db, "jobOrders", j.id), j));
    data.jobsToUpdate.forEach(j => batch.set(doc(db, "jobOrders", j.id), j, { merge: true }));
    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: `Importati: ${data.newJobs.length} nuovi, ${data.jobsToUpdate.length} aggiornati.` };
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  try {
    const jobRef = doc(db, "jobOrders", jobId);
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);

    const result = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(jobRef);
      if (!snap.exists()) throw new Error("Commessa non trovata.");
      const job = snap.data() as JobOrder;

      if (job.status !== 'planned') throw new Error("Solo commesse pianificate possono essere avviate.");
      
      // RULE 2: BOM MUST BE POPULATED
      if (!job.billOfMaterials || job.billOfMaterials.length === 0) {
          throw new Error("IMPOSSIBILE AVVIARE: La Distinta Base è vuota. Definisci i componenti nell'Anagrafica Articoli.");
      }

      if (!job.phases || job.phases.length === 0) throw new Error("La commessa non ha un ciclo di lavoro associato.");

      const counterRef = doc(db, "counters", `odl_${year}`);
      const counterSnap = await transaction.get(counterRef);
      const currentCounter = counterSnap.data()?.value || 0;

      let newOdlId: string;
      let newCounterValue: number;

      if (manualOdlNumberStr) {
        newCounterValue = parseInt(manualOdlNumberStr, 10);
        newOdlId = `${newCounterValue}/${shortYear}`;
      } else if (job.numeroODLInterno) {
        newOdlId = job.numeroODLInterno;
        newCounterValue = currentCounter;
      } else {
        newCounterValue = currentCounter + 1;
        newOdlId = `${newCounterValue}/${shortYear}`;
      }

      transaction.update(jobRef, { 
          status: 'production', 
          odlCreationDate: Timestamp.fromDate(now),
          numeroODLInterno: newOdlId,
          odlCounter: newCounterValue
      });
      
      if (newCounterValue > currentCounter) {
        transaction.set(counterRef, { value: newCounterValue });
      }
      
      return newOdlId;
    });

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return { success: true, message: `ODL #${result} creato. Commessa in produzione.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Errore durante la creazione dell'ODL." };
  }
}

export async function createMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
    let successCount = 0;
    let errors: string[] = [];

    for (const id of jobIds) {
        const res = await createODL(id);
        if (res.success) successCount++;
        else errors.push(`${id}: ${res.message}`);
    }

    const msg = `${successCount} ODL avviati.${errors.length > 0 ? ` Errori in ${errors.length} commesse (es. Distinta Vuota).` : ""}`;
    return { success: successCount > 0, message: msg };
}

export async function cancelODL(jobId: string): Promise<{ success: boolean; message: string }> {
  await updateDoc(doc(db, "jobOrders", jobId), { status: 'planned', odlCreationDate: null });
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: 'ODL annullato.' };
}

export async function cancelMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  const batch = writeBatch(db);
  jobIds.forEach(id => batch.update(doc(db, "jobOrders", id), { status: 'planned', odlCreationDate: null }));
  await batch.commit();
  revalidatePath('/admin/data-management');
  revalidatePath('/admin/production-console');
  return { success: true, message: 'ODL annullati.' };
}

export async function deleteSelectedJobOrders(ids: string[]) {
  const batch = writeBatch(db);
  ids.forEach(id => batch.delete(doc(db, "jobOrders", id)));
  await batch.commit();
  revalidatePath('/admin/data-management');
  return { success: true, message: 'Eliminate.' };
}

export async function deleteAllPlannedJobOrders() {
    const q = firestoreQuery(collection(db, "jobOrders"), where("status", "==", "planned"));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Svuotato.' };
}

export async function updateJobOrderCycle(jobId: string, cycleId: string) {
    const phases = await createPhasesFromCycle(cycleId);
    await updateDoc(doc(db, "jobOrders", jobId), { workCycleId: cycleId, phases });
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Ciclo aggiornato.' };
}

export async function getJobDetailReport(jobId: string) {
    const snap = await getDoc(doc(db, "jobOrders", jobId));
    if (!snap.exists()) return null;
    return convertTimestampsToDates(snap.data()) as JobOrder;
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const snap = await getDocs(collection(db, 'workCycles'));
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as WorkCycle);
}
