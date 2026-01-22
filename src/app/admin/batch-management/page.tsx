
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getAllGroupedBatches } from './actions';
import BatchManagementClientPage from './BatchManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { type GroupedBatches } from './actions';

export const dynamic = 'force-dynamic';

export default async function BatchManagementPage() {
  // Data is now fetched on the client side.
  const initialGroupedBatches: GroupedBatches[] = [];

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento lotti...</p>
          </div>
        }>
          <BatchManagementClientPage initialGroupedBatches={initialGroupedBatches} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
