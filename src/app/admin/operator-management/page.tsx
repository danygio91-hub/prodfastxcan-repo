
import { getOperators } from './actions';
import OperatorManagementClientPage from './OperatorManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminOperatorManagementPage() {
  const operators = await getOperators();

  return (
    <AdminAuthGuard>
      <AppShell>
        <OperatorManagementClientPage initialOperators={operators} />
      </AppShell>
    </AdminAuthGuard>
  );
}
