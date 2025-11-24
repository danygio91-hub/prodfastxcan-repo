
"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Users, ScanLine, AlertTriangle, Clock, PackagePlus, SearchCheck, Warehouse } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import { useAuth } from '@/components/auth/AuthProvider';


export default function DashboardPage() {
  const { operator } = useAuth();

  const allowedAccessReparti = ['MAG', 'Collaudo'];
  const hasMagAccess = operator && (
    operator.role === 'supervisor' || 
    (Array.isArray(operator.reparto) 
      ? operator.reparto.some(r => allowedAccessReparti.includes(r)) 
      : allowedAccessReparti.includes(operator.reparto))
  );


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Operatore</h1>
            <p className="text-muted-foreground">
              Seleziona un'opzione qui sotto per accedere alle funzioni di ProdFastXcan.
            </p>
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
             {operator?.canAccessInventory && (
                <DashboardItem
                  title="Inventario"
                  description="Gestisci l'inventario delle materie prime."
                  icon={Warehouse}
                  href="/inventory"
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
