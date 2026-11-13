import type { Article, JobBillOfMaterialsItem, JobOrder, JobPhase } from '@/types';
import { calculateJobHours } from '@/lib/time-reliability';

/**
 * Normalizza l'ordinePF figlio per ottenere l'ID documento Firestore (es. "779/PF.2_1" -> "779-PF.2_1").
 */
export function normalizeChildJobId(childOrdinePF: string): string {
  return (childOrdinePF || '').trim().replace(/\//g, '-');
}

/**
 * Estrae la radice dell'Ordine PF (mantenuta per compatibilità).
 */
export function extractBaseOrdinePF(ordinePF: string): string {
  return (ordinePF || '').trim();
}

/**
 * FASE 83-BIS: Calcola il prossimo codice ordinePF figlio (es. "779/PF.2_1", "779/PF.2_2", ecc.)
 * cercando tra i documenti il cui ordinePF inizia per `${parentOrdinePF}_` ed estraendo
 * il numero progressivo dopo l'ultimo `_`.
 */
export function computeNextChildOrdinePF(
  parentOrdinePF: string,
  existingOrdiniPF: string[] = []
): { childOrdinePF: string; suffixNumber: number; childDocId: string } {
  const cleanParent = (parentOrdinePF || '').trim();
  const prefix = `${cleanParent}_`;
  const normPrefix = prefix.toUpperCase().replace(/\//g, '-');

  let maxSuffix = 0;

  for (const raw of existingOrdiniPF) {
    if (!raw) continue;
    const candidate = raw.trim();
    const normCandidate = candidate.toUpperCase().replace(/\//g, '-');

    if (!candidate.startsWith(prefix) && !normCandidate.startsWith(normPrefix)) {
      continue;
    }

    const lastUnderscoreIdx = candidate.lastIndexOf('_');
    if (lastUnderscoreIdx === -1) continue;

    const suffixStr = candidate.slice(lastUnderscoreIdx + 1).trim();
    if (!/^\d+$/.test(suffixStr)) continue;

    const parsed = parseInt(suffixStr, 10);
    // Ignora numeri >= 1900 che rappresentano anni (es. _2026, _2027) e considera solo i progressivi di split
    if (!isNaN(parsed) && parsed > 0 && parsed < 1900 && parsed > maxSuffix) {
      maxSuffix = parsed;
    }
  }

  const nextSuffix = maxSuffix + 1;
  const childOrdinePF = `${cleanParent}_${nextSuffix}`;
  const childDocId = normalizeChildJobId(childOrdinePF);

  return {
    childOrdinePF,
    suffixNumber: nextSuffix,
    childDocId,
  };
}

/**
 * FASE 83-BIS: Eredità delle Fasi di Lavorazione Completate per la commessa figlia:
 * - Se la fase nel padre ha status === 'completed': mantiene la fase intatta nel figlio
 *   (lasciando status: 'completed', operatorId, workPeriods e i timestamp originali).
 * - Se la fase nel padre è pending, in-progress/in_progress o paused/in pausa:
 *   la azzera per la commessa figlia riportando status a 'pending' e pulendo
 *   startDate, endDate, operatorId, workPeriods e i metrics interni.
 */
export function mapPhasesForSplitChild(phases: JobPhase[] = []): JobPhase[] {
  if (!Array.isArray(phases)) return [];
  return phases.map((p, idx) => {
    if (p.status === 'completed') {
      return JSON.parse(JSON.stringify(p)) as JobPhase;
    }

    const cloned: Record<string, any> = {
      ...p,
      status: 'pending' as const,
      workPeriods: [],
      materialConsumptions: [],
      qualityResult: null,
      forced: false,
      workstationScannedAndVerified: false,
      materialReady: Boolean(p.isIndependent || p.type === 'preparation'),
      sequence: typeof p.sequence === 'number' ? p.sequence : idx + 1,
    };

    delete cloned.pauseReason;
    delete cloned.startTime;
    delete cloned.endTime;
    delete cloned.startDate;
    delete cloned.endDate;
    delete cloned.completedAt;
    delete cloned.assignedOperatorId;
    delete cloned.operatorId;
    delete cloned.operatorIds;
    delete cloned.detectedMinutesPerPiece;
    delete cloned.actualMinutes;
    delete cloned.elapsedSeconds;
    delete cloned.metrics;

    return cloned as JobPhase;
  });
}

// Alias per retrocompatibilità
export const resetPhasesForSplitChild = mapPhasesForSplitChild;

/**
 * Ricalcola proporzionalmente il fabbisogno totale e il peso stimato della Distinta Base (BOM).
 */
export function scaleBOMForSplit(
  bom: JobBillOfMaterialsItem[] | undefined,
  coefficient: number,
  resetStatusForChild: boolean
): JobBillOfMaterialsItem[] | undefined {
  if (!Array.isArray(bom)) return undefined;
  return bom.map((item) => {
    const nextItem: JobBillOfMaterialsItem = {
      ...item,
    };

    if (typeof item.fabbisognoTotale === 'number' && !isNaN(item.fabbisognoTotale)) {
      const scaled = item.fabbisognoTotale * coefficient;
      nextItem.fabbisognoTotale =
        item.unit === 'n' ? Math.round(scaled) : Number(scaled.toFixed(3));
    }

    if (typeof item.pesoStimato === 'number' && !isNaN(item.pesoStimato)) {
      nextItem.pesoStimato = Number((item.pesoStimato * coefficient).toFixed(3));
    }

    if (resetStatusForChild) {
      nextItem.status = 'pending';
      nextItem.withdrawn = false;
    }

    return nextItem;
  });
}

export interface ComputeSplitJobParams {
  originalJob: JobOrder;
  newQuantityOriginal: number;
  newQuantityChild: number;
  childId: string;
  childOrdinePF: string;
  article?: Article;
}

export interface ComputeSplitJobResult {
  valid: boolean;
  error?: string;
  splitCoefficient?: number;
  complementaryCoefficient?: number;
  orePrevisteOriginal?: number;
  orePrevisteChild?: number;
  originalUpdatePayload?: Record<string, any>;
  childJobPayload?: JobOrder;
}

/**
 * Motore deterministico per il calcolo dei payload di Split Commessa (Originale aggiornata + Figlia clonata).
 */
export function computeSplitJobPayloads(params: ComputeSplitJobParams): ComputeSplitJobResult {
  const {
    originalJob,
    newQuantityOriginal,
    newQuantityChild,
    childId,
    childOrdinePF,
    article,
  } = params;

  const vecchiQta = Number(originalJob.qta ?? originalJob.qtaRichiesta ?? 0);

  if (!Number.isFinite(vecchiQta) || vecchiQta <= 1) {
    return {
      valid: false,
      error: `La commessa ha una quantità attuale (${vecchiQta}) non divisibile.`,
    };
  }

  if (
    !Number.isFinite(newQuantityOriginal) ||
    !Number.isFinite(newQuantityChild) ||
    newQuantityOriginal <= 0 ||
    newQuantityChild <= 0
  ) {
    return {
      valid: false,
      error: 'Entrambe le quantità (Originale e Nuova Commessa) devono essere maggiori di zero.',
    };
  }

  const sumQty = newQuantityOriginal + newQuantityChild;
  if (Math.abs(sumQty - vecchiQta) > 0.0001) {
    return {
      valid: false,
      error: `La somma delle quantità (${newQuantityOriginal} + ${newQuantityChild} = ${sumQty}) deve essere esattamente uguale alla quantità attuale (${vecchiQta}).`,
    };
  }

  const splitCoefficient = newQuantityOriginal / vecchiQta;
  const complementaryCoefficient = newQuantityChild / vecchiQta;

  const vecchieOre =
    typeof originalJob.orePreviste === 'number' &&
    !isNaN(originalJob.orePreviste) &&
    originalJob.orePreviste > 0
      ? originalJob.orePreviste
      : calculateJobHours(originalJob, article);

  const orePrevisteOriginal = Number((vecchieOre * splitCoefficient).toFixed(2));
  const orePrevisteChild = Number(Math.max(0, vecchieOre - orePrevisteOriginal).toFixed(2));

  const updatedOriginalBOM = scaleBOMForSplit(
    originalJob.billOfMaterials,
    splitCoefficient,
    false
  );
  const childBOM = scaleBOMForSplit(
    originalJob.billOfMaterials,
    complementaryCoefficient,
    true
  );

  const originalUpdatePayload: Record<string, any> = {
    qta: newQuantityOriginal,
    qtaRichiesta: newQuantityOriginal,
    orePreviste: orePrevisteOriginal,
  };

  if (updatedOriginalBOM !== undefined) {
    originalUpdatePayload.billOfMaterials = updatedOriginalBOM;
  }

  // Clonazione profonda della commessa originale per la creazione della figlia
  const clonedBase: Record<string, any> = JSON.parse(JSON.stringify(originalJob));

  delete clonedBase.odlCounter;
  delete clonedBase.odlCreationDate;
  delete clonedBase.packingListId;
  delete clonedBase.problemType;
  delete clonedBase.problemNotes;
  delete clonedBase.problemReportedBy;
  delete clonedBase.actualWeightKg;
  delete clonedBase.numberOfPackages;
  delete clonedBase.lastStatusChange;

  const childJobPayload: JobOrder = {
    ...(clonedBase as JobOrder),
    id: childId,
    ordinePF: childOrdinePF,
    parentJobId: originalJob.id,
    qta: newQuantityChild,
    qtaRichiesta: newQuantityChild,
    orePreviste: orePrevisteChild,
    status: 'Pianificata',
    phases: mapPhasesForSplitChild(originalJob.phases || []),
    billOfMaterials: childBOM ?? [],
    numeroODL: null,
    numeroODLInterno: null,
    isPrinted: false,
    odlPrinted: false,
    overallStartTime: null,
    overallEndTime: null,
    forcedCompletion: false,
    workGroupId: null,
    isProblemReported: false,
  };

  if ('stato' in clonedBase) {
    (childJobPayload as any).stato = 'Pianificata';
  }

  return {
    valid: true,
    splitCoefficient,
    complementaryCoefficient,
    orePrevisteOriginal,
    orePrevisteChild,
    originalUpdatePayload,
    childJobPayload,
  };
}
