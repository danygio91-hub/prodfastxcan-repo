
import { getPlannedJobOrders, getProductionJobOrders } from './actions';
import { getDepartmentMap } from '@/app/admin/settings/actions';
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  const plannedJobOrders = await getPlannedJobOrders();
  const productionJobOrders = await getProductionJobOrders();
  const departmentMap = await getDepartmentMap();

  return (
    <AdminAuthGuard>
      <AppShell>
        <DataManagementClientPage
          initialPlannedJobOrders={plannedJobOrders}
          initialProductionJobOrders={productionJobOrders}
          departmentMap={departmentMap}
        />
      </AppShell>
    </AdminAuthGuard>
  );
}
