"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard } from 'lucide-react';


export default function AdminDashboardPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <AdminNavMenu />

          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard Amministrazione</h1>
            <p className="text-muted-foreground">
             Usa il menu di navigazione in alto per spostarti tra le sezioni.
            </p>
          </header>

           <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <LayoutDashboard className="h-6 w-6 text-primary" />
                    Benvenuto nella Dashboard
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p>Questa è la dashboard principale. Seleziona una delle icone nel menu in alto per accedere alle diverse aree di gestione: visualizzare e importare dati, monitorare la console di produzione, generare report e configurare le impostazioni.</p>
            </CardContent>
           </Card>

        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
