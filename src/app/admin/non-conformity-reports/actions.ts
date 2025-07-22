
'use server';

import { revalidatePath } from 'next/cache';
import { collection, doc, getDocs, getDoc, updateDoc, orderBy, query, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { NonConformityReport, RawMaterial } from '@/lib/mock-data';

// Helper to convert Timestamps for JSON serialization
function convertTimestamps(obj: any): any {
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    if (obj && typeof obj === 'object') {
        if (obj.toDate && typeof obj.toDate === 'function') {
            return obj.toDate().toISOString();
        }
        for (const key in obj) {
            obj[key] = convertTimestamps(obj[key]);
        }
    }
    return obj;
}

export async function getNonConformityReports(): Promise<NonConformityReport[]> {
  const reportsRef = collection(db, "nonConformityReports");
  const q = query(reportsRef, orderBy("reportDate", "desc"));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return [];
  }
  
  const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NonConformityReport));
  // Convert Firestore Timestamps to serializable format (ISO string)
  return JSON.parse(JSON.stringify(convertTimestamps(reports)));
}

export async function approveNonConformity(reportId: string): Promise<{ success: boolean; message: string }> {
    const reportRef = doc(db, 'nonConformityReports', reportId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const reportSnap = await transaction.get(reportRef);
            if (!reportSnap.exists() || reportSnap.data().status !== 'pending') {
                throw new Error("Segnalazione non trovata o già processata.");
            }
            
            const report = reportSnap.data() as NonConformityReport;
            const materialRef = doc(db, 'rawMaterials', report.materialId);
            const materialSnap = await transaction.get(materialRef);

            if (!materialSnap.exists()) {
                throw new Error("Materia prima associata non trovata. Impossibile caricarla.");
            }
            
            // This part is a placeholder for the actual logic to load the material.
            // Since we don't have the quantity from the original form,
            // we will just mark the report as approved.
            // A more robust implementation would require storing the pending batch info
            // within the NC report itself. For now, we focus on status change.

            transaction.update(reportRef, { status: 'approved' });
        });

        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: `Carico approvato. La segnalazione è stata aggiornata.` };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'approvazione." };
    }
}


export async function confirmReturn(reportId: string): Promise<{ success: boolean; message: string }> {
    const reportRef = doc(db, 'nonConformityReports', reportId);
    
    try {
        const reportSnap = await getDoc(reportRef);
        if (!reportSnap.exists() || reportSnap.data().status !== 'pending') {
            throw new Error("Segnalazione non trovata o già processata.");
        }
        
        await updateDoc(reportRef, { status: 'returned' });
        
        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: `Reso confermato. Il materiale non verrà caricato a magazzino.` };
    } catch (error) {
         return { success: false, message: error instanceof Error ? error.message : "Errore durante la conferma del reso." };
    }
}
