
'use server';

import { revalidatePath } from 'next/cache';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type Reparto, initialDepartmentMap } from '@/lib/mock-data';


export async function signPrivacyPolicy(operatorId: string): Promise<{ success: boolean; message: string }> {
  const operatorRef = doc(db, "operators", operatorId);

  try {
    const docSnap = await getDoc(operatorRef);
    if (!docSnap.exists()) {
      return { success: false, message: 'Operatore non trovato.' };
    }

    await updateDoc(operatorRef, {
      privacySigned: true
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


export async function getDepartmentMap(): Promise<{ [key in Reparto]: string }> {
    const docRef = doc(db, "configuration", "departmentMap");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as { [key in Reparto]: string };
    }
    return initialDepartmentMap;
}
