'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import {
  VIRTUAL_SESSION_2025_ID,
  VIRTUAL_SESSION_FREE_2026_ID,
  convertUnitsToWeightKg,
  doesRecordBelongToSession,
  evaluateLotsForInventorySession,
  getAggregatedLotsForMaterial,
  normInventoryLot,
  resolveRecordCountedUnits,
  resolveRecordMetrics,
  resolveRecordSessionId,
  toSafeFiniteNumber,
  toSafeUom,
  type AggregatedMaterialLot,
  type LotSessionScanStatus,
  type LotTemporalStatus,
} from '@/lib/inventory-ledger-logic';
import type {
  InventoryCountingSession,
  InventoryRecord,
  MaterialWithdrawal,
  RawMaterial,
  RawMaterialBatch,
  UnitOfMeasure,
} from '@/types';

function convertTimestamps(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  }
  if (typeof obj.toDate === 'function') {
    try {
      const d = obj.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    } catch {
      return null;
    }
  }
  if (typeof obj._seconds === 'number') {
    return new Date(obj._seconds * 1000).toISOString();
  }
  if (typeof obj.seconds === 'number') {
    return new Date(obj.seconds * 1000).toISOString();
  }
  if (Array.isArray(obj)) return obj.map(convertTimestamps);
  const res: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    res[k] = convertTimestamps(obj[k]);
  }
  return res;
}

export interface EnrichedLedgerInventoryRecord extends InventoryRecord {
  materialDescription: string;
  uom: UnitOfMeasure;
  countedUnits: number;
  liveTheoreticalUnits: number;
  liveDeltaUnits: number;
  resolvedSessionId: string;
  lotLoadDate?: string;
  lotLoadYear?: number;
  isAnomaly?: boolean;
  anomalyReason?: string;
  hasNegativeNetWarning?: boolean;
}

export interface LedgerLotCheckoffItem extends AggregatedMaterialLot {
  scanStatus: LotSessionScanStatus;
  lotTemporalStatus: LotTemporalStatus;
  latestRecord?: EnrichedLedgerInventoryRecord | null;
}

export interface InventoryLedgerPageData {
  sessions: InventoryCountingSession[];
  defaultSessionId: string;
  baseLots: AggregatedMaterialLot[];
  allActiveLots: LedgerLotCheckoffItem[];
  unscannedLots: LedgerLotCheckoffItem[];
  records: EnrichedLedgerInventoryRecord[];
}

/**
 * Loads the complete SSoT Inventory Ledger state:
 * 1. All active lots across all materials (hydrated via hydrateMaterialWithWithdrawals)
 * 2. All operator scan records enriched with live SSoT theoretical stock, delta, and resolvedSessionId
 * 3. Counting sessions (real Firestore sessions + virtual 2025 / Free 2026 sessions)
 * 4. Initial evaluation of active lots and unscanned lots for the default session
 * Never throws on dirty/malformed historical records; isolates anomalies to individual rows.
 */
export async function getInventoryLedgerData(): Promise<InventoryLedgerPageData> {
  try {
    const [materialsSnap, withdrawalsSnap, recordsSnap, sessionsSnap] = await Promise.all([
      adminDb.collection('rawMaterials').get(),
      adminDb.collection('materialWithdrawals').get(),
      adminDb.collection('inventoryRecords').orderBy('recordedAt', 'desc').get(),
      adminDb
        .collection('inventoryCountingSessions')
        .get()
        .catch(() => null),
    ]);

    const withdrawalsByMaterial = new Map<string, MaterialWithdrawal[]>();
    withdrawalsSnap.docs.forEach((doc) => {
      try {
        const data = doc.data() as MaterialWithdrawal;
        if (!data || !data.materialId) return;
        const list = withdrawalsByMaterial.get(data.materialId) || [];
        list.push({ ...data, id: doc.id });
        withdrawalsByMaterial.set(data.materialId, list);
      } catch {
        // Ignore single malformed withdrawal doc
      }
    });

    const hydratedMaterialsMap = new Map<string, RawMaterial>();
    const lotMapByMaterialAndNormLot = new Map<string, AggregatedMaterialLot>();

    for (const doc of materialsSnap.docs) {
      try {
        const raw = { ...(doc.data() as RawMaterial), id: doc.id };
        const matWithdrawals = withdrawalsByMaterial.get(raw.id) || [];
        const hydrated = hydrateMaterialWithWithdrawals(raw, matWithdrawals);
        hydratedMaterialsMap.set(raw.id, hydrated);

        const lots = getAggregatedLotsForMaterial(hydrated);
        for (const lot of lots) {
          lotMapByMaterialAndNormLot.set(`${raw.id}::${lot.normLotto}`, lot);
        }
      } catch {
        // Isolate malformed rawMaterial doc so other materials continue loading
      }
    }

    const enrichedRecords: EnrichedLedgerInventoryRecord[] = [];
    const anyRecordLotKeys = new Set<string>();

    for (const doc of recordsSnap.docs) {
      try {
        const rawRec = convertTimestamps({ ...doc.data(), id: doc.id }) as InventoryRecord;
        const mat = rawRec.materialId ? hydratedMaterialsMap.get(rawRec.materialId) : undefined;
        const resolvedMetrics = resolveRecordMetrics(rawRec, mat);
        const uom: UnitOfMeasure = resolvedMetrics.uom;

        const normLot = normInventoryLot(rawRec.lotto);
        const lotKey = `${rawRec.materialId || 'UNKNOWN'}::${normLot}`;
        const matchedLot = lotMapByMaterialAndNormLot.get(lotKey);

        const countedUnits = toSafeFiniteNumber(resolvedMetrics.countedUnits, 0);

        // If pending, compare against live SSoT theoretical stock; if approved, show historical or live
        const hasApprovedTheoretical =
          rawRec.status === 'approved' &&
          typeof rawRec.theoreticalUnitsAtApproval === 'number' &&
          Number.isFinite(rawRec.theoreticalUnitsAtApproval);

        const liveTheoreticalUnits = hasApprovedTheoretical
          ? toSafeFiniteNumber(rawRec.theoreticalUnitsAtApproval, 0)
          : matchedLot
            ? toSafeFiniteNumber(matchedLot.theoreticalUnits, 0)
            : toSafeFiniteNumber(rawRec.theoreticalUnitsAtScan, 0);

        const hasApprovedDelta =
          rawRec.status === 'approved' &&
          typeof rawRec.deltaApplied === 'number' &&
          Number.isFinite(rawRec.deltaApplied);

        const liveDeltaUnits = hasApprovedDelta
          ? toSafeFiniteNumber(rawRec.deltaApplied, 0)
          : Number((countedUnits - liveTheoreticalUnits).toFixed(4));

        const missingMaterialAnomaly = !mat;
        const isAnomaly = Boolean(resolvedMetrics.isAnomaly || missingMaterialAnomaly);
        const anomalyReason =
          resolvedMetrics.anomalyReason ||
          (missingMaterialAnomaly ? 'Materia prima non presente in anagrafica' : undefined);

        const resolvedSessionId = resolveRecordSessionId(rawRec);

        const enriched: EnrichedLedgerInventoryRecord = {
          ...rawRec,
          id: doc.id,
          materialId: rawRec.materialId || '',
          materialCode: String(rawRec.materialCode ?? mat?.code ?? 'N/D'),
          materialDescription: String(mat?.description ?? ''),
          lotto: String(rawRec.lotto ?? '').trim() || 'SENZA_LOTTO',
          operatorName: String(rawRec.operatorName ?? 'Operatore'),
          uom,
          inputUnit: toSafeUom(rawRec.inputUnit, uom),
          inputQuantity: toSafeFiniteNumber(rawRec.inputQuantity, 0),
          grossWeight: toSafeFiniteNumber(rawRec.grossWeight, resolvedMetrics.grossWeight),
          tareWeight: toSafeFiniteNumber(rawRec.tareWeight, resolvedMetrics.tareWeight),
          netWeight: Math.max(0, toSafeFiniteNumber(resolvedMetrics.netWeight, 0)),
          countedUnits: Number(countedUnits.toFixed(4)),
          liveTheoreticalUnits: Number(liveTheoreticalUnits.toFixed(4)),
          liveDeltaUnits: Number(liveDeltaUnits.toFixed(4)),
          resolvedSessionId,
          lotLoadDate: matchedLot?.lotLoadDate,
          lotLoadYear: matchedLot?.lotLoadYear,
          isAnomaly,
          hasNegativeNetWarning: resolvedMetrics.hasNegativeNetWarning,
          ...(anomalyReason ? { anomalyReason } : {}),
        };

        enrichedRecords.push(enriched);

        if (rawRec.status !== 'rejected') {
          anyRecordLotKeys.add(lotKey);
        }
      } catch {
        const rawFallback = doc.data() || {};
        enrichedRecords.push({
          id: doc.id,
          materialId: String(rawFallback.materialId ?? ''),
          materialCode: String(rawFallback.materialCode ?? 'CORROTTO'),
          materialDescription: 'Record storico non leggibile',
          lotto: String(rawFallback.lotto ?? 'SENZA_LOTTO'),
          grossWeight: 0,
          tareWeight: 0,
          netWeight: 0,
          operatorId: String(rawFallback.operatorId ?? ''),
          operatorName: String(rawFallback.operatorName ?? 'N/D'),
          recordedAt: null,
          status:
            rawFallback.status === 'approved' || rawFallback.status === 'rejected'
              ? rawFallback.status
              : 'pending',
          inputUnit: 'kg',
          inputQuantity: 0,
          uom: 'kg',
          countedUnits: 0,
          liveTheoreticalUnits: 0,
          liveDeltaUnits: 0,
          resolvedSessionId: VIRTUAL_SESSION_2025_ID,
          isAnomaly: true,
          anomalyReason: 'Record storico malformato',
        });
      }
    }

    // Build baseLots (all lots with positive stock OR with at least one scan record)
    const baseLots: AggregatedMaterialLot[] = [];
    for (const [lotKey, lot] of lotMapByMaterialAndNormLot.entries()) {
      const hasPositiveStock = lot.theoreticalUnits > 0.001;
      const hasRecord = anyRecordLotKeys.has(lotKey);
      if (!hasPositiveStock && !hasRecord) continue;
      baseLots.push(lot);
    }

    baseLots.sort((a, b) => {
      const codeCmp = (a.materialCode || '').localeCompare(b.materialCode || '');
      if (codeCmp !== 0) return codeCmp;
      return (a.lotto || '').localeCompare(b.lotto || '');
    });

    // Build sessions list (real Firestore sessions + virtual 2025 & free 2026 sessions)
    const realSessions: InventoryCountingSession[] = [];
    if (sessionsSnap && !sessionsSnap.empty) {
      for (const sDoc of sessionsSnap.docs) {
        try {
          const rawS = convertTimestamps({ ...sDoc.data(), id: sDoc.id }) as InventoryCountingSession;
          realSessions.push({
            id: sDoc.id,
            name: String(rawS.name || 'Sessione Inventario'),
            year: Number(rawS.year) || new Date().getFullYear(),
            status: rawS.status === 'closed' ? 'closed' : 'open',
            openedAt: String(rawS.openedAt || new Date().toISOString()),
            closedAt: rawS.closedAt ? String(rawS.closedAt) : null,
            notes: rawS.notes ? String(rawS.notes) : '',
            createdBy: rawS.createdBy ? String(rawS.createdBy) : undefined,
            closedBy: rawS.closedBy ? String(rawS.closedBy) : undefined,
            isVirtual: false,
            recordCount: 0,
          });
        } catch {
          // Ignore malformed session doc
        }
      }
    }

    realSessions.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));

    const virtual2025Session: InventoryCountingSession = {
      id: VIRTUAL_SESSION_2025_ID,
      name: 'Storico Inventario 2025',
      year: 2025,
      status: 'closed',
      openedAt: '2025-01-01T00:00:00.000Z',
      closedAt: '2025-12-31T23:59:59.999Z',
      notes: 'Sessione storica automatica per tutte le rilevazioni registrate fino al 31/12/2025.',
      isVirtual: true,
      recordCount: 0,
    };

    const virtualFree2026Session: InventoryCountingSession = {
      id: VIRTUAL_SESSION_FREE_2026_ID,
      name: 'Rilevazioni Libere 2026 (Senza Campagna)',
      year: 2026,
      status: 'open',
      openedAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      notes: 'Rilevazioni 2026 effettuate fuori da una sessione ufficiale.',
      isVirtual: true,
      recordCount: 0,
    };

    const sessions: InventoryCountingSession[] = [...realSessions];

    const free2026Count = enrichedRecords.filter((r) =>
      doesRecordBelongToSession(r, virtualFree2026Session)
    ).length;
    virtualFree2026Session.recordCount = free2026Count;

    if (free2026Count > 0 || realSessions.length === 0) {
      sessions.push(virtualFree2026Session);
    }

    virtual2025Session.recordCount = enrichedRecords.filter((r) =>
      doesRecordBelongToSession(r, virtual2025Session)
    ).length;
    sessions.push(virtual2025Session);

    for (const s of realSessions) {
      s.recordCount = enrichedRecords.filter((r) => doesRecordBelongToSession(r, s)).length;
    }

    // Determine default session:
    // 1. First real open session
    // 2. Newest real closed session
    // 3. VIRTUAL_FREE_2026 if it has records, otherwise VIRTUAL_2025 if it has records, otherwise VIRTUAL_FREE_2026
    const openRealSession = realSessions.find((s) => s.status === 'open');
    let defaultSessionId = VIRTUAL_SESSION_2025_ID;
    if (openRealSession) {
      defaultSessionId = openRealSession.id;
    } else if (realSessions.length > 0) {
      defaultSessionId = realSessions[0].id;
    } else if (free2026Count > 0) {
      defaultSessionId = VIRTUAL_SESSION_FREE_2026_ID;
    } else {
      defaultSessionId = VIRTUAL_SESSION_2025_ID;
    }

    const defaultSession =
      sessions.find((s) => s.id === defaultSessionId) || virtual2025Session;

    const evaluated = evaluateLotsForInventorySession({
      baseLots,
      records: enrichedRecords,
      session: defaultSession,
      includePreviousPending: false,
    });

    return JSON.parse(
      JSON.stringify({
        sessions,
        defaultSessionId: defaultSession.id,
        baseLots,
        allActiveLots: evaluated.allActiveLots,
        unscannedLots: evaluated.unscannedLots,
        records: enrichedRecords,
      })
    );
  } catch (err) {
    console.error('Errore in getInventoryLedgerData:', err);
    return {
      sessions: [
        {
          id: VIRTUAL_SESSION_2025_ID,
          name: 'Storico Inventario 2025',
          year: 2025,
          status: 'closed',
          openedAt: '2025-01-01T00:00:00.000Z',
          closedAt: '2025-12-31T23:59:59.999Z',
          isVirtual: true,
          recordCount: 0,
        },
      ],
      defaultSessionId: VIRTUAL_SESSION_2025_ID,
      baseLots: [],
      allActiveLots: [],
      unscannedLots: [],
      records: [],
    };
  }
}

/**
 * Approves a single InventoryRecord using SSoT Ledger Reconciliation:
 * Delta = Q_rilevata - Q_teorica_live
 * - Delta === 0 -> marks approved, no ledger movement
 * - Delta > 0   -> appends immutable batch with type: 'RETTIFICA_INVENTARIO'
 * - Delta < 0   -> creates append-only withdrawal in materialWithdrawals with type: 'RETTIFICA_INVENTARIO', source: 'inventory_reconciliation'
 * Always invokes recalculateMaterialStock within the transaction.
 */
export async function approveLedgerInventoryRecord(
  recordId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);

    let resultMsg = '';

    await adminDb.runTransaction(async (transaction) => {
      // 1. ALL READS FIRST
      const recordRef = adminDb.collection('inventoryRecords').doc(recordId);
      const recordDoc = await transaction.get(recordRef);

      if (!recordDoc.exists) {
        throw new Error('Registrazione inventario non trovata.');
      }

      const record = { ...(recordDoc.data() as InventoryRecord), id: recordDoc.id };
      if (record.status !== 'pending') {
        throw new Error(`Questa rilevazione è già stata ${record.status === 'approved' ? 'approvata' : 'rifiutata'}.`);
      }

      const materialRef = adminDb.collection('rawMaterials').doc(record.materialId);
      const withdrawalsQuery = adminDb
        .collection('materialWithdrawals')
        .where('materialId', '==', record.materialId);

      const [materialDoc, withdrawalsSnap] = await Promise.all([
        transaction.get(materialRef),
        transaction.get(withdrawalsQuery),
      ]);

      if (!materialDoc.exists) {
        throw new Error('Materia prima associata non trovata.');
      }

      // 2. SSoT LIVE HYDRATION & DELTA CALCULATION
      const rawMaterial = { ...(materialDoc.data() as RawMaterial), id: materialDoc.id };
      const withdrawals: MaterialWithdrawal[] = withdrawalsSnap.docs.map((d) => ({
        ...(d.data() as MaterialWithdrawal),
        id: d.id,
      }));

      const hydrated = hydrateMaterialWithWithdrawals(rawMaterial, withdrawals);
      const aggregatedLots = getAggregatedLotsForMaterial(hydrated);

      const cleanLotto = (record.lotto || '').trim() || 'SENZA_LOTTO';
      const targetNormLot = normInventoryLot(cleanLotto);
      const matchingLot = aggregatedLots.find((l) => l.normLotto === targetNormLot);

      const theoreticalUnitsLive = matchingLot ? matchingLot.theoreticalUnits : 0;
      const countedUnits = resolveRecordCountedUnits(record, hydrated);
      const delta = Number((countedUnits - theoreticalUnitsLive).toFixed(4));
      const deltaWeightKg = convertUnitsToWeightKg(delta, hydrated);
      const uom = hydrated.unitOfMeasure;

      // 3. WRITES BASED ON DELTA
      if (Math.abs(delta) <= 0.0001) {
        // Delta = 0: Lot is already aligned
        await recalculateMaterialStock(rawMaterial.id, transaction, {
          material: hydrated,
          withdrawals,
        });

        transaction.update(recordRef, {
          status: 'approved',
          approvedBy: adminUid,
          approvedAt: admin.firestore.Timestamp.now(),
          uom,
          countedUnits,
          theoreticalUnitsAtApproval: theoreticalUnitsLive,
          deltaApplied: 0,
          ledgerActionType: 'NONE',
          ledgerRefId: null,
        });

        resultMsg = `Lotto ${cleanLotto} (${rawMaterial.code}) già allineato (${countedUnits} ${uom.toUpperCase()}). Nessuna rettifica necessaria.`;
      } else if (delta > 0.0001) {
        // Delta > 0: Append immutable RETTIFICA_INVENTARIO batch
        const newBatchId = `batch-inv-ssot-${record.id}`;
        const newBatch: RawMaterialBatch = {
          id: newBatchId,
          inventoryRecordId: record.id,
          date: new Date().toISOString(),
          ddt: 'RETTIFICA-INV',
          type: 'RETTIFICA_INVENTARIO',
          isReturn: true,
          lotto: cleanLotto,
          netQuantity: Number(delta.toFixed(4)),
          grossWeight: Number((deltaWeightKg + (record.tareWeight || 0)).toFixed(4)),
          tareWeight: record.tareWeight || 0,
          ...(record.tareName ? { tareName: record.tareName } : {}),
          ...(record.packagingId ? { packagingId: record.packagingId } : {}),
          isExhausted: false,
        };

        const updatedBatches = [
          ...(rawMaterial.batches || []).filter((b) => b.id !== newBatchId),
          newBatch,
        ];
        const rehydrated = hydrateMaterialWithWithdrawals(
          { ...rawMaterial, batches: updatedBatches },
          withdrawals
        );

        transaction.update(materialRef, { batches: rehydrated.batches });
        await recalculateMaterialStock(rawMaterial.id, transaction, {
          material: rehydrated,
          withdrawals,
        });

        transaction.update(recordRef, {
          status: 'approved',
          approvedBy: adminUid,
          approvedAt: admin.firestore.Timestamp.now(),
          uom,
          countedUnits,
          theoreticalUnitsAtApproval: theoreticalUnitsLive,
          deltaApplied: Number(delta.toFixed(4)),
          ledgerActionType: 'ADD_BATCH',
          ledgerRefId: newBatchId,
        });

        resultMsg = `Rettifica Positiva (+${delta} ${uom.toUpperCase()}) applicata sul Lotto ${cleanLotto} (${rawMaterial.code}). Nuova giacenza lotto: ${countedUnits} ${uom.toUpperCase()}.`;
      } else {
        // Delta < 0: Create append-only withdrawal in materialWithdrawals
        const withdrawalId = `w-inv-ssot-${record.id}`;
        const withdrawalRef = adminDb.collection('materialWithdrawals').doc(withdrawalId);
        const absDelta = Number(Math.abs(delta).toFixed(4));

        const newWithdrawal: Omit<MaterialWithdrawal, 'id'> = {
          type: 'RETTIFICA_INVENTARIO',
          source: 'inventory_reconciliation',
          materialId: rawMaterial.id,
          materialCode: rawMaterial.code,
          lotto: cleanLotto,
          consumedUnits: absDelta,
          consumedWeight: deltaWeightKg,
          inventoryRecordId: record.id,
          status: 'completed',
          operatorId: adminUid,
          operatorName: 'Rettifica Inventario SSoT',
          withdrawalDate: admin.firestore.Timestamp.now(),
          jobIds: [],
          jobOrderPFs: [],
          notes: `Rettifica Inventario SSoT: da ${theoreticalUnitsLive} a ${countedUnits} ${uom.toUpperCase()}`,
        };

        transaction.set(withdrawalRef, newWithdrawal);

        const updatedWithdrawals: MaterialWithdrawal[] = [
          ...withdrawals.filter((w) => w.id !== withdrawalId),
          { ...newWithdrawal, id: withdrawalId },
        ];
        const rehydrated = hydrateMaterialWithWithdrawals(rawMaterial, updatedWithdrawals);

        transaction.update(materialRef, { batches: rehydrated.batches });
        await recalculateMaterialStock(rawMaterial.id, transaction, {
          material: rehydrated,
          withdrawals: updatedWithdrawals,
        });

        transaction.update(recordRef, {
          status: 'approved',
          approvedBy: adminUid,
          approvedAt: admin.firestore.Timestamp.now(),
          uom,
          countedUnits,
          theoreticalUnitsAtApproval: theoreticalUnitsLive,
          deltaApplied: Number(delta.toFixed(4)),
          ledgerActionType: 'WITHDRAWAL',
          ledgerRefId: withdrawalId,
        });

        resultMsg = `Rettifica Negativa (${delta} ${uom.toUpperCase()}) registrata nel Ledger per Lotto ${cleanLotto} (${rawMaterial.code}). Nuova giacenza lotto: ${countedUnits} ${uom.toUpperCase()}.`;
      }
    });

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/batch-management');
    return { success: true, message: resultMsg };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore durante l\'approvazione SSoT.',
    };
  }
}

/**
 * Batch version of approveLedgerInventoryRecord.
 * Processes records sequentially so multiple records on the same material/lot
 * see each other's updated SSoT state cleanly.
 */
export async function approveMultipleLedgerInventoryRecords(
  recordIds: string[],
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);
    if (!recordIds || recordIds.length === 0) {
      return { success: false, message: 'Nessun record selezionato.' };
    }

    let approvedCount = 0;
    const errors: string[] = [];

    for (const id of recordIds) {
      const res = await approveLedgerInventoryRecord(id, adminUid);
      if (res.success) {
        approvedCount++;
      } else {
        errors.push(`${id}: ${res.message}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: approvedCount > 0,
        message: `Approvate ${approvedCount}/${recordIds.length} rilevazioni. Errori: ${errors.join('; ')}`,
      };
    }

    return {
      success: true,
      message: `${approvedCount} rilevazioni approvate e riconciliate nel Ledger SSoT.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore approvazione multipla.',
    };
  }
}

/**
 * Writes off unscanned lots ("Scarica Lotto Non Presente (Porta a 0)"):
 * Generates a tracked InventoryRecord with countedUnits = 0 and applies the Delta < 0
 * withdrawal in materialWithdrawals, bringing the lot's residual stock to 0 (isExhausted: true).
 */
export async function writeOffUnscannedLots(
  lotsToZero: Array<{ materialId: string; lotto: string }>,
  adminUid: string,
  sessionContext?: { sessionId?: string | null; sessionName?: string | null }
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);
    if (!lotsToZero || lotsToZero.length === 0) {
      return { success: false, message: 'Nessun lotto selezionato per lo scarico.' };
    }

    let zeroedCount = 0;
    const errors: string[] = [];

    const validSessionId =
      sessionContext?.sessionId &&
      sessionContext.sessionId !== VIRTUAL_SESSION_2025_ID &&
      sessionContext.sessionId !== VIRTUAL_SESSION_FREE_2026_ID
        ? sessionContext.sessionId
        : null;
    const validSessionName = validSessionId ? (sessionContext?.sessionName || null) : null;

    for (const target of lotsToZero) {
      try {
        await adminDb.runTransaction(async (transaction) => {
          const materialRef = adminDb.collection('rawMaterials').doc(target.materialId);
          const withdrawalsQuery = adminDb
            .collection('materialWithdrawals')
            .where('materialId', '==', target.materialId);

          const [materialDoc, withdrawalsSnap] = await Promise.all([
            transaction.get(materialRef),
            transaction.get(withdrawalsQuery),
          ]);

          if (!materialDoc.exists) {
            throw new Error(`Materiale ${target.materialId} non trovato.`);
          }

          const rawMaterial = { ...(materialDoc.data() as RawMaterial), id: materialDoc.id };
          const withdrawals: MaterialWithdrawal[] = withdrawalsSnap.docs.map((d) => ({
            ...(d.data() as MaterialWithdrawal),
            id: d.id,
          }));

          const hydrated = hydrateMaterialWithWithdrawals(rawMaterial, withdrawals);
          const aggregatedLots = getAggregatedLotsForMaterial(hydrated);

          const cleanLotto = (target.lotto || '').trim() || 'SENZA_LOTTO';
          const targetNormLot = normInventoryLot(cleanLotto);
          const matchingLot = aggregatedLots.find((l) => l.normLotto === targetNormLot);

          const theoreticalUnitsLive = matchingLot ? matchingLot.theoreticalUnits : 0;
          if (theoreticalUnitsLive <= 0.0001) {
            return; // Already 0
          }

          const delta = Number((-theoreticalUnitsLive).toFixed(4));
          const absDeltaUnits = Number(theoreticalUnitsLive.toFixed(4));
          const deltaWeightKg = convertUnitsToWeightKg(absDeltaUnits, hydrated);
          const uom = hydrated.unitOfMeasure;

          const recordRef = adminDb.collection('inventoryRecords').doc();
          const withdrawalId = `w-inv-ssot-${recordRef.id}`;
          const withdrawalRef = adminDb.collection('materialWithdrawals').doc(withdrawalId);

          const newRecord: Omit<InventoryRecord, 'id'> = {
            materialId: rawMaterial.id,
            materialCode: rawMaterial.code,
            lotto: cleanLotto,
            grossWeight: 0,
            tareWeight: matchingLot?.tareWeight || 0,
            ...(matchingLot?.tareName ? { tareName: matchingLot.tareName } : {}),
            ...(matchingLot?.packagingId ? { packagingId: matchingLot.packagingId } : {}),
            netWeight: 0,
            operatorId: adminUid,
            operatorName: 'Scarico Lotto Non Presente (Admin)',
            recordedAt: admin.firestore.Timestamp.now(),
            status: 'approved',
            approvedBy: adminUid,
            approvedAt: admin.firestore.Timestamp.now(),
            inputUnit: uom,
            inputQuantity: 0,
            uom,
            materialUnitOfMeasure: uom,
            countedUnits: 0,
            theoreticalUnitsAtScan: theoreticalUnitsLive,
            deltaUnits: delta,
            theoreticalUnitsAtApproval: theoreticalUnitsLive,
            deltaApplied: delta,
            ledgerActionType: 'WRITE_OFF',
            ledgerRefId: withdrawalId,
            ...(validSessionId
              ? { sessionId: validSessionId, sessionName: validSessionName }
              : {}),
          };

          const newWithdrawal: Omit<MaterialWithdrawal, 'id'> = {
            type: 'RETTIFICA_INVENTARIO',
            source: 'inventory_reconciliation',
            materialId: rawMaterial.id,
            materialCode: rawMaterial.code,
            lotto: cleanLotto,
            consumedUnits: absDeltaUnits,
            consumedWeight: deltaWeightKg,
            inventoryRecordId: recordRef.id,
            status: 'completed',
            operatorId: adminUid,
            operatorName: 'Scarico Lotto Non Presente (SSoT)',
            withdrawalDate: admin.firestore.Timestamp.now(),
            jobIds: [],
            jobOrderPFs: [],
            notes: `Scarico Lotto Non Presente in Inventario: azzerato da ${theoreticalUnitsLive} ${uom.toUpperCase()} a 0`,
          };

          transaction.set(recordRef, newRecord);
          transaction.set(withdrawalRef, newWithdrawal);

          const updatedWithdrawals: MaterialWithdrawal[] = [
            ...withdrawals,
            { ...newWithdrawal, id: withdrawalId },
          ];
          const rehydrated = hydrateMaterialWithWithdrawals(rawMaterial, updatedWithdrawals);

          transaction.update(materialRef, { batches: rehydrated.batches });
          await recalculateMaterialStock(rawMaterial.id, transaction, {
            material: rehydrated,
            withdrawals: updatedWithdrawals,
          });

          zeroedCount++;
        });
      } catch (err) {
        errors.push(
          `${target.lotto}: ${err instanceof Error ? err.message : 'Errore sconosciuto'}`
        );
      }
    }

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/batch-management');

    if (errors.length > 0) {
      return {
        success: zeroedCount > 0,
        message: `Azzerati ${zeroedCount} lotti. Errori: ${errors.join('; ')}`,
      };
    }

    return {
      success: true,
      message: `${zeroedCount} lotti non presenti scaricati e portati a giacenza 0 nel Ledger SSoT.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore durante lo scarico dei lotti.',
    };
  }
}

/**
 * Safely reverts an approved SSoT Ledger InventoryRecord:
 * - Removes the RETTIFICA_INVENTARIO batch if delta > 0
 * - Sets status: 'cancelled' on the materialWithdrawals document if delta < 0
 * - Rehydrates batches and invokes recalculateMaterialStock within the transaction.
 */
export async function revertLedgerInventoryRecord(
  recordId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);

    await adminDb.runTransaction(async (transaction) => {
      // 1. ALL READS FIRST
      const recordRef = adminDb.collection('inventoryRecords').doc(recordId);
      const recordDoc = await transaction.get(recordRef);

      if (!recordDoc.exists) {
        throw new Error('Record inventario non trovato.');
      }

      const record = { ...(recordDoc.data() as InventoryRecord), id: recordDoc.id };
      if (record.status !== 'approved') {
        throw new Error('Solo i record approvati possono essere stornati.');
      }

      const materialRef = adminDb.collection('rawMaterials').doc(record.materialId);
      const withdrawalsQuery = adminDb
        .collection('materialWithdrawals')
        .where('materialId', '==', record.materialId);

      const [materialDoc, withdrawalsSnap] = await Promise.all([
        transaction.get(materialRef),
        transaction.get(withdrawalsQuery),
      ]);

      if (!materialDoc.exists) {
        throw new Error('Materia prima associata non trovata.');
      }

      const rawMaterial = { ...(materialDoc.data() as RawMaterial), id: materialDoc.id };
      let updatedBatches = [...(rawMaterial.batches || [])];
      const updatedWithdrawals: MaterialWithdrawal[] = [];

      const expectedBatchIds = new Set(
        [
          record.ledgerRefId,
          `batch-inv-ssot-${record.id}`,
          `batch-inv-${record.id}`,
        ].filter(Boolean) as string[]
      );

      const expectedWithdrawalIds = new Set(
        [record.ledgerRefId, `w-inv-ssot-${record.id}`].filter(Boolean) as string[]
      );

      // Remove any RETTIFICA_INVENTARIO batch linked to this record
      updatedBatches = updatedBatches.filter(
        (b) =>
          !expectedBatchIds.has(b.id) &&
          !(b.inventoryRecordId === record.id && b.type === 'RETTIFICA_INVENTARIO')
      );

      // Cancel any withdrawal linked to this record
      for (const wDoc of withdrawalsSnap.docs) {
        const wData = { ...(wDoc.data() as MaterialWithdrawal), id: wDoc.id };
        if (
          expectedWithdrawalIds.has(wDoc.id) ||
          wData.inventoryRecordId === record.id
        ) {
          if (wData.status !== 'cancelled') {
            transaction.update(wDoc.ref, {
              status: 'cancelled',
              cancelledAt: admin.firestore.Timestamp.now(),
              cancelledBy: adminUid,
            });
          }
          updatedWithdrawals.push({ ...wData, status: 'cancelled' });
        } else {
          updatedWithdrawals.push(wData);
        }
      }

      const rehydrated = hydrateMaterialWithWithdrawals(
        { ...rawMaterial, batches: updatedBatches },
        updatedWithdrawals
      );

      transaction.update(materialRef, { batches: rehydrated.batches });
      await recalculateMaterialStock(rawMaterial.id, transaction, {
        material: rehydrated,
        withdrawals: updatedWithdrawals,
      });

      const wasWriteOff = record.ledgerActionType === 'WRITE_OFF';

      transaction.update(recordRef, {
        status: wasWriteOff ? 'rejected' : 'pending',
        approvedBy: admin.firestore.FieldValue.delete(),
        approvedAt: admin.firestore.FieldValue.delete(),
        theoreticalUnitsAtApproval: admin.firestore.FieldValue.delete(),
        deltaApplied: admin.firestore.FieldValue.delete(),
        ledgerRefId: admin.firestore.FieldValue.delete(),
        ledgerActionType: admin.firestore.FieldValue.delete(),
      });
    });

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/batch-management');

    return {
      success: true,
      message: 'Approvazione stornata con successo. Giacenza SSoT del lotto ripristinata.',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore durante lo storno SSoT.',
    };
  }
}

export async function rejectLedgerInventoryRecord(
  recordId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);
    const recordRef = adminDb.collection('inventoryRecords').doc(recordId);
    const snap = await recordRef.get();
    if (!snap.exists) {
      return { success: false, message: 'Rilevazione non trovata.' };
    }
    if (snap.data()?.status === 'approved') {
      return {
        success: false,
        message: 'Impossibile rifiutare un record già approvato. Esegui prima lo Storno.',
      };
    }

    await recordRef.update({
      status: 'rejected',
      approvedBy: adminUid,
      approvedAt: admin.firestore.Timestamp.now(),
    });

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/admin/inventory-management');
    return { success: true, message: 'Rilevazione rifiutata.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore durante il rifiuto.',
    };
  }
}

/**
 * ZERO-DAMAGE SESSION MANAGEMENT:
 * Opens a new InventoryCountingSession in `inventoryCountingSessions`.
 * NEVER modifies, zeroes out, or touches `rawMaterials`, `batches`, or `materialWithdrawals`.
 */
export async function openInventoryCountingSession(
  params: { name: string; year?: number; notes?: string },
  adminUid: string
): Promise<{ success: boolean; message: string; session?: InventoryCountingSession }> {
  try {
    await ensureAdmin(adminUid);

    const cleanName = String(params.name ?? '').trim();
    if (!cleanName) {
      return { success: false, message: 'Inserisci un nome valido per la sessione di inventario.' };
    }

    const sessionYear =
      typeof params.year === 'number' && params.year >= 2020 && params.year <= 2099
        ? params.year
        : new Date().getFullYear();

    // Check if there is already an open session
    const openSnap = await adminDb
      .collection('inventoryCountingSessions')
      .where('status', '==', 'open')
      .get();

    if (!openSnap.empty) {
      const existingName = openSnap.docs[0].data()?.name || openSnap.docs[0].id;
      return {
        success: false,
        message: `Esiste già una sessione aperta ("${existingName}"). Chiudila o eliminala prima di aprirne una nuova.`,
      };
    }

    const nowIso = new Date().toISOString();
    const docRef = adminDb.collection('inventoryCountingSessions').doc();

    const newSessionData = {
      name: cleanName,
      year: sessionYear,
      status: 'open' as const,
      openedAt: nowIso,
      closedAt: null,
      notes: String(params.notes ?? '').trim(),
      createdBy: adminUid,
    };

    await docRef.set(newSessionData);

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/inventory');

    const createdSession: InventoryCountingSession = {
      id: docRef.id,
      ...newSessionData,
      isVirtual: false,
      recordCount: 0,
    };

    return {
      success: true,
      message: `Sessione "${cleanName}" (${sessionYear}) aperta con successo. Nessuna giacenza è stata toccata; tutti i lotti attivi sono ora pronti per la battitura.`,
      session: createdSession,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Errore durante l'apertura della sessione.",
    };
  }
}

/**
 * ZERO-DAMAGE SESSION MANAGEMENT:
 * Closes an open InventoryCountingSession (`status: 'closed'`, `closedAt: now`).
 * NEVER modifies `rawMaterials`, `batches`, or `materialWithdrawals`.
 */
export async function closeInventoryCountingSession(
  sessionId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);

    if (
      !sessionId ||
      sessionId === VIRTUAL_SESSION_2025_ID ||
      sessionId === VIRTUAL_SESSION_FREE_2026_ID
    ) {
      return { success: false, message: 'Impossibile chiudere una sessione virtuale di sistema.' };
    }

    const docRef = adminDb.collection('inventoryCountingSessions').doc(sessionId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return { success: false, message: 'Sessione di inventario non trovata.' };
    }

    const data = snap.data() || {};
    if (data.status === 'closed') {
      return { success: false, message: 'Questa sessione è già chiusa.' };
    }

    const nowIso = new Date().toISOString();
    await docRef.update({
      status: 'closed',
      closedAt: nowIso,
      closedBy: adminUid,
    });

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/inventory');

    return {
      success: true,
      message: `Sessione "${data.name || sessionId}" chiusa con successo.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore durante la chiusura della sessione.',
    };
  }
}

/**
 * ZERO-DAMAGE SESSION MANAGEMENT:
 * Deletes/cancels an InventoryCountingSession opened by mistake (only if it has 0 non-rejected records).
 * NEVER modifies `rawMaterials`, `batches`, or `materialWithdrawals`.
 */
export async function deleteInventoryCountingSession(
  sessionId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);

    if (
      !sessionId ||
      sessionId === VIRTUAL_SESSION_2025_ID ||
      sessionId === VIRTUAL_SESSION_FREE_2026_ID
    ) {
      return { success: false, message: 'Impossibile eliminare una sessione storica o virtuale.' };
    }

    const docRef = adminDb.collection('inventoryCountingSessions').doc(sessionId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return { success: false, message: 'Sessione non trovata.' };
    }

    const linkedRecordsSnap = await adminDb
      .collection('inventoryRecords')
      .where('sessionId', '==', sessionId)
      .get();

    const activeRecordsCount = linkedRecordsSnap.docs.filter(
      (d) => d.data()?.status !== 'rejected'
    ).length;

    if (activeRecordsCount > 0) {
      return {
        success: false,
        message: `Impossibile eliminare la sessione: contiene già ${activeRecordsCount} rilevazioni associate. Usa "Chiudi Sessione" invece di eliminarla.`,
      };
    }

    const sessionName = snap.data()?.name || sessionId;
    await docRef.delete();

    revalidatePath('/admin/inventory-ledger');
    revalidatePath('/inventory');

    return {
      success: true,
      message: `Sessione "${sessionName}" annullata ed eliminata con zero effetti sul magazzino.`,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Errore durante l'eliminazione della sessione.",
    };
  }
}


