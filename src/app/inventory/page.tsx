
"use client";

import React, { useEffect } from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Warehouse, Construction } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function InventoryPage() {
  const { operator, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && operator && !operator.canAccessInventory) {
      toast({
        variant: "destructive",
        title: "Accesso Negato",
        description: "Non hai i permessi per accedere alla pagina Inventario."
      });
      router.replace('/dashboard');
    }
  }, [operator, loading, router, toast]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-4xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Warehouse className="h-8 w-8 text-primary" />
              Inventario
            </h1>
            <p className="text-muted-foreground">
              Sezione per la gestione e la verifica dell'inventario delle materie prime.
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Pagina in Costruzione</CardTitle>
              <CardDescription>
                Questa sezione è in fase di sviluppo. Torna presto per nuove funzionalità!
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center text-center py-16">
                <Construction className="h-24 w-24 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">La funzionalità di gestione dell'inventario sarà disponibile a breve.</p>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
