"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Users, ScanLine, AlertTriangle } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';

export default function DashboardPage() {

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <OperatorNavMenu />
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Accedi alle funzioni di ProdFastXcan.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Dati Operatore"
              description="Visualizza e gestisci le informazioni dell'operatore."
              icon={Users}
              href="/operator-data"
            />
            <DashboardItem
              title="Scansione Commessa PF"
              description="Scansiona un codice a barre della commessa per iniziare o continuare il lavoro."
              icon={ScanLine}
              href="/scan-job"
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
