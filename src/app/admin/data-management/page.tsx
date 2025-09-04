
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getPlannedJobOrders, getProductionJobOrders, getWorkCycles } from './actions';
import { Loader2 } from 'lucide-react';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

async function DataManagementData() {
  const [
    planned, 
    production, 
    cycles
  ] = await Promise.all([
    getPlannedJobOrders(),
    getProductionJobOrders(),
    getWorkCycles(),
  ]);

  return <DataManagementClientPage 
    plannedJobOrders={planned}
    productionJobOrders={production}
    workCycles={cycles}
  />;
}


export default async function AdminDataManagementCommessePage() {
  return (
    <AdminAuthGuard>
      <AppShell>
         <Suspense fallback={
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-4 text-muted-foreground">Caricamento dati commesse...</p>
              </div>
          }>
            <DataManagementData />
         </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
