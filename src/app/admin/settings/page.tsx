
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Building2, ListTodo, Users, Workflow, Computer, Boxes, GitMerge, Archive, LockKeyhole, Combine, Timer, Clock } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';

export default function AdminCompanySettingsPage() {

  const navItems = [
    { href: '/admin/operator-management', label: 'Gestione Operatori', description: 'Aggiungi, modifica o rimuovi gli operatori e i loro permessi.', icon: Users, disabled: false },
    { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Aggiungi, modifica e importa le materie prime.', icon: Boxes, disabled: false },
    { href: '/admin/department-management', label: 'Gestione Reparti', description: 'Aggiungi, modifica o rimuovi i reparti aziendali.', icon: ListTodo, disabled: false },
    { href: '/admin/work-phase-management', label: 'Gestione Fasi di Lavorazione', description: 'Definisci le fasi standard per ogni reparto.', icon: Workflow, disabled: false },
    { href: '/admin/work-cycle-management', label: 'Gestione Cicli di Lavorazione', description: 'Crea cicli di lavorazione standard per le commesse.', icon: GitMerge, disabled: false },
    { href: '/admin/packaging-management', label: 'Gestione Imballi (Tare)', description: 'Definisci le tare da associare alle materie prime.', icon: Archive, disabled: false },
    { href: '/admin/working-hours', label: 'Gestione Orario Lavorativo', description: 'Configura i giorni lavorativi e i turni aziendali.', icon: Clock, disabled: false },
    { href: '/admin/time-tracking-settings', label: 'Gestione Rilevazione Tempi', description: 'Imposta le regole per la validazione dei tempi di produzione.', icon: Timer, disabled: false },
    { href: '/admin/privacy-management', label: 'Gestione Privacy', description: 'Modifica l\'informativa sulla privacy mostrata agli operatori.', icon: LockKeyhole, disabled: false },
    { href: '/admin/workstation-management', label: 'Gestione Postazioni di Lavoro', description: 'Configura e assegna le postazioni di lavoro e i macchinari.', icon: Computer, disabled: false },
  ];

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              Configurazione Azienda
            </h1>
            <p className="text-muted-foreground">
              Gestisci le impostazioni operative principali della tua azienda.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {navItems.map((item) => (
                <DashboardItem
                  key={item.label}
                  href={item.disabled ? undefined : item.href}
                  title={item.label}
                  description={item.description}
                  icon={item.icon}
                  className={item.disabled ? "opacity-50 cursor-not-allowed hover:shadow-none hover:border-border" : ""}
                />
              ))}
            </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
