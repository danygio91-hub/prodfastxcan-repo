
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, writeBatch, query, where, doc, runTransaction, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, MaterialWithdrawal, RawMaterial } from '@/lib/mock-data';

async function deleteAllFromCollection(collectionName: string) {
    const ref = collection(db, collectionName);
    const snapshot = await getDocs(ref);
    const batch = writeBatch(db);
    snapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
    });
    await batch.commit();
    return snapshot.size;
}

export async function resetAllJobOrders(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const jobsBatch = writeBatch(db);
    const jobsQuery = query(collection(db, "jobOrders"), where("status", "in", ["planned", "production", "suspended"]));
    const jobsSnapshot = await getDocs(jobsQuery);
    jobsSnapshot.forEach(doc => jobsBatch.delete(doc.ref));
    await jobsBatch.commit();
    const jobsCount = jobsSnapshot.size;

    const withdrawalsBatch = writeBatch(db);
    const withdrawalsRef = collection(db, "materialWithdrawals");
    const withdrawalsSnapshot = await getDocs(withdrawalsRef);
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
    const logoutTriggerRef = doc(db, 'system', 'logoutTrigger');
    await setDoc(logoutTriggerRef, { timestamp: new Date().getTime() }, { merge: true });
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
            const snapshot = await getDocs(collection(db, collectionName));
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
            const restoreBatch = writeBatch(db);
            const items = backupData[collectionName];
            if (Array.isArray(items)) {
                items.forEach(item => {
                    const { id, ...data } = item;
                    restoreBatch.set(doc(db, collectionName, id), data);
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
    const operatorsRef = collection(db, "operators");
    const querySnapshot = await getDocs(operatorsRef);
    const batch = writeBatch(db);
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
    const batch = writeBatch(db);
    const jobsQuery = query(collection(db, "jobOrders"), where("status", "in", ["production", "suspended"]));
    const jobsSnapshot = await getDocs(jobsQuery);
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
    const operatorsSnapshot = await getDocs(query(collection(db, "operators"), where("role", "in", ["operator", "supervisor"])));
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
    const materialsRef = collection(db, "rawMaterials");
    const materialsSnapshot = await getDocs(materialsRef);
    const batch = writeBatch(db);
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
    const withdrawalsSnapshot = await getDocs(collection(db, "materialWithdrawals"));
    const withdrawals = withdrawalsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as any);
    if (withdrawals.length === 0) return { success: true, message: 'Nessun prelievo da resettare.' };

    await runTransaction(db, async (transaction) => {
      for (const w of withdrawals) {
        const mRef = doc(db, 'rawMaterials', w.materialId);
        const mSnap = await transaction.get(mRef);
        if (mSnap.exists()) {
          const mData = mSnap.data();
          transaction.update(mRef, {
            currentWeightKg: (mData.currentWeightKg || 0) + w.consumedWeight,
            currentStockUnits: (mData.currentStockUnits || 0) + (w.consumedUnits || 0)
          });
        }
        transaction.delete(doc(db, "materialWithdrawals", w.id));
      }
    });
    revalidatePath('/admin/reports');
    return { success: true, message: 'Prelievi eliminati e stock ripristinato.' };
  } catch (error) {
    return { success: false, message: "Errore reset prelievi." };
  }
}
