
'use server';

import { revalidatePath } from 'next/cache';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type Reparto, initialDepartmentMap } from '@/lib/mock-data';

const PRIVACY_DOC_ID = "currentPolicy";
const CONFIG_COLLECTION = "configuration";


export async function signPrivacyPolicy(operatorId: string): Promise<{ success: boolean; message: string }> {
  const operatorRef = doc(db, "operators", operatorId);
  const policyRef = doc(db, CONFIG_COLLECTION, PRIVACY_DOC_ID);

  try {
    const operatorSnap = await getDoc(operatorRef);
    const policySnap = await getDoc(policyRef);
    if (!operatorSnap.exists()) {
      return { success: false, message: 'Operatore non trovato.' };
    }
    
    const policyVersion = policySnap.exists() ? policySnap.data().lastUpdated.toMillis() : 'initial';

    await updateDoc(operatorRef, {
      privacySigned: true,
      privacyVersion: policyVersion, // Store the version of the policy they signed
    });

    // Revalidate paths to show updated data
    revalidatePath('/admin/operator-management');
    revalidatePath('/operator');
    
    return { success: true, message: 'Informativa sulla privacy firmata con successo.' };
  } catch (error) {
    console.error("Error signing privacy policy:", error);
    return { success: false, message: 'Errore durante la firma dell\'informativa.' };
  }
}


export async function getDepartmentMap(): Promise<Record<Reparto, string>> {
    const docRef = doc(db, "configuration", "departmentMap");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as Record<Reparto, string>;
    }
    return initialDepartmentMap;
}

export async function getPrivacyPolicyContent(): Promise<string> {
    const docRef = doc(db, CONFIG_COLLECTION, PRIVACY_DOC_ID);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data().content || '';
    }
    // Return a default policy if it doesn't exist
    return `<h1>Informativa sulla Riservatezza e Diritti di Proprietà</h1><p><strong>Power Flex S.r.l.</strong> detiene tutti i diritti esclusivi e la piena proprietà intellettuale sull'applicazione ProdFastXcan e su ogni suo componente, contenuto, algoritmo e dato in essa integrato o da essa generato.</p><p>È severamente vietata qualsiasi forma di divulgazione, riproduzione, distribuzione o utilizzo esterno di ProdFastXcan, in parte o per intero, senza la preventiva autorizzazione scritta di <strong>Power Flex S.r.l.</strong> Questo include, ma non si limita a, la condivisione di schermate, dati, funzionalità o logiche operative.</p><p>L'utilizzo di ProdFastXcan è esclusivamente concesso per fini interni all'azienda <strong>Power Flex S.r.l.</strong> e per le sole attività connesse ai processi di produzione. Ogni altro uso è espressamente proibito.</p><p><strong>La presente informativa è da intendersi accettata e vincolante per tutti gli utenti e collaboratori che accedono o utilizzano l'applicazione ProdFastXcan.</strong></p>`;
}
