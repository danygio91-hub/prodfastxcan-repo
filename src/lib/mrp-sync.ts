import * as admin from 'firebase-admin';
import { adminDb } from './firebase-admin';
import {
  DEFAULT_MRP_SYNC_META,
  normalizeMrpSyncMeta,
  type MrpSyncDomain,
  type MrpSyncMeta,
} from './mrp-sync-utils';

export type { MrpSyncDomain, MrpSyncMeta };
export { DEFAULT_MRP_SYNC_META, normalizeMrpSyncMeta };

const MRP_SYNC_META_COLLECTION = 'settings';
const MRP_SYNC_META_DOC_ID = 'mrp_sync_meta';

/**
 * FASE 100-BIS: Incremento atomico non-bloccante del Version Token MRP (`settings/mrp_sync_meta`).
 * Incrementa `version` + il contatore di dominio specifico (`stockVersion`, `poVersion`, `jobsBomVersion`).
 *
 * VINCOLO CRITICO: Avvolto in try/catch silenziato (solo console.warn): un errore sul meta-documento
 * NON deve mai interrompere o far fallire la Server Action principale.
 */
export async function bumpMrpSyncVersion(
  domain: MrpSyncDomain | MrpSyncDomain[],
  source: string
): Promise<void> {
  try {
    const domains = Array.isArray(domain) ? domain : [domain];
    const payload: Record<string, any> = {
      version: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSource: source,
    };

    if (domains.includes('stock')) {
      payload.stockVersion = admin.firestore.FieldValue.increment(1);
    }
    if (domains.includes('po')) {
      payload.poVersion = admin.firestore.FieldValue.increment(1);
    }
    if (domains.includes('jobsBom')) {
      payload.jobsBomVersion = admin.firestore.FieldValue.increment(1);
    }

    await adminDb
      .collection(MRP_SYNC_META_COLLECTION)
      .doc(MRP_SYNC_META_DOC_ID)
      .set(payload, { merge: true });
  } catch (err) {
    console.warn(`[mrp-sync] Errore non bloccante durante bumpMrpSyncVersion(${String(domain)}, ${source}):`, err);
  }
}

/**
 * Lettura leggerissima del Version Token MRP (1 singola lettura Firestore).
 */
export async function readMrpSyncMeta(): Promise<MrpSyncMeta> {
  try {
    const snap = await adminDb
      .collection(MRP_SYNC_META_COLLECTION)
      .doc(MRP_SYNC_META_DOC_ID)
      .get();

    if (!snap.exists) {
      return { ...DEFAULT_MRP_SYNC_META };
    }
    return normalizeMrpSyncMeta(snap.data());
  } catch (err) {
    console.warn('[mrp-sync] Errore non bloccante durante readMrpSyncMeta:', err);
    return { ...DEFAULT_MRP_SYNC_META };
  }
}
