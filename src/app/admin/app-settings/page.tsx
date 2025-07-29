
"use client";

import React, { useState, useTransition, useRef } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Settings, Brush, Database, AlertTriangle, Loader2, Trash2, ShieldOff, Boxes, Factory, LogOut, History, Download, Upload } from 'lucide-react';
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
import { resetAllJobOrders, resetAllRawMaterials, resetRawMaterialHistory, resetAllPrivacySignatures, resetAllWithdrawals, resetAllWorkInProgress, resetAllActiveSessions, backupAllData, restoreDataFromBackup } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';


// Helper function to trigger a global logout for all clients
function triggerGlobalLogout() {
  const timestamp = Date.now().toString();
  localStorage.setItem('force_logout_timestamp', timestamp);

  // Clear all session keys from localStorage
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('prodtime_tracker_active_material_sessions_') || key.startsWith('prodtime_tracker_active_job_id_')) {
      localStorage.removeItem(key);
    }
  });
  
  // Use a BroadcastChannel to notify other tabs of the same origin
  const channel = new BroadcastChannel('auth_channel');
  channel.postMessage({ type: 'FORCE_LOGOUT', timestamp });
  channel.close();
}


export default function AdminAppSettingsPage() {
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [isResettingJobs, startResetJobsTransition] = useTransition();
  const [isResettingMaterials, startResetMaterialsTransition] = useTransition();
  const [isResettingMaterialHistory, startResetMaterialHistoryTransition] = useTransition();
  const [isResettingPrivacy, startResetPrivacyTransition] = useTransition();
  const [isResettingWithdrawals, startResetWithdrawalsTransition] = useTransition();
  const [isResettingWork, startResetWorkTransition] = useTransition();
  const [isResettingSessions, startResetSessionsTransition] = useTransition();
  const [isBackingUp, startBackupTransition] = useTransition();
  const [isRestoring, startRestoreTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);

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
          let userFriendlyMessage = `Si è verificato un errore: ${errorMessage}`;
          if (errorMessage.toLowerCase().includes('permission-denied') || errorMessage.toLowerCase().includes('insufficient permissions')) {
            userFriendlyMessage = "Errore di permessi. Assicurati che le regole di sicurezza di Firestore permettano la scrittura. Per lo sviluppo, puoi impostarle temporaneamente su 'allow read, write: if true;' nella console di Firebase.";
          }
          return { success: false, message: userFriendlyMessage };
        }
      };
      
      const result = await seedDatabaseClientSide();
       toast({
          title: result.success ? "Operazione Completata" : "Operazione Fallita",
          description: result.message,
          variant: result.success ? "default" : "destructive",
          duration: result.success ? 5000 : 9000,
        });
    });
  }

  const handleBackup = () => {
    startBackupTransition(async () => {
        toast({ title: "Avvio del Backup", description: "Preparazione dei dati in corso..." });
        const result = await backupAllData();

        if (result.success && result.data) {
            try {
                const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.data, null, 2))}`;
                const link = document.createElement("a");
                link.href = jsonString;
                link.download = `pfxcan_backup_${new Date().toISOString().split('T')[0]}.json`;
                link.click();
                toast({ title: "Backup Completato", description: "Il file di backup è stato scaricato." });
            } catch (e) {
                toast({ variant: "destructive", title: "Errore Download", description: "Impossibile creare il file di backup da scaricare." });
            }
        } else {
            toast({ variant: "destructive", title: "Backup Fallito", description: result.message });
        }
    });
  };

  const handleRestoreTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target?.result;
        if (typeof content === 'string') {
            startRestoreTransition(async () => {
                if (!user) return;
                toast({ title: 'Ripristino in corso', description: 'Cancellazione dei dati attuali...' });
                const result = await restoreDataFromBackup(content, user.uid);
                toast({
                    title: result.success ? "Ripristino Completato" : "Ripristino Fallito",
                    description: result.message,
                    variant: result.success ? "default" : "destructive",
                });
                if (result.success) {
                    triggerGlobalLogout();
                    toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
                }
            });
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const handleResetJobOrders = () => {
    if (!user) return;
    startResetJobsTransition(async () => {
        const result = await resetAllJobOrders(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
          triggerGlobalLogout();
          toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
        }
    });
  };

  const handleResetRawMaterials = () => {
    if (!user) return;
    startResetMaterialsTransition(async () => {
        const result = await resetAllRawMaterials(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
         if (result.success) {
          triggerGlobalLogout();
          toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
        }
    });
  };
  
  const handleResetMaterialHistory = () => {
    if (!user) return;
    startResetMaterialHistoryTransition(async () => {
        const result = await resetRawMaterialHistory(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
    });
  };

  const handleResetWithdrawals = () => {
    if (!user) return;
    startResetWithdrawalsTransition(async () => {
        const result = await resetAllWithdrawals(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
    });
  };

  const handleResetPrivacy = () => {
    if (!user) return;
    startResetPrivacyTransition(async () => {
        const result = await resetAllPrivacySignatures(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
    });
  };

  const handleResetWork = () => {
    if (!user) return;
    startResetWorkTransition(async () => {
        const result = await resetAllWorkInProgress(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
          triggerGlobalLogout();
          toast({ title: 'Logout Forzato', description: 'Tutti gli utenti verranno disconnessi per applicare le modifiche.', variant: 'default' });
        }
    });
  };
  
  const handleResetSessions = () => {
    if (!user) return;
    startResetSessionsTransition(async () => {
        const result = await resetAllActiveSessions(user.uid);
        toast({
            title: result.success ? "Operazione Completata" : "Operazione Fallita",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
          triggerGlobalLogout();
          toast({ title: 'Logout Forzato', description: 'Tutti gli utenti (escluso l\'admin) verranno disconnessi per resettare le loro sessioni attive.', variant: 'default' });
        }
    });
  };

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
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-1">
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

              <div className="lg:col-span-2 space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="h-6 w-6 text-primary" />
                            Gestione Dati Applicazione
                        </CardTitle>
                        <CardDescription>
                            Azioni di popolamento, backup e ripristino del database.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2 p-4 rounded-lg border">
                         <h4 className="font-semibold flex items-center gap-2"><Database className="h-5 w-5"/> Popolamento Iniziale</h4>
                         <p className="text-sm text-muted-foreground">Aggiunge dati di esempio solo se il database è vuoto.</p>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                             <Button variant="outline" className="w-full" disabled={isPending}>
                              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
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
                      </div>

                      <div className="space-y-2 p-4 rounded-lg border">
                          <h4 className="font-semibold flex items-center gap-2"><Download className="h-5 w-5"/> Backup Completo</h4>
                          <p className="text-sm text-muted-foreground">Scarica un file JSON con tutti i dati principali dell'app.</p>
                          <Button onClick={handleBackup} disabled={isBackingUp} className="w-full">
                           {isBackingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                            Esegui Backup
                          </Button>
                      </div>
                       <div className="space-y-2 p-4 rounded-lg border md:col-span-2 border-yellow-500/50 bg-yellow-500/10">
                          <h4 className="font-semibold flex items-center gap-2 text-yellow-700 dark:text-yellow-400"><Upload className="h-5 w-5"/> Ripristino da Backup</h4>
                          <p className="text-sm text-yellow-600 dark:text-yellow-300">Carica un file JSON di backup. <span className="font-bold">Attenzione:</span> tutti i dati attuali verranno eliminati e sostituiti.</p>
                           <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" className="w-full border-yellow-500/50 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" disabled={isRestoring}>
                                {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                Ripristina da Backup
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Questa azione è irreversibile. Tutti i dati correnti verranno eliminati e sostituiti con i dati del file di backup. Vuoi procedere?
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleRestoreTrigger} disabled={isRestoring}>
                                        {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                        Sì, procedi al ripristino
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                           </AlertDialog>
                          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />
                      </div>
                    </CardContent>
                </Card>
              </div>

            </div>
            
            <div className="mt-8">
              <Card className="border-destructive">
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-6 w-6" />
                          Zona Pericolosa
                      </CardTitle>
                      <CardDescription>
                          Queste operazioni sono irreversibili e cancelleranno permanentemente i dati o resetteranno gli stati. Procedere con la massima cautela.
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                       <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Sessioni Attive</h4>
                              <p className="text-sm text-muted-foreground">
                                  Forza un logout per tutti gli operatori, cancellando le loro sessioni locali (es. commesse e materiali attivi).
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingSessions}>
                                      {isResettingSessions ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogOut className="mr-2 h-4 w-4" />}
                                      Resetta Sessioni
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione disconnetterà tutti gli operatori e pulirà il loro stato locale. Utile per risolvere sessioni bloccate.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetSessions} disabled={isResettingSessions} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingSessions ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, resetta le sessioni
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                      <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Tutte le Commesse</h4>
                              <p className="text-sm text-muted-foreground">
                                  Elimina TUTTE le commesse, i prelievi e resetta lo stato degli operatori.
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingJobs}>
                                      {isResettingJobs ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                                      Resetta Commesse
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione è irreversibile. Verranno eliminate TUTTE le commesse e i prelievi.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetJobOrders} disabled={isResettingJobs} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingJobs ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, elimina tutto
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                       <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Tutte le Lavorazioni</h4>
                              <p className="text-sm text-muted-foreground">
                                  Resetta lo stato di tutte le commesse in lavorazione a "pianificata" e imposta tutti gli operatori come "inattivi".
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingWork}>
                                      {isResettingWork ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Factory className="mr-2 h-4 w-4" />}
                                      Resetta Lavorazioni
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione riporterà tutte le commesse in produzione allo stato di "pianificata", azzerando l'avanzamento.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetWork} disabled={isResettingWork} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingWork ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, resetta tutto
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                      <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Anagrafica Materie Prime</h4>
                              <p className="text-sm text-muted-foreground">
                                  Elimina tutta l'anagrafica delle materie prime, i lotti e i prelievi.
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingMaterials}>
                                      {isResettingMaterials ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                                      Resetta Anagrafica
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione è irreversibile. Verranno eliminate TUTTE le materie prime e i prelievi dal sistema.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetRawMaterials} disabled={isResettingMaterials} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingMaterials ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, elimina tutto
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                      <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Storico Materiali</h4>
                              <p className="text-sm text-muted-foreground">
                                 Elimina lotti e prelievi, azzerando lo stock ma mantenendo l'anagrafica.
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingMaterialHistory}>
                                      {isResettingMaterialHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <History className="mr-2 h-4 w-4" />}
                                      Resetta Storico
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                         Questa azione è irreversibile. Verranno eliminati TUTTI i lotti e i prelievi. Lo stock verrà azzerato.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetMaterialHistory} disabled={isResettingMaterialHistory} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingMaterialHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, resetta storico
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                      <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Prelievi da Magazzino</h4>
                              <p className="text-sm text-muted-foreground">
                                  Elimina tutti i report dei prelievi di materiale e ripristina lo stock.
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingWithdrawals}>
                                      {isResettingWithdrawals ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Boxes className="mr-2 h-4 w-4" />}
                                      Resetta Prelievi
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione è irreversibile. Verranno eliminati TUTTI i report di prelievo e lo stock verrà ripristinato.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetWithdrawals} disabled={isResettingWithdrawals} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingWithdrawals ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, resetta tutto
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                      <div className="flex justify-between items-center p-4 border rounded-md">
                          <div>
                              <h4 className="font-semibold">Reset Firme Privacy</h4>
                              <p className="text-sm text-muted-foreground">
                                  Annulla l'accettazione dell'informativa privacy per tutti gli operatori.
                              </p>
                          </div>
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="destructive" disabled={isResettingPrivacy}>
                                      {isResettingPrivacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldOff className="mr-2 h-4 w-4" />}
                                      Resetta Firme
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione forzerà tutti gli operatori a ri-accettare l'informativa al loro prossimo accesso.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleResetPrivacy} disabled={isResettingPrivacy} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                          {isResettingPrivacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                          Sì, resetta tutto
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                  </CardContent>
              </Card>
            </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
