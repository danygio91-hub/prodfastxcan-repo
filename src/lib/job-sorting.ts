import type { JobOrder } from '@/types';
import { getDerivedJobStatus } from '@/lib/job-status';
import { parseRobustDate } from '@/lib/utils';

/**
 * FASE 71: Mappa di Priorità dello Stato Commessa (Status Weights)
 *
 * 1. PIANIFICATA / PIANIFICATO: 1 (Massima priorità, in cima)
 * 2. DA_INIZIARE / IN_PREP / PRONTO_PROD: 2
 * 3. IN_PRODUZIONE: 3
 * 4. FINE_PRODUZIONE / QLTY_PACK (Completati prod): 4
 * 5. SPEDITO / CHIUSO: 5 (Minima priorità, in fondo assoluto)
 */
export const STATUS_WEIGHTS: Record<string, number> = {
  // Priorità 1: Pianificate (Massima priorità, in cima assoluto)
  PIANIFICATA: 1,
  PIANIFICATO: 1,
  PLANNED: 1,
  IN_ATTESA: 1,
  IN_PIANIFICAZIONE: 1,
  PENDING: 1,

  // Priorità 2: Da iniziare / In preparazione / Pronto prod
  DA_INIZIARE: 2,
  IN_PREPARAZIONE: 2,
  IN_PREP: 2,
  PRONTO_PROD: 2,
  PRONTO: 2,
  PRONTO_PER_PRODUZIONE: 2,

  // Priorità 3: In produzione (lavorazione attiva nei reparti)
  IN_PRODUZIONE: 3,
  IN_PROD: 3,
  IN_PROGRESS: 3,
  ACTIVE: 3,
  ATTIVO: 3,
  LAVORAZIONE: 3,
  IN_LAVORAZIONE: 3,

  // Priorità 4: Fine produzione / Completati prod
  FINE_PRODUZIONE: 4,
  FINE_PROD: 4,
  QLTY_PACK: 4,
  COMPLETATO_PROD: 4,
  'COMPLETATO PROD.': 4,
  COMPLETED: 4,
  COMPLETATA: 4,
  COMPLETATO: 4,

  // Priorità 5: Spedite / Chiuse (Minima priorità, in fondo assoluto)
  SPEDITO: 5,
  SPEDITA: 5,
  SHIPPED: 5,
  CHIUSO: 5,
  CLOSED: 5,
};

/**
 * Calcola il peso numerico di priorità per una commessa.
 * Se lo stato non è mappato, assegna un valore intermedio (2.5)
 * per evitare che finisca per sbaglio sopra le pianificate o sotto le spedite.
 */
export function getJobStatusPriority(job: JobOrder): number {
  if (!job) return 2.5;

  const rawStatus = (job.status || '').toUpperCase().trim();

  // 1. Minima priorità (5): Packing list presente o stato Spedito/Chiuso esplicito
  if (
    Boolean(job.packingListId) ||
    rawStatus === 'SPEDITO' ||
    rawStatus === 'SPEDITA' ||
    rawStatus === 'SHIPPED' ||
    rawStatus.includes('SPEDIT') ||
    rawStatus === 'CHIUSO' ||
    rawStatus === 'CLOSED'
  ) {
    return STATUS_WEIGHTS.SPEDITO; // 5
  }

  // 2. Priorità 4: Fine Produzione / Qlty Pack / Completato Prod.
  if (
    rawStatus === 'FINE_PRODUZIONE' ||
    rawStatus === 'FINE_PROD' ||
    rawStatus === 'QLTY_PACK' ||
    rawStatus === 'COMPLETATO PROD.' ||
    rawStatus === 'COMPLETATO_PROD' ||
    rawStatus === 'COMPLETED' ||
    rawStatus === 'COMPLETATA' ||
    rawStatus === 'COMPLETATO'
  ) {
    return STATUS_WEIGHTS.FINE_PRODUZIONE; // 4
  }

  // 3. Priorità 3: In Produzione
  if (
    rawStatus === 'IN_PRODUZIONE' ||
    rawStatus === 'IN_PROD' ||
    rawStatus === 'IN_PROGRESS' ||
    rawStatus === 'ACTIVE' ||
    rawStatus === 'ATTIVO' ||
    rawStatus === 'LAVORAZIONE' ||
    rawStatus === 'IN_LAVORAZIONE'
  ) {
    return STATUS_WEIGHTS.IN_PRODUZIONE; // 3
  }

  // 4. Priorità 2: Da Iniziare / In Preparazione / Pronto Prod
  if (
    rawStatus === 'DA_INIZIARE' ||
    rawStatus === 'IN_PREPARAZIONE' ||
    rawStatus === 'IN_PREP' ||
    rawStatus === 'PRONTO_PROD' ||
    rawStatus === 'PRONTO' ||
    rawStatus === 'PRONTO_PER_PRODUZIONE'
  ) {
    return STATUS_WEIGHTS.DA_INIZIARE; // 2
  }

  // 5. Priorità 1: Pianificata / Pianificato
  if (
    rawStatus === 'PIANIFICATA' ||
    rawStatus === 'PIANIFICATO' ||
    rawStatus === 'PLANNED' ||
    rawStatus === 'IN_ATTESA' ||
    rawStatus === 'IN_PIANIFICAZIONE' ||
    rawStatus === 'PENDING'
  ) {
    return STATUS_WEIGHTS.PIANIFICATA; // 1
  }

  // 6. Se lo stato è valorizzato ma non è mappato nel dizionario di priorità, assegna 2.5
  if (rawStatus && STATUS_WEIGHTS[rawStatus] === undefined) {
    return 2.5;
  }

  // 7. Se lo stato raw era vuoto/non specificato, consultiamo lo stato derivato SSoT
  const derived = getDerivedJobStatus(job);

  if (derived === 'CHIUSO') {
    return STATUS_WEIGHTS.CHIUSO; // 5
  }
  if (derived === 'FINE_PRODUZIONE' || derived === 'QLTY_PACK') {
    return STATUS_WEIGHTS[derived] ?? 4; // 4
  }
  if (derived === 'IN_PRODUZIONE') {
    return STATUS_WEIGHTS.IN_PRODUZIONE; // 3
  }
  if (derived === 'IN_PREPARAZIONE' || derived === 'PRONTO_PROD') {
    return STATUS_WEIGHTS[derived] ?? 2; // 2
  }
  if (derived === 'DA_INIZIARE') {
    const hasStartedPhases = (job.phases || []).some(
      (p) => p.status === 'in-progress' || p.status === 'completed'
    );
    return hasStartedPhases ? 2 : 1;
  }

  // Default fallback intermedio
  return 2.5;
}

/**
 * FASE 71: Comparatore di Default Gerarchico "Stato Commessa"
 * 
 * 1. Primario: Peso priorità gerarchica (1 = Pianificata -> 2 = Da iniziare -> 3 = In prod -> 4 = Fine prod -> 5 = Spedito)
 * 2. Secondario (a parità di peso): Data Consegna Finale (le più urgenti prima)
 * 3. Terziario (a parità di data): Numero ODL o Ordine PF (ordine alfanumerico pulito)
 */
export function defaultJobStatusComparator(a: JobOrder, b: JobOrder): number {
  const pA = getJobStatusPriority(a);
  const pB = getJobStatusPriority(b);

  if (pA !== pB) {
    return pA - pB;
  }

  // Sort secondario: Data Consegna Finale (le più urgenti prima)
  const timeA = a.dataConsegnaFinale ? parseRobustDate(a.dataConsegnaFinale)?.getTime() || 0 : 0;
  const timeB = b.dataConsegnaFinale ? parseRobustDate(b.dataConsegnaFinale)?.getTime() || 0 : 0;

  if (timeA > 0 && timeB > 0 && timeA !== timeB) {
    return timeA - timeB;
  }
  if (timeA > 0 && timeB === 0) return -1;
  if (timeA === 0 && timeB > 0) return 1;

  // Sort terziario: Numero ODL o Ordine PF
  const odlA = String(a.numeroODLInterno || a.numeroODL || a.ordinePF || '');
  const odlB = String(b.numeroODLInterno || b.numeroODL || b.ordinePF || '');
  return odlA.localeCompare(odlB, undefined, { numeric: true, sensitivity: 'base' });
}
