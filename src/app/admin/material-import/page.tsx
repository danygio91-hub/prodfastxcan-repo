
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import MaterialImportClientPage from './MaterialImportClientPage';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getPackagingItems } from './actions';
import { getRawMaterials } from '../raw-material-management/actions';


export const dynamic = 'force-dynamic';

export default async function MaterialImportPage() {
  const [packagingItems, rawMaterials] = await Promise.all([
    getPackagingItems(),
    getRawMaterials(),
  ]);
  
  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento pagina importazione...</p>
          </div>
        }>
          <MaterialImportClientPage packagingItems={packagingItems} rawMaterials={rawMaterials} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
