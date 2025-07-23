
"use client";

import React from 'react';
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ListChecks, Briefcase, BarChart3, Settings, ArrowRight, Building2, Boxes, ShieldAlert } from 'lucide-react';

const navItems = [
  { href: '/admin/data-management', label: 'Gestione Dati Commesse', description: 'Importa, visualizza e gestisci le commesse.', icon: ListChecks },
  { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Gestisci l\'anagrafica delle materie prime.', icon: Boxes },
  { href: '/admin/production-console', label: 'Console Produzione', description: 'Monitora le commesse in produzione.', icon: Briefcase },
  { href: '/admin/reports', label: 'Report Produzione', description: 'Genera e visualizza i report di lavorazione.', icon: BarChart3 },
  { href: '/admin/non-conformity-reports', label: 'Report Non Conformità', description: 'Gestisci le segnalazioni di non conformità.', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Configurazione Azienda', description: 'Gestisci operatori, reparti, fasi e postazioni.', icon: Building2 },
  { href: '/admin/app-settings', label: 'Gestione App', description: 'Personalizza il tema e l\'aspetto dell\'applicazione.', icon: Settings },
];

export default function AdminDashboardPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <AdminNavMenu />

          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Amministrazione</h1>
            <p className="text-muted-foreground">
              Seleziona un'opzione qui sotto o usa il menu rapido in alto per iniziare.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {navItems.map((item) => (
              <Link href={item.href} key={item.href} className="block h-full">
                <Card className="hover:shadow-lg hover:border-primary/50 transition-shadow,border-color duration-300 flex flex-col h-full group">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <item.icon className="h-10 w-10 text-primary" />
                       <Button variant="ghost" size="icon" className="text-muted-foreground group-hover:text-primary transition-colors">
                          <ArrowRight className="h-5 w-5" />
                       </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <CardTitle className="text-xl font-headline mb-1">{item.label}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
