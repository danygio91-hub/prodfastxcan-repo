
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getRawMaterials } from './actions';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminRawMaterialManagementPage() {
  const materials = await getRawMaterials();
  
  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento materie prime...</p>
          </div>
        }>
          <RawMaterialManagementClientPage initialMaterials={materials} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
