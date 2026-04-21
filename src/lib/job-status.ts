import type { JobOrder, WorkGroup, OverallStatus, JobPhase } from "@/types";

/**
 * Single Source of Truth (SSoT) per il calcolo dello stato di una commessa o gruppo.
 * Implementa una gerarchia rigida per risolvere conflitti tra flag nel database.
 */
export function getDerivedJobStatus(item: JobOrder | WorkGroup): OverallStatus {
    // 1. GERARCHIA MASSIMA: Chiusura esplicita
    // Se la commessa è marcata come CHIUSA, completed o shipped, o se c'è stata una chiusura forzata,
    // lo stato DEVE essere CHIUSO, ignorando qualsiasi altro flag (es. isPaused).
    const statusLower = (item.status || '').toLowerCase();
    const isExplicitlyClosed = 
        statusLower === 'chiuso' || 
        statusLower === 'completed' || 
        statusLower === 'shipped' || 
        statusLower === 'closed' ||
        item.forcedCompletion === true;

    if (isExplicitlyClosed) {
        return 'CHIUSO';
    }

    // 2. Logica basata sulle fasi (Legacy ma centralizzata)
    const allPhases = item.phases || [];

    if (allPhases.length === 0) {
        return 'DA_INIZIARE';
    }

    // Se tutte le fasi non posticipate sono completate o saltate -> CHIUSO
    const allRequiredPhasesDone = allPhases
        .filter(p => !p.postponed)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allRequiredPhasesDone) {
        return 'CHIUSO';
    }
    
    // Separazione fasi per area
    const preparationPhases = allPhases.filter(p => p.type === 'preparation');
    const productionPhases = allPhases.filter(p => p.type === 'production');

    // Controllo completamento Preparazione
    const allPrepDone = preparationPhases.length === 0 || preparationPhases
      .filter(p => !p.postponed)
      .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allPrepDone) {
        // La preparazione è finita (o non c'era).
        // Guardiamo la produzione.
        const allProductionDone = productionPhases.length === 0 || productionPhases.every(p => p.status === 'completed' || p.status === 'skipped');
        
        if (allProductionDone) {
            // Produzione finita (o non c'era). Manca Quality/Pack per chiudere.
            return 'FINE_PRODUZIONE'; 
        }

        // La produzione NON è finita. C'è qualche fase in progress?
        if (productionPhases.some(p => p.status === 'in-progress')) {
            return 'IN_PRODUZIONE';
        }
        
        // La produzione non è finita e non è iniziata.
        return 'PRONTO_PROD';
    }
    
    // La preparazione NON è finita.
    const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
    if (isAnyPreparationStarted) {
      return 'IN_PREPARAZIONE';
    }
    
    // Default
    return 'DA_INIZIARE';
}

/**
 * Ritorna se l'item deve essere considerato "Attivo" (in lavorazione live)
 */
export function isJobLive(item: JobOrder | WorkGroup): boolean {
    return (item.phases || []).some(p => p.status === 'in-progress');
}

/**
 * Ritorna se l'item è in ritardo rispetto alla consegna finale
 */
export function isJobOverdue(item: JobOrder | WorkGroup): boolean {
    const status = getDerivedJobStatus(item);
    if (status === 'CHIUSO') return false;

    if (!item.dataConsegnaFinale || !/^\d{4}-\d{2}-\d{2}$/.test(item.dataConsegnaFinale)) {
        return false;
    }

    const deliveryDate = new Date(item.dataConsegnaFinale);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return deliveryDate < today;
}
