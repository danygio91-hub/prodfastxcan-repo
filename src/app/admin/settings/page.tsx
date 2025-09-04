
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Building2, ListTodo, Users, Workflow, Computer, ArrowRight, Save, Loader2, Boxes, GitMerge, Archive } from 'lucide-react';
import { type Reparto, reparti } from '@/lib/mock-data';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getDepartmentMap, updateDepartmentNames } from './actions';

export default function AdminCompanySettingsPage() {
  const [departments, setDepartments] = useState<{ [key in Reparto]?: string }>({});
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    getDepartmentMap().then(setDepartments);
  }, []);

  const handleInputChange = (code: Reparto, value: string) => {
    setDepartments(prev => ({ ...prev, [code]: value }));
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateDepartmentNames(formData);
      if (result.success) {
        toast({
          title: 'Successo',
          description: result.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Errore',
          description: result.message,
        });
      }
    });
  };

  const navItems = [
    { href: '/admin/operator-management', label: 'Gestione Operatori', description: 'Aggiungi, modifica o rimuovi gli operatori e i loro permessi.', icon: Users },
    { href: '/admin/raw-material-management', label: 'Gestione Materie Prime', description: 'Aggiungi, modifica e importa le materie prime.', icon: Boxes },
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Colonna di Sinistra con le schede di navigazione */}
            <div className="space-y-8">
              {navItems.map((item) => (
                <Link href={item.href} key={item.href} className="block h-full">
                    <Card className="hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <item.icon className="h-7 w-7 text-primary" />
                                    <span>{item.label}</span>
                                </div>
                                <Button variant="ghost" size="icon" className="text-muted-foreground group-hover:text-primary transition-colors">
                                    <ArrowRight className="h-5 w-5" />
                                </Button>
                            </CardTitle>
                            <CardDescription>{item.description}</CardDescription>
                        </CardHeader>
                    </Card>
                </Link>
              ))}
            </div>
            
            {/* Colonna di Destra con la gestione reparti */}
            <div className="space-y-8">
                <form onSubmit={handleFormSubmit}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3">
                        <ListTodo className="h-7 w-7 text-primary" />
                        Gestione/Nomi Reparti
                      </CardTitle>
                      <CardDescription>
                        Modifica i nomi visualizzati per ogni reparto.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {reparti.length > 0 ? reparti.map(code => (
                        <div key={code} className="flex items-center gap-4">
                          <Label htmlFor={`reparto-${code}`} className="w-1/4 sm:w-1/5 font-semibold">{code}</Label>
                          <Input
                            id={`reparto-${code}`}
                            name={code}
                            value={departments[code] || ''}
                            onChange={(e) => handleInputChange(code, e.target.value)}
                            className="bg-background"
                          />
                        </div>
                      )) : <p className="text-muted-foreground">Caricamento reparti...</p>}
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salva Modifiche
                        </Button>
                    </CardFooter>
                  </Card>
                </form>
            </div>
          </div>

        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
