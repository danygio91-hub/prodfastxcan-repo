
'use server';

import { db } from '@/lib/firebase';
import { initialOperators, initialDepartmentMap, initialWorkPhaseTemplates, initialWorkstations } from '@/lib/mock-data';
import { collection, writeBatch, getDocs, doc } from 'firebase/firestore';

export async function seedDatabase(): Promise<{ success: boolean; message: string; }> {
  try {
    const operatorsRef = collection(db, "operators");
    const operatorsSnap = await getDocs(operatorsRef);
    
    // Check if the database is already seeded by looking at just one collection
    if (!operatorsSnap.empty) {
        return { success: false, message: 'Il database sembra essere già popolato. Nessuna operazione eseguita.' };
    }
    
    // If operators are empty, we assume the DB is fresh and seed everything.
    const batch = writeBatch(db);
    let totalOperations = 0;

    // Seed Operators
    initialOperators.forEach(op => {
        const docRef = doc(db, "operators", op.id);
        batch.set(docRef, op);
        totalOperations++;
    });

    // Seed Department Map
    const departmentMapDocRef = doc(db, "configuration", "departmentMap");
    batch.set(departmentMapDocRef, initialDepartmentMap);
    totalOperations++;

    // Seed Work Phase Templates
    initialWorkPhaseTemplates.forEach(phase => {
        const docRef = doc(db, "workPhaseTemplates", phase.id);
        batch.set(docRef, phase);
        totalOperations++;
    });

    // Seed Workstations
    initialWorkstations.forEach(ws => {
        const docRef = doc(db, "workstations", ws.id);
        batch.set(docRef, ws);
        totalOperations++;
    });
    
    await batch.commit();
    return { success: true, message: `Database popolato con successo con ${totalOperations} documenti.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel seeding del database:", error);
    return { success: false, message: `Si è verificato un errore durante il popolamento del database: ${errorMessage}` };
  }
}
