
import { getJobsReport, getOperatorsReport, getMaterialWithdrawals } from './actions';
import ReportsClientPage from './ReportsClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { subDays } from 'date-fns';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const defaultDateRange = {
    from: subDays(new Date(), 29),
    to: new Date(),
  };

  // Fetch initial data on the server
  const jobsReport = await getJobsReport();
  const operatorsReport = await getOperatorsReport();
  const withdrawalsReport = await getMaterialWithdrawals(defaultDateRange);

  return (
    <AdminAuthGuard>
      <AppShell>
        <ReportsClientPage
          initialJobsReport={jobsReport}
          initialOperatorsReport={operatorsReport}
          initialWithdrawalsReport={withdrawalsReport}
        />
      </AppShell>
    </AdminAuthGuard>
  );
}
