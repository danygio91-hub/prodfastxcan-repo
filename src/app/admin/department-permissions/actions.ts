'use server';

import { revalidatePath } from 'next/cache';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Department } from '@/lib/mock-data';

export type PhaseType = 'preparation' | 'production' | 'quality' | 'packaging';

export interface DepartmentPermissions {
  departmentCode: string;
  departmentName: string;
  allowedPhaseTypes: PhaseType[];
}

export async function getDepartments(): Promise<Department[]> {
  const col = collection(db, "departments");
  const snapshot = await getDocs(col);
  if (snapshot.empty) {
      return [];
  }
  return snapshot.docs.map(d => ({id: d.id, ...d.data()} as Department));
}


export async function getDepartmentPermissions(): Promise<DepartmentPermissions[]> {
    const departments = await getDepartments();
    const permissions: DepartmentPermissions[] = [];

    for (const dept of departments) {
        const docRef = doc(db, "departmentPermissions", dept.code);
        const docSnap = await getDoc(docRef);
        
        let allowedPhaseTypes: PhaseType[] = [];
        if (docSnap.exists()) {
            allowedPhaseTypes = docSnap.data().allowedPhaseTypes || [];
        }

        permissions.push({
            departmentCode: dept.code,
            departmentName: dept.name,
            allowedPhaseTypes: allowedPhaseTypes,
        });
    }

    return permissions;
}

export async function saveDepartmentPermission(departmentCode: string, allowedPhaseTypes: PhaseType[]): Promise<{ success: boolean; message: string; }> {
    try {
        if (!departmentCode) {
            return { success: false, message: 'Codice reparto non valido.' };
        }
        
        const docRef = doc(db, "departmentPermissions", departmentCode);
        await setDoc(docRef, { allowedPhaseTypes });

        revalidatePath('/admin/department-permissions');

        return { success: true, message: 'Permessi aggiornati con successo.' };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore sconosciuto.";
        console.error("Errore salvataggio permessi reparto:", error);
        return { success: false, message: errorMessage };
    }
}
