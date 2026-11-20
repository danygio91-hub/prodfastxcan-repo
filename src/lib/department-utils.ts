import type { Article, Department } from '@/types';

export const NO_DEPARTMENT_VALUE = '__NONE__' as const;

export const STANDARD_DEPARTMENT_CODES = ['CP', 'CG', 'BF', 'MAG'] as const;

export const STANDARD_DEPARTMENT_LABELS: Record<string, string> = {
  CP: 'Connessioni Piccole',
  CG: 'Connessioni Grandi',
  BF: 'Reparto Barre',
  MAG: 'Magazzino',
};

const EMPTY_DEPARTMENT_MARKERS = new Set([
  '',
  'N/D',
  'ND',
  'NONE',
  'NULL',
  'UNDEFINED',
  'NESSUNO',
  NO_DEPARTMENT_VALUE,
]);

export interface DepartmentOption {
  value: string;
  id: string;
  code: string;
  name: string;
  label: string;
}

/**
 * Normalizza un identificatore di reparto (codice, nome esteso o oggetto Department)
 * al formato canonico maiuscolo usato da JobOrder.department, filtri tab e capacità (es. 'CP', 'CG', 'BF', 'MAG').
 * Restituisce '' per valori vuoti, 'N/D', 'Nessuno' o sentinella NO_DEPARTMENT_VALUE.
 */
export function normalizeDepartmentCode(
  raw: string | Department | null | undefined,
  departments?: Department[]
): string {
  if (!raw) return '';

  if (typeof raw === 'object') {
    const byCode = normalizeDepartmentCode(raw.code, undefined);
    if (byCode) return byCode;
    const byName = normalizeDepartmentCode(raw.name, undefined);
    if (byName) return byName;
    const byId = normalizeDepartmentCode(raw.id, undefined);
    if (byId) return byId;
    return '';
  }

  const trimmed = String(raw).trim();
  const upper = trimmed.toUpperCase();
  if (EMPTY_DEPARTMENT_MARKERS.has(upper)) {
    return '';
  }

  if (departments && departments.length > 0) {
    const matched = departments.find((d) => {
      const dCode = (d.code || '').trim().toUpperCase();
      const dId = (d.id || '').trim().toUpperCase();
      const dName = (d.name || '').trim().toUpperCase();
      return dCode === upper || dId === upper || dName === upper;
    });
    if (matched) {
      const canonical = (matched.code || matched.id || '').trim().toUpperCase();
      if (canonical && !EMPTY_DEPARTMENT_MARKERS.has(canonical)) {
        return canonical;
      }
    }
  }

  if (STANDARD_DEPARTMENT_LABELS[upper]) {
    return upper;
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('piccol')) return 'CP';
  if (lower.includes('grand')) return 'CG';
  if (lower.includes('barre')) return 'BF';
  if (lower.includes('magazz')) return 'MAG';

  return upper;
}

/**
 * Costruisce l'elenco ordinato e deduplicato dei reparti utilizzabili in anagrafica articolo
 * e nei flussi di creazione/modifica commesse, garantendo sempre CP, CG, BF e MAG.
 */
export function buildDepartmentOptions(departments?: Department[]): DepartmentOption[] {
  const optionsMap = new Map<string, DepartmentOption>();

  const list = Array.isArray(departments) ? departments : [];
  const relevant = list.filter((d) => {
    const code = (d.code || '').trim().toUpperCase();
    return (
      d.macroAreas?.includes('PRODUZIONE') ||
      (STANDARD_DEPARTMENT_CODES as readonly string[]).includes(code)
    );
  });
  const sourceList = relevant.length > 0 ? relevant : list;

  sourceList.forEach((d) => {
    const code = normalizeDepartmentCode(d);
    if (!code) return;
    const name = (d.name || STANDARD_DEPARTMENT_LABELS[code] || code).trim();
    optionsMap.set(code, {
      value: code,
      id: (d.id || code).trim(),
      code,
      name,
      label: name.toUpperCase() === code ? code : `${code} — ${name}`,
    });
  });

  STANDARD_DEPARTMENT_CODES.forEach((code) => {
    if (!optionsMap.has(code)) {
      const name = STANDARD_DEPARTMENT_LABELS[code] || code;
      optionsMap.set(code, {
        value: code,
        id: code,
        code,
        name,
        label: `${code} — ${name}`,
      });
    }
  });

  return Array.from(optionsMap.values());
}

/**
 * Estrae e normalizza il reparto predefinito da un articolo (supportando defaultDepartmentId,
 * defaultDepartmentCode e i campi legacy department/reparto). Ritorna '' se non configurato.
 */
export function getArticleDefaultDepartment(
  article: (Partial<Article> & { reparto?: string | null }) | null | undefined,
  departments?: Department[]
): string {
  if (!article) return '';
  const candidate =
    article.defaultDepartmentId ??
    article.defaultDepartmentCode ??
    article.department ??
    article.reparto;
  return normalizeDepartmentCode(candidate, departments);
}

/**
 * Risolve il reparto da assegnare a una nuova commessa rispettando rigorosamente la priorità:
 * 1) Scelta esplicita utente / colonna Excel (override)
 * 2) Reparto predefinito configurato sull'anagrafica articolo
 * 3) Fallback legacy / di contesto
 */
export function resolveDepartmentForNewJob(params: {
  explicitDepartment?: string | null;
  article?: (Partial<Article> & { reparto?: string | null }) | null;
  departments?: Department[];
  fallback?: string;
}): string {
  const { explicitDepartment, article, departments, fallback = '' } = params;

  const normalizedExplicit = normalizeDepartmentCode(explicitDepartment, departments);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const articleDefault = getArticleDefaultDepartment(article, departments);
  if (articleDefault) {
    return articleDefault;
  }

  return normalizeDepartmentCode(fallback, departments) || fallback;
}
