
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Briefcase, Package2, Loader2, ShieldAlert, Unlock } from 'lucide-react';
import type { JobOrder, JobPhase } from '@/lib/mock-data';
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
import { useAuth } from '@/components/auth/AuthProvider';


function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  // Priority 1: Terminal/Blocking states
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended') return 'Sospesa';
  if (jobOrder.status === 'completed') return 'Completata';

  // Check phases
  const preparationPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'production');
  
  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) {
      return 'In Lavorazione';
  }

  const allPreparationDone = preparationPhases.every(p => p.status === 'completed');
  if (preparationPhases.length > 0 && allPreparationDone) {
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
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<OverallStatus | 'all'>('all');
  const [problemJob, setProblemJob] = useState<JobOrder | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    setIsLoading(true);
    const jobsRef = collection(db, "jobOrders");
    const q = query(jobsRef, where("status", "in", ["production", "suspended"]));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const jobs: JobOrder[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Firestore Timestamps to JS Dates
            const jobWithDates: JobOrder = JSON.parse(JSON.stringify(data), (key, value) => {
                if (key === 'start' || key === 'end' || key === 'overallStartTime' || key === 'overallEndTime' || key === 'odlCreationDate') {
                    if (value && typeof value === 'object' && value.seconds !== undefined) {
                        return new Date(value.seconds * 1000);
                    }
                }
                return value;
            });
            jobs.push(jobWithDates as JobOrder);
        });
        setJobOrders(jobs);
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching realtime job orders:", error);
        toast({
            variant: "destructive",
            title: "Errore di Sincronizzazione",
            description: "Impossibile caricare i dati della console in tempo reale.",
        });
        setIsLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [toast]);


  const filteredJobs = useMemo(() => {
    if (activeFilter === 'all') {
      return jobOrders;
    }
    return jobOrders.filter(job => getOverallStatus(job) === activeFilter);
  }, [jobOrders, activeFilter]);
  
  const handleResolveProblem = async () => {
    if (!problemJob || !user) return;
    const result = await resolveJobProblem(problemJob.id, user.uid);
    toast({
        title: result.success ? "Problema Risolto" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setProblemJob(null);
    // The real-time listener will automatically update the job state.
  };


  const filterOptions: (OverallStatus | 'all')[] = [
    'all',
    'Da Iniziare',
    'In Preparazione',
    'Pronto per Produzione',
    'In Lavorazione',
    'Sospesa',
    'Problema'
  ];

  return (
    <>
      <div className="space-y-6">
        <AdminNavMenu />
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div className='space-y-2'>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                  <Briefcase className="h-8 w-8 text-primary" />
                  Console Controllo Produzione
              </h1>
              <p className="text-muted-foreground">
                  Panoramica in tempo reale delle commesse inviate in produzione.
              </p>
          </div>
        </div>
        
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
                  <JobOrderCard key={job.id} jobOrder={job} onProblemClick={() => setProblemJob(job)} />
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg mt-8">
              <Package2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-muted-foreground">Nessuna Commessa Trovata</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                  Non ci sono commesse che corrispondono al filtro "{activeFilter}". Prova a selezionare un altro stato o
                  <Link href="/admin/data-management" className="text-primary underline hover:text-primary/80"> crea un ODL</Link>.
              </p>
          </div>
        )}
      </div>

       <AlertDialog open={!!problemJob} onOpenChange={(open) => !open && setProblemJob(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="text-destructive"/> Dettaglio Problema: {problemJob?.ordinePF}</AlertDialogTitle>
                <AlertDialogDescription>
                    <p className="font-bold text-foreground">Tipo: <span className="font-normal text-destructive">{problemJob?.problemType?.replace(/_/g, ' ') || 'N/D'}</span></p>
                    <p className="font-bold text-foreground">Note Operatore:</p>
                    <p className="text-sm text-muted-foreground p-2 bg-muted rounded-md">{problemJob?.problemNotes || 'Nessuna nota fornita.'}</p>
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
