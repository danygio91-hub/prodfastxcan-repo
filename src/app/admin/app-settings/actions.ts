
'use server';

import { db } from '@/lib/firebase';
import { initialOperators, initialDepartmentMap, initialWorkPhaseTemplates, initialWorkstations } from '@/lib/mock-data';
import { collection, writeBatch, getDocs, doc, getDoc } from 'firebase/firestore';

export async function seedDatabase(): Promise<{ success: boolean; message: string; }> {
  const batch = writeBatch(db);
  let operationsCount = 0;

  try {
    // Seed Operators
    const operatorsRef = collection(db, "operators");
    const operatorsSnap = await getDocs(operatorsRef);
    if (operatorsSnap.empty) {
        initialOperators.forEach(op => {
            const docRef = doc(db, "operators", op.id);
            batch.set(docRef, op);
            operationsCount++;
        });
    }

    // Seed Department Map
    const departmentMapDocRef = doc(db, "configuration", "departmentMap");
    const departmentMapSnap = await getDoc(departmentMapDocRef);

    if (!departmentMapSnap.exists()) {
        batch.set(departmentMapDocRef, initialDepartmentMap);
        operationsCount++;
    }

    // Seed Work Phase Templates
    const phasesRef = collection(db, "workPhaseTemplates");
    const phasesSnap = await getDocs(phasesRef);
    if (phasesSnap.empty) {
        initialWorkPhaseTemplates.forEach(phase => {
            const docRef = doc(db, "workPhaseTemplates", phase.id);
            batch.set(docRef, phase);
            operationsCount++;
        });
    }

    // Seed Workstations
    const workstationsRef = collection(db, "workstations");
    const workstationsSnap = await getDocs(workstationsRef);
    if (workstationsSnap.empty) {
        initialWorkstations.forEach(ws => {
            const docRef = doc(db, "workstations", ws.id);
            batch.set(docRef, ws);
            operationsCount++;
        });
    }
    
    // Seed JobOrders (empty collection)
    const jobsRef = collection(db, "jobOrders");
    const jobsSnap = await getDocs(jobsRef);
    if (jobsSnap.empty) {
      // You can add initial jobs here if needed in the future
      // For now, we just ensure the collection exists conceptually
    }


    if (operationsCount > 0) {
        await batch.commit();
        return { success: true, message: `Database popolato con successo con ${operationsCount} set di dati iniziali.` };
    } else {
        return { success: false, message: 'Il database sembra essere già popolato. Nessuna operazione eseguita.' };
    }

  } catch (error) {
    console.error("Errore nel seeding del database:", error);
    return { success: false, message: 'Si è verificato un errore durante il popolamento del database.' };
  }
}
