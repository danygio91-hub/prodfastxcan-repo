'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { DraftJobOrder, JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate, Article, JobBillOfMaterialsItem } from '@/types';
import { convertTimestampsToDates } from '@/lib/utils';

function sanitizeDocumentId(id: string): string {
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}

export async function saveDraft(draftData: Omit<DraftJobOrder, 'id' | 'createdAt' | 'status'>) {
    try {
        const id = adminDb.collection("draftOrders").doc().id;
        const draft: DraftJobOrder = {
            ...draftData,
            id,
            status: 'draft',
            createdAt: admin.firestore.Timestamp.now()
        };
        await adminDb.collection("draftOrders").doc(id).set(JSON.parse(JSON.stringify(draft)));
        revalidatePath('/admin/mrp-simulation');
        return { success: true, message: 'Bozza salvata con successo.' };
    } catch (error) {
        console.error("Error saving draft:", error);
        return { success: false, message: 'Errore durante il salvataggio della bozza.' };
    }
}

export async function getDrafts(): Promise<DraftJobOrder[]> {
    try {
        const snap = await adminDb.collection("draftOrders").orderBy('createdAt', 'desc').get();
        return snap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data() as any), id: doc.id } as DraftJobOrder));
    } catch (error) {
        console.error("Error fetching drafts:", error);
        return [];
    }
}

export async function deleteDraft(id: string) {
    try {
        await adminDb.collection("draftOrders").doc(id).delete();
        revalidatePath('/admin/mrp-simulation');
        return { success: true, message: 'Bozza eliminata.' };
    } catch (error) {
        console.error("Error deleting draft:", error);
        return { success: false, message: 'Errore durante l\'eliminazione della bozza.' };
    }
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

export async function convertDraftToJobOrder(draftId: string, customJobId?: string) {
    try {
        const draftRef = adminDb.collection("draftOrders").doc(draftId);
        const draftSnap = await draftRef.get();
        if (!draftSnap.exists) {
            return { success: false, message: "Bozza non trovata." };
        }
        const draft = draftSnap.data() as DraftJobOrder;

        const articleCode = draft.articleCode.toUpperCase().trim();
        const articleSnap = await adminDb.collection("articles").doc(articleCode).get();
        if (!articleSnap.exists) {
            return { success: false, message: "Articolo non trovato in anagrafica." };
        }
        const articleData = articleSnap.data() as Article;

        const workCycleId = articleData.workCycleId || '';
        const phases = workCycleId ? await createPhasesFromCycle(workCycleId) : [];
        const jobBOM: JobBillOfMaterialsItem[] = (articleData.billOfMaterials || []).map(item => ({ 
            ...item, 
            component: item.component.toUpperCase().trim(),
            status: 'pending', 
            isFromTemplate: true 
        }));

        let finalJobId = customJobId?.trim();
        if (!finalJobId) {
            // SIM-[YYYYMMDD]-[UUID] come richiesto (es. SIM-20241105-A8F2)
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const randomHex = Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0');
            finalJobId = `SIM-${yyyy}${mm}${dd}-${randomHex}`;
        }
        const sanitizedId = sanitizeDocumentId(finalJobId);

        const newJob: JobOrder = {
            id: sanitizedId,
            status: 'IN_PIANIFICAZIONE',
            postazioneLavoro: 'Da Assegnare',
            cliente: "SIMULAZIONE MRP",
            ordinePF: sanitizedId,
            numeroODL: "SIMULAZIONE",
            numeroODLInterno: null,
            details: articleCode,
            qta: Number(draft.quantity),
            billOfMaterials: jobBOM,
            phases: phases,
            dataConsegnaFinale: draft.deliveryDate || '',
            dataFinePreparazione: draft.deliveryDate || '',
            department: "N/D",
            workCycleId: workCycleId,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now()
        };

        const batch = adminDb.batch();
        batch.set(adminDb.collection("jobOrders").doc(sanitizedId), JSON.parse(JSON.stringify(newJob)));
        batch.delete(draftRef);
        await batch.commit();

        revalidatePath('/admin/mrp-simulation');
        revalidatePath('/admin/data-management');
        return { success: true, message: `Convertito in Commessa ${sanitizedId}` };
    } catch (error) {
        console.error("Error converting draft:", error);
        return { success: false, message: "Errore durante la conversione della bozza." };
    }
}
