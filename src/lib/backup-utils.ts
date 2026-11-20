import { createHash } from 'node:crypto';

export const BACKUP_SCHEMA_VERSION = 2 as const;
export const BACKUP_FORMAT_ID = 'prodfastxcan-db-backup' as const;
export const RESTORE_CONFIRM_TOKEN = 'SOSTITUISCI' as const;
export const FIRESTORE_BATCH_LIMIT = 400;

export interface SerializedTimestamp {
  $type: 'timestamp';
  iso: string;
  seconds: number;
  nanoseconds: number;
}

export interface SerializedDocRef {
  $type: 'ref';
  path: string;
}

export interface SerializedGeoPoint {
  $type: 'geopoint';
  latitude: number;
  longitude: number;
}

export interface SerializedBytes {
  $type: 'bytes';
  base64: string;
}

export interface BackupDocumentV2 {
  _id: string;
  data: Record<string, any>;
  _subcollections?: Record<string, BackupDocumentV2[]>;
}

export interface BackupAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface BackupExternalAsset {
  collection: string;
  docId: string;
  field: string;
  name?: string;
  url: string;
  storagePath: string | null;
}

export interface BackupPayloadV2 {
  schemaVersion: 2;
  format: typeof BACKUP_FORMAT_ID;
  exportedAt: string;
  exportedBy: {
    uid: string;
    email: string | null;
    nome: string | null;
  };
  source: {
    engine: 'firestore';
    projectId: string;
    includeSubcollections: boolean;
  };
  stats: {
    totalCollections: number;
    totalDocuments: number;
    totalSubdocuments: number;
    collections: Record<string, number>;
  };
  integrity: {
    algorithm: 'sha256';
    collectionsHash: string;
  };
  collections: Record<string, BackupDocumentV2[]>;
  authUsers: BackupAuthUser[];
  externalAssets: BackupExternalAsset[];
}

export interface FirestoreDeserializationAdapters {
  createTimestamp: (seconds: number, nanoseconds: number, iso?: string) => any;
  createGeoPoint: (latitude: number, longitude: number) => any;
  createDocRef: (path: string) => any;
  createBytes: (base64: string) => any;
}

export const DEFAULT_PORTABLE_ADAPTERS: FirestoreDeserializationAdapters = {
  createTimestamp: (seconds: number, nanoseconds: number) =>
    new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000)),
  createGeoPoint: (latitude: number, longitude: number) => ({ latitude, longitude }),
  createDocRef: (path: string) => path,
  createBytes: (base64: string) => Buffer.from(base64, 'base64'),
};

function timestampPartsToIso(seconds: number, nanoseconds: number): string {
  const ms = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function dateToSerializedTimestamp(date: Date): SerializedTimestamp {
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return {
      $type: 'timestamp',
      iso: new Date(0).toISOString(),
      seconds: 0,
      nanoseconds: 0,
    };
  }
  const seconds = Math.floor(ms / 1000);
  const remainderMs = ms - seconds * 1000;
  const nanoseconds = Math.round(remainderMs * 1_000_000);
  return {
    $type: 'timestamp',
    iso: date.toISOString(),
    seconds,
    nanoseconds,
  };
}

function isPlainDegradedTimestamp(val: Record<string, any>): { seconds: number; nanoseconds: number } | null {
  const keys = Object.keys(val);
  if (keys.length !== 2) return null;
  if (
    typeof val._seconds === 'number' &&
    typeof val._nanoseconds === 'number' &&
    Number.isFinite(val._seconds) &&
    Number.isFinite(val._nanoseconds)
  ) {
    return { seconds: Math.trunc(val._seconds), nanoseconds: Math.trunc(val._nanoseconds) };
  }
  if (
    typeof val.seconds === 'number' &&
    typeof val.nanoseconds === 'number' &&
    Number.isFinite(val.seconds) &&
    Number.isFinite(val.nanoseconds)
  ) {
    return { seconds: Math.trunc(val.seconds), nanoseconds: Math.trunc(val.nanoseconds) };
  }
  return null;
}

function isAlreadySerializedSpecial(val: Record<string, any>): boolean {
  const t = val.$type;
  if (t === 'timestamp' && typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
    return true;
  }
  if (t === 'ref' && typeof val.path === 'string') {
    return true;
  }
  if (t === 'geopoint' && typeof val.latitude === 'number' && typeof val.longitude === 'number') {
    return true;
  }
  if (t === 'bytes' && typeof val.base64 === 'string') {
    return true;
  }
  return false;
}

function isFirestoreTimestampLike(val: any): boolean {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof val.toDate === 'function' &&
    typeof val.seconds === 'number' &&
    typeof val.nanoseconds === 'number'
  );
}

function isFirestoreDocRefLike(val: any): boolean {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof val.path === 'string' &&
    typeof val.id === 'string' &&
    typeof val.collection === 'function' &&
    Boolean(val.firestore)
  );
}

function isFirestoreGeoPointLike(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  if (typeof val.latitude !== 'number' || typeof val.longitude !== 'number') return false;
  const ctorName = val.constructor?.name;
  return ctorName === 'GeoPoint' || typeof val.isEqual === 'function';
}

/**
 * Serializza ricorsivamente qualsiasi valore Firestore (inclusi array/oggetti annidati come
 * phases[], batches[], billOfMaterials[], workPeriods[]) nel formato JSON v2 portabile e lossless.
 */
export function serializeFirestoreValue(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return dateToSerializedTimestamp(value);
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      $type: 'bytes',
      base64: Buffer.from(value).toString('base64'),
    } satisfies SerializedBytes;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const serialized = serializeFirestoreValue(item);
      return serialized === undefined ? null : serialized;
    });
  }

  if (typeof value === 'object') {
    if (isAlreadySerializedSpecial(value)) {
      if (value.$type === 'timestamp') {
        const seconds = Math.trunc(value.seconds);
        const nanoseconds = Math.trunc(value.nanoseconds);
        return {
          $type: 'timestamp',
          iso: typeof value.iso === 'string' && value.iso ? value.iso : timestampPartsToIso(seconds, nanoseconds),
          seconds,
          nanoseconds,
        } satisfies SerializedTimestamp;
      }
      if (value.$type === 'ref') {
        return { $type: 'ref', path: value.path } satisfies SerializedDocRef;
      }
      if (value.$type === 'geopoint') {
        return { $type: 'geopoint', latitude: value.latitude, longitude: value.longitude } satisfies SerializedGeoPoint;
      }
      if (value.$type === 'bytes') {
        return { $type: 'bytes', base64: value.base64 } satisfies SerializedBytes;
      }
    }

    if (isFirestoreTimestampLike(value)) {
      const seconds = Math.trunc(value.seconds);
      const nanoseconds = Math.trunc(value.nanoseconds);
      return {
        $type: 'timestamp',
        iso: timestampPartsToIso(seconds, nanoseconds),
        seconds,
        nanoseconds,
      } satisfies SerializedTimestamp;
    }

    if (isFirestoreDocRefLike(value)) {
      return {
        $type: 'ref',
        path: value.path,
      } satisfies SerializedDocRef;
    }

    if (isFirestoreGeoPointLike(value)) {
      return {
        $type: 'geopoint',
        latitude: value.latitude,
        longitude: value.longitude,
      } satisfies SerializedGeoPoint;
    }

    // Normalizzazione timestamp degradati (es. da backup v1 o JSON.stringify precedente)
    const degraded = isPlainDegradedTimestamp(value);
    if (degraded) {
      return {
        $type: 'timestamp',
        iso: timestampPartsToIso(degraded.seconds, degraded.nanoseconds),
        seconds: degraded.seconds,
        nanoseconds: degraded.nanoseconds,
      } satisfies SerializedTimestamp;
    }

    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      const serialized = serializeFirestoreValue(value[key]);
      if (serialized !== undefined) {
        out[key] = serialized;
      }
    }
    return out;
  }

  return null;
}

export function serializeFirestoreData(data: Record<string, any> | undefined | null): Record<string, any> {
  if (!data || typeof data !== 'object') return {};
  const result = serializeFirestoreValue(data);
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

/**
 * Deserializza ricorsivamente valori dal JSON v2 (o legacy v1 con {_seconds, _nanoseconds})
 * utilizzando gli adapter target (Firestore Admin SDK oppure adapter portabili per test/migrazione).
 */
export function deserializeBackupValue(
  value: any,
  adapters: FirestoreDeserializationAdapters = DEFAULT_PORTABLE_ADAPTERS
): any {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const restored = deserializeBackupValue(item, adapters);
      return restored === undefined ? null : restored;
    });
  }

  if (typeof value === 'object') {
    if (value.$type === 'timestamp') {
      if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
        return adapters.createTimestamp(
          Math.trunc(value.seconds),
          Math.trunc(value.nanoseconds),
          typeof value.iso === 'string' ? value.iso : undefined
        );
      }
      if (typeof value.iso === 'string') {
        const d = new Date(value.iso);
        if (!Number.isNaN(d.getTime())) {
          const serialized = dateToSerializedTimestamp(d);
          return adapters.createTimestamp(serialized.seconds, serialized.nanoseconds, serialized.iso);
        }
      }
    }

    if (value.$type === 'ref' && typeof value.path === 'string' && value.path.trim()) {
      return adapters.createDocRef(value.path.trim());
    }

    if (
      value.$type === 'geopoint' &&
      typeof value.latitude === 'number' &&
      typeof value.longitude === 'number'
    ) {
      return adapters.createGeoPoint(value.latitude, value.longitude);
    }

    if (value.$type === 'bytes' && typeof value.base64 === 'string') {
      return adapters.createBytes(value.base64);
    }

    // Normalizzazione in lettura di eventuali timestamp degradati { _seconds, _nanoseconds } o { seconds, nanoseconds }
    const degraded = isPlainDegradedTimestamp(value);
    if (degraded) {
      return adapters.createTimestamp(
        degraded.seconds,
        degraded.nanoseconds,
        timestampPartsToIso(degraded.seconds, degraded.nanoseconds)
      );
    }

    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      const restored = deserializeBackupValue(value[key], adapters);
      if (restored !== undefined) {
        out[key] = restored;
      }
    }
    return out;
  }

  return null;
}

export function deserializeBackupData(
  data: Record<string, any> | undefined | null,
  adapters: FirestoreDeserializationAdapters = DEFAULT_PORTABLE_ADAPTERS
): Record<string, any> {
  if (!data || typeof data !== 'object') return {};
  const result = deserializeBackupValue(data, adapters);
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

/**
 * Serializzazione JSON canonica con chiavi ordinate ricorsivamente per hash SHA-256 deterministico.
 */
export function canonicalJsonStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : canonicalJsonStringify(item))).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    if (value[key] === undefined) continue;
    pairs.push(`${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`);
  }
  return '{' + pairs.join(',') + '}';
}

export function computeCanonicalCollectionsHash(collections: Record<string, BackupDocumentV2[]>): string {
  const canonical = canonicalJsonStringify(collections);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function countSubdocumentsInDocs(docs: BackupDocumentV2[]): number {
  let total = 0;
  for (const doc of docs) {
    if (doc._subcollections && typeof doc._subcollections === 'object') {
      for (const subDocs of Object.values(doc._subcollections)) {
        if (Array.isArray(subDocs)) {
          total += subDocs.length + countSubdocumentsInDocs(subDocs);
        }
      }
    }
  }
  return total;
}

export function parseStoragePathFromUrl(url: string): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    return slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : null;
  }

  try {
    const parsed = new URL(trimmed);
    const oIdx = parsed.pathname.indexOf('/o/');
    if (oIdx >= 0) {
      const encodedPath = parsed.pathname.slice(oIdx + 3);
      return encodedPath ? decodeURIComponent(encodedPath) : null;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Estrae il manifest completo degli asset esterni su Firebase Storage (technicalDrawingUrl e attachments[])
 * referenziati nei documenti del backup.
 */
export function extractExternalAssetsFromCollections(
  collections: Record<string, BackupDocumentV2[]>
): BackupExternalAsset[] {
  const assets: BackupExternalAsset[] = [];
  const seen = new Set<string>();

  const registerAsset = (
    collection: string,
    docId: string,
    field: string,
    url: string,
    name?: string
  ) => {
    const cleanUrl = (url || '').trim();
    if (!cleanUrl) return;
    const dedupeKey = `${collection}|${docId}|${field}|${cleanUrl}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    assets.push({
      collection,
      docId,
      field,
      ...(name ? { name } : {}),
      url: cleanUrl,
      storagePath: parseStoragePathFromUrl(cleanUrl),
    });
  };

  const scanDocs = (collectionPath: string, docs: BackupDocumentV2[]) => {
    for (const doc of docs) {
      const data = doc.data || {};
      if (typeof data.technicalDrawingUrl === 'string' && data.technicalDrawingUrl.trim()) {
        registerAsset(collectionPath, doc._id, 'technicalDrawingUrl', data.technicalDrawingUrl);
      }

      if (Array.isArray(data.attachments)) {
        data.attachments.forEach((att: any, idx: number) => {
          if (att && typeof att === 'object' && typeof att.url === 'string' && att.url.trim()) {
            registerAsset(
              collectionPath,
              doc._id,
              `attachments[${idx}]`,
              att.url,
              typeof att.name === 'string' ? att.name : undefined
            );
          } else if (typeof att === 'string' && att.trim()) {
            registerAsset(collectionPath, doc._id, `attachments[${idx}]`, att);
          }
        });
      }

      if (doc._subcollections && typeof doc._subcollections === 'object') {
        for (const [subName, subDocs] of Object.entries(doc._subcollections)) {
          if (Array.isArray(subDocs)) {
            scanDocs(`${collectionPath}/${doc._id}/${subName}`, subDocs);
          }
        }
      }
    }
  };

  for (const [colName, docs] of Object.entries(collections)) {
    if (Array.isArray(docs)) {
      scanDocs(colName, docs);
    }
  }

  return assets;
}

export function buildBackupPayloadV2(params: {
  collections: Record<string, BackupDocumentV2[]>;
  exportedBy: { uid: string; email: string | null; nome: string | null };
  projectId: string;
  includeSubcollections: boolean;
  authUsers?: BackupAuthUser[];
  exportedAt?: string;
}): BackupPayloadV2 {
  const sortedCollections: Record<string, BackupDocumentV2[]> = {};
  const perCollectionCounts: Record<string, number> = {};
  let totalDocuments = 0;
  let totalSubdocuments = 0;

  for (const colName of Object.keys(params.collections).sort()) {
    const docs = Array.isArray(params.collections[colName]) ? params.collections[colName] : [];
    sortedCollections[colName] = docs;
    perCollectionCounts[colName] = docs.length;
    totalDocuments += docs.length;
    totalSubdocuments += countSubdocumentsInDocs(docs);
  }

  const externalAssets = extractExternalAssetsFromCollections(sortedCollections);
  const collectionsHash = computeCanonicalCollectionsHash(sortedCollections);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    format: BACKUP_FORMAT_ID,
    exportedAt: params.exportedAt || new Date().toISOString(),
    exportedBy: params.exportedBy,
    source: {
      engine: 'firestore',
      projectId: params.projectId,
      includeSubcollections: params.includeSubcollections,
    },
    stats: {
      totalCollections: Object.keys(sortedCollections).length,
      totalDocuments,
      totalSubdocuments,
      collections: perCollectionCounts,
    },
    integrity: {
      algorithm: 'sha256',
      collectionsHash,
    },
    collections: sortedCollections,
    authUsers: params.authUsers || [],
    externalAssets,
  };
}

export type IntegrityVerificationStatus = 'valid' | 'mismatch' | 'not_applicable';

export interface ParsedBackupResult {
  detectedVersion: 1 | 2;
  isLegacyV1: boolean;
  exportedAt: string | null;
  exportedBy: { uid: string; email: string | null; nome: string | null } | null;
  source: { engine: string; projectId: string; includeSubcollections?: boolean } | null;
  integrity: {
    status: IntegrityVerificationStatus;
    expectedHash: string | null;
    actualHash: string;
  };
  collections: Record<string, BackupDocumentV2[]>;
  authUsers: BackupAuthUser[];
  externalAssets: BackupExternalAsset[];
  stats: {
    totalCollections: number;
    totalDocuments: number;
    totalSubdocuments: number;
    collections: Record<string, number>;
  };
}

function validateV2DocsArray(colName: string, rawDocs: unknown): BackupDocumentV2[] {
  if (!Array.isArray(rawDocs)) {
    throw new Error(`La collezione "${colName}" non contiene un array valido di documenti.`);
  }
  return rawDocs.map((entry: any, idx: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Documento #${idx + 1} nella collezione "${colName}" non è un oggetto valido.`);
    }
    const id = typeof entry._id === 'string' && entry._id.trim() ? entry._id.trim() : '';
    if (!id) {
      throw new Error(`Documento #${idx + 1} nella collezione "${colName}" privo di "_id" valido.`);
    }
    if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      throw new Error(`Documento "${id}" nella collezione "${colName}" privo di campo "data" valido.`);
    }

    const doc: BackupDocumentV2 = {
      _id: id,
      data: entry.data,
    };

    if (entry._subcollections && typeof entry._subcollections === 'object' && !Array.isArray(entry._subcollections)) {
      const normalizedSubs: Record<string, BackupDocumentV2[]> = {};
      for (const [subName, subArr] of Object.entries(entry._subcollections)) {
        normalizedSubs[subName] = validateV2DocsArray(`${colName}/${id}/${subName}`, subArr);
      }
      if (Object.keys(normalizedSubs).length > 0) {
        doc._subcollections = normalizedSubs;
      }
    }

    return doc;
  });
}

/**
 * Valida e normalizza un payload di backup (sia v2 portabile con SHA-256 sia legacy v1).
 */
export function parseAndNormalizeBackupPayload(rawParsed: unknown): ParsedBackupResult {
  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    throw new Error('Il file selezionato non contiene un oggetto JSON di backup valido.');
  }

  const obj = rawParsed as Record<string, any>;

  // Rilevamento formato v2
  if (obj.schemaVersion === 2 || obj.format === BACKUP_FORMAT_ID) {
    if (obj.schemaVersion !== 2 || obj.format !== BACKUP_FORMAT_ID) {
      throw new Error('Versione o formato del file di backup v2 non riconosciuto.');
    }
    if (!obj.collections || typeof obj.collections !== 'object' || Array.isArray(obj.collections)) {
      throw new Error('File backup v2 non valido: blocco "collections" mancante o corrotto.');
    }

    const rawCollections = obj.collections as Record<string, unknown>;
    // Calcoliamo l'hash sul blocco collections così com'è nel file (chiavi ordinate canonicamente)
    // PRIMA di qualsiasi manipolazione, così qualsiasi alterazione viene rilevata.
    const actualHash = computeCanonicalCollectionsHash(rawCollections as Record<string, BackupDocumentV2[]>);
    const expectedHash =
      typeof obj.integrity?.collectionsHash === 'string' && obj.integrity.collectionsHash.trim()
        ? obj.integrity.collectionsHash.trim().toLowerCase()
        : null;

    const validatedCollections: Record<string, BackupDocumentV2[]> = {};
    const perCollectionCounts: Record<string, number> = {};
    let totalDocuments = 0;
    let totalSubdocuments = 0;

    for (const colName of Object.keys(rawCollections).sort()) {
      const docs = validateV2DocsArray(colName, rawCollections[colName]);
      validatedCollections[colName] = docs;
      perCollectionCounts[colName] = docs.length;
      totalDocuments += docs.length;
      totalSubdocuments += countSubdocumentsInDocs(docs);
    }

    const integrityStatus: IntegrityVerificationStatus = expectedHash
      ? actualHash === expectedHash
        ? 'valid'
        : 'mismatch'
      : 'mismatch';

    const authUsers: BackupAuthUser[] = Array.isArray(obj.authUsers) ? obj.authUsers : [];
    const externalAssets: BackupExternalAsset[] = Array.isArray(obj.externalAssets)
      ? obj.externalAssets
      : extractExternalAssetsFromCollections(validatedCollections);

    return {
      detectedVersion: 2,
      isLegacyV1: false,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
      exportedBy: obj.exportedBy && typeof obj.exportedBy === 'object' ? obj.exportedBy : null,
      source: obj.source && typeof obj.source === 'object' ? obj.source : null,
      integrity: {
        status: integrityStatus,
        expectedHash,
        actualHash,
      },
      collections: validatedCollections,
      authUsers,
      externalAssets,
      stats: {
        totalCollections: Object.keys(validatedCollections).length,
        totalDocuments,
        totalSubdocuments,
        collections: perCollectionCounts,
      },
    };
  }

  // Rilevamento formato legacy v1: { [collectionName]: Array<{ id: string, ... }> }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new Error('Il file JSON è vuoto e non contiene alcuna collezione.');
  }

  const allArrays = keys.every((k) => Array.isArray(obj[k]));
  if (!allArrays) {
    throw new Error(
      'Formato JSON non riconosciuto: atteso backup v2 (prodfastxcan-db-backup) oppure backup legacy v1 ({ collezione: [...] }).'
    );
  }

  const normalizedCollections: Record<string, BackupDocumentV2[]> = {};
  const perCollectionCounts: Record<string, number> = {};
  let totalDocuments = 0;

  for (const colName of keys.sort()) {
    const rawItems = obj[colName] as any[];
    const docs: BackupDocumentV2[] = rawItems.map((item, idx) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Elemento #${idx + 1} nella collezione legacy "${colName}" non è un oggetto valido.`);
      }
      const { id, _id, ...rest } = item;
      const docId = String(id ?? _id ?? '').trim();
      if (!docId) {
        throw new Error(`Documento #${idx + 1} nella collezione legacy "${colName}" privo di "id".`);
      }
      return {
        _id: docId,
        data: serializeFirestoreData(rest),
      };
    });

    normalizedCollections[colName] = docs;
    perCollectionCounts[colName] = docs.length;
    totalDocuments += docs.length;
  }

  const actualHash = computeCanonicalCollectionsHash(normalizedCollections);
  const externalAssets = extractExternalAssetsFromCollections(normalizedCollections);

  return {
    detectedVersion: 1,
    isLegacyV1: true,
    exportedAt: null,
    exportedBy: null,
    source: { engine: 'firestore', projectId: 'legacy-v1' },
    integrity: {
      status: 'not_applicable',
      expectedHash: null,
      actualHash,
    },
    collections: normalizedCollections,
    authUsers: [],
    externalAssets,
    stats: {
      totalCollections: Object.keys(normalizedCollections).length,
      totalDocuments,
      totalSubdocuments: 0,
      collections: perCollectionCounts,
    },
  };
}

export interface AdminAntiLockoutResult {
  operatorsIncluded: boolean;
  adminFoundInBackup: boolean;
  adminHasPrivilegedRole: boolean;
  willProtectCurrentAdmin: boolean;
  warningMessage: string | null;
}

/**
 * Controllo anti-lockout: verifica se l'amministratore corrente è presente con ruolo privilegiato
 * nel blocco `operators` del backup e segnala la protezione attiva in modalità replace.
 */
export function checkAdminAntiLockout(params: {
  collections: Record<string, BackupDocumentV2[]>;
  selectedCollections: string[];
  currentAdmin: {
    id?: string | null;
    uid?: string | null;
    email?: string | null;
  };
}): AdminAntiLockoutResult {
  const { collections, selectedCollections, currentAdmin } = params;
  const operatorsIncluded = selectedCollections.includes('operators') && Array.isArray(collections.operators);

  if (!operatorsIncluded) {
    return {
      operatorsIncluded: false,
      adminFoundInBackup: true,
      adminHasPrivilegedRole: true,
      willProtectCurrentAdmin: false,
      warningMessage: null,
    };
  }

  const ops = collections.operators || [];
  const adminId = (currentAdmin.id || '').trim();
  const adminUid = (currentAdmin.uid || '').trim();
  const adminEmail = (currentAdmin.email || '').trim().toLowerCase();

  const matched = ops.find((doc) => {
    const data = doc.data || {};
    const docUid = typeof data.uid === 'string' ? data.uid.trim() : '';
    const docEmail = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    return (
      (adminId && doc._id === adminId) ||
      (adminUid && docUid === adminUid) ||
      (adminEmail && docEmail === adminEmail)
    );
  });

  if (!matched) {
    return {
      operatorsIncluded: true,
      adminFoundInBackup: false,
      adminHasPrivilegedRole: false,
      willProtectCurrentAdmin: true,
      warningMessage:
        'Il profilo dell\'amministratore corrente non è presente nella collezione "operators" del backup. In modalità "Sostituisci Selezionate", il tuo documento operatore verrà comunque preservato automaticamente per impedire il blocco di accesso (anti-lockout).',
    };
  }

  const role = String(matched.data?.role || '').trim().toLowerCase();
  const hasPrivilegedRole = role === 'admin' || role === 'supervisor';

  if (!hasPrivilegedRole) {
    return {
      operatorsIncluded: true,
      adminFoundInBackup: true,
      adminHasPrivilegedRole: false,
      willProtectCurrentAdmin: true,
      warningMessage: `Attenzione: nel backup il tuo profilo operatore ("${matched._id}") ha ruolo "${role || 'non definito'}" invece di admin/supervisor. Verifica prima di ripristinare la collezione "operators".`,
    };
  }

  return {
    operatorsIncluded: true,
    adminFoundInBackup: true,
    adminHasPrivilegedRole: true,
    willProtectCurrentAdmin: false,
    warningMessage: null,
  };
}

export function chunkArray<T>(items: T[], chunkSize: number = FIRESTORE_BATCH_LIMIT): T[][] {
  const safeSize = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export function isGzipBuffer(buf: Buffer | Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}
