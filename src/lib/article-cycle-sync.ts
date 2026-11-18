import type { Article, ArticlePhaseTime, JobOrder, JobPhase, WorkCycle, WorkPhaseTemplate } from '@/types';

const CONCLUDED_OR_CLOSED_STATUSES = new Set([
  'FINE_PRODUZIONE',
  'FINE PRODUZIONE',
  'FINE PROD.',
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
  'CONCLUSA',
  'CONCLUSO',
  'CONCLUSE',
  'ANNULLATO',
  'ANNULLATA',
  'CANCELLED',
]);

/**
 * FASE 95 — Propagazione Globale Tempi/Cicli su tutte le Commesse Attive.
 * Esclude SOLO le commesse con stato "Conclusa" (Completate, Spedite, Chiuse, Annullate).
 * Tutte le altre commesse ("Pianificate", "Avviate", "In Produzione", incluse commesse manuali
 * come REINTEGRO.NC) DEVONO essere incluse nella sincronizzazione.
 */
export function isJobEligibleForArticleSync(job: Partial<JobOrder> | null | undefined): boolean {
  if (!job) return false;

  if (
    job.overallEndTime ||
    job.forcedCompletion === true
  ) {
    return false;
  }

  const rawStatus = (job.status || '').toUpperCase().trim();
  if (CONCLUDED_OR_CLOSED_STATUSES.has(rawStatus)) {
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
    existingPhase?: JobPhase;
  }
): JobPhase {
  const existing = options?.existingPhase;
  return {
    id: template.id,
    name: template.name,
    status: existing?.status || 'pending',
    materialReady: Boolean(
      options?.materialReady ?? existing?.materialReady ?? (template.isIndependent || template.type === 'preparation')
    ),
    workPeriods: Array.isArray(existing?.workPeriods) ? existing!.workPeriods : [],
    sequence,
    type: template.type || 'production',
    tracksTime: template.tracksTime !== false,
    requiresMaterialScan: Boolean(template.requiresMaterialScan),
    requiresMaterialSearch: Boolean(template.requiresMaterialSearch),
    requiresMaterialAssociation: Boolean(template.requiresMaterialAssociation),
    allowedMaterialTypes: Array.isArray(template.allowedMaterialTypes)
      ? template.allowedMaterialTypes
      : [],
    materialConsumptions: Array.isArray(existing?.materialConsumptions) ? existing!.materialConsumptions : [],
    qualityResult: existing?.qualityResult ?? null,
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
  expectedHours: number;
  orePreviste: number;
  changed: boolean;
}

/**
 * FASE 95: Calcola con Hard-Override l'intero array delle fasi, il workCycleId,
 * expectedMinutesDefault e le ore previste (expectedHours / orePreviste) basandosi su job.qta
 * e sulla somma dei tempi del nuovo ciclo dell'articolo master.
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
          existingPhase: existing,
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
          existingPhase: existing,
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

  // FASE 95: Somma dei tempi per pezzo del nuovo ciclo
  const sumCycleMinutes = nextPhases.reduce(
    (acc, p) => acc + (typeof p.expectedMinutesPerPiece === 'number' && !isNaN(p.expectedMinutesPerPiece) ? p.expectedMinutesPerPiece : 0),
    0
  );
  const roundedSumCycleMinutes = Math.round(sumCycleMinutes * 1000) / 1000;

  const resolvedExpectedDefault =
    parsedExpectedTotal !== null && parsedExpectedTotal > 0
      ? parsedExpectedTotal
      : roundedSumCycleMinutes > 0
        ? roundedSumCycleMinutes
        : typeof job.expectedMinutesDefault === 'number' && Number.isFinite(job.expectedMinutesDefault)
          ? job.expectedMinutesDefault
          : 0;

  const qty = Number(job.qta ?? (job as any).qty ?? job.qtaRichiesta ?? 0);
  const totalCycleMinutes = resolvedExpectedDefault > 0 ? resolvedExpectedDefault : roundedSumCycleMinutes;
  const rawHours = qty > 0 && totalCycleMinutes > 0 ? (qty * totalCycleMinutes) / 60 : 0;
  const expectedHours = rawHours > 0 ? Math.max(0.1, Math.round(rawHours * 100) / 100) : 0;

  return {
    phases: nextPhases,
    workCycleId: resolvedWorkCycleId,
    expectedMinutesDefault: resolvedExpectedDefault,
    expectedHours,
    orePreviste: expectedHours,
    changed: true,
  };
}

