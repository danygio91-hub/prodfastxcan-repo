
'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, MaterialWithdrawal, RawMaterial } from '@/types';

async function deleteAllFromCollection(collectionName: string) {
    const snapshot = await adminDb.collection(collectionName).get();
    const batch = adminDb.batch();
    snapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
    });
    await batch.commit();
    return snapshot.size;
}

export async function resetAllJobOrders(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobsSnapshot = await adminDb.collection("jobOrders").where("status", "in", ["planned", "production", "suspended"]).get();
    const jobsBatch = adminDb.batch();
    jobsSnapshot.forEach(doc => jobsBatch.delete(doc.ref));
    await jobsBatch.commit();
    const jobsCount = jobsSnapshot.size;

    const withdrawalsSnapshot = await adminDb.collection("materialWithdrawals").get();
    const withdrawalsBatch = adminDb.batch();
    withdrawalsSnapshot.forEach(doc => withdrawalsBatch.delete(doc.ref));
    await withdrawalsBatch.commit();
    const withdrawalsCount = withdrawalsSnapshot.size;

    if (jobsCount === 0 && withdrawalsCount === 0) {
      return { success: true, message: 'Nessuna commessa o prelievo trovato. Il database è già pulito.' };
    }

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    
    return { success: true, message: `Reset completato. ${jobsCount} commesse e ${withdrawalsCount} prelievi eliminati.` };
  } catch (error) {
    return { success: false, message: `Errore: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function resetAllRawMaterials(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const materialsCount = await deleteAllFromCollection("rawMaterials");
    const withdrawalsCount = await deleteAllFromCollection("materialWithdrawals");
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: `Reset completato. ${materialsCount} materiali e ${withdrawalsCount} prelievi eliminati.` };
  } catch (error) {
    return { success: false, message: "Errore reset materiali." };
  }
}

export async function resetAllActiveSessions(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const logoutTriggerRef = adminDb.collection('system').doc('logoutTrigger');
    await logoutTriggerRef.set({ timestamp: new Date().getTime() }, { merge: true });
    return { success: true, message: 'Segnale di reset sessioni inviato.' };
  } catch (error) {
    return { success: false, message: "Errore reset sessioni." };
  }
}

export async function backupAllData(): Promise<{ success: boolean; message: string; data?: any; }> {
    try {
        const collectionsToBackup = [
            'jobOrders',
            'rawMaterials',
            'operators',
            'workPhaseTemplates',
            'workCycles',
            'workstations',
            'materialWithdrawals',
            'nonConformityReports',
            'manualCommitments',
            'scrapRecords',
            'purchaseOrders',
            'inventoryRecords',
            'calendarExceptions',
            'workGroups',
            'counters',
            'configuration',
            'system'
        ];

        const backupData: { [key: string]: any[] } = {};
        let totalDocs = 0;

        for (const collectionName of collectionsToBackup) {
            const snapshot = await adminDb.collection(collectionName).get();
            backupData[collectionName] = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
            totalDocs += snapshot.size;
        }

        return {
            success: true,
            message: `Backup di ${totalDocs} documenti completato.`,
            data: backupData,
        };
    } catch (error) {
        return { success: false, message: "Errore durante il backup." };
    }
}

export async function restoreDataFromBackup(backupJson: string, uid: string): Promise<{ success: boolean; message: string; }> {
    try {
        await ensureAdmin(uid);
        const backupData = JSON.parse(backupJson);
        const collections = Object.keys(backupData);

        for (const collectionName of collections) {
            await deleteAllFromCollection(collectionName);
            const restoreBatch = adminDb.batch();
            const items = backupData[collectionName];
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const { id, ...data } = item;
                    restoreBatch.set(adminDb.collection(collectionName).doc(id), data);
                });
                await restoreBatch.commit();
            }
        }

        revalidatePath('/', 'layout');
        return { success: true, message: `Ripristino completato con successo.` };
    } catch (error) {
        return { success: false, message: "Errore durante il ripristino." };
    }
}

export async function resetAllPrivacySignatures(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const querySnapshot = await adminDb.collection("operators").get();
    const batch = adminDb.batch();
    let count = 0;
    querySnapshot.docs.forEach(docSnap => {
      if (docSnap.data().privacySigned === true) {
        batch.update(docSnap.ref, { privacySigned: false });
        count++;
      }
    });
    if (count > 0) await batch.commit();
    revalidatePath('/admin/operator-management');
    return { success: true, message: `Reset completato per ${count} firme.` };
  } catch (error) {
    return { success: false, message: "Errore reset privacy." };
  }
}

export async function resetAllWorkInProgress(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = adminDb.batch();
    const jobsSnapshot = await adminDb.collection("jobOrders").where("status", "in", ["production", "suspended"]).get();
    jobsSnapshot.forEach(docSnap => {
      const job = docSnap.data() as JobOrder;
      const updatedPhases = (job.phases || []).map(phase => ({
        ...phase,
        status: 'pending' as const,
        workPeriods: [],
        materialConsumption: null,
        materialReady: phase.type === 'preparation',
      }));
      batch.update(docSnap.ref, {
        status: 'planned',
        overallStartTime: null,
        overallEndTime: null,
        phases: updatedPhases,
      });
    });
    const operatorsSnapshot = await adminDb.collection("operators").where("role", "in", ["operator", "supervisor"]).get();
    operatorsSnapshot.forEach(docSnap => {
      if (docSnap.data().stato !== 'inattivo') {
        batch.update(docSnap.ref, { stato: 'inattivo', activeJobId: null, activePhaseName: null });
      }
    });
    await batch.commit();
    revalidatePath('/admin/production-console');
    return { success: true, message: 'Reset lavorazioni completato.' };
  } catch (error) {
    return { success: false, message: "Errore reset lavorazioni." };
  }
}

export async function resetRawMaterialHistory(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const materialsSnapshot = await adminDb.collection("rawMaterials").get();
    const batch = adminDb.batch();
    materialsSnapshot.forEach(doc => {
      batch.update(doc.ref, { batches: [], currentStockUnits: 0, currentWeightKg: 0 });
    });
    await batch.commit();
    await deleteAllFromCollection("materialWithdrawals");
    revalidatePath('/admin/raw-material-management');
    return { success: true, message: 'Storico materiali resettato.' };
  } catch (error) {
    return { success: false, message: "Errore reset storico." };
  }
}

export async function resetAllWithdrawals(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const withdrawalsSnapshot = await adminDb.collection("materialWithdrawals").get();
    const withdrawals = withdrawalsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as any);
    if (withdrawals.length === 0) return { success: true, message: 'Nessun prelievo da resettare.' };

    await adminDb.runTransaction(async (transaction) => {
      for (const w of withdrawals) {
          const mRef = adminDb.collection('rawMaterials').doc(w.materialId);
          const mSnap = await transaction.get(mRef);
          if (mSnap.exists) {
            const mData = mSnap.data() as any;
            transaction.update(mRef, {
              currentWeightKg: (mData.currentWeightKg || 0) + w.consumedWeight,
              currentStockUnits: (mData.currentStockUnits || 0) + (w.consumedUnits || 0)
            });
          }
          transaction.delete(adminDb.collection("materialWithdrawals").doc(w.id));
      }
    });
    revalidatePath('/admin/reports');
    return { success: true, message: 'Prelievi eliminati e stock ripristinato.' };
  } catch (error) {
    return { success: false, message: "Errore reset prelievi." };
  }
}
