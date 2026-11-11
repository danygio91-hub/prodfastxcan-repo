import type { JobOrder, Article } from '@/types';

export type TimeReliabilityStatus = 'MISSING' | 'COMPLETE' | 'MANUAL';

export interface TimeReliabilityMeta {
  status: TimeReliabilityStatus;
  colorClass: string;
  title: string;
  tooltipText: string;
}

/**
 * Calcola il monte ore previsto totale per la commessa.
 * Priorità assoluta al tempo previsto totale (expectedMinutesDefault),
 * con fallback alla somma delle singole fasi (job.phases).
 */
export function calculateJobHours(job: JobOrder, article?: Article): number {
  if (!job) return 0;

  const safeJobMinutes = typeof job.expectedMinutesDefault === 'number' && !isNaN(job.expectedMinutesDefault) && job.expectedMinutesDefault > 0
    ? job.expectedMinutesDefault
    : 0;
  const safeArtMinutes = typeof article?.expectedMinutesDefault === 'number' && !isNaN(article.expectedMinutesDefault) && article.expectedMinutesDefault > 0
    ? article.expectedMinutesDefault
    : 0;

  const totalMinsPerPiece = safeJobMinutes > 0 ? safeJobMinutes : safeArtMinutes;
  const qta = typeof job.qta === 'number' && !isNaN(job.qta) && job.qta > 0 ? job.qta : 0;

  if (totalMinsPerPiece > 0 && qta > 0) {
    const hours = Math.round(((totalMinsPerPiece * qta) / 60) * 10) / 10;
    return isNaN(hours) ? 0 : hours;
  }

  // FALLBACK: La somma delle singole fasi (job.phases) interviene SOLO se expectedMinutesDefault è vuoto o 0
  if (job.phases && job.phases.length > 0 && qta > 0) {
    const totalMinutes = job.phases.reduce((acc, p) => {
      const perPiece = typeof p.expectedMinutesPerPiece === 'number' && !isNaN(p.expectedMinutesPerPiece) 
        ? p.expectedMinutesPerPiece 
        : (typeof (p as any).targetTime === 'number' && !isNaN((p as any).targetTime) ? (p as any).targetTime : 0);
      return acc + (perPiece * qta);
    }, 0);
    if (totalMinutes > 0) {
      const hours = Math.round((totalMinutes / 60) * 10) / 10;
      return isNaN(hours) ? 0 : hours;
    }
  }

  return 0;
}

/**
 * FASE 69: Funzione di Valutazione Affidabilità Tempo (getTimeReliabilityStatus)
 * 
 * Calcolo base: Somma i tempi target (es. targetTime o expectedMinutesPerPiece) di tutte le fasi attive
 * (isActive === true) all'interno del ciclo/fasi della commessa (job.phases o equivalente).
 * 
 * Controllo completezza: Verifica se ci sono fasi attive che hanno target a 0 o null (hasMissingPhaseTargets).
 * 
 * Logica degli Stati:
 * - MISSING (Rosso): Se il tempo totale previsto della commessa è 0 o null.
 * - COMPLETE (Verde): Se il tempo totale previsto è > 0, coincide esattamente con la somma delle fasi attive
 *   (tolleranza per i float) E non ci sono fasi attive con target mancante.
 * - MANUAL (Blu/Azzurro): Se il tempo totale previsto è un override manuale (diverso dalla somma fasi)
 *   OPPURE se ci sono fasi attive senza target temporale (ciclo parziale).
 */
export function getTimeReliabilityStatus(job: JobOrder, article?: Article): TimeReliabilityStatus {
  if (!job) return 'MISSING';

  // 1. Calcolo del tempo totale previsto della commessa in ore
  const hours = calculateJobHours(job, article);
  if (hours <= 0) {
    return 'MISSING';
  }

  // 2. Estrazione e filtro delle fasi attive (isActive === true)
  const phases = Array.isArray(job.phases) ? job.phases : [];
  const activePhases = phases.filter((p: any) => {
    if (!p) return false;
    // Se la proprietà isActive è esplicitamente presente
    if (typeof p.isActive === 'boolean') {
      return p.isActive === true;
    }
    // Fallback per fasi senza isActive esplicito: attive se non saltate o disabilitate
    return p.status !== 'skipped' && p.enabled !== false;
  });

  // Se non ci sono fasi attive configurate ma il tempo totale è > 0, è una stima/override manuale
  if (activePhases.length === 0) {
    return 'MANUAL';
  }

  // 3. Estrazione target di fase e controllo completezza (hasMissingPhaseTargets)
  let hasMissingPhaseTargets = false;
  let sumActivePhaseTargets = 0;

  for (const p of activePhases) {
    const rawTarget =
      (p as any).targetTime !== undefined ? (p as any).targetTime :
      p.expectedMinutesPerPiece !== undefined ? p.expectedMinutesPerPiece :
      (p as any).expectedMinutes !== undefined ? (p as any).expectedMinutes :
      (p as any).targetMinutes !== undefined ? (p as any).targetMinutes : null;

    const numTarget = rawTarget !== null && rawTarget !== undefined && rawTarget !== '' ? Number(rawTarget) : null;

    if (numTarget === null || isNaN(numTarget) || numTarget <= 0) {
      hasMissingPhaseTargets = true;
    } else {
      sumActivePhaseTargets += numTarget;
    }
  }

  // Se ci sono fasi attive senza target temporale (ciclo parziale), lo stato è MANUAL
  if (hasMissingPhaseTargets) {
    return 'MANUAL';
  }

  // 4. Risoluzione del tempo totale previsto per pezzo della commessa
  const explicitJobMinutes =
    (typeof (job as any).targetTime === 'number' && !isNaN((job as any).targetTime) && (job as any).targetTime > 0)
      ? (job as any).targetTime
      : (typeof job.expectedMinutesDefault === 'number' && !isNaN(job.expectedMinutesDefault) && job.expectedMinutesDefault > 0)
        ? job.expectedMinutesDefault
        : (typeof (job as any).expectedMinutes === 'number' && !isNaN((job as any).expectedMinutes) && (job as any).expectedMinutes > 0)
          ? (job as any).expectedMinutes
          : (typeof article?.expectedMinutesDefault === 'number' && !isNaN(article.expectedMinutesDefault) && article.expectedMinutesDefault > 0)
            ? article.expectedMinutesDefault
            : null;

  // Se il tempo totale è impostato esplicitamente (override o baseline)
  if (explicitJobMinutes !== null) {
    const FLOAT_TOLERANCE = 0.01;
    const isClose = (a: number, b: number) => Math.abs(a - b) < FLOAT_TOLERANCE;
    const qta = typeof job.qta === 'number' && !isNaN(job.qta) && job.qta > 0 ? job.qta : 1;

    // Coincidenza esatta: per pezzo, totale minuti sul lotto, o totale ore sul lotto
    const matchesSum =
      isClose(explicitJobMinutes, sumActivePhaseTargets) ||
      isClose(explicitJobMinutes, sumActivePhaseTargets * qta) ||
      isClose(explicitJobMinutes, (sumActivePhaseTargets * qta) / 60);

    if (matchesSum) {
      return 'COMPLETE';
    } else {
      return 'MANUAL';
    }
  }

  // Se nessun expectedMinutesDefault era presente, le ore derivano al 100% dalla somma delle fasi attive complete
  return 'COMPLETE';
}

/**
 * Micro-UX: restituisce classi di colore Tailwind e descrizioni tooltip/title HTML
 * corrispondenti allo stato di affidabilità del tempo.
 */
export function getTimeReliabilityMeta(status: TimeReliabilityStatus): TimeReliabilityMeta {
  switch (status) {
    case 'COMPLETE':
      return {
        status: 'COMPLETE',
        colorClass: 'text-emerald-500',
        title: 'Tempo calcolato esattamente dalla somma del ciclo fasi',
        tooltipText: 'Tempo calcolato esattamente dalla somma del ciclo fasi',
      };
    case 'MANUAL':
      return {
        status: 'MANUAL',
        colorClass: 'text-cyan-500',
        title: 'Stima manuale o ciclo fasi incompleto',
        tooltipText: 'Stima manuale o ciclo fasi incompleto',
      };
    case 'MISSING':
    default:
      return {
        status: 'MISSING',
        colorClass: 'text-red-500',
        title: 'Tempi mancanti in anagrafica',
        tooltipText: 'Tempi mancanti in anagrafica',
      };
  }
}
