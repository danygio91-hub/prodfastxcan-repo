
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getDepartments, getManualCommitments } from './actions';
import { getArticles } from '../article-management/actions';
import { RawMaterial } from '@/lib/mock-data';

export const dynamic = 'force-dynamic';

export default async function AdminRawMaterialManagementPage() {
  const [departments, articles, manualCommitments] = await Promise.all([
    getDepartments(),
    getArticles(),
    getManualCommitments(),
  ]);

  const initialRawMaterials: RawMaterial[] = [];

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
            initialRawMaterials={initialRawMaterials}
          />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
