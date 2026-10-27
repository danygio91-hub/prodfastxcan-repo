import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProgrammazioneClientPage from './ProgrammazioneClientPage';
import { getJobOrders, getDepartments } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProgrammazionePage() {
  const [jobs, departments] = await Promise.all([
    getJobOrders(),
    getDepartments(),
  ]);

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center min-h-[350px] gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-muted-foreground">
                Inizializzazione Programmazione Commesse (Master Panel)...
              </p>
            </div>
          }
        >
          <ProgrammazioneClientPage
            initialJobs={JSON.parse(JSON.stringify(jobs))}
            initialDepartments={JSON.parse(JSON.stringify(departments))}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
