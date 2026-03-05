'use server';

import { revalidatePath } from 'next/cache';
import { collection, query as firestoreQuery, where, getDocs, doc, setDoc, getDoc, writeBatch, Timestamp, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate, Article, JobBillOfMaterialsItem } from '@/lib/mock-data';
import * as z from 'zod';

function sanitizeDocumentId(id: string): string {
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}

function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
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
            id: template.id, name: template.name, status: 'pending' as const, materialReady: template.isIndependent || template.type === 'preparation',
            workPeriods: [], sequence: index + 1, type: template.type || 'production', tracksTime: template.tracksTime !== false, 
            requiresMaterialScan: template.requiresMaterialScan, requiresMaterialSearch: template.requiresMaterialSearch,
            requiresMaterialAssociation: template.requiresMaterialAssociation, allowedMaterialTypes: template.allowedMaterialTypes || [],
            materialConsumptions: [], qualityResult: null, departmentCodes: template.departmentCodes || [], isIndependent: template.isIndependent || false,
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
    success: boolean; message: string; newJobs: JobOrder[]; jobsToUpdate: JobOrder[]; blockedJobs: Array<{ row: any; reason: string }>;
}> {
    const newJobs: JobOrder[] = [];
    const jobsToUpdate: JobOrder[] = [];
    const blockedJobs: Array<{ row: any; reason: string }> = [];
    const [articlesSnap, cyclesSnap] = await Promise.all([getDocs(collection(db, "articles")), getDocs(collection(db, "workCycles"))]);
    const articlesMap = new Map(articlesSnap.docs.map(d => [d.data().code.toUpperCase(), d.data() as Article]));
    const cyclesMap = new Map(cyclesSnap.docs.map(d => [d.data().name.toUpperCase(), { ...d.data(), id: d.id } as WorkCycle]));
    const importSchema = z.object({ ordinePF: z.coerce.string().min(1), details: z.coerce.string().min(1), qta: z.coerce.number().positive(), cliente: z.coerce.string().optional(), numeroODL: z.coerce.string().optional(), numeroODLInternoImport: z.any().optional(), dataConsegnaFinale: z.string().optional(), department: z.coerce.string().optional(), workCycleName: z.coerce.string().optional() });
    const now = new Date();
    const shortYear = now.getFullYear().toString().slice(-2);
    
    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success) { blockedJobs.push({ row, reason: "Dati mancanti o errati." }); continue; }
        const { data: validData } = validated;
        const articleCode = validData.details.toUpperCase().trim();
        const articleData = articlesMap.get(articleCode);
        if (!articleData) { blockedJobs.push({ row, reason: `Articolo "${articleCode}" non trovato in Anagrafica.` }); continue; }
        const sanitizedId = sanitizeDocumentId(validData.ordinePF);
        const docSnap = await getDoc(doc(db, "jobOrders", sanitizedId));
        const workCycle = validData.workCycleName ? cyclesMap.get(validData.workCycleName.toUpperCase().trim()) : undefined;
        const phases = workCycle ? await createPhasesFromCycle(workCycle.id) : [];
        const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => ({ ...item, status: 'pending', isFromTemplate: true }));
        
        let odlToAssign = null;
        if (validData.numeroODLInternoImport) {
            const digits = String(validData.numeroODLInternoImport).match(/\d+/)?.[0] || '';
            if (digits) {
                odlToAssign = `${digits.padStart(4, '0')}-${shortYear}`;
            }
        }

        if (docSnap.exists()) {
            const existing = convertTimestampsToDates(docSnap.data()) as JobOrder;
            if (existing.status === 'planned') jobsToUpdate.push({ ...existing, ...validData, id: sanitizedId, billOfMaterials: jobBOM, phases: phases.length > 0 ? phases : existing.phases, workCycleId: workCycle?.id || existing.workCycleId, numeroODLInterno: odlToAssign || existing.numeroODLInterno });
            else blockedJobs.push({ row, reason: "Commessa esistente e in produzione/conclusa." });
        } else {
            newJobs.push({ id: sanitizedId, status: 'planned', postazioneLavoro: 'Da Assegnare', cliente: validData.cliente || "N/D", ordinePF: validData.ordinePF, numeroODL: validData.numeroODL || "N/D", numeroODLInterno: odlToAssign, details: articleCode, qta: validData.qta, billOfMaterials: jobBOM, phases: phases, dataConsegnaFinale: validData.dataConsegnaFinale || '', department: validData.department || "N/D", workCycleId: workCycle?.id || '' });
        }
    }
    return { success: true, message: "Analisi completata.", newJobs, jobsToUpdate, blockedJobs };
}

export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }) {
    const batch = writeBatch(db);
    data.newJobs.forEach(j => batch.set(doc(db, "jobOrders", j.id), j));
    data.jobsToUpdate.forEach(j => batch.set(doc(db, "jobOrders", j.id), j, { merge: true }));
    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Completato.' };
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  try {
    const jobRef = doc(db, "jobOrders", jobId);
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    const result = await runTransaction(db, async (t) => {
      const snap = await t.get(jobRef);
      if (!snap.exists()) throw new Error("Non trovata.");
      const job = snap.data() as JobOrder;
      if (job.status !== 'planned') throw new Error("Stato non valido.");
      if (!job.billOfMaterials || job.billOfMaterials.length === 0) throw new Error("Distinta Base vuota.");
      if (!job.phases || job.phases.length === 0) throw new Error("Nessun ciclo.");
      
      const counterRef = doc(db, "counters", `odl_${year}`);
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

      t.update(jobRef, { status: 'production', odlCreationDate: Timestamp.fromDate(now), numeroODLInterno: newOdlId, odlCounter: newCounterValue });
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
  await updateDoc(doc(db, "jobOrders", jobId), { status: 'planned', odlCreationDate: null });
  revalidatePath('/admin/data-management');
  return { success: true, message: 'Annullato.' };
}

export async function deleteSelectedJobOrders(ids: string[]) {
  const batch = writeBatch(db);
  ids.forEach(id => batch.delete(doc(db, "jobOrders", id)));
  await batch.commit();
  revalidatePath('/admin/data-management');
  return { success: true, message: 'Eliminate.' };
}

export async function updateJobOrderCycle(jobId: string, cycleId: string) {
    const phases = await createPhasesFromCycle(cycleId);
    await updateDoc(doc(db, "jobOrders", jobId), { workCycleId: cycleId, phases });
    revalidatePath('/admin/data-management');
    return { success: true, message: 'Ciclo aggiornato.' };
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const snap = await getDocs(collection(db, 'workCycles'));
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }) as WorkCycle);
}
