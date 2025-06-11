
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import DashboardItem from '@/components/dashboard/DashboardItem';
import { Briefcase, Settings, BarChart3, Users, Edit } from 'lucide-react';

export default function AdminDashboardPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Amministrazione</h1>
            <p className="text-muted-foreground">
              Gestisci i dati dell'applicazione e monitora la produzione.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Gestione Dati"
              description="Visualizza e gestisci le commesse di produzione."
              icon={Edit}
              href="/admin/data-management" 
            />
            <DashboardItem
              title="Console Controllo Produzione"
              description="Visualizza lo stato attuale delle lavorazioni."
              icon={Briefcase}
              href="/admin/production-console" 
            />
            <DashboardItem
              title="Report Lavorazioni"
              description="Resoconti su avanzamento, materiali e spedizioni."
              icon={BarChart3}
              href="/admin/reports" 
            />
             <DashboardItem
              title="Gestione Operatori"
              description="Visualizza e gestisci i dati degli operatori."
              icon={Users}
              href="/admin/operator-management" 
            />
            <DashboardItem
              title="Configurazione App"
              description="Impostazioni generali dell'applicazione."
              icon={Settings}
              href="/admin/settings" 
            />
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
