/**
 * FASE 84: Logica Pura per Numeratore Automatico ODL ([PROGRESSIVO]-[ANNO], es. 2621-26)
 * e distinzione da formati manuali custom (es. RG.1).
 */

export const STANDARD_ODL_REGEX = /^(\d+)-(\d{2})$/;

export interface ParsedStandardOdl {
  progressive: number;
  yearTwoDigits: number;
  yearStr: string;
  rawMatched: string;
}

/**
 * Verifica se una stringa ODL rispetta il formato standard `[PROGRESSIVO]-[ANNO]` (es. "2621-26").
 * Restituisce i componenti estratti oppure `null` se si tratta di un formato custom (es. "RG.1").
 */
export function parseStandardOdl(odlStr?: string | null): ParsedStandardOdl | null {
  if (!odlStr) return null;
  const trimmed = String(odlStr).trim();
  const match = trimmed.match(STANDARD_ODL_REGEX);
  if (!match) return null;

  const progressive = parseInt(match[1], 10);
  const yearTwoDigits = parseInt(match[2], 10);
  if (isNaN(progressive) || isNaN(yearTwoDigits) || progressive < 0) {
    return null;
  }

  return {
    progressive,
    yearTwoDigits,
    yearStr: match[2],
    rawMatched: trimmed,
  };
}

/**
 * Formatta un numero progressivo e l'anno a 2 cifre nel formato standard `[PROGRESSIVO]-[ANNO]` (es. "2622-26").
 */
export function formatStandardOdl(progressive: number, yearTwoDigits: number | string): string {
  const safeProg = Math.max(1, Math.floor(Number(progressive) || 1));
  const yearStr = String(yearTwoDigits).trim().slice(-2).padStart(2, '0');
  return `${safeProg}-${yearStr}`;
}

/**
 * Estrae il progressivo massimo da una lista di valori `numeroODL` / `numeroODLInterno`
 * filtrando esclusivamente quelli che rispettano la regex standard `/^(\d+)-(\d{2})$/`.
 */
export function extractMaxStandardOdl(
  candidates: Array<string | null | undefined>,
  targetYearTwoDigits?: number
): { maxProgressive: number; yearTwoDigits: number } {
  const defaultYear =
    targetYearTwoDigits ?? parseInt(new Date().getFullYear().toString().slice(-2), 10);

  let maxProgressive = 0;
  let matchedYear = defaultYear;

  for (const raw of candidates) {
    const parsed = parseStandardOdl(raw);
    if (!parsed) continue;
    if (targetYearTwoDigits !== undefined && parsed.yearTwoDigits !== targetYearTwoDigits) {
      continue;
    }
    if (parsed.progressive > maxProgressive) {
      maxProgressive = parsed.progressive;
      matchedYear = parsed.yearTwoDigits;
    }
  }

  return {
    maxProgressive,
    yearTwoDigits: matchedYear,
  };
}

/**
 * Dato lo stato del documento `settings/numerators` (`lastOdlNumber`, `lastOdlYear`),
 * restituisce il prossimo ODL standard proposto (es. "2622-26").
 */
export function computeNextStandardOdl(
  lastOdlNumber?: number | null,
  lastOdlYear?: number | null,
  currentYearTwoDigits?: number
): { nextOdl: string; nextProgressive: number; yearTwoDigits: number } {
  const targetYear =
    currentYearTwoDigits ??
    (typeof lastOdlYear === 'number' && !isNaN(lastOdlYear) && lastOdlYear > 0
      ? lastOdlYear
      : parseInt(new Date().getFullYear().toString().slice(-2), 10));

  const baseNumber =
    typeof lastOdlNumber === 'number' && !isNaN(lastOdlNumber) && lastOdlNumber >= 0
      ? lastOdlNumber
      : 0;

  // Se l'anno corrente coincide con lastOdlYear (o lastOdlYear non era impostato), incrementa lastOdlNumber
  const effectiveBase =
    lastOdlYear === undefined || lastOdlYear === null || lastOdlYear === targetYear
      ? baseNumber
      : 0;

  const nextProgressive = effectiveBase + 1;
  return {
    nextOdl: formatStandardOdl(nextProgressive, targetYear),
    nextProgressive,
    yearTwoDigits: targetYear,
  };
}

