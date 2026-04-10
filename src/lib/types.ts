import type { JobOrder, WorkGroup, OverallStatus } from "@/types";


export function getOverallStatus(item: JobOrder | WorkGroup): OverallStatus {
    // Pipeline statuses mapping (exact match for Firestore 'status' field)
    const pipelineMap: Record<string, OverallStatus> = {
        'DA_INIZIARE': 'DA INIZIARE',
        'IN_PREPARAZIONE': 'IN PREP.',
        'PRONTO_PROD': 'PRONTO PROD.',
        'IN_PRODUZIONE': 'IN PROD.',
        'FINE_PRODUZIONE': 'FINE PROD.',
        'QLTY_PACK': 'QLTY & PACK',
        'CHIUSO': 'CHIUSO',
        'completed': 'CHIUSO',
        'Completata': 'CHIUSO',
        'shipped': 'CHIUSO',
        'closed': 'CHIUSO',
        'Da Iniziare': 'DA INIZIARE',
        'In Preparazione': 'IN PREP.',
        'IN PREP': 'IN PREP.',
        'Pronto per Produzione': 'PRONTO PROD.',
        'Pronto Produzione': 'PRONTO PROD.',
        'PRONTO PROD': 'PRONTO PROD.',
        'PRONTO': 'PRONTO PROD.',
        'In Lavorazione': 'IN PROD.',
        'IN PROD': 'IN PROD.',
        'Pronto per Finitura': 'FINE PROD.',
        'Fine Produzione': 'FINE PROD.',
        'FINE PROD': 'FINE PROD.',
        'Qualità & Imballo': 'QLTY & PACK',
        'QLTY & PACK': 'QLTY & PACK'
    };

    if (item.status && pipelineMap[item.status]) {
        return pipelineMap[item.status];
    }

    if (item.status === 'planned' || item.status === 'In Pianificazione' || item.status === 'IN_PIANIFICAZIONE' || item.status === 'IN_ATTESA') {
        return 'In Pianificazione';
    }

    const allPhases = item.phases || [];

    // Highest priority: check for specific blocking states
    if (allPhases.some(p => p.materialStatus === 'missing')) return 'Manca Materiale';
    if (item.isProblemReported) return 'Problema';

    // A job/group is considered complete if all non-postponed phases are either 'completed' or 'skipped'.
    const allRequiredPhasesDone = allPhases.length > 0 && allPhases
        .filter(p => !p.postponed)
        .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allRequiredPhasesDone) {
      return 'CHIUSO';
    }
    
    const isAnyPhaseInProgress = allPhases.some(p => p.status === 'in-progress');
    if (isAnyPhaseInProgress) return 'IN PROD.';

    // Logic based on progression
    const preparationPhases = allPhases.filter(p => p.type === 'preparation');
    const productionPhases = allPhases.filter(p => p.type === 'production');

    const allPrepDone = preparationPhases
      .filter(p => !p.postponed)
      .every(p => p.status === 'completed' || p.status === 'skipped');

    if (allPrepDone) {
        const allProductionDone = productionPhases.every(p => p.status === 'completed' || p.status === 'skipped');
        if (allProductionDone) {
          return 'FINE PROD.'; 
        }
        return 'PRONTO PROD.';
    }
    
    const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
    if (isAnyPreparationStarted) {
      return 'IN PREP.';
    }
    
    // Fallback to 'Sospesa' if no specific state is met and it's not active
    if (item.status === 'suspended' || item.status === 'paused' || item.status === 'Sospesa') {
        return 'Sospesa';
    }

    return 'DA INIZIARE';
}
