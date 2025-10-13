

"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Briefcase, Package2, Loader2, ShieldAlert, Unlock, User, Search, Combine, PowerOff, Activity, Calendar as CalendarIcon, Link as LinkIcon, FastForward, Trash2 } from 'lucide-react';
import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resolveJobProblem } from '@/app/scan-job/actions';
import { forceFinishProduction, toggleGuainaPhasePosition, revertPhaseCompletion, forcePauseOperators, forceCompleteJob, resetSingleCompletedJobOrder, revertForceFinish, forceFinishMultiple, forceCompleteMultiple } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

type FilterStatus = OverallStatus | 'all' | 'LIVE';

function isJobLive(jobOrder: JobOrder): boolean {
    return (jobOrder.phases || []).some(p => p.status === 'in-progress');
}

function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  const allPhases = jobOrder.phases || [];
  const allPhasesCompleted = allPhases.length > 0 && allPhases.every(p => p.status === 'completed' || p.status === 'skipped');

  if (allPhasesCompleted || jobOrder.status === 'completed') {
    return 'Completata';
  }

  // Priority 1: Terminal/Blocking states (after completion check)
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended' || jobOrder.status === 'paused') return 'Sospesa';

  // Check phases
  const preparationPhases = allPhases.filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = allPhases.filter(p => (p.type ?? 'production') === 'production');
  const finishingPhases = allPhases.filter(p => p.type === 'quality' || p.type === 'packaging');
  
  const isAnyFinishingActive = finishingPhases.some(p => p.status !== 'pending');
  if (isAnyFinishingActive) return 'In Lavorazione';

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) return 'In Lavorazione';
  
  const allPreparationDone = preparationPhases.every(p => p.status === 'completed' || p.status === 'skipped');

  if (allPreparationDone) {
    const allProductionSkippedOrDone = productionPhases.every(p => p.status === 'completed' || p.status === 'skipped');
    if (allProductionSkippedOrDone) {
        return 'Pronto per Finitura';
    }
     const isAnyProductionStarted = productionPhases.some(p => p.status !== 'pending');
      if (isAnyProductionStarted) {
         return 'In Lavorazione';
      }
      return 'Pronto per Produzione';
  }
  
  const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
  if (isAnyPreparationStarted) {
    return 'In Preparazione';
  }
  
  // Default state if no other condition is met
  return 'Da Iniziare';
}


function ProductionConsoleView() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [allOperators, setAllOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('all');
  const [problemJob, setProblemJob] = useState<JobOrder | null>(null);
  
  const searchParams = useSearchParams();
  const groupIdFromUrl = searchParams.get('groupId');
  const [searchTerm, setSearchTerm] = useState(groupIdFromUrl || '');
  const [completedDateFilter, setCompletedDateFilter] = useState<Date | undefined>(new Date());
  const [isDateFilterActive, setIsDateFilterActive] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);


  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    setIsLoading(true);
    const jobsRef = collection(db, "jobOrders");
    const groupsRef = collection(db, "workGroups");
    const opsRef = collection(db, "operators");

    const unsubscribeJobs = onSnapshot(query(jobsRef, where("status", "in", ["production", "suspended", "completed", "paused"])), (querySnapshot) => {
        const jobs: JobOrder[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return JSON.parse(JSON.stringify(data), (key, value) => {
                if ((['start', 'end', 'overallStartTime', 'overallEndTime', 'odlCreationDate', 'createdAt']).includes(key) && value && typeof value === 'object' && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                }
                return value;
            }) as JobOrder;
        });
        setJobOrders(jobs);
        setIsLoading(false); // Set loading to false once we have data
    }, (error) => {
        console.error("Error fetching realtime job orders:", error);
        toast({ variant: "destructive", title: "Errore di Sincronizzazione", description: "Impossibile caricare i dati della console in tempo reale." });
        setIsLoading(false);
    });

    const unsubscribeGroups = onSnapshot(query(groupsRef), (querySnapshot) => {
        const groups: WorkGroup[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return JSON.parse(JSON.stringify(data), (key, value) => {
                if ((key === 'createdAt' || key === 'overallStartTime' || key === 'overallEndTime') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                }
                return value;
            }) as WorkGroup;
        });
        setWorkGroups(groups);
    }, (error) => {
        console.error("Error fetching realtime work groups:", error);
    });
    
    const unsubscribeOps = onSnapshot(opsRef, (querySnapshot) => {
        setAllOperators(querySnapshot.docs.map(doc => doc.data() as Operator));
    }, (error) => {
        console.error("Error fetching operators:", error);
    });

    return () => {
      unsubscribeJobs();
      unsubscribeGroups();
      unsubscribeOps();
    };
  }, [toast]);


  const synthesizedJobOrders = useMemo(() => {
    if (workGroups.length === 0) return jobOrders;

    const groupMap = new Map(workGroups.map(g => [g.id, g]));
    
    return jobOrders.map(job => {
      if (!job.workGroupId || !groupMap.has(job.workGroupId)) {
        return job;
      }
      
      const group = groupMap.get(job.workGroupId)!;
      // Return a new job object with its state overridden by the group's state
      return {
        ...job,
        status: group.status,
        phases: group.phases,
        isProblemReported: group.isProblemReported,
        problemType: group.problemType,
        problemNotes: group.problemNotes,
        problemReportedBy: group.problemReportedBy,
        overallStartTime: group.overallStartTime,
        overallEndTime: group.overallEndTime,
      };
    });
  }, [jobOrders, workGroups]);


  const filteredJobs = useMemo(() => {
    let statusFiltered: JobOrder[];

    if (activeFilter === 'all') {
      statusFiltered = synthesizedJobOrders;
    } else if (activeFilter === 'LIVE') {
      statusFiltered = synthesizedJobOrders.filter(job => isJobLive(job));
    } else {
      statusFiltered = synthesizedJobOrders.filter(job => getOverallStatus(job) === activeFilter);
    }
      
     // Apply date filter only for 'Completata'
    if (activeFilter === 'Completata' && isDateFilterActive && completedDateFilter) {
      statusFiltered = statusFiltered.filter(job => 
        job.overallEndTime && isSameDay(new Date(job.overallEndTime), completedDateFilter)
      );
    }

    if (!searchTerm) {
        return statusFiltered;
    }
    
    const lowercasedFilter = searchTerm.toLowerCase();
    
     if (groupIdFromUrl && searchTerm === groupIdFromUrl) {
      return statusFiltered.filter(job => job.workGroupId === groupIdFromUrl);
    }
    
    return statusFiltered.filter(job =>
      (job.cliente?.toLowerCase() || '').includes(lowercasedFilter) ||
      job.ordinePF.toLowerCase().includes(lowercasedFilter) ||
      (job.numeroODL?.toLowerCase() || '').includes(lowercasedFilter) ||
      (job.numeroODLInterno?.toLowerCase() || '').includes(lowercasedFilter) ||
      job.details.toLowerCase().includes(lowercasedFilter)
    );
  }, [synthesizedJobOrders, activeFilter, searchTerm, groupIdFromUrl, isDateFilterActive, completedDateFilter]);
  
  const workGroupsMap = useMemo(() => {
    return new Map(workGroups.map(group => [group.id, group]));
  }, [workGroups]);
  
  useEffect(() => {
    setSelectedJobIds([]);
  }, [activeFilter, searchTerm]);

  const handleSelectAll = () => {
    if (selectedJobIds.length === filteredJobs.length) {
      setSelectedJobIds([]);
    } else {
      setSelectedJobIds(filteredJobs.map(j => j.id));
    }
  };
  
  const handleSelectJob = (jobId: string) => {
    setSelectedJobIds(prev =>
      prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]
    );
  };
  
  const handleBulkForceFinish = async () => {
    if (!user || selectedJobIds.length === 0) return;
    const result = await forceFinishMultiple(selectedJobIds, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) setSelectedJobIds([]);
  };

  const handleBulkForceComplete = async () => {
    if (!user || selectedJobIds.length === 0) return;
    const result = await forceCompleteMultiple(selectedJobIds, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) setSelectedJobIds([]);
  };


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
  
  const handleRevertForceFinish = async (jobId: string) => {
    if (!user) return;
    const result = await revertForceFinish(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  };

  const handleForceComplete = async (jobId: string) => {
    if (!user) return;
    const result = await forceCompleteJob(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  };

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

  const handleResetJobOrder = async (jobId: string) => {
    if (!user) return;
    const result = await resetSingleCompletedJobOrder(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  }


  const filterOptions: FilterStatus[] = [
    'all',
    'LIVE',
    'In Lavorazione',
    'Sospesa',
    'Problema',
    'Pronto per Produzione',
    'Pronto per Finitura',
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
        
        <Card className="p-2 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
              {filterOptions.map(filter => (
              <Button
                  key={filter}
                  variant={activeFilter === filter ? 'default' : 'ghost'}
                  onClick={() => setActiveFilter(filter)}
                  className="capitalize px-3 py-1 h-auto"
              >
                  {filter === 'LIVE' && <Activity className="mr-2 h-4 w-4 text-red-400 animate-pulse" />}
                  {filter === 'all' ? 'Tutte' : (filter === 'LIVE' ? 'In Corso (Live)' : filter)}
              </Button>
              ))}
          </div>
           {activeFilter === 'Completata' && (
              <div className="border-t pt-2 flex items-center justify-center gap-4 flex-wrap">
                  <div className="flex items-center space-x-2">
                      <Switch id="date-filter-switch" checked={isDateFilterActive} onCheckedChange={setIsDateFilterActive} />
                      <Label htmlFor="date-filter-switch">Filtra per data</Label>
                  </div>
                  <Popover>
                      <PopoverTrigger asChild>
                          <Button
                              variant={"outline"}
                              className={cn("w-[240px] justify-start text-left font-normal", !completedDateFilter && "text-muted-foreground", !isDateFilterActive && "opacity-50 cursor-not-allowed")}
                              disabled={!isDateFilterActive}
                          >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {completedDateFilter ? format(completedDateFilter, "PPP", { locale: it }) : <span>Scegli una data</span>}
                          </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="center">
                          <Calendar
                              mode="single"
                              selected={completedDateFilter}
                              onSelect={setCompletedDateFilter}
                              initialFocus
                          />
                      </PopoverContent>
                  </Popover>
              </div>
          )}
        </Card>
        
         {filteredJobs.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                  <Checkbox
                      id="select-all"
                      checked={selectedJobIds.length > 0 && selectedJobIds.length === filteredJobs.length ? true : selectedJobIds.length > 0 ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAll}
                  />
                  <Label htmlFor="select-all">Seleziona Tutte ({filteredJobs.length})</Label>
              </div>
              {selectedJobIds.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                  <FastForward className="mr-2 h-4 w-4" /> Forza a Finitura ({selectedJobIds.length})
                              </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Confermi l'azione?</AlertDialogTitle><AlertDialogDescription>Stai per forzare {selectedJobIds.length} commesse alla finitura. Le fasi di produzione verranno completate d'ufficio.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceFinish}>Conferma</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                  <PowerOff className="mr-2 h-4 w-4" /> Chiudi Commesse ({selectedJobIds.length})
                              </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                               <AlertDialogHeader><AlertDialogTitle>Confermi l'azione?</AlertDialogTitle><AlertDialogDescription>Stai per chiudere forzatamente {selectedJobIds.length} commesse. Lo stato verrà impostato su "Completata".</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceComplete}>Conferma</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                       <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm">
                                  <Trash2 className="mr-2 h-4 w-4" /> Annulla e Resetta ({selectedJobIds.length})
                              </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                               <AlertDialogHeader><AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per resettare {selectedJobIds.length} commesse allo stato 'pianificata', azzerando ogni lavorazione e ripristinando lo stock.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => { selectedJobIds.forEach(id => handleResetJobOrder(id)); setSelectedJobIds([]); }}>Sì, Annulla e Resetta</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                  </div>
              )}
          </div>
        )}

        {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 text-muted-foreground">Aggiornamento commesse...</p>
          </div>
        ) : filteredJobs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredJobs.map(job => {
                  const workGroup = job.workGroupId ? workGroupsMap.get(job.workGroupId) : null;
                  return (
                    <JobOrderCard 
                      key={job.id} 
                      jobOrder={job}
                      workGroup={workGroup} 
                      allOperators={allOperators}
                      onProblemClick={() => setProblemJob(job)}
                      onForceFinishClick={handleForceFinish}
                      onRevertForceFinishClick={handleRevertForceFinish}
                      onToggleGuainaClick={handleToggleGuaina}
                      onRevertPhaseClick={handleRevertPhase}
                      onForcePauseClick={handleForcePause}
                      onForceCompleteClick={handleForceComplete}
                      onResetJobOrderClick={handleResetJobOrder}
                      isSelected={selectedJobIds.includes(job.id)}
                      onSelect={handleSelectJob}
                    />
                  );
              })}
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
                    : `Nessuna commessa corrisponde ai filtri impostati.`
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

export default function ProductionConsoleClientPage() {
    return (
        <React.Suspense fallback={
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">Caricamento console...</p>
            </div>
        }>
            <ProductionConsoleView />
        </React.Suspense>
    )
}
