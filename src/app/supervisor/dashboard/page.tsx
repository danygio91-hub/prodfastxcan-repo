
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { 
  Activity, 
  CalendarDays, 
  ListChecks,
} from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';

const supervisorNavItems = [
  { href: '/admin/resource-planning', label: 'Power-Planning Hub', description: 'Bilancia la capacità dei reparti e gestisci i prestiti operatori.', icon: Activity, color: 'text-blue-600' },
  { href: '/admin/attendance-calendar', label: 'Calendario Presenze', description: 'Gestisci ferie, permessi, mutua e presenze giornaliere.', icon: CalendarDays, color: 'text-emerald-600' },
  { href: '/admin/data-management', label: 'Gestione ODL', description: 'Visualizza e ricerca gli ordini di lavoro attivi.', icon: ListChecks, color: 'text-indigo-600' },
];

export default function SupervisorDashboardPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8 pb-20">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Ruolo: Supervisor</span>
                <h1 className="text-3xl font-black font-headline tracking-tighter uppercase italic text-slate-800">Control Panel</h1>
              </div>
              <p className="text-muted-foreground font-bold text-xs uppercase tracking-tight opacity-70">
                Punto di accesso unico per la gestione risorse e officina.
              </p>
            </div>

          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {supervisorNavItems.map((item) => (
               <DashboardItem
                key={item.href}
                href={item.href}
                title={item.label}
                description={item.description}
                icon={item.icon}
              />
            ))}
          </div>

          <div className="bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-4">
             <div className="p-4 bg-white rounded-full shadow-sm">
                <Activity className="h-10 w-10 text-slate-400" />
             </div>
             <div>
                <h3 className="font-black text-lg text-slate-700 uppercase tracking-tight">Accesso Coordinatore</h3>
                <p className="text-sm text-muted-foreground font-medium max-w-md">
                    In qualità di Supervisor, hai accesso alla visione d'insieme dell'azienda e puoi reindirizzare le risorse dove necessario. I tuoi permessi sono validi sia in amministrazione che in produzione.
                </p>
             </div>
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
