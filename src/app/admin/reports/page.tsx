
import ReportsClientPage from './ReportsClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  // Data is now fetched on the client side to avoid blocking the initial render.
  // The client component will show a loading state.
  return (
    <AdminAuthGuard>
      <AppShell>
        <ReportsClientPage
          initialJobsReport={[]}
          initialOperatorsReport={[]}
          initialWithdrawalsReport={[]}
        />
      </AppShell>
    </AdminAuthGuard>
  );
}
