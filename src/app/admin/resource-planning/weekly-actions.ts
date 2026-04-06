'use server';

import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';
import type { JobOrder, Operator, OperatorAssignment, Department, MacroArea, Article } from '@/types';
import { startOfWeek, format, parseISO } from 'date-fns';
import { convertTimestampsToDates } from '@/lib/utils';
import { fetchInChunks } from '@/lib/firestore-utils';

/**
 * Salva l'allocazione di operatori per un reparto in una specifica settimana.
 * Questo alimenta i "Vasi Comunicanti" della capacità.
 */
export async function saveWeeklyAllocation(
    year: number,
    week: number,
    departmentId: string,
    operatorIds: string[],
    uid: string
) {
    try {
        await ensureAdmin(uid);
        const docId = `${year}_${week}_${departmentId}`;
        
        await adminDb.collection("weeklyCapacityAssignments").doc(docId).set({
            year,
            week,
            departmentId,
            operatorIds,
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
 * Avanza lo stato di una commessa secondo la nuova pipeline logistica (Workflow Ibrido)
 */
export async function advanceJobStatus(jobId: string, nextStatus?: string, uid?: string) {
    try {
        const docRef = adminDb.collection("jobOrders").doc(jobId);
        const doc = await docRef.get();
        if (!doc.exists) throw new Error("Commessa non trovata");
        
        const currentStatus = doc.data()?.status;
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
            const currentIndex = pipeline.indexOf(currentStatus);
            if (currentIndex !== -1 && currentIndex < pipeline.length - 1) {
                finalStatus = pipeline[currentIndex + 1];
            } else {
                return { success: false, message: "Stato finale già raggiunto o sconosciuto." };
            }
        }

        await docRef.update({
            status: finalStatus,
            updatedAt: admin.firestore.Timestamp.now()
        });

        revalidatePath('/admin/resource-planning');
        revalidatePath('/admin/production-console');
        return { success: true, newStatus: finalStatus };
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
            "planned": "DA_INIZIARE",
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
    // 1. Carica Allocazioni
    const allocationsSnap = await adminDb.collection("weeklyCapacityAssignments")
        .where("year", "==", year)
        .where("week", "==", week)
        .get();
    
    // Riduciamo le allocazioni a un record per ID documento esatto (anno_settimana_reparto)
    const allocations = allocationsSnap.docs.reduce((acc, d) => {
        const data = d.data();
        const key = `${data.year}_${data.week}_${data.departmentId}`;
        acc[key] = data.operatorIds;
        return acc;
    }, {} as Record<string, string[]>);

    // 2. Carica TUTTE le commesse attive (non Chiuse)
    // Includiamo anche i vecchi stati per sicurezza in caso la migrazione non sia ancora avvenuta
    const activeStatuses = [
        'DA_INIZIARE', 'IN_PREPARAZIONE', 'PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK',
        'planned', 'production', 'in-progress', 'completed', 'suspended', 'paused'
    ] as any[];
    
    const jobOrdersSnap = await adminDb.collection("jobOrders")
        .where("status", "in", activeStatuses)
        .get();
    
    const allJobs = jobOrdersSnap.docs.map(doc => ({ 
        ...convertTimestampsToDates(doc.data() as any), 
        id: doc.id 
    } as JobOrder));

    // 3. Separa Commesse Assegnate da Backlog (Non Assegnate)
    const assignedJobs = allJobs.filter(j => j.assignedDate);
    const unassignedJobs = allJobs.filter(j => !j.assignedDate);

    return { 
        allocations, 
        jobOrders: assignedJobs, 
        unassignedJobs 
    };
}
