import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getDepartments, getManualCommitments } from './actions';
import { getArticles } from '../article-management/actions';
import { getGlobalSettings } from '@/lib/settings-actions';
import { GlobalSettings } from '@/lib/settings-types';

export const dynamic = 'force-dynamic';

export default async function AdminRawMaterialManagementPage() {
  const [departments, articles, manualCommitments, globalSettings] = await Promise.all([
    getDepartments(),
    getArticles(),
    getManualCommitments(),
    getGlobalSettings(),
  ]);

  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento gestione materiali...</p>
          </div>
        }>
          <RawMaterialManagementClientPage
            initialDepartments={departments}
            initialArticles={articles}
            initialCommitments={manualCommitments}
            globalSettings={globalSettings}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
