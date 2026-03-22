
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { Operator } from '@/lib/mock-data';

const PRIVACY_DOC_ID = "currentPolicy";
const CONFIG_COLLECTION = "configuration";

export async function getPrivacyPolicy(): Promise<{ content: string; lastUpdated: string | null }> {
  try {
    const docSnap = await adminDb.collection(CONFIG_COLLECTION).doc(PRIVACY_DOC_ID).get();

    if (docSnap.exists) {
      const data = docSnap.data();
      if (!data) throw new Error("Documento vuoto.");
      return {
        content: data.content || '',
        lastUpdated: data.lastUpdated?.toDate().toISOString() || null,
      };
    } else {
      // Return a default policy if it doesn't exist
      return {
        content: `<h1>Informativa sulla Riservatezza e Diritti di Proprietà</h1><p><strong>Power Flex S.r.l.</strong> detiene tutti i diritti esclusivi e la piena proprietà intellettuale sull'applicazione ProdFastXcan e su ogni suo componente, contenuto, algoritmo e dato in essa integrato o da essa generato.</p><p>È severamente vietata qualsiasi forma di divulgazione, riproduzione, distribuzione o utilizzo esterno di ProdFastXcan, in parte o per intero, senza la preventiva autorizzazione scritta di <strong>Power Flex S.r.l.</strong> Questo include, ma non si limita a, la condivisione di schermate, dati, funzionalità o logiche operative.</p><p>L'utilizzo di ProdFastXcan è esclusivamente concesso per fini interni all'azienda <strong>Power Flex S.r.l.</strong> e per le sole attività connesse ai processi di produzione. Ogni altro uso è espressamente proibito.</p><p><strong>La presente informativa è da intendersi accettata e vincolante per tutti gli utenti e collaboratori che accedono o utilizzano l'applicazione ProdFastXcan.</strong></p>`,
        lastUpdated: null,
      };
    }
  } catch (error) {
    console.error("Error fetching privacy policy:", error);
    throw new Error("Impossibile recuperare l'informativa sulla privacy.");
  }
}

export async function savePrivacyPolicy(
  content: string,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);

  try {
    const policyRef = adminDb.collection(CONFIG_COLLECTION).doc(PRIVACY_DOC_ID);

    // Reset privacy signature for all non-admin operators
    const operatorsSnapshot = await adminDb.collection("operators").where("role", "!=", "admin").get();
    
    const batch = adminDb.batch();

    operatorsSnapshot.forEach(docSnap => {
      batch.update(docSnap.ref, { privacySigned: false, privacyVersion: null });
    });
    
    const newVersion = new Date();
    batch.set(policyRef, {
        content: content,
        lastUpdated: newVersion,
    }, { merge: true });
    
    await batch.commit();

    revalidatePath('/admin/privacy-management');
    revalidatePath('/operator');
    
    return {
      success: true,
      message: `Informativa sulla privacy salvata. La firma è stata richiesta nuovamente a ${operatorsSnapshot.size} operatori.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    console.error("Error saving privacy policy:", error);
    return { success: false, message: errorMessage };
  }
}
