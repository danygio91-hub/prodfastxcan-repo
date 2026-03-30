
'use server';

import { adminDb } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import type { WorkingHoursConfig } from '@/types';

const CONFIG_ID = 'workingHours';
const CONFIG_COLLECTION = 'configuration';

export async function getWorkingHoursConfig(): Promise<WorkingHoursConfig> {
  try {
    const docRef = adminDb.collection(CONFIG_COLLECTION).doc(CONFIG_ID);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      const data = docSnap.data();
      if (!data) throw new Error("No data found");
      return { 
        workingDays: data.workingDays || [1, 2, 3, 4, 5],
        shifts: data.shifts || [{ id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }],
        efficiencyPercentage: data.efficiencyPercentage || 95
      };
    }
    
    // Default: Mon-Fri, 8 hours single shift
    return { 
      workingDays: [1, 2, 3, 4, 5],
      shifts: [
        { id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }
      ],
      efficiencyPercentage: 95
    };
  } catch (error) {
    console.error("Error fetching working hours:", error);
    return { 
      workingDays: [1, 2, 3, 4, 5],
      shifts: [
        { id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }
      ],
      efficiencyPercentage: 95
    };
  }
}

export async function saveWorkingHoursConfig(
  config: WorkingHoursConfig,
  uid: string
): Promise<{ success: boolean; message: string }> {
  await ensureAdmin(uid);
  
  try {
    const docRef = adminDb.collection(CONFIG_COLLECTION).doc(CONFIG_ID);
    await docRef.set(config, { merge: true });
    
    revalidatePath('/admin/working-hours');
    revalidatePath('/admin/settings');
    
    return { success: true, message: 'Configurazione orario salvata con successo.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
    return { success: false, message: errorMessage };
  }
}
