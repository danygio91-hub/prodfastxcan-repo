
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getAllBatches } from './actions';
import BatchManagementClientPage from './BatchManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function BatchManagementPage() {
  const initialBatches = await getAllBatches();

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento lotti...</p>
          </div>
        }>
          <BatchManagementClientPage initialBatches={initialBatches} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
