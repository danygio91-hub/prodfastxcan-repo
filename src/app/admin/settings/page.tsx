
"use client";

import React from 'react';
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Building2, ListTodo, Users, Workflow, Computer, ArrowRight, Boxes, GitMerge, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminCompanySettingsPage() {

  const navItems = [
    { href: '/admin/operator-management', label: 'Gestione Operatori', description: 'Aggiungi, modifica o rimuovi gli operatori e i loro permessi.', icon: Users },
    { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Aggiungi, modifica e importa le materie prime.', icon: Boxes },
    { href: '/admin/department-management', label: 'Gestione Reparti', description: 'Aggiungi, modifica o rimuovi i reparti aziendali.', icon: ListTodo },
    { href: '/admin/work-phase-management', label: 'Gestione Fasi di Lavorazione', description: 'Definisci le fasi standard per ogni reparto.', icon: Workflow },
    { href: '/admin/work-cycle-management', label: 'Gestione Cicli di Lavorazione', description: 'Crea cicli di lavorazione standard per le commesse.', icon: GitMerge },
    { href: '/admin/packaging-management', label: 'Gestione Imballi (Tare)', description: 'Definisci le tare da associare alle materie prime.', icon: Archive },
    { href: '/admin/workstation-management', label: 'Gestione Postazioni di Lavoro', description: 'Configura e assegna le postazioni di lavoro e i macchinari.', icon: Computer },
  ];

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <AdminNavMenu />

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
                <Link href={item.href} key={item.href} className="block h-full">
                    <Card className="hover:shadow-lg hover:border-primary/50 transition-all duration-300 group flex flex-col h-full">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <item.icon className="h-7 w-7 text-primary" />
                                    <span>{item.label}</span>
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-grow">
                             <CardDescription>{item.description}</CardDescription>
                        </CardContent>
                         <CardFooter>
                           <Button variant="link" className="p-0 h-auto">
                              Vai alla gestione
                              <ArrowRight className="ml-2 h-4 w-4" />
                           </Button>
                        </CardFooter>
                    </Card>
                </Link>
              ))}
            </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
