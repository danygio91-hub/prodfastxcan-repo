
"use client";

import React from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Warehouse, Loader2 } from 'lucide-react';

export default function InventoryManagementPage() {

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Warehouse className="h-8 w-8 text-primary" />
                    Gestione Inventari
                </h1>
                <p className="text-muted-foreground">
                    Visualizza, approva o rifiuta le registrazioni di inventario effettuate dagli operatori.
                </p>
            </header>
            
            <Card>
                <CardHeader>
                    <CardTitle>Registrazioni Inventario</CardTitle>
                    <CardDescription>
                        Elenco delle registrazioni di inventario in attesa di approvazione.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                   <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                        <h2 className="text-xl font-semibold text-muted-foreground">
                            Pagina in Costruzione
                        </h2>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                            Questa sezione mostrerà presto l'elenco delle registrazioni di inventario da approvare.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
