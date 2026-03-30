import type { JobOrder, WorkGroup, OverallStatus } from "@/types";


export function getOverallStatus(item: JobOrder | WorkGroup): OverallStatus {
    const allPhases = item.phases || [];

    // Highest priority: check for specific blocking states
    if (allPhases.some(p => p.materialStatus === 'missing')) return 'Manca Materiale';
    if (item.isProblemReported) return 'Problema';

    // A job/group is considered complete if all non-postponed phases are either 'completed' or 'skipped'.
    const allRequiredPhasesDone = allPhases.length > 0 && allPhases
        .filter(p => !p.postponed)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allRequiredPhasesDone) {
      return 'Completata';
    }
    
    // Legacy check for items that might have been marked completed by old logic, now less likely to be hit
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
