
import { getPlannedJobOrders, getProductionJobOrders, getWorkCycles } from './actions';
import { getDepartmentMap } from '@/app/admin/settings/actions';
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  const plannedJobOrders = await getPlannedJobOrders();
  const productionJobOrders = await getProductionJobOrders();
  const departmentMap = await getDepartmentMap();
  const workCycles = await getWorkCycles();

  return (
    <AdminAuthGuard>
      <AppShell>
        <DataManagementClientPage
          initialPlannedJobOrders={plannedJobOrders}
          initialProductionJobOrders={productionJobOrders}
          departmentMap={departmentMap}
          workCycles={workCycles}
        />
      </AppShell>
    </AdminAuthGuard>
  );
}
