'use server';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';

const CONFIG_ID = 'concatenationPolicy';
const CONFIG_COLLECTION = 'configuration';

export interface ConcatenationPolicy {
  ungroupAfterPreparation: boolean;
  ungroupAfterProduction: boolean;
  ungroupAfterQuality: boolean;
}

export async function getConcatenationPolicy(): Promise<ConcatenationPolicy> {
  const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as ConcatenationPolicy;
  }
  
  // Default policy
  return { 
    ungroupAfterPreparation: false,
    ungroupAfterProduction: false,
    ungroupAfterQuality: false,
  };
}

export async function saveConcatenationPolicy(
  policy: ConcatenationPolicy,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  
  try {
    const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
    await setDoc(docRef, policy, { merge: true });
    
    revalidatePath('/admin/concatenation-settings');
    
    return { success: true, message: 'Impostazioni di concatenazione salvate con successo.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}
