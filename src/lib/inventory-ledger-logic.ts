import type {
  RawMaterial,
  RawMaterialBatch,
  MaterialWithdrawal,
  UnitOfMeasure,
  InventoryRecord,
  InventoryCountingSession,
} from '@/types';
import { hydrateMaterialWithWithdrawals } from './stock-logic';
import { parseRobustDate } from './utils';

export const VIRTUAL_SESSION_2025_ID = 'VIRTUAL_2025';
export const VIRTUAL_SESSION_FREE_2026_ID = 'VIRTUAL_FREE_2026';

export const normInventoryLot = (lotto?: string | null): string => {
  const trimmed = String(lotto ?? '').trim().toUpperCase();
  if (!trimmed) return 'SENZA_LOTTO';
  return trimmed;
};

/**
 * Infers a 4-digit year (e.g. 2025, 2026) from a lot code or DDT string
 * such as "123-25", "L04/26", "DDT-10/2026", etc.
 */
export function inferYearFromLotOrDdt(text?: string | null): number | null {
  if (!text) return null;
  const clean = String(text).trim().toUpperCase();
  if (!clean) return null;

  // Match explicit 4-digit year 2020..2039
  const fourDigitMatch = clean.match(/(?:^|[-/_. ])(20[2-3]\d)(?:$|[-/_. ])/);
  if (fourDigitMatch) {
    return parseInt(fourDigitMatch[1], 10);
  }

  // Match suffix like -25, /25, _25, -26, /26 at the end of the code
  const twoDigitSuffixMatch = clean.match(/[-/_.](2[0-9])$/);
  if (twoDigitSuffixMatch) {
    return 2000 + parseInt(twoDigitSuffixMatch[1], 10);
  }

  return null;
}

export function extractBatchLoadDateInfo(
  batch: Partial<RawMaterialBatch> & { createdAt?: any }
): { isoDate: string; year: number; isAdjustment: boolean } {
  const isAdjustment =
    batch.type === 'RETTIFICA_INVENTARIO' ||
    batch.type === 'RETTIFICA' ||
    String(batch.ddt ?? '').trim().toLowerCase() === 'inventario' ||
    String(batch.ddt ?? '').trim().toUpperCase() === 'RETTIFICA-INV';

  const parsed = parseRobustDate(batch.date || batch.createdAt);
  const inferredYear =
    inferYearFromLotOrDdt(batch.lotto) ?? inferYearFromLotOrDdt(batch.ddt);

  if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1975) {
    const dateYear = parsed.getFullYear();
    // If the batch is an old adjustment or its date conflicts with an explicit newer suffix like -26
    const effectiveYear =
      inferredYear && inferredYear > dateYear ? inferredYear : dateYear;
    return {
      isoDate: parsed.toISOString(),
      year: effectiveYear,
      isAdjustment,
    };
  }

  if (inferredYear) {
    return {
      isoDate: `${inferredYear}-01-01T00:00:00.000Z`,
      year: inferredYear,
      isAdjustment,
    };
  }

  return {
    isoDate: '',
    year: 2025,
    isAdjustment,
  };
}

export function toSafeFiniteNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toSafeUom(uom: unknown, fallback: UnitOfMeasure = 'kg'): UnitOfMeasure {
  if (uom === 'kg' || uom === 'mt' || uom === 'n') return uom;
  const lower = String(uom ?? '').trim().toLowerCase();
  if (lower === 'kg' || lower === 'mt' || lower === 'n') return lower as UnitOfMeasure;
  return fallback;
}

export interface AggregatedMaterialLot {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  uom: UnitOfMeasure;
  conversionFactor?: number | null;
  rapportoKgMt?: number | null;
  lotto: string;
  normLotto: string;
  initialUnits: number;
  theoreticalUnits: number;
  theoreticalWeightKg: number;
  tareWeight: number;
  tareName?: string;
  packagingId?: string;
  latestDate: string;
  lotLoadDate: string;
  lotLoadYear: number;
  ddt?: string;
  isExhausted: boolean;
  batchCount: number;
}

/**
 * Aggregates a hydrated material's batches by normalized lot code,
 * returning live SSoT theoretical stock, net weight, expected tare, and load date per lot.
 */
export function getAggregatedLotsForMaterial(
  rawMaterial: RawMaterial,
  withdrawals?: MaterialWithdrawal[]
): AggregatedMaterialLot[] {
  if (!rawMaterial || typeof rawMaterial !== 'object') return [];

  const hydrated = withdrawals
    ? hydrateMaterialWithWithdrawals(rawMaterial, withdrawals)
    : rawMaterial;

  const uom = toSafeUom(hydrated.unitOfMeasure, 'kg');
  const map = new Map<string, AggregatedMaterialLot>();
  const batches = Array.isArray(hydrated.batches) ? hydrated.batches : [];

  for (const batch of batches) {
    if (!batch || typeof batch !== 'object') continue;
    const normLotto = normInventoryLot(batch.lotto);
    const displayLotto = String(batch.lotto ?? '').trim() || 'SENZA_LOTTO';
    const currentUnits = toSafeFiniteNumber(batch.currentQuantity ?? batch.netQuantity, 0);
    const currentWeight = toSafeFiniteNumber(batch.currentWeightKg ?? batch.netQuantity, 0);
    const initialUnits = toSafeFiniteNumber(batch.netQuantity, 0);
    const batchTare = Math.max(0, toSafeFiniteNumber(batch.tareWeight, 0));
    const dateInfo = extractBatchLoadDateInfo(batch);

    const existing = map.get(normLotto);
    if (!existing) {
      map.set(normLotto, {
        materialId: hydrated.id || '',
        materialCode: hydrated.code || '',
        materialDescription: hydrated.description || '',
        uom,
        conversionFactor: hydrated.conversionFactor,
        rapportoKgMt: hydrated.rapportoKgMt,
        lotto: displayLotto,
        normLotto,
        initialUnits: Number(initialUnits.toFixed(4)),
        theoreticalUnits: Number(currentUnits.toFixed(4)),
        theoreticalWeightKg: Number(currentWeight.toFixed(4)),
        tareWeight: batchTare,
        tareName: batch.tareName,
        packagingId: batch.packagingId,
        latestDate: dateInfo.isoDate || batch.date || new Date(0).toISOString(),
        lotLoadDate: dateInfo.isoDate || batch.date || '',
        lotLoadYear: dateInfo.year,
        ddt: !dateInfo.isAdjustment && batch.ddt ? String(batch.ddt) : undefined,
        isExhausted: currentUnits <= 0.001,
        batchCount: 1,
      });
    } else {
      existing.initialUnits = Number((existing.initialUnits + initialUnits).toFixed(4));
      existing.theoreticalUnits = Number((existing.theoreticalUnits + currentUnits).toFixed(4));
      existing.theoreticalWeightKg = Number((existing.theoreticalWeightKg + currentWeight).toFixed(4));
      existing.batchCount += 1;
      existing.isExhausted = existing.theoreticalUnits <= 0.001;

      // Prefer original DDT load date (non-adjustment) for lotLoadDate
      if (!dateInfo.isAdjustment && dateInfo.isoDate) {
        if (!existing.lotLoadDate || dateInfo.isoDate < existing.lotLoadDate) {
          existing.lotLoadDate = dateInfo.isoDate;
        }
        if (!existing.ddt && batch.ddt) {
          existing.ddt = String(batch.ddt);
        }
      } else if (!existing.lotLoadDate && dateInfo.isoDate) {
        existing.lotLoadDate = dateInfo.isoDate;
      }

      if (dateInfo.year > existing.lotLoadYear && !dateInfo.isAdjustment) {
        existing.lotLoadYear = dateInfo.year;
      }

      const candidateLatest = dateInfo.isoDate || batch.date || '';
      if (candidateLatest >= existing.latestDate) {
        existing.latestDate = candidateLatest || existing.latestDate;
        if (batchTare > 0) {
          existing.tareWeight = batchTare;
          existing.tareName = batch.tareName;
          existing.packagingId = batch.packagingId;
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.isExhausted !== b.isExhausted) return a.isExhausted ? 1 : -1;
    return b.theoreticalUnits - a.theoreticalUnits;
  });
}

export interface ComputedInventoryMetrics {
  uom: UnitOfMeasure;
  countedUnits: number;
  theoreticalUnitsAtScan: number;
  deltaUnits: number;
  tareWeight: number;
  netWeight: number;
  grossWeight: number;
  hasNegativeNetWarning: boolean;
  isAnomaly: boolean;
  anomalyReason?: string;
}

/**
 * Computes universal inventory metrics (countedUnits in base UoM, netWeight, grossWeight, deltaUnits).
 * Never throws during read/hydration:
 * - If inputQuantity <= 0 (e.g. exhausted lot = 0 even with tare selected), netWeight and grossWeight are 0.
 * - If grossWeight - safeTare < -0.001, clamps netWeight to 0 and sets hasNegativeNetWarning/isAnomaly flags.
 */
export function computeInventoryMetrics(params: {
  material?: Partial<Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>> | null;
  inputQuantity: number;
  inputUnit: UnitOfMeasure;
  tareWeight: number;
  theoreticalUnitsAtScan: number;
}): ComputedInventoryMetrics {
  const { material, inputQuantity, inputUnit, tareWeight, theoreticalUnitsAtScan } = params;
  const uom = toSafeUom(material?.unitOfMeasure, toSafeUom(inputUnit, 'kg'));
  const normalizedInputUnit = toSafeUom(inputUnit, uom);

  const rawInputQty = toSafeFiniteNumber(inputQuantity, 0);
  const safeInputQty = Math.max(0, rawInputQty);
  const safeTare = Math.max(0, toSafeFiniteNumber(tareWeight, 0));
  const safeTheoretical = Number(toSafeFiniteNumber(theoreticalUnitsAtScan, 0).toFixed(4));

  // Explicit 0 handling: declaring a lot physically exhausted (0 stock), even if tare is selected
  if (safeInputQty === 0) {
    const isNegativeInput = rawInputQty < -0.001;
    return {
      uom,
      countedUnits: 0,
      theoreticalUnitsAtScan: safeTheoretical,
      deltaUnits: Number((0 - safeTheoretical).toFixed(4)),
      tareWeight: Number(safeTare.toFixed(4)),
      netWeight: 0,
      grossWeight: 0,
      hasNegativeNetWarning: isNegativeInput,
      isAnomaly: isNegativeInput,
      ...(isNegativeInput ? { anomalyReason: 'Quantità rilevata negativa' } : {}),
    };
  }

  const rawFactorMt = toSafeFiniteNumber(material?.rapportoKgMt || material?.conversionFactor, 0);
  const rawFactorN = toSafeFiniteNumber(material?.conversionFactor, 0);

  let netWeight = 0;
  let grossWeight = 0;
  let countedUnits = 0;
  let hasNegativeNetWarning = false;
  let isAnomaly = false;
  let anomalyReason: string | undefined = undefined;

  if (normalizedInputUnit === 'kg') {
    grossWeight = safeInputQty;
    const rawNetWeight = grossWeight - safeTare;
    if (rawNetWeight < -0.001) {
      hasNegativeNetWarning = true;
      isAnomaly = true;
      anomalyReason = 'Tara superiore al peso lordo';
    }
    netWeight = Math.max(0, rawNetWeight);

    if (uom === 'kg') {
      countedUnits = netWeight;
    } else if (uom === 'mt') {
      const factor = rawFactorMt > 0 ? rawFactorMt : 1;
      countedUnits = netWeight / factor;
    } else {
      // uom === 'n'
      const factor = rawFactorN > 0 ? rawFactorN : 1;
      countedUnits = netWeight / factor;
    }
  } else {
    // normalizedInputUnit is 'mt' or 'n'
    const rawFactor = normalizedInputUnit === 'mt' ? rawFactorMt : rawFactorN;
    // Fix Bug UdM: if factor is missing/0 on N or MT articles, fallback to 1 so netWeight is never 0
    const effectiveWeightFactor = rawFactor > 0 ? rawFactor : 1;

    netWeight = safeInputQty * effectiveWeightFactor;
    grossWeight = netWeight + safeTare;

    if (normalizedInputUnit === uom) {
      countedUnits = safeInputQty;
    } else if (uom === 'kg') {
      countedUnits = netWeight;
    } else if (uom === 'mt') {
      const targetFactor = rawFactorMt > 0 ? rawFactorMt : 1;
      countedUnits = netWeight / targetFactor;
    } else {
      const targetFactor = rawFactorN > 0 ? rawFactorN : 1;
      countedUnits = netWeight / targetFactor;
    }
  }

  const finalCountedUnits = Number(toSafeFiniteNumber(countedUnits, 0).toFixed(4));
  const finalDeltaUnits = Number((finalCountedUnits - safeTheoretical).toFixed(4));

  return {
    uom,
    countedUnits: finalCountedUnits,
    theoreticalUnitsAtScan: safeTheoretical,
    deltaUnits: finalDeltaUnits,
    tareWeight: Number(safeTare.toFixed(4)),
    netWeight: Number(toSafeFiniteNumber(netWeight, 0).toFixed(4)),
    grossWeight: Number(toSafeFiniteNumber(grossWeight, 0).toFixed(4)),
    hasNegativeNetWarning,
    isAnomaly,
    ...(anomalyReason ? { anomalyReason } : {}),
  };
}

/**
 * Safely resolves all metrics and anomaly flags for a historical or new InventoryRecord.
 * Never throws on malformed, NaN, null, or negative historical values.
 */
export function resolveRecordMetrics(
  record: Partial<InventoryRecord> | null | undefined,
  material?: Partial<Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>> | null
): ComputedInventoryMetrics {
  const safeRecord = record || {};
  const uom = toSafeUom(
    safeRecord.uom ||
      safeRecord.materialUnitOfMeasure ||
      material?.unitOfMeasure ||
      safeRecord.inputUnit,
    'kg'
  );
  const inputUnit = toSafeUom(safeRecord.inputUnit, uom);

  const hasExplicitInputQty =
    safeRecord.inputQuantity !== undefined &&
    safeRecord.inputQuantity !== null &&
    String(safeRecord.inputQuantity).trim() !== '';

  const fallbackInputQty = hasExplicitInputQty
    ? toSafeFiniteNumber(safeRecord.inputQuantity, 0)
    : toSafeFiniteNumber(safeRecord.grossWeight ?? safeRecord.netWeight, 0);

  const computed = computeInventoryMetrics({
    material: {
      unitOfMeasure: uom,
      conversionFactor: material?.conversionFactor ?? safeRecord.conversionFactor,
      rapportoKgMt: material?.rapportoKgMt ?? safeRecord.rapportoKgMt,
    },
    inputQuantity: fallbackInputQty,
    inputUnit,
    tareWeight: toSafeFiniteNumber(safeRecord.tareWeight, 0),
    theoreticalUnitsAtScan: toSafeFiniteNumber(safeRecord.theoreticalUnitsAtScan, 0),
  });

  // Check if historical stored netWeight was explicitly negative or gross < tare
  const storedGross = toSafeFiniteNumber(safeRecord.grossWeight, 0);
  const storedTare = toSafeFiniteNumber(safeRecord.tareWeight, 0);
  const storedNet = toSafeFiniteNumber(safeRecord.netWeight, 0);

  let isAnomaly = computed.isAnomaly;
  let hasNegativeNetWarning = computed.hasNegativeNetWarning;
  let anomalyReason = computed.anomalyReason;

  if (storedNet < -0.001 || (storedGross > 0 && storedGross - storedTare < -0.001)) {
    isAnomaly = true;
    hasNegativeNetWarning = true;
    anomalyReason = anomalyReason || 'Tara superiore al peso lordo';
  }

  const hasValidExplicitCounted =
    typeof safeRecord.countedUnits === 'number' &&
    Number.isFinite(safeRecord.countedUnits) &&
    safeRecord.countedUnits >= 0;

  const finalCountedUnits = hasValidExplicitCounted
    ? Number(safeRecord.countedUnits!.toFixed(4))
    : computed.countedUnits;

  const finalNetWeight =
    storedNet > 0 && computed.netWeight === 0 && !hasExplicitInputQty
      ? Number(storedNet.toFixed(4))
      : computed.netWeight;

  return {
    ...computed,
    uom,
    countedUnits: finalCountedUnits,
    netWeight: Math.max(0, finalNetWeight),
    isAnomaly,
    hasNegativeNetWarning,
    ...(anomalyReason ? { anomalyReason } : {}),
  };
}

/**
 * Extracts countedUnits in the material's native UoM from an InventoryRecord,
 * supporting both FASE 74 records (with explicit countedUnits) and legacy records.
 */
export function resolveRecordCountedUnits(
  record: Partial<InventoryRecord>,
  material?: Partial<Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>> | null
): number {
  return resolveRecordMetrics(record, material).countedUnits;
}

/**
 * Converts a delta in native material units to weight in KG.
 */
export function convertUnitsToWeightKg(
  units: number,
  material?: Partial<Pick<RawMaterial, 'unitOfMeasure' | 'conversionFactor' | 'rapportoKgMt'>> | null
): number {
  const absUnits = Math.abs(toSafeFiniteNumber(units, 0));
  const uom = toSafeUom(material?.unitOfMeasure, 'kg');
  if (uom === 'kg') {
    return Number(absUnits.toFixed(4));
  }
  if (uom === 'mt') {
    const factor = toSafeFiniteNumber(material?.rapportoKgMt || material?.conversionFactor, 1);
    return Number((absUnits * (factor > 0 ? factor : 1)).toFixed(4));
  }
  const factor = toSafeFiniteNumber(material?.conversionFactor, 1);
  return Number((absUnits * (factor > 0 ? factor : 1)).toFixed(4));
}

export type LotSessionScanStatus =
  | 'SCANNED_PENDING'
  | 'SCANNED_APPROVED'
  | 'UNSCANNED'
  | 'POST_INVENTORY';

export type LotTemporalStatus =
  | 'PRE_EXISTING'
  | 'POST_SESSION_OPENED'
  | 'POST_SESSION_CLOSED';

export interface EvaluatedSessionLotItem<TRecord = InventoryRecord> extends AggregatedMaterialLot {
  scanStatus: LotSessionScanStatus;
  lotTemporalStatus: LotTemporalStatus;
  latestRecord?: TRecord | null;
}

/**
 * Resolves the canonical sessionId for any InventoryRecord (explicit or legacy).
 * Legacy records without `sessionId`:
 * - Recorded in <= 2025 -> 'VIRTUAL_2025' ("Storico Inventario 2025")
 * - Recorded in >= 2026 -> 'VIRTUAL_FREE_2026' ("Rilevazioni Libere 2026")
 */
export function resolveRecordSessionId(record?: Partial<InventoryRecord> | null): string {
  if (!record) return VIRTUAL_SESSION_2025_ID;
  const explicitId = String(record.sessionId ?? '').trim();
  if (explicitId) return explicitId;

  const parsedDate = parseRobustDate(record.recordedAt);
  if (parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 1975) {
    return parsedDate.getFullYear() <= 2025
      ? VIRTUAL_SESSION_2025_ID
      : VIRTUAL_SESSION_FREE_2026_ID;
  }

  const inferredYear = inferYearFromLotOrDdt(record.lotto);
  if (inferredYear && inferredYear >= 2026) {
    return VIRTUAL_SESSION_FREE_2026_ID;
  }

  return VIRTUAL_SESSION_2025_ID;
}

/**
 * Checks whether an InventoryRecord belongs to the specified InventoryCountingSession.
 */
export function doesRecordBelongToSession(
  record: Partial<InventoryRecord> | null | undefined,
  session: InventoryCountingSession
): boolean {
  if (!record || !session) return false;
  const resolvedId = resolveRecordSessionId(record);

  if (session.id === VIRTUAL_SESSION_2025_ID || session.id === VIRTUAL_SESSION_FREE_2026_ID) {
    return resolvedId === session.id;
  }

  if (resolvedId === session.id) {
    return true;
  }

  // Fallback for records without an explicit sessionId that fall strictly inside the real session's time window
  const hasExplicitSession = Boolean(String(record.sessionId ?? '').trim());
  if (!hasExplicitSession && session.openedAt) {
    const recDate = parseRobustDate(record.recordedAt);
    const openDate = parseRobustDate(session.openedAt);
    const closeDate = session.closedAt ? parseRobustDate(session.closedAt) : null;
    if (recDate && openDate && recDate.getTime() >= openDate.getTime()) {
      if (!closeDate || recDate.getTime() <= closeDate.getTime()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Evaluates all active lots and scan records against a chosen InventoryCountingSession:
 * 1. Filters records belonging to the selected session (plus optional pending records from previous sessions for Tab 2).
 * 2. Matches each active lot ONLY against records of the selected session.
 * 3. Determines `lotTemporalStatus` using the lot's creation/load date (`lotLoadDate` / `lotLoadYear`) vs the session window:
 *    - When viewing a closed/historical session (e.g. "Storico Inventario 2025"), lots loaded AFTER the session closed (e.g. 2026 lots / -26 suffix)
 *      are marked `lotTemporalStatus: 'POST_SESSION_CLOSED'` and `scanStatus: 'POST_INVENTORY'` ("Caricato dopo l'inventario") and EXCLUDED from `unscannedLots` (Fantasmi).
 *    - When viewing an open session, lots loaded AFTER `session.openedAt` are marked `lotTemporalStatus: 'POST_SESSION_OPENED'`
 *      so the Admin can distinguish new DDT arrivals during the count from pre-existing lots (`'PRE_EXISTING'`).
 */
export function evaluateLotsForInventorySession<
  TRecord extends Partial<InventoryRecord> & { id: string }
>(params: {
  baseLots: AggregatedMaterialLot[];
  records: TRecord[];
  session: InventoryCountingSession;
  includePreviousPending?: boolean;
}): {
  allActiveLots: EvaluatedSessionLotItem<TRecord>[];
  unscannedLots: EvaluatedSessionLotItem<TRecord>[];
  sessionRecords: TRecord[];
  recordsForTab2: TRecord[];
} {
  const { baseLots, records, session, includePreviousPending = false } = params;

  const sessionRecords = records.filter((r) => doesRecordBelongToSession(r, session));

  const recordsForTab2 = includePreviousPending
    ? records.filter(
        (r) =>
          doesRecordBelongToSession(r, session) ||
          r.status === 'pending'
      )
    : sessionRecords;

  // Build map of latest non-rejected record per (materialId::normLotto) and (materialCode::normLotto) within the selected session
  const latestSessionRecordByMatIdKey = new Map<string, TRecord>();
  const latestSessionRecordByMatCodeKey = new Map<string, TRecord>();

  for (const rec of sessionRecords) {
    if (rec.status === 'rejected') continue;
    const normLot = normInventoryLot(rec.lotto);
    const recTime = parseRobustDate(rec.recordedAt)?.getTime() ?? 0;

    if (rec.materialId) {
      const idKey = `${rec.materialId}::${normLot}`;
      const existing = latestSessionRecordByMatIdKey.get(idKey);
      if (!existing || recTime > (parseRobustDate(existing.recordedAt)?.getTime() ?? 0)) {
        latestSessionRecordByMatIdKey.set(idKey, rec);
      }
    }

    if (rec.materialCode) {
      const codeKey = `${String(rec.materialCode).trim().toUpperCase()}::${normLot}`;
      const existing = latestSessionRecordByMatCodeKey.get(codeKey);
      if (!existing || recTime > (parseRobustDate(existing.recordedAt)?.getTime() ?? 0)) {
        latestSessionRecordByMatCodeKey.set(codeKey, rec);
      }
    }
  }

  const sessionOpenedMs = session.openedAt ? (parseRobustDate(session.openedAt)?.getTime() ?? null) : null;
  const sessionClosedMs = session.closedAt ? (parseRobustDate(session.closedAt)?.getTime() ?? null) : null;

  const allActiveLots: EvaluatedSessionLotItem<TRecord>[] = baseLots.map((lot) => {
    const idKey = `${lot.materialId}::${lot.normLotto}`;
    const codeKey = `${String(lot.materialCode || '').trim().toUpperCase()}::${lot.normLotto}`;
    const latestRec =
      latestSessionRecordByMatIdKey.get(idKey) ||
      latestSessionRecordByMatCodeKey.get(codeKey) ||
      null;

    const lotDateMs = lot.lotLoadDate ? (parseRobustDate(lot.lotLoadDate)?.getTime() ?? null) : null;
    const lotYear = lot.lotLoadYear || (lotDateMs ? new Date(lotDateMs).getFullYear() : 2025);

    let lotTemporalStatus: LotTemporalStatus = 'PRE_EXISTING';

    if (session.status === 'closed') {
      const isAfterSessionYear = lotYear > session.year;
      const isAfterClosedTimestamp =
        lotDateMs !== null && sessionClosedMs !== null && lotDateMs > sessionClosedMs;
      if (isAfterSessionYear || isAfterClosedTimestamp) {
        lotTemporalStatus = 'POST_SESSION_CLOSED';
      }
    } else {
      // Open session
      const isAfterOpenedTimestamp =
        !session.isVirtual &&
        lotDateMs !== null &&
        sessionOpenedMs !== null &&
        lotDateMs > sessionOpenedMs;
      const isAfterSessionYear = lotYear > session.year;
      if (isAfterOpenedTimestamp || isAfterSessionYear) {
        lotTemporalStatus = 'POST_SESSION_OPENED';
      }
    }

    let scanStatus: LotSessionScanStatus = 'UNSCANNED';
    if (latestRec) {
      scanStatus = latestRec.status === 'approved' ? 'SCANNED_APPROVED' : 'SCANNED_PENDING';
    } else if (lotTemporalStatus === 'POST_SESSION_CLOSED') {
      // Lot was loaded AFTER this closed inventory session ended -> NOT a ghost of that session!
      scanStatus = 'POST_INVENTORY';
    }

    return {
      ...lot,
      scanStatus,
      lotTemporalStatus,
      latestRecord: latestRec,
    };
  });

  // Tab 3 ("Caccia ai Fantasmi"): only lots with theoreticalUnits > 0.001 AND scanStatus === 'UNSCANNED'
  // (Automatically excludes 'POST_INVENTORY' lots loaded after a closed session!)
  const unscannedLots = allActiveLots.filter(
    (item) => item.theoreticalUnits > 0.001 && item.scanStatus === 'UNSCANNED'
  );

  return {
    allActiveLots,
    unscannedLots,
    sessionRecords,
    recordsForTab2,
  };
}


