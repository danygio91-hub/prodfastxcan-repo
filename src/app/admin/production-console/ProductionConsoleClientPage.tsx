

"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Briefcase, Package2, Loader2, ShieldAlert, Unlock, User, Search } from 'lucide-react';
import type { JobOrder, JobPhase, Operator } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import JobOrderCard from '@/components/production-console/JobOrderCard';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resolveJobProblem } from '@/app/scan-job/actions';
import { forceFinishProduction, toggleGuainaPhasePosition, revertPhaseCompletion, forcePauseOperators } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';


function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  // Priority 1: Terminal/Blocking states
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended') return 'Sospesa';
  if (jobOrder.status === 'completed') return 'Completata';

  // Check phases
  const preparationPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'production');
  const finishingPhases = (jobOrder.phases || []).filter(p => p.type === 'quality' || p.type === 'packaging');

  const isAnyFinishingActive = finishingPhases.some(p => p.status !== 'pending');
  if (isAnyFinishingActive) return 'In Lavorazione';

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) return 'In Lavorazione';
  
  const allPreparationDone = preparationPhases.every(p => p.status === 'completed');

  if (allPreparationDone) {
    const allProductionSkippedOrDone = productionPhases.every(p => p.status === 'completed');
    if (allProductionSkippedOrDone) {
        return 'Pronto per Finitura';
    }
     const isAnyProductionStarted = productionPhases.some(p => p.status !== 'pending');
      if (isAnyProductionStarted) {
         return 'In Lavorazione';
      }
      return 'Pronto per Produzione';
  }
  
  const isAnyPreparationActive = preparationPhases.some(p => p.status !== 'pending');
  if (isAnyPreparationActive) {
    return 'In Preparazione';
  }
  
  // Default state if no other condition is met
  return 'Da Iniziare';
}


export default function ProductionConsoleClientPage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [allOperators, setAllOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<OverallStatus | 'all'>('all');
  const [problemJob, setProblemJob] = useState<JobOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    setIsLoading(true);
    const jobsRef = collection(db, "jobOrders");
    const opsRef = collection(db, "operators");

    const unsubscribeJobs = onSnapshot(query(jobsRef, where("status", "in", ["production", "suspended", "completed"])), (querySnapshot) => {
        const jobs: JobOrder[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return JSON.parse(JSON.stringify(data), (key, value) => {
                if (['start', 'end', 'overallStartTime', 'overallEndTime', 'odlCreationDate'].includes(key) && value && typeof value === 'object' && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                }
                return value;
            }) as JobOrder;
        });
        setJobOrders(jobs);
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching realtime job orders:", error);
        toast({ variant: "destructive", title: "Errore di Sincronizzazione", description: "Impossibile caricare i dati della console in tempo reale." });
        setIsLoading(false);
    });
    
    const unsubscribeOps = onSnapshot(opsRef, (querySnapshot) => {
        setAllOperators(querySnapshot.docs.map(doc => doc.data() as Operator));
    }, (error) => {
        console.error("Error fetching operators:", error);
    });

    return () => {
      unsubscribeJobs();
      unsubscribeOps();
    };
  }, [toast]);


  const filteredJobs = useMemo(() => {
    const statusFiltered = activeFilter === 'all'
      ? jobOrders
      : jobOrders.filter(job => getOverallStatus(job) === activeFilter);
      
    if (!searchTerm) {
        return statusFiltered;
    }
    
    const lowercasedFilter = searchTerm.toLowerCase();
    return statusFiltered.filter(job =>
      (job.cliente?.toLowerCase() || '').includes(lowercasedFilter) ||
      job.ordinePF.toLowerCase().includes(lowercasedFilter) ||
      (job.numeroODL?.toLowerCase() || '').includes(lowercasedFilter) ||
      (job.numeroODLInterno?.toLowerCase() || '').includes(lowercasedFilter) ||
      job.details.toLowerCase().includes(lowercasedFilter)
    );
  }, [jobOrders, activeFilter, searchTerm]);
  
  const handleResolveProblem = async () => {
    if (!problemJob || !user) return;
    const result = await resolveJobProblem(problemJob.id, user.uid);
    toast({
        title: result.success ? "Problema Risolto" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setProblemJob(null);
  };

  const handleForceFinish = async (jobId: string) => {
     if (!user) return;
     const result = await forceFinishProduction(jobId, user.uid);
      toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  }

  const handleToggleGuaina = async (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => {
      if (!user) return;
      const result = await toggleGuainaPhasePosition(jobId, phaseId, currentState);
      toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  }

  const handleRevertPhase = async (jobId: string, phaseId: string) => {
    if (!user) return;
    const result = await revertPhaseCompletion(jobId, phaseId, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  };

  const handleForcePause = async (jobId: string, operatorIdsToPause: string[]) => {
    if (!user) return;
    const result = await forcePauseOperators(jobId, operatorIdsToPause, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  };


  const filterOptions: (OverallStatus | 'all')[] = [
    'all',
    'Da Iniziare',
    'In Preparazione',
    'Pronto per Produzione',
    'Pronto per Finitura',
    'In Lavorazione',
    'Sospesa',
    'Problema',
    'Completata'
  ];

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Briefcase className="h-8 w-8 text-primary" />
                    Console Controllo Produzione
                </h1>
                <p className="text-muted-foreground mt-1">
                    Panoramica in tempo reale delle commesse inviate in produzione.
                </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Cerca commessa, cliente, articolo..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </header>
        
        <Card className="p-2 mb-6">
          <div className="flex flex-wrap items-center justify-center gap-2">
              {filterOptions.map(filter => (
              <Button
                  key={filter}
                  variant={activeFilter === filter ? 'default' : 'ghost'}
                  onClick={() => setActiveFilter(filter)}
                  className="capitalize px-3 py-1 h-auto"
              >
                  {filter === 'all' ? 'Tutte' : filter}
              </Button>
              ))}
          </div>
        </Card>

        {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 text-muted-foreground">Aggiornamento commesse...</p>
          </div>
        ) : filteredJobs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredJobs.map(job => (
                  <JobOrderCard 
                    key={job.id} 
                    jobOrder={job} 
                    allOperators={allOperators}
                    onProblemClick={() => setProblemJob(job)}
                    onForceFinishClick={handleForceFinish}
                    onToggleGuainaClick={handleToggleGuaina}
                    onRevertPhaseClick={handleRevertPhase}
                    onForcePauseClick={handleForcePause}
                   />
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg mt-8">
              <Package2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-muted-foreground">
                {jobOrders.length === 0 ? "Nessuna Commessa in Produzione" : "Nessuna Commessa Trovata"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                  {jobOrders.length === 0
                    ? <>Non ci sono ancora commesse in lavorazione. <Link href="/admin/data-management" className="text-primary underline hover:text-primary/80">Crea un ODL</Link> per iniziare.</>
                    : `Nessuna commessa corrisponde ai filtri impostati. Prova a cambiare la ricerca o il filtro di stato.`
                  }
              </p>
          </div>
        )}
      </div>

       <AlertDialog open={!!problemJob} onOpenChange={(open) => !open && setProblemJob(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="text-destructive"/> Dettaglio Problema: {problemJob?.ordinePF}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm pt-2">
                        <p><strong className="text-foreground">Tipo:</strong> <span className="text-destructive">{problemJob?.problemType?.replace(/_/g, ' ') || 'N/D'}</span></p>
                        <p><strong className="text-foreground">Segnalato da:</strong> {problemJob?.problemReportedBy || 'N/D'}</p>
                        <div>
                            <p className="font-bold text-foreground">Note Operatore:</p>
                            <p className="text-muted-foreground p-2 bg-muted rounded-md">{problemJob?.problemNotes || 'Nessuna nota fornita.'}</p>
                        </div>
                    </div>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Chiudi</AlertDialogCancel>
                <AlertDialogAction onClick={handleResolveProblem} className="bg-green-600 hover:bg-green-700">
                    <Unlock className="mr-2 h-4 w-4"/> Sblocca Commessa
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
