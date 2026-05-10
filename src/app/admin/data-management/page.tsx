
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getPlannedJobOrders, getProductionJobOrders, getCompletedJobOrders, getWorkCycles, getRequiredDataForJobs, getDepartments } from './actions';
import { getManualCommitments } from '../raw-material-management/actions';
import { getPurchaseOrders } from '../purchase-orders/actions';
import { adminDb } from '@/lib/firebase-admin';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { type QueryDocumentSnapshot } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  const planned = await getPlannedJobOrders();
  const production = await getProductionJobOrders();
  const completed = await getCompletedJobOrders();

  const manualCommitments = await getManualCommitments();
  const purchaseOrders = await getPurchaseOrders();

  const [cycles, departments, requiredData, activeSessionsSnap] = await Promise.all([
    getWorkCycles(),
    getDepartments(),
    getRequiredDataForJobs([...planned, ...production, ...completed], manualCommitments),
    adminDb.collection("materialSessions").where("status", "==", "open").get()
  ]);

  const articles = requiredData.articles;
  const rawMaterials = requiredData.materials;
  const activeSessions = activeSessionsSnap.docs.map((doc: QueryDocumentSnapshot) => ({ ...doc.data(), id: doc.id }));

  return (
    <AdminAuthGuard>
      <AppShell>
         <Suspense fallback={
             <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-4 text-muted-foreground">Caricamento dati commesse...</p>
             </div>
         }>
            <DataManagementClientPage 
                initialPlanned={JSON.parse(JSON.stringify(planned))}
                initialProduction={JSON.parse(JSON.stringify(production))}
                initialCompleted={JSON.parse(JSON.stringify(completed))}
                initialCycles={JSON.parse(JSON.stringify(cycles))}
                initialArticles={JSON.parse(JSON.stringify(articles))}
                initialDepartments={JSON.parse(JSON.stringify(departments))}
                initialMaterials={JSON.parse(JSON.stringify(rawMaterials))}
                initialPurchaseOrders={JSON.parse(JSON.stringify(purchaseOrders))}
                initialManualCommitments={JSON.parse(JSON.stringify(manualCommitments))}
                initialActiveSessions={JSON.parse(JSON.stringify(activeSessions))}
            />

        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
