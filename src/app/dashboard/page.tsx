
"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Users, ScanLine, AlertTriangle, Clock, PackagePlus, SearchCheck, Warehouse, MinusSquare, Truck, LayoutGrid } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import Link from 'next/link';


export default function DashboardPage() {
  const { operator } = useAuth();

  const checkAccess = (keywords: string[]) => {
    if (!operator) return false;
    if (operator.role === 'supervisor' || operator.role === 'admin') return true;
    
    const reparti = Array.isArray(operator.reparto) ? operator.reparto : [operator.reparto];
    return reparti.some(r => {
      const upperR = String(r || '').toUpperCase();
      return keywords.some(k => upperR.includes(k.toUpperCase()));
    });
  };

  const hasMagAccess = checkAccess(['MAG', 'MAGAZZINO', 'COLLAUDO']);
  const hasPackingAccess = checkAccess(['MAG', 'MAGAZZINO', 'COLLAUDO', 'QUALIT', 'QLTY', 'IMBALLO', 'PACK']);


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold font-headline tracking-tight uppercase">Dashboard Operatore</h1>
              <p className="text-muted-foreground text-sm font-medium">
                Seleziona un'opzione qui sotto per accedere alle funzioni di ProdFastXcan.
              </p>
            </div>
            
            {(operator?.role === 'admin' || operator?.role === 'supervisor') && (
              <Button asChild variant="outline" className="border-primary text-primary hover:bg-primary/10 font-bold uppercase text-[10px] h-9 gap-2 shadow-sm">
                <Link href={operator.role === 'admin' ? '/admin/dashboard' : '/supervisor/dashboard'}>
                  <LayoutGrid className="h-4 w-4" />
                  Torna alla Gestione
                </Link>
              </Button>
            )}
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Scansione Commessa PF"
              description="Scansiona un QR code della commessa per iniziare o continuare il lavoro."
              icon={ScanLine}
              href="/scan-job"
            />
            {hasMagAccess && (
              <>
                 <DashboardItem
                  title="Carico Merce"
                  description="Modalità inventario per registrare rapidamente materiale in ingresso."
                  icon={PackagePlus}
                  href="/material-loading"
                />
                 <DashboardItem
                  title="Verifica Materiale"
                  description="Cerca un materiale per vederne i dettagli e lo stock attuale."
                  icon={SearchCheck}
                  href="/material-check"
                />
              </>
            )}
             {(operator?.canAccessInventory || operator?.role === 'admin' || operator?.role === 'supervisor') && (
                <DashboardItem
                  title="Inventario"
                  description="Gestisci l'inventario delle materie prime."
                  icon={Warehouse}
                  href="/inventory"
                />
            )}
             {(operator?.canAccessMaterialWithdrawal || operator?.role === 'admin' || operator?.role === 'supervisor') && (
                <DashboardItem
                  title="Scarico Materiale"
                  description="Registra uno scarico manuale di materiale per la produzione"
                  icon={MinusSquare}
                  href="/manual-withdrawal"
                />
            )}
            <DashboardItem
              title="Dati Operatore"
              description="Visualizza e gestisci le informazioni del tuo profilo utente."
              icon={Users}
              href="/operator"
            />
            <DashboardItem
              title="Timbratrice"
              description="Registra l'orario di ingresso o di uscita dal turno di lavoro."
              icon={Clock}
              className="opacity-50 cursor-not-allowed"
            />
            {hasPackingAccess && (
                <DashboardItem
                  title="Packing List"
                  description="Gestisci l'imballaggio e la spedizione delle commesse completate."
                  icon={Truck}
                  href="/operator/packing"
                />
            )}
            <DashboardItem
              title="Segnala Problema"
              description="Segnala eventuali problemi riscontrati durante la produzione."
              icon={AlertTriangle}
              href="/report-problem"
            />
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
