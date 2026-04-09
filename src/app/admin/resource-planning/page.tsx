import { Metadata } from 'next';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import ResourcePlanningClientPage from './ResourcePlanningClientPage';

export const metadata: Metadata = {
  title: 'Foglio di Pianificazione | Prodfast Xcan',
  description: 'Gestione risorse, reparti e bilanciamento carichi.',
};

export default function ResourcePlanningPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="w-full h-full flex flex-col flex-1 pb-10">
          <ResourcePlanningClientPage />
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
