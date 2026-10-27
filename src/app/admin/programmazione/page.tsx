import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProgrammazioneClientPage from './ProgrammazioneClientPage';
import { getJobOrders, getDepartments, getWorkCycles } from './actions';
import { adminDb } from '@/lib/firebase-admin';
import { convertTimestampsToDates } from '@/lib/utils';
import type { Article, WorkCycle } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

export const dynamic = 'force-dynamic';

export default async function ProgrammazionePage() {
  const [jobs, departments, cycles, articlesSnap, settingsSnap] = await Promise.all([
    getJobOrders(),
    getDepartments(),
    getWorkCycles(),
    adminDb.collection("articles").select("code", "workCycleId", "description", "department", "billOfMaterials").get(),
    adminDb.collection("settings").doc("global").get(),
  ]);

  const articles = articlesSnap.docs.map(doc => ({ ...convertTimestampsToDates(doc.data()), id: doc.id }) as Article);
  const globalSettings = settingsSnap.exists ? convertTimestampsToDates(settingsSnap.data()) as GlobalSettings : null;

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
            initialArticles={JSON.parse(JSON.stringify(articles))}
            initialWorkCycles={JSON.parse(JSON.stringify(cycles))}
            initialGlobalSettings={JSON.parse(JSON.stringify(globalSettings))}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
