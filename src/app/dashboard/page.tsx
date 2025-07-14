
"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Users, ScanLine, AlertTriangle, Clock, PackagePlus } from 'lucide-react';
import DashboardItem from '@/components/dashboard/DashboardItem';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';


export default function DashboardPage() {
  const { toast } = useToast();
  const { operator } = useAuth();

  const handleClockIn = React.useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Ingresso registrato con successo.",
    });
  }, [toast]);

  const handleClockOut = React.useCallback(() => {
    toast({
      title: "Timbratura Registrata",
      description: "Uscita registrata con successo.",
    });
  }, [toast]);


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <OperatorNavMenu />
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Accedi alle funzioni di ProdFastXcan.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DashboardItem
              title="Scansione Commessa PF"
              description="Scansiona un QR code della commessa per iniziare o continuare il lavoro."
              icon={ScanLine}
              href="/scan-job"
            />
            {operator && (operator.reparto === 'MAG' || operator.role === 'superadvisor') && (
              <DashboardItem
                title="Carico e Verifica Materia Prima"
                description="Registra l'ingresso e verifica stato materia prima."
                icon={PackagePlus}
                href="/material-loading"
              />
            )}
            <DashboardItem
              title="Dati Operatore"
              description="Visualizza e gestisci le informazioni dell'operatore."
              icon={Users}
              href="/operator"
            />
             <AlertDialog>
              <AlertDialogTrigger asChild>
                <DashboardItem
                  title="Timbratrice"
                  description="Registra l'orario di ingresso o di uscita dal turno di lavoro."
                  icon={Clock}
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
            <DashboardItem
              title="Segnala Problema"
              description="Segnala eventuali problemi riscontrati durante la produzione."
              icon={AlertTriangle}
              href="/report-problem"
            />
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
