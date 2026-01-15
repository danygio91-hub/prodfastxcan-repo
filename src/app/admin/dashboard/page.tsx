
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ListChecks, Briefcase, BarChart3, Settings, ArrowRight, Building2, Boxes, ShieldAlert, Timer, Combine, ClipboardList, Warehouse, History } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';

const navItems = [
  { href: '/admin/data-management', label: 'Gestione Dati Commesse', description: 'Importa, visualizza e gestisci le commesse.', icon: ListChecks },
  { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Gestisci l\'anagrafica delle materie prime.', icon: Boxes },
  { href: '/admin/batch-management', label: 'Gestione Lotti', description: 'Visualizza e gestisci i lotti delle materie prime.', icon: History },
  { href: '/admin/article-management', label: 'Anagrafica Articoli', description: 'Crea e gestisci la distinta base degli articoli.', icon: ClipboardList },
  { href: '/admin/production-console', label: 'Console Produzione', description: 'Monitora le commesse in produzione.', icon: Briefcase },
  { href: '/admin/work-group-management', label: 'Gruppi Commesse', description: 'Visualizza e gestisci i gruppi di commesse concatenate.', icon: Combine },
  { href: '/admin/inventory-management', label: 'Inventari', description: 'Visualizza e approva le registrazioni di inventario.', icon: Warehouse },
  { href: '/admin/reports', label: 'Report Produzione', description: 'Genera e visualizza i report di lavorazione.', icon: BarChart3 },
  { href: '/admin/production-time-analysis', label: 'Analisi Tempi Articolo', description: 'Analizza i tempi medi di produzione per articolo.', icon: Timer },
  { href: '/admin/non-conformity-reports', label: 'Report Non Conformità', description: 'Gestisci le segnalazioni di non conformità.', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Configurazione Azienda', description: 'Gestisci operatori, reparti, fasi e postazioni.', icon: Building2 },
  { href: '/admin/app-settings', label: 'Gestione App', description: 'Personalizza il tema e l\'aspetto dell\'applicazione.', icon: Settings },
];

export default function AdminDashboardPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Amministrazione</h1>
            <p className="text-muted-foreground">
              Seleziona un'opzione qui sotto o usa il menu rapido in alto per iniziare.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {navItems.map((item) => (
               <DashboardItem
                key={item.href}
                href={item.href}
                title={item.label}
                description={item.description}
                icon={item.icon}
              />
            ))}
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
