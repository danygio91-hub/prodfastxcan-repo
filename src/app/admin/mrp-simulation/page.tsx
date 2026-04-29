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

async function fetchAllHydratedMaterials() {
    const materialsSnap = await adminDb.collection("rawMaterials").get();
    const materials = materialsSnap.docs.map(doc => ({ 
        ...convertTimestampsToDates(doc.data()), 
        id: doc.id 
    } as RawMaterial));
    
    return { materials };
}

export default async function AdminMrpSimulationPage() {
    const planned = await getPlannedJobOrders();
    const production = await getProductionJobOrders();
    // We don't really need completed jobs for MRP, they are already closed, 
    // but we can include them if mrp-utils uses them. Actually mrp-utils looks at pending BOM items.
    const completed = await getCompletedJobOrders();
    const allJobs = [...planned, ...production, ...completed];

    const manualCommitments = await getManualCommitments();
    const purchaseOrders = await getAllPendingPurchaseOrders();
    const globalSettings = await getGlobalSettings();
    const drafts = await getDrafts();

    // Ottimizzazione: scarichiamo l'anagrafica materiali idratata (SSoT)
    const { materials } = await fetchAllHydratedMaterials();

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
