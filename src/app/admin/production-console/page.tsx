
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Briefcase, Package2 } from 'lucide-react';
import { getProductionJobOrders } from '@/app/admin/data-management/actions';
import type { JobOrder } from '@/lib/mock-data';
import JobOrderCard from '@/components/production-console/JobOrderCard';

export const dynamic = 'force-dynamic';

export default async function ProductionConsolePage() {
  const jobOrders: JobOrder[] = await getProductionJobOrders();

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div className='space-y-2'>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Briefcase className="h-8 w-8 text-primary" />
                    Console Controllo Produzione
                </h1>
                <p className="text-muted-foreground">
                    Panoramica in tempo reale delle commesse inviate in produzione.
                </p>
            </div>
          </div>
          
          {jobOrders.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {jobOrders.map(job => (
                    <JobOrderCard key={job.id} jobOrder={job} />
                ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg mt-8">
                <Package2 className="h-16 w-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold text-muted-foreground">Nessuna Commessa in Produzione</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                    Non ci sono commesse attive. Crea un ODL dalla sezione 'Gestione Dati' per visualizzarle qui.
                </p>
                <Link href="/admin/data-management" passHref>
                    <Button className="mt-6">Vai a Gestione Commesse</Button>
                </Link>
            </div>
          )}
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
