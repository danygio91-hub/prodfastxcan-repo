

import type { JobOrder, WorkGroup } from "./mock-data";

export type OverallStatus = 'Da Iniziare' | 'In Preparazione' | 'Pronto per Produzione' | 'In Lavorazione' | 'Completata' | 'Problema' | 'Sospesa' | 'Pronto per Finitura' | 'Manca Materiale';


export function getOverallStatus(item: JobOrder | WorkGroup): OverallStatus {
    const allPhases = item.phases || [];

    // Highest priority: check for specific blocking states
    if (allPhases.some(p => p.materialStatus === 'missing')) return 'Manca Materiale';
    if (item.isProblemReported) return 'Problema';

    // A job/group is ONLY completed if all non-postponed phases are actually 'completed'. 'skipped' is not enough.
    const allRequiredPhasesCompleted = allPhases.length > 0 && allPhases
        .filter(p => !p.postponed)
        .every(p => p.status === 'completed');

    if (allRequiredPhasesCompleted) {
      return 'Completata';
    }
    
    // Legacy check for items that might have been marked completed by the old logic
    if (item.status === 'completed') {
        return 'Completata';
    }


    const isAnyPhaseInProgress = allPhases.some(p => p.status === 'in-progress');
    if (isAnyPhaseInProgress) return 'In Lavorazione';

    // Logic based on progression
    const preparationPhases = allPhases.filter(p => p.type === 'preparation');
    const productionPhases = allPhases.filter(p => p.type === 'production');

    const allPrepDone = preparationPhases
      .filter(p => !p.postponed)
      .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allPrepDone) {
        const allProductionDone = productionPhases.every(p => p.status === 'completed' || p.status === 'skipped');
        if (allProductionDone) {
          return 'Pronto per Finitura';
        }
        return 'Pronto per Produzione';
    }
    
    const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
    if (isAnyPreparationStarted) {
      return 'In Preparazione';
    }
    
    // Fallback to 'Sospesa' if no specific state is met and it's not active
    if (item.status === 'suspended' || item.status === 'paused') {
        return 'Sospesa';
    }

    return 'Da Iniziare';
}
