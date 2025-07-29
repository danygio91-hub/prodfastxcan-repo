
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import NonConformityClientPage from './NonConformityClientPage';
import { getIncomingNonConformityReports, getProductionProblemReports } from './actions';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

async function NonConformityData() {
  const [incomingReports, productionReports] = await Promise.all([
    getIncomingNonConformityReports(),
    getProductionProblemReports(),
  ]);

  return <NonConformityClientPage 
            initialIncomingReports={incomingReports} 
            initialProductionReports={productionReports}
         />;
}

export default function NonConformityReportsPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento non conformità...</p>
          </div>
        }>
          <NonConformityData />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
