
'use server';

import { revalidatePath } from 'next/cache';
import { collection, query, where, getDocs, doc, setDoc, getDoc, writeBatch, deleteDoc, updateDoc, Timestamp, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JobOrder, JobPhase, WorkCycle, MaterialWithdrawal, WorkPhaseTemplate } from '@/lib/mock-data';
import * as z from 'zod';

// Helper function to sanitize Firestore document IDs
function sanitizeDocumentId(id: string): string {
  // Replace slashes with dashes, and remove other invalid characters for Firestore IDs
  return id.replace(/\//g, '-').replace(/[\.#$\[\]]/g, '');
}

// Helper function to convert Firestore Timestamps to Dates in nested objects
function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj.toDate && typeof obj.toDate === 'function') {
        return obj.toDate();
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => convertTimestampsToDates(item));
    }

    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
        newObj[key] = convertTimestampsToDates(obj[key]);
    }
    return newObj;
}

async function createPhasesFromCycle(cycleId: string): Promise<JobPhase[]> {
    if (!cycleId) return [];
    
    const cycleRef = doc(db, "workCycles", cycleId);
    const cycleSnap = await getDoc(cycleRef);
    if (!cycleSnap.exists()) {
        console.warn(`Work cycle with id ${cycleId} not found.`);
        return [];
    }
    const cycle = cycleSnap.data() as WorkCycle;
    const phaseTemplateIds = cycle.phaseTemplateIds;

    if (!phaseTemplateIds || phaseTemplateIds.length === 0) {
        return [];
    }
    
    const templatesQuery = query(collection(db, "workPhaseTemplates"));
    const templatesSnap = await getDocs(templatesQuery);
    const allTemplates = templatesSnap.docs.map(d => d.data() as WorkPhaseTemplate);
    const allTemplatesMap = new Map(allTemplates.map(t => [t.id, t]));

    let phases: JobPhase[] = phaseTemplateIds.map(templateId => {
        const template = allTemplatesMap.get(templateId);
        if (!template) return null;

        return {
            id: template.id,
            name: template.name,
            status: 'pending',
            materialReady: true, // Material is always ready for now
            workPeriods: [],
            sequence: template.sequence,
            type: template.type || 'production',
            requiresMaterialScan: template.requiresMaterialScan,
            requiresMaterialSearch: template.requiresMaterialSearch,
            allowedMaterialTypes: template.allowedMaterialTypes || [],
            departmentCodes: template.departmentCodes || [],
            materialConsumptions: [],
            qualityResult: null,
        };
    }).filter((p): p is JobPhase => p !== null);
    
    phases = phases.sort((a, b) => a.sequence - b.sequence);
    
    return phases;
}

export async function getPlannedJobOrders(): Promise<JobOrder[]> {
  const jobsRef = collection(db, "jobOrders");
  const q = query(jobsRef, where("status", "==", "planned"));
  const querySnapshot = await getDocs(q);
  const jobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
  return jobs;
}

export async function getProductionJobOrders(): Promise<JobOrder[]> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "in", ["production", "suspended"]));
    const querySnapshot = await getDocs(q);
    const jobs = querySnapshot.docs.map(doc => convertTimestampsToDates(doc.data()) as JobOrder);
    return jobs;
}

export async function processAndValidateImport(data: any[]): Promise<{
    success: boolean;
    message: string;
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    skippedCount: number;
}> {
    const newJobs: JobOrder[] = [];
    const jobsToUpdate: JobOrder[] = [];
    let skippedCount = 0;

    // Fetch all work cycles once to create a lookup map
    const workCyclesSnap = await getDocs(collection(db, "workCycles"));
    const workCyclesMap = new Map(workCyclesSnap.docs.map(doc => {
        const cycleData = doc.data() as Omit<WorkCycle, 'id'>;
        return [cycleData.name, { ...cycleData, id: doc.id }];
    }));

    const importSchema = z.object({
      cliente: z.coerce.string().optional(),
      ordinePF: z.coerce.string().min(1, "ID Commessa (ordinePF) è obbligatorio."),
      numeroODL: z.coerce.string().optional(),
      numeroODLInternoImport: z.any().optional(),
      details: z.coerce.string().optional(),
      qta: z.coerce.number().positive("La quantità deve essere un numero positivo.").optional(),
      dataConsegnaFinale: z.string().optional(),
      department: z.coerce.string().optional(),
      workCycleName: z.coerce.string().optional(),
    });

    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    
    for (const row of data) {
        const validated = importSchema.safeParse(row);
        if (!validated.success) {
            skippedCount++;
            continue;
        }
        
        const { data: validData } = validated;
        const sanitizedId = sanitizeDocumentId(validData.ordinePF);
        
        const jobRef = doc(db, "jobOrders", sanitizedId);
        const docSnap = await getDoc(jobRef);
        
        const workCycle = validData.workCycleName ? workCyclesMap.get(validData.workCycleName.trim()) : undefined;
        const workCycleId = workCycle?.id;
        const phases = workCycleId ? await createPhasesFromCycle(workCycleId) : [];

        let odlToAssign: string | null = null;
        if (validData.numeroODLInternoImport) {
            const odlString = String(validData.numeroODLInternoImport);
            const match = odlString.match(/\d+/); // Extract first sequence of digits
            if (match) {
                 odlToAssign = `${match[0]}/${shortYear}`;
            }
        }
        
        if (docSnap.exists()) {
            // We only update planned jobs. Production jobs are not updated via import.
            const existingJob = convertTimestampsToDates(docSnap.data()) as JobOrder;
            if (existingJob.status === 'planned') {
                const updatedJob: JobOrder = {
                    ...existingJob,
                    ...validData,
                    id: sanitizedId,
                    ordinePF: validData.ordinePF,
                    qta: validData.qta ?? existingJob.qta,
                    cliente: validData.cliente ?? existingJob.cliente,
                    numeroODL: validData.numeroODL ?? existingJob.numeroODL,
                    numeroODLInterno: odlToAssign ?? existingJob.numeroODLInterno,
                    details: validData.details ?? existingJob.details,
                    department: validData.department ?? existingJob.department,
                    dataConsegnaFinale: validData.dataConsegnaFinale ?? existingJob.dataConsegnaFinale,
                    workCycleId: workCycleId ?? existingJob.workCycleId,
                    phases: phases.length > 0 ? phases : existingJob.phases,
                    status: 'planned', // Always ensure status is planned on update from import
                };
                jobsToUpdate.push(updatedJob);
            } else {
                skippedCount++; // Skip updating jobs already in production
            }
        } else {
            if (validData.qta === undefined) {
                skippedCount++;
                continue; 
            }
            const department = validData.department || "Reparto Generico";
            const newJob: JobOrder = {
                id: sanitizedId,
                status: 'planned', // Always import as planned
                postazioneLavoro: 'Da Assegnare',
                phases: phases,
                cliente: validData.cliente || "N/D",
                ordinePF: validData.ordinePF,
                numeroODL: validData.numeroODL || "N/D",
                numeroODLInterno: odlToAssign,
                details: validData.details || "N/D",
                qta: validData.qta,
                dataConsegnaFinale: validData.dataConsegnaFinale || '',
                department: department,
                workCycleId: workCycleId || '',
            };
            newJobs.push(newJob);
        }
    }
    
    let message = `Analisi completata. Trovate ${newJobs.length} nuove commesse pianificate e ${jobsToUpdate.length} da aggiornare.`;
    if (skippedCount > 0) {
        message += ` ${skippedCount} righe sono state ignorate.`;
    }

    return { 
        success: true, 
        message: message,
        newJobs, 
        jobsToUpdate, 
        skippedCount
    };
}


export async function commitImportedJobOrders(data: { newJobs: JobOrder[], jobsToUpdate: JobOrder[] }): Promise<{ success: boolean; message: string; }> {
    const batch = writeBatch(db);
    let newCount = data.newJobs.length;
    let updatedCount = data.jobsToUpdate.length;

    data.newJobs.forEach(job => {
        const docRef = doc(db, "jobOrders", job.id);
        batch.set(docRef, job);
    });
    
    data.jobsToUpdate.forEach(job => {
        const docRef = doc(db, "jobOrders", job.id);
        batch.set(docRef, job, { merge: true });
    });
    
    if(newCount > 0 || updatedCount > 0) {
        await batch.commit();
    }

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return {
        success: true,
        message: `Importazione completata. ${newCount} pianificate create, ${updatedCount} aggiornate.`
    };
}


export async function deleteSelectedJobOrders(ids: string[]): Promise<{ success: boolean; message: string }> {
  if (ids.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  const batch = writeBatch(db);
  ids.forEach(id => {
    const docRef = doc(db, "jobOrders", id);
    batch.delete(docRef);
  });

  await batch.commit();
  revalidatePath('/admin/data-management');
  return { success: true, message: `${ids.length} commesse eliminate con successo.` };
}

export async function deleteAllPlannedJobOrders(): Promise<{ success: boolean; message: string }> {
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "==", "planned"));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        return { success: false, message: 'Nessuna commessa pianificata da eliminare.' };
    }

    const batch = writeBatch(db);
    let deletedCount = 0;
    querySnapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
        deletedCount++;
    });

    await batch.commit();
    revalidatePath('/admin/data-management');
    return { success: true, message: `Tutte le ${deletedCount} commesse pianificate sono state eliminate.` };
}

export async function createODL(jobId: string, manualOdlNumberStr?: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  
  try {
    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    
    const jobSnap = await getDoc(jobRef);
     if (!jobSnap.exists() || jobSnap.data().status !== 'planned') {
        throw new Error(`Commessa ${jobId} non trovata o non è in stato 'pianificata'.`);
    }
    const jobData = jobSnap.data() as JobOrder;

    // Use existing ODL if present
    if (jobData.numeroODLInterno) {
        await updateDoc(jobRef, { status: 'production', odlCreationDate: Timestamp.fromDate(now) });
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
        return { success: true, message: `Commessa ${jobId} avviata con ODL esistente #${jobData.numeroODLInterno}.` };
    }

    // If a manual ODL number is provided, perform a pre-transaction check for uniqueness.
    if (manualOdlNumberStr && manualOdlNumberStr.trim() !== '') {
      const manualOdlNumber = parseInt(manualOdlNumberStr, 10);
      if (isNaN(manualOdlNumber) || manualOdlNumber <= 0) {
        return { success: false, message: "Il numero ODL manuale fornito non è un numero valido." };
      }
      const manualOdlId = `${manualOdlNumber}/${shortYear}`;
      
      const q = query(collection(db, "jobOrders"), where("numeroODLInterno", "==", manualOdlId));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        return { success: false, message: `Errore: L'ODL ${manualOdlId} è già stato utilizzato.` };
      }
    }

    const newOdlData = await runTransaction(db, async (transaction) => {
      // Re-fetch inside transaction
      const freshDocSnap = await transaction.get(jobRef);
      if (!freshDocSnap.exists() || freshDocSnap.data().status !== 'planned') {
        throw new Error(`Commessa ${jobId} non trovata o non è in stato 'pianificata'.`);
      }
      const freshJobData = freshDocSnap.data() as JobOrder;

      // 2. Validate it has a work cycle
      if (!freshJobData.phases || freshJobData.phases.length === 0) {
        throw new Error(`La commessa ${jobId} non ha un ciclo di lavorazione associato. Impossibile creare ODL.`);
      }

      // 3. Get the counter for the current year
      const counterRef = doc(db, "counters", `odl_${year}`);
      const counterDoc = await transaction.get(counterRef);
      const currentCounter = counterDoc.data()?.value || 0;

      let newOdlId: string;
      let newCounterValue: number;

      if (manualOdlNumberStr && manualOdlNumberStr.trim() !== '') {
        newCounterValue = parseInt(manualOdlNumberStr, 10);
        newOdlId = `${newCounterValue}/${shortYear}`;
      } else {
        newCounterValue = currentCounter + 1;
        newOdlId = `${newCounterValue}/${shortYear}`;
      }
      
      // 4. Prepare update data
      const dataToUpdate = {
        status: 'production' as const,
        odlCreationDate: Timestamp.fromDate(now),
        numeroODLInterno: newOdlId,
        odlCounter: newCounterValue,
      };
      
      // 5. Perform writes within the transaction
      transaction.update(jobRef, dataToUpdate);
      if (newCounterValue > currentCounter) {
        transaction.set(counterRef, { value: newCounterValue });
      }
      
      return { newOdlId };
    });

    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return { success: true, message: `ODL #${newOdlData.newOdlId} creato per la commessa ${jobId}. La commessa è ora in produzione.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la creazione dell'ODL.";
    console.error("Failed to create ODL:", error);
    return { success: false, message: errorMessage };
  }
}

export async function createMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
    if (!jobIds || jobIds.length === 0) {
        return { success: false, message: 'Nessuna commessa selezionata.' };
    }

    let createdCount = 0;
    let startedCount = 0;
    let noCycleCount = 0;
    let alreadyInProdCount = 0;

    const now = new Date();
    const year = now.getFullYear();
    const shortYear = year.toString().slice(-2);
    const counterRef = doc(db, 'counters', `odl_${year}`);

    try {
        const jobsToProcessRefs = jobIds.map(id => doc(db, "jobOrders", id));
        const jobsSnaps = await getDocs(query(collection(db, "jobOrders"), where("__name__", "in", jobIds)));
        const jobsDataMap = new Map(jobsSnaps.docs.map(d => [d.id, d.data() as JobOrder]));

        const jobsToCreateOdlFor: string[] = [];
        const jobsToStart: string[] = [];

        for (const jobId of jobIds) {
            const jobData = jobsDataMap.get(jobId);
            if (jobData && jobData.status === 'planned') {
                if (!jobData.phases || jobData.phases.length === 0) {
                    noCycleCount++;
                } else if (jobData.numeroODLInterno) {
                    jobsToStart.push(jobId);
                } else {
                    jobsToCreateOdlFor.push(jobId);
                }
            } else {
                alreadyInProdCount++;
            }
        }
        
        let newOdlCounter = 0;
        if (jobsToCreateOdlFor.length > 0) {
            const counterDoc = await runTransaction(db, async (transaction) => {
                const counterSnap = await transaction.get(counterRef);
                const currentCounter = counterSnap.data()?.value || 0;
                newOdlCounter = currentCounter + jobsToCreateOdlFor.length;
                transaction.set(counterRef, { value: newOdlCounter });
                return newOdlCounter;
            });
            newOdlCounter = newOdlCounter - jobsToCreateOdlFor.length; // Start from the correct number
        }

        const batch = writeBatch(db);
        
        jobsToStart.forEach(jobId => {
            batch.update(doc(db, "jobOrders", jobId), { status: 'production', odlCreationDate: Timestamp.fromDate(now) });
            startedCount++;
        });
        
        jobsToCreateOdlFor.forEach(jobId => {
            newOdlCounter++;
            batch.update(doc(db, "jobOrders", jobId), {
                status: 'production',
                odlCreationDate: Timestamp.fromDate(now),
                numeroODLInterno: `${newOdlCounter}/${shortYear}`,
                odlCounter: newOdlCounter
            });
            createdCount++;
        });

        if (startedCount > 0 || createdCount > 0) {
            await batch.commit();
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante la creazione degli ODL.";
        return { success: false, message: `Operazione fallita a causa di un errore di sistema: ${errorMessage}` };
    }

    if ((createdCount + startedCount) > 0) {
        revalidatePath('/admin/data-management');
        revalidatePath('/admin/production-console');
    }
    
    let messageParts: string[] = [];
    if (startedCount > 0) messageParts.push(`${startedCount} commesse avviate.`);
    if (createdCount > 0) messageParts.push(`${createdCount} ODL creati e avviati.`);
    if (noCycleCount > 0) messageParts.push(`${noCycleCount} commesse ignorate perché senza ciclo.`);
    if (alreadyInProdCount > 0) messageParts.push(`${alreadyInProdCount} commesse già in produzione.`);

    const message = messageParts.length > 0 ? messageParts.join(' ') : 'Nessuna operazione eseguita sulle commesse selezionate.';
    
    if (createdCount + startedCount === 0 && (noCycleCount > 0 || alreadyInProdCount > 0)) {
        return { success: false, message };
    }
    
    return { success: true, message };
}


export async function cancelODL(jobId: string): Promise<{ success: boolean; message: string }> {
  const jobRef = doc(db, "jobOrders", jobId);
  
  try {
    const docSnap = await getDoc(jobRef);
    
    if (!docSnap.exists() || docSnap.data().status !== 'production') {
      return { success: false, message: `Commessa ${jobId} non trovata o non è in produzione.` };
    }

    // When canceling, we keep the ODL number for historical reference, but reset status
    await updateDoc(jobRef, { status: 'planned', odlCreationDate: null });
    
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
    return { success: true, message: `ODL per la commessa ${jobId} annullato. La commessa è di nuovo pianificata.` };
  } catch (error) {
     const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante l'annullamento dell'ODL.";
     return { success: false, message: errorMessage };
  }
}


export async function cancelMultipleODLs(jobIds: string[]): Promise<{ success: boolean; message: string }> {
  if (jobIds.length === 0) {
    return { success: false, message: 'Nessun ID fornito.' };
  }
  
  const batch = writeBatch(db);
  let canceledCount = 0;
  let failedCount = 0;

  // We can't use a transaction here for reads as we are doing a write batch,
  // so we fetch all documents first.
  const jobsToProcessRefs = jobIds.map(id => doc(db, "jobOrders", id));
  const jobDocs = await Promise.all(jobsToProcessRefs.map(ref => getDoc(ref)));

  for (const docSnap of jobDocs) {
    if (docSnap.exists() && docSnap.data().status === 'production') {
      batch.update(docSnap.ref, { status: 'planned', odlCreationDate: null });
      canceledCount++;
    } else {
      failedCount++;
    }
  }

  if (canceledCount > 0) {
    await batch.commit();
    revalidatePath('/admin/data-management');
    revalidatePath('/admin/production-console');
  }

  let message = '';
  if (canceledCount > 0) {
    message += `${canceledCount} ODL annullati con successo.`;
  }
  if (failedCount > 0) {
    message += ` ${failedCount} commesse non sono state processate perché non trovate o non in produzione.`;
  }
  
  if (canceledCount === 0 && failedCount > 0) {
      return { success: false, message: `Nessun ODL annullato. Le commesse selezionate non sono valide per questa operazione.` };
  }
  
  return { success: true, message: message.trim() };
}

export async function getWorkCycles(): Promise<WorkCycle[]> {
  const cyclesCol = collection(db, 'workCycles');
  const snapshot = await getDocs(cyclesCol);
  const list = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as WorkCycle);
  return list;
}


export async function updateJobOrderCycle(jobId: string, workCycleId: string): Promise<{ success: boolean; message: string; }> {
    const jobRef = doc(db, "jobOrders", jobId);
    const cycleRef = doc(db, "workCycles", workCycleId);

    try {
        const jobSnap = await getDoc(jobRef);
        const cycleSnap = await getDoc(cycleRef);

        if (!jobSnap.exists()) {
            return { success: false, message: "Commessa non trovata." };
        }
        if (!cycleSnap.exists()) {
            return { success: false, message: "Ciclo di lavorazione non trovato." };
        }

        const newPhases = await createPhasesFromCycle(workCycleId);

        await updateDoc(jobRef, {
            workCycleId: workCycleId,
            phases: newPhases,
        });

        revalidatePath('/admin/data-management');
        return { success: true, message: 'Ciclo di lavorazione aggiornato con successo.' };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante l'aggiornamento del ciclo.";
        console.error("Failed to update job order cycle:", error);
        return { success: false, message: errorMessage };
    }
}

export async function getJobDetailReport(jobId: string): Promise<JobOrder | null> {
    const jobRef = doc(db, "jobOrders", jobId);
    const docSnap = await getDoc(jobRef);

    if (!docSnap.exists()) {
        return null;
    }

    // Convert Firestore Timestamps to JS Dates
    return convertTimestampsToDates(docSnap.data()) as JobOrder;
}

    
