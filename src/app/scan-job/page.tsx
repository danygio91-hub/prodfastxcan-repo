
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
import ProblemReportForm from '@/components/forms/ProblemReportForm';
import { ArrowLeft, ScanLine, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle as PhasePendingIcon, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { getOperatorName } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from "@/components/ui/switch";
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import type { JobOrder, JobPhase, WorkPeriod } from '@/lib/mock-data'; // Import interfaces
import { mockJobOrders } from '@/lib/mock-data'; // Import mock data

type ToastInfo = { variant?: "destructive"; title: string; description: string; action?: React.ReactNode };

function calculateTotalActiveTime(workPeriods: WorkPeriod[]): string {
  let totalMilliseconds = 0;
  workPeriods.forEach(period => {
    if (period.end) {
      totalMilliseconds += period.end.getTime() - period.start.getTime();
    }
  });

  if (totalMilliseconds === 0 && !workPeriods.some(p => p.end === null)) return "0s";
  if (totalMilliseconds === 0 && workPeriods.some(p => p.end === null)) return "Iniziata (0s effettivi)";


  const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((totalMilliseconds / (1000 * 60)) % 60);
  const seconds = Math.floor((totalMilliseconds / 1000) % 60);

  let formattedTime = "";
  if (hours > 0) formattedTime += `${hours}h `;
  if (minutes > 0 || hours > 0) formattedTime += `${minutes}m `;
  formattedTime += `${seconds}s`;
  
  return formattedTime.trim();
}


export default function ScanJobPage() {
  const { toast } = useToast();
  const [isScanningJob, setIsScanningJob] = React.useState(false);
  const [jobScanSuccess, setJobScanSuccess] = React.useState(false);
  const [scannedJobOrder, setScannedJobOrder] = React.useState<JobOrder | null>(null);

  const [isJobAlertOpen, setIsJobAlertOpen] = React.useState(false);
  const [jobAlertInfo, setJobAlertInfo] = React.useState({ title: "", description: "" });

  const [phaseRequiringWorkstationScan, setPhaseRequiringWorkstationScan] = useState<string | null>(null);
  const [isScanningWorkstationForPhase, setIsScanningWorkstationForPhase] = useState(false);
  const [scannedWorkstationIdForPhase, setScannedWorkstationIdForPhase] = useState<string | null>(null);
  const [isPhaseWorkstationAlertOpen, setIsPhaseWorkstationAlertOpen] = useState(false);
  const [phaseWorkstationAlertInfo, setPhaseWorkstationAlertInfo] = useState({ title: "", description: "" });

  const [activeJobOrder, setActiveJobOrder] = useState<JobOrder | null>(null);
  const [isProcessingJob, setIsProcessingJob] = useState(false);
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(null);
  
  const [isProblemReportDialogOpen, setIsProblemReportDialogOpen] = useState(false);


  const resetInitialScanState = () => {
    setIsScanningJob(false);
    setJobScanSuccess(false);
    setScannedJobOrder(null);
    setIsJobAlertOpen(false);

    setPhaseRequiringWorkstationScan(null);
    setIsScanningWorkstationForPhase(false);
    setScannedWorkstationIdForPhase(null);
    setIsPhaseWorkstationAlertOpen(false);
  };

  const resetProcessingState = () => {
    setActiveJobOrder(null);
    setIsProcessingJob(false);
    setCurrentPhaseId(null);
    setPhaseRequiringWorkstationScan(null);
    setIsScanningWorkstationForPhase(false);
    setScannedWorkstationIdForPhase(null);
  }

  const handleSimulateJobScan = () => {
    resetInitialScanState();
    resetProcessingState();
    setIsScanningJob(true);

    const randomJobIndex = Math.floor(Math.random() * mockJobOrders.length);
    // Create a deep copy to avoid modifying the original mockJobOrders array
    const randomJob = JSON.parse(JSON.stringify(mockJobOrders[randomJobIndex])) as JobOrder;
    
    // Ensure phases have workPeriods initialized as empty arrays
     randomJob.phases = randomJob.phases.map(p => ({
      ...p,
      workPeriods: [], // Initialize workPeriods as empty array
      workstationScannedAndVerified: p.workstationScannedAndVerified || false,
    }));


    setTimeout(() => {
      setIsScanningJob(false);
      const operatorName = getOperatorName();
      let operatorDepartment: string;
      if (operatorName === "Daniel") {
        operatorDepartment = "Assemblaggio Componenti Elettronici";
      } else if (operatorName === "Ruben") {
        operatorDepartment = "Controllo Qualità";
      } else {
        operatorDepartment = "Reparto Generico";
      }


      if (randomJob.department !== operatorDepartment) {
        setJobAlertInfo({
          title: "Errore Reparto",
          description: `Commessa non del tuo reparto.`
        });
        setIsJobAlertOpen(true);
      } else {
        setJobScanSuccess(true);
        const jobWithInitializedState = {
          ...randomJob,
          isProblemReported: randomJob.isProblemReported || false,
          phases: randomJob.phases.map(p => ({ 
            ...p, 
            workstationScannedAndVerified: false, // Reset this on new scan
            workPeriods: [], // Ensure workPeriods is an array
           }))
        };
        setScannedJobOrder(jobWithInitializedState);
        toast({
          title: "Scansione Commessa Riuscita!",
          description: `Commessa ${randomJob.id} (${randomJob.department}) scansionata.`,
          action: <CheckCircle className="text-green-500" />,
        });
        setTimeout(() => setJobScanSuccess(false), 3000);
      }
    }, 1500);
  };

  const handleTriggerWorkstationScanForPhase = (phaseId: string) => {
    setPhaseRequiringWorkstationScan(phaseId);
    setScannedWorkstationIdForPhase(null);
    if (activeJobOrder) {
        setActiveJobOrder(prev => {
            if (!prev) return null;
            return {
                ...prev,
                phases: prev.phases.map(p => p.id === phaseId ? { ...p, workstationScannedAndVerified: false } : p)
            }
        })
    }
  };

  const handleSimulateWorkstationScanForPhase = (phaseId: string) => {
    if (!activeJobOrder) return;
    setIsScanningWorkstationForPhase(true);
    const simulatedScannedId = activeJobOrder.postazioneLavoro; 
    setScannedWorkstationIdForPhase(simulatedScannedId);

    setTimeout(() => {
      setIsScanningWorkstationForPhase(false);
      if (simulatedScannedId === activeJobOrder.postazioneLavoro) {
        setActiveJobOrder(prev => {
          if (!prev) return null;
          return {
            ...prev,
            phases: prev.phases.map(p => p.id === phaseId ? { ...p, workstationScannedAndVerified: true } : p)
          };
        });
        toast({
          title: "Scansione Postazione Riuscita!",
          description: `Postazione ${simulatedScannedId} verificata per fase ${activeJobOrder.phases.find(p=>p.id === phaseId)?.name}.`,
          action: <CheckCircle className="text-green-500" />,
        });
        setPhaseRequiringWorkstationScan(null);
      } else {
        setPhaseWorkstationAlertInfo({
          title: "Errore Postazione",
          description: `Postazione ${simulatedScannedId} non corretta per commessa ${activeJobOrder.id} (Attesa: ${activeJobOrder.postazioneLavoro}). Verificare o recarsi presso Ufficio Produzione.`,
        });
        setIsPhaseWorkstationAlertOpen(true);
      }
    }, 1000);
  };


  const handleStartOverallJob = () => {
    if (!scannedJobOrder) return;
     if (scannedJobOrder.isProblemReported) {
      toast({
        variant: "destructive",
        title: "Lavorazione Bloccata",
        description: "Un problema è stato segnalato per questa commessa. Impossibile avviare.",
      });
      return;
    }
    const jobToStart = {
        ...scannedJobOrder,
        overallStartTime: new Date(),
        phases: scannedJobOrder.phases.map(p => ({
            ...p,
            status: 'pending' as 'pending',
            workPeriods: p.workPeriods || [], 
            workstationScannedAndVerified: p.workstationScannedAndVerified || false,
        }))
    };
    setActiveJobOrder(jobToStart);
    setIsProcessingJob(true);
    toast({
      title: "Lavorazione Avviata",
      description: `Lavoro iniziato per commessa ${scannedJobOrder.id}.`,
      action: <PlayCircle className="text-primary" />,
    });
  };

 const handleStartPhase = (phaseId: string) => {
    let toastInfo: ToastInfo | null = null;
    let phaseStartedSuccessfully = false;
    let triggerWorkstationScanForPhaseId: string | null = null;
    let newCurrentPhaseIdState: string | null = null;

    setActiveJobOrder(prev => {
      if (!prev) return prev;
       if (prev.isProblemReported) {
        toastInfo = { variant: "destructive", title: "Lavorazione Bloccata", description: "Un problema è stato segnalato per questa commessa." };
        return prev;
      }
      const phaseToStart = prev.phases.find(p => p.id === phaseId);
      if (!phaseToStart) return prev;

      if (!phaseToStart.workstationScannedAndVerified) {
          toastInfo = { variant: "destructive", title: "Errore", description: "Scansionare e verificare la postazione prima di avviare la fase." };
          triggerWorkstationScanForPhaseId = phaseId;
          return prev;
      }

      const currentPhaseIndex = prev.phases.findIndex(p => p.id === phaseId);
      if (currentPhaseIndex === -1) return prev; 

      if (phaseToStart.sequence !== 1 && !phaseToStart.materialReady) {
        toastInfo = { variant: "destructive", title: "Errore Materiale", description: `Materiale non pronto per la fase "${phaseToStart.name}".` };
        return prev;
      }


      if (prev.phases.some(p => p.id !== phaseId && (p.status === 'in-progress' || p.status === 'paused'))) {
        toastInfo = { variant: "destructive", title: "Errore", description: "Un'altra fase è già attiva o in pausa. Completare o riprendere la fase corrente prima di avviarne una nuova." };
        return prev;
      }
      if (currentPhaseIndex > 0 && prev.phases[currentPhaseIndex - 1].status !== 'completed') {
        toastInfo = { variant: "destructive", title: "Errore", description: "Completare la fase precedente prima di avviare questa." };
        return prev;
      }

      const updatedPhases = prev.phases.map(phase =>
        phase.id === phaseId 
        ? { 
            ...phase, 
            status: 'in-progress' as 'in-progress', 
            workPeriods: [...(phase.workPeriods || []), { start: new Date(), end: null }] 
          } 
        : phase
      );
      const startedPhaseName = updatedPhases.find(p=>p.id === phaseId)?.name || "sconosciuta";
      toastInfo = { title: "Fase Avviata", description: `Fase "${startedPhaseName}" avviata.` };
      phaseStartedSuccessfully = true;
      newCurrentPhaseIdState = phaseId;
      return { ...prev, phases: updatedPhases };
    });

    if (toastInfo) {
      toast(toastInfo);
    }
    if (phaseStartedSuccessfully && newCurrentPhaseIdState) {
      setCurrentPhaseId(newCurrentPhaseIdState);
    }
    if (triggerWorkstationScanForPhaseId) {
      setPhaseRequiringWorkstationScan(triggerWorkstationScanForPhaseId);
    }
  };


  const handlePausePhase = (phaseId: string) => {
    let toastInfo: ToastInfo | null = null;

    setActiveJobOrder(prev => {
      if (!prev) return prev;
      if (prev.isProblemReported) {
        toastInfo = { variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile mettere in pausa, problema segnalato." };
        return prev;
      }
      const phaseToPause = prev.phases.find(p => p.id === phaseId);
      if (!phaseToPause || phaseToPause.status !== 'in-progress') {
        toastInfo = { variant: "destructive", title: "Errore", description: "La fase non è in lavorazione." };
        return prev;
      }
      const updatedPhases = prev.phases.map(p => {
        if (p.id === phaseId) {
          const currentWorkPeriods = p.workPeriods || [];
          const updatedWorkPeriods = currentWorkPeriods.map((wp, index) => 
            index === currentWorkPeriods.length - 1 && wp.end === null ? { ...wp, end: new Date() } : wp
          );
          return { ...p, status: 'paused' as 'paused', workPeriods: updatedWorkPeriods };
        }
        return p;
      });
      toastInfo = { title: "Fase Messa in Pausa", description: `Fase "${phaseToPause.name}" in pausa.` };
      return { ...prev, phases: updatedPhases };
    });

    if (toastInfo) {
      toast(toastInfo);
    }
  };

  const handleResumePhase = (phaseId: string) => {
    let toastInfo: ToastInfo | null = null;

    setActiveJobOrder(prev => {
      if (!prev) return prev;
      if (prev.isProblemReported) {
        toastInfo = { variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile riprendere, problema segnalato." };
        return prev;
      }
      const phaseToResume = prev.phases.find(p => p.id === phaseId);
      if (!phaseToResume || phaseToResume.status !== 'paused') {
        toastInfo = { variant: "destructive", title: "Errore", description: "La fase non è in pausa." };
        return prev;
      }
      if (prev.phases.some(p => p.id !== phaseId && p.status === 'in-progress')) {
         toastInfo = { variant: "destructive", title: "Errore", description: "Un'altra fase è già in lavorazione." };
        return prev;
      }

      const updatedPhases = prev.phases.map(phase =>
        phase.id === phaseId 
        ? { 
            ...phase, 
            status: 'in-progress' as 'in-progress',
            workPeriods: [...(phase.workPeriods || []), { start: new Date(), end: null }] 
          } 
        : phase
      );
      const resumedPhaseName = updatedPhases.find(p=>p.id === phaseId)?.name || "sconosciuta";
      toastInfo = { title: "Fase Ripresa", description: `Fase "${resumedPhaseName}" ripresa.` };
      return { ...prev, phases: updatedPhases };
    });
    if (toastInfo) {
      toast(toastInfo);
    }
  };

  const handleCompletePhase = (phaseId: string) => {
    let toastInfo: ToastInfo | null = null;
    let phaseCompletedSuccessfully = false;
    let nextPhaseMaterialToastInfo: ToastInfo | null = null;
    let newCurrentPhaseIdState: string | null = null;


    setActiveJobOrder(prev => {
      if (!prev) return null;
      const phaseToComplete = prev.phases.find(p => p.id === phaseId);
      if (!phaseToComplete || (phaseToComplete.status !== 'in-progress' && phaseToComplete.status !== 'paused')) {
        toastInfo = { variant: "destructive", title: "Errore", description: "La fase non è né in lavorazione né in pausa." };
        return prev;
      }
      
      // Allow completing phase even if job has a problem, to save progress made before problem.
      // if (prev.isProblemReported && phaseToComplete.status !== 'completed') {
      //   toastInfo = { variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile completare la fase, problema segnalato per la commessa." };
      //   return prev;
      // }

      let updatedPhases = prev.phases.map(p => {
        if (p.id === phaseId) {
          let currentWorkPeriods = p.workPeriods || [];
          let updatedWorkPeriods = currentWorkPeriods;
          if (p.status === 'in-progress') { 
            updatedWorkPeriods = currentWorkPeriods.map((wp, index) =>
              index === currentWorkPeriods.length - 1 && wp.end === null ? { ...wp, end: new Date() } : wp
            );
          }
          return { ...p, status: 'completed' as 'completed', workPeriods: updatedWorkPeriods };
        }
        return p;
      });

      const completedPhaseSequence = phaseToComplete.sequence;
      const nextPhase = updatedPhases.find(p => p.sequence === completedPhaseSequence + 1);

      if (nextPhase && nextPhase.status === 'pending') { 
        updatedPhases = updatedPhases.map(p => 
          p.id === nextPhase.id ? { ...p, materialReady: true } : p
        );
        nextPhaseMaterialToastInfo = { title: "Materiale Pronto", description: `Materiale per la fase "${nextPhase.name}" ora disponibile.`};
      }
      
      toastInfo = { title: "Fase Completata", description: `Fase "${phaseToComplete.name}" completata.`, action: <PhaseCompletedIcon className="text-green-500"/> };
      phaseCompletedSuccessfully = true;
      newCurrentPhaseIdState = null; 
      return { ...prev, phases: updatedPhases };
    });

    if (toastInfo) {
      toast(toastInfo);
    }
    if (nextPhaseMaterialToastInfo) {
      toast(nextPhaseMaterialToastInfo);
    }
    if (phaseCompletedSuccessfully) {
      setCurrentPhaseId(newCurrentPhaseIdState);
    }
  };

  const handleConcludeOverallJob = () => {
    if (!activeJobOrder) return;
    if (activeJobOrder.isProblemReported) {
      toast({
        variant: "destructive",
        title: "Lavorazione Bloccata",
        description: "Impossibile concludere la commessa, problema segnalato.",
      });
      return;
    }
    setActiveJobOrder(prev => prev ? ({ ...prev, overallEndTime: new Date() }) : null);
    toast({
      title: "Commessa Conclusa",
      description: `Lavorazione per commessa ${activeJobOrder.id} terminata con successo.`,
      action: <PowerOff className="text-primary" />
    });
    resetInitialScanState();
    resetProcessingState();
  };

  const allPhasesCompleted = activeJobOrder?.phases.every(phase => phase.status === 'completed');

  const handleJobProblemReported = () => {
    const targetJobId = activeJobOrder?.id || scannedJobOrder?.id;
    if (targetJobId) {
        if (activeJobOrder && activeJobOrder.id === targetJobId) {
            setActiveJobOrder(prev => prev ? { ...prev, isProblemReported: true } : null);
        } else if (scannedJobOrder && scannedJobOrder.id === targetJobId) {
            setScannedJobOrder(prev => prev ? { ...prev, isProblemReported: true } : null);
        }
      toast({
        variant: "destructive",
        title: "Problema Segnalato per Commessa",
        description: `La commessa ${targetJobId} è stata bloccata. Risolvere il problema prima di continuare.`,
      });
    }
    setIsProblemReportDialogOpen(false);
  };


  const renderJobScanArea = () => (
    <Card>
      <CardHeader>
          <div className="flex items-center space-x-3">
          <ScanLine className="h-8 w-8 text-primary" />
          <div>
            <CardTitle className="text-2xl font-headline">Scansiona Commessa (Ordine PF)</CardTitle>
            <CardDescription>Scansiona il codice a barre sulla commessa.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center space-y-6">
        <div
          className={`w-full max-w-xs h-48 border-2 rounded-lg flex items-center justify-center transition-all duration-300
          ${isScanningJob ? 'border-primary animate-pulse' : 'border-border'}
          ${jobScanSuccess && !isJobAlertOpen ? 'border-green-500 bg-green-500/10' : ''}
          ${isJobAlertOpen ? 'border-destructive bg-destructive/10' : ''}
          `}
        >
          {isScanningJob && <p className="text-primary font-semibold">Scansione Commessa in corso...</p>}
          {!isScanningJob && !scannedJobOrder && !isJobAlertOpen && <p className="text-muted-foreground">Allinea codice a barre commessa</p>}
          {jobScanSuccess && !isScanningJob && !isJobAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}
          {isJobAlertOpen && !isScanningJob && <AlertTriangle className="h-16 w-16 text-destructive" />}
          {!isScanningJob && scannedJobOrder && !isJobAlertOpen && !isProcessingJob && <CheckCircle className="h-16 w-16 text-green-500" />}
        </div>

        <Button
          onClick={handleSimulateJobScan}
          disabled={isScanningJob}
          className="w-full max-w-xs bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <ScanLine className="mr-2 h-5 w-5" />
          {isScanningJob ? "Scansione..." : "Simula Scansione Codice Commessa"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Questo simula la scansione del codice a barre per la commessa.
        </p>
      </CardContent>
    </Card>
  );

  const renderJobDetailsCard = (job: JobOrder) => {
    const isDisplayingScannedJobDetails = !isProcessingJob && job.id === scannedJobOrder?.id && scannedJobOrder !== null;
    const isDisplayingActiveJobDetails = isProcessingJob && job.id === activeJobOrder?.id && activeJobOrder !== null && !activeJobOrder.overallEndTime;
    const shouldDisplayAdvancement = isDisplayingScannedJobDetails || isDisplayingActiveJobDetails || (scannedJobOrder !== null && job.id === scannedJobOrder.id && !isProcessingJob);


    let nextPhaseForDisplay: JobPhase | undefined = undefined;
    let postazioneLavoroPerFase: string | undefined = undefined;
    let allPhasesInCurrentJobCompleted = false;

    if (shouldDisplayAdvancement) {
        nextPhaseForDisplay = job.phases
            .filter(p => p.status === 'pending' || p.status === 'in-progress' || p.status === 'paused')
            .sort((a, b) => a.sequence - b.sequence)[0];

        if (nextPhaseForDisplay) {
             postazioneLavoroPerFase = job.postazioneLavoro;
        }
        allPhasesInCurrentJobCompleted = job.phases.every(p => p.status === 'completed');
    }

    return (
      <Card className="mt-6 shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center">
              <Package className="mr-3 h-7 w-7 text-primary shrink-0" />
              <div>
                <CardTitle className="font-headline">
                  Dettagli Commessa: {job.id}
                </CardTitle>
                <CardDescription>Reparto: {job.department}</CardDescription>
              </div>
            </div>
            {(isDisplayingActiveJobDetails || isDisplayingScannedJobDetails) && (
                 <AlertDialogTrigger asChild>
                    <Button 
                        variant={job.isProblemReported ? "destructive" : "outline"} 
                        size="icon"
                        onClick={() => setIsProblemReportDialogOpen(true)}
                        title={job.isProblemReported ? "Problema Segnalato! Visualizza/Modifica" : "Segnala Problema"}
                        className={`ml-auto shrink-0 ${job.isProblemReported ? "hover:bg-destructive/90" : "text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500"}`}
                    >
                        {job.isProblemReported ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                        <span className="sr-only">{job.isProblemReported ? "Problema già segnalato" : "Segnala un problema"}</span>
                    </Button>
                 </AlertDialogTrigger>
            )}
          </div>
           {job.isProblemReported && (
            <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
              <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato! Lavorazione bloccata.
            </p>
           )}
          {job.overallStartTime && (
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Iniziata il: {format(job.overallStartTime, "dd/MM/yyyy HH:mm:ss")}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ordinePF" className="flex items-center text-sm text-muted-foreground"><ClipboardList className="mr-2 h-4 w-4 text-primary" />Ordine PF</Label>
              <Input id="ordinePF" value={job.ordinePF} readOnly className="bg-input text-foreground mt-1" />
            </div>
            <div>
              <Label htmlFor="numeroODL" className="flex items-center text-sm text-muted-foreground"><ClipboardList className="mr-2 h-4 w-4 text-primary" />N° ODL</Label>
              <Input id="numeroODL" value={job.numeroODL} readOnly className="bg-input text-foreground mt-1" />
            </div>
            <div>
              <Label htmlFor="dataConsegnaFinale" className="flex items-center text-sm text-muted-foreground"><CalendarDays className="mr-2 h-4 w-4 text-primary" />Data Consegna Finale</Label>
              <Input id="dataConsegnaFinale" value={job.dataConsegnaFinale} readOnly className="bg-input text-foreground mt-1" />
            </div>
            <div>
              <Label htmlFor="postazioneLavoroJob" className="flex items-center text-sm text-muted-foreground"><Computer className="mr-2 h-4 w-4 text-primary" />Postazione di Lavoro Prevista (Generale)</Label>
              <Input id="postazioneLavoroJob" value={job.postazioneLavoro} readOnly className="bg-input text-foreground mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="codiceArticolo" className="flex items-center text-sm text-muted-foreground"><Package className="mr-2 h-4 w-4 text-primary" />Codice Articolo</Label>
            <p className="mt-1 p-2 bg-input rounded-md text-foreground">{job.details}</p>
          </div>

          {shouldDisplayAdvancement && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <h3 className="text-md font-semibold font-headline flex items-center">
                  <Activity className="mr-2 h-5 w-5 text-primary" />
                  Stato Avanzamento Corrente
                </h3>
                {nextPhaseForDisplay && postazioneLavoroPerFase ? (
                  <>
                    <p className="text-sm">
                      <span className="font-medium text-muted-foreground">
                        {isProcessingJob && job.id === activeJobOrder?.id && (nextPhaseForDisplay.status === 'in-progress' || nextPhaseForDisplay.status === 'paused')
                          ? "Fase Corrente:"
                          : "Prossima Fase:"}
                      </span> {nextPhaseForDisplay.name} (Seq: {nextPhaseForDisplay.sequence})
                       {!isProcessingJob && scannedJobOrder && job.id === scannedJobOrder.id && !activeJobOrder && (
                          (scannedJobOrder.phases.find(p=>p.id===nextPhaseForDisplay.id)?.workstationScannedAndVerified === false && !phaseRequiringWorkstationScan) 
                            ? " (in attesa scansione postazione per avvio fase)" 
                            : phaseRequiringWorkstationScan === nextPhaseForDisplay.id ? " (in attesa scansione postazione)" : " (in attesa di avvio lavorazione commessa)"
                       )}
                    </p>
                     <p className="text-sm">
                      <span className="font-medium text-muted-foreground">Postazione Lavorazione Prevista per la Commessa:</span> {postazioneLavoroPerFase}
                    </p>
                  </>
                ) : allPhasesInCurrentJobCompleted ? (
                   <p className="text-sm text-green-500 font-medium">Tutte le fasi completate. Pronta per la conclusione.</p>
                ) : job.isProblemReported ? (
                    <p className="text-sm text-destructive font-medium">Lavorazione bloccata.</p>
                ) : (
                   <p className="text-sm text-muted-foreground">Nessuna fase al momento o stato non determinabile.</p>
                 )}
              </div>
            </>
          )}
        </CardContent>
         {!isProcessingJob && scannedJobOrder && (
            <CardFooter>
                <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={handleStartOverallJob}
                    disabled={scannedJobOrder.isProblemReported}
                >
                    <PlayCircle className="mr-2 h-5 w-5" /> Inizia Lavorazione Commessa
                </Button>
            </CardFooter>
        )}
      </Card>
    );
  }


  const renderPhasesManagement = () => {
    if (!activeJobOrder) return null;
    const isJobBlockedByProblem = !!activeJobOrder.isProblemReported;

    return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline flex items-center">
          <ListChecks className="mr-3 h-7 w-7 text-primary" />
          Fasi di Lavorazione Commessa: {activeJobOrder?.id}
        </CardTitle>
        <CardDescription>Gestisci l'avanzamento delle fasi. Postazione per questa commessa: <strong>{activeJobOrder?.postazioneLavoro}</strong></CardDescription>
        {isJobBlockedByProblem && (
           <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
              <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato! Le operazioni sulle fasi sono bloccate.
            </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {activeJobOrder?.phases.sort((a,b) => a.sequence - b.sequence).map((phase, index) => {
          const isPreviousPhaseCompleted = index === 0 || activeJobOrder.phases.find(p => p.sequence === phase.sequence -1)?.status === 'completed';
          const noOtherPhaseActiveOrPaused = !activeJobOrder.phases.some(p => p.id !== phase.id && (p.status === 'in-progress' || p.status === 'paused'));

          const materialCheckPassed = phase.materialReady; 

          const canTriggerWorkstationScan = !isJobBlockedByProblem && materialCheckPassed && phase.status === 'pending' && isPreviousPhaseCompleted && noOtherPhaseActiveOrPaused && !phase.workstationScannedAndVerified;
          const canStartPhase = !isJobBlockedByProblem && materialCheckPassed && phase.status === 'pending' && isPreviousPhaseCompleted && noOtherPhaseActiveOrPaused && !!phase.workstationScannedAndVerified;
          const canPausePhase = !isJobBlockedByProblem && phase.status === 'in-progress';
          const canResumePhase = !isJobBlockedByProblem && phase.status === 'paused' && noOtherPhaseActiveOrPaused;
          const canCompletePhase = phase.status === 'in-progress' || phase.status === 'paused'; // Allow completing even if job problem

          let phaseIcon = <PhasePendingIcon className="mr-2 h-5 w-5 text-muted-foreground" />;
          if (phase.status === 'in-progress') phaseIcon = <Hourglass className="mr-2 h-5 w-5 text-yellow-500 animate-spin" />;
          if (phase.status === 'paused') phaseIcon = <PausePhaseIcon className="mr-2 h-5 w-5 text-orange-500" />;
          if (phase.status === 'completed') phaseIcon = <PhaseCompletedIcon className="mr-2 h-5 w-5 text-green-500" />;
          
          const workPeriodsForPhase = phase.workPeriods || [];
          const lastWorkPeriod = workPeriodsForPhase.length > 0 ? workPeriodsForPhase[workPeriodsForPhase.length - 1] : null;

          return (
            <Card key={phase.id} className={`p-4 bg-card/50 ${isJobBlockedByProblem && phase.status !== 'completed' ? 'opacity-70' : ''}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center">
                  {phaseIcon}
                  <span className="font-semibold">{phase.name} (Seq: {phase.sequence})</span>
                </div>
                <div className="flex items-center space-x-2">
                   <Label htmlFor={`material-${phase.id}`} className="text-sm">Mat. Pronto:</Label>
                   <Switch
                    id={`material-${phase.id}`}
                    checked={phase.materialReady}
                    disabled={true} 
                  />
                  {phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}
                </div>
              </div>
               <p className="text-xs text-muted-foreground mt-1">Postazione Prevista: {activeJobOrder?.postazioneLavoro}</p>

              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {lastWorkPeriod?.start && (
                  <p>Ultimo avvio: {format(new Date(lastWorkPeriod.start), "dd/MM/yyyy HH:mm:ss")}</p>
                )}
                {phase.status === 'paused' && lastWorkPeriod?.end && (
                  <p>Messa in pausa il: {format(new Date(lastWorkPeriod.end), "dd/MM/yyyy HH:mm:ss")}</p>
                )}
                 <p>Tempo di lavorazione effettivo: {calculateTotalActiveTime(workPeriodsForPhase)}</p>
              </div>


              {phaseRequiringWorkstationScan === phase.id && !phase.workstationScannedAndVerified && !isJobBlockedByProblem && (
                <div className="mt-3 p-3 border border-dashed border-primary rounded-md space-y-3">
                    <Label className="font-semibold text-primary">Verifica Postazione per Fase: {phase.name}</Label>
                    <p className="text-sm text-muted-foreground">Scansiona il barcode della postazione: <strong>{activeJobOrder?.postazioneLavoro}</strong></p>
                     <div
                        className={`w-full h-24 border-2 rounded-lg flex items-center justify-center transition-all duration-300
                        ${isScanningWorkstationForPhase ? 'border-primary animate-pulse' : 'border-border'}
                        ${scannedWorkstationIdForPhase && !isScanningWorkstationForPhase && !phase.workstationScannedAndVerified ? 'border-destructive bg-destructive/10' : ''}
                        ${phase.workstationScannedAndVerified && !isScanningWorkstationForPhase ? 'border-green-500 bg-green-500/10' : ''}
                        `} >
                        {isScanningWorkstationForPhase && <p className="text-primary font-semibold">Scansione Postazione...</p>}
                        {!isScanningWorkstationForPhase && !phase.workstationScannedAndVerified && <p className="text-muted-foreground">Allinea codice a barre postazione</p>}
                        {!isScanningWorkstationForPhase && phase.workstationScannedAndVerified && <CheckCircle className="h-10 w-10 text-green-500" />}
                         {scannedWorkstationIdForPhase && !isScanningWorkstationForPhase && !phase.workstationScannedAndVerified && <AlertTriangle className="h-10 w-10 text-destructive" />}
                    </div>
                    <Button
                        onClick={() => handleSimulateWorkstationScanForPhase(phase.id)}
                        disabled={isScanningWorkstationForPhase || isJobBlockedByProblem}
                        className="w-full"
                        variant="outline" >
                        <ScanLine className="mr-2 h-5 w-5" />
                        {isScanningWorkstationForPhase ? "Scansione..." : "Simula Scansione Postazione per Fase"}
                    </Button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {canTriggerWorkstationScan && phase.status === 'pending' && (
                     <Button size="sm" onClick={() => handleTriggerWorkstationScanForPhase(phase.id)} variant="outline" className="border-primary text-primary hover:bg-primary/10" disabled={isJobBlockedByProblem}>
                        <ScanLine className="mr-2 h-4 w-4" /> Scansiona Postazione per Fase
                    </Button>
                )}
                {canStartPhase && (
                  <Button size="sm" onClick={() => handleStartPhase(phase.id)} variant="default" disabled={isJobBlockedByProblem}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Avvia Fase
                  </Button>
                )}
                {canPausePhase && (
                  <Button size="sm" onClick={() => handlePausePhase(phase.id)} variant="outline" className="text-orange-500 border-orange-500 hover:bg-orange-500/10 hover:text-orange-500" disabled={isJobBlockedByProblem}>
                    <PausePhaseIcon className="mr-2 h-4 w-4" /> Metti in Pausa
                  </Button>
                )}
                 {canResumePhase && (
                  <Button size="sm" onClick={() => handleResumePhase(phase.id)} variant="outline" className="text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500" disabled={isJobBlockedByProblem}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Riprendi Fase
                  </Button>
                )}
                {canCompletePhase && (
                  <Button size="sm" onClick={() => handleCompletePhase(phase.id)} className="bg-green-600 hover:bg-green-700 text-primary-foreground" disabled={isJobBlockedByProblem && phase.status !== 'completed'}>
                    <PhaseCompletedIcon className="mr-2 h-4 w-4" /> Completa Fase
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
        {allPhasesCompleted && !activeJobOrder?.overallEndTime && (
          <Button 
            onClick={handleConcludeOverallJob} 
            className="w-full mt-4 bg-primary text-primary-foreground"
            disabled={isJobBlockedByProblem}
          >
            <PowerOff className="mr-2 h-5 w-5" /> Concludi Commessa
          </Button>
        )}
         {activeJobOrder?.overallEndTime && (
          <p className="mt-4 text-center text-green-500 font-semibold">Commessa conclusa il: {format(new Date(activeJobOrder.overallEndTime), "dd/MM/yyyy HH:mm:ss")}</p>
        )}
      </CardContent>
    </Card>
  )};


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Torna alla Dashboard
            </Button>
          </Link>
        <AlertDialog open={isProblemReportDialogOpen} onOpenChange={setIsProblemReportDialogOpen}>

          {!isProcessingJob && !activeJobOrder?.overallEndTime && !scannedJobOrder && renderJobScanArea()}

          {scannedJobOrder && !isProcessingJob && !activeJobOrder?.overallEndTime && (
             renderJobDetailsCard(scannedJobOrder)
          )}

          {isProcessingJob && activeJobOrder && !activeJobOrder.overallEndTime && (
            <>
              {renderJobDetailsCard(activeJobOrder)}
              {renderPhasesManagement()}
            </>
          )}

          {activeJobOrder?.overallEndTime && (
             <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Nuova Scansione</CardTitle>
                    <CardDescription>La commessa precedente è stata conclusa. Puoi scansionare una nuova commessa.</CardDescription>
                </CardHeader>
                <CardContent>
                    {renderJobScanArea()}
                </CardContent>
             </Card>
          )}

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Segnala Problema per Commessa: {activeJobOrder?.id || scannedJobOrder?.id}</AlertDialogTitle>
              <AlertDialogDescription>
                Descrivi il problema riscontrato per questa commessa. La segnalazione bloccherà temporaneamente la lavorazione.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ProblemReportForm onSuccess={handleJobProblemReported} showTitle={false} initialSeverity="medium" />
            {/* Footer removed as submit is in ProblemReportForm now, cancel is implicit with dialog close */}
          </AlertDialogContent>
        </AlertDialog>


          <AlertDialog open={isJobAlertOpen} onOpenChange={setIsJobAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {jobAlertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {jobAlertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => { setIsJobAlertOpen(false); setScannedJobOrder(null); } }>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={isPhaseWorkstationAlertOpen} onOpenChange={setIsPhaseWorkstationAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {phaseWorkstationAlertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {phaseWorkstationAlertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => {
                  setIsPhaseWorkstationAlertOpen(false);
                }}>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}
