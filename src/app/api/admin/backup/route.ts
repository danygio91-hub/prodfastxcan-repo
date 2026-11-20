import { NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import {
  buildBackupPayloadV2,
  chunkArray,
  serializeFirestoreData,
  type BackupAuthUser,
  type BackupDocumentV2,
} from '@/lib/backup-utils';
import type * as admin from 'firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readSubcollectionsRecursive(
  docRef: admin.firestore.DocumentReference
): Promise<Record<string, BackupDocumentV2[]> | undefined> {
  const subCols = await docRef.listCollections();
  if (subCols.length === 0) return undefined;

  const result: Record<string, BackupDocumentV2[]> = {};
  for (const subCol of subCols) {
    const snap = await subCol.get();
    const docs: BackupDocumentV2[] = [];
    for (const subDoc of snap.docs) {
      const nested = await readSubcollectionsRecursive(subDoc.ref);
      const entry: BackupDocumentV2 = {
        _id: subDoc.id,
        data: serializeFirestoreData(subDoc.data()),
      };
      if (nested && Object.keys(nested).length > 0) {
        entry._subcollections = nested;
      }
      docs.push(entry);
    }
    result[subCol.id] = docs;
  }
  return result;
}

async function exportAuthUsersSafe(): Promise<BackupAuthUser[]> {
  try {
    const users: BackupAuthUser[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const page = await adminAuth.listUsers(1000, pageToken);
      for (const u of page.users) {
        users.push({
          uid: u.uid,
          email: u.email ?? null,
          displayName: u.displayName ?? null,
          disabled: Boolean(u.disabled),
          createdAt: u.metadata?.creationTime ?? null,
          lastSignInAt: u.metadata?.lastSignInTime ?? null,
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);
    return users;
  } catch (err) {
    console.warn('[Backup v2] Avviso lettura authUsers (non bloccante):', err);
    return [];
  }
}

export async function GET(request: Request) {
  let adminOperator;
  try {
    adminOperator = await ensureAdmin();
  } catch (authErr: any) {
    const message = authErr instanceof Error ? authErr.message : 'Accesso negato.';
    const status = message.includes('Token') ? 401 : 403;
    return NextResponse.json({ success: false, message }, { status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const formatParam = (searchParams.get('format') || 'gzip').toLowerCase().trim();
    const useGzip = formatParam !== 'json';
    const includeSubcollections = searchParams.get('includeSubcollections') === 'true';

    // 1. Scansione dinamica di tutte le collezioni root + lettura authUsers in parallelo
    const [rootCollections, authUsers] = await Promise.all([
      adminDb.listCollections(),
      exportAuthUsersSafe(),
    ]);

    const sortedRefs = [...rootCollections].sort((a, b) => a.id.localeCompare(b.id));
    const collectionsData: Record<string, BackupDocumentV2[]> = {};

    // Lettura parallela controllata (6 collezioni per volta) per bilanciare velocità e memoria
    const colBatches = chunkArray(sortedRefs, 6);
    for (const colBatch of colBatches) {
      const results = await Promise.all(
        colBatch.map(async (colRef) => {
          const snap = await colRef.get();
          const docs: BackupDocumentV2[] = [];

          if (includeSubcollections) {
            // Scansione ricorsiva sottocollezioni con concorrenza controllata (20 doc per volta)
            const docBatches = chunkArray(snap.docs, 20);
            for (const docBatch of docBatches) {
              const mapped = await Promise.all(
                docBatch.map(async (d) => {
                  const subCols = await readSubcollectionsRecursive(d.ref);
                  const entry: BackupDocumentV2 = {
                    _id: d.id,
                    data: serializeFirestoreData(d.data()),
                  };
                  if (subCols && Object.keys(subCols).length > 0) {
                    entry._subcollections = subCols;
                  }
                  return entry;
                })
              );
              docs.push(...mapped);
            }
          } else {
            for (const d of snap.docs) {
              docs.push({
                _id: d.id,
                data: serializeFirestoreData(d.data()),
              });
            }
          }

          return { name: colRef.id, docs };
        })
      );

      for (const { name, docs } of results) {
        collectionsData[name] = docs;
      }
    }

    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      'prodfastxcanwork';

    const payload = buildBackupPayloadV2({
      collections: collectionsData,
      exportedBy: {
        uid: adminOperator.uid || adminOperator.id,
        email: adminOperator.email ?? null,
        nome: adminOperator.nome ?? null,
      },
      projectId,
      includeSubcollections,
      authUsers,
    });

    const nowStamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\.\d{3}Z$/, '');

    const summaryHeaders: Record<string, string> = {
      'Cache-Control': 'no-store, max-age=0',
      'X-Backup-Schema-Version': String(payload.schemaVersion),
      'X-Backup-Collections': String(payload.stats.totalCollections),
      'X-Backup-Documents': String(payload.stats.totalDocuments),
      'X-Backup-Subdocuments': String(payload.stats.totalSubdocuments),
      'X-Backup-Assets': String(payload.externalAssets.length),
      'X-Backup-Auth-Users': String(payload.authUsers.length),
      'X-Backup-Sha256': payload.integrity.collectionsHash,
    };

    if (useGzip) {
      const jsonString = JSON.stringify(payload);
      const gzBuffer = gzipSync(Buffer.from(jsonString, 'utf8'), { level: 6 });
      const filename = `prodfastxcan_backup_v2_${nowStamp}.json.gz`;

      return new NextResponse(new Uint8Array(gzBuffer), {
        status: 200,
        headers: {
          ...summaryHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(gzBuffer.length),
        },
      });
    }

    const prettyJson = JSON.stringify(payload, null, 2);
    const jsonBuffer = Buffer.from(prettyJson, 'utf8');
    const filename = `prodfastxcan_backup_v2_${nowStamp}.json`;

    return new NextResponse(new Uint8Array(jsonBuffer), {
      status: 200,
      headers: {
        ...summaryHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(jsonBuffer.length),
      },
    });
  } catch (error: any) {
    console.error('[Backup v2] Errore durante export completo:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Errore durante la generazione del backup: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
