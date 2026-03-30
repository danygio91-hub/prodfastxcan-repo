
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { NonConformityReport, RawMaterial, RawMaterialBatch, ProductionProblemReport } from '@/types';

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

export async function getIncomingNonConformityReports(): Promise<NonConformityReport[]> {
  const snapshot = await adminDb.collection("nonConformityReports").orderBy("reportDate", "desc").get();

  if (snapshot.empty) {
    return [];
  }
  
  const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NonConformityReport));
  // Convert Firestore Timestamps to serializable format (ISO string)
  return JSON.parse(JSON.stringify(convertTimestamps(reports)));
}

export async function approveNonConformity(reportId: string): Promise<{ success: boolean; message: string }> {
    const reportRef = adminDb.collection('nonConformityReports').doc(reportId);
    
    try {
        await adminDb.runTransaction(async (transaction) => {
            const reportSnap = await transaction.get(reportRef);
            if (!reportSnap.exists || reportSnap.data()?.status !== 'pending') {
                throw new Error("Segnalazione non trovata o già processata.");
            }
            
            const report = reportSnap.data() as NonConformityReport;
            const materialRef = adminDb.collection('rawMaterials').doc(report.materialId);
            const materialSnap = await transaction.get(materialRef);

            if (!materialSnap.exists) {
                throw new Error("Materia prima associata non trovata. Impossibile caricarla.");
            }
            
            const material = materialSnap.data() as RawMaterial;
            const existingBatches = material.batches || [];
            
            const newBatch: RawMaterialBatch = {
                id: `batch-nc-${report.id}`,
                date: new Date(report.reportDate).toISOString(),
                ddt: `NC-APPROVATA`,
                netQuantity: report.quantity,
                grossWeight: report.quantity, // Assume net = gross for NC approval
                tareWeight: 0,
                lotto: report.lotto,
            };

            const updatedBatches = [...existingBatches, newBatch];
            
            const newStockUnits = (material.currentStockUnits || 0) + report.quantity;
            let newWeightKg = material.currentWeightKg || 0;

            if (material.unitOfMeasure === 'kg') {
                newWeightKg = newStockUnits;
            } else if (material.conversionFactor && material.conversionFactor > 0) {
                newWeightKg += report.quantity * material.conversionFactor;
            } else {
                // If there's no conversion factor, weight doesn't change for non-kg units
                newWeightKg = material.currentWeightKg;
            }


            // Update material stock
            transaction.update(materialRef, { 
                batches: updatedBatches,
                currentStockUnits: newStockUnits,
                currentWeightKg: newWeightKg,
            });
            
            // Update report status
            transaction.update(reportRef, { status: 'approved' });
        });

        revalidatePath('/admin/non-conformity-reports');
        revalidatePath('/admin/raw-material-management');
        return { success: true, message: `Carico approvato. Stock aggiornato.` };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'approvazione." };
    }
}


export async function confirmReturn(reportId: string): Promise<{ success: boolean; message: string }> {
    const reportRef = adminDb.collection('nonConformityReports').doc(reportId);
    
    try {
        const reportSnap = await reportRef.get();
        if (!reportSnap.exists || reportSnap.data()?.status !== 'pending') {
            throw new Error("Segnalazione non trovata o già processata.");
        }
        
        await reportRef.update({ status: 'returned' });
        
        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: `Reso confermato. Il materiale non verrà caricato a magazzino.` };
    } catch (error) {
         return { success: false, message: error instanceof Error ? error.message : "Errore durante la conferma del reso." };
    }
}


export async function deleteIncomingNonConformityReports(reportIds: string[]): Promise<{ success: boolean, message: string }> {
    if (!reportIds || reportIds.length === 0) {
        return { success: false, message: 'Nessuna segnalazione selezionata per l\'eliminazione.' };
    }

    try {
        const batch = adminDb.batch();
        reportIds.forEach(id => {
            const reportRef = adminDb.collection('nonConformityReports').doc(id);
            batch.delete(reportRef);
        });

        await batch.commit();
        revalidatePath('/admin/non-conformity-reports');
        return { success: true, message: `${reportIds.length} segnalazioni sono state eliminate con successo.` };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Errore durante l'eliminazione delle segnalazioni." };
    }
}


// --- Production Problem Reports ---

export async function getProductionProblemReports(): Promise<ProductionProblemReport[]> {
  const snapshot = await adminDb.collection("productionProblemReports").orderBy("reportDate", "desc").get();

  if (snapshot.empty) {
    return [];
  }
  
  const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionProblemReport));
  return JSON.parse(JSON.stringify(convertTimestamps(reports)));
}

export async function deleteProductionProblemReports(reportIds: string[]): Promise<{ success: boolean, message: string }> {
    if (!reportIds || reportIds.length === 0) {
        return { success: false, message: 'Nessuna segnalazione selezionata per l\'eliminazione.' };
    }

    const batch = adminDb.batch();
    reportIds.forEach(id => {
        const docRef = adminDb.collection("productionProblemReports").doc(id);
        batch.delete(docRef);
    });

    await batch.commit();
    revalidatePath('/admin/non-conformity-reports');
    return { success: true, message: `${reportIds.length} segnalazioni di produzione sono state eliminate.` };
}
