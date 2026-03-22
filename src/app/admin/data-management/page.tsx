
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getPlannedJobOrders, getProductionJobOrders, getWorkCycles, getRequiredDataForJobs, getDepartments } from './actions';
import { getManualCommitments } from '../raw-material-management/actions';
import { getPurchaseOrders } from '../purchase-orders/actions';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  const planned = await getPlannedJobOrders();
  const production = await getProductionJobOrders();
  const manualCommitments = await getManualCommitments();
  const purchaseOrders = await getPurchaseOrders();

  const [cycles, departments, requiredData] = await Promise.all([
    getWorkCycles(),
    getDepartments(),
    getRequiredDataForJobs([...planned, ...production], manualCommitments)
  ]);
  
  const articles = requiredData.articles;
  const rawMaterials = requiredData.materials;

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
                initialPlanned={planned}
                initialProduction={production}
                initialCycles={cycles}
                initialArticles={articles}
                initialDepartments={departments}
                initialMaterials={rawMaterials}
                initialPurchaseOrders={purchaseOrders}
                initialManualCommitments={manualCommitments}
            />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
