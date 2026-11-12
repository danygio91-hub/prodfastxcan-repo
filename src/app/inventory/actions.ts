'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { RawMaterial, Packaging, InventoryRecord, MaterialWithdrawal } from '@/types';
import * as z from 'zod';
import { revalidatePath } from 'next/cache';
import { hydrateMaterialWithWithdrawals } from '@/lib/stock-logic';
import {
  computeInventoryMetrics,
  getAggregatedLotsForMaterial,
  normInventoryLot,
} from '@/lib/inventory-ledger-logic';

function serializeFirestoreData<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export async function getPackagingItems(): Promise<Packaging[]> {
  const snapshot = await adminDb.collection('packaging').orderBy('name').get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Packaging), id: doc.id }));
}

/**
 * Fallback search for Operator Inventory: searches materials by code, description, or lot number,
 * returning hydrated materials with live SSoT batch quantities.
 */
export async function searchInventoryMaterials(query: string): Promise<RawMaterial[]> {
  const cleanQuery = (query || '').trim().toLowerCase();
  const [materialsSnap, withdrawalsSnap] = await Promise.all([
    adminDb.collection('rawMaterials').get(),
    adminDb.collection('materialWithdrawals').get(),
  ]);

  const withdrawalsByMaterial = new Map<string, MaterialWithdrawal[]>();
  withdrawalsSnap.docs.forEach((doc) => {
    const data = doc.data() as MaterialWithdrawal;
    if (!data.materialId) return;
    const list = withdrawalsByMaterial.get(data.materialId) || [];
    list.push({ ...data, id: doc.id });
    withdrawalsByMaterial.set(data.materialId, list);
  });

  const results: RawMaterial[] = [];

  for (const doc of materialsSnap.docs) {
    const raw = { ...(doc.data() as RawMaterial), id: doc.id };
    const codeMatch = (raw.code || '').toLowerCase().includes(cleanQuery);
    const descMatch = (raw.description || '').toLowerCase().includes(cleanQuery);
    const lotMatch = (raw.batches || []).some((b) =>
      (b.lotto || '').toLowerCase().includes(cleanQuery)
    );

    if (!cleanQuery || codeMatch || descMatch || lotMatch) {
      const matWithdrawals = withdrawalsByMaterial.get(raw.id) || [];
      const hydrated = hydrateMaterialWithWithdrawals(raw, matWithdrawals);
      results.push(hydrated);
    }
  }

  results.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  return serializeFirestoreData(results.slice(0, 30));
}

const inventoryBatchSchema = z.object({
  materialId: z.string().min(1, 'ID Materiale mancante.'),
  lotto: z.string().optional(),
  inputQuantity: z.coerce
    .number({ invalid_type_error: 'Inserisci un numero valido (anche 0 per lotto esaurito).' })
    .min(0, 'La quantità inserita non può essere negativa.'),
  packagingId: z.string().optional(),
  inputUnit: z.enum(['n', 'mt', 'kg']),
});

export async function registerInventoryBatch(
  formData: FormData
): Promise<{ success: boolean; message: string }> {
  const rawData = Object.fromEntries(formData.entries());

  const validatedFields = inventoryBatchSchema.safeParse(rawData);

  if (!validatedFields.success) {
    const firstError = validatedFields.error.errors[0]?.message || 'Dati non validi.';
    return { success: false, message: firstError };
  }

  const { materialId, lotto, inputQuantity, packagingId, inputUnit } = validatedFields.data;
  const operatorId = rawData.operatorId as string;
  const operatorName = rawData.operatorName as string;

  if (!operatorId || !operatorName) {
    return { success: false, message: 'Dati operatore mancanti.' };
  }

  const materialRef = adminDb.collection('rawMaterials').doc(materialId);
  const inventoryRef = adminDb.collection('inventoryRecords');

  try {
    const [materialSnap, withdrawalsSnap] = await Promise.all([
      materialRef.get(),
      adminDb.collection('materialWithdrawals').where('materialId', '==', materialId).get(),
    ]);

    if (!materialSnap.exists) {
      throw new Error('Materia prima non trovata.');
    }

    const rawMaterial = { ...(materialSnap.data() as RawMaterial), id: materialSnap.id };
    const withdrawals = withdrawalsSnap.docs.map(
      (d) => ({ ...(d.data() as MaterialWithdrawal), id: d.id })
    );

    // Hydrate material via SSoT to read live theoretical lot stock
    const hydratedMaterial = hydrateMaterialWithWithdrawals(rawMaterial, withdrawals);
    const aggregatedLots = getAggregatedLotsForMaterial(hydratedMaterial);

    const finalLotto = (lotto || '').trim() || 'SENZA_LOTTO';
    const targetNormLot = normInventoryLot(finalLotto);
    const matchingLot = aggregatedLots.find((l) => l.normLotto === targetNormLot);

    // Resolve tareWeight from selected packaging or fallback to lot's expected tare if none selected
    let tareWeight = 0;
    let tareName: string | undefined = undefined;
    if (packagingId && packagingId !== 'none') {
      const packagingRef = adminDb.collection('packaging').doc(packagingId);
      const packagingSnap = await packagingRef.get();
      if (packagingSnap.exists) {
        const pkgData = packagingSnap.data() as Packaging;
        tareWeight = pkgData.weightKg || 0;
        tareName = pkgData.name;
      }
    }

    const theoreticalUnitsAtScan = matchingLot ? matchingLot.theoreticalUnits : 0;

    const metrics = computeInventoryMetrics({
      material: hydratedMaterial,
      inputQuantity,
      inputUnit,
      tareWeight,
      theoreticalUnitsAtScan,
    });

    const newInventoryRecord: Omit<InventoryRecord, 'id'> = {
      materialId,
      materialCode: hydratedMaterial.code,
      lotto: finalLotto,
      grossWeight: metrics.grossWeight,
      tareWeight: metrics.tareWeight,
      ...(tareName ? { tareName } : {}),
      netWeight: metrics.netWeight,
      ...(packagingId && packagingId !== 'none' ? { packagingId } : {}),
      operatorId,
      operatorName,
      recordedAt: admin.firestore.Timestamp.now(),
      status: 'pending',
      inputUnit,
      inputQuantity,
      uom: metrics.uom,
      materialUnitOfMeasure: metrics.uom,
      countedUnits: metrics.countedUnits,
      theoreticalUnitsAtScan: metrics.theoreticalUnitsAtScan,
      deltaUnits: metrics.deltaUnits,
      ...(hydratedMaterial.conversionFactor
        ? { conversionFactor: hydratedMaterial.conversionFactor }
        : {}),
      ...(hydratedMaterial.rapportoKgMt
        ? { rapportoKgMt: hydratedMaterial.rapportoKgMt }
        : {}),
    };

    await inventoryRef.add(newInventoryRecord);

    revalidatePath('/admin/inventory-management');
    revalidatePath('/admin/inventory-ledger');
    return {
      success: true,
      message: `Inventario registrato per Lotto "${finalLotto}" (Rilevato: ${metrics.countedUnits} ${metrics.uom.toUpperCase()}, Delta: ${metrics.deltaUnits >= 0 ? '+' : ''}${metrics.deltaUnits} ${metrics.uom.toUpperCase()}). In attesa di approvazione.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Errore sconosciuto.',
    };
  }
}
