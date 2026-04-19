import type { JobOrder, WorkGroup, OverallStatus } from "@/types";


export function getOverallStatus(item: JobOrder | WorkGroup): OverallStatus {
    const allPhases = item.phases || [];

    // Se non ci sono fasi, consideriamo lo stato di default o lo forziamo se è chiuso storicamente
    if (allPhases.length === 0) {
        if (item.status === 'CHIUSO' || item.status === 'completed' || item.status === 'shipped') {
            return 'CHIUSO';
        }
        return 'DA_INIZIARE';
    }

    // 1. Condizione di Chiusura: tutte le fasi non posticipate sono completate o saltate
    const allRequiredPhasesDone = allPhases
        .filter(p => !p.postponed)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allRequiredPhasesDone) {
      return 'CHIUSO';
    }
    
    // 2. Produzione in corso: se QUALSIASI fase è in-progress, il cantiere è considerato in produzione 
    // (a meno che non sia solo la preparazione). Verifichiamo meglio la separazione.
    
    const preparationPhases = allPhases.filter(p => p.type === 'preparation');
    const productionPhases = allPhases.filter(p => p.type === 'production');

    // 3. Controllo completamento Preparazione
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
        
        // La prduzione non è finita e non è iniziata.
        return 'PRONTO_PROD';
    }
    
    // 4. La preparazione NON è finita.
    const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
    if (isAnyPreparationStarted) {
      return 'IN_PREPARAZIONE';
    }
    
    // 5. Nessuna fase è ancora iniziata.
    return 'DA_INIZIARE';
}
