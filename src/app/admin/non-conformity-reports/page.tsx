
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import NonConformityClientPage from './NonConformityClientPage';

export const dynamic = 'force-dynamic';

export default function NonConformityReportsPage() {
  // Data fetching is handled client-side to allow for dynamic filtering and actions
  return (
    <AdminAuthGuard>
      <AppShell>
        <NonConformityClientPage />
      </AppShell>
    </AdminAuthGuard>
  );
}
