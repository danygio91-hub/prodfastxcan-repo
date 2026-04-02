'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { OperatorAssignment, JobOrder, Operator, Department, MacroArea, Article, RawMaterial, PurchaseOrder, ManualCommitment } from '@/types';

import { startOfWeek, endOfWeek, format, parseISO, eachDayOfInterval } from 'date-fns';
import { getProductionTimeAnalysisMap } from '../production-console/actions';
import { convertTimestampsToDates } from '@/lib/utils';
import { fetchInChunks } from '@/lib/firestore-utils';



/**
 * Recupera tutte le assegnazioni operatori per un intervallo di date
 */
export async function getOperatorAssignments(startDate: string, endDate: string): Promise<OperatorAssignment[]> {
  const snapshot = await adminDb.collection("operatorAssignments")
    .where("endDate", ">=", startDate)
    .get();
  
  const assignments = snapshot.docs.map(d => ({
    ...d.data(),
    id: d.id
  } as OperatorAssignment));

  return assignments.filter(a => a.startDate <= endDate);
}

/**
 * Salva o aggiorna un'assegnazione (Prestito)
 */
export async function saveOperatorAssignment(data: Omit<OperatorAssignment, 'id'>, uid: string) {
  try {
    await ensureAdmin(uid);
    const id = `assign-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    await adminDb.collection("operatorAssignments").doc(id).set({
      ...data,
      id,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: uid
    });
    
    revalidatePath('/admin/resource-planning');
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Assegnazione salvata.' };
  } catch (error) {
    return { success: false, message: 'Errore durante il salvataggio.' };
  }
}

export async function deleteOperatorAssignment(id: string, uid: string) {
  try {
    await ensureAdmin(uid);
    await adminDb.collection("operatorAssignments").doc(id).delete();
    revalidatePath('/admin/resource-planning');
    return { success: true };
  } catch (error) {
    return { success: false };
  }
}

/**
 * Salva un gruppo di assegnazioni per una settimana specifica.
 * Elimina le vecchie assegnazioni nel range per quegli operatori prima di inserire le nuove.
 */
export async function bulkSaveOperatorAssignments(assignments: Omit<OperatorAssignment, 'id' | 'createdAt'>[], startDate: string, endDate: string, uid: string) {
  try {
    await ensureAdmin(uid);
    const batch = adminDb.batch();

    // 1. Recupera ID degli operatori coinvolti
    const operatorIds = Array.from(new Set(assignments.map(a => a.operatorId)));
    
    if (operatorIds.length > 0) {
      const existingAssignments = await fetchInChunks<OperatorAssignment>(
        adminDb.collection("operatorAssignments"),
        "operatorId",
        operatorIds
      );

      existingAssignments.forEach(data => {
        if (data.endDate >= startDate && data.startDate <= endDate) {
          batch.delete(adminDb.collection("operatorAssignments").doc(data.id));
        }
      });
    }

    // 2. Aggiungi le nuove assegnazioni
    assignments.forEach(a => {
      const id = `assign-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const ref = adminDb.collection("operatorAssignments").doc(id);
      batch.set(ref, {
        ...a,
        id,
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: uid
      });
    });

    await batch.commit();
    revalidatePath('/admin/resource-planning');
    return { success: true, message: 'Assegnazioni salvate.' };
  } catch (error) {
    console.error("Bulk save error:", error);
    return { success: false, message: 'Errore durante il salvataggio massivo.' };
  }
}


/**
 * Recupera tutti i dati necessari per la pagina Power-Planning in un colpo solo.
 */
export async function getPlanningData(dateIso: string) {
    const targetDate = parseISO(dateIso);


    const start = startOfWeek(targetDate, { weekStartsOn: 1 });
    const end = endOfWeek(targetDate, { weekStartsOn: 1 });
    
    const [jobOrdersSnap, operatorsSnap, departmentsSnap, assignments, settingsSnap, rawMaterialsSnap, purchaseOrdersSnap, manualCommitmentsSnap] = await Promise.all([
        adminDb.collection("jobOrders").where("status", "in", ["planned", "production", "suspended", "paused"]).get(),
        adminDb.collection("operators").get(),
        adminDb.collection("departments").orderBy("name").get(),
        getOperatorAssignments(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd')),
        adminDb.collection("system").doc("productionSettings").get(),
        adminDb.collection("rawMaterials").get(),
        adminDb.collection("purchaseOrders").where("status", "in", ["pending", "partially_received"]).get(),
        adminDb.collection("manualCommitments").where("status", "==", "pending").get()
    ]);


    const jobOrders = jobOrdersSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as JobOrder));
    const operators = operatorsSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as Operator)).filter(op => op.isReal !== false);
    const departments = departmentsSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as Department));
    const settings = settingsSnap.exists ? convertTimestampsToDates(settingsSnap.data()) as any : {};
    const rawMaterials = rawMaterialsSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as RawMaterial));
    const purchaseOrders = purchaseOrdersSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as PurchaseOrder));
    const manualCommitments = manualCommitmentsSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id } as ManualCommitment));


    // Fetch only needed articles for the jobs
    const articleCodes = Array.from(new Set(jobOrders.map(j => j.details).filter(Boolean)));
    let articles: Article[] = [];
    if (articleCodes.length > 0) {
        articles = await fetchInChunks<Article>(
            adminDb.collection("articles"),
            "code",
            articleCodes
        );
    }

    return {
        jobOrders,
        operators,
        departments,
        assignments,
        articles,
        settings,
        rawMaterials,
        purchaseOrders,
        manualCommitments,
        dateRange: { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    };
}





/**
 * Logica di analisi: Calcola il bilancio Ore caricate vs Ore Disponibili per reparto
 * Ora supporta la persistenza su Firestore per "congelare" il report.
 */
export async function getDepartmentPlanningSnapshot(dateIso: string, forceRefresh: boolean = false, uid?: string) {
    const targetDate = parseISO(dateIso);


    const start = startOfWeek(targetDate, { weekStartsOn: 1 });
    const end = endOfWeek(targetDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start, end });
    const weekKey = format(start, 'yyyy-ww'); // Chiave unica per la settimana

    // 1. Controlla se esiste uno snapshot salvato (se non è un rinfresco forzato)
    if (!forceRefresh) {
        const storedDoc = await adminDb.collection("planningSnapshots").doc(weekKey).get();
        if (storedDoc.exists) {
            const storedData = storedDoc.data();
            return {
                ...storedData,
                days: days.map(d => format(d, 'yyyy-MM-dd')),
                isFromCache: true
            };
        }
    }

    // 2. Se non esiste o forceRefresh = true, procedi con il calcolo
    const [assignments, jobOrdersSnapshot, operatorsSnapshot, departmentsSnapshot, timeAnalysis] = await Promise.all([
        getOperatorAssignments(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd')),
        adminDb.collection("jobOrders").where("status", "in", ["planned", "production"]).get(),
        adminDb.collection("operators").get(),
        adminDb.collection("departments").get(),
        getProductionTimeAnalysisMap()
    ]);

    const jobOrders = jobOrdersSnapshot.docs.map(d => convertTimestampsToDates(d.data()) as JobOrder);
    const operators = operatorsSnapshot.docs.map(d => ({ ...convertTimestampsToDates(d.data()), id: d.id } as Operator)).filter(op => op.isReal !== false);
    const departments = departmentsSnapshot.docs.map(d => convertTimestampsToDates(d.data()) as Department);


    // 3. Calcola Domanda (Demand) per ogni giorno e reparto, DIVISA PER AREA
    const demand: Record<string, Record<string, Record<string, number>>> = {}; 
    const totalDeptDemand: Record<string, Record<string, number>> = {}; 
    
    let hasAnyIpothesis = false;

    jobOrders.forEach((job: JobOrder) => {
        const dateStr = job.dataConsegnaFinale?.split('T')[0];
        if (!dateStr) return;
        
        // Defensive check: if articleAnalysis or its phases are missing
        const articleAnalysis = timeAnalysis.get(job.details);
        if (!articleAnalysis) hasAnyIpothesis = true;
        const articlePhases = articleAnalysis?.phases || {};

        // Defensive check: if job.phases is missing or empty
        const phases = job.phases || [];

        phases.forEach((phase: any) => {
            // Safer access to phase time with fallback
            const phaseTimeInfo = articlePhases[phase.name];
            if (!phaseTimeInfo) hasAnyIpothesis = true;

            const phaseTime = phaseTimeInfo?.averageMinutesPerPiece || 10;
            const phaseLoad = phaseTime * (job.qta || 0);
            
            let phaseArea: MacroArea = 'PRODUZIONE';
            if (phase.type === 'preparation') phaseArea = 'PREPARAZIONE';
            else if (phase.type === 'quality' || phase.type === 'packaging') phaseArea = 'QLTY_PACK';

            let targetDeptCodes = phase.departmentCodes || [];
            if (phaseArea === 'PRODUZIONE' && job.department) {
                targetDeptCodes = [job.department];
            } else if (targetDeptCodes.length === 0 && job.department) {
                targetDeptCodes = [job.department];
            }


            targetDeptCodes.forEach((deptCode: string) => {
                // Se la fase è di preparazione o qualità e il reparto originale è MAG o Collaudo o CG (vecchio),
                // potremmo volerli raggruppare sotto 'SUPPORT' se necessario, ma manteniamo i codici reali per ora
                // e aggreghiamo dopo.
                
                if (!demand[deptCode]) demand[deptCode] = { 'PREPARAZIONE': {}, 'PRODUZIONE': {}, 'QLTY_PACK': {} };
                if (!totalDeptDemand[deptCode]) totalDeptDemand[deptCode] = {};
                const splitLoad = phaseLoad / (targetDeptCodes.length || 1);
                demand[deptCode][phaseArea][dateStr] = (demand[deptCode][phaseArea][dateStr] || 0) + splitLoad;
                totalDeptDemand[deptCode][dateStr] = (totalDeptDemand[deptCode][dateStr] || 0) + splitLoad;
            });
        });
    });

    // 4. Calcola Offerta (Supply) basata su Assegnazioni
    const supply: Record<string, Record<string, number>> = {}; 
    days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        operators.forEach((op: Operator) => {
            const activeAssign = assignments.find(a => 
                a.operatorId === op.id && 
                dateStr >= a.startDate && 
                dateStr <= a.endDate
            );
            let activeDepts = activeAssign ? [activeAssign.departmentCode] : (op.reparto || []);
            activeDepts.forEach(dept => {
              if (!supply[dept]) supply[dept] = {};
              const capacityPerDept = 480 / activeDepts.length;
              supply[dept][dateStr] = (supply[dept][dateStr] || 0) + capacityPerDept;
            });
        });
    });

    // 5. Calcolo Supporto Condiviso (MAG+QLTY+PACK)
    const supportSupply: Record<string, number> = {}; // date -> total support mins
    // Somma tutta la capacità assegnata a 'SUPPORT' o aree macro via assignment
    days.forEach(day => {
        const ds = format(day, 'yyyy-MM-dd');
        operators.forEach(op => {
            const activeAssign = assignments.find(a => 
                a.operatorId === op.id && ds >= a.startDate && ds <= a.endDate
            );
            if (activeAssign?.departmentCode === 'SUPPORT') {
                supportSupply[ds] = (supportSupply[ds] || 0) + 480;
            }
        });
    });

    // 5. Organizziamo i dati per Macro Area
    const resultByMacroArea: Record<string, any[]> = { 'PREPARAZIONE': [], 'PRODUZIONE': [], 'QLTY_PACK': [] };

    // A. QLTY_PACK & PREPARAZIONE (Aggregato Condiviso o separato se richiesto)
    const supportAreas = ['PREPARAZIONE', 'QLTY_PACK'];
    supportAreas.forEach(area => {
        const areaDepts = departments.filter(d => d.macroAreas?.includes(area as any));
        if (areaDepts.length > 0) {
            const aggregatedData = days.map(day => {
                const ds = format(day, 'yyyy-MM-dd');
                let totalAreaDemand = 0; 
                let totalSpecificSupply = 0;
                
                areaDepts.forEach(d => {
                    totalAreaDemand += demand[d.code]?.[area]?.[ds] || 0;
                    totalSpecificSupply += supply[d.code]?.[ds] || 0;
                });

                // Aggiungiamo il supporto condiviso (SUPPORT) equamente o come pool?
                // Visualizziamo il totale supply per quell'area includendo il supporto
                const combinedSupply = totalSpecificSupply + (supportSupply[ds] || 0);

                return {
                    date: ds,
                    demandHours: totalAreaDemand / 60,
                    supplyHours: combinedSupply / 60,
                    balance: (combinedSupply - totalAreaDemand) / 60
                };
            });
            resultByMacroArea[area].push({
                id: `${area.toLowerCase()}_agg`, 
                code: area, 
                name: area === 'PREPARAZIONE' ? 'REPARTO PREPARAZIONE' : 'REPARTO QLTY & PACK', 
                macroAreas: [area], 
                data: aggregatedData
            });
        }
    });

    // B. Altre aree
    departments.forEach((d: Department) => {
        const areas = d.macroAreas || ['PRODUZIONE'];
        areas.forEach(area => {
            if (area === 'QLTY_PACK') return;
            const deptSnap = {
                ...d,
                data: days.map(day => {
                    const ds = format(day, 'yyyy-MM-dd');
                    const areaDemand = demand[d.code]?.[area]?.[ds] || 0;
                    const totalSupply = supply[d.code]?.[ds] || 0;
                    const totalDemand = totalDeptDemand[d.code]?.[ds] || 0;
                    return {
                        date: ds,
                        demandHours: areaDemand / 60,
                        supplyHours: totalSupply / 60,
                        balance: (totalSupply - totalDemand) / 60,
                        areaSpecificDemand: areaDemand / 60
                    };
                })
            };
            resultByMacroArea[area].push(deptSnap);
        });
    });

    const snapshotResult = {
        days: days.map(d => format(d, 'yyyy-MM-dd')),
        macroAreas: resultByMacroArea,
        isIpothesis: hasAnyIpothesis,
        updatedAt: admin.firestore.Timestamp.now().toDate().toISOString(),
        updatedBy: uid || 'Sistema',
    };

    // 6. Salva il risultato su Firestore per i futuri caricamenti "congelati"
    await adminDb.collection("planningSnapshots").doc(weekKey).set(snapshotResult);

    return { ...snapshotResult, isFromCache: false };
}

/**
 * Aggiorna in tempo reale la data di assegnazione Kanban di una o più commesse,
 * abilitando la "Optimistic UI" nel Drag&Drop
 */
export async function assignJobToDate(jobId: string, assignedDate: string | null) {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({
            assignedDate: assignedDate, // e.g. '2024-03-29' or null for 'unassigned'
        });
        // We do not revalidatePath here if the client relies on optimistic UI 
        // to avoid heavy refetching during rapid drag&drops.
        // It's up to the client to decide when to call refresh.
        return { success: true };
    } catch (e) {
        return { success: false, message: "Errore durante il salvataggio della data." };
    }
}

/**
 * Aggiorna massivamente la data di assegnazione per un gruppo di commesse.
 */
export async function bulkAssignJobsToDate(jobIds: string[], assignedDate: string | null) {
  try {
    const batch = adminDb.batch();
    jobIds.forEach(id => {
      const ref = adminDb.collection("jobOrders").doc(id);
      batch.update(ref, { assignedDate: assignedDate });
    });
    await batch.commit();
    return { success: true };
  } catch (error) {
    console.error("Bulk assign error:", error);
    return { success: false, message: "Errore durante lo spostamento multiplo." };
  }
}

/**
 * Attiva o disattiva la priorità alta per una commessa.
 */
export async function toggleJobPriority(jobId: string, value: boolean) {
    try {
        await ensureAdmin();
        const docRef = adminDb.collection("jobOrders").doc(jobId);
        await docRef.update({ 
            isPriority: value,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: "Priorità aggiornata con successo" };
    } catch (error: any) {
        return { success: false, message: error.message || "Errore sconosciuto" };
    }
}

/**
 * Aggiorna l'indice di ordinamento di una commessa (per persistenza Drag&Drop)
 */
export async function updateJobSortOrder(jobId: string, sortIndex: number) {
    try {
        await adminDb.collection("jobOrders").doc(jobId).update({
            sortIndex: sortIndex
        });
        return { success: true };
    } catch (e) {
        return { success: false, message: "Errore nel salvataggio dell'ordinamento." };
    }
}

/**
 * Aggiorna massivamente l'ordine di più commesse (ottimizzazione batch)
 */
export async function bulkUpdateJobSortOrder(updates: { id: string, sortIndex: number }[]) {
    try {
        const batch = adminDb.batch();
        updates.forEach(u => {
            const ref = adminDb.collection("jobOrders").doc(u.id);
            batch.update(ref, { sortIndex: u.sortIndex });
        });
        await batch.commit();
        return { success: true };
    } catch (error) {
        console.error("Bulk sort update error:", error);
        return { success: false, message: "Errore durante l'aggiornamento massivo dell'ordinamento." };
    }
}
