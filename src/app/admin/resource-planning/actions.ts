'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { OperatorAssignment, JobOrder, Operator, Department, MacroArea } from '@/lib/mock-data';
import { startOfWeek, endOfWeek, format, parseISO, eachDayOfInterval } from 'date-fns';
import { getProductionTimeAnalysisMap } from '../production-console/actions';

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

/**
 * Elimina un'assegnazione
 */
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

    const jobOrders = jobOrdersSnapshot.docs.map(d => d.data() as JobOrder);
    const operators = operatorsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Operator)).filter(op => op.isReal);
    const departments = departmentsSnapshot.docs.map(d => d.data() as Department);

    // 3. Calcola Domanda (Demand) per ogni giorno e reparto, DIVISA PER AREA
    const demand: Record<string, Record<string, Record<string, number>>> = {}; 
    const totalDeptDemand: Record<string, Record<string, number>> = {}; 
    
    jobOrders.forEach((job: JobOrder) => {
        const dateStr = job.dataConsegnaFinale?.split('T')[0];
        if (!dateStr) return;
        const articleAnalysis = timeAnalysis.get(job.details);

        job.phases.forEach((phase: any) => {
            const phaseTime = articleAnalysis?.phases[phase.name]?.averageMinutesPerPiece || 10;
            const phaseLoad = phaseTime * job.qta;
            
            let phaseArea: MacroArea = 'PRODUZIONE';
            if (phase.type === 'preparation') phaseArea = 'PREPARAZIONE';
            else if (phase.type === 'quality' || phase.type === 'packaging') phaseArea = 'QLTY_PACK';

            let targetDeptCodes = phase.departmentCodes || [];
            if (targetDeptCodes.length === 0 && job.department) {
              targetDeptCodes = [job.department];
            }

            targetDeptCodes.forEach((deptCode: string) => {
                if (!demand[deptCode]) demand[deptCode] = { 'PREPARAZIONE': {}, 'PRODUZIONE': {}, 'QLTY_PACK': {} };
                if (!totalDeptDemand[deptCode]) totalDeptDemand[deptCode] = {};
                const splitLoad = phaseLoad / targetDeptCodes.length;
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

    // 5. Organizziamo i dati per Macro Area
    const resultByMacroArea: Record<string, any[]> = { 'PREPARAZIONE': [], 'PRODUZIONE': [], 'QLTY_PACK': [] };

    // A. QLTY_PACK (Aggregato)
    const qltyPackDepts = departments.filter(d => d.macroAreas?.includes('QLTY_PACK'));
    if (qltyPackDepts.length > 0) {
      const aggregatedData = days.map(day => {
        const ds = format(day, 'yyyy-MM-dd');
        let totalAreaDemand = 0; let totalAreaSupply = 0;
        qltyPackDepts.forEach(d => {
          totalAreaDemand += demand[d.code]?.['QLTY_PACK']?.[ds] || 0;
          totalAreaSupply += supply[d.code]?.[ds] || 0;
        });
        return {
          date: ds,
          demandHours: totalAreaDemand / 60,
          supplyHours: totalAreaSupply / 60,
          balance: (totalAreaSupply - totalAreaDemand) / 60
        };
      });
      resultByMacroArea['QLTY_PACK'].push({
        id: 'qlty_pack_agg', code: 'QLTY_PACK', name: 'QLTY & PACKING', macroAreas: ['QLTY_PACK'], data: aggregatedData
      });
    }

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
        updatedAt: admin.firestore.Timestamp.now().toDate().toISOString(),
        updatedBy: uid || 'Sistema',
    };

    // 6. Salva il risultato su Firestore per i futuri caricamenti "congelati"
    await adminDb.collection("planningSnapshots").doc(weekKey).set(snapshotResult);

    return { ...snapshotResult, isFromCache: false };
}
