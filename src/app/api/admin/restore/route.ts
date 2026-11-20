import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import { bumpMrpSyncVersion } from '@/lib/mrp-sync';
import {
  FIRESTORE_BATCH_LIMIT,
  RESTORE_CONFIRM_TOKEN,
  checkAdminAntiLockout,
  chunkArray,
  countSubdocumentsInDocs,
  deserializeBackupData,
  isGzipBuffer,
  parseAndNormalizeBackupPayload,
  type BackupDocumentV2,
  type FirestoreDeserializationAdapters,
} from '@/lib/backup-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const firestoreAdapters: FirestoreDeserializationAdapters = {
  createTimestamp: (seconds: number, nanoseconds: number) =>
    new admin.firestore.Timestamp(seconds, nanoseconds),
  createGeoPoint: (latitude: number, longitude: number) =>
    new admin.firestore.GeoPoint(latitude, longitude),
  createDocRef: (path: string) => adminDb.doc(path),
  createBytes: (base64: string) => Buffer.from(base64, 'base64'),
};

interface FlatWriteOp {
  ref: admin.firestore.DocumentReference;
  data: Record<string, any>;
  isSubdocument: boolean;
}

function collectWriteOpsRecursive(
  colRef: admin.firestore.CollectionReference,
  docs: BackupDocumentV2[],
  isSubdocument: boolean,
  out: FlatWriteOp[]
): void {
  for (const doc of docs) {
    const docRef = colRef.doc(doc._id);
    const deserialized = deserializeBackupData(doc.data, firestoreAdapters);
    out.push({ ref: docRef, data: deserialized, isSubdocument });

    if (doc._subcollections && typeof doc._subcollections === 'object') {
      for (const [subColName, subDocs] of Object.entries(doc._subcollections)) {
        if (Array.isArray(subDocs) && subDocs.length > 0) {
          collectWriteOpsRecursive(docRef.collection(subColName), subDocs, true, out);
        }
      }
    }
  }
}

async function getCurrentCollectionCounts(
  targetNames: string[]
): Promise<Record<string, number>> {
  const existingCols = await adminDb.listCollections();
  const allNames = Array.from(
    new Set([...targetNames, ...existingCols.map((c) => c.id)])
  ).sort();

  const counts: Record<string, number> = {};
  const batches = chunkArray(allNames, 10);

  for (const batch of batches) {
    const res = await Promise.all(
      batch.map(async (name) => {
        try {
          const agg = await adminDb.collection(name).count().get();
          return { name, count: agg.data().count };
        } catch {
          const snap = await adminDb.collection(name).select().get();
          return { name, count: snap.size };
        }
      })
    );
    for (const item of res) {
      counts[item.name] = item.count;
    }
  }

  return counts;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let currentAdmin;
  try {
    currentAdmin = await ensureAdmin();
  } catch (authErr: any) {
    const message = authErr instanceof Error ? authErr.message : 'Accesso negato.';
    const status = message.includes('Token') ? 401 : 403;
    return NextResponse.json({ success: false, message }, { status });
  }

  try {
    const formData = await request.formData();
    const uploaded = formData.get('file');
    if (!uploaded || typeof uploaded === 'string') {
      return NextResponse.json(
        { success: false, message: 'Nessun file di backup caricato (campo "file" mancante).' },
        { status: 400 }
      );
    }

    const dryRunRaw = String(formData.get('dryRun') ?? 'true').toLowerCase().trim();
    const dryRun = dryRunRaw !== 'false';
    const modeRaw = String(formData.get('mode') ?? 'merge').toLowerCase().trim();
    const mode: 'merge' | 'replace' = modeRaw === 'replace' ? 'replace' : 'merge';
    const confirmToken = String(formData.get('confirmToken') ?? '').trim();

    let requestedCollections: string[] | null = null;
    const selectedRaw = formData.get('selectedCollections');
    if (typeof selectedRaw === 'string' && selectedRaw.trim()) {
      try {
        const parsedSel = JSON.parse(selectedRaw);
        if (Array.isArray(parsedSel)) {
          requestedCollections = parsedSel.map((s) => String(s).trim()).filter(Boolean);
        }
      } catch {
        return NextResponse.json(
          { success: false, message: 'Parametro "selectedCollections" non valido.' },
          { status: 400 }
        );
      }
    }

    // 1. Lettura buffer + decompressione automatica gzip tramite magic bytes 0x1f 0x8b
    const rawBuffer = Buffer.from(await uploaded.arrayBuffer());
    if (rawBuffer.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Il file caricato è vuoto.' },
        { status: 400 }
      );
    }

    let jsonText: string;
    let wasCompressed = false;
    try {
      if (isGzipBuffer(rawBuffer)) {
        wasCompressed = true;
        jsonText = gunzipSync(rawBuffer).toString('utf8');
      } else {
        jsonText = rawBuffer.toString('utf8');
      }
    } catch (decompErr: any) {
      return NextResponse.json(
        {
          success: false,
          message: `Impossibile decomprimere il file .gz: ${decompErr instanceof Error ? decompErr.message : 'archivio corrotto'}.`,
        },
        { status: 400 }
      );
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(jsonText);
    } catch (jsonErr: any) {
      return NextResponse.json(
        {
          success: false,
          message: `Il file non è un JSON valido: ${jsonErr instanceof Error ? jsonErr.message : 'errore di sintassi'}.`,
        },
        { status: 400 }
      );
    }

    // 2. Parsing + Validazione struttura & SHA-256
    let parsedBackup;
    try {
      parsedBackup = parseAndNormalizeBackupPayload(rawJson);
    } catch (parseErr: any) {
      return NextResponse.json(
        {
          success: false,
          message: parseErr instanceof Error ? parseErr.message : 'Struttura backup non valida.',
        },
        { status: 400 }
      );
    }

    const availableCollectionNames = Object.keys(parsedBackup.collections).sort();
    const selectedCollections =
      requestedCollections && requestedCollections.length > 0
        ? requestedCollections.filter((name) => availableCollectionNames.includes(name))
        : availableCollectionNames;

    const antiLockout = checkAdminAntiLockout({
      collections: parsedBackup.collections,
      selectedCollections,
      currentAdmin: {
        id: currentAdmin.id,
        uid: currentAdmin.uid,
        email: currentAdmin.email ?? null,
      },
    });

    // =========================================================================
    // STEP 1 (dryRun: true) — ANALISI & ANTEPRIMA (ZERO SCRITTURE SU FIRESTORE)
    // =========================================================================
    if (dryRun) {
      const currentCounts = await getCurrentCollectionCounts(availableCollectionNames);
      const collectionPreview = availableCollectionNames.map((name) => {
        const docs = parsedBackup.collections[name] || [];
        return {
          name,
          backupCount: docs.length,
          subdocumentsCount: countSubdocumentsInDocs(docs),
          currentDbCount: currentCounts[name] ?? 0,
        };
      });

      const dbOnlyCollections = Object.keys(currentCounts)
        .filter((name) => !availableCollectionNames.includes(name) && currentCounts[name] > 0)
        .sort()
        .map((name) => ({ name, currentDbCount: currentCounts[name] }));

      return NextResponse.json({
        success: true,
        dryRun: true,
        fileName: uploaded.name || 'backup.json',
        fileSizeBytes: rawBuffer.length,
        wasCompressed,
        detectedVersion: parsedBackup.detectedVersion,
        isLegacyV1: parsedBackup.isLegacyV1,
        exportedAt: parsedBackup.exportedAt,
        exportedBy: parsedBackup.exportedBy,
        source: parsedBackup.source,
        integrity: parsedBackup.integrity,
        collections: collectionPreview,
        dbOnlyCollections,
        totals: {
          totalCollections: parsedBackup.stats.totalCollections,
          totalDocuments: parsedBackup.stats.totalDocuments,
          totalSubdocuments: parsedBackup.stats.totalSubdocuments,
          authUsersCount: parsedBackup.authUsers.length,
          externalAssetsCount: parsedBackup.externalAssets.length,
        },
        antiLockout,
      });
    }

    // =========================================================================
    // STEP 2 (dryRun: false) — SCRITTURA SICURA A CHUNK (MAX 400 OPS/BATCH)
    // =========================================================================
    if (selectedCollections.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Seleziona almeno una collezione da ripristinare.' },
        { status: 400 }
      );
    }

    if (parsedBackup.integrity.status === 'mismatch') {
      return NextResponse.json(
        {
          success: false,
          message:
            'Verifica integrità SHA-256 fallita: il file risulta corrotto o manomesso. Ripristino bloccato per sicurezza.',
        },
        { status: 400 }
      );
    }

    if (mode === 'replace' && confirmToken !== RESTORE_CONFIRM_TOKEN) {
      return NextResponse.json(
        {
          success: false,
          message: `Conferma mancante: per la modalità "Sostituisci Selezionate" è richiesto il token "${RESTORE_CONFIRM_TOKEN}".`,
        },
        { status: 400 }
      );
    }

    const perCollectionReport: Array<{
      name: string;
      written: number;
      subdocumentsWritten: number;
      deleted: number;
      protectedAdminPreserved: boolean;
    }> = [];

    let totalWritten = 0;
    let totalSubdocumentsWritten = 0;
    let totalDeleted = 0;
    let protectedAdminDocId: string | null = null;

    for (const colName of selectedCollections) {
      const colRef = adminDb.collection(colName);
      const docs = parsedBackup.collections[colName] || [];

      // 1. Raccolta operazioni di scrittura (root + sottodocumenti)
      const writeOps: FlatWriteOp[] = [];
      collectWriteOpsRecursive(colRef, docs, false, writeOps);

      // 2. ORDINE ANTI-DISASTRO:
      //    Prima eseguiamo TUTTE le scritture a chunk di max 400 ops/batch.
      //    Solo dopo che tutte le scritture della collezione sono andate a buon fine
      //    (in modalità replace) eliminiamo gli ID preesistenti non presenti nel backup.
      const writeChunks = chunkArray(writeOps, FIRESTORE_BATCH_LIMIT);
      let colWritten = 0;
      let colSubWritten = 0;

      for (const chunk of writeChunks) {
        const batch = adminDb.batch();
        for (const op of chunk) {
          if (mode === 'merge') {
            batch.set(op.ref, op.data, { merge: true });
          } else {
            batch.set(op.ref, op.data);
          }
          if (op.isSubdocument) {
            colSubWritten++;
          } else {
            colWritten++;
          }
        }
        await batch.commit();
      }

      // 3. Pulizia ID eccedenti SOLO in modalità 'replace' (dopo successo scritture)
      let colDeleted = 0;
      let protectedAdminPreserved = false;

      if (mode === 'replace') {
        const backupIdSet = new Set(docs.map((d) => d._id));
        const existingSnap = await colRef.select().get();
        const refsToDelete: admin.firestore.DocumentReference[] = [];

        for (const existingDoc of existingSnap.docs) {
          if (backupIdSet.has(existingDoc.id)) continue;

          // Salvaguardia anti-lockout: non eliminare MAI il documento dell'admin corrente in operators
          if (colName === 'operators' && existingDoc.id === currentAdmin.id) {
            protectedAdminPreserved = true;
            protectedAdminDocId = currentAdmin.id;
            continue;
          }

          refsToDelete.push(existingDoc.ref);
        }

        const deleteChunks = chunkArray(refsToDelete, FIRESTORE_BATCH_LIMIT);
        for (const delChunk of deleteChunks) {
          const batch = adminDb.batch();
          for (const ref of delChunk) {
            batch.delete(ref);
            colDeleted++;
          }
          await batch.commit();
        }
      }

      totalWritten += colWritten;
      totalSubdocumentsWritten += colSubWritten;
      totalDeleted += colDeleted;

      perCollectionReport.push({
        name: colName,
        written: colWritten,
        subdocumentsWritten: colSubWritten,
        deleted: colDeleted,
        protectedAdminPreserved,
      });
    }

    // 4. Invalida immediatamente tutte le cache MRP / Programmazione su tutti i domini
    await bumpMrpSyncVersion(['stock', 'po', 'jobsBom'], `admin:restore-v2:${mode}`);

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      success: true,
      dryRun: false,
      mode,
      durationMs,
      totalCollectionsProcessed: selectedCollections.length,
      totalWritten,
      totalSubdocumentsWritten,
      totalDeleted,
      protectedAdminDocId,
      perCollection: perCollectionReport,
      message:
        mode === 'replace'
          ? `Ripristino (Sostituisci) completato: ${totalWritten} documenti scritti, ${totalDeleted} obsoleti rimossi su ${selectedCollections.length} collezioni.`
          : `Ripristino (Unisci/Aggiorna) completato: ${totalWritten} documenti aggiornati su ${selectedCollections.length} collezioni.`,
    });
  } catch (error: any) {
    console.error('[Restore v2] Errore durante il ripristino:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Errore durante il ripristino: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
