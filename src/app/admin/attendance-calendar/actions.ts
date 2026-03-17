
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, Timestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CalendarException } from '@/lib/mock-data';
import { ensureAdmin } from '@/lib/server-auth';

export async function getCalendarExceptions(): Promise<CalendarException[]> {
  const col = collection(db, "calendarExceptions");
  const q = query(col, orderBy("startDate", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: d.data().createdAt?.toDate().toISOString() || null
  } as CalendarException));
}

export async function saveCalendarException(data: Omit<CalendarException, 'id' | 'createdAt'>, uid: string) {
  try {
    await ensureAdmin(uid);
    const newId = `exc-${Date.now()}`;
    const docRef = doc(db, "calendarExceptions", newId);
    
    const fullData = {
      ...data,
      createdAt: Timestamp.now(),
      createdBy: uid,
    };

    await setDoc(docRef, fullData);
    revalidatePath('/admin/attendance-calendar');
    return { success: true, message: 'Eccezione registrata con successo.' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Errore salvataggio.' };
  }
}

export async function deleteCalendarException(id: string, uid: string) {
  try {
    await ensureAdmin(uid);
    await deleteDoc(doc(db, "calendarExceptions", id));
    revalidatePath('/admin/attendance-calendar');
    return { success: true, message: 'Eccezione eliminata.' };
  } catch (error) {
    return { success: false, message: 'Errore durante l\'eliminazione.' };
  }
}
