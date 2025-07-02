
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
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
import { QrCode, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle as PhasePendingIcon, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert, Loader2, Boxes, Keyboard, Send } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import type { JobOrder, JobPhase, WorkPeriod, RawMaterial } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob } from './actions';
import { getRawMaterialByCode, searchRawMaterials } from '@/app/raw-material-scan/actions';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';

// Manual type declaration for BarcodeDetector API to ensure compilation
interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const openingWeightSchema = z.object({
  openingWeight: z.coerce.number().positive("Il peso di apertura deve essere un numero positivo."),
});
type OpeningWeightFormValues = z.infer<typeof openingWeightSchema>;
type SearchResult = Pick<RawMaterial, 'id' | 'code' | 'description'>;


function calculateTotalActiveTime(workPeriods: WorkPeriod[]): string {
  let totalMilliseconds = 0;
  workPeriods.forEach(period => {
    if (period.end) {
      totalMilliseconds += new Date(period.end).getTime() - new Date(period.start).getTime();
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
  const { operator } = useAuth();
  const { activeJob: activeJobOrder, setActiveJob: setActiveJobOrder, isLoading: isJobLoading } = useActiveJob();
  const [step, setStep] = useState<'initial' | 'scanning' | 'processing' | 'finished' | 'loading'>('loading');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const [isProblemReportDialogOpen, setIsProblemReportDialogOpen] = useState(false);
  
  const [phaseRequiringWorkstationScan, setPhaseRequiringWorkstationScan] = useState<string | null>(null);
  const [isScanningWorkstationForPhase, setIsScanningWorkstationForPhase] = useState(false);
  const [scannedWorkstationIdForPhase, setScannedWorkstationIdForPhase] = useState<string | null>(null);
  const [isPhaseWorkstationAlertOpen, setIsPhaseWorkstationAlertOpen] = useState(false);
  const [phaseWorkstationAlertInfo, setPhaseWorkstationAlertInfo] = useState({ title: "", description: "" });

  const [isMaterialScanDialogOpen, setIsMaterialScanDialogOpen] = useState(false);
  const [phaseForMaterialScan, setPhaseForMaterialScan] = useState<JobPhase | null>(null);
  const [materialScanStep, setMaterialScanStep] = useState<'initial' | 'scanning' | 'manual_input' | 'form'>('initial');
  const [scannedMaterialForPhase, setScannedMaterialForPhase] = useState<RawMaterial | null>(null);
  const [manualMaterialCode, setManualMaterialCode] = useState('');
  const [isSearchingMaterial, setIsSearchingMaterial] = useState(false);
  const [materialSearchResults, setMaterialSearchResults] = useState<SearchResult[]>([]);


  // Debounce search for materials
  useEffect(() => {
    const handler = setTimeout(async () => {
        if (manualMaterialCode.length > 1) {
            setIsSearchingMaterial(true);
            const results = await searchRawMaterials(manualMaterialCode);
            setMaterialSearchResults(results);
            setIsSearchingMaterial(false);
        } else {
            setMaterialSearchResults([]);
        }
    }, 300);
    return () => clearTimeout(handler);
  }, [manualMaterialCode]);
  
  const openingWeightForm = useForm<OpeningWeightFormValues>({
    resolver: zodResolver(openingWeightSchema),
    defaultValues: { openingWeight: 0 },
  });


  useEffect(() => {
    if (!isJobLoading) {
      if (activeJobOrder) {
        if (activeJobOrder.status === 'completed') {
          setStep('finished');
        } else {
          setStep('processing');
        }
      } else {
        setStep('initial');
      }
    } else {
      setStep('loading');
    }
  }, [isJobLoading, activeJobOrder]);

  const handleUpdateAndPersistJob = useCallback(async (updatedJob: JobOrder | null) => {
    setActiveJobOrder(updatedJob); // Update context immediately for responsive UI
    if (updatedJob === null) return;

    const result = await updateJob(updatedJob);
    if (!result.success) {
        toast({
            variant: "destructive",
            title: "Errore di Sincronizzazione",
            description: result.message || "Impossibile salvare lo stato della commessa.",
        });
        // Optionally revert state here if sync fails
    }
  }, [setActiveJobOrder, toast]);
  
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
  }, []);

  const handleStartOverallJob = useCallback((jobToStart: JobOrder) => {
    if (!jobToStart) return;
     if (jobToStart.isProblemReported) {
      toast({
        variant: "destructive",
        title: "Lavorazione Bloccata",
        description: "Un problema è stato segnalato per questa commessa. Impossibile avviare.",
      });
      setStep('initial');
      return;
    }
    const jobWithStartTime = {
        ...jobToStart,
        overallStartTime: jobToStart.overallStartTime || new Date(),
        phases: jobToStart.phases.map(p => ({
            ...p,
            status: p.status,
            workPeriods: p.workPeriods || [], 
            workstationScannedAndVerified: p.workstationScannedAndVerified || false,
        }))
    };
    handleUpdateAndPersistJob(jobWithStartTime);
    setStep('processing');
    toast({
      title: "Lavorazione Avviata",
      description: `Lavoro iniziato per commessa ${jobToStart.id}.`,
      action: <PlayCircle className="text-primary" />,
    });
  }, [handleUpdateAndPersistJob, toast]);


  const handleScannedData = useCallback(async (data: string) => {
    const parts = data.split('@');
    if (parts.length !== 3) {
        toast({ variant: 'destructive', title: 'QR Code non Valido', description: 'Formato del QR code non corretto. Atteso: "Ordine PF@Codice@Qta"' });
        setStep('initial');
        return;
    }
    const [ordinePF, codice, qta] = parts;
    if (!ordinePF || !codice || !qta) {
        toast({ variant: 'destructive', title: 'QR Code Incompleto', description: 'Dati mancanti nel QR Code.' });
        setStep('initial');
        return;
    }

    toast({ title: "QR Code Rilevato", description: "Verifica commessa in corso..." });
    const result = await verifyAndGetJobOrder({ ordinePF, codice, qta });

    if ('error' in result) {
        toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        setStep('initial');
    } else {
        toast({ title: "Commessa Verificata!", description: `Pronto per iniziare la lavorazione per ${result.id}.`, action: <CheckCircle className="text-green-500"/> });
        handleStartOverallJob(result);
    }
  }, [toast, handleStartOverallJob]);

  useEffect(() => {
    if (step !== 'scanning') {
        stopCamera();
        return;
    }

    let detectionInterval: ReturnType<typeof setInterval>;

    const startCameraAndScan = async () => {
        setCameraError(null);
        try {
            if (!('BarcodeDetector' in window)) {
                toast({ variant: 'destructive', title: 'Funzionalità non Supportata', description: 'Il tuo browser non supporta la scansione di QR code.' });
                setStep('initial');
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            streamRef.current = stream;
            const video = videoRef.current;
            if (video) {
                video.srcObject = stream;
                await video.play();
            }

            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            
            detectionInterval = setInterval(async () => {
                if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) return;

                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes.length > 0) {
                    clearInterval(detectionInterval);
                    stopCamera();
                    const scannedData = barcodes[0].rawValue;
                    handleScannedData(scannedData);
                }
            }, 500);

        } catch (err) {
            console.error("Camera access error:", err);
            setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi del browser.");
            stopCamera();
            setStep('initial');
        }
    };

    startCameraAndScan();
    
    return () => {
        clearInterval(detectionInterval);
        stopCamera();
    }
  }, [step, stopCamera, toast, handleScannedData]);

  const handleTriggerWorkstationScanForPhase = (phaseId: string) => {
    setPhaseRequiringWorkstationScan(phaseId);
    setScannedWorkstationIdForPhase(null);
    if (activeJobOrder) {
        const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
        const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);
        if (phaseToUpdate) {
            phaseToUpdate.workstationScannedAndVerified = false;
        }
        setActiveJobOrder(jobToUpdate);
    }
  };

  const handleSimulateWorkstationScanForPhase = (phaseId: string) => {
    if (!activeJobOrder || !operator) return;

    setIsScanningWorkstationForPhase(true);
    const simulatedScannedId = activeJobOrder.postazioneLavoro;
    setScannedWorkstationIdForPhase(simulatedScannedId);

    setTimeout(() => {
      setIsScanningWorkstationForPhase(false);
      const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
      const phaseToStart = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

      if (simulatedScannedId !== jobToUpdate.postazioneLavoro || !phaseToStart) {
        setPhaseWorkstationAlertInfo({
          title: "Errore Postazione",
          description: `Postazione ${simulatedScannedId} non corretta per commessa ${jobToUpdate.id} (Attesa: ${jobToUpdate.postazioneLavoro}). Verificare o recarsi presso Ufficio Produzione.`,
        });
        setIsPhaseWorkstationAlertOpen(true);
        return;
      }
      
      if (jobToUpdate.isProblemReported) {
        toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Un problema è stato segnalato per questa commessa." });
        return;
      }
      
      const phaseType = phaseToStart.type || 'production';

      if (phaseType === 'production' && !phaseToStart.materialReady) {
        toast({ variant: "destructive", title: "Errore Materiale", description: `Materiale non pronto per la fase "${phaseToStart.name}".` });
        return;
      }

      if (phaseType === 'production') {
        if (phaseToStart.sequence === 1) {
          const allPrepPhases = jobToUpdate.phases.filter((p: JobPhase) => (p.type || 'production') === 'preparation');
          if (!allPrepPhases.every(p => p.status === 'completed')) {
            toast({ variant: "destructive", title: "Errore di Sequenza", description: "È necessario completare tutte le fasi di preparazione prima di iniziare la produzione." });
            return;
          }
        } else {
          const prevPhase = jobToUpdate.phases.find((p: JobPhase) => p.sequence === phaseToStart.sequence - 1);
          if (!prevPhase || prevPhase.status !== 'completed') {
            toast({ variant: "destructive", title: "Errore di Sequenza", description: "Completare la fase di produzione precedente prima di avviare questa." });
            return;
          }
        }
      }

      if (jobToUpdate.phases.some((p: JobPhase) => p.id !== phaseId && (p.status === 'in-progress' || p.status === 'paused'))) {
        toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già attiva o in pausa. Completare o riprendere la fase corrente prima di avviarne una nuova." });
        return;
      }
      
      phaseToStart.status = 'in-progress';
      phaseToStart.workstationScannedAndVerified = true;
      phaseToStart.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });

      handleUpdateAndPersistJob(jobToUpdate);
      setPhaseRequiringWorkstationScan(null);
      
      toast({
        title: "Fase Avviata!",
        description: `Postazione verificata e fase "${phaseToStart.name}" avviata.`,
        action: <CheckCircle className="text-green-500" />,
      });
    }, 1000);
  };

  const handlePausePhase = (phaseId: string) => {
    if (!activeJobOrder) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToPause = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (jobToUpdate.isProblemReported) {
      toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile mettere in pausa, problema segnalato." });
      return;
    }
    if (!phaseToPause || phaseToPause.status !== 'in-progress') {
      toast({ variant: "destructive", title: "Errore", description: "La fase non è in lavorazione." });
      return;
    }
    
    const lastWorkPeriod = phaseToPause.workPeriods[phaseToPause.workPeriods.length - 1];
    if (lastWorkPeriod && !lastWorkPeriod.end) {
        lastWorkPeriod.end = new Date();
    }
    phaseToPause.status = 'paused';

    handleUpdateAndPersistJob(jobToUpdate);
    toast({ title: "Fase Messa in Pausa", description: `Fase "${phaseToPause.name}" in pausa.` });
  };

  const handleResumePhase = (phaseId: string) => {
    if (!activeJobOrder || !operator) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToResume = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (jobToUpdate.isProblemReported) {
      toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile riprendere, problema segnalato." });
      return;
    }
    if (!phaseToResume || phaseToResume.status !== 'paused') {
      toast({ variant: "destructive", title: "Errore", description: "La fase non è in pausa." });
      return;
    }
    if (jobToUpdate.phases.some((p: JobPhase) => p.id !== phaseId && p.status === 'in-progress')) {
       toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già in lavorazione." });
      return;
    }

    phaseToResume.status = 'in-progress';
    phaseToResume.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
    
    handleUpdateAndPersistJob(jobToUpdate);
    toast({ title: "Fase Ripresa", description: `Fase "${phaseToResume.name}" ripresa.` });
  };

  const handleCompletePhase = (phaseId: string) => {
    if (!activeJobOrder) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToComplete = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (!phaseToComplete || (phaseToComplete.status !== 'in-progress' && phaseToComplete.status !== 'paused')) {
      toast({ variant: "destructive", title: "Errore", description: "La fase non è né in lavorazione né in pausa." });
      return;
    }
    
    if (phaseToComplete.status === 'in-progress') {
        const lastWorkPeriod = phaseToComplete.workPeriods[phaseToComplete.workPeriods.length - 1];
        if (lastWorkPeriod && !lastWorkPeriod.end) {
            lastWorkPeriod.end = new Date();
        }
    }
    phaseToComplete.status = 'completed';

    const completedPhaseType = phaseToComplete.type || 'production';

    if (completedPhaseType === 'preparation') {
      const allPrepPhases = jobToUpdate.phases.filter((p: JobPhase) => (p.type || 'production') === 'preparation');
      const allPrepCompleted = allPrepPhases.every((p: JobPhase) => p.status === 'completed');

      if (allPrepCompleted) {
        const firstProductionPhase = jobToUpdate.phases.find((p: JobPhase) => p.sequence === 1);
        if (firstProductionPhase && !firstProductionPhase.materialReady) {
            firstProductionPhase.materialReady = true;
            toast({ title: "Preparazione Completata", description: `Materiale ora disponibile per la fase: "${firstProductionPhase.name}".`});
        }
      }
    } else {
      const completedPhaseSequence = phaseToComplete.sequence;
      const nextPhase = jobToUpdate.phases.find((p: JobPhase) => p.sequence === completedPhaseSequence + 1);
      if (nextPhase && nextPhase.status === 'pending') { 
        nextPhase.materialReady = true;
        toast({ title: "Materiale Pronto", description: `Materiale per la fase "${nextPhase.name}" ora disponibile.`});
      }
    }
    
    handleUpdateAndPersistJob(jobToUpdate);
    toast({ title: "Fase Completata", description: `Fase "${phaseToComplete.name}" completata.`, action: <PhaseCompletedIcon className="text-green-500"/> });
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
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    jobToUpdate.overallEndTime = new Date();
    jobToUpdate.status = 'completed';

    handleUpdateAndPersistJob(jobToUpdate);
    toast({
      title: "Commessa Conclusa",
      description: `Lavorazione per commessa ${jobToUpdate.id} terminata con successo.`,
      action: <PowerOff className="text-primary" />
    });
    setStep('finished');
  };

  const allPhasesCompleted = activeJobOrder?.phases.every(phase => phase.status === 'completed');

  const handleJobProblemReported = () => {
    if (activeJobOrder) {
      const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
      jobToUpdate.isProblemReported = true;
      
      const activePhase = jobToUpdate.phases.find((p: JobPhase) => p.status === 'in-progress');
      if (activePhase) {
        const lastWorkPeriod = activePhase.workPeriods[activePhase.workPeriods.length - 1];
        if (lastWorkPeriod && !lastWorkPeriod.end) {
            lastWorkPeriod.end = new Date();
        }
        activePhase.status = 'paused';
      }

      handleUpdateAndPersistJob(jobToUpdate);

      toast({
        variant: "destructive",
        title: "Problema Segnalato per Commessa",
        description: `La commessa ${activeJobOrder.id} è stata bloccata. Risolvere il problema prima di continuare.`,
      });
    }
    setIsProblemReportDialogOpen(false);
  };

  const resetForNewScan = () => {
    setActiveJobOrder(null);
    setPhaseRequiringWorkstationScan(null);
    setIsScanningWorkstationForPhase(false);
    setScannedWorkstationIdForPhase(null);
    setStep('initial');
  }

  const handleOpenMaterialScanDialog = (phase: JobPhase) => {
    setPhaseForMaterialScan(phase);
    setScannedMaterialForPhase(null);
    setManualMaterialCode('');
    setMaterialSearchResults([]);
    openingWeightForm.reset();
    setMaterialScanStep('initial');
    setIsMaterialScanDialogOpen(true);
  };

  const handleMaterialCodeSubmit = useCallback(async (code: string) => {
    stopCamera();
    setMaterialScanStep('initial');
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast({ variant: 'destructive', title: "Codice Vuoto" });
      setMaterialScanStep('manual_input');
      return;
    }
    toast({ title: "Ricerca materia prima..." });
    const result = await getRawMaterialByCode(trimmedCode);
    if ('error' in result) {
      toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
      setScannedMaterialForPhase(null);
    } else {
      setScannedMaterialForPhase(result);
      setMaterialScanStep('form');
    }
  }, [stopCamera, toast]);

  const onOpeningWeightSubmit = (values: OpeningWeightFormValues) => {
    if (!activeJobOrder || !phaseForMaterialScan || !scannedMaterialForPhase) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);

    if (phaseToUpdate) {
        phaseToUpdate.materialConsumption = {
            materialId: scannedMaterialForPhase.id,
            materialCode: scannedMaterialForPhase.code,
            openingWeight: values.openingWeight,
        };
        handleUpdateAndPersistJob(jobToUpdate);
        toast({ title: "Peso di Apertura Registrato", description: `Materiale ${scannedMaterialForPhase.code} associato alla fase.` });
    }
    setIsMaterialScanDialogOpen(false);
  };

  if (step === 'loading') {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </AppShell>
    )
  }

  const renderScanArea = () => (
    <Card>
      <CardHeader>
          <div className="flex items-center space-x-3">
          <QrCode className="h-8 w-8 text-primary" />
          <div>
            <CardTitle className="text-2xl font-headline">Scansiona Commessa (Ordine PF)</CardTitle>
            <CardDescription>Scansiona il QR code sulla commessa per iniziare la lavorazione.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center space-y-6">
        {step === 'scanning' ? (
          <div className="relative flex items-center justify-center w-full max-w-xs aspect-square bg-black rounded-lg overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none">
              <div className="w-2/3 h-2/3 border-4 border-dashed border-primary/70 rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            {cameraError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Errore Fotocamera</AlertTitle>
                <AlertDescription>{cameraError}</AlertDescription>
              </Alert>
            )}
            <Button
              onClick={() => setStep('scanning')}
              disabled={step === 'scanning'}
              className="w-full max-w-xs"
            >
              <QrCode className="mr-2 h-5 w-5" />
              Scansiona QR Code Commessa
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );

  const renderJobDetailsCard = (job: JobOrder) => {
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
          </div>
           {job.isProblemReported && (
            <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
              <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato! Lavorazione bloccata.
            </p>
           )}
          {job.overallStartTime && (
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Iniziata il: {format(new Date(job.overallStartTime), "dd/MM/yyyy HH:mm:ss")}
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
        </CardContent>
      </Card>
    );
  }

  const renderPhasesManagement = () => {
    if (!activeJobOrder) return null;
    const isJobBlockedByProblem = !!activeJobOrder.isProblemReported;
    
    const preparationPhases = activeJobOrder.phases.filter(p => (p.type ?? 'production') === 'preparation');
    const productionPhases = activeJobOrder.phases.filter(p => (p.type ?? 'production') === 'production');
    const allPreparationPhasesCompleted = preparationPhases.length === 0 || preparationPhases.every(p => p.status === 'completed');

    const renderPhaseCard = (phase: JobPhase) => {
          const phaseType = phase.type || 'production';
          const noOtherPhaseActiveOrPaused = !activeJobOrder.phases.some(p => p.id !== phase.id && (p.status === 'in-progress' || p.status === 'paused'));
          
          const materialRequirementMet = !phase.requiresMaterialScan || (phase.requiresMaterialScan && !!phase.materialConsumption);
          
          let canStartPhase = false;
          if (phaseType === 'preparation') {
            canStartPhase = noOtherPhaseActiveOrPaused;
          } else { // production
            if (phase.sequence === 1) {
              canStartPhase = allPreparationPhasesCompleted && noOtherPhaseActiveOrPaused;
            } else {
              const prevPhase = activeJobOrder.phases.find(p => p.sequence === phase.sequence - 1);
              canStartPhase = !!prevPhase && prevPhase.status === 'completed' && noOtherPhaseActiveOrPaused;
            }
          }

          const canTriggerWorkstationScan = !isJobBlockedByProblem && materialRequirementMet && phase.status === 'pending' && canStartPhase && !phase.workstationScannedAndVerified;
          const canPausePhase = !isJobBlockedByProblem && phase.status === 'in-progress';
          const canResumePhase = !isJobBlockedByProblem && phase.status === 'paused' && noOtherPhaseActiveOrPaused;
          const canCompletePhase = phase.status === 'in-progress' || phase.status === 'paused';
          const canScanMaterial = phase.requiresMaterialScan && !phase.materialConsumption;


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
                {phase.materialConsumption && (
                    <p className="font-semibold text-primary">Materiale: {phase.materialConsumption.materialCode} (Aperto: {phase.materialConsumption.openingWeight} kg)</p>
                )}
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
                    <p className="text-sm text-muted-foreground">Scansiona il QR code della postazione: <strong>{activeJobOrder?.postazioneLavoro}</strong></p>
                     <div
                        className={`w-full h-24 border-2 rounded-lg flex items-center justify-center transition-all duration-300
                        ${isScanningWorkstationForPhase ? 'border-primary animate-pulse' : 'border-border'}
                        ${scannedWorkstationIdForPhase && !isScanningWorkstationForPhase && !phase.workstationScannedAndVerified ? 'border-destructive bg-destructive/10' : ''}
                        ${phase.workstationScannedAndVerified && !isScanningWorkstationForPhase ? 'border-green-500 bg-green-500/10' : ''}
                        `} >
                        {isScanningWorkstationForPhase && <p className="text-primary font-semibold">Scansione Postazione...</p>}
                        {!isScanningWorkstationForPhase && !phase.workstationScannedAndVerified && <p className="text-muted-foreground">Allinea QR code postazione</p>}
                        {!isScanningWorkstationForPhase && phase.workstationScannedAndVerified && <CheckCircle className="h-10 w-10 text-green-500" />}
                         {scannedWorkstationIdForPhase && !isScanningWorkstationForPhase && !phase.workstationScannedAndVerified && <AlertTriangle className="h-10 w-10 text-destructive" />}
                    </div>
                    <Button
                        onClick={() => handleSimulateWorkstationScanForPhase(phase.id)}
                        disabled={isScanningWorkstationForPhase || isJobBlockedByProblem}
                        className="w-full"
                        variant="outline" >
                        <QrCode className="mr-2 h-5 w-5" />
                        {isScanningWorkstationForPhase ? "Scansione..." : "Simula Scansione Postazione per Fase"}
                    </Button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {canScanMaterial && (
                    <Button size="sm" onClick={() => handleOpenMaterialScanDialog(phase)} variant="default" disabled={isJobBlockedByProblem}>
                        <Boxes className="mr-2 h-4 w-4" /> Scansiona Materiale
                    </Button>
                )}
                {canTriggerWorkstationScan && phase.status === 'pending' && (
                     <Button size="sm" onClick={() => handleTriggerWorkstationScanForPhase(phase.id)} variant="outline" className="border-primary text-primary hover:bg-primary/10" disabled={isJobBlockedByProblem}>
                        <QrCode className="mr-2 h-4 w-4" /> Scansiona Postazione per Fase
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
    }
    
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
        {preparationPhases.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Fasi Preparazione</span>
              <Separator className="flex-1" />
            </div>
            <div className="space-y-4">
                {preparationPhases.sort((a,b) => a.sequence - b.sequence).map(renderPhaseCard)}
            </div>
          </>
        )}
        
        {productionPhases.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-4">
              <span className="text-sm font-semibold text-muted-foreground">Fasi Produzione</span>
              <Separator className="flex-1" />
            </div>
             <div className="space-y-4">
                {productionPhases.sort((a,b) => a.sequence - b.sequence).map(renderPhaseCard)}
            </div>
          </>
        )}


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

  const renderFinishedView = () => (
    <Card>
      <CardHeader>
        <CardTitle>Lavorazione Completata</CardTitle>
        <CardDescription>La commessa {activeJobOrder?.id} è stata conclusa con successo.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <CheckCircle className="h-16 w-16 text-green-500"/>
        <p>Pronto per la prossima lavorazione.</p>
        <Button onClick={resetForNewScan}>
            <QrCode className="mr-2 h-4 w-4"/>
            Scansiona Nuova Commessa
        </Button>
      </CardContent>
    </Card>
  );

  const renderMaterialScanDialog = () => (
    <Dialog open={isMaterialScanDialogOpen} onOpenChange={setIsMaterialScanDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Scansiona Materiale per: {phaseForMaterialScan?.name}</DialogTitle>
            </DialogHeader>

            {materialScanStep === 'initial' && (
                <div className="py-4 space-y-4">
                    <Button onClick={() => setMaterialScanStep('scanning')} className="w-full"><QrCode className="mr-2 h-4 w-4" /> Scansiona QR Code</Button>
                    <Button onClick={() => setMaterialScanStep('manual_input')} variant="outline" className="w-full"><Keyboard className="mr-2 h-4 w-4" /> Inserisci Manualmente</Button>
                </div>
            )}

            {materialScanStep === 'scanning' && (
                <div>...</div>
            )}

            {materialScanStep === 'manual_input' && (
                <div className="space-y-4 py-4">
                    <Label htmlFor="manualMaterialCode">Codice Materia Prima</Label>
                    <div className="relative">
                        <Input id="manualMaterialCode" value={manualMaterialCode} onChange={(e) => setManualMaterialCode(e.target.value)} placeholder="Es. BOB-123" autoFocus autoComplete="off" />
                        {isSearchingMaterial && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />}
                    </div>
                    {materialSearchResults.length > 0 && (
                        <div className="border rounded-md max-h-32 overflow-y-auto">
                            {materialSearchResults.map(material => (
                                <button key={material.id} type="button" className="w-full text-left p-2 hover:bg-accent" onClick={() => handleMaterialCodeSubmit(material.code)}>
                                    <p className="font-semibold">{material.code}</p>
                                    <p className="text-sm text-muted-foreground">{material.description}</p>
                                </button>
                            ))}
                        </div>
                    )}
                    <Button onClick={() => handleMaterialCodeSubmit(manualMaterialCode)} className="w-full" disabled={!manualMaterialCode}>Cerca</Button>
                    <Button variant="ghost" onClick={() => setMaterialScanStep('initial')}>Indietro</Button>
                </div>
            )}

            {materialScanStep === 'form' && scannedMaterialForPhase && (
                 <Form {...openingWeightForm}>
                    <form onSubmit={openingWeightForm.handleSubmit(onOpeningWeightSubmit)} className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">{scannedMaterialForPhase.code}</CardTitle>
                                <CardDescription>{scannedMaterialForPhase.description}</CardDescription>
                            </CardHeader>
                        </Card>
                        <FormField
                            control={openingWeightForm.control}
                            name="openingWeight"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>KG di Apertura</FormLabel>
                                    <FormControl>
                                        <Input type="number" step="0.01" placeholder="Es. 10.5" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <DialogFooter>
                            <Button type="submit">
                                <Send className="mr-2 h-4 w-4" />
                                Registra Peso e Associa
                            </Button>
                        </DialogFooter>
                    </form>
                 </Form>
            )}
            
        </DialogContent>
    </Dialog>
  )


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <OperatorNavMenu />
          <AlertDialog open={isProblemReportDialogOpen} onOpenChange={setIsProblemReportDialogOpen}>
            
            {step === 'initial' && renderScanArea()}
            {step === 'scanning' && renderScanArea()}

            {step === 'processing' && activeJobOrder && (
              <>
                {renderJobDetailsCard(activeJobOrder)}
                {renderPhasesManagement()}
              </>
            )}

            {step === 'finished' && activeJobOrder && renderFinishedView()}

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Segnala Problema per Commessa: {activeJobOrder?.id}</AlertDialogTitle>
                <AlertDialogDescription>
                  Descrivi il problema riscontrato per questa commessa. La segnalazione bloccherà temporaneamente la lavorazione.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ProblemReportForm onSuccess={handleJobProblemReported} showTitle={false} initialSeverity="medium" />
            </AlertDialogContent>
          </AlertDialog>
          
          {renderMaterialScanDialog()}

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
                <AlertDialogAction onClick={() => setIsPhaseWorkstationAlertOpen(false)}>
                  OK
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}
