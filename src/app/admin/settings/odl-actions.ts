'use server';

import { adminDb } from '@/lib/firebase-admin';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';
import { revalidatePath } from 'next/cache';

export async function getODLConfig(): Promise<ODLConfig> {
  try {
    const doc = await adminDb.collection("settings").doc("odl_config").get();
    if (!doc.exists) {
      return DEFAULT_ODL_CONFIG;
    }
    const data = doc.data();
    const config = { 
      ...DEFAULT_ODL_CONFIG, 
      ...data,
      colors: { ...DEFAULT_ODL_CONFIG.colors, ...(data?.colors || {}) } 
    } as ODLConfig;
    
    return config;
  } catch (error) {
    console.error("Error fetching ODL config:", error);
    return DEFAULT_ODL_CONFIG;
  }
}

export async function saveODLConfig(config: ODLConfig) {
  try {
    await adminDb.collection("settings").doc("odl_config").set(config);
    revalidatePath('/admin/data-management/print');
    revalidatePath('/admin/app-settings');
    return { success: true, message: 'Configurazione ODL salvata con successo.' };
  } catch (error) {
    console.error("Error saving ODL config:", error);
    return { success: false, message: 'Errore durante il salvataggio della configurazione.' };
  }
}
