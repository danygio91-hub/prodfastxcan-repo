
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default function AdminRawMaterialManagementPage() {
  // Data fetching is now handled on the client-side
  // to improve navigation performance. The client component will show a loading state.
  return (
    <AdminAuthGuard>
      <AppShell>
        <RawMaterialManagementClientPage />
      </AppShell>
    </AdminAuthGuard>
  );
}
