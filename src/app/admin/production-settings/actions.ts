'use server';

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';

export interface ProductionSettings {
  capacityBufferPercent: number; // Percentuale di occupazione massima teorica (Gantt buffer)
  autoUpdateGanttIntervalHours: number; // Ogni quanto il Gantt aggiorna lo stato lavorazioni (es. 1 o 2 ore)
  prioritizeActualTime: boolean; // Se True, il Gantt predilige il Tempo Effettivo rispetto al Teorico
}

export async function getProductionSettings(): Promise<ProductionSettings> {
  const docRef = doc(db, 'system', 'productionSettings');
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data() as ProductionSettings;
  }
  return {
    capacityBufferPercent: 85,
    autoUpdateGanttIntervalHours: 1,
    prioritizeActualTime: true,
  };
}

export async function saveProductionSettings(data: ProductionSettings, uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const docRef = doc(db, 'system', 'productionSettings');
    await setDoc(docRef, data, { merge: true });
    return { success: true, message: 'Impostazioni di produzione salvate correttamente.' };
  } catch (error) {
    return { success: false, message: 'Errore durante il salvataggio delle impostazioni globali.' };
  }
}
