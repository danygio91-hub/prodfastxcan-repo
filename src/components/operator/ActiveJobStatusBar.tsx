
"use client";

import React from 'react';
import Link from 'next/link';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { updateJob, updateWorkGroup, updateOperatorStatus } from '@/app/scan-job/actions';
import { Play, Pause, Check, Activity } from 'lucide-react';
import type { JobOrder, JobPhase, WorkGroup } from '@/types';
import { cn } from '@/lib/utils';
import { getDerivedJobStatus } from '@/lib/job-status';

export default function ActiveJobStatusBar() {
  const { activeJob, isLoading, isStatusBarHighlighted } = useActiveJob();
  const { operator } = useAuth();
  const { toast } = useToast();

  const handleUpdateJobOrGroup = async (updatedJobOrGroup: JobOrder | WorkGroup) => {
    if (!operator) return;
    const isGroup = updatedJobOrGroup.id.startsWith('group-');
    const result = isGroup
        ? await updateWorkGroup(updatedJobOrGroup as WorkGroup, operator.id)
        : await updateJob(updatedJobOrGroup as JobOrder);

    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Errore di Sincronizzazione",
        description: result.message,
      });
    }
  };

  const handlePauseResume = async (phaseId: string) => {
    if (!activeJob || !operator) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);
    if (!phaseToUpdate) return;
    
    const myWorkPeriodIndex = phaseToUpdate.workPeriods.findIndex((wp: any) => wp.operatorId === operator.id && wp.end === null);

    if (myWorkPeriodIndex !== -1) { // Operator is currently active, so pause
      phaseToUpdate.workPeriods[myWorkPeriodIndex].end = new Date();
       const isAnyoneElseWorking = phaseToUpdate.workPeriods.some((wp: any) => wp.end === null);
       if (!isAnyoneElseWorking) {
          phaseToUpdate.status = 'paused';
       }
       // Keep the operator on the job, but clear the active phase
      await updateOperatorStatus(operator.id, activeJob.id, null);
      toast({ title: "Fase in Pausa", description: `La tua attività sulla fase "${phaseToUpdate.name}" è stata messa in pausa.` });
    } else { // Operator is not active, so resume/join
      phaseToUpdate.status = 'in-progress';
      phaseToUpdate.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
      await updateOperatorStatus(operator.id, jobToUpdate.id, phaseToUpdate.name);
      toast({ title: "Fase Ripresa", description: `Hai iniziato a lavorare sulla fase "${phaseToUpdate.name}".` });
    }
    
    handleUpdateJobOrGroup(jobToUpdate);
  };

  const handleCompletePhase = async (phaseId: string) => {
    if (!activeJob || !operator) return;

    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);
    if (!phaseToUpdate) return;
    
    const myWorkPeriodIndex = phaseToUpdate.workPeriods.findIndex((wp: any) => wp.operatorId === operator.id && wp.end === null);
    if (myWorkPeriodIndex !== -1) {
        phaseToUpdate.workPeriods[myWorkPeriodIndex].end = new Date();
    } else {
        toast({
            variant: "destructive",
            title: "Nessuna attività da completare",
            description: "Non hai un periodo di lavoro attivo su questa fase da completare.",
        });
        return;
    }
    
    const isAnyoneElseWorking = phaseToUpdate.workPeriods.some((wp: any) => wp.end === null);

    if (!isAnyoneElseWorking) {
        phaseToUpdate.status = 'completed';
    }
    
    await updateOperatorStatus(operator.id, activeJob.id, null);
    toast({ title: "Fase Completata", description: `La tua attività sulla fase "${phaseToUpdate.name}" è terminata.` });
    
    const allPhasesCompleted = jobToUpdate.phases.every((p: JobPhase) => p.status === 'completed' || p.status === 'skipped');
    if (allPhasesCompleted) {
        jobToUpdate.status = 'completed';
        jobToUpdate.overallEndTime = new Date();
        toast({ title: "Commessa Completata!", description: `Tutte le fasi per ${jobToUpdate.id} sono terminate.` });
    }
    
    handleUpdateJobOrGroup(jobToUpdate);
  };

  if (isLoading || !activeJob || getDerivedJobStatus(activeJob) === 'CHIUSO' || getDerivedJobStatus(activeJob) === 'DA_INIZIARE' || !operator) {
    return null;
  }
  
  // Find the most relevant phase for the current operator.
  // Priority 1: An active phase ('in-progress') the operator is working on.
  // Priority 2: If none is active, find the last paused phase the operator worked on.
  const myActivePhase = (activeJob.phases || []).find(p => p.status === 'in-progress' && (p.workPeriods || []).some(wp => wp.operatorId === operator.id && wp.end === null));
  
  const myLastPausedPhase = [...(activeJob.phases || [])]
      .filter(p => p.status === 'paused' && (p.workPeriods || []).some(wp => wp.operatorId === operator.id))
      .sort((a,b) => {
          const aLastEnd = Math.max(...(a.workPeriods || []).filter(wp => wp.end).map(wp => new Date(wp.end!).getTime()));
          const bLastEnd = Math.max(...(b.workPeriods || []).filter(wp => wp.end).map(wp => new Date(wp.end!).getTime()));
          return bLastEnd - aLastEnd;
      })[0];
  
  const myRelevantPhase = myActivePhase || myLastPausedPhase;


  if (!myRelevantPhase) {
    // If there is no active or paused phase for me, but I am still "on a job", show a generic bar.
    if (operator.activeJobId === activeJob.id) {
        return (
             <div className="fixed bottom-0 left-0 right-0 z-50 p-2 sm:p-4 pointer-events-none">
                 <Card className={cn(
                    "p-3 shadow-2xl w-full max-w-lg mx-auto pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-5 duration-300 transition-all",
                    isStatusBarHighlighted && "border-primary ring-4 ring-primary/50",
                    "bg-secondary text-secondary-foreground"
                 )}>
                     <div className="flex items-center justify-between gap-4">
                         <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">Commessa: {activeJob.ordinePF}</p>
                            <p className="text-xs truncate">Nessuna fase attiva per te. Premi Dettagli per iniziare.</p>
                         </div>
                         <Button asChild variant="default" size="sm" className="h-9 bg-black/10 text-inherit hover:bg-black/20">
                            <Link href="/scan-job">
                                <Activity className="mr-2 h-4 w-4" />
                                Dettagli
                            </Link>
                        </Button>
                     </div>
                 </Card>
             </div>
        )
    }
    return null;
  }

  const isMyWorkActive = myRelevantPhase.status === 'in-progress' && (myRelevantPhase.workPeriods || []).some(wp => wp.operatorId === operator.id && wp.end === null);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-2 sm:p-4 pointer-events-none">
        <Card className={cn(
            "p-3 shadow-2xl w-full max-w-lg mx-auto pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-5 duration-300 transition-all",
            isStatusBarHighlighted && "border-primary ring-4 ring-primary/50",
            isMyWorkActive ? "bg-teal-500 text-teal-50" : "bg-amber-400 text-amber-900"
        )}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">Commessa: {activeJob.ordinePF}</p>
                    <p className={cn("text-[10px] sm:text-xs truncate flex items-center gap-1.5", isMyWorkActive ? "text-teal-100" : "text-amber-800")}>
                       {isMyWorkActive 
                          ? <span className="h-2 w-2 rounded-full bg-white animate-pulse flex-shrink-0"></span>
                          : <span className="h-2 w-2 rounded-full bg-orange-600 flex-shrink-0"></span>
                       }
                       <span className="truncate">{isMyWorkActive ? 'Fase Attiva:' : 'Fase in Pausa:'} {myRelevantPhase.name}</span>
                    </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                    <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className={cn("h-9 w-9", 
                            isMyWorkActive ? "bg-white/20 border-white/30 text-white hover:bg-white/30" : "bg-black/5 border-black/10 text-black/70 hover:bg-black/10"
                          )}
                          onClick={() => handlePauseResume(myRelevantPhase.id)} 
                          disabled={activeJob.isProblemReported}
                        >
                          {isMyWorkActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          <span className="sr-only">{isMyWorkActive ? 'Pausa' : 'Riprendi'}</span>
                        </Button>

                        <Button 
                            variant="outline" 
                            size="icon" 
                            className={cn("h-9 w-9", isMyWorkActive ? "bg-white/20 border-white/30 text-white hover:bg-white/30" : "bg-black/5 border-black/10 text-black/70 hover:bg-black/10")}
                            onClick={() => handleCompletePhase(myRelevantPhase.id)} 
                            disabled={activeJob.isProblemReported || !isMyWorkActive} // Can only complete if active
                            title="Completa la tua attività per questa fase"
                         >
                            <Check className="h-4 w-4" />
                            <span className="sr-only">Completa</span>
                        </Button>
                    </div>
                    <Separator orientation="vertical" className="h-6 bg-black/20 hidden sm:block" />
                     <Button asChild variant="default" size="sm" className="h-9 bg-black/10 text-inherit hover:bg-black/20 flex-shrink-0">
                        <Link href="/scan-job">
                            <Activity className="mr-2 h-4 w-4" />
                            Dettagli
                        </Link>
                    </Button>
                </div>
            </div>
        </Card>
    </div>
  );
}
