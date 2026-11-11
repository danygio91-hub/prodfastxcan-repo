import type { Article, ArticlePhaseTime, JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate } from '@/types';

const PLANNED_SYNC_STATUSES = new Set([
  'PIANIFICATA',
  'PIANIFICATO',
  'PIANIFICATE',
  'PLANNED',
  'IN_ATTESA',
  'IN_PIANIFICAZIONE',
  'IN PIANIFICAZIONE',
  'PENDING',
]);

const FROZEN_OR_STARTED_STATUSES = new Set([
  'DA_INIZIARE',
  'IN_PREP',
  'IN PREP',
  'IN_PREPARAZIONE',
  'IN PREPARAZIONE',
  'PRONTO',
  'PRONTO_PROD',
  'PRONTO PROD',
  'PRONTO PROD.',
  'PRONTO PER PRODUZIONE',
  'IN_PRODUZIONE',
  'IN PRODUZIONE',
  'IN_PROGRESS',
  'IN-PROGRESS',
  'PRODUCTION',
  'ACTIVE',
  'ATTIVO',
  'FINE_PRODUZIONE',
  'FINE PRODUZIONE',
  'FINE PROD.',
  'QLTY_PACK',
  'COMPLETED',
  'COMPLETATO',
  'COMPLETATA',
  'COMPLETATO PROD',
  'COMPLETATO PROD.',
  'SPEDITO',
  'SPEDITA',
  'SHIPPED',
  'CHIUSO',
  'CHIUSA',
  'CLOSED',
  'ANNULLATO',
  'ANNULLATA',
  'CANCELLED',
]);

/**
 * FASE 72 — Regola del "Ciclo Congelato".
 * Consente la sincronizzazione di fasi, ciclo di lavorazione, tempi e distinta
 * ESCLUSIVAMENTE alle commesse in stato backlog pianificato (PIANIFICATA e alias equivalenti
 * non ancora avviati in ODL/produzione).
 *
 * Blocca rigorosamente DA_INIZIARE, IN_PREP, IN_PREPARAZIONE, PRONTO_PROD,
 * IN_PRODUZIONE, FINE_PRODUZIONE, QLTY_PACK, SPEDITO, CHIUSO o qualunque commessa
 * con ODL avviato (`odlCreationDate`) o fasi già movimentate.
 */
export function isJobEligibleForArticleSync(job: Partial<JobOrder> | null | undefined): boolean {
  if (!job) return false;

  if (
    job.odlCreationDate ||
    job.overallStartTime ||
    job.overallEndTime ||
    job.packingListId ||
    job.forcedCompletion === true
  ) {
    return false;
  }

  const phases = Array.isArray(job.phases) ? job.phases : [];
  const hasTouchedPhases = phases.some(
    (p) =>
      (p.status && p.status !== 'pending') ||
      (Array.isArray(p.workPeriods) && p.workPeriods.length > 0) ||
      (Array.isArray(p.materialConsumptions) && p.materialConsumptions.length > 0)
  );
  if (hasTouchedPhases) {
    return false;
  }

  const rawStatus = (job.status || '').toUpperCase().trim();
  if (FROZEN_OR_STARTED_STATUSES.has(rawStatus)) {
    return false;
  }

  if (rawStatus !== '' && !PLANNED_SYNC_STATUSES.has(rawStatus)) {
    return false;
  }

  return true;
}

export function createJobPhaseFromTemplate(
  template: WorkPhaseTemplate,
  sequence: number,
  options?: {
    theoreticalWeight?: number;
    expectedMinutesPerPiece?: number;
    materialReady?: boolean;
  }
): JobPhase {
  return {
    id: template.id,
    name: template.name,
    status: 'pending',
    materialReady: Boolean(
      options?.materialReady || template.isIndependent || template.type === 'preparation'
    ),
    workPeriods: [],
    sequence,
    type: template.type || 'production',
    tracksTime: template.tracksTime !== false,
    requiresMaterialScan: Boolean(template.requiresMaterialScan),
    requiresMaterialSearch: Boolean(template.requiresMaterialSearch),
    requiresMaterialAssociation: Boolean(template.requiresMaterialAssociation),
    allowedMaterialTypes: Array.isArray(template.allowedMaterialTypes)
      ? template.allowedMaterialTypes
      : [],
    materialConsumptions: [],
    qualityResult: null,
    departmentCodes: Array.isArray(template.departmentCodes) ? template.departmentCodes : [],
    isIndependent: Boolean(template.isIndependent),
    theoreticalWeight:
      typeof options?.theoreticalWeight === 'number' && !isNaN(options.theoreticalWeight)
        ? options.theoreticalWeight
        : 1,
    expectedMinutesPerPiece:
      typeof options?.expectedMinutesPerPiece === 'number' && !isNaN(options.expectedMinutesPerPiece)
        ? options.expectedMinutesPerPiece
        : 0,
  };
}

function parseMinutesValue(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const normalized = typeof raw === 'string' ? raw.replace(',', '.') : raw;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function phasesAreEquivalent(a: JobPhase[], b: JobPhase[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      (left.name || '').trim() !== (right.name || '').trim() ||
      (left.sequence ?? 0) !== (right.sequence ?? 0) ||
      (left.type || 'production') !== (right.type || 'production') ||
      (left.expectedMinutesPerPiece ?? 0) !== (right.expectedMinutesPerPiece ?? 0) ||
      (left.theoreticalWeight ?? 1) !== (right.theoreticalWeight ?? 1)
    ) {
      return false;
    }
  }
  return true;
}

export interface ArticleCycleSyncInput {
  job: JobOrder;
  article: Partial<Article>;
  workCycles: WorkCycle[];
  phaseTemplates: WorkPhaseTemplate[];
}

export interface ArticleCycleSyncResult {
  phases: JobPhase[];
  workCycleId: string;
  expectedMinutesDefault: number;
  changed: boolean;
}

/**
 * Calcola le fasi, il workCycleId e il tempo previsto aggiornati per una commessa
 * pianificata a partire dalla configurazione salvata in Anagrafica Articolo.
 */
export function computeArticleCycleSyncForJob({
  job,
  article,
  workCycles,
  phaseTemplates,
}: ArticleCycleSyncInput): ArticleCycleSyncResult {
  const existingPhases = Array.isArray(job.phases) ? job.phases : [];
  const secondaryId = (article.secondaryWorkCycleId || '').trim();
  const primaryId = (article.workCycleId || '').trim();
  const jobCycleId = (job.workCycleId || '').trim();

  const useSecondary = Boolean(
    secondaryId && secondaryId !== 'manual' && jobCycleId && jobCycleId === secondaryId
  );

  const targetCycleId = useSecondary ? secondaryId : primaryId;
  const resolvedWorkCycleId = targetCycleId || jobCycleId || 'manual';
  const targetPhaseTimes: Record<string, ArticlePhaseTime> | undefined = useSecondary
    ? article.phaseTimesSecondary
    : article.phaseTimes;

  const rawExpectedTotal = useSecondary
    ? article.expectedMinutesSecondary
    : article.expectedMinutesDefault;
  const parsedExpectedTotal = parseMinutesValue(rawExpectedTotal);
  const resolvedExpectedDefault =
    parsedExpectedTotal !== null
      ? parsedExpectedTotal
      : typeof job.expectedMinutesDefault === 'number' && Number.isFinite(job.expectedMinutesDefault)
        ? job.expectedMinutesDefault
        : 0;

  const templatesById = new Map(phaseTemplates.map((t) => [t.id, t]));
  const templatesByNameUpper = new Map(
    phaseTemplates.map((t) => [(t.name || '').toUpperCase().trim(), t])
  );
  const cyclesById = new Map(workCycles.map((c) => [c.id, c]));

  const findExistingPhase = (tpl: WorkPhaseTemplate): JobPhase | undefined => {
    const upperName = (tpl.name || '').toUpperCase().trim();
    return existingPhases.find(
      (p) => p.id === tpl.id || (p.name || '').toUpperCase().trim() === upperName
    );
  };

  const resolvePhaseExpectedMinutes = (
    tpl: WorkPhaseTemplate,
    existing?: JobPhase
  ): number => {
    const entry = targetPhaseTimes?.[tpl.id];
    if (entry !== undefined && entry !== null) {
      const parsed = parseMinutesValue(entry.expectedMinutesPerPiece);
      return parsed !== null ? parsed : 0;
    }
    if (
      existing &&
      typeof existing.expectedMinutesPerPiece === 'number' &&
      Number.isFinite(existing.expectedMinutesPerPiece)
    ) {
      return existing.expectedMinutesPerPiece;
    }
    return 0;
  };

  let nextPhases: JobPhase[] = existingPhases;
  const selectedCycle =
    resolvedWorkCycleId !== 'manual' ? cyclesById.get(resolvedWorkCycleId) : undefined;

  if (selectedCycle && Array.isArray(selectedCycle.phaseTemplateIds)) {
    let seq = 0;
    nextPhases = selectedCycle.phaseTemplateIds
      .map((tplId, idx) => {
        const tpl = templatesById.get(tplId);
        if (!tpl) return null;
        seq += 1;
        const existing = findExistingPhase(tpl);
        return createJobPhaseFromTemplate(tpl, seq, {
          theoreticalWeight: selectedCycle.phaseWeights?.[idx] ?? 1,
          expectedMinutesPerPiece: resolvePhaseExpectedMinutes(tpl, existing),
          materialReady: existing?.materialReady,
        });
      })
      .filter((p): p is JobPhase => p !== null);
  } else if (targetPhaseTimes && typeof targetPhaseTimes === 'object') {
    const hasConfiguredKeys = Object.keys(targetPhaseTimes).length > 0;
    if (hasConfiguredKeys) {
      const enabledTemplates = phaseTemplates
        .filter((tpl) => {
          const entry = targetPhaseTimes[tpl.id];
          return Boolean(entry && entry.enabled !== false);
        })
        .sort((a, b) => {
          const seqA = typeof a.sequence === 'number' ? a.sequence : Number.MAX_SAFE_INTEGER;
          const seqB = typeof b.sequence === 'number' ? b.sequence : Number.MAX_SAFE_INTEGER;
          if (seqA !== seqB) return seqA - seqB;
          return (a.name || '').localeCompare(b.name || '');
        });

      nextPhases = enabledTemplates.map((tpl, idx) => {
        const existing = findExistingPhase(tpl);
        return createJobPhaseFromTemplate(tpl, idx + 1, {
          theoreticalWeight: existing?.theoreticalWeight ?? 1,
          expectedMinutesPerPiece: resolvePhaseExpectedMinutes(tpl, existing),
          materialReady: existing?.materialReady,
        });
      });
    } else if (existingPhases.length > 0) {
      nextPhases = existingPhases;
    }
  } else if (existingPhases.length > 0 && targetPhaseTimes) {
    nextPhases = existingPhases.map((p) => {
      const tpl =
        templatesById.get(p.id) ||
        templatesByNameUpper.get((p.name || '').toUpperCase().trim());
      if (!tpl) return p;
      const expectedMinutesPerPiece = resolvePhaseExpectedMinutes(tpl, p);
      return { ...p, expectedMinutesPerPiece };
    });
  }

  const prevCycleNormalized = jobCycleId || '';
  const prevExpected =
    typeof job.expectedMinutesDefault === 'number' && Number.isFinite(job.expectedMinutesDefault)
      ? job.expectedMinutesDefault
      : 0;

  const changed =
    prevCycleNormalized !== resolvedWorkCycleId ||
    prevExpected !== resolvedExpectedDefault ||
    !phasesAreEquivalent(existingPhases, nextPhases);

  return {
    phases: nextPhases,
    workCycleId: resolvedWorkCycleId,
    expectedMinutesDefault: resolvedExpectedDefault,
    changed,
  };
}

