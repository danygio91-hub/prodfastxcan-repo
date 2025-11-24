
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getInventoryRecords } from './actions';
import InventoryClientPage from './InventoryClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function InventoryManagementPage() {
  const initialRecords = await getInventoryRecords();

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento inventario...</p>
          </div>
        }>
          <InventoryClientPage initialRecords={initialRecords} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
