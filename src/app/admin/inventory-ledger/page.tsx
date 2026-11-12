import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getInventoryLedgerData, type InventoryLedgerPageData } from './actions';
import InventoryLedgerClientPage from './InventoryLedgerClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function InventoryLedgerPage() {
  let initialData: InventoryLedgerPageData = {
    sessions: [
      {
        id: 'VIRTUAL_2025',
        name: 'Storico Inventario 2025',
        year: 2025,
        status: 'closed',
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-12-31T23:59:59.999Z',
        isVirtual: true,
        recordCount: 0,
      },
    ],
    defaultSessionId: 'VIRTUAL_2025',
    baseLots: [],
    allActiveLots: [],
    unscannedLots: [],
    records: [],
  };

  try {
    initialData = await getInventoryLedgerData();
  } catch (error) {
    console.error('Errore caricamento iniziale InventoryLedgerPage:', error);
  }

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

