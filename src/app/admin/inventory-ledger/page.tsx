import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getInventoryLedgerData } from './actions';
import InventoryLedgerClientPage from './InventoryLedgerClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function InventoryLedgerPage() {
  const initialData = await getInventoryLedgerData();

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-4 text-muted-foreground">
                Caricamento Registro Inventario SSoT...
              </p>
            </div>
          }
        >
          <InventoryLedgerClientPage initialData={initialData} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}

