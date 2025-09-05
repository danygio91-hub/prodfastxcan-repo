
import DataManagementClientPage from './DataManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminDataManagementCommessePage() {
  return (
    <AdminAuthGuard>
      <AppShell>
         <DataManagementClientPage />
      </AppShell>
    </AdminAuthGuard>
  );
}
