
import { getProductionJobOrders } from '@/app/admin/data-management/actions';
import ProductionConsoleClientPage from './ProductionConsoleClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function ProductionConsolePage() {
  const jobOrders = await getProductionJobOrders();

  return (
    <AdminAuthGuard>
      <AppShell>
        <ProductionConsoleClientPage initialJobOrders={jobOrders} />
      </AppShell>
    </AdminAuthGuard>
  );
}
