
'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reparti, type Reparto, initialDepartmentMap } from '@/lib/mock-data';

export async function getDepartmentMap(): Promise<{ [key in Reparto]: string }> {
  const docRef = doc(db, "configuration", "departmentMap");
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as { [key in Reparto]: string };
  } else {
    // If it doesn't exist, create it with initial data
    await setDoc(docRef, initialDepartmentMap);
    return initialDepartmentMap;
  }
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

    const docRef = doc(db, "configuration", "departmentMap");
    await setDoc(docRef, newNames);

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
