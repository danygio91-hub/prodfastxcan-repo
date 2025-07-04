
import { getRawMaterials } from './actions';
import RawMaterialManagementClientPage from './RawMaterialManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminRawMaterialManagementPage() {
  const materials = await getRawMaterials();

  return (
    <AdminAuthGuard>
      <AppShell>
        <RawMaterialManagementClientPage initialMaterials={materials} />
      </AppShell>
    </AdminAuthGuard>
  );
}
