
import { adminDb } from './firebase-admin';

/**
 * Invia un impulso di sincronizzazione a tutti gli operatori attivi su una determinata commessa o gruppo.
 * Sfrutta il listener già attivo sul profilo dell'operatore (AuthProvider) per zero costi aggiuntivi.
 */
export async function pulseOperatorsForJob(jobId: string | string[]) {
    try {
        const jobIds = Array.isArray(jobId) ? jobId : [jobId];
        
        // Trova tutti gli operatori il cui activeJobId è tra quelli forniti
        const operatorsSnap = await adminDb.collection("operators")
            .where("activeJobId", "in", jobIds)
            .get();
        
        if (operatorsSnap.empty) return;
        
        const batch = adminDb.batch();
        const now = Date.now();
        
        operatorsSnap.docs.forEach(doc => {
            batch.update(doc.ref, { syncPulse: now });
        });
        
        await batch.commit();
    } catch (error) {
        console.error("Errore durante l'invio del sync pulse ai lavoratori:", error);
    }
}
