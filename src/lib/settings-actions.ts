
'use server';

import { adminDb } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { ensureAdmin } from '@/lib/server-auth';
import { GlobalSettings, DEFAULT_GLOBAL_SETTINGS } from './settings-types';

export async function getGlobalSettings(): Promise<GlobalSettings> {
  try {
    const doc = await adminDb.collection('settings').doc('global').get();
    if (!doc.exists) {
      return DEFAULT_GLOBAL_SETTINGS;
    }
    const data = doc.data() as GlobalSettings;
    // Merge with defaults to ensure all fields exist if new ones are added in code
    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      ...data,
      rawMaterialTypes: data.rawMaterialTypes || DEFAULT_GLOBAL_SETTINGS.rawMaterialTypes,
      unitsOfMeasure: data.unitsOfMeasure || DEFAULT_GLOBAL_SETTINGS.unitsOfMeasure,
      productionProblemTypes: data.productionProblemTypes || DEFAULT_GLOBAL_SETTINGS.productionProblemTypes,
      phaseTypes: data.phaseTypes || DEFAULT_GLOBAL_SETTINGS.phaseTypes,
      materialSessionCategories: data.materialSessionCategories || DEFAULT_GLOBAL_SETTINGS.materialSessionCategories,
    };
  } catch (error) {
    console.error("Error fetching global settings:", error);
    return DEFAULT_GLOBAL_SETTINGS;
  }
}

export async function updateGlobalSettings(settings: GlobalSettings, uid: string) {
  try {
    await ensureAdmin(uid);
    await adminDb.collection('settings').doc('global').set(settings);
    revalidatePath('/admin/settings/parameters');
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/production-console');
    return { success: true };
  } catch (error) {
    console.error("Error updating global settings:", error);
    return { success: false, message: 'Errore durante il salvataggio delle impostazioni.' };
  }
}
