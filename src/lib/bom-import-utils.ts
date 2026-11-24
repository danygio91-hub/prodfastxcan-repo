import * as z from 'zod';
import type { Article, BillOfMaterialsItem } from '@/types';

/**
 * Normalizza un valore opzionale per `lunghezzaTaglioMm` nei form e nelle Server Action (Zod).
 * - `""`, `null`, `undefined`, `0`, `"0"` -> `undefined` (MAI coerciti silenziosamente a `0`).
 * - Stringhe numeriche con virgola decimale (es. `"82,5"`) -> `82.5`.
 */
export function normalizeOptionalCutLengthMm(raw: unknown): unknown {
    if (raw === null || raw === undefined || raw === '') {
        return undefined;
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw === 0) return undefined;
        return raw;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        const normalized = trimmed.replace(',', '.');
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return raw;
        if (parsed === 0) return undefined;
        return parsed;
    }
    return raw;
}

export const optionalCutLengthMmSchema = z.preprocess(
    normalizeOptionalCutLengthMm,
    z.number().positive('La lunghezza di taglio deve essere maggiore di 0.').optional().nullable()
);

/**
 * Normalizza la percentuale di scarto opzionale per righe BOM (usata in UI e Excel import).
 * - `""`, `null`, `undefined` -> `undefined`
 * - Stringhe con `%` o virgola (es. `"5%"`, `"5,5"`) -> numero `>= 0`
 */
export function normalizeOptionalScrapPercentage(raw: unknown): unknown {
    if (raw === null || raw === undefined || raw === '') {
        return undefined;
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw < 0) return raw;
        return raw;
    }
    if (typeof raw === 'string') {
        const cleaned = raw.trim().replace(/%$/, '').trim().replace(',', '.');
        if (!cleaned) return undefined;
        const parsed = Number(cleaned);
        if (!Number.isFinite(parsed)) return raw;
        return parsed;
    }
    return raw;
}

export const optionalScrapPercentageSchema = z.preprocess(
    normalizeOptionalScrapPercentage,
    z.number().min(0, 'Lo scarto (%) non può essere negativo.').optional().nullable()
);

export interface StrictCutLengthParseResult {
    lengthMm?: number;
    noteFromCutField?: string;
    isAmbiguousThousands?: boolean;
}

/**
 * Parser rigoroso per il campo `L. Taglio (mm)` / `Lunghezza Taglio (mm)` / `Numero/Misura`
 * durante l'importazione Excel BOM.
 * - Accetta valori numerici puri (`82`, `82.5`, `"82,5"`, `"82 mm"`, `"82,5mm"`).
 * - Riconosce il formato italiano con punto separatore delle migliaia (`"1.500"` -> `1500`).
 * - Rifiuta stringhe miste alfanumeriche o note tecniche (`"45° TAGLIO OBLIQUO"`, `"10X2"`, `"2 VIE"`),
 *   dirottandole in `noteFromCutField` senza mai estrarre il prefisso numerico tramite `parseFloat`.
 */
export function parseStrictCutLengthMm(raw: unknown): StrictCutLengthParseResult {
    if (raw === null || raw === undefined || raw === '') {
        return { lengthMm: undefined };
    }

    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw <= 0) {
            return { lengthMm: undefined };
        }
        return { lengthMm: raw };
    }

    const originalStr = String(raw).trim();
    if (!originalStr) {
        return { lengthMm: undefined };
    }

    // Rimuove suffisso opzionale "mm" solo se preceduto da cifre/separatori numerici puri
    const mmMatch = originalStr.match(/^([+-]?\d+(?:[.,]\d+)*)\s*mm$/i);
    const candidate = mmMatch ? mmMatch[1].trim() : originalStr;

    // Caso 1: Formato migliaia italiano esplicito (es. "1.500", "12.000")
    if (/^\d{1,3}(\.\d{3})+$/.test(candidate)) {
        const parsedThousands = Number(candidate.replace(/\./g, ''));
        if (Number.isFinite(parsedThousands) && parsedThousands > 0) {
            return {
                lengthMm: parsedThousands,
                isAmbiguousThousands: true,
            };
        }
        return { lengthMm: undefined };
    }

    // Caso 2: Numero intero o decimale puro con punto o virgola (es. "82", "120,5", "120.5")
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(candidate)) {
        const parsed = Number(candidate.replace(',', '.'));
        if (Number.isFinite(parsed) && parsed > 0) {
            return { lengthMm: parsed };
        }
        return { lengthMm: undefined };
    }

    // Caso 3: Stringa mista o nota tecnica (es. "45° TAGLIO OBLIQUO", "10X2") -> dirottata su note
    return {
        lengthMm: undefined,
        noteFromCutField: originalStr,
    };
}

function getRowFieldByAliases(row: Record<string, any>, aliases: string[]): unknown {
    const rowKeys = Object.keys(row);
    for (const alias of aliases) {
        if (row[alias] !== undefined) return row[alias];
        const lowerAlias = alias.toLowerCase().trim();
        const matchedKey = rowKeys.find((k) => k.toLowerCase().trim() === lowerAlias);
        if (matchedKey !== undefined && row[matchedKey] !== undefined) {
            return row[matchedKey];
        }
    }
    return undefined;
}

function parseFlexiblePositiveNumber(raw: unknown): number {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : 0;
    }
    if (typeof raw === 'string') {
        const clean = raw.trim().replace(',', '.');
        const num = Number(clean);
        return Number.isFinite(num) ? num : 0;
    }
    return 0;
}

/**
 * Converte le righe grezze di un foglio Excel BOM in una lista di articoli con `billOfMaterials`,
 * supportando tutti gli alias di intestazione (inclusi quelli generati da "Esporta BOM Flat").
 */
export function parseExcelBomRows(rows: Record<string, any>[]): Omit<Article, 'id'>[] {
    const articlesMap: Record<string, Omit<Article, 'id'>> = {};

    const ARTICLE_CODE_ALIASES = ['Articolo Padre', 'Codice Articolo', 'Articolo', 'Codice'];
    const COMPONENT_ALIASES = ['Componente', 'Codice Componente'];
    const QUANTITY_ALIASES = ['Q.tà per Pz', 'Quantità per Pz', 'Qta per Pz', 'Q.ta per Pz', 'Quantità'];
    const CUT_LENGTH_ALIASES = ['L. Taglio (mm)', 'Lunghezza Taglio (mm)', 'L. Taglio', 'Lunghezza Taglio', 'Numero/Misura'];
    const UNIT_ALIASES = ['Unità di Misura', 'UOM', 'UM', 'Unità'];
    const NOTE_ALIASES = ['Note', 'Nota'];
    const SCRAP_ALIASES = ['Scarto (%)', 'Scarto %', 'Scarto', 'Scrap (%)', 'Scrap'];

    for (const row of rows || []) {
        const rawArtCode = getRowFieldByAliases(row, ARTICLE_CODE_ALIASES);
        const rawComponent = getRowFieldByAliases(row, COMPONENT_ALIASES);
        const rawQty = getRowFieldByAliases(row, QUANTITY_ALIASES);

        const articleCode = String(rawArtCode ?? '').trim().toUpperCase();
        const componentFull = String(rawComponent ?? '').trim().toUpperCase();
        const component = componentFull.split(/\s+/)[0] || '';
        const quantity = parseFlexiblePositiveNumber(rawQty);

        if (!articleCode || !component) continue;

        if (!articlesMap[articleCode]) {
            articlesMap[articleCode] = {
                code: articleCode,
                billOfMaterials: [],
            };
        }

        const rawUnit = getRowFieldByAliases(row, UNIT_ALIASES);
        const cleanUnitStr = rawUnit !== undefined && rawUnit !== null ? String(rawUnit).trim().toLowerCase() : '';
        const explicitUnit: 'n' | 'mt' | 'kg' | undefined =
            cleanUnitStr === 'mt' || cleanUnitStr === 'm'
                ? 'mt'
                : cleanUnitStr === 'kg'
                  ? 'kg'
                  : cleanUnitStr === 'n' || cleanUnitStr === 'pz' || cleanUnitStr === 'nr'
                    ? 'n'
                    : undefined;

        const rawCut = getRowFieldByAliases(row, CUT_LENGTH_ALIASES);
        const cutParsed = parseStrictCutLengthMm(rawCut);

        const rawNote = getRowFieldByAliases(row, NOTE_ALIASES);
        const explicitNote = rawNote !== undefined && rawNote !== null ? String(rawNote).trim() : '';
        const mergedNote = [explicitNote, cutParsed.noteFromCutField].filter(Boolean).join(' - ');

        const bomItem: BillOfMaterialsItem & { _hasExplicitUnit?: boolean } = {
            component,
            unit: explicitUnit || 'n',
            quantity: quantity > 0 ? quantity : 1,
        };

        const rawScrap = getRowFieldByAliases(row, SCRAP_ALIASES);
        const normalizedScrap = normalizeOptionalScrapPercentage(rawScrap);
        if (typeof normalizedScrap === 'number' && Number.isFinite(normalizedScrap) && normalizedScrap > 0) {
            bomItem.scrapPercentage = normalizedScrap;
        }

        if (explicitUnit) {
            bomItem._hasExplicitUnit = true;
        }
        if (cutParsed.lengthMm !== undefined) {
            bomItem.lunghezzaTaglioMm = cutParsed.lengthMm;
        }
        if (mergedNote) {
            bomItem.note = mergedNote;
        }

        articlesMap[articleCode].billOfMaterials.push(bomItem);
    }

    return Object.values(articlesMap);
}

/**
 * Helper SSoT per unire la commessa fresca letta dal server (`getOdlPrintData`) con la commessa locale in memoria UI.
 * I campi di verità (`billOfMaterials`, `qta`, `details`, `workCycleId`, `note`, `technicalNotes`, `technicalDrawingUrl`, `phases`)
 * provengono SEMPRE da `serverJob` quando disponibile, usando `localJob` solo come fallback se `serverJob` è assente.
 */
export function mergeServerAndLocalJobForOdlPrint<
    T extends {
        id: string;
        billOfMaterials?: any[];
        externalizedMaterials?: string[];
    }
>(localJob: T, serverJob?: T | null, resolvedExternalizedMaterials?: string[]): T {
    const extList =
        resolvedExternalizedMaterials ??
        serverJob?.externalizedMaterials ??
        localJob.externalizedMaterials ??
        [];

    if (!serverJob) {
        return {
            ...localJob,
            externalizedMaterials: extList,
        };
    }

    const serverBom = Array.isArray(serverJob.billOfMaterials) ? serverJob.billOfMaterials : [];
    const localBom = Array.isArray(localJob.billOfMaterials) ? localJob.billOfMaterials : [];

    return {
        ...localJob,
        ...serverJob,
        externalizedMaterials: extList,
        billOfMaterials: serverBom.length > 0 ? serverBom : localBom,
    };
}

