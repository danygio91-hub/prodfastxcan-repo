
import ReportsClientPage from './ReportsClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  // Pass an empty array to avoid fetching data on initial load.
  // Data will be fetched on the client when a tab is clicked.
  const jobsReport = [];

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento report...</p>
          </div>
        }>
          <ReportsClientPage
            initialJobsReport={jobsReport}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
