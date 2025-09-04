
import OperatorManagementClientPage from './OperatorManagementClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { getOperators, getDepartments } from './actions';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

async function OperatorManagementData() {
  const [operators, departments] = await Promise.all([
    getOperators(),
    getDepartments(),
  ]);
  return <OperatorManagementClientPage initialOperators={operators} initialDepartments={departments} />;
}

export default async function AdminOperatorManagementPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-4 text-muted-foreground">Caricamento operatori...</p>
          </div>
        }>
          <OperatorManagementData />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}
