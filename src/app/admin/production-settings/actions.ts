'use server';

import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';

import type { ProductionSettings } from '@/types';

export async function getProductionSettings(): Promise<ProductionSettings> {
  const snap = await adminDb.collection('system').doc('productionSettings').get();
  if (snap.exists) {
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
    await adminDb.collection('system').doc('productionSettings').set(data, { merge: true });
    return { success: true, message: 'Impostazioni di produzione salvate correttamente.' };
  } catch (error) {
    return { success: false, message: 'Errore durante il salvataggio delle impostazioni globali.' };
  }
}
