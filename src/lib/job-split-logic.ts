import type { Article, JobBillOfMaterialsItem, JobOrder, JobPhase } from '@/types';
import { calculateJobHours } from '@/lib/time-reliability';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePfForComparison(pf: string): string {
  return (pf || '').trim().toUpperCase().replace(/\//g, '-');
}

/**
 * Estrae la radice dell'Ordine PF rimuovendo eventuali suffissi di split esistenti (es. "860/PF.6_1" -> "860/PF.6").
 */
export function extractBaseOrdinePF(ordinePF: string): string {
  const clean = (ordinePF || '').trim();
  if (!clean) return '';
  return clean.replace(/_\d+$/, '');
}

/**
 * Calcola il prossimo codice ordinePF figlio (es. "860/PF.6_1", "860/PF.6_2", ecc.)
 * analizzando i codici già presenti a sistema (case-insensitive e tollerante a "/" vs "-").
 */
export function computeNextChildOrdinePF(
  baseOrdinePF: string,
  existingOrdiniPF: string[] = []
): { childOrdinePF: string; suffixNumber: number } {
  const root = extractBaseOrdinePF(baseOrdinePF);
  const normRoot = normalizePfForComparison(root);
  const pattern = new RegExp(`^${escapeRegExp(normRoot)}_(\\d+)(?:_\\d{4})?$`, 'i');

  let maxSuffix = 0;
  for (const raw of existingOrdiniPF) {
    if (!raw) continue;
    const normCandidate = normalizePfForComparison(raw);
    const match = normCandidate.match(pattern);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > maxSuffix) {
        maxSuffix = parsed;
      }
    }
  }

  const nextSuffix = maxSuffix + 1;
  return {
    childOrdinePF: `${root}_${nextSuffix}`,
    suffixNumber: nextSuffix,
  };
}

/**
 * Azzera le fasi per la commessa figlia generata dallo split:
 * riporta lo stato a 'pending', svuota workPeriods, consumi, timestamp e operatori assegnati.
 */
export function resetPhasesForSplitChild(phases: JobPhase[] = []): JobPhase[] {
  if (!Array.isArray(phases)) return [];
  return phases.map((p, idx) => {
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

    return cloned as JobPhase;
  });
}

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
    phases: resetPhasesForSplitChild(originalJob.phases || []),
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
