
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ScanLine, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle as PhasePendingIcon, Hourglass, PowerOff, PackageCheck, PackageX, Activity } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { getOperatorName } from '@/lib/auth';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from "@/components/ui/switch";
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';

interface JobPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'paused' | 'completed';
  materialReady: boolean;
  startTime: Date | null;
  endTime: Date | null;
  sequence: number;
}

interface JobOrder {
  id: string; 
  department: string;
  details: string; 
  ordinePF: string; 
  numeroODL: string; 
  dataConsegnaFinale: string; 
  postazioneLavoro: string; 
  phases: JobPhase[];
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
}

const mockJobOrders: JobOrder[] = [
  { 
    id: "COM-12345", 
    department: "Assemblaggio Componenti Elettronici", 
    details: "Assemblaggio scheda madre per Prodotto X.",
    ordinePF: "PF-001",
    numeroODL: "ODL-789",
    dataConsegnaFinale: "2024-12-15",
    postazioneLavoro: "Postazione A-05",
    phases: [
      { id: "phase1-1", name: "Preparazione Componenti", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 1 },
      { id: "phase1-2", name: "Montaggio su PCB", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 2 },
      { id: "phase1-3", name: "Saldatura", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 3 },
      { id: "phase1-4", name: "Controllo Visivo Iniziale", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 4 },
    ]
  },
  { 
    id: "COM-67890", 
    department: "Controllo Qualità", 
    details: "Verifica finale Prodotto Y.",
    ordinePF: "PF-002",
    numeroODL: "ODL-790",
    dataConsegnaFinale: "2024-11-30",
    postazioneLavoro: "Banco CQ-02",
    phases: [
      { id: "phase2-1", name: "Test Funzionale A", status: 'pending', materialReady: true, startTime: null, endTime: null, sequence: 1 },
      { id: "phase2-2", name: "Ispezione Estetica", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 2 },
      { id: "phase2-3", name: "Imballaggio Primario", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 3 },
    ]
  },
  {
    id: "COM-54321",
    department: "Assemblaggio Componenti Elettronici",
    details: "Cablaggio unità di alimentazione per Prodotto Z.",
    ordinePF: "PF-003",
    numeroODL: "ODL-791",
    dataConsegnaFinale: "2025-01-10",
    postazioneLavoro: "Postazione B-01",
    phases: [
      { id: "phase3-1", name: "Taglio Cavi", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 1 },
      { id: "phase3-2", name: "Crimpatura Connettori", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 2 },
      { id: "phase3-3", name: "Assemblaggio Cablaggio", status: 'pending', materialReady: false, startTime: null, endTime: null, sequence: 3 },
    ]
  }
];

export default function ScanJobPage() {
  const { toast } = useToast();
  const [isScanningJob, setIsScanningJob] = React.useState(false);
  const [jobScanSuccess, setJobScanSuccess] = React.useState(false);
  const [scannedJobOrder, setScannedJobOrder] = React.useState<JobOrder | null>(null);
  
  const [isJobAlertOpen, setIsJobAlertOpen] = React.useState(false);
  const [jobAlertInfo, setJobAlertInfo] = React.useState({ title: "", description: "" });

  const [isWorkstationScanRequired, setIsWorkstationScanRequired] = React.useState(false);
  const [isScanningWorkstation, setIsScanningWorkstation] = React.useState(false);
  const [scannedWorkstationId, setScannedWorkstationId] = React.useState<string | null>(null);
  const [workstationScanMatch, setWorkstationScanMatch] = React.useState<boolean | null>(null);
  const [isWorkstationAlertOpen, setIsWorkstationAlertOpen] = React.useState(false);
  const [workstationAlertInfo, setWorkstationAlertInfo] = React.useState({ title: "", description: "" });

  const [activeJobOrder, setActiveJobOrder] = useState<JobOrder | null>(null);
  const [isProcessingJob, setIsProcessingJob] = useState(false);
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(null); 

  const resetInitialScanState = () => {
    setIsScanningJob(false);
    setJobScanSuccess(false);
    setScannedJobOrder(null);
    setIsJobAlertOpen(false);
    setIsWorkstationScanRequired(false);
    setIsScanningWorkstation(false);
    setScannedWorkstationId(null);
    setWorkstationScanMatch(null);
    setIsWorkstationAlertOpen(false);
  };

  const resetProcessingState = () => {
    setActiveJobOrder(null);
    setIsProcessingJob(false);
    setCurrentPhaseId(null);
  }

  const handleSimulateJobScan = () => {
    resetInitialScanState();
    resetProcessingState(); 
    setIsScanningJob(true);

    const randomJob = mockJobOrders[Math.floor(Math.random() * mockJobOrders.length)];

    setTimeout(() => {
      setIsScanningJob(false);
      const operatorName = getOperatorName();
      let operatorDepartment = operatorName === "Daniel" ? "Assemblaggio Componenti Elettronici" : "Reparto Generico";

      if (randomJob.department !== operatorDepartment) {
        setJobAlertInfo({ 
          title: "Errore Reparto", 
          description: `Commessa ${randomJob.id} (${randomJob.department}) non appartenente al tuo reparto (${operatorDepartment}). Recarsi presso Ufficio Produzione.` 
        });
        setIsJobAlertOpen(true);
      } else {
        setJobScanSuccess(true);
        setScannedJobOrder(randomJob); 
        setIsWorkstationScanRequired(true);
        toast({
          title: "Scansione Commessa Riuscita!",
          description: `Commessa ${randomJob.id} (${randomJob.department}) scansionata. Procedere con scansione postazione.`,
          action: <CheckCircle className="text-green-500" />,
        });
        setTimeout(() => setJobScanSuccess(false), 3000); 
      }
    }, 1500);
  };

  const handleSimulateWorkstationScan = () => {
    if (!scannedJobOrder) return;
    setIsScanningWorkstation(true);
    setWorkstationScanMatch(null); 
    setScannedWorkstationId(null);
    setIsWorkstationAlertOpen(false);

    const simulatedScannedId = scannedJobOrder.postazioneLavoro; 

    setTimeout(() => {
      setIsScanningWorkstation(false);
      setScannedWorkstationId(simulatedScannedId);

      if (simulatedScannedId === scannedJobOrder.postazioneLavoro) {
        setWorkstationScanMatch(true);
        toast({
          title: "Scansione Postazione Riuscita!",
          description: `Postazione ${simulatedScannedId} verificata. Puoi iniziare la lavorazione.`,
          action: <CheckCircle className="text-green-500" />,
        });
      } else {
        setWorkstationScanMatch(false);
        setWorkstationAlertInfo({
          title: "Errore Postazione",
          description: `Postazione ${simulatedScannedId} non corretta per commessa ${scannedJobOrder.id} (Attesa: ${scannedJobOrder.postazioneLavoro}). Verificare o recarsi presso Ufficio Produzione.`,
        });
        setIsWorkstationAlertOpen(true);
      }
    }, 1000);
  };

  const handleStartOverallJob = () => {
    if (!scannedJobOrder || !workstationScanMatch) return;
    setActiveJobOrder({ 
        ...scannedJobOrder, 
        overallStartTime: new Date(), 
        phases: scannedJobOrder.phases.map(p => ({
            ...p, 
            status: 'pending', 
            materialReady: p.materialReady || false, 
            startTime: null, 
            endTime: null
        })) 
    });
    setIsProcessingJob(true);
    setIsWorkstationScanRequired(false); 
    toast({
      title: "Lavorazione Avviata",
      description: `Lavoro iniziato per commessa ${scannedJobOrder.id} su postazione ${scannedJobOrder.postazioneLavoro}.`,
      action: <PlayCircle className="text-primary" />,
    });
  };

  const handleToggleMaterialReady = (phaseId: string) => {
    setActiveJobOrder(prev => {
      if (!prev) return null;
      return {
        ...prev,
        phases: prev.phases.map(phase => 
          phase.id === phaseId ? { ...phase, materialReady: !phase.materialReady } : phase
        ),
      };
    });
  };

  const handleStartPhase = (phaseId: string) => {
    setActiveJobOrder(prev => {
      if (!prev) return prev;
      const currentPhaseIndex = prev.phases.findIndex(p => p.id === phaseId);
      if (currentPhaseIndex === -1) return prev;

      if (prev.phases.some(p => p.id !== phaseId && (p.status === 'in-progress' || p.status === 'paused'))) {
        toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già attiva o in pausa. Completare o riprendere la fase corrente prima di avviarne una nuova." });
        return prev;
      }
      if (currentPhaseIndex > 0 && prev.phases[currentPhaseIndex - 1].status !== 'completed') {
        toast({ variant: "destructive", title: "Errore", description: "Completare la fase precedente prima di avviare questa." });
        return prev;
      }
      
      const updatedPhases = prev.phases.map(phase =>
        phase.id === phaseId ? { ...phase, status: 'in-progress' as 'in-progress', startTime: new Date() } : phase
      );
      setCurrentPhaseId(phaseId);
      toast({ title: "Fase Avviata", description: `Fase "${updatedPhases[currentPhaseIndex].name}" avviata.` });
      return { ...prev, phases: updatedPhases };
    });
  };

  const handlePausePhase = (phaseId: string) => {
    setActiveJobOrder(prev => {
      if (!prev) return prev;
      const phaseToPause = prev.phases.find(p => p.id === phaseId);
      if (!phaseToPause || phaseToPause.status !== 'in-progress') {
        toast({ variant: "destructive", title: "Errore", description: "La fase non è in lavorazione." });
        return prev;
      }
      const updatedPhases = prev.phases.map(p =>
        p.id === phaseId ? { ...p, status: 'paused' as 'paused' } : p
      );
      toast({ title: "Fase Messa in Pausa", description: `Fase "${phaseToPause.name}" in pausa.` });
      return { ...prev, phases: updatedPhases };
    });
  };

  const handleResumePhase = (phaseId: string) => {
    setActiveJobOrder(prev => {
      if (!prev) return prev;
      const phaseToResume = prev.phases.find(p => p.id === phaseId);
      if (!phaseToResume || phaseToResume.status !== 'paused') {
        toast({ variant: "destructive", title: "Errore", description: "La fase non è in pausa." });
        return prev;
      }
      if (prev.phases.some(p => p.id !== phaseId && p.status === 'in-progress')) {
         toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già in lavorazione." });
        return prev;
      }

      const updatedPhases = prev.phases.map(p =>
        p.id === phaseId ? { ...p, status: 'in-progress' as 'in-progress' } : p
      );
      toast({ title: "Fase Ripresa", description: `Fase "${phaseToResume.name}" ripresa.` });
      return { ...prev, phases: updatedPhases };
    });
  };

  const handleCompletePhase = (phaseId: string) => {
    setActiveJobOrder(prev => {
      if (!prev) return null;
      const phaseToComplete = prev.phases.find(p => p.id === phaseId);
       if (!phaseToComplete || (phaseToComplete.status !== 'in-progress' && phaseToComplete.status !== 'paused')) {
        toast({ variant: "destructive", title: "Errore", description: "La fase non è né in lavorazione né in pausa." });
        return prev;
      }
      const updatedPhases = prev.phases.map(phase =>
        p.id === phaseId ? { ...phase, status: 'completed' as 'completed', endTime: new Date() } : phase
      );
      setCurrentPhaseId(null); 
      toast({ title: "Fase Completata", description: `Fase "${phaseToComplete.name}" completata.`, action: <PhaseCompletedIcon className="text-green-500"/> });
      return { ...prev, phases: updatedPhases };
    });
  };
  
  const handleConcludeOverallJob = () => {
    if (!activeJobOrder) return;
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


  const renderJobScanArea = () => (
    <Card>
      <CardHeader>
          <div className="flex items-center space-x-3">
          <ScanLine className="h-8 w-8 text-primary" />
          <div>
            <CardTitle className="text-2xl font-headline">Scan Job Order (Commessa)</CardTitle>
            <CardDescription>Scan the barcode on the job order.</CardDescription>
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
          {isScanningJob && <p className="text-primary font-semibold">Scanning Job Order...</p>}
          {!isScanningJob && !scannedJobOrder && !isJobAlertOpen && <p className="text-muted-foreground">Align job barcode</p>}
          {jobScanSuccess && !isScanningJob && !isJobAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}
          {isJobAlertOpen && !isScanningJob && <AlertTriangle className="h-16 w-16 text-destructive" />}
          {!isScanningJob && scannedJobOrder && !isJobAlertOpen && <CheckCircle className="h-16 w-16 text-green-500" />}
        </div>
        
        <Button 
          onClick={handleSimulateJobScan} 
          disabled={isScanningJob}
          className="w-full max-w-xs bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <ScanLine className="mr-2 h-5 w-5" />
          {isScanningJob ? "Scanning..." : "Simulate Job Barcode Scan"}
        </Button>
        <p className="text-sm text-muted-foreground">
          This simulates barcode scanning for the job order.
        </p>
      </CardContent>
    </Card>
  );

  const renderJobDetailsCard = (job: JobOrder) => {
    // Determine if we are rendering details for a scanned job (before processing) or an active job (during processing)
    const isDisplayingScannedJobDetails = !isProcessingJob && job.id === scannedJobOrder?.id && scannedJobOrder !== null;
    const isDisplayingActiveJobDetails = isProcessingJob && job.id === activeJobOrder?.id && activeJobOrder !== null && !activeJobOrder.overallEndTime;
    
    // The advancement section should be displayed in either of these cases, or if processing has started
    const shouldDisplayAdvancement = isDisplayingScannedJobDetails || isDisplayingActiveJobDetails;

    let nextPhaseForDisplay: JobPhase | undefined = undefined;
    let postazioneLavoroPerFase: string | undefined = undefined;
    let allPhasesInCurrentJobCompleted = false;

    if (shouldDisplayAdvancement) {
        nextPhaseForDisplay = job.phases
            .filter(p => p.status === 'pending' || p.status === 'in-progress' || p.status === 'paused')
            .sort((a, b) => a.sequence - b.sequence)[0];
        
        if (nextPhaseForDisplay) {
            postazioneLavoroPerFase = job.postazioneLavoro; // This is the overall job's workstation
        }
        allPhasesInCurrentJobCompleted = job.phases.every(p => p.status === 'completed');
    }
    
    return (
      <Card className="mt-6 shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline flex items-center">
            <Package className="mr-3 h-7 w-7 text-primary" />
            Dettagli Commessa: {job.id}
          </CardTitle>
          <CardDescription>Reparto: {job.department}</CardDescription>
          {job.overallStartTime && (
            <CardDescription className="text-xs text-muted-foreground">
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
              <Label htmlFor="postazioneLavoroJob" className="flex items-center text-sm text-muted-foreground"><Computer className="mr-2 h-4 w-4 text-primary" />Postazione di Lavoro Prevista</Label>
              <Input id="postazioneLavoroJob" value={job.postazioneLavoro} readOnly className="bg-input text-foreground mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="descrizioneLavorazione" className="flex items-center text-sm text-muted-foreground"><Package className="mr-2 h-4 w-4 text-primary" />Descrizione Lavorazione</Label>
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
                      {isDisplayingScannedJobDetails && (
                        workstationScanMatch === true 
                          ? " (in attesa di avvio lavorazione)"
                          : " (in attesa scansione postazione)"
                      )}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium text-muted-foreground">Postazione Lavorazione Prevista:</span> {postazioneLavoroPerFase}
                    </p>
                  </>
                ) : allPhasesInCurrentJobCompleted ? (
                   <p className="text-sm text-green-500 font-medium">Tutte le fasi completate. Pronta per la conclusione.</p>
                ) : (
                   <p className="text-sm text-muted-foreground">Nessuna fase al momento o stato non determinabile.</p> 
                 )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const renderWorkstationScanCard = () => (
    <Card className="mt-6 border-primary border-dashed">
      <CardHeader>
        <CardTitle className="font-headline flex items-center text-lg">
          <Computer className="mr-3 h-6 w-6 text-primary" />
          Scan Workstation Barcode
        </CardTitle>
        <CardDescription>
          Scan the barcode on the assigned workstation: <strong>{scannedJobOrder?.postazioneLavoro}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        <div 
          className={`w-full max-w-xs h-32 border-2 rounded-lg flex items-center justify-center transition-all duration-300
          ${isScanningWorkstation ? 'border-primary animate-pulse' : 'border-border'}
          ${workstationScanMatch === false ? 'border-destructive bg-destructive/10' : ''}
          `}
        >
          {isScanningWorkstation && <p className="text-primary font-semibold">Scanning Workstation...</p>}
          {!isScanningWorkstation && workstationScanMatch === null && <p className="text-muted-foreground">Align workstation barcode</p>}
          {!isScanningWorkstation && workstationScanMatch === false && <AlertTriangle className="h-12 w-12 text-destructive" />}
          {!isScanningWorkstation && workstationScanMatch === true && <CheckCircle className="h-12 w-12 text-green-500" />}
        </div>
        <Button 
          onClick={handleSimulateWorkstationScan} 
          disabled={isScanningWorkstation}
          className="w-full max-w-xs"
          variant="outline"
        >
          <ScanLine className="mr-2 h-5 w-5" />
          {isScanningWorkstation ? "Scanning..." : "Simulate Workstation Scan"}
        </Button>
      </CardContent>
    </Card>
  );

  const renderPhasesManagement = () => (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline flex items-center">
          <ListChecks className="mr-3 h-7 w-7 text-primary" />
          Fasi di Lavorazione Commessa: {activeJobOrder?.id}
        </CardTitle>
        <CardDescription>Gestisci l'avanzamento delle fasi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeJobOrder?.phases.sort((a,b) => a.sequence - b.sequence).map((phase, index) => {
          const isPreviousPhaseCompleted = index === 0 || activeJobOrder.phases.find(p => p.sequence === phase.sequence -1)?.status === 'completed';
          const noOtherPhaseActiveOrPaused = !activeJobOrder.phases.some(p => p.id !== phase.id && (p.status === 'in-progress' || p.status === 'paused'));

          const canStartPhase = phase.status === 'pending' && phase.materialReady && isPreviousPhaseCompleted && noOtherPhaseActiveOrPaused;
          const canPausePhase = phase.status === 'in-progress';
          const canResumePhase = phase.status === 'paused' && noOtherPhaseActiveOrPaused; 
          const canCompletePhase = phase.status === 'in-progress' || phase.status === 'paused';
          
          let phaseIcon = <PhasePendingIcon className="mr-2 h-5 w-5 text-muted-foreground" />;
          if (phase.status === 'in-progress') phaseIcon = <Hourglass className="mr-2 h-5 w-5 text-yellow-500 animate-spin" />;
          if (phase.status === 'paused') phaseIcon = <PausePhaseIcon className="mr-2 h-5 w-5 text-orange-500" />;
          if (phase.status === 'completed') phaseIcon = <PhaseCompletedIcon className="mr-2 h-5 w-5 text-green-500" />;

          return (
            <Card key={phase.id} className="p-4 bg-card/50">
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
                    onCheckedChange={() => handleToggleMaterialReady(phase.id)}
                    disabled={phase.status !== 'pending'}
                  />
                  {phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Postazione Prevista: {activeJobOrder?.postazioneLavoro}
              </div>
              {phase.startTime && (
                <p className="text-xs text-muted-foreground mt-1">
                  Iniziata: {format(phase.startTime, "dd/MM/yyyy HH:mm:ss")}
                  {phase.status === 'paused' && " (In Pausa)"}
                </p>
              )}
              {phase.endTime && (
                <p className="text-xs text-muted-foreground">
                  Completata: {format(phase.endTime, "dd/MM/yyyy HH:mm:ss")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canStartPhase && (
                  <Button size="sm" onClick={() => handleStartPhase(phase.id)} variant="outline">
                    <PlayCircle className="mr-2 h-4 w-4" /> Avvia Fase
                  </Button>
                )}
                {canPausePhase && (
                  <Button size="sm" onClick={() => handlePausePhase(phase.id)} variant="outline" className="text-orange-500 border-orange-500 hover:bg-orange-500/10 hover:text-orange-500">
                    <PausePhaseIcon className="mr-2 h-4 w-4" /> Metti in Pausa
                  </Button>
                )}
                 {canResumePhase && (
                  <Button size="sm" onClick={() => handleResumePhase(phase.id)} variant="outline" className="text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500">
                    <PlayCircle className="mr-2 h-4 w-4" /> Riprendi Fase
                  </Button>
                )}
                {canCompletePhase && (
                  <Button size="sm" onClick={() => handleCompletePhase(phase.id)} className="bg-green-600 hover:bg-green-700 text-primary-foreground">
                    <PhaseCompletedIcon className="mr-2 h-4 w-4" /> Completa Fase
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
        {allPhasesCompleted && !activeJobOrder?.overallEndTime && (
          <Button onClick={handleConcludeOverallJob} className="w-full mt-4 bg-primary text-primary-foreground">
            <PowerOff className="mr-2 h-5 w-5" /> Concludi Commessa
          </Button>
        )}
         {activeJobOrder?.overallEndTime && (
          <p className="mt-4 text-center text-green-500 font-semibold">Commessa conclusa il: {format(activeJobOrder.overallEndTime, "dd/MM/yyyy HH:mm:ss")}</p>
        )}
      </CardContent>
    </Card>
  );


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>

          {!isProcessingJob && !activeJobOrder?.overallEndTime && renderJobScanArea()}
          
          {scannedJobOrder && !isProcessingJob && !activeJobOrder?.overallEndTime && (
            <>
              {renderJobDetailsCard(scannedJobOrder)}
              {isWorkstationScanRequired && workstationScanMatch !== true && !isWorkstationAlertOpen && (
                renderWorkstationScanCard()
              )}
              {workstationScanMatch === true && (
                 <Button 
                    className="mt-6 w-full bg-primary hover:bg-primary/90 text-primary-foreground" 
                    onClick={handleStartOverallJob}
                  >
                    <PlayCircle className="mr-2 h-5 w-5" /> Inizia Lavorazione Commessa
                  </Button>
              )}
            </>
          )}

          {isProcessingJob && activeJobOrder && (
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

          <AlertDialog open={isWorkstationAlertOpen} onOpenChange={setIsWorkstationAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  <AlertTriangle className="mr-2 h-6 w-6 text-destructive" />
                  {workstationAlertInfo.title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {workstationAlertInfo.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => { 
                  setIsWorkstationAlertOpen(false); 
                  setScannedWorkstationId(null); 
                  setWorkstationScanMatch(null); 
                }}>OK</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}
    

    



