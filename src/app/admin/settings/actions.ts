'use server';

import { revalidatePath } from 'next/cache';
import { departmentMap, reparti, type Reparto } from '@/lib/mock-data';

export async function getDepartmentMap(): Promise<{ [key in Reparto]: string }> {
  // Return a copy to avoid client-side mutations affecting the server state
  return JSON.parse(JSON.stringify(departmentMap));
}

export async function updateDepartmentNames(formData: FormData): Promise<{ success: boolean; message: string; }> {
  try {
    const newNames: { [key: string]: string } = {};
    for (const code of reparti) {
      const value = formData.get(code) as string;
      if (value && value.trim() !== '') {
        newNames[code] = value.trim();
      } else {
        return { success: false, message: `Il nome per il reparto ${code} non può essere vuoto.` };
      }
    }

    // Update the in-memory store
    for (const code in newNames) {
        if (departmentMap.hasOwnProperty(code)) {
            departmentMap[code as Reparto] = newNames[code];
        }
    }

    // Revalidate paths that might display department names
    revalidatePath('/admin/settings');
    revalidatePath('/admin/operator-management');
    revalidatePath('/operator-data');
    revalidatePath('/scan-job');
    revalidatePath('/admin/data-management');


    return { success: true, message: 'Nomi dei reparti aggiornati con successo.' };
  } catch (error) {
    return { success: false, message: "Si è verificato un errore durante l'aggiornamento." };
  }
}
