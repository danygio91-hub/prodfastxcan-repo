
"use client";

import React from 'react';
import Link from 'next/link';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { updateJob } from '@/app/scan-job/actions';
import { Play, Pause, Check, Activity } from 'lucide-react';
import type { JobOrder, JobPhase } from '@/lib/mock-data';

export default function ActiveJobStatusBar() {
  const { activeJob, setActiveJob, isLoading } = useActiveJob();
  const { operator } = useAuth();
  const { toast } = useToast();

  const handleUpdateJob = async (updatedJob: JobOrder) => {
    setActiveJob(updatedJob);
    const result = await updateJob(updatedJob);
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Errore di Sincronizzazione",
        description: result.message,
      });
      // Potentially revert state if sync fails
    }
  };

  const handlePauseResume = () => {
    if (!activeJob || !operator) return;
    
    const currentPhase = activeJob.phases.find(p => p.status === 'in-progress' || p.status === 'paused');
    if (!currentPhase) {
        toast({ variant: 'destructive', title: 'Nessuna Fase Attiva', description: 'Non c\'è nessuna fase da mettere in pausa o riprendere.' });
        return;
    }
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === currentPhase.id);
    if (!phaseToUpdate) return;
    
    if (phaseToUpdate.status === 'in-progress') {
      const lastWorkPeriod = phaseToUpdate.workPeriods[phaseToUpdate.workPeriods.length - 1];
      if (lastWorkPeriod && !lastWorkPeriod.end) {
        lastWorkPeriod.end = new Date();
      }
      phaseToUpdate.status = 'paused';
      toast({ title: "Fase in Pausa", description: `La fase "${phaseToUpdate.name}" è stata messa in pausa.` });
    } else if (phaseToUpdate.status === 'paused') {
      phaseToUpdate.status = 'in-progress';
      phaseToUpdate.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
      toast({ title: "Fase Ripresa", description: `La fase "${phaseToUpdate.name}" è ripresa.` });
    }
    
    handleUpdateJob(jobToUpdate);
  };

  const handleCompletePhase = () => {
    if (!activeJob || !operator) return;

    const currentPhase = activeJob.phases.find(p => p.status === 'in-progress' || p.status === 'paused');
    if (!currentPhase) {
        toast({ variant: 'destructive', title: 'Nessuna Fase Attiva', description: 'Non c\'è nessuna fase da completare.' });
        return;
    }

    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === currentPhase.id);
    if (!phaseToUpdate) return;

    if (phaseToUpdate.status === 'in-progress') {
      const lastWorkPeriod = phaseToUpdate.workPeriods[phaseToUpdate.workPeriods.length - 1];
      if (lastWorkPeriod && !lastWorkPeriod.end) {
        lastWorkPeriod.end = new Date();
      }
    }
    phaseToUpdate.status = 'completed';
    
    const completedPhaseType = phaseToUpdate.type || 'production';
    if (completedPhaseType === 'preparation') {
      const allPrepPhases = jobToUpdate.phases.filter((p: JobPhase) => (p.type || 'production') === 'preparation');
      if (allPrepPhases.every((p: JobPhase) => p.status === 'completed')) {
        const firstProductionPhase = jobToUpdate.phases.find((p: JobPhase) => p.sequence === 1);
        if (firstProductionPhase) firstProductionPhase.materialReady = true;
      }
    } else {
        const nextPhase = jobToUpdate.phases.find((p: JobPhase) => p.sequence === phaseToUpdate.sequence + 1);
        if (nextPhase && nextPhase.status === 'pending') {
            nextPhase.materialReady = true;
        }
    }

    toast({ title: "Fase Completata", description: `Fase "${phaseToUpdate.name}" completata.` });
    
    // Check if all phases are now completed to conclude the job
    const allPhasesCompleted = jobToUpdate.phases.every((p: JobPhase) => p.status === 'completed');
    if (allPhasesCompleted) {
        jobToUpdate.status = 'completed';
        jobToUpdate.overallEndTime = new Date();
        toast({ title: "Commessa Completata!", description: `Tutte le fasi per ${jobToUpdate.id} sono terminate.` });
        // The job will be cleared from the status bar on the next render because its status is 'completed'
    }
    
    handleUpdateJob(jobToUpdate);
  };

  if (isLoading || !activeJob || activeJob.status === 'completed' || activeJob.status === 'planned') {
    return null;
  }

  const currentPhase = activeJob.phases.find(p => p.status === 'in-progress' || p.status === 'paused');

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-2 sm:p-4 pointer-events-none">
        <Card className="p-3 shadow-2xl w-full max-w-lg mx-auto pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-5 duration-300">
            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">Commessa: {activeJob.ordinePF}</p>
                    <p className="text-xs text-muted-foreground truncate">
                        {currentPhase ? `Fase Attiva: ${currentPhase.name}` : 'Nessuna fase attiva. Selezionane una.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {currentPhase && (
                        <>
                            <Button variant="outline" size="icon" className="h-9 w-9" onClick={handlePauseResume} disabled={activeJob.isProblemReported}>
                                {currentPhase.status === 'in-progress' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                <span className="sr-only">{currentPhase.status === 'in-progress' ? 'Pausa' : 'Riprendi'}</span>
                            </Button>
                            <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleCompletePhase} disabled={activeJob.isProblemReported}>
                                <Check className="h-4 w-4" />
                                <span className="sr-only">Completa</span>
                            </Button>
                            <Separator orientation="vertical" className="h-6" />
                        </>
                    )}
                     <Button asChild variant="default" size="sm" className="h-9">
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
