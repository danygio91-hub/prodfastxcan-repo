'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';
import { recalculateMaterialStock } from '@/lib/stock-sync';
import {
  convertUnitsToWeightKg,
  getAggregatedLotsForMaterial,
  normInventoryLot,
  resolveRecordCountedUnits,
  type AggregatedMaterialLot,
} from '@/lib/inventory-ledger-logic';
import type {
  InventoryRecord,
  MaterialWithdrawal,
  RawMaterial,
  RawMaterialBatch,
  UnitOfMeasure,
} from '@/types';

function convertTimestamps(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString();
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
}

export interface LedgerLotCheckoffItem extends AggregatedMaterialLot {
  scanStatus: 'SCANNED_PENDING' | 'SCANNED_APPROVED' | 'UNSCANNED';
  latestRecord?: EnrichedLedgerInventoryRecord | null;
}

export interface InventoryLedgerPageData {
  allActiveLots: LedgerLotCheckoffItem[];
  unscannedLots: LedgerLotCheckoffItem[];
  records: EnrichedLedgerInventoryRecord[];
}

/**
 * Loads the complete SSoT Inventory Ledger state:
 * 1. All active lots across all materials (hydrated via hydrateMaterialWithWithdrawals)
 * 2. All operator scan records enriched with live SSoT theoretical stock and delta
 * 3. Unscanned lots (theoretical stock > 0 with no pending/approved scan record)
 */
export async function getInventoryLedgerData(): Promise<InventoryLedgerPageData> {
  const [materialsSnap, withdrawalsSnap, recordsSnap] = await Promise.all([
    adminDb.collection('rawMaterials').get(),
    adminDb.collection('materialWithdrawals').get(),
    adminDb.collection('inventoryRecords').orderBy('recordedAt', 'desc').get(),
  ]);

  const withdrawalsByMaterial = new Map<string, MaterialWithdrawal[]>();
  withdrawalsSnap.docs.forEach((doc) => {
    const data = doc.data() as MaterialWithdrawal;
    if (!data.materialId) return;
    const list = withdrawalsByMaterial.get(data.materialId) || [];
    list.push({ ...data, id: doc.id });
    withdrawalsByMaterial.set(data.materialId, list);
  });

  const hydratedMaterialsMap = new Map<string, RawMaterial>();
  const lotMapByMaterialAndNormLot = new Map<string, AggregatedMaterialLot>();

  for (const doc of materialsSnap.docs) {
    const raw = { ...(doc.data() as RawMaterial), id: doc.id };
    const matWithdrawals = withdrawalsByMaterial.get(raw.id) || [];
    const hydrated = hydrateMaterialWithWithdrawals(raw, matWithdrawals);
    hydratedMaterialsMap.set(raw.id, hydrated);

    const lots = getAggregatedLotsForMaterial(hydrated);
    for (const lot of lots) {
      lotMapByMaterialAndNormLot.set(`${raw.id}::${lot.normLotto}`, lot);
    }
  }

  const enrichedRecords: EnrichedLedgerInventoryRecord[] = [];
  const latestRecordByLotKey = new Map<string, EnrichedLedgerInventoryRecord>();

  for (const doc of recordsSnap.docs) {
    const rawRec = convertTimestamps({ ...doc.data(), id: doc.id }) as InventoryRecord;
    const mat = hydratedMaterialsMap.get(rawRec.materialId);
    const uom: UnitOfMeasure =
      rawRec.uom || rawRec.materialUnitOfMeasure || mat?.unitOfMeasure || rawRec.inputUnit || 'kg';

    const normLot = normInventoryLot(rawRec.lotto);
    const lotKey = `${rawRec.materialId}::${normLot}`;
    const matchedLot = lotMapByMaterialAndNormLot.get(lotKey);

    const countedUnits = mat
      ? resolveRecordCountedUnits(rawRec, mat)
      : typeof rawRec.countedUnits === 'number'
        ? rawRec.countedUnits
        : rawRec.inputQuantity || 0;

    // If pending, compare against live SSoT theoretical stock; if approved, show historical or live
    const liveTheoreticalUnits =
      rawRec.status === 'approved' && typeof rawRec.theoreticalUnitsAtApproval === 'number'
        ? rawRec.theoreticalUnitsAtApproval
        : matchedLot
          ? matchedLot.theoreticalUnits
          : rawRec.theoreticalUnitsAtScan || 0;

    const liveDeltaUnits =
      rawRec.status === 'approved' && typeof rawRec.deltaApplied === 'number'
        ? rawRec.deltaApplied
        : Number((countedUnits - liveTheoreticalUnits).toFixed(4));

    const enriched: EnrichedLedgerInventoryRecord = {
      ...rawRec,
      materialDescription: mat?.description || '',
      uom,
      countedUnits: Number(countedUnits.toFixed(4)),
      liveTheoreticalUnits: Number(liveTheoreticalUnits.toFixed(4)),
      liveDeltaUnits,
    };

    enrichedRecords.push(enriched);

    if (rawRec.status !== 'rejected' && !latestRecordByLotKey.has(lotKey)) {
      latestRecordByLotKey.set(lotKey, enriched);
    }
  }

  const allActiveLots: LedgerLotCheckoffItem[] = [];

  for (const [lotKey, lot] of lotMapByMaterialAndNormLot.entries()) {
    const associatedRecord = latestRecordByLotKey.get(lotKey) || null;
    const hasPositiveStock = lot.theoreticalUnits > 0.001;

    if (!hasPositiveStock && !associatedRecord) {
      continue;
    }

    let scanStatus: LedgerLotCheckoffItem['scanStatus'] = 'UNSCANNED';
    if (associatedRecord) {
      scanStatus =
        associatedRecord.status === 'approved' ? 'SCANNED_APPROVED' : 'SCANNED_PENDING';
    }

    allActiveLots.push({
      ...lot,
      scanStatus,
      latestRecord: associatedRecord,
    });
  }

  allActiveLots.sort((a, b) => {
    const codeCmp = (a.materialCode || '').localeCompare(b.materialCode || '');
    if (codeCmp !== 0) return codeCmp;
    return (a.lotto || '').localeCompare(b.lotto || '');
  });

  const unscannedLots = allActiveLots.filter(
    (item) => item.theoreticalUnits > 0.001 && item.scanStatus === 'UNSCANNED'
  );

  return JSON.parse(
    JSON.stringify({
      allActiveLots,
      unscannedLots,
      records: enrichedRecords,
    })
  );
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
  adminUid: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(adminUid);
    if (!lotsToZero || lotsToZero.length === 0) {
      return { success: false, message: 'Nessun lotto selezionato per lo scarico.' };
    }

    let zeroedCount = 0;
    const errors: string[] = [];

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

