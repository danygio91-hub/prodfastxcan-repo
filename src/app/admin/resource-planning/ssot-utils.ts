
import { startOfWeek, addWeeks, startOfDay, isSameWeek } from 'date-fns';
import { getDerivedJobStatus } from '@/lib/job-status';
import { parseRobustDate } from '@/lib/utils';
import type { JobOrder, Department, Article, WorkPhaseTemplate, JobPhase } from '@/types';

/**
 * Normalizzazione Universale dei Tipi Fase (SSoT)
 * Gestisce case-insensitivity e multi-language (ITA/ENG)
 */
export function isPreparationPhase(type?: string): boolean {
    if (!type) return false;
    const t = type.toLowerCase().trim();
    return ['preparation', 'preparazione', 'prep', 'prep.'].includes(t);
}

export function isProductionPhase(type?: string): boolean {
    if (!type) return false;
    const t = type.toLowerCase().trim();
    return ['production', 'produzione', 'prod', 'prod.'].includes(t);
}

export function isQualityPackagingPhase(type?: string): boolean {
    if (!type) return false;
    const t = type.toLowerCase().trim();
    return ['quality', 'qualità', 'qualita', 'packaging', 'imballo', 'confezionamento', 'pack', 'qlty'].includes(t);
}

export interface ProcessedJob {
    job: JobOrder;
    virtualWeek: Date;
    computedResidual: {
        PREP: number;
        CORE: number;
        PACK: number;
    };
    isFinished: {
        PREP: boolean;
        CORE: boolean;
        PACK: boolean;
    };
}

/**
 * Single Source of Truth (SSoT) per il calcolo del carico residuo e la settimana virtuale.
 * Centralizza la logica di Auto-Rollover e la State Machine per eliminare il desync tra Header e Tab.
 */
export function processJobsSSoT(
    jobs: JobOrder[],
    currentDate: Date,
    isSimulationMode: boolean,
    departments: Department[],
    articles: Article[],
    phaseTemplates: WorkPhaseTemplate[]
): ProcessedJob[] {
    const realTodayStart = startOfDay(startOfWeek(new Date(), { weekStartsOn: 1 }));
    const currentBoardStart = startOfDay(startOfWeek(currentDate, { weekStartsOn: 1 }));

    return jobs.map(job => {
        const derivedStatus = getDerivedJobStatus(job);
        const isClosedGlobally = derivedStatus === 'CHIUSO' || job.status?.toUpperCase() === 'CHIUSO' || job.status?.toUpperCase() === 'COMPLETATA';
        const isCancelled = job.status?.toUpperCase() === 'ANNULLATO';

        // 1. DETERMINAZIONE STATI COMPLETAMENTO PER MACRO-AREA
        const phases = job.phases || [];
        const isFinished = {
            PREP: isClosedGlobally || (phases.filter(p => isPreparationPhase(p.type)).length === 0 || phases.filter(p => isPreparationPhase(p.type)).every(p => p.status === 'completed' || p.status === 'skipped')),
            CORE: isClosedGlobally || (phases.filter(p => isProductionPhase(p.type)).length === 0 || phases.filter(p => isProductionPhase(p.type)).every(p => p.status === 'completed' || p.status === 'skipped')),
            PACK: isClosedGlobally || (phases.filter(p => isQualityPackagingPhase(p.type)).length === 0 || phases.filter(p => isQualityPackagingPhase(p.type)).every(p => p.status === 'completed' || p.status === 'skipped'))
        };

        // 2. CALCOLO RESIDUO COMPUTATO (STATE MACHINE) - Spostato prima per determinare il rollover basato sul residuo fisico
        const computedResidual = {
            PREP: calculateAreaResidual(job, 'PREP', isFinished.PREP, articles, phaseTemplates),
            CORE: calculateAreaResidual(job, 'CORE', isFinished.CORE, articles, phaseTemplates),
            PACK: calculateAreaResidual(job, 'PACK', isFinished.PACK, articles, phaseTemplates)
        };
        
        const totalResidual = computedResidual.PREP + computedResidual.CORE + computedResidual.PACK;

        // 3. DETERMINAZIONE SETTIMANA VIRTUALE (CON ROLLOVER E SIMULAZIONE)
        let referenceDate: Date | null = null;
        if (isClosedGlobally && job.overallEndTime) {
            const rawEnd = job.overallEndTime;
            referenceDate = (rawEnd && typeof rawEnd === 'object' && 'seconds' in rawEnd)
                ? new Date(rawEnd.seconds * 1000)
                : new Date(rawEnd);
        } else if (job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D') {
            referenceDate = parseRobustDate(job.dataConsegnaFinale);
        }

        if ((!referenceDate || isNaN(referenceDate.getTime())) && !isClosedGlobally) {
            referenceDate = realTodayStart;
        }

        let virtualWeek = startOfDay(startOfWeek(referenceDate || realTodayStart, { weekStartsOn: 1 }));

        // NUOVA LOGICA ROLLOVER AGGRESSIVA (Richiesta Audit Cliente - REVERSION)
        // Il rollover si basa ESCLUSIVAMENTE sullo stato globale per gestire articoli senza tempi target (residuo 0.0h)
        const isJobOpen = !isClosedGlobally && !isCancelled;

        if (isJobOpen) {
            // A. Rollover Standard Arretrati -> Settimana Corrente
            if (virtualWeek < realTodayStart) {
                virtualWeek = realTodayStart;
            }
            
            // B. Rollover Simulation (Check-up Friday): Arretrati e Settimana Corrente -> Settimana Successiva
            if (isSimulationMode && virtualWeek <= realTodayStart) {
                virtualWeek = addWeeks(realTodayStart, 1);
            }
        }

        // Clamping visivo alla board corrente per gli arretrati non ancora "rollati" oltre
        if (isJobOpen && virtualWeek < currentBoardStart) {
            virtualWeek = currentBoardStart;
        }

        return {
            job,
            virtualWeek,
            computedResidual,
            isFinished
        };
    });
}

function calculateAreaResidual(
    job: JobOrder,
    area: 'PREP' | 'CORE' | 'PACK',
    isAreaFinished: boolean,
    articles: Article[],
    phaseTemplates: WorkPhaseTemplate[]
): number {
    if (isAreaFinished) return 0;

    const article = articles.find(a => a.code?.trim().toUpperCase() === job.details?.trim().toUpperCase());
    const phaseTimes = article?.phaseTimes || {};
    let areaPhases = phaseTemplates.filter(t => {
        if (area === 'PREP') return isPreparationPhase(t.type);
        if (area === 'PACK') return isQualityPackagingPhase(t.type);
        // Per CORE prendiamo solo quelle del reparto del Job
        return isProductionPhase(t.type) && t.departmentCodes.includes(job.department);
    });

    const jobStatus = job.status?.toUpperCase() || '';
    const derivedStatus = getDerivedJobStatus(job);
    
    // Logica Waterfall
    let logicalState = 'A'; // Da Iniziare
    if (['IN_PREPARAZIONE', 'IN PREPARAZIONE', 'IN PREP.', 'IN PREP'].includes(jobStatus)) logicalState = 'B';
    else if (['PRONTO_PROD', 'PRONTO PROD', 'PRONTO PROD.', 'PRONTO PER PRODUZIONE'].includes(jobStatus)) logicalState = 'C';
    else if (['IN_PRODUZIONE', 'IN PRODUZIONE', 'IN PROD.', 'LAVORAZIONE', 'IN LAVORAZIONE', 'PRODUCTION'].includes(jobStatus)) logicalState = 'D';
    else if (['FINE_PRODUZIONE', 'FINE PRODUZIONE', 'FINE PROD.', 'QLTY_PACK', 'QLTY PACK', 'QLTY & PACK', 'PRONTO PER FINITURA', 'PRONTO'].includes(jobStatus)) logicalState = 'E';

    let areaResidual = 0;

    areaPhases.forEach(t => {
        const pt = phaseTimes[t.id] || phaseTimes[t.name];
        const jobPhase = (job.phases || []).find(p => p.name === t.name);
        
        // SSoT Pivot: Se la fase della commessa ha già un tempo stimato (Smart Engine), usiamo quello come SSoT primario.
        // Questo risolve il bug delle Smart Job che apparivano con 0 ore nel Resource Planning.
        const sourceExpectedMins = (jobPhase?.expectedMinutesPerPiece && jobPhase.expectedMinutesPerPiece > 0) 
            ? jobPhase.expectedMinutesPerPiece 
            : (pt?.expectedMinutesPerPiece || 0);

        if (!(sourceExpectedMins > 0) || (pt && pt.enabled === false)) return;

        const expectedMins = sourceExpectedMins * (job.qta || 0);
        
        let realMins = 0;
        if (jobPhase?.workPeriods) {
            const ms = jobPhase.workPeriods.reduce((sum, wp) => {
                if (!wp.start || !wp.end) return sum;
                const s = (typeof wp.start === 'object' && 'seconds' in wp.start) ? wp.start.seconds * 1000 : new Date(wp.start).getTime();
                const e = (typeof wp.end === 'object' && 'seconds' in wp.end) ? wp.end.seconds * 1000 : new Date(wp.end).getTime();
                return sum + Math.max(0, e - s);
            }, 0);
            realMins = ms / 60000;
        }

        if (logicalState === 'A') {
            areaResidual += expectedMins;
        } else if (logicalState === 'B') {
            if (area === 'PREP') areaResidual += Math.max(0, expectedMins - realMins);
            else areaResidual += expectedMins;
        } else if (logicalState === 'C') {
            if (area !== 'PREP') areaResidual += expectedMins;
        } else if (logicalState === 'D') {
            if (area === 'CORE') areaResidual += Math.max(0, expectedMins - realMins);
            else if (area === 'PACK') areaResidual += expectedMins;
        } else if (logicalState === 'E') {
            if (area === 'PACK' && jobPhase?.status !== 'completed') areaResidual += Math.max(0, expectedMins - realMins);
        }
    });

    return areaResidual / 60;
}
