'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, Operator, OperatorAssignment, Department, MacroArea, Article, ProductionSettings } from '@/types';
import { startOfWeek, format, parseISO } from 'date-fns';
import { convertTimestampsToDates } from '@/lib/utils';
import { fetchInChunks } from '@/lib/firestore-utils';
import type { WorkPhaseTemplate } from '@/types';
import { getOverallStatus } from '@/lib/types';

/**
 * Salva l'allocazione di operatori per un reparto in una specifica settimana.
 * Questo alimenta i "Vasi Comunicanti" della capacità.
 */
export async function saveWeeklyAllocation(
    year: number,
    week: number,
    departmentId: string,
    assignments: { operatorId: string, hours: number }[],
    uid: string
) {
    try {
        await ensureAdmin(uid);
        const docId = `${year}_${week}_${departmentId}`;
        
        await adminDb.collection("weeklyCapacityAssignments").doc(docId).set({
            year,
            week,
            departmentId,
            assignments,
            updatedAt: admin.firestore.Timestamp.now(),
            updatedBy: uid
        });

        revalidatePath('/admin/resource-planning');
        return { success: true };
    } catch (error) {
        console.error("Error saving weekly allocation:", error);
        return { success: false, message: "Errore durante il salvataggio dell'allocazione." };
    }
}

/**
 * Salva l'allocazione massiva di UN operatore su PIU' reparti per una settimana specifica.
 */
export async function saveMassiveAllocation(
    year: number,
    week: number,
    operatorId: string,
    distributions: { departmentId: string, hours: number }[],
    uid: string
) {
    try {
        await ensureAdmin(uid);
        const batch = adminDb.batch();

        for (const dist of distributions) {
            const docId = `${year}_${week}_${dist.departmentId}`;
            const docRef = adminDb.collection("weeklyCapacityAssignments").doc(docId);
            const doc = await docRef.get();
            
            let currentAssignments: { operatorId: string, hours: number }[] = [];
            if (doc.exists) {
                const data = doc.data();
                if (data?.assignments) {
                    currentAssignments = data.assignments;
                } else if (data?.operatorIds) {
                    // Fallback per vecchi dati
                    currentAssignments = data.operatorIds.map((id: string) => ({ operatorId: id, hours: 40 }));
                }
            }

            // Aggiorniamo l'operatore specifico nel reparto
            let newAssignments = [...currentAssignments];
            const existingIdx = newAssignments.findIndex(a => a.operatorId === operatorId);
            
            if (dist.hours > 0) {
                if (existingIdx >= 0) {
                    newAssignments[existingIdx] = { ...newAssignments[existingIdx], hours: dist.hours };
                } else {
                    newAssignments.push({ operatorId, hours: dist.hours });
                }
            } else {
                // Se ore <= 0, lo rimuoviamo dal reparto
                if (existingIdx >= 0) {
                    newAssignments.splice(existingIdx, 1);
                }
            }

            batch.set(docRef, {
                year,
                week,
                departmentId: dist.departmentId,
                assignments: newAssignments,
                updatedAt: admin.firestore.Timestamp.now(),
                updatedBy: uid
            }, { merge: true });
        }

        await batch.commit();
        revalidatePath('/admin/resource-planning');
        return { success: true };
    } catch (error) {
        console.error("Error saving massive allocation:", error);
        return { success: false, message: "Errore durante il salvataggio massivo." };
    }
}

/**
 * Avanza lo stato di una commessa secondo la nuova pipeline logistica (Workflow Ibrido)
 */
export async function advanceJobStatus(jobId: string, nextStatus?: string, uid?: string) {
    try {
        if (!uid) throw new Error("Utente non specificato per operazione riservata.");
        await ensureAdmin(uid);
        
        const docRef = adminDb.collection("jobOrders").doc(jobId);
        const doc = await docRef.get();
        if (!doc.exists) throw new Error("Commessa non trovata");
        
        const data = doc.data() as JobOrder;
        
        // HARD LOCK: Impedisce l'avanzamento manuale se la commessa è incatenata in un gruppo
        if (data.workGroupId) {
            throw new Error(`AZIONE BLOCCATA: La commessa ${data.ordinePF || jobId} è gestita all'interno del gruppo ${data.workGroupId}. Esegui l'azione sull'intero gruppo dalla Console di Produzione.`);
        }

        const currentStatus = data.status;
        const pipeline = [
            'DA_INIZIARE', 
            'IN_PREPARAZIONE', 
            'PRONTO_PROD', 
            'IN_PRODUZIONE', 
            'FINE_PRODUZIONE', 
            'QLTY_PACK', 
            'CHIUSO'
        ];

        let finalStatus = nextStatus;
        if (!finalStatus) {
            const currentIndex = pipeline.indexOf(currentStatus as string);
            if (currentIndex !== -1 && currentIndex < pipeline.length - 1) {
                finalStatus = pipeline[currentIndex + 1];
            } else {
                return { success: false, message: "Stato finale già raggiunto o sconosciuto." };
            }
        }

        // BOTTOM-UP OVERRIDE: Modify phases to justify the new status.
        let updatedPhases = [...(data.phases || [])];
        
        if (finalStatus === 'PRONTO_PROD') {
            updatedPhases = updatedPhases.map(p => 
                p.type === 'preparation' ? { ...p, status: 'skipped', forced: true } : p
            );
        } else if (finalStatus === 'FINE_PRODUZIONE') {
            updatedPhases = updatedPhases.map(p => 
                (p.type === 'preparation' || p.type === 'production') ? { ...p, status: 'skipped', forced: true } : p
            );
        } else if (finalStatus === 'CHIUSO') {
            updatedPhases = updatedPhases.map(p => ({ ...p, status: 'skipped', forced: true }));
        }

        const dummyJob = { ...data, phases: updatedPhases };
        const calculatedStatus = getOverallStatus(dummyJob);

        const updates: any = {
            phases: updatedPhases,
            status: calculatedStatus,
            updatedAt: admin.firestore.Timestamp.now()
        };

        if (data.billOfMaterials && data.billOfMaterials.length > 0) {
            updates.billOfMaterials = data.billOfMaterials.map(item => {
                if (!item.withdrawn) {
                    return { ...item, status: 'withdrawn', withdrawn: true, forcedClosure: true };
                }
                return item;
            });
        }

        await docRef.update(updates);

        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');
        return { success: true, newStatus: calculatedStatus };
    } catch (error) {
        return { success: false, message: "Errore nell'avanzamento stato." };
    }
}

/**
 * Esegue la migrazione silenziosa dei vecchi stati (planned, production, etc.)
 * verso i nuovi 7 stati della pipeline logistica.
 */
export async function migrateJobOrderStatuses(uid: string) {
    try {
        await ensureAdmin(uid);
        const jobOrdersSnap = await adminDb.collection("jobOrders")
            .where("status", "in", ["planned", "production", "in-progress", "completed", "suspended", "paused"] as any[])
            .get();
        
        if (jobOrdersSnap.empty) return { success: true, count: 0 };

        const batch = adminDb.batch();
        const mapping: Record<string, any> = {
            "planned": "IN_PIANIFICAZIONE", // Gli stati IN_PIANIFICAZIONE restano invisibili nel Power Planning V2 fino all'Avvio Produzione
            "production": "IN_PRODUZIONE",
            "in-progress": "IN_PRODUZIONE",
            "completed": "FINE_PRODUZIONE",
            "suspended": "DA_INIZIARE",
            "paused": "DA_INIZIARE"
        };

        let count = 0;
        jobOrdersSnap.docs.forEach(doc => {
            const oldStatus = doc.data().status;
            const newStatus = mapping[oldStatus];
            if (newStatus) {
                batch.update(doc.ref, { 
                    status: newStatus,
                    previousStatus: oldStatus,
                    migratedAt: admin.firestore.Timestamp.now()
                });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
        }

        return { success: true, count };
    } catch (error) {
        console.error("Migration error:", error);
        return { success: false, message: "Errore durante la migrazione degli stati." };
    }
}

/**
 * Recupera i dati aggregati per il Tabellone Master Settimanale
 */
export async function getWeeklyBoardData(year: number, week: number) {
    try {
        // 1. Carica Allocazioni
        const allocationsSnap = await adminDb.collection("weeklyCapacityAssignments")
            .where("year", "==", year)
            .where("week", "==", week)
            .get();

        // 2. Carica Impostazioni Produzione
        const settingsSnap = await adminDb.collection('system').doc('productionSettings').get();
        const settings = settingsSnap.exists ? settingsSnap.data() as ProductionSettings : { capacityBufferPercent: 85 };
        
        // Riduciamo le allocazioni a un record per ID documento esatto (anno_settimana_reparto)
        const allocations = allocationsSnap.docs.reduce((acc, d) => {
            const data = d.data();
            const key = `${data.year}_${data.week}_${data.departmentId}`;
            
            // Migrazione dati: se abbiamo operatorIds ma non assignments, mappiamo a 40h (o il limite attuale)
            if (data.assignments) {
                acc[key] = data.assignments;
            } else if (data.operatorIds) {
                const limit = Math.round((8 * (settings.capacityBufferPercent / 100)) * 5);
                acc[key] = (data.operatorIds || []).map((id: string) => ({ operatorId: id, hours: limit }));
            } else {
                acc[key] = [];
            }
            return acc;
        }, {} as Record<string, { operatorId: string, hours: number }[]>);

        // 3. Carica Dati per MRP (Graceful Degradation)
        let rawMaterials: any[] = [];
        let purchaseOrders: any[] = [];
        let manualCommitments: any[] = [];
        let globalSettings: any = null;

        try {
            const [rawMaterialsSnap, purchaseOrdersSnap, manualCommitmentsSnap, globalSettingsSnap] = await Promise.all([
                adminDb.collection("rawMaterials").get(),
                adminDb.collection("purchaseOrders").get(),
                adminDb.collection("manualCommitments").get(),
                adminDb.collection("settings").doc("global").get()
            ]);

            rawMaterials = rawMaterialsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            purchaseOrders = purchaseOrdersSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            manualCommitments = manualCommitmentsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : null;
        } catch (mrpError) {
            console.error("ERRORE FETCHING DATI MRP (Power Planning):", mrpError);
            // Fallback: array vuoti già inizializzati, la board caricherà comunque i job
        }

        const jobOrdersSnap = await adminDb.collection("jobOrders").get();

        const allJobs = jobOrdersSnap.docs.map(doc => ({ 
            ...convertTimestampsToDates(doc.data() as any), 
            id: doc.id 
        } as JobOrder));

        // 3. Separa Commesse Assegnate da Backlog (Non Assegnate) rimuovendo ghosting logico
        const assignedJobs = allJobs.filter(j => 
            Boolean(j.dataConsegnaFinale) && 
            j.dataConsegnaFinale !== 'N/D' && 
            j.status !== 'CHIUSO' && 
            j.status !== 'completed' && 
            j.status !== 'shipped' && 
            j.status !== 'closed'
        );
        
        const unassignedJobs = allJobs.filter(j => 
            (!j.dataConsegnaFinale || j.dataConsegnaFinale === 'N/D') && 
            j.status !== 'CHIUSO' && 
            j.status !== 'completed' && 
            j.status !== 'shipped' && 
            j.status !== 'closed'
        );

        const payload = { 
            allocations, 
            jobOrders: assignedJobs, 
            unassignedJobs,
            settings,
            rawMaterials,
            purchaseOrders,
            manualCommitments,
            globalSettings
        };

        // SANITIZZAZIONE TOTALE: Next.js richiede che i dati delle Server Actions siano serializzabili (no Date, no Map)
        // Usiamo il trick parse/stringify per garantire la purezza del JSON e prevenire crash di serializzazione.
        return JSON.parse(JSON.stringify(payload));

    } catch (error: any) {
        console.error("ERRORE CRITICO GET WEEKLY BOARD DATA:", error);
        // Ritorniamo un oggetto di fallback sicuro invece di lanciare un errore che blocca la board
        return { 
            allocations: {}, 
            jobOrders: [], 
            unassignedJobs: [], 
            settings: { capacityBufferPercent: 85 },
            rawMaterials: [],
            purchaseOrders: [],
            manualCommitments: [],
            globalSettings: null,
            error: error.message 
        };
    }
}

export async function getPlanningWorkPhaseTemplates(): Promise<WorkPhaseTemplate[]> {
    try {
        const snapshot = await adminDb.collection('workPhaseTemplates').get();
        const templates = snapshot.docs.map(doc => doc.data() as WorkPhaseTemplate);
        return JSON.parse(JSON.stringify(templates));
    } catch (error) {
        console.error("Error fetching phase templates:", error);
        return [];
    }
}

export async function getPlanningDepartments(): Promise<Department[]> {
    try {
        const snapshot = await adminDb.collection("departments").get();
        const depts = snapshot.docs.map(d => d.data() as Department);
        return JSON.parse(JSON.stringify(depts));
    } catch (error) {
        console.error("Error fetching planning departments:", error);
        return [];
    }
}
