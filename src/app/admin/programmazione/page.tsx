import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProgrammazioneClientPage from './ProgrammazioneClientPage';
import { getActiveJobOrders, getDepartments, getWorkCycles, getCapacityBuckets } from './actions';
import { adminDb } from '@/lib/firebase-admin';
import { convertTimestampsToDates } from '@/lib/utils';
import { getISOWeek, getISOWeekYear } from 'date-fns';
import type { Article, WorkCycle } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';

import { getODLConfig } from '@/app/admin/settings/odl-actions';

export const dynamic = 'force-dynamic';

export default async function ProgrammazionePage() {
  const now = new Date();
  const currentWeek = getISOWeek(now);
  const currentYear = getISOWeekYear(now);

  const [jobs, departments, cycles, articlesSnap, settingsSnap, odlConfig, initialCapacities] = await Promise.all([
    getActiveJobOrders(),
    getDepartments(),
    getWorkCycles(),
    adminDb.collection("articles").select("code", "workCycleId", "description", "department", "billOfMaterials", "expectedMinutesDefault", "phaseTimes").get(),
    adminDb.collection("settings").doc("global").get(),
    getODLConfig(),
    getCapacityBuckets(currentYear, currentWeek),
  ]);

  const articles = articlesSnap.docs.map(doc => {
    const data = doc.data();
    return {
      ...convertTimestampsToDates(data),
      id: doc.id,
      code: (data.code || doc.id).trim(),
    } as Article;
  });
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
            initialOdlConfig={JSON.parse(JSON.stringify(odlConfig))}
            initialCapacities={JSON.parse(JSON.stringify(initialCapacities))}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
