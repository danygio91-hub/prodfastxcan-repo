
"use client";

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Users, ScanLine, AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import DashboardItem from '@/components/dashboard/DashboardItem';

export default function DashboardPage() {
  const { toast } = useToast();
  const [isClockDialogOpen, setIsClockDialogOpen] = useState(false);

  const handleClockIn = useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Ingresso registrato con successo.",
    });
    setIsClockDialogOpen(false);
  }, [toast, setIsClockDialogOpen]);

  const handleClockOut = useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Uscita registrata con successo.",
    });
    setIsClockDialogOpen(false);
  }, [toast, setIsClockDialogOpen]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Accedi alle funzioni di ProdFastXcan.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <DashboardItem
              title="Dati Operatore"
              description="Visualizza e gestisci le informazioni dell'operatore."
              icon={Users}
              href="/operator-data"
            />
            <DashboardItem
              title="Scansione Commessa PF"
              description="Scansiona un codice a barre della commessa per iniziare o continuare il lavoro."
              icon={ScanLine}
              href="/scan-job"
            />
            <DashboardItem
              title="Segnala Problema"
              description="Segnala eventuali problemi riscontrati durante la produzione."
              icon={AlertTriangle}
              href="/report-problem"
            />
            
            <AlertDialog open={isClockDialogOpen} onOpenChange={setIsClockDialogOpen}>
              <AlertDialogTrigger asChild>
                <DashboardItem
                  title="Timbratrice"
                  description="Registra il tuo orario di entrata o di uscita."
                  icon={Clock}
                  isDialogTrigger={true}
                />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Seleziona Azione Timbratura</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vuoi registrare un orario di ingresso o di uscita?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClockIn}>
                    Registra Entrata
                  </AlertDialogAction>
                  <AlertDialogAction onClick={handleClockOut}>
                    Registra Uscita
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
