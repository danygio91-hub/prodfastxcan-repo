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
        statusLower === 'spedita' || 
        statusLower === 'spedito' || 
        Boolean((item as JobOrder).packingListId) ||
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
    
    // Se nessuna fase è mai stata avviata o completata (tutte pending), non può essere FINE_PRODUZIONE o CHIUSO
    const hasAnyPhaseEverStarted = allPhases.some(p => p.status === 'in-progress' || p.status === 'completed' || p.status === 'skipped');
    if (!hasAnyPhaseEverStarted) {
        const statusLowerRaw = (item.status || '').toLowerCase().trim();
        const isActuallyPlanned = ['planned', 'in_attesa', 'in pianificazione', 'in_pianificazione', 'pianificata', 'pianificato'].includes(statusLowerRaw);
        return isActuallyPlanned ? 'DA_INIZIARE' : 'IN_PREPARAZIONE';
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
    
    // 3. Fallback SSoT: Se non c'è attività sulle fasi (tutte pending o assenti),
    // usiamo lo stato del Database per distinguere tra "Pianificata" e "In Preparazione" (Rilasciata) o "Pronta".
    const statusLowerRaw = (item.status || '').toLowerCase().trim();
    const isActuallyPlanned = ['planned', 'in_attesa', 'in pianificazione', 'in_pianificazione', 'pianificata', 'pianificato'].includes(statusLowerRaw);
    
    // Check per etichette che indicano Preparazione Finita
    const isPrepFinishedByLabel = [
        'pronto', 'pronto_prod', 'pronto prod.', 'pronto per produzione', 'pronto prod',
        'in lavorazione', 'in_produzione', 'in prod.', 'in_prod', 'active', 'attivo', 
        'fine produzione', 'fine_produzione', 'qlty_pack', 'completed', 'completata'
    ].includes(statusLowerRaw);

    if (isPrepFinishedByLabel) {
        return 'PRONTO_PROD'; // Minimo garantito se l'etichetta dice così
    }

    if (allPhases.length === 0) {
        return isActuallyPlanned ? 'DA_INIZIARE' : 'IN_PREPARAZIONE';
    }
    
    // Default: se abbiamo fasi ma sono tutte 'pending', lo stato dipende dal rilascio DB
    return isActuallyPlanned ? 'DA_INIZIARE' : 'IN_PREPARAZIONE';
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

/**
 * Mappatura SSoT per i 4 stati visualizzati nella tendina della griglia di Programmazione:
 * 1. 'Pianificata': Backlog ordini pianificati (nessuna lavorazione avviata, ODL non avviato)
 * 2. 'In Produzione': ODL avviato ('DA_INIZIARE') o fasi in preparazione/produzione
 * 3. 'Completato Prod.': Tutte le fasi produttive terminate ('FINE_PRODUZIONE' o 'CHIUSO')
 * 4. 'Spedito': Commessa associata a Packing List o contrassegnata come 'SPEDITA'
 */
export type JobDisplayStatus = 'Pianificata' | 'In Produzione' | 'Completato Prod.' | 'Spedito';

export function getJobDisplayStatus(job: JobOrder): JobDisplayStatus {
    const statusLower = (job.status || '').toLowerCase().trim();

    // 1. Priorità Spedito: Packing List presente o stato esplicito spedizione
    if (
        Boolean(job.packingListId) ||
        statusLower === 'spedita' ||
        statusLower === 'spedito' ||
        statusLower === 'shipped' ||
        statusLower.includes('spedit')
    ) {
        return 'Spedito';
    }

    // 2. Pianificata: stato formale di pianificazione SENZA alcuna fase attiva/completata
    const isBacklogPlanned = [
        'planned',
        'in_attesa',
        'in pianificazione',
        'in_pianificazione',
        'pianificata',
        'pianificato'
    ].includes(statusLower);

    const hasAnyPhaseActive = (job.phases || []).some(
        p => p.status === 'in-progress' || p.status === 'completed'
    );

    if (isBacklogPlanned && !hasAnyPhaseActive) {
        return 'Pianificata';
    }

    // 3. Completato Prod.: Chiusura SSoT (FINE_PRODUZIONE o CHIUSO), forzatura o chiusura esplicita
    const derived = getDerivedJobStatus(job);
    if (
        derived === 'CHIUSO' ||
        derived === 'FINE_PRODUZIONE' ||
        job.forcedCompletion === true ||
        ['completed', 'chiuso', 'closed', 'fine produzione', 'fine_produzione', 'fine prod.'].includes(statusLower)
    ) {
        return 'Completato Prod.';
    }

    // 4. In Produzione: ODL avviato ('DA_INIZIARE') o commessa rilasciata/in lavorazione nei reparti
    return 'In Produzione';
}

