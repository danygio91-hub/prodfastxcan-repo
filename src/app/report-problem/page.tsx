
"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import ProblemReportForm from '@/components/forms/ProblemReportForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Wrench, PauseCircle, Boxes } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

export default function ReportProblemPage() {
  const { toast } = useToast();

  const handleQuickReport = (problemType: string, details: string) => {
    toast({
      title: "Segnalazione Rapida Inviata",
      description: `${problemType}: ${details}`,
    });
    // In futuro, questo potrebbe pre-compilare il modulo sottostante
    // o inviare direttamente una segnalazione specifica.
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-2xl mx-auto">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl font-headline">Segnalazioni Rapide</CardTitle>
              <CardDescription>Seleziona un problema comune per una segnalazione veloce.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Button 
                variant="outline" 
                className="flex-col h-auto py-4 space-y-2 items-center justify-center" 
                onClick={() => handleQuickReport("Fermo Macchina", "Segnalato fermo macchina")}
              >
                <Wrench className="h-10 w-10 text-primary" />
                <span className="text-center text-sm leading-tight">Segnala Fermo Macchina</span>
              </Button>
              <Button 
                variant="outline" 
                className="flex-col h-auto py-4 space-y-2 items-center justify-center" 
                onClick={() => handleQuickReport("Fermo Produttivo", "Segnalato fermo produttivo")}
              >
                <PauseCircle className="h-10 w-10 text-primary" />
                <span className="text-center text-sm leading-tight">Segnala Fermo Produttivo</span>
              </Button>
              <Button 
                variant="outline" 
                className="flex-col h-auto py-4 space-y-2 items-center justify-center" 
                onClick={() => handleQuickReport("Mancanza Componenti", "Segnalata mancanza componenti per commessa")}
              >
                <Boxes className="h-10 w-10 text-primary" />
                <span className="text-center text-sm leading-tight">Mancanza Componenti Commessa</span>
              </Button>
            </CardContent>
          </Card>

          <ProblemReportForm />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
