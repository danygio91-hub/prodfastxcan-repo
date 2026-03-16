
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getPlannedJobOrders, getProductionJobOrders, getWorkCycles, getArticles, getDepartments } from './actions';
import { getRawMaterials, getManualCommitments } from '../raw-material-management/actions';
import { getPurchaseOrders } from '../purchase-orders/actions';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  const [planned, production, cycles, articles, departments, rawMaterials, purchaseOrders, manualCommitments] = await Promise.all([
    getPlannedJobOrders(),
    getProductionJobOrders(),
    getWorkCycles(),
    getArticles(),
    getDepartments(),
    getRawMaterials(),
    getPurchaseOrders(),
    getManualCommitments(),
  ]);

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
