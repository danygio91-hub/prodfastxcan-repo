
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getDepartments, getManualCommitments, getRawMaterials, getMaterialsStatus } from './actions';
import { getArticles } from '../article-management/actions';

export const dynamic = 'force-dynamic';

export default async function AdminRawMaterialManagementPage() {
  // Fetch all data required by the client component and its dialogs
  const [departments, articles, manualCommitments, rawMaterials, materialStatus] = await Promise.all([
    getDepartments(),
    getArticles(),
    getManualCommitments(),
    getRawMaterials(""), // Fetch all materials initially
    getMaterialsStatus(),
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
            initialRawMaterials={rawMaterials}
            initialMaterialStatus={materialStatus}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
