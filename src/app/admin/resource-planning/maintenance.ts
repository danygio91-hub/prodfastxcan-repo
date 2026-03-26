'use server';

import { adminDb } from '@/lib/firebase-admin';
import { ensureAdmin } from '@/lib/server-auth';

export async function migrateDepartments(uid: string) {
    try {
        await ensureAdmin(uid);
        
        const batch = adminDb.batch();

        // 1. CG -> Connessioni Grandi (PRODUZIONE)
        batch.set(adminDb.collection("departments").doc("CG"), {
            id: "CG",
            code: "CG",
            name: "Connessioni Grandi",
            macroAreas: ["PRODUZIONE"],
            dependsOnPreparation: true
        }, { merge: true });

        // 2. CP -> Connessioni Piccole (PRODUZIONE)
        batch.set(adminDb.collection("departments").doc("CP"), {
            id: "CP",
            code: "CP",
            name: "Connessioni Piccole",
            macroAreas: ["PRODUZIONE"],
            dependsOnPreparation: true
        }, { merge: true });

        // 3. BF -> Reparto Barre (PRODUZIONE)
        batch.set(adminDb.collection("departments").doc("BF"), {
            id: "BF",
            code: "BF",
            name: "Reparto Barre",
            macroAreas: ["PRODUZIONE"],
            dependsOnPreparation: true
        }, { merge: true });

        // 4. SUPPORT -> MAG+QLTY+PACK (PREPARAZIONE + QLTY_PACK)
        batch.set(adminDb.collection("departments").doc("SUPPORT"), {
            id: "SUPPORT",
            code: "SUPPORT",
            name: "MAG+QLTY+PACK",
            macroAreas: ["PREPARAZIONE", "QLTY_PACK"],
            isSharedPool: true
        }, { merge: true });

        // 5. Delete redundant departments
        const toDelete = ["MAG", "Collaudo", "Officina"];
        toDelete.forEach(id => {
            batch.delete(adminDb.collection("departments").doc(id));
        });

        await batch.commit();
        return { success: true, message: "Dipartimenti aggiornati e vecchi rimossi." };
    } catch (error) {
        console.error("Migration error:", error);
        return { success: false, message: "Errore durante la migrazione." };
    }
}
