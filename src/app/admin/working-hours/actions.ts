
'use server';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import type { WorkingHoursConfig } from '@/lib/mock-data';

const CONFIG_ID = 'workingHours';
const CONFIG_COLLECTION = 'configuration';

export async function getWorkingHoursConfig(): Promise<WorkingHoursConfig> {
  try {
    const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data() as WorkingHoursConfig;
    }
    
    // Default: Mon-Fri, 8 hours single shift
    return { 
      workingDays: [1, 2, 3, 4, 5],
      shifts: [
        { id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00' }
      ]
    };
  } catch (error) {
    console.error("Error fetching working hours:", error);
    return { 
      workingDays: [1, 2, 3, 4, 5],
      shifts: [
        { id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00' }
      ]
    };
  }
}

export async function saveWorkingHoursConfig(
  config: WorkingHoursConfig,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  
  try {
    const docRef = doc(db, CONFIG_COLLECTION, CONFIG_ID);
    await setDoc(docRef, config, { merge: true });
    
    revalidatePath('/admin/working-hours');
    revalidatePath('/admin/settings');
    
    return { success: true, message: 'Configurazione orario salvata con successo.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}
