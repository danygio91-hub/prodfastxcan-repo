
'use server';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';

const CONFIG_ID = 'timeTrackingSettings';
const CONFIG_COLLECTION = 'configuration';

export interface TimeTrackingSettings {
  minimumPhaseDurationSeconds: number;
}

export async function getTimeTrackingSettings(): Promise<TimeTrackingSettings> {
  const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as TimeTrackingSettings;
  }
  
  // Default policy
  return { 
    minimumPhaseDurationSeconds: 10,
  };
}

export async function saveTimeTrackingSettings(
  settings: TimeTrackingSettings,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  
  try {
    const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
    await setDoc(docRef, settings, { merge: true });
    
    revalidatePath('/admin/time-tracking-settings');
    revalidatePath('/admin/production-time-analysis');
    
    return { success: true, message: 'Impostazioni di rilevazione tempi salvate con successo.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}
