import { describe, it, expect } from 'vitest';
import {
  BACKUP_FORMAT_ID,
  BACKUP_SCHEMA_VERSION,
  buildBackupPayloadV2,
  checkAdminAntiLockout,
  chunkArray,
  computeCanonicalCollectionsHash,
  deserializeBackupData,
  extractExternalAssetsFromCollections,
  isGzipBuffer,
  parseAndNormalizeBackupPayload,
  serializeFirestoreData,
  type BackupDocumentV2,
  type FirestoreDeserializationAdapters,
} from './backup-utils';

// Classi mock leggere per simulare i tipi nativi Firebase Admin SDK
class FakeTimestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toDate() {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000));
  }
}

class FakeGeoPoint {
  constructor(public latitude: number, public longitude: number) {}
  isEqual(other: FakeGeoPoint) {
    return this.latitude === other.latitude && this.longitude === other.longitude;
  }
}

class FakeDocRef {
  public firestore = { __mock: true };
  public id: string;
  constructor(public path: string) {
    this.id = path.split('/').pop() || '';
  }
  collection(name: string) {
    return `${this.path}/${name}`;
  }
}

const mockFirestoreAdapters: FirestoreDeserializationAdapters = {
  createTimestamp: (s, ns) => new FakeTimestamp(s, ns),
  createGeoPoint: (lat, lng) => new FakeGeoPoint(lat, lng),
  createDocRef: (path) => new FakeDocRef(path),
  createBytes: (base64) => Buffer.from(base64, 'base64'),
};

describe('FASE 103-BIS: Backup & Ripristino Completo v2 (Portabilità, Integrità, Retrocompatibilità)', () => {
  it('serializza e deserializza ricorsivamente Timestamp, Date, GeoPoint, DocRef, Bytes e array annidati (phases/batches/BOM)', () => {
    const rawJobDoc = {
      ordinePF: '888/PF.1',
      createdAt: new FakeTimestamp(1795176000, 123_000_000),
      updatedAt: new Date('2026-11-20T14:00:00.500Z'),
      legacyDegradedTs: { _seconds: 1795000000, _nanoseconds: 500_000_000 },
      articleRef: new FakeDocRef('articles/FG000063'),
      location: new FakeGeoPoint(45.4642, 9.19),
      rawBinary: Buffer.from('hello-pfxcan', 'utf8'),
      undefinedField: undefined,
      phases: [
        {
          id: 'p1',
          name: 'Taglio',
          workPeriods: [
            {
              start: new FakeTimestamp(1795176100, 0),
              end: null,
              operatorId: 'op-1',
            },
          ],
        },
      ],
      batches: [
        {
          id: 'b1',
          lotto: 'T0010-25',
          loadedAt: new Date('2026-11-10T08:30:00.000Z'),
        },
      ],
      billOfMaterials: [
        { component: '150X020X38FT-CL', quantity: 2.5, unit: 'kg', note: undefined },
      ],
    };

    const serialized = serializeFirestoreData(rawJobDoc);

    // Verifica struttura portabile JSON v2
    expect('undefinedField' in serialized).toBe(false);
    expect('note' in serialized.billOfMaterials[0]).toBe(false);
    expect(serialized.createdAt).toEqual({
      $type: 'timestamp',
      iso: new Date(1795176000 * 1000 + 123).toISOString(),
      seconds: 1795176000,
      nanoseconds: 123_000_000,
    });
    expect(serialized.updatedAt).toEqual({
      $type: 'timestamp',
      iso: '2026-11-20T14:00:00.500Z',
      seconds: 1795183200,
      nanoseconds: 500_000_000,
    });
    expect(serialized.legacyDegradedTs).toEqual({
      $type: 'timestamp',
      iso: new Date(1795000000 * 1000 + 500).toISOString(),
      seconds: 1795000000,
      nanoseconds: 500_000_000,
    });
    expect(serialized.articleRef).toEqual({ $type: 'ref', path: 'articles/FG000063' });
    expect(serialized.location).toEqual({ $type: 'geopoint', latitude: 45.4642, longitude: 9.19 });
    expect(serialized.rawBinary).toEqual({
      $type: 'bytes',
      base64: Buffer.from('hello-pfxcan', 'utf8').toString('base64'),
    });
    expect(serialized.phases[0].workPeriods[0].start.$type).toBe('timestamp');
    expect(serialized.batches[0].loadedAt.$type).toBe('timestamp');

    // Round-trip JSON + deserializzazione con adapter Firestore
    const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
    const restored = deserializeBackupData(jsonRoundTrip, mockFirestoreAdapters);

    expect(restored.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(restored.createdAt.seconds).toBe(1795176000);
    expect(restored.createdAt.nanoseconds).toBe(123_000_000);
    expect(restored.updatedAt).toBeInstanceOf(FakeTimestamp);
    expect(restored.legacyDegradedTs).toBeInstanceOf(FakeTimestamp);
    expect(restored.articleRef).toBeInstanceOf(FakeDocRef);
    expect(restored.articleRef.path).toBe('articles/FG000063');
    expect(restored.location).toBeInstanceOf(FakeGeoPoint);
    expect(restored.location.latitude).toBe(45.4642);
    expect(Buffer.isBuffer(restored.rawBinary)).toBe(true);
    expect(restored.rawBinary.toString('utf8')).toBe('hello-pfxcan');
    expect(restored.phases[0].workPeriods[0].start).toBeInstanceOf(FakeTimestamp);
    expect(restored.phases[0].workPeriods[0].end).toBeNull();
    expect(restored.batches[0].loadedAt).toBeInstanceOf(FakeTimestamp);

    // Deserializzazione diretta di timestamp degradato { _seconds, _nanoseconds } (backup v1)
    const restoredLegacy = deserializeBackupData(
      { createdAt: { _seconds: 1795000000, _nanoseconds: 0 } },
      mockFirestoreAdapters
    );
    expect(restoredLegacy.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(restoredLegacy.createdAt.seconds).toBe(1795000000);
  });

  it('calcola e verifica il checksum canonico SHA-256 e rileva qualsiasi manomissione del file v2', () => {
    const collections: Record<string, BackupDocumentV2[]> = {
      articles: [
        { _id: 'FG000063', data: { code: 'FG000063', defaultDepartmentId: 'CP' } },
      ],
      jobOrders: [
        { _id: '100-PF__2026', data: { ordinePF: '100/PF', qta: 250 } },
      ],
    };

    const payload = buildBackupPayloadV2({
      collections,
      exportedBy: { uid: 'admin-uid', email: 'admin@prodfastxcan.app', nome: 'Admin' },
      projectId: 'prodfastxcanwork',
      includeSubcollections: false,
    });

    expect(payload.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(payload.format).toBe(BACKUP_FORMAT_ID);
    expect(payload.integrity.algorithm).toBe('sha256');
    expect(payload.integrity.collectionsHash).toHaveLength(64);
    expect(payload.stats.totalCollections).toBe(2);
    expect(payload.stats.totalDocuments).toBe(2);

    // Verifica valida anche se l'ordine delle chiavi nel JSON viene mescolato
    const reorderedRaw = {
      ...payload,
      collections: {
        jobOrders: [{ _id: '100-PF__2026', data: { qta: 250, ordinePF: '100/PF' } }],
        articles: [{ _id: 'FG000063', data: { defaultDepartmentId: 'CP', code: 'FG000063' } }],
      },
    };
    const parsedValid = parseAndNormalizeBackupPayload(reorderedRaw);
    expect(parsedValid.detectedVersion).toBe(2);
    expect(parsedValid.isLegacyV1).toBe(false);
    expect(parsedValid.integrity.status).toBe('valid');

    // Manomissione di un solo valore numerico (qta: 250 -> 251) -> mismatch rilevato!
    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.collections.jobOrders[0].data.qta = 251;
    const parsedTampered = parseAndNormalizeBackupPayload(tampered);
    expect(parsedTampered.integrity.status).toBe('mismatch');
    expect(parsedTampered.integrity.actualHash).not.toBe(parsedTampered.integrity.expectedHash);
    expect(computeCanonicalCollectionsHash(tampered.collections)).toBe(parsedTampered.integrity.actualHash);
  });

  it('supporta il parsing retrocompatibile dei vecchi file Backup v1 (Legacy) normalizzando id e timestamp', () => {
    const legacyV1 = {
      jobOrders: [
        {
          id: '500-PF',
          ordinePF: '500/PF',
          createdAt: { _seconds: 1795000000, _nanoseconds: 0 },
        },
      ],
      operators: [
        {
          id: 'op-admin',
          nome: 'Admin',
          role: 'admin',
        },
      ],
    };

    const parsed = parseAndNormalizeBackupPayload(legacyV1);
    expect(parsed.detectedVersion).toBe(1);
    expect(parsed.isLegacyV1).toBe(true);
    expect(parsed.integrity.status).toBe('not_applicable');
    expect(parsed.stats.totalCollections).toBe(2);
    expect(parsed.stats.totalDocuments).toBe(2);
    expect(parsed.collections.jobOrders[0]._id).toBe('500-PF');
    expect(parsed.collections.jobOrders[0].data.createdAt).toEqual({
      $type: 'timestamp',
      iso: new Date(1795000000 * 1000).toISOString(),
      seconds: 1795000000,
      nanoseconds: 0,
    });
  });

  it('estrae il manifest externalAssets da technicalDrawingUrl e attachments[] con decodifica dello storagePath', () => {
    const collections: Record<string, BackupDocumentV2[]> = {
      articles: [
        {
          _id: 'FG000063',
          data: {
            code: 'FG000063',
            technicalDrawingUrl:
              'https://firebasestorage.googleapis.com/v0/b/prodfastxcanwork.appspot.com/o/technical_drawings%2FFG000063_179500_disegno.pdf?alt=media&token=abc',
            attachments: [
              {
                name: 'Scheda.png',
                url: 'https://firebasestorage.googleapis.com/v0/b/prodfastxcanwork.appspot.com/o/attachments%2Fscheda.png?alt=media',
              },
            ],
          },
        },
      ],
      jobOrders: [
        {
          _id: '788-PF.1__2026',
          data: {
            ordinePF: '788/PF.1',
            technicalDrawingUrl: '',
            attachments: [],
          },
        },
      ],
    };

    const assets = extractExternalAssetsFromCollections(collections);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual({
      collection: 'articles',
      docId: 'FG000063',
      field: 'technicalDrawingUrl',
      url: 'https://firebasestorage.googleapis.com/v0/b/prodfastxcanwork.appspot.com/o/technical_drawings%2FFG000063_179500_disegno.pdf?alt=media&token=abc',
      storagePath: 'technical_drawings/FG000063_179500_disegno.pdf',
    });
    expect(assets[1]).toEqual({
      collection: 'articles',
      docId: 'FG000063',
      field: 'attachments[0]',
      name: 'Scheda.png',
      url: 'https://firebasestorage.googleapis.com/v0/b/prodfastxcanwork.appspot.com/o/attachments%2Fscheda.png?alt=media',
      storagePath: 'attachments/scheda.png',
    });
  });

  it('rileva correttamente i rischi di auto-lockout admin nella collezione operators e gestisce chunking + gzip detection', () => {
    const collectionsWithAdmin: Record<string, BackupDocumentV2[]> = {
      operators: [
        { _id: 'op-1', data: { uid: 'uid-admin', email: 'admin@prodfastxcan.app', role: 'admin' } },
      ],
    };
    const okCheck = checkAdminAntiLockout({
      collections: collectionsWithAdmin,
      selectedCollections: ['operators'],
      currentAdmin: { id: 'op-1', uid: 'uid-admin', email: 'admin@prodfastxcan.app' },
    });
    expect(okCheck.adminFoundInBackup).toBe(true);
    expect(okCheck.adminHasPrivilegedRole).toBe(true);
    expect(okCheck.warningMessage).toBeNull();

    // Admin mancante dal backup -> attiva protezione e avviso
    const missingAdminCheck = checkAdminAntiLockout({
      collections: {
        operators: [
          { _id: 'op-2', data: { uid: 'uid-other', email: 'mario@prodfastxcan.app', role: 'operator' } },
        ],
      },
      selectedCollections: ['operators'],
      currentAdmin: { id: 'op-1', uid: 'uid-admin', email: 'admin@prodfastxcan.app' },
    });
    expect(missingAdminCheck.adminFoundInBackup).toBe(false);
    expect(missingAdminCheck.willProtectCurrentAdmin).toBe(true);
    expect(missingAdminCheck.warningMessage).toContain('anti-lockout');

    // Admin presente ma declassato a operator -> segnala avviso ruolo
    const demotedAdminCheck = checkAdminAntiLockout({
      collections: {
        operators: [
          { _id: 'op-1', data: { uid: 'uid-admin', email: 'admin@prodfastxcan.app', role: 'operator' } },
        ],
      },
      selectedCollections: ['operators'],
      currentAdmin: { id: 'op-1', uid: 'uid-admin', email: 'admin@prodfastxcan.app' },
    });
    expect(demotedAdminCheck.adminFoundInBackup).toBe(true);
    expect(demotedAdminCheck.adminHasPrivilegedRole).toBe(false);
    expect(demotedAdminCheck.warningMessage).toContain('ruolo');

    // Chunking <= 400 ops e rilevamento magic bytes gzip
    expect(chunkArray(Array.from({ length: 950 }, (_, i) => i), 400).map((c) => c.length)).toEqual([400, 400, 150]);
    expect(isGzipBuffer(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
    expect(isGzipBuffer(Buffer.from('{"schemaVersion":2}', 'utf8'))).toBe(false);
  });
});
