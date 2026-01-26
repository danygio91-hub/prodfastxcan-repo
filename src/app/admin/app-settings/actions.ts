
'use server';

import { revalidatePath } from 'next/cache';
import { collection, getDocs, writeBatch, query, where, doc, runTransaction, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, MaterialWithdrawal, RawMaterial, JobPhase } from '@/lib/mock-data';

// The seedDatabase function was moved to the client component
// at /src/app/admin/app-settings/page.tsx to resolve permission errors
// by ensuring the database operation is authenticated with the user's session.

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
      return { success: true, message: 'Nessuna commessa (escluse le completate) o prelievo trovato. Il database è già pulito.' };
    }

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');
    
    return { success: true, message: `Reset completato. ${jobsCount} commesse e ${withdrawalsCount} prelievi sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle commesse:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllRawMaterials(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const materialsCount = await deleteAllFromCollection("rawMaterials");
    const withdrawalsCount = await deleteAllFromCollection("materialWithdrawals");
    
    if (materialsCount === 0 && withdrawalsCount === 0) {
      return { success: true, message: 'Nessuna materia prima o prelievo trovato. Il database è già pulito.' };
    }
    
    revalidatePath('/admin/raw-material-management');
    revalidatePath('/raw-material-scan');
    revalidatePath('/admin/reports');
    
    return { success: true, message: `Reset completato. ${materialsCount} materie prime e ${withdrawalsCount} prelievi sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle materie prime:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}


export async function resetRawMaterialHistory(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const materialsRef = collection(db, "rawMaterials");
    const materialsSnapshot = await getDocs(materialsRef);
    let updatedMaterialsCount = 0;

    const materialsBatch = writeBatch(db);
    materialsSnapshot.forEach(doc => {
      materialsBatch.update(doc.ref, {
        batches: [],
        currentStockUnits: 0,
        currentWeightKg: 0,
      });
      updatedMaterialsCount++;
    });
    await materialsBatch.commit();
    
    const withdrawalsCount = await deleteAllFromCollection("materialWithdrawals");

    if (updatedMaterialsCount === 0 && withdrawalsCount === 0) {
      return { success: true, message: 'Nessuno storico da resettare.' };
    }

    revalidatePath('/admin/raw-material-management');
    revalidatePath('/admin/reports');
    
    return { success: true, message: `Reset completato. Storico di ${updatedMaterialsCount} materie prime e ${withdrawalsCount} prelievi sono stati eliminati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset dello storico materiali:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}


export async function resetAllWithdrawals(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    
    const withdrawalsRef = collection(db, "materialWithdrawals");
    const withdrawalsSnapshot = await getDocs(withdrawalsRef);
    
    if (withdrawalsSnapshot.empty) {
      return { success: true, message: 'Nessun prelievo trovato. Il database è già pulito.' };
    }

    const withdrawals = withdrawalsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as MaterialWithdrawal);
    const deletedCount = withdrawals.length;

    await runTransaction(db, async (transaction) => {
      const materialUpdates = new Map<string, { consumedWeight: number, consumedUnits: number }>();

      for (const withdrawal of withdrawals) {
        const update = materialUpdates.get(withdrawal.materialId) || { consumedWeight: 0, consumedUnits: 0 };
        
        update.consumedWeight += (withdrawal.consumedWeight as number) || 0;
        
        if (typeof (withdrawal as any).consumedUnits === 'number') {
            update.consumedUnits += (withdrawal as any).consumedUnits;
        }

        materialUpdates.set(withdrawal.materialId, update);
      }

      const materialIds = Array.from(materialUpdates.keys());
      if (materialIds.length === 0) {
        for (const withdrawalDoc of withdrawalsSnapshot.docs) {
          transaction.delete(withdrawalDoc.ref);
        }
        return;
      }
      
      const materialRefs = materialIds.map(id => doc(db, 'rawMaterials', id));
      const materialDocs = await Promise.all(materialRefs.map(ref => transaction.get(ref)));

      for (let i = 0; i < materialDocs.length; i++) {
        const materialDoc = materialDocs[i];
        if (materialDoc.exists()) {
          const materialData = materialDoc.data() as RawMaterial;
          const updates = materialUpdates.get(materialDoc.id)!;

          const newWeight = (materialData.currentWeightKg || 0) + updates.consumedWeight;
          let newUnits = (materialData.currentStockUnits || 0) + updates.consumedUnits;
          
          transaction.update(materialDoc.ref, { 
            currentWeightKg: newWeight,
            currentStockUnits: newUnits,
          });
        }
      }
      
      for (const withdrawalDoc of withdrawalsSnapshot.docs) {
        transaction.delete(withdrawalDoc.ref);
      }
    });

    revalidatePath('/admin/reports');
    revalidatePath('/admin/raw-material-management');
    
    return { success: true, message: `Reset completato. ${deletedCount} report di prelievo sono stati eliminati e lo stock è stato ripristinato.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset dei prelievi:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}


export async function resetAllPrivacySignatures(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const operatorsRef = collection(db, "operators");
    
    const querySnapshot = await getDocs(operatorsRef);
    if (querySnapshot.empty) {
      return { success: true, message: 'Nessun operatore trovato.' };
    }

    const batch = writeBatch(db);
    let updatedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
      if (docSnap.data().privacySigned === true) {
        batch.update(docSnap.ref, { privacySigned: false });
        updatedCount++;
      }
    });
    
    if (updatedCount === 0) {
        return { success: true, message: 'Nessuna accettazione della privacy da resettare.' };
    }

    await batch.commit();

    revalidatePath('/admin/operator-management');
    revalidatePath('/operator');
    
    return { success: true, message: `Reset completato. ${updatedCount} firme della privacy sono state annullate.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle firme della privacy:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllWorkInProgress(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    const batch = writeBatch(db);

    // Reset Job Orders in production or suspended
    const jobsRef = collection(db, "jobOrders");
    const jobsQuery = query(jobsRef, where("status", "in", ["production", "suspended"]));
    const jobsSnapshot = await getDocs(jobsQuery);
    
    let jobsResetCount = 0;
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
        isProblemReported: false,
        phases: updatedPhases,
        postazioneLavoro: 'Da Assegnare',
      });
      jobsResetCount++;
    });

    // Reset Operators' status
    const operatorsRef = collection(db, "operators");
    const opsQuery = query(operatorsRef, where("role", "in", ["operator", "supervisor"]));
    const operatorsSnapshot = await getDocs(opsQuery);

    let operatorsResetCount = 0;
    operatorsSnapshot.forEach(docSnap => {
      if (docSnap.data().stato !== 'inattivo') {
        batch.update(docSnap.ref, { stato: 'inattivo' });
        operatorsResetCount++;
      }
    });

    if (jobsResetCount > 0 || operatorsResetCount > 0) {
      await batch.commit();
    }


    if (jobsResetCount === 0 && operatorsResetCount === 0) {
      return { success: true, message: 'Nessuna lavorazione in corso o operatore attivo da resettare.' };
    }


    revalidatePath('/admin/production-console');
    revalidatePath('/admin/data-management');
    revalidatePath('/scan-job');

    return { success: true, message: `Reset completato. ${jobsResetCount} commesse e ${operatorsResetCount} operatori sono stati resettati.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle lavorazioni:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
  }
}

export async function resetAllActiveSessions(uid: string): Promise<{ success: boolean; message: string }> {
  try {
    await ensureAdmin(uid);
    // This action writes/updates a global timestamp to Firestore to trigger a logout
    // on all active non-admin clients. Using setDoc with merge:true handles both creation and update.
    const logoutTriggerRef = doc(db, 'system', 'logoutTrigger');
    await setDoc(logoutTriggerRef, { timestamp: new Date().getTime() }, { merge: true });
    
    return { success: true, message: 'Segnale di reset sessioni inviato. Tutti gli operatori verranno disconnessi.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore nel reset delle sessioni:", error);
    return { success: false, message: `Si è verificato un errore: ${errorMessage}` };
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
        ];

        const backupData: { [key: string]: any[] } = {};
        let totalDocs = 0;

        for (const collectionName of collectionsToBackup) {
            const snapshot = await getDocs(collection(db, collectionName));
            backupData[collectionName] = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
            totalDocs += snapshot.size;
        }

        const configRef = doc(db, "configuration", "departmentMap");
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
            backupData['configuration'] = [{...configSnap.data(), id: 'departmentMap'}];
            totalDocs++;
        }

        return {
            success: true,
            message: `Backup di ${totalDocs} documenti completato con successo.`,
            data: backupData,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore durante il backup.";
        console.error("Errore nel backup:", error);
        return { success: false, message: errorMessage };
    }
}


export async function restoreDataFromBackup(backupJson: string, uid: string): Promise<{ success: boolean; message: string; }> {
    try {
        await ensureAdmin(uid);

        const collectionsToRestore = [
            'jobOrders', 'rawMaterials', 'operators', 'workPhaseTemplates',
            'workCycles', 'workstations', 'materialWithdrawals', 'nonConformityReports',
            'configuration'
        ];

        // 1. Delete all current data
        for (const collectionName of collectionsToRestore) {
            await deleteAllFromCollection(collectionName);
        }

        // 2. Parse backup data
        const backupData = JSON.parse(backupJson);

        // 3. Restore data from backup
        const restoreBatch = writeBatch(db);
        let restoredDocs = 0;

        for (const collectionName of collectionsToRestore) {
            if (backupData[collectionName]) {
                for (const item of backupData[collectionName]) {
                    const { id, ...data } = item;
                    const docRef = doc(db, collectionName, id);
                    restoreBatch.set(docRef, data);
                    restoredDocs++;
                }
            }
        }
        
        await restoreBatch.commit();

        revalidatePath('/', 'layout');

        return { success: true, message: `Ripristino completato. ${restoredDocs} documenti sono stati ripristinati.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Si è verificato un errore durante il ripristino.";
        console.error("Errore nel ripristino:", error);
        return { success: false, message: errorMessage };
    }
}

  

    