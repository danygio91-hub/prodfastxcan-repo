

import ProductionConsoleClientPage from './ProductionConsoleClientPage';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { getProductionTimeAnalysisMap } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProductionConsolePage() {
  const analysisMap = await getProductionTimeAnalysisMap();
  
  return (
    <AdminAuthGuard>
      <AppShell>
         <Suspense fallback={
             <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-4 text-muted-foreground">Caricamento console...</p>
             </div>
         }>
            <ProductionConsoleClientPage analysisMap={analysisMap} />
        </Suspense>
      </AppShell>
    </AdminAuthGuard>
  );
}

    
