
"use client";

import React, { useState, useTransition } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Settings, Brush, Database, AlertTriangle, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { ThemeToggler } from '@/components/ThemeToggler';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
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
import { db } from '@/lib/firebase';
import { initialOperators, initialDepartmentMap, initialWorkPhaseTemplates, initialWorkstations } from '@/lib/mock-data';
import { collection, writeBatch, getDocs, doc } from 'firebase/firestore';


export default function AdminAppSettingsPage() {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSeedDatabase = () => {
    startTransition(async () => {
      const seedDatabaseClientSide = async (): Promise<{ success: boolean; message: string; }> => {
        try {
          const operatorsRef = collection(db, "operators");
          const operatorsSnap = await getDocs(operatorsRef);
          
          if (!operatorsSnap.empty) {
              return { success: false, message: 'Il database sembra essere già popolato. Nessuna operazione eseguita.' };
          }
          
          const batch = writeBatch(db);
          let totalOperations = 0;

          initialOperators.forEach(op => {
              const docRef = doc(db, "operators", op.id);
              batch.set(docRef, op);
              totalOperations++;
          });

          const departmentMapDocRef = doc(db, "configuration", "departmentMap");
          batch.set(departmentMapDocRef, initialDepartmentMap);
          totalOperations++;

          initialWorkPhaseTemplates.forEach(phase => {
              const docRef = doc(db, "workPhaseTemplates", phase.id);
              batch.set(docRef, phase);
              totalOperations++;
          });

          initialWorkstations.forEach(ws => {
              const docRef = doc(db, "workstations", ws.id);
              batch.set(docRef, ws);
              totalOperations++;
          });
          
          await batch.commit();
          return { success: true, message: `Database popolato con successo con ${totalOperations} documenti.` };

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error("Errore nel seeding del database:", error);
          return { success: false, message: `Si è verificato un errore durante il popolamento del database: ${errorMessage}` };
        }
      };
      
      const result = await seedDatabaseClientSide();
       toast({
          title: result.success ? "Operazione Completata" : "Operazione Fallita",
          description: result.message,
          variant: result.success ? "default" : "destructive",
        });
    });
  }

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <AdminNavMenu />

            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Settings className="h-8 w-8 text-primary" />
                    Gestione App
                </h1>
                <p className="text-muted-foreground">
                    Personalizzazione dell'aspetto, del tema e dei dati iniziali dell'applicazione.
                </p>
            </header>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card>
                  <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                          <Brush className="h-6 w-6 text-primary" />
                          Personalizzazione Tema
                      </CardTitle>
                      <CardDescription>
                          Scegli il tema dell'applicazione. Puoi cambiarlo in qualsiasi momento usando il pulsante in basso a destra.
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                      <div>
                              <Label>Tema Attuale</Label>
                              <p className="text-sm text-muted-foreground">
                              L'applicazione supporta un tema chiaro e uno scuro. Usa il selettore per cambiare l'aspetto.
                              </p>
                              <div className="mt-4">
                              <ThemeToggler />
                              </div>
                      </div>
                      <Separator />
                      <div>
                          <Label>Anteprima Colori Principali</Label>
                          <div className="flex space-x-4 mt-2">
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-primary border-2 border-border"></div>
                                  <span className="text-xs mt-1">Primary</span>
                              </div>
                                  <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-secondary border-2 border-border"></div>
                                  <span className="text-xs mt-1">Secondary</span>
                              </div>
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-accent border-2 border-border"></div>
                                  <span className="text-xs mt-1">Accent</span>
                              </div>
                              <div className="flex flex-col items-center">
                                  <div className="w-10 h-10 rounded-full bg-destructive border-2 border-border"></div>
                                  <span className="text-xs mt-1">Destructive</span>
                              </div>
                          </div>
                      </div>
                  </CardContent>
              </Card>

              <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                          <Database className="h-6 w-6 text-primary" />
                          Dati Iniziali Applicazione
                      </CardTitle>
                      <CardDescription>
                          Usa questa funzione per caricare i dati di esempio (operatori, reparti, etc.) nel tuo database Firebase.
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 border border-yellow-500/50 bg-yellow-500/10 rounded-md">
                      <div className="flex items-start">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 mr-3 mt-1" />
                        <div>
                          <h4 className="font-semibold text-yellow-700 dark:text-yellow-400">Attenzione</h4>
                          <p className="text-sm text-yellow-600 dark:text-yellow-300">
                            Questa operazione aggiungerà i dati solo se le collezioni nel database sono vuote. Non sovrascriverà dati esistenti.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                   <CardFooter>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                         <Button variant="outline" className="w-full" disabled={isPending}>
                          Popola Database Iniziale
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confermi di voler procedere?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Verranno aggiunti i dati di esempio al tuo database Firestore. Questa operazione è consigliata solo al primo avvio o dopo un reset completo del database.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                          <AlertDialogAction onClick={handleSeedDatabase} disabled={isPending}>
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                            Sì, popola il database
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardFooter>
              </Card>
            </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
