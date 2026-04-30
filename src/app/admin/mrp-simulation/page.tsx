import React, { Suspense } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Loader2 } from 'lucide-react';
import MrpSimulationClientPage from './MrpSimulationClientPage';
import { getPlannedJobOrders, getProductionJobOrders, getCompletedJobOrders, getRequiredDataForJobs } from '../data-management/actions';
import { getManualCommitments } from '../raw-material-management/actions';
import { getPurchaseOrders, getAllPendingPurchaseOrders } from '../purchase-orders/actions';
import { getGlobalSettings } from '@/lib/settings-actions';
import { getDrafts } from './actions';
import { adminDb } from '@/lib/firebase-admin';
import { Article, RawMaterial } from '@/types';
import { convertTimestampsToDates } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function getAllRawMaterialsForSimulation() {
    console.log("[MRP-FETCH] Inizio scaricamento globale anagrafica materiali con idratazione SSoT...");
    
    // FETCH SSoT: Materials + Withdrawals for perfect stock parity
    const [materialsSnap, withdrawalsSnap] = await Promise.all([
        adminDb.collection("rawMaterials").get(),
        adminDb.collection("materialWithdrawals").get()
    ]);
    
    // Group withdrawals by materialId
    const withdrawalsByMaterial = new Map<string, any[]>();
    withdrawalsSnap.docs.forEach(doc => {
        const data = doc.data();
        const mid = data.materialId;
        if (!mid) return;
        if (!withdrawalsByMaterial.has(mid)) withdrawalsByMaterial.set(mid, []);
        withdrawalsByMaterial.get(mid)!.push({ ...convertTimestampsToDates(data), id: doc.id });
    });

    // Dynamically import hydration logic to keep page clean
    const { hydrateMaterialWithWithdrawals } = await import('@/lib/stock-logic');
    
    const materials = materialsSnap.docs.map(doc => {
        try {
            const rawMat = { 
                ...convertTimestampsToDates(doc.data()), 
                id: doc.id 
            } as RawMaterial;
            
            const matWithdrawals = withdrawalsByMaterial.get(doc.id) || [];
            
            // HYDRATION: Apply SSoT logic to recalculate currentQuantity per batch and totalStock
            return hydrateMaterialWithWithdrawals(rawMat, matWithdrawals);
        } catch (err) {
            console.error(`[MRP-FETCH] ERRORE idratazione materiale ${doc.id}:`, err);
            return { id: doc.id, code: 'ERROR', currentStockUnits: 0, batches: [] } as any as RawMaterial;
        }
    });
    
    console.log(`[MRP-FETCH] Scaricati e idratati ${materials.length} materiali.`);
    return { materials };
}

export default async function AdminMrpSimulationPage() {
    const planned = await getPlannedJobOrders();
    const production = await getProductionJobOrders();
    // SOURCE OF TRUTH (SSoT): Escludiamo i completati che non impegnano più stock
    const allJobs = [...planned, ...production];

    const manualCommitments = await getManualCommitments();
    const purchaseOrders = await getAllPendingPurchaseOrders();
    const globalSettings = await getGlobalSettings();
    const drafts = await getDrafts();

    // Ottimizzazione: scarichiamo l'anagrafica materiali idratata (SSoT)
    const { materials } = await getAllRawMaterialsForSimulation();

    return (
        <AdminAuthGuard>
            <AppShell>
                <Suspense fallback={
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-muted-foreground">Caricamento simulatore MRP...</p>
                    </div>
                }>
                    <MrpSimulationClientPage
                        initialArticles={[]}
                        initialMaterials={materials}
                        allJobs={allJobs}
                        purchaseOrders={purchaseOrders}
                        manualCommitments={manualCommitments}
                        globalSettings={globalSettings}
                        initialDrafts={drafts}
                    />
                </Suspense>
            </AppShell>
        </AdminAuthGuard>
    );
}
