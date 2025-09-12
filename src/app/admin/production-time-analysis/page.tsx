
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getProductionTimeAnalysisReport } from '../reports/actions';
import ProductionTimeAnalysisClientPage from './ProductionTimeAnalysisClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminProductionTimeAnalysisPage() {
  const report = await getProductionTimeAnalysisReport();

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento analisi tempi...</p>
          </div>
        }>
          <ProductionTimeAnalysisClientPage report={report} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
