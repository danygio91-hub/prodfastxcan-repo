

"use client";

import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react';
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
import { QrCode, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle as PhasePendingIcon, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert, Loader2, Boxes, Keyboard, Send, LogOut, Barcode, Weight, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import type { JobOrder, JobPhase, WorkPeriod, RawMaterial, RawMaterialType } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob, logTubiWithdrawal, findLastWeightForLotto } from './actions';
import { getRawMaterialByCode } from '@/app/material-loading/actions';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import { useAuth } from '@/components/auth/AuthProvider';

// Manual type declaration for BarcodeDetector API to ensure compilation
interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const phaseMaterialSchema = z.object({
  openingWeight: z.coerce.number().positive("Il peso di apertura deve essere un numero positivo."),
  lottoBobina: z.string().optional(),
});
type PhaseMaterialFormValues = z.infer<typeof phaseMaterialSchema>;

const tubiWithdrawalSchema = z.object({
  quantity: z.coerce.number().positive("La quantità deve essere positiva."),
  unit: z.enum(['n', 'kg'], { required_error: "Selezionare l'unità di misura." }),
});
type TubiWithdrawalFormValues = z.infer<typeof tubiWithdrawalSchema>;


const closingWeightSchema = z.object({
  closingWeight: z.coerce.number().min(0, "Il peso di chiusura non può essere negativo."),
});
type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

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
  const { activeSessions, startSession, addJobToSession, closeSession, getSessionForType } = useActiveMaterialSession();
  const [step, setStep] = useState<'initial' | 'scanning' | 'processing' | 'finished' | 'loading'>('loading');
  const [isPending, startTransition] = useTransition();

  const videoRef = useRef<HTMLVideoElement>(null);
  const lottoVideoRef = useRef<HTMLVideoElement>(null);
  const materialVideoRef = useRef<HTMLVideoElement>(null);
  const phaseScanVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const [isProblemReportDialogOpen, setIsProblemReportDialogOpen] = useState(false);
  
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);

  const [isMaterialScanDialogOpen, setIsMaterialScanDialogOpen] = useState(false);
  const [isLottoScanDialogOpen, setIsLottoScanDialogOpen] = useState(false);
  const [phaseForMaterialScan, setPhaseForMaterialScan] = useState<JobPhase | null>(null);
  const [materialScanStep, setMaterialScanStep] = useState<'initial' | 'scanning' | 'manual_input' | 'form'>('initial');
  const [scannedMaterialForPhase, setScannedMaterialForPhase] = useState<RawMaterial | null>(null);
  const [manualMaterialCode, setManualMaterialCode] = useState('');
  const [isSearchingMaterial, setIsSearchingMaterial] = useState(false);

  const [isContinueOrCloseDialogOpen, setIsContinueOrCloseDialogOpen] = useState(false);
  const [jobToFinalize, setJobToFinalize] = useState<JobOrder | null>(null);

  const phaseMaterialForm = useForm<PhaseMaterialFormValues>({
    resolver: zodResolver(phaseMaterialSchema),
    defaultValues: { openingWeight: undefined, lottoBobina: '' },
  });
  
  const tubiWithdrawalForm = useForm<TubiWithdrawalFormValues>({
    resolver: zodResolver(tubiWithdrawalSchema),
    defaultValues: { quantity: undefined },
  });

  const closingWeightForm = useForm<ClosingWeightFormValues>({
    resolver: zodResolver(closingWeightSchema),
    defaultValues: { closingWeight: 0 },
  });


  useEffect(() => {
    if (!isJobLoading) {
      if (activeJobOrder) {
        if (activeJobOrder.status === 'completed') {
          setStep('finished');
        } else {
          if (activeSessions.length > 0 && !activeSessions.every(s => s.associatedJobs.some(j => j.jobId === activeJobOrder.id))) {
              addJobToSession({ jobId: activeJobOrder.id, jobOrderPF: activeJobOrder.ordinePF });
          }
          setStep('processing');
        }
      } else {
        setStep('initial');
      }
    } else {
      setStep('loading');
    }
  }, [isJobLoading, activeJobOrder, activeSessions, addJobToSession]);

  const handleUpdateAndPersistJob = useCallback(async (updatedJob: JobOrder | null) => {
    startTransition(() => {
      setActiveJobOrder(updatedJob); // Update context immediately for responsive UI
    });
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
  }, [setActiveJobOrder, toast, startTransition]);
  
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
    
    const isResuming = jobToStart.status === 'suspended';

    const jobWithStartTime = {
        ...jobToStart,
        status: 'production' as const,
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
      title: isResuming ? "Lavorazione Ripresa" : "Lavorazione Avviata",
      description: `Lavoro ${isResuming ? 'ripreso' : 'iniziato'} per commessa ${jobToStart.id}.`,
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

    let animationFrameId: number;
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
            
            const detect = async () => {
                if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
                    animationFrameId = requestAnimationFrame(detect);
                    return;
                }
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes.length > 0) {
                    stopCamera();
                    const scannedData = barcodes[0].rawValue;
                    handleScannedData(scannedData);
                } else {
                    animationFrameId = requestAnimationFrame(detect);
                }
            };
            detect();

        } catch (err) {
            console.error("Camera access error:", err);
            setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi del browser.");
            stopCamera();
            setStep('initial');
        }
    };

    startCameraAndScan();
    
    return () => {
        cancelAnimationFrame(animationFrameId);
        stopCamera();
    }
  }, [step, stopCamera, toast, handleScannedData]);

  const handleOpenPhaseScanDialog = (phase: JobPhase) => {
    if (activeJobOrder) {
      const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
      const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phase.id);
      if (phaseToUpdate) {
          phaseToUpdate.workstationScannedAndVerified = false;
      }
      setActiveJobOrder(jobToUpdate);
    }
    setPhaseForPhaseScan(phase);
    setIsPhaseScanDialogOpen(true);
  };

  const handlePhaseScanResult = (scannedId: string) => {
      setIsPhaseScanDialogOpen(false);
      if (!activeJobOrder || !operator || !phaseForPhaseScan) return;

      const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
      const phaseToStart = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForPhaseScan.id);

      if (!phaseToStart || scannedId !== phaseToStart.name) {
        toast({
            variant: "destructive",
            title: "Errore Scansione Fase",
            description: `QR Code non valido. Scansionato: "${scannedId}", Atteso: "${phaseToStart?.name}".`,
            duration: 9000,
        });
        return;
      }
      
      if (jobToUpdate.isProblemReported) {
        toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Un problema è stato segnalato per questa commessa." });
        return;
      }
      
      const phaseType = phaseToStart.type || 'production';

      if (phaseType === 'production' && !phaseToStart.materialReady) {
        toast({ variant: "destructive", title: "Errore Materiale", description: `Questa fase non è ancora pronta. Completare la fase precedente o la preparazione.` });
        return;
      }
      
      const sortedPhasesInJob = [...jobToUpdate.phases].sort((a,b) => a.sequence - b.sequence);
      const currentPhaseIndex = sortedPhasesInJob.findIndex(p => p.id === phaseToStart.id);
      const prevPhaseInJob = sortedPhasesInJob[currentPhaseIndex - 1];
      
      if (phaseType === 'production' || phaseType === 'quality') {
          if (currentPhaseIndex > 0 && (!prevPhaseInJob || prevPhaseInJob.status !== 'completed')) {
             toast({ variant: "destructive", title: "Errore di Sequenza", description: `Completare la fase "${prevPhaseInJob?.name || 'precedente'}" prima di avviare questa.` });
             return;
          }
      }

      if (jobToUpdate.phases.some((p: JobPhase) => p.id !== phaseToStart.id && (p.status === 'in-progress' || p.status === 'paused'))) {
        toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già attiva o in pausa. Completare o riprendere la fase corrente prima di avviarne una nuova." });
        return;
      }
      
      phaseToStart.status = 'in-progress';
      phaseToStart.workstationScannedAndVerified = true;
      phaseToStart.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });

      handleUpdateAndPersistJob(jobToUpdate);
      
      toast({
        title: "Fase Avviata!",
        description: `Fase "${phaseToStart.name}" avviata correttamente.`,
        action: <CheckCircle className="text-green-500" />,
      });
  };

  const handleForceStartPhase = (phaseId: string) => {
    if (!activeJobOrder || !operator || operator.role !== 'superadvisor') {
        toast({ variant: 'destructive', title: 'Permesso Negato', description: "Solo un supervisore può forzare l'avvio di una fase." });
        return;
    }

    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToStart = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (!phaseToStart) {
        toast({ variant: 'destructive', title: 'Errore', description: 'Fase non trovata.' });
        return;
    }

    if (jobToUpdate.isProblemReported) {
        toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Un problema è stato segnalato. Impossibile forzare l'avvio." });
        return;
    }
    
    if (phaseToStart.status !== 'pending') {
        toast({ variant: 'destructive', title: 'Stato non valido', description: 'Si può forzare solo l\'avvio di fasi in attesa.' });
        return;
    }
    
    if (!phaseToStart.materialReady) {
        toast({ variant: "destructive", title: "Errore Materiale", description: `Materiale non pronto per la fase "${phaseToStart.name}".` });
        return;
    }

    if (jobToUpdate.phases.some((p: JobPhase) => p.id !== phaseId && (p.status === 'in-progress' || p.status === 'paused'))) {
        toast({ variant: "destructive", title: "Errore", description: "Un'altra fase è già attiva o in pausa. Completare o riprendere la fase corrente prima di forzarne una nuova." });
        return;
    }

    phaseToStart.status = 'in-progress';
    phaseToStart.workstationScannedAndVerified = true; // Forced start implies verification
    phaseToStart.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });

    handleUpdateAndPersistJob(jobToUpdate);
    
    toast({
        title: "Fase Avviata con Forza!",
        description: `Fase "${phaseToStart.name}" avviata correttamente.`,
        action: <CheckCircle className="text-green-500" />,
    });
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
      if (!activeJobOrder || !operator) return;
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

      const sortedPhasesInJob = [...jobToUpdate.phases].sort((a,b) => a.sequence - b.sequence);
      const currentPhaseIndex = sortedPhasesInJob.findIndex(p => p.id === phaseToComplete.id);
      const nextPhaseInJob = sortedPhasesInJob[currentPhaseIndex + 1];

      if (nextPhaseInJob && nextPhaseInJob.status === 'pending') {
          nextPhaseInJob.materialReady = true;
      }
      
      const relevantSession = activeSessions.find(s => s.materialId === phaseToComplete.materialConsumption?.materialId);

      if (phaseToComplete.type === 'preparation' && relevantSession && (operator.role === 'superadvisor' || operator.reparto === 'MAG')) {
          setJobToFinalize(jobToUpdate);
          setIsContinueOrCloseDialogOpen(true);
          return;
      }
      
      handleUpdateAndPersistJob(jobToUpdate);
      toast({ title: "Fase Completata", description: `Fase "${phaseToComplete.name}" completata.`, action: <PhaseCompletedIcon className="text-green-500"/> });
  };
  
  const handleQualityPhaseResult = (phaseId: string, result: 'passed' | 'failed') => {
    if (!activeJobOrder || !operator) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (!phaseToUpdate || phaseToUpdate.type !== 'quality') return;

    phaseToUpdate.status = 'completed';
    phaseToUpdate.qualityResult = result;

    if (result === 'passed') {
        const sortedPhasesInJob = [...jobToUpdate.phases].sort((a,b) => a.sequence - b.sequence);
        const currentPhaseIndex = sortedPhasesInJob.findIndex(p => p.id === phaseToUpdate.id);
        const nextPhaseInJob = sortedPhasesInJob[currentPhaseIndex + 1];

        if (nextPhaseInJob && nextPhaseInJob.status === 'pending') {
            nextPhaseInJob.materialReady = true;
        }
        toast({ title: "Collaudo Superato", description: `La fase "${phaseToUpdate.name}" è stata approvata.`, action: <CheckCircle className="text-green-500"/> });
    } else {
        jobToUpdate.isProblemReported = true; // Flag the job as having a problem
        toast({ variant: "destructive", title: "Collaudo Fallito", description: `La fase "${phaseToUpdate.name}" non ha superato il controllo. La commessa è bloccata.` });
    }
    
    handleUpdateAndPersistJob(jobToUpdate);
  };


  const handleContinueWithMaterial = () => {
    if (!jobToFinalize) return;
    const phaseThatTriggered = jobToFinalize.phases.find(p => p.status === 'completed' && p.materialConsumption && p.materialConsumption.closingWeight === undefined);
    
    const relevantSession = activeSessions.find(s => s.materialId === phaseThatTriggered?.materialConsumption?.materialId);

    handleUpdateAndPersistJob(jobToFinalize);
    setActiveJobOrder(null); // Clear current job to scan a new one
    toast({ title: "Pronto per la prossima commessa", description: `La sessione con il materiale ${relevantSession?.materialCode} rimane attiva.` });
    setJobToFinalize(null);
    setIsContinueOrCloseDialogOpen(false);
  };

  const handleRequestMaterialClosure = () => {
    if (!jobToFinalize) return;
    handleUpdateAndPersistJob(jobToFinalize);
    toast({ title: "Fase Completata", description: `Ora puoi chiudere la sessione del materiale dalla barra in basso.`});
    setJobToFinalize(null);
    setIsContinueOrCloseDialogOpen(false);
  };

  const handleCompletePreparation = () => {
    if (!activeJobOrder || !operator) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
    const firstProductionPhase = jobToUpdate.phases.find((p: JobPhase) => p.type === 'production');

    if (firstProductionPhase) {
        firstProductionPhase.materialReady = true;
    } else {
        toast({
            variant: "destructive",
            title: "Nessuna Fase di Produzione",
            description: "Impossibile liberare la commessa perché non ci sono fasi di produzione definite."
        });
        return;
    }

    handleUpdateAndPersistJob(jobToUpdate);

    toast({
      title: "Preparazione Completata",
      description: `La commessa ${activeJobOrder.id} è ora disponibile per la produzione.`,
      action: <ThumbsUp className="text-primary" />
    });
    
    // Only exit the job view if you are not a superadvisor
    if (operator.role !== 'superadvisor') {
      setActiveJobOrder(null);
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
    activeSessions.forEach(s => closeSession(s.materialId));
    setPhaseForPhaseScan(null);
    setStep('initial');
  }

  const handleOpenMaterialScanDialog = (phase: JobPhase) => {
    setPhaseForMaterialScan(phase);
    setScannedMaterialForPhase(null);
    setManualMaterialCode('');
    phaseMaterialForm.reset({ openingWeight: undefined, lottoBobina: '' });
    tubiWithdrawalForm.reset({ quantity: undefined });
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
    setIsSearchingMaterial(true);
    const result = await getRawMaterialByCode(trimmedCode);
    setIsSearchingMaterial(false);

    if ('error' in result) {
        toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        setScannedMaterialForPhase(null);
        return;
    }

    if (phaseForMaterialScan?.allowedMaterialTypes && phaseForMaterialScan.allowedMaterialTypes.length > 0 && !phaseForMaterialScan.allowedMaterialTypes.includes(result.type)) {
        toast({
            variant: 'destructive',
            title: "Tipo Materiale Errato",
            description: `Questa fase accetta solo tipi: ${phaseForMaterialScan.allowedMaterialTypes.join(', ')}. Scansionato: ${result.type}.`
        });
        setScannedMaterialForPhase(null);
        return;
    }
    
    setScannedMaterialForPhase(result);
    setMaterialScanStep('form');

  }, [stopCamera, toast, phaseForMaterialScan]);

  const onPhaseMaterialSubmit = (values: PhaseMaterialFormValues) => {
    if (!activeJobOrder || !phaseForMaterialScan || !scannedMaterialForPhase) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));

    try {
        const sessionData = {
            materialId: scannedMaterialForPhase.id,
            materialCode: scannedMaterialForPhase.code,
            openingWeight: values.openingWeight,
            originatorJobId: activeJobOrder.id,
            associatedJobs: [{ jobId: activeJobOrder.id, jobOrderPF: activeJobOrder.ordinePF }],
        };
        startSession(sessionData, scannedMaterialForPhase.type);
        
        const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);

        if (phaseToUpdate) {
            phaseToUpdate.materialConsumption = {
                materialId: sessionData.materialId,
                materialCode: sessionData.materialCode,
                openingWeight: sessionData.openingWeight,
                lottoBobina: values.lottoBobina,
            };
            phaseToUpdate.materialReady = true; 
        }
        
        handleUpdateAndPersistJob(jobToUpdate);
        toast({ title: "Sessione Materiale Avviata", description: `Materiale ${scannedMaterialForPhase.code} associato e fase pronta.` });

    } catch (error) {
        toast({ variant: 'destructive', title: 'Errore Sessione', description: error instanceof Error ? error.message : "Impossibile avviare la sessione." });
    }
    
    setIsMaterialScanDialogOpen(false);
  };
  
  const onTubiWithdrawalSubmit = async (values: TubiWithdrawalFormValues) => {
      if (!activeJobOrder || !phaseForMaterialScan || !scannedMaterialForPhase || !operator) return;

      const formData = new FormData();
      formData.append('materialId', scannedMaterialForPhase.id);
      formData.append('operatorId', operator.id);
      formData.append('jobId', activeJobOrder.id);
      formData.append('jobOrderPF', activeJobOrder.ordinePF);
      formData.append('quantity', String(values.quantity));
      formData.append('unit', values.unit);
      
      const result = await logTubiWithdrawal(formData);

      toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });

      if (result.success) {
          const jobToUpdate = JSON.parse(JSON.stringify(activeJobOrder));
          const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);
          if(phaseToUpdate) {
            phaseToUpdate.materialReady = true;
          }
          handleUpdateAndPersistJob(jobToUpdate);
          setIsMaterialScanDialogOpen(false);
      }
  };

  const handleLottoChange = useCallback(async (lotto: string) => {
    if (lotto && scannedMaterialForPhase) {
      const lastWeight = await findLastWeightForLotto(scannedMaterialForPhase.id, lotto);
      if (lastWeight !== null) {
        phaseMaterialForm.setValue('openingWeight', lastWeight);
        toast({ title: "Peso Precedente Trovato", description: `Il peso di apertura è stato impostato a ${lastWeight} kg.` });
      }
    }
  }, [scannedMaterialForPhase, phaseMaterialForm, toast]);


  const handleLottoScanned = (scannedValue: string) => {
    phaseMaterialForm.setValue('lottoBobina', scannedValue, { shouldDirty: true });
    handleLottoChange(scannedValue);
    toast({ title: "Lotto Scansionato", description: `Lotto: ${scannedValue}` });
    setIsLottoScanDialogOpen(false);
  };

  useEffect(() => {
    if (!isLottoScanDialogOpen) {
      stopCamera();
      return;
    }

    let animationFrameId: number;
    const startCameraAndScan = async () => {
      try {
        if (!('BarcodeDetector' in window)) {
          toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
          setIsLottoScanDialogOpen(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        const video = lottoVideoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });

        const detect = async () => {
            if (!lottoVideoRef.current || lottoVideoRef.current.paused || lottoVideoRef.current.readyState < 2) {
                animationFrameId = requestAnimationFrame(detect);
                return;
            }
            const barcodes = await barcodeDetector.detect(lottoVideoRef.current);
            if (barcodes.length > 0) {
                handleLottoScanned(barcodes[0].rawValue);
            } else {
                animationFrameId = requestAnimationFrame(detect);
            }
        };
        detect();
      } catch (err) {
        toast({ variant: 'destructive', title: 'Errore Fotocamera', description: 'Accesso negato o non disponibile.' });
        stopCamera();
        setIsLottoScanDialogOpen(false);
      }
    };

    startCameraAndScan();
    return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
  }, [isLottoScanDialogOpen, stopCamera, handleLottoScanned, toast]);


  useEffect(() => {
    if (!isPhaseScanDialogOpen) {
      stopCamera();
      return;
    }

    let animationFrameId: number;
    const startCameraAndScan = async () => {
        try {
            if (!('BarcodeDetector' in window)) {
                toast({ variant: 'destructive', title: 'Funzionalità non Supportata', description: 'Il tuo browser non supporta la scansione di QR code.' });
                setIsPhaseScanDialogOpen(false); return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            streamRef.current = stream;
            const video = phaseScanVideoRef.current;
            if (video) {
                video.srcObject = stream;
                await video.play();
            }

            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            
            const detect = async () => {
                if (!phaseScanVideoRef.current || phaseScanVideoRef.current.paused || phaseScanVideoRef.current.readyState < 2) {
                    animationFrameId = requestAnimationFrame(detect);
                    return;
                }
                const barcodes = await barcodeDetector.detect(phaseScanVideoRef.current);
                if (barcodes.length > 0) {
                    handlePhaseScanResult(barcodes[0].rawValue);
                } else {
                    animationFrameId = requestAnimationFrame(detect);
                }
            };
            detect();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Errore Fotocamera', description: 'Accesso negato o non disponibile.' });
            stopCamera();
            setIsPhaseScanDialogOpen(false);
        }
    };
    startCameraAndScan();
    return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
  }, [isPhaseScanDialogOpen, stopCamera, handlePhaseScanResult, toast]);


  useEffect(() => {
    if (!isMaterialScanDialogOpen || materialScanStep !== 'scanning') {
      stopCamera();
      return;
    }

    let animationFrameId: number;
    const startCameraAndScan = async () => {
        try {
            if (!('BarcodeDetector' in window)) {
                toast({ variant: 'destructive', title: 'Funzionalità non Supportata'});
                setMaterialScanStep('initial'); return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            streamRef.current = stream;
            const video = materialVideoRef.current;
            if (video) {
                video.srcObject = stream;
                await video.play();
            }

            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
            
            const detect = async () => {
                 if (!materialVideoRef.current || materialVideoRef.current.paused || materialVideoRef.current.readyState < 2) {
                    animationFrameId = requestAnimationFrame(detect);
                    return;
                }
                const barcodes = await barcodeDetector.detect(materialVideoRef.current);
                if (barcodes.length > 0) {
                    handleMaterialCodeSubmit(barcodes[0].rawValue);
                } else {
                    animationFrameId = requestAnimationFrame(detect);
                }
            };
            detect();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Errore Fotocamera', description: 'Accesso negato o non disponibile.' });
            stopCamera();
            setMaterialScanStep('initial');
        }
    };
    startCameraAndScan();
    return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
  }, [isMaterialScanDialogOpen, materialScanStep, stopCamera, handleMaterialCodeSubmit, toast]);


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
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/3 relative">
                    <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                    <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                    <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                    <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                </div>
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
                  Dettagli Commessa: {job.ordinePF}
                </CardTitle>
                <CardDescription>Reparto: {job.department}</CardDescription>
              </div>
            </div>
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
            <div className="space-y-4">
                <div>
                    <Label htmlFor="ordinePF" className="flex items-center text-sm text-muted-foreground"><ClipboardList className="mr-2 h-4 w-4 text-primary" />Ordine PF</Label>
                    <p id="ordinePF" className="mt-1 p-2 bg-input rounded-md text-foreground font-medium">{job.ordinePF}</p>
                </div>
                <div>
                    <Label htmlFor="ordineNrEst" className="flex items-center text-sm text-muted-foreground"><ClipboardList className="mr-2 h-4 w-4 text-primary" />Ordine Nr Est</Label>
                    <p id="ordineNrEst" className="mt-1 p-2 bg-input rounded-md text-foreground">{job.numeroODL}</p>
                </div>
                <div>
                    <Label htmlFor="numeroODLInterno" className="flex items-center text-sm text-muted-foreground"><ClipboardList className="mr-2 h-4 w-4 text-primary" />N° ODL</Label>
                    <p id="numeroODLInterno" className="mt-1 p-2 bg-input rounded-md text-foreground">{job.numeroODLInterno || 'N/D'}</p>
                </div>
                <div>
                    <Label htmlFor="dataConsegnaFinale" className="flex items-center text-sm text-muted-foreground"><CalendarDays className="mr-2 h-4 w-4 text-primary" />Data Consegna</Label>
                    <p id="dataConsegnaFinale" className="mt-1 p-2 bg-input rounded-md text-foreground">{job.dataConsegnaFinale || 'N/D'}</p>
                </div>
                <div>
                    <Label htmlFor="codiceArticolo" className="flex items-center text-sm text-muted-foreground"><Package className="mr-2 h-4 w-4 text-primary" />Codice Articolo</Label>
                    <p id="codiceArticolo" className="mt-1 p-2 bg-input rounded-md text-foreground">{job.details}</p>
                </div>
                 <div>
                    <Label htmlFor="qta" className="flex items-center text-sm text-muted-foreground"><Package className="mr-2 h-4 w-4 text-primary" />Qta</Label>
                    <p id="qta" className="mt-1 p-2 bg-input rounded-md text-foreground font-bold">{job.qta}</p>
                </div>
            </div>
        </CardContent>
      </Card>
    );
  }

  const renderPhasesManagement = () => {
    if (!activeJobOrder) return null;
    const isJobBlockedByProblem = !!activeJobOrder.isProblemReported;
    
    const preparationPhases = activeJobOrder.phases.filter(p => (p.type ?? 'production') === 'preparation');
    const allPreparationPhasesCompleted = preparationPhases.length > 0 && preparationPhases.every(p => p.status === 'completed');
    
    const productionAndQualityPhases = activeJobOrder.phases.filter(p => p.type === 'production' || p.type === 'quality');
    
    const isMagazzinoOrSuperadvisor = operator?.role === 'superadvisor' || operator?.reparto === 'MAG';

    const firstProductionPhase = activeJobOrder.phases.find(p => p.type === 'production');
    
    const showReleaseButton = allPreparationPhasesCompleted && 
                              firstProductionPhase && 
                              !firstProductionPhase.materialReady &&
                              isMagazzinoOrSuperadvisor;

    const renderPhaseCard = (phase: JobPhase) => {
          const isSuperadvisor = operator?.role === 'superadvisor';
          const operatorHasPermission = isSuperadvisor || (operator && phase.departmentCodes && phase.departmentCodes.includes(operator.reparto));

          const phaseType = phase.type || 'production';
          
          const sortedPhasesInJob = [...activeJobOrder.phases].sort((a,b) => a.sequence - b.sequence);
          const currentPhaseIndex = sortedPhasesInJob.findIndex(p => p.id === phase.id);
          const prevPhaseInJob = sortedPhasesInJob[currentPhaseIndex - 1];
          const isPreviousPhaseCompleted = !prevPhaseInJob || prevPhaseInJob.status === 'completed';

          const noOtherProductionPhaseActiveOrPaused = !activeJobOrder.phases.some(p => p.id !== phase.id && (p.type !== 'preparation') && (p.status === 'in-progress' || p.status === 'paused'));

          const canPerformAction = operatorHasPermission && !isJobBlockedByProblem && phase.status === 'pending' && phase.materialReady && isPreviousPhaseCompleted && noOtherProductionPhaseActiveOrPaused;
          
          const canScanMaterial = operatorHasPermission && phase.requiresMaterialScan && !phase.materialReady;

          const canStartWithScan = canPerformAction && phaseType !== 'quality';
          
          const canPerformQualityCheck = canPerformAction && phaseType === 'quality';

          const canForceStart = isSuperadvisor && !isJobBlockedByProblem && phase.materialReady && phase.status === 'pending' && !isPreviousPhaseCompleted;

          const canPausePhase = operatorHasPermission && !isJobBlockedByProblem && phase.status === 'in-progress';
          const canResumePhase = operatorHasPermission && !isJobBlockedByProblem && phase.status === 'paused' && (phaseType === 'preparation' || !activeJobOrder.phases.some(p => p.id !== phase.id && p.status === 'in-progress'));
          const canCompletePhase = operatorHasPermission && phaseType !== 'quality' && (phase.status === 'in-progress' || phase.status === 'paused');

          let phaseIcon = <PhasePendingIcon className="mr-2 h-5 w-5 text-muted-foreground" />;
          if (phase.status === 'in-progress') phaseIcon = <Hourglass className="mr-2 h-5 w-5 text-yellow-500 animate-spin" />;
          if (phase.status === 'paused') phaseIcon = <PausePhaseIcon className="mr-2 h-5 w-5 text-orange-500" />;
          if (phase.status === 'completed') {
            phaseIcon = <PhaseCompletedIcon className="mr-2 h-5 w-5 text-green-500" />;
            if (phase.qualityResult === 'failed') {
               phaseIcon = <ThumbsDown className="mr-2 h-5 w-5 text-destructive" />;
            }
          }
          
          const workPeriodsForPhase = phase.workPeriods || [];
          const lastWorkPeriod = workPeriodsForPhase.length > 0 ? workPeriodsForPhase[workPeriodsForPhase.length - 1] : null;

          return (
            <Card key={phase.id} className={`p-4 bg-card/50 ${isJobBlockedByProblem && phase.status !== 'completed' ? 'opacity-70' : ''} ${!operatorHasPermission && 'opacity-60 bg-muted/30'}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center">
                  {phaseIcon}
                  <span className={`font-semibold ${!operatorHasPermission && 'text-muted-foreground'}`}>{phase.name} (Seq: {phase.sequence})</span>
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
              
              {!operatorHasPermission && (
                <p className="text-xs text-amber-600 dark:text-amber-500 font-semibold mt-2">
                    Fase non di competenza del tuo reparto.
                </p>
              )}

              {phase.qualityResult && (
                  <div className="mt-2">
                      <Badge variant={phase.qualityResult === 'passed' ? 'default' : 'destructive'}>
                          Esito: {phase.qualityResult === 'passed' ? 'Superato' : 'Fallito'}
                      </Badge>
                  </div>
              )}

              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {phase.materialConsumption && (
                    <p className="font-semibold text-primary">
                        Materiale: {phase.materialConsumption.materialCode} 
                        (Aperto: {phase.materialConsumption.openingWeight} kg) 
                        {phase.materialConsumption.closingWeight !== undefined ? ` (Chiuso: ${phase.materialConsumption.closingWeight} kg)`: ''}
                        {phase.materialConsumption.lottoBobina && ` - Lotto: ${phase.materialConsumption.lottoBobina}`}
                    </p>
                )}
                {lastWorkPeriod?.start && (
                  <p>Ultimo avvio: {format(new Date(lastWorkPeriod.start), "dd/MM/yyyy HH:mm:ss")}</p>
                )}
                {phase.status === 'paused' && lastWorkPeriod?.end && (
                  <p>Messa in pausa il: {format(new Date(lastWorkPeriod.end), "dd/MM/yyyy HH:mm:ss")}</p>
                )}
                 {phase.type !== 'quality' && <p>Tempo di lavorazione effettivo: {calculateTotalActiveTime(workPeriodsForPhase)}</p>}
              </div>
              
              <div className="mt-3 flex flex-wrap gap-2">
                {canScanMaterial && (
                    <Button size="sm" onClick={() => handleOpenMaterialScanDialog(phase)} variant="default" disabled={isJobBlockedByProblem || isPending || !operatorHasPermission}>
                        <Boxes className="mr-2 h-4 w-4" /> Scansiona Materiale
                    </Button>
                )}
                 {canStartWithScan && (
                     <Button size="sm" onClick={() => handleOpenPhaseScanDialog(phase)} variant="outline" className="border-primary text-primary hover:bg-primary/10" disabled={isJobBlockedByProblem || isPending || !operatorHasPermission}>
                        <QrCode className="mr-2 h-4 w-4" /> Scansiona Fase per Avviare
                    </Button>
                )}
                 {canPerformQualityCheck && (
                    <div className="flex gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleQualityPhaseResult(phase.id, 'passed')}>
                            <ThumbsUp className="h-4 w-4" /> <span className="sr-only">OK</span>
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleQualityPhaseResult(phase.id, 'failed')}>
                            <ThumbsDown className="h-4 w-4" /> <span className="sr-only">NON OK</span>
                        </Button>
                         <Button size="sm" variant="outline" className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500" onClick={() => setIsProblemReportDialogOpen(true)}>
                            <AlertTriangle className="h-4 w-4" /> <span className="sr-only">PROBLEMA</span>
                        </Button>
                    </div>
                )}
                {canForceStart && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" disabled={isJobBlockedByProblem || isPending || !operatorHasPermission}>
                                <AlertTriangle className="mr-2 h-4 w-4" /> Forza Avvio Fase
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Sei sicuro di forzare l'avvio?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Questa azione avvierà la fase "{phase.name}" senza rispettare la sequenza prevista. Usare con cautela.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleForceStartPhase(phase.id)}>
                                    Sì, forza avvio
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
                {canPausePhase && (
                  <Button size="sm" onClick={() => handlePausePhase(phase.id)} variant="outline" className="text-orange-500 border-orange-500 hover:bg-orange-500/10 hover:text-orange-500" disabled={isJobBlockedByProblem || isPending || !operatorHasPermission}>
                    <PausePhaseIcon className="mr-2 h-4 w-4" /> Metti in Pausa
                  </Button>
                )}
                 {canResumePhase && (
                  <Button size="sm" onClick={() => handleResumePhase(phase.id)} variant="outline" className="text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500" disabled={isJobBlockedByProblem || isPending || !operatorHasPermission}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Riprendi Fase
                  </Button>
                )}
                {canCompletePhase && (
                  <Button size="sm" onClick={() => handleCompletePhase(phase.id)} className="bg-green-600 hover:bg-green-700 text-primary-foreground" disabled={(isJobBlockedByProblem && phase.status !== 'completed') || isPending || !operatorHasPermission}>
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
        <CardDescription>Gestisci l'avanzamento delle fasi.</CardDescription>
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
        
        {showReleaseButton && (
            <div className="pt-4">
                <Button onClick={handleCompletePreparation} className="w-full" size="lg">
                    <ThumbsUp className="mr-2 h-5 w-5" />
                    Completa Preparazione e Libera Commessa
                </Button>
            </div>
        )}
        
        {productionAndQualityPhases.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-4">
              <span className="text-sm font-semibold text-muted-foreground">Fasi Produzione e Qualità</span>
              <Separator className="flex-1" />
            </div>
             <div className="space-y-4">
                {productionAndQualityPhases.sort((a,b) => a.sequence - b.sequence).map(renderPhaseCard)}
            </div>
          </>
        )}


        {allPhasesCompleted && !activeJobOrder?.overallEndTime && (
          <Button 
            onClick={handleConcludeOverallJob} 
            className="w-full mt-4 bg-primary text-primary-foreground"
            disabled={isJobBlockedByProblem || isPending}
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
                    <Button onClick={() => setMaterialScanStep('scanning')} className="w-full"><QrCode className="mr-2 h-4 w-4" /> Scansiona QR/Barcode</Button>
                    <Button onClick={() => setMaterialScanStep('manual_input')} variant="outline" className="w-full"><Keyboard className="mr-2 h-4 w-4" /> Inserisci Manualmente</Button>
                </div>
            )}

            {materialScanStep === 'scanning' && (
              <div className="py-4">
                <div className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                  <video ref={materialVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-5/6 h-2/5 relative flex items-center justify-center">
                          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                          <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                      </div>
                  </div>
                </div>
                  <Button variant="outline" className="w-full mt-4" onClick={() => setMaterialScanStep('initial')}>Annulla Scansione</Button>
              </div>
            )}

             {materialScanStep === 'manual_input' && (
                <div className="space-y-4 py-4">
                    <Label htmlFor="manualMaterialCode">Codice Materia Prima</Label>
                    <div className="flex items-center gap-2">
                        <Input id="manualMaterialCode" value={manualMaterialCode} onChange={(e) => setManualMaterialCode(e.target.value)} placeholder="Es. BOB-123" autoFocus autoComplete="off" />
                        <Button onClick={() => handleMaterialCodeSubmit(manualMaterialCode)} disabled={!manualMaterialCode || isSearchingMaterial}>
                            {isSearchingMaterial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            <span className="sr-only">Cerca</span>
                        </Button>
                    </div>
                     <Button variant="ghost" onClick={() => setMaterialScanStep('initial')}>Indietro</Button>
                </div>
            )}

            {materialScanStep === 'form' && scannedMaterialForPhase && (
                scannedMaterialForPhase.type === 'TUBI' ? (
                     <Form {...tubiWithdrawalForm}>
                        <form onSubmit={tubiWithdrawalForm.handleSubmit(onTubiWithdrawalSubmit)} className="space-y-4">
                            <Card>
                                <CardHeader><CardTitle className="text-lg">{scannedMaterialForPhase.code}</CardTitle><CardDescription>{scannedMaterialForPhase.description}</CardDescription></CardHeader>
                            </Card>
                            <FormField control={tubiWithdrawalForm.control} name="unit" render={({ field }) => (
                                <FormItem className="space-y-3"><FormLabel>Prelievo per unità o peso?</FormLabel>
                                <FormControl>
                                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="n" /></FormControl><FormLabel className="font-normal">N° Pezzi</FormLabel></FormItem>
                                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="kg" /></FormControl><FormLabel className="font-normal">KG</FormLabel></FormItem>
                                    </RadioGroup>
                                </FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={tubiWithdrawalForm.control} name="quantity" render={({ field }) => (
                                <FormItem><FormLabel>Quantità da Prelevare</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <DialogFooter><Button type="submit" disabled={tubiWithdrawalForm.formState.isSubmitting}><Send className="mr-2 h-4 w-4" />Registra Prelievo</Button></DialogFooter>
                        </form>
                    </Form>
                ) : (
                    <Form {...phaseMaterialForm}>
                        <form onSubmit={phaseMaterialForm.handleSubmit(onPhaseMaterialSubmit)} className="space-y-4">
                            <Card><CardHeader><CardTitle className="text-lg">{scannedMaterialForPhase.code}</CardTitle><CardDescription>{scannedMaterialForPhase.description}</CardDescription></CardHeader></Card>
                            <FormField control={phaseMaterialForm.control} name="openingWeight" render={({ field }) => (
                                <FormItem><FormLabel>KG di Apertura</FormLabel><FormControl><Input type="number" step="0.01" placeholder="Es. 10.5" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                            )} />
                            {scannedMaterialForPhase.type === 'BOB' && (
                                <FormField control={phaseMaterialForm.control} name="lottoBobina" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="flex items-center"><Barcode className="mr-2 h-4 w-4" /> Numero Lotto Bobina (Opzionale)</FormLabel>
                                        <div className="flex gap-2">
                                            <FormControl><Input placeholder="Scansiona o inserisci lotto" {...field} onChange={(e) => {field.onChange(e); handleLottoChange(e.target.value);}} /></FormControl>
                                            <Button type="button" variant="outline" size="icon" onClick={() => setIsLottoScanDialogOpen(true)}><QrCode className="h-4 w-4" /><span className="sr-only">Scansiona lotto</span></Button>
                                        </div><FormMessage />
                                    </FormItem>
                                )} />
                            )}
                            <DialogFooter><Button type="submit"><Send className="mr-2 h-4 w-4" />Avvia Sessione Materiale</Button></DialogFooter>
                        </form>
                    </Form>
                )
            )}
            
        </DialogContent>
    </Dialog>
  )
  
  const renderLottoScanDialog = () => (
    <Dialog open={isLottoScanDialogOpen} onOpenChange={setIsLottoScanDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Inquadra il QR/Barcode del Lotto</DialogTitle>
            </DialogHeader>
            <div className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                <video ref={lottoVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-5/6 h-2/5 relative flex items-center justify-center">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                        <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsLottoScanDialogOpen(false)}>Annulla</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );

  const renderPhaseScanDialog = () => (
    <Dialog open={isPhaseScanDialogOpen} onOpenChange={setIsPhaseScanDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Scansiona QR Code Fase</DialogTitle>
                <DialogDescription>Inquadra il QR Code con il nome della fase "{phaseForPhaseScan?.name}" per avviarla.</DialogDescription>
            </DialogHeader>
            <div className="relative flex items-center justify-center aspect-square bg-black rounded-lg overflow-hidden">
                <video ref={phaseScanVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-2/3 h-2/3 relative">
                        <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                        <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                        <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                        <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsPhaseScanDialogOpen(false)}>Annulla</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );

  const renderContinueOrCloseDialog = () => {
    if (!jobToFinalize) return null;
    const phaseThatTriggered = jobToFinalize.phases.find(p => p.status === 'completed' && p.materialConsumption && p.materialConsumption.closingWeight === undefined);
    
    const relevantSession = activeSessions.find(s => s.materialId === phaseThatTriggered?.materialConsumption?.materialId);


    return (
        <AlertDialog open={isContinueOrCloseDialogOpen} onOpenChange={setIsContinueOrCloseDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>Lavorazione per questa commessa completata</AlertDialogTitle>
            <AlertDialogDescription>
                Vuoi continuare a lavorare con il materiale <span className="font-bold">{relevantSession?.materialCode}</span> su un'altra commessa, oppure hai terminato e vuoi registrare la chiusura finale del materiale?
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction onClick={handleContinueWithMaterial}>
                Lavora su altra Commessa
            </AlertDialogAction>
            <AlertDialogAction onClick={handleRequestMaterialClosure} className="bg-destructive hover:bg-destructive/90">
                Registra Chiusura Materiale
            </AlertDialogAction>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
        </AlertDialog>
    );
  };


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <OperatorNavMenu />
          
            <Dialog open={isProblemReportDialogOpen} onOpenChange={setIsProblemReportDialogOpen}>
                {step === 'initial' && renderScanArea()}
                {step === 'scanning' && renderScanArea()}

                {step === 'processing' && activeJobOrder && (
                  <>
                    {renderJobDetailsCard(activeJobOrder)}
                    {renderPhasesManagement()}
                  </>
                )}

                {step === 'finished' && activeJobOrder && renderFinishedView()}
            
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Segnala Problema per Commessa: {activeJobOrder?.id}</DialogTitle>
                    </DialogHeader>
                    <ProblemReportForm 
                        onSuccess={handleJobProblemReported} 
                        onCancel={() => setIsProblemReportDialogOpen(false)}
                        showTitle={false} 
                    />
                </DialogContent>
            </Dialog>
          
          {renderMaterialScanDialog()}
          {renderLottoScanDialog()}
          {renderPhaseScanDialog()}
          {renderContinueOrCloseDialog()}

        </div>
      </AppShell>
    </AuthGuard>
  );
}







