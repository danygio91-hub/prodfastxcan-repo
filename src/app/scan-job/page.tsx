

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
import { QrCode, CheckCircle, AlertTriangle, Package, CalendarDays, ClipboardList, Computer, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle as PhasePendingIcon, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert, Loader2, Boxes, Keyboard, Send, LogOut, Barcode, Weight, ThumbsUp, ThumbsDown, UserCheck, ScanLine, Plus, Copy, PlusCircle as PlusCircleIcon, Unlock, Camera, Search, MessageSquare } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import type { JobOrder, JobPhase, WorkPeriod, RawMaterial, RawMaterialType, MaterialConsumption } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob, logTubiGuainaWithdrawal, findLastWeightForLotto, resolveJobProblem, getJobOrderById, searchRawMaterials, handlePhaseScanResult } from './actions';
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

const tubiGuainaWithdrawalSchema = z.object({
  quantity: z.coerce.number().positive("La quantità deve essere positiva."),
  unit: z.enum(['n', 'kg', 'mt'], { required_error: "Selezionare l'unità di misura." }),
});
type TubiGuainaWithdrawalFormValues = z.infer<typeof tubiGuainaWithdrawalSchema>;


const closingWeightSchema = z.object({
  closingWeight: z.coerce.number().min(0, "Il peso di chiusura non può essere negativo."),
});
type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

type SearchResult = Pick<RawMaterial, 'id' | 'code' | 'description' | 'type' | 'unitOfMeasure' | 'currentStockUnits' | 'currentWeightKg'>;

const problemReportSchema = z.object({
  problemType: z.enum(["FERMO_MACCHINA", "MANCA_MATERIALE", "PROBLEMA_QUALITA", "ALTRO"], {
    required_error: "È necessario selezionare un tipo di problema.",
  }),
  notes: z.string().max(150, { message: "Le note non possono superare i 150 caratteri." }).optional(),
});
type ProblemReportFormValues = z.infer<typeof problemReportSchema>;


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
  const { activeJob, setActiveJob, setActiveJobId, isLoading: isJobLoading } = useActiveJob();
  const { activeSessions, startSession, addJobToSession, closeSession, getSessionByMaterialId } = useActiveMaterialSession();
  const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'processing' | 'finished' | 'loading'>('loading');
  const [isPending, startTransition] = useTransition();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  
  const [isProblemReportDialogOpen, setIsProblemReportDialogOpen] = useState(false);
  const [isQualityProblemDialogOpen, setIsQualityProblemDialogOpen] = useState(false);
  const [phaseForQualityProblem, setPhaseForQualityProblem] = useState<JobPhase | null>(null);
  
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);

  const [isMaterialScanDialogOpen, setIsMaterialScanDialogOpen] = useState(false);
  const [isLottoScanDialogOpen, setIsLottoScanDialogOpen] = useState(false);
  const [phaseForMaterialScan, setPhaseForMaterialScan] = useState<JobPhase | null>(null);
  const [materialScanStep, setMaterialScanStep] = useState<'initial' | 'scanning' | 'manual_input' | 'search_input' | 'form'>('initial');
  const [scannedMaterialForPhase, setScannedMaterialForPhase] = useState<SearchResult | null>(null);
  const [manualMaterialCode, setManualMaterialCode] = useState('');
  const [isSearchingMaterial, setIsSearchingMaterial] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchDebounceTimeout = useRef<NodeJS.Timeout | null>(null);


  const [isContinueOrCloseDialogOpen, setIsContinueOrCloseDialogOpen] = useState(false);
  const [jobToFinalize, setJobToFinalize] = useState<JobOrder | null>(null);

  const [sessionConflict, setSessionConflict] = useState<{ material: SearchResult; existingSession: boolean } | null>(null);

  // Simulator State
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulatorInput, setSimulatorInput] = useState('');
  const [simulatorTarget, setSimulatorTarget] = useState<'job' | 'material' | 'lotto' | 'phase' | null>(null);

  const phaseMaterialForm = useForm<PhaseMaterialFormValues>({
    resolver: zodResolver(phaseMaterialSchema),
    defaultValues: { openingWeight: undefined, lottoBobina: '' },
  });
  
  const tubiGuainaWithdrawalForm = useForm<TubiGuainaWithdrawalFormValues>({
    resolver: zodResolver(tubiGuainaWithdrawalSchema),
    defaultValues: { quantity: undefined, unit: 'mt' },
  });

  const closingWeightForm = useForm<ClosingWeightFormValues>({
    resolver: zodResolver(closingWeightSchema),
    defaultValues: { closingWeight: 0 },
  });

  const problemForm = useForm<ProblemReportFormValues>({
    resolver: zodResolver(problemReportSchema),
  });

  const forceJobDataRefresh = useCallback(async (jobId: string) => {
    const freshJobData = await getJobOrderById(jobId);
    if (freshJobData) {
      setActiveJob(freshJobData);
    }
  }, [setActiveJob]);
  
  useEffect(() => {
    if (activeJob) {
      forceJobDataRefresh(activeJob.id);
    }
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isJobLoading) {
      if (activeJob) {
        if (activeJob.status === 'completed') {
          setStep('finished');
        } else {
          if (activeSessions.length > 0 && !activeSessions.every(s => s.associatedJobs.some(j => j.jobId === activeJob.id))) {
              activeSessions.forEach(s => addJobToSession(s.materialId, { jobId: activeJob.id, jobOrderPF: activeJob.ordinePF }));
          }
          setStep('processing');
        }
      } else {
        setStep('initial');
      }
    } else {
      setStep('loading');
    }
  }, [isJobLoading, activeJob, activeSessions, addJobToSession]);

  const handleUpdateAndPersistJob = useCallback(async (updatedJob: JobOrder) => {
    // Calling updateJob will save to Firestore.
    // The real-time listener in ActiveJobProvider will then automatically update the state.
    await updateJob(updatedJob);
  }, []);
  
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
  }, []);

  const handleStartOverallJob = useCallback((jobToStart: JobOrder) => {
    if (!jobToStart || !operator) return;
     if (jobToStart.isProblemReported && operator.role !== 'superadvisor' && operator.role !== 'admin') {
      toast({
        variant: "destructive",
        title: "Lavorazione Bloccata",
        description: "Un problema è stato segnalato per questa commessa. Solo un supervisore o admin può procedere.",
      });
      setStep('initial');
      return;
    }
    
    const isResuming = jobToStart.status === 'suspended';

    const jobWithStartTime = {
        ...jobToStart,
        status: 'production' as const,
        overallStartTime: jobToStart.overallStartTime || new Date(),
        phases: (jobToStart.phases || []).map(p => ({
            ...p,
            workPeriods: p.workPeriods || [], 
            materialConsumptions: p.materialConsumptions || [],
            workstationScannedAndVerified: p.workstationScannedAndVerified || false,
        }))
    };
    
    handleUpdateAndPersistJob(jobWithStartTime);
    
    // Set the active job ID, which triggers the real-time listener
    setActiveJobId(jobWithStartTime.id); 
    
    toast({
      title: isResuming ? "Lavorazione Ripresa" : "Lavorazione Avviata",
      description: `Lavoro ${isResuming ? 'ripreso' : 'iniziato'} per commessa ${jobToStart.id}.`,
      action: <PlayCircle className="text-primary" />,
    });
  }, [handleUpdateAndPersistJob, toast, setActiveJobId, operator]);


  const handleScannedData = useCallback(async (data: string) => {
    stopCamera();
    setStep('initial');
    const parts = data.split('@');
    if (parts.length !== 3) {
        toast({ variant: 'destructive', title: 'QR Code non Valido', description: 'Formato del QR code non corretto. Atteso: "Ordine PF@Codice@Qta"' });
        return;
    }
    const [ordinePF, codice, qta] = parts;
    if (!ordinePF || !codice || !qta) {
        toast({ variant: 'destructive', title: 'QR Code Incompleto', description: 'Dati mancanti nel QR Code.' });
        return;
    }

    toast({ title: "QR Code Rilevato", description: "Verifica commessa in corso..." });
    const result = await verifyAndGetJobOrder({ ordinePF, codice, qta });

    if ('error' in result) {
        toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
    } else {
        toast({ title: "Commessa Verificata!", description: `Pronto per iniziare la lavorazione per ${result.id}.`, action: <CheckCircle className="text-green-500"/> });
        handleStartOverallJob(result);
    }
  }, [toast, handleStartOverallJob, stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(e => console.error("Video play failed:", e));
        }
    } catch (err) {
        console.error("Camera access error:", err);
        setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi del browser.");
        stopCamera();
    }
  }, [stopCamera]);
  
  const triggerScan = useCallback(async (onScan: (data: string) => void) => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
          toast({ variant: 'destructive', title: 'Fotocamera non Pronta' });
          return;
      }
      if (!('BarcodeDetector' in window)) {
          toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
          return;
      }

      setIsCapturing(true);
      try {
          const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes.length > 0) {
              onScan(barcodes[0].rawValue);
          } else {
              toast({ variant: 'destructive', title: 'Nessun Codice Trovato' });
          }
      } catch (error) {
          toast({ variant: 'destructive', title: 'Errore di Scansione' });
      } finally {
          setIsCapturing(false);
      }
  }, [toast]);
  

  useEffect(() => {
    const shouldStartCamera =
      step === 'scanning' ||
      isLottoScanDialogOpen ||
      isPhaseScanDialogOpen ||
      (isMaterialScanDialogOpen && materialScanStep === 'scanning');

    if (shouldStartCamera) {
      startCamera();
    } else {
      stopCamera();
    }
    // This is the cleanup function that will be called when the component unmounts or dependencies change
    return () => stopCamera();
  }, [step, isLottoScanDialogOpen, isPhaseScanDialogOpen, isMaterialScanDialogOpen, materialScanStep, startCamera, stopCamera]);


  const handleOpenPhaseScanDialog = (phase: JobPhase) => {
    setPhaseForPhaseScan(phase);
    setIsPhaseScanDialogOpen(true);
  };

  const handleLocalPhaseScanResult = async (scannedId: string) => {
      setIsPhaseScanDialogOpen(false);
      stopCamera();

      if (!activeJob || !operator || !phaseForPhaseScan) return;
      
      const result = await handlePhaseScanResult(activeJob.id, phaseForPhaseScan.id, operator.id);
      
      if (result.success) {
          toast({
            title: "Fase Avviata!",
            description: `Fase "${phaseForPhaseScan.name}" avviata con successo.`,
            action: <CheckCircle className="text-green-500" />,
          });
      } else {
           toast({
            variant: "destructive",
            title: "Errore Avvio Fase",
            description: result.message,
          });
      }
  };

  const handleForceStartPhase = (phaseId: string) => {
    if (!activeJob || !operator || operator.role !== 'superadvisor') {
        toast({ variant: 'destructive', title: 'Permesso Negato', description: "Solo un supervisore può forzare l'avvio di una fase." });
        return;
    }

    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
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
    if (!activeJob) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
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
    if (!activeJob || !operator) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToResume = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (jobToUpdate.isProblemReported) {
      toast({ variant: "destructive", title: "Lavorazione Bloccata", description: "Impossibile riprendere, problema segnalato." });
      return;
    }
    if (!phaseToResume || phaseToResume.status !== 'paused') {
      toast({ variant: "destructive", title: "Errore", description: "La fase non è in pausa." });
      return;
    }
    
    const activeProductionPhase = jobToUpdate.phases.find((p: JobPhase) => p.status === 'in-progress');
    if (activeProductionPhase) {
      toast({ variant: "destructive", title: "Un'altra fase è già attiva", description: `Completare o mettere in pausa "${activeProductionPhase.name}" prima di riprenderne un'altra.`});
      return;
    }

    phaseToResume.status = 'in-progress';
    phaseToResume.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
    
    handleUpdateAndPersistJob(jobToUpdate);
    toast({ title: "Fase Ripresa", description: `Fase "${phaseToResume.name}" ripresa.` });
  };

  const handleCompletePhase = (phaseId: string) => {
    if (!activeJob || !operator) return;
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
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
    
    const sortedPhases = [...jobToUpdate.phases].sort((a: JobPhase, b: JobPhase) => a.sequence - b.sequence);
    const currentPhaseIndex = sortedPhases.findIndex((p: JobPhase) => p.id === phaseToComplete.id);
    const nextPhase = sortedPhases[currentPhaseIndex + 1];

    if (nextPhase && nextPhase.status === 'pending') {
      const allPreviousPhasesCompleted = sortedPhases.slice(0, currentPhaseIndex + 1).every(p => p.status === 'completed');
      if (allPreviousPhasesCompleted) {
        nextPhase.materialReady = true;
      }
    }
    
    const relevantSession = activeSessions.find(s => phaseToComplete.materialConsumptions.some(mc => mc.materialId === s.materialId && mc.closingWeight === undefined));

    if (phaseToComplete.type === 'preparation' && relevantSession && (operator.role === 'superadvisor' || (Array.isArray(operator?.reparto) && operator.reparto.includes('MAG')))) {
        setJobToFinalize(jobToUpdate);
        setIsContinueOrCloseDialogOpen(true);
        return;
    }

    handleUpdateAndPersistJob(jobToUpdate);
    toast({ title: "Fase Completata", description: `Fase "${phaseToComplete.name}" completata.`, action: <PhaseCompletedIcon className="text-green-500"/> });
  };
  
  const handleQualityPhaseResult = (phaseId: string, result: 'passed' | 'failed', notes?: string) => {
    if (!activeJob || !operator) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseId);

    if (!phaseToUpdate || phaseToUpdate.type !== 'quality') return;

    phaseToUpdate.status = 'completed';
    phaseToUpdate.qualityResult = result;

    if (result === 'passed') {
        const sortedPhasesInJob = [...jobToUpdate.phases].sort((a,b) => a.sequence - b.sequence);
        const currentPhaseIndex = sortedPhasesInJob.findIndex(p => p.id === phaseToUpdate.id);
        const nextPhaseInJob = sortedPhasesInJob[currentPhaseIndex + 1];

        if (nextPhaseInJob && nextPhaseInJob.status === 'pending') {
            const allPreviousPhasesCompleted = sortedPhasesInJob.slice(0, currentPhaseIndex + 1).every(p => p.status === 'completed');
            if (allPreviousPhasesCompleted) {
                nextPhaseInJob.materialReady = true;
            }
        }
        toast({ title: "Collaudo Superato", description: `La fase "${phaseToUpdate.name}" è stata approvata.`, action: <CheckCircle className="text-green-500"/> });
    } else {
        jobToUpdate.isProblemReported = true;
        jobToUpdate.problemType = 'PROBLEMA_QUALITA';
        jobToUpdate.problemNotes = notes || 'Esito collaudo negativo.';
        jobToUpdate.problemReportedBy = operator.nome;
        toast({ variant: "destructive", title: "Collaudo Fallito", description: `La fase "${phaseToUpdate.name}" non ha superato il controllo. La commessa è bloccata.` });
    }
    
    handleUpdateAndPersistJob(jobToUpdate);
  };


  const handleContinueWithMaterial = () => {
    if (!jobToFinalize) return;
    
    handleUpdateAndPersistJob(jobToFinalize);
    setActiveJobId(null); // Clear current job to scan a new one
    
    const phaseThatTriggered = jobToFinalize.phases.find(p => p.status === 'completed' && p.materialConsumptions.some(mc => mc.closingWeight === undefined));
    const relevantSession = activeSessions.find(s => phaseThatTriggered?.materialConsumptions.some(mc => mc.materialId === s.materialId));
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
    if (!activeJob || !operator) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    const sortedPhases = [...jobToUpdate.phases].sort((a: JobPhase, b: JobPhase) => a.sequence - b.sequence);
    
    const firstProductionPhase = sortedPhases.find((p: JobPhase) => p.type === 'production');

    if (firstProductionPhase && firstProductionPhase.status === 'pending') {
        const allPrepCompleted = jobToUpdate.phases
            .filter((p: JobPhase) => p.type === 'preparation')
            .every((p: JobPhase) => p.status === 'completed');

        if (allPrepCompleted) {
             firstProductionPhase.materialReady = true;
        } else {
            toast({
                variant: "destructive",
                title: "Preparazione non completa",
                description: "Tutte le fasi di preparazione devono essere completate prima di liberare la commessa."
            });
            return;
        }
    } else {
        toast({
            variant: "destructive",
            title: "Nessuna Fase di Produzione Pronta",
            description: "Impossibile liberare la commessa perché non ci sono fasi di produzione in attesa o definite."
        });
        return;
    }

    handleUpdateAndPersistJob(jobToUpdate);

    toast({
      title: "Preparazione Completata",
      description: `La commessa ${activeJob.id} è ora disponibile per la produzione.`,
      action: <ThumbsUp className="text-primary" />
    });
    
    if (operator.role !== 'superadvisor') {
      setActiveJobId(null);
    }
  };

  const handleConcludeOverallJob = () => {
    if (!activeJob) return;
    if (activeJob.isProblemReported) {
      toast({
        variant: "destructive",
        title: "Lavorazione Bloccata",
        description: "Impossibile concludere la commessa, problema segnalato.",
      });
      return;
    }
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
    jobToUpdate.overallEndTime = new Date();
    jobToUpdate.status = 'completed';

    handleUpdateAndPersistJob(jobToUpdate);
    toast({
      title: "Commessa Conclusa",
      description: `Lavorazione per commessa ${jobToUpdate.id} terminata con successo.`,
      action: <PowerOff className="text-primary" />
    });
  };

  const allPhasesCompleted = activeJob?.phases.every(phase => phase.status === 'completed');

  const onProblemSubmit = (values: ProblemReportFormValues) => {
    if (activeJob && operator) {
      const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
      jobToUpdate.isProblemReported = true;
      jobToUpdate.problemType = values.problemType;
      jobToUpdate.problemNotes = values.notes;
      jobToUpdate.problemReportedBy = operator.nome;
      
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
        description: `La commessa ${activeJob.id} è stata contrassegnata con un problema.`,
      });
    }
    setIsProblemReportDialogOpen(false);
  };
  
  const handleResolveProblem = async () => {
    if (!activeJob || !operator) return;
    const result = await resolveJobProblem(activeJob.id, operator.uid);
    toast({
        title: result.success ? "Problema Risolto" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    // The real-time listener will automatically update the job state.
  };

  const resetForNewScan = () => {
    setActiveJobId(null);
    activeSessions.forEach(s => closeSession(s.materialId));
    setPhaseForPhaseScan(null);
    setStep('initial');
  }

  const handleOpenMaterialScanDialog = (phase: JobPhase) => {
    setPhaseForMaterialScan(phase);
    setScannedMaterialForPhase(null);
    setManualMaterialCode('');
    phaseMaterialForm.reset({ openingWeight: undefined, lottoBobina: '' });
    tubiGuainaWithdrawalForm.reset({ quantity: undefined, unit: 'mt' });
    
    if (phase.requiresMaterialSearch) {
        setMaterialScanStep('search_input');
    } else {
        setMaterialScanStep('initial');
    }
    
    setIsMaterialScanDialogOpen(true);
  };
  
  const handleSearchTermChange = (term: string) => {
    setManualMaterialCode(term);
    if (searchDebounceTimeout.current) {
      clearTimeout(searchDebounceTimeout.current);
    }
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    searchDebounceTimeout.current = setTimeout(async () => {
      setIsSearchingMaterial(true);
      const results = await searchRawMaterials(term, phaseForMaterialScan?.allowedMaterialTypes);
      setSearchResults(results);
      setIsSearchingMaterial(false);
    }, 300);
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
    
    // --- NEW LOGIC: Check for existing session ---
    const existingSession = getSessionByMaterialId(result.id);
    if (existingSession) {
        setSessionConflict({ material: result, existingSession: true });
        setIsMaterialScanDialogOpen(false); // Close the scan dialog to show the conflict dialog
        return;
    }
    // --- END NEW LOGIC ---

    setScannedMaterialForPhase(result);
    setMaterialScanStep('form');

  }, [stopCamera, toast, phaseForMaterialScan, getSessionByMaterialId]);

  const onPhaseMaterialSubmit = (values: PhaseMaterialFormValues) => {
    if (!activeJob || !phaseForMaterialScan || !scannedMaterialForPhase) return;
    
    const jobToUpdate = JSON.parse(JSON.stringify(activeJob));

    try {
        const sessionData = {
            materialId: scannedMaterialForPhase.id,
            materialCode: scannedMaterialForPhase.code,
            openingWeight: values.openingWeight,
            originatorJobId: activeJob.id,
            associatedJobs: [{ jobId: activeJob.id, jobOrderPF: activeJob.ordinePF }],
        };
        startSession(sessionData, scannedMaterialForPhase.type);
        
        const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);

        if (phaseToUpdate) {
            if (!phaseToUpdate.materialConsumptions) {
              phaseToUpdate.materialConsumptions = [];
            }
            phaseToUpdate.materialConsumptions.push({
                materialId: sessionData.materialId,
                materialCode: sessionData.materialCode,
                openingWeight: sessionData.openingWeight,
                lottoBobina: values.lottoBobina,
            });
            phaseToUpdate.materialReady = true; 
        }
        
        handleUpdateAndPersistJob(jobToUpdate);
        toast({ title: "Sessione Materiale Avviata", description: `Materiale ${scannedMaterialForPhase.code} associato e fase pronta.` });

    } catch (error) {
        toast({ variant: 'destructive', title: 'Errore Sessione', description: error instanceof Error ? error.message : "Impossibile avviare la sessione." });
    }
    
    setIsMaterialScanDialogOpen(false);
  };
  
  const onTubiGuainaWithdrawalSubmit = async (values: TubiGuainaWithdrawalFormValues) => {
      if (!activeJob || !phaseForMaterialScan || !scannedMaterialForPhase || !operator) return;

      // Optimistic UI update
      const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
      const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);

      if (phaseToUpdate) {
          phaseToUpdate.materialReady = true;
          const newConsumption: MaterialConsumption = {
              materialId: scannedMaterialForPhase.id,
              materialCode: scannedMaterialForPhase.code,
              pcs: (values.unit === 'n' || values.unit === 'mt') ? values.quantity : undefined,
          };
          if (!phaseToUpdate.materialConsumptions) {
              phaseToUpdate.materialConsumptions = [];
          }
          phaseToUpdate.materialConsumptions.push(newConsumption);
          setActiveJob(jobToUpdate);
      }
      setIsMaterialScanDialogOpen(false);
      
      const formData = new FormData();
      formData.append('materialId', scannedMaterialForPhase.id);
      formData.append('operatorId', operator.id);
      formData.append('jobId', activeJob.id);
      formData.append('jobOrderPF', activeJob.ordinePF);
      formData.append('phaseId', phaseForMaterialScan.id);
      formData.append('quantity', String(values.quantity));
      formData.append('unit', values.unit);
      
      const result = await logTubiGuainaWithdrawal(formData);

      toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });

      // Force a refresh from DB to ensure consistency
      forceJobDataRefresh(activeJob.id);
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
    stopCamera();
    phaseMaterialForm.setValue('lottoBobina', scannedValue, { shouldDirty: true });
    handleLottoChange(scannedValue);
    toast({ title: "Lotto Scansionato", description: `Lotto: ${scannedValue}` });
    setIsLottoScanDialogOpen(false);
  };
  
    const handleOpenSimulator = (target: 'job' | 'material' | 'lotto' | 'phase') => {
        setSimulatorTarget(target);
        setSimulatorInput('');
        setIsSimulatorOpen(true);
    };

    const handleSimulatorSubmit = () => {
        if (!simulatorTarget) return;
        
        const handleScan = (data: string) => {
            switch (simulatorTarget) {
                case 'job': handleScannedData(data); break;
                case 'material': handleMaterialCodeSubmit(data); break;
                case 'lotto': handleLottoScanned(data); break;
                case 'phase': handleLocalPhaseScanResult(data); break;
            }
        };
        
        handleScan(simulatorInput);
        
        setIsSimulatorOpen(false);
        setSimulatorInput('');
    };
    
    // --- NEW LOGIC: Session Conflict Resolution ---
    const handleAddToActiveSession = () => {
        if (!sessionConflict || !activeJob || !phaseForMaterialScan) return;
        addJobToSession(sessionConflict.material.id, { jobId: activeJob.id, jobOrderPF: activeJob.ordinePF });
        
        const jobToUpdate = JSON.parse(JSON.stringify(activeJob));
        const phaseToUpdate = jobToUpdate.phases.find((p: JobPhase) => p.id === phaseForMaterialScan.id);
        if (phaseToUpdate) {
            phaseToUpdate.materialReady = true; 
        }
        
        handleUpdateAndPersistJob(jobToUpdate);
        toast({ title: "Commessa Aggiunta", description: `Questa commessa è stata associata alla sessione attiva per ${sessionConflict.material.code}.` });
        setSessionConflict(null);
    };

    const handleStartNewLotto = () => {
        if (!sessionConflict) return;
        setScannedMaterialForPhase(sessionConflict.material);
        setMaterialScanStep('form');
        setIsMaterialScanDialogOpen(true);
        setSessionConflict(null);
    };
    // --- END NEW LOGIC ---

  if (step === 'loading') {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </AppShell>
    )
  }

  const renderInitialView = () => (
     <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-3"><ScanLine className="h-7 w-7 text-primary" /> Scansione Commessa</CardTitle>
            <CardDescription>Avvia la scansione o inserisci un codice per iniziare una lavorazione.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            {cameraError && (
                <Alert variant="destructive" className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Errore Fotocamera</AlertTitle>
                    <AlertDescription>{cameraError}</AlertDescription>
                </Alert>
            )}
            <Button onClick={() => setStep('scanning')} className="w-full" size="lg">
                <QrCode className="mr-2 h-5 w-5" />
                Avvia Scansione
            </Button>
            <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full">
                <Keyboard className="mr-2 h-5 w-5" />
                Inserisci Codice Manualmente
            </Button>
            <Button onClick={() => handleOpenSimulator('job')} variant="secondary" size="sm" className="w-full">
                <PlayCircle className="mr-2 h-4 w-4" />
                Simula Scansione Commessa (Test)
            </Button>
        </CardContent>
    </Card>
  );

  const renderScanArea = (onScan: (data: string) => void) => (
    <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="w-5/6 h-2/5 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
            </div>
        </div>
    </div>
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
             <AlertDialog open={isProblemReportDialogOpen} onOpenChange={setIsProblemReportDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button 
                    variant={job.isProblemReported ? "destructive" : "outline"} 
                    size="icon"
                    title={job.isProblemReported ? "Problema Segnalato! Visualizza/Modifica" : "Segnala Problema"}
                    className={`ml-auto shrink-0 ${job.isProblemReported ? "hover:bg-destructive/90" : "text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500"}`}
                >
                    <ShieldAlert className="h-5 w-5" />
                    <span className="sr-only">{job.isProblemReported ? "Problema già segnalato" : "Segnala un problema"}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Gestione Problema</AlertDialogTitle>
                    {job.isProblemReported ? (
                        <AlertDialogDescription asChild>
                             <div className="space-y-2 text-sm pt-2">
                                <p><strong className="text-foreground">Tipo:</strong> <span className="text-destructive">{job.problemType?.replace(/_/g, ' ') || 'N/D'}</span></p>
                                <p><strong className="text-foreground">Segnalato da:</strong> {job.problemReportedBy || 'N/D'}</p>
                                <div>
                                    <p className="font-bold text-foreground">Note Operatore:</p>
                                    <p className="text-muted-foreground p-2 bg-muted rounded-md">{job.problemNotes || 'Nessuna nota fornita.'}</p>
                                </div>
                            </div>
                        </AlertDialogDescription>
                    ) : (
                        <AlertDialogDescription>
                            Segnala un problema per questa commessa. Questo metterà in pausa la fase attiva.
                        </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                {job.isProblemReported ? (
                    <AlertDialogFooter>
                        <AlertDialogCancel>Chiudi</AlertDialogCancel>
                        { (operator?.role === 'superadvisor' || operator?.role === 'admin') && (
                          <AlertDialogAction onClick={handleResolveProblem} className="bg-green-600 hover:bg-green-700">
                             <Unlock className="mr-2 h-4 w-4"/> Sblocca Commessa
                          </AlertDialogAction>
                        )}
                    </AlertDialogFooter>
                ) : (
                     <Form {...problemForm}>
                        <form onSubmit={problemForm.handleSubmit(onProblemSubmit)}>
                            <div className="py-4 space-y-4">
                                <FormField control={problemForm.control} name="problemType" render={({ field }) => ( <FormItem className="space-y-3"><FormLabel>Tipo di Problema</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="grid grid-cols-2 gap-2"><FormItem><RadioGroupItem value="FERMO_MACCHINA" id="r1" className="peer sr-only" /><Label htmlFor="r1" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">FERMO MACCHINA</Label></FormItem><FormItem><RadioGroupItem value="MANCA_MATERIALE" id="r2" className="peer sr-only" /><Label htmlFor="r2" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">MANCA MATERIALE</Label></FormItem><FormItem><RadioGroupItem value="PROBLEMA_QUALITA" id="r3" className="peer sr-only" /><Label htmlFor="r3" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">PROBLEMA QUALITÀ</Label></FormItem><FormItem><RadioGroupItem value="ALTRO" id="r4" className="peer sr-only" /><Label htmlFor="r4" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">ALTRO</Label></FormItem></RadioGroup></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={problemForm.control} name="notes" render={({ field }) => ( <FormItem><FormLabel>Note Aggiuntive</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setIsProblemReportDialogOpen(false)}>Annulla</Button>
                                <Button type="submit" variant="destructive" disabled={problemForm.formState.isSubmitting}>Invia Segnalazione</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}
              </AlertDialogContent>
            </AlertDialog>
          </div>
           {job.isProblemReported && (
            <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
              <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato! Attendere intervento per risoluzione.
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
                    <Label htmlFor="ordinePF" className="text-sm text-muted-foreground">Ordine PF</Label>
                    <p id="ordinePF" className="font-medium">{job.ordinePF}</p>
                </div>
                <div>
                    <Label htmlFor="ordineNrEst" className="text-sm text-muted-foreground">Ordine Nr Est</Label>
                    <p id="ordineNrEst">{job.numeroODL}</p>
                </div>
                 <div>
                    <Label htmlFor="numeroODLInterno" className="text-sm text-muted-foreground">N° ODL</Label>
                    <p id="numeroODLInterno">{job.numeroODLInterno || 'N/D'}</p>
                </div>
                <div>
                    <Label htmlFor="dataConsegnaFinale" className="text-sm text-muted-foreground">Data Consegna</Label>
                    <p id="dataConsegnaFinale">{job.dataConsegnaFinale || 'N/D'}</p>
                </div>
                <div className="md:col-span-2">
                    <Label htmlFor="codiceArticolo" className="text-sm text-muted-foreground">Codice Articolo</Label>
                    <p id="codiceArticolo">{job.details}</p>
                </div>
                 <div>
                    <Label htmlFor="qta" className="text-sm text-muted-foreground">Qta</Label>
                    <p id="qta" className="font-bold text-lg">{job.qta}</p>
                </div>
            </div>
        </CardContent>
      </Card>
    );
  }

  const renderPhasesManagement = () => {
    if (!activeJob) return null;
    
    const preparationPhases = (activeJob.phases || []).filter(p => (p.type ?? 'production') === 'preparation');
    const allPreparationPhasesCompleted = preparationPhases.length > 0 && preparationPhases.every(p => p.status === 'completed');
    
    const productionAndQualityPhases = (activeJob.phases || []).filter(p => p.type === 'production' || p.type === 'quality' || p.type === 'packaging');
    
    const isMagazzinoOrSuperadvisor = operator?.role === 'superadvisor' || (Array.isArray(operator?.reparto) && operator.reparto.includes('MAG'));

    const sortedPhases = [...activeJob.phases].sort((a,b) => a.sequence - b.sequence);
    const firstProductionPhase = sortedPhases.find(p => p.type === 'production');
    
    const showReleaseButton = allPreparationPhasesCompleted && 
                              firstProductionPhase && 
                              !firstProductionPhase.materialReady &&
                              isMagazzinoOrSuperadvisor;

    return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline flex items-center">
          <ListChecks className="mr-3 h-7 w-7 text-primary" />
          Fasi di Lavorazione Commessa: {activeJob?.id}
        </CardTitle>
        <CardDescription>Gestisci l'avanzamento delle fasi.</CardDescription>
        {activeJob?.isProblemReported && (
           <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
              <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato! Attendere intervento per risoluzione.
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
                {preparationPhases.sort((a,b) => a.sequence - b.sequence).map(phase => {
                    const isSuperadvisor = operator?.role === 'superadvisor';
                    const operatorReparti = Array.isArray(operator?.reparto) ? operator.reparto : [operator?.reparto];
                    const operatorHasPermissionForDepartment = operator && (isSuperadvisor || (phase.departmentCodes || []).some(dc => operatorReparti.includes(dc)));
                    const isPhaseOwner = (phase.workPeriods || []).slice(-1)[0]?.operatorId === operator?.id && (phase.workPeriods || []).slice(-1)[0]?.end === null;
                    const canStartPhase = operatorHasPermissionForDepartment && !activeJob.isProblemReported && phase.status === 'pending' && phase.materialReady;
                    const canPausePhase = !activeJob.isProblemReported && phase.status === 'in-progress' && (isPhaseOwner || isSuperadvisor);
                    const canResumePhase = operatorHasPermissionForDepartment && !activeJob.isProblemReported && phase.status === 'paused';
                    const canCompletePhase = (phase.status === 'in-progress' || phase.status === 'paused') && (isPhaseOwner || isSuperadvisor);
                    const canScanMaterial = operatorHasPermissionForDepartment && (phase.requiresMaterialScan || phase.requiresMaterialSearch);

                    return <PhaseCard key={phase.id} phase={phase} job={activeJob} 
                                      permissions={{canScanMaterial, canStartPhase, canPausePhase, canResumePhase, canCompletePhase, operatorHasPermissionForDepartment, isPhaseOwner, isSuperadvisor}}
                                      handlers={{handleOpenPhaseScanDialog, handleOpenMaterialScanDialog, handlePausePhase, handleResumePhase, handleCompletePhase}}
                                      />
                })}
            </div>
          </>
        )}
        
        {showReleaseButton && (
            <div className="pt-4">
                <Button onClick={handleCompletePreparation} className="w-full bg-green-600 hover:bg-green-700" size="lg">
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
                {productionAndQualityPhases.sort((a,b) => a.sequence - b.sequence).map(phase => {
                    const isSuperadvisor = operator?.role === 'superadvisor';
                    const operatorReparti = Array.isArray(operator?.reparto) ? operator.reparto : [operator?.reparto];
                    const operatorHasPermissionForDepartment = operator && (isSuperadvisor || (phase.departmentCodes || []).some(dc => operatorReparti.includes(dc)));
                    const isPhaseOwner = (phase.workPeriods || []).slice(-1)[0]?.operatorId === operator?.id && (phase.workPeriods || []).slice(-1)[0]?.end === null;
                    const canScanMaterial = operatorHasPermissionForDepartment && (phase.requiresMaterialScan || phase.requiresMaterialSearch);
                    const canStartPhase = operatorHasPermissionForDepartment && !activeJob.isProblemReported && phase.status === 'pending' && phase.materialReady;
                    const canPausePhase = !activeJob.isProblemReported && phase.status === 'in-progress' && (isPhaseOwner || isSuperadvisor);
                    const canResumePhase = operatorHasPermissionForDepartment && !activeJob.isProblemReported && phase.status === 'paused';
                    const canCompletePhase = (phase.status === 'in-progress' || phase.status === 'paused') && (isPhaseOwner || isSuperadvisor);

                    return <PhaseCard key={phase.id} phase={phase} job={activeJob}
                                      permissions={{canScanMaterial, canStartPhase, canPausePhase, canResumePhase, canCompletePhase, operatorHasPermissionForDepartment, isPhaseOwner, isSuperadvisor}}
                                      handlers={{handleOpenPhaseScanDialog, handleOpenMaterialScanDialog, handlePausePhase, handleResumePhase, handleCompletePhase, handleQualityPhaseResult, handleForceStartPhase, openQualityProblemDialog: setIsQualityProblemDialogOpen, setPhaseForQualityProblem}}
                                      />
                })}
            </div>
          </>
        )}


        {allPhasesCompleted && !activeJob?.overallEndTime && (
          <Button 
            onClick={handleConcludeOverallJob} 
            className="w-full mt-4 bg-primary text-primary-foreground"
            disabled={activeJob?.isProblemReported || isPending}
          >
            <PowerOff className="mr-2 h-5 w-5" /> Concludi Commessa
          </Button>
        )}
         {activeJob?.overallEndTime && (
          <p className="mt-4 text-center text-green-500 font-semibold">Commessa conclusa il: {format(new Date(activeJob.overallEndTime), "dd/MM/yyyy HH:mm:ss")}</p>
        )}
      </CardContent>
    </Card>
  )};

  const renderFinishedView = () => (
    <Card>
      <CardHeader>
        <CardTitle>Lavorazione Completata</CardTitle>
        <CardDescription>La commessa {activeJob?.id} è stata conclusa con successo.</CardDescription>
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

  const renderScanDialog = (title: string, onScan: (data: string) => void) => (
    <div className="py-4 space-y-4">
      <DialogTitle>{title}</DialogTitle>
      {renderScanArea(onScan)}
      <Button variant="outline" className="w-full" onClick={() => { setIsPhaseScanDialogOpen(false); setIsLottoScanDialogOpen(false); setIsMaterialScanDialogOpen(false); setMaterialScanStep('initial'); }}>Annulla</Button>
    </div>
  );

  const renderMaterialScanDialog = () => (
    <Dialog open={isMaterialScanDialogOpen} onOpenChange={setIsMaterialScanDialogOpen}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
            <DialogHeader>
                <DialogTitle>Aggiungi Materiale per: {phaseForMaterialScan?.name}</DialogTitle>
            </DialogHeader>

            {materialScanStep === 'initial' && (
                <div className="py-4 space-y-4">
                    <Button onClick={() => setMaterialScanStep('scanning')} className="w-full"><QrCode className="mr-2 h-4 w-4" /> Scansiona QR/Barcode</Button>
                    <Button onClick={() => setMaterialScanStep('manual_input')} variant="outline" className="w-full"><Keyboard className="mr-2 h-4 w-4" /> Inserisci Manualmente</Button>
                    <Button onClick={() => handleOpenSimulator('material')} variant="secondary" size="sm" className="w-full"><PlayCircle className="mr-2 h-4 w-4" />Simula Scansione Materiale</Button>
                </div>
            )}
            
            {materialScanStep === 'search_input' && (
                <div className="py-4 space-y-4">
                     <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Cerca per codice o descrizione..."
                            className="pl-9"
                            value={manualMaterialCode}
                            onChange={(e) => handleSearchTermChange(e.target.value)}
                            autoFocus
                        />
                    </div>
                    {isSearchingMaterial ? (
                        <div className="flex items-center justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : (
                        <div className="max-h-60 overflow-y-auto space-y-2">
                           {searchResults.map(material => (
                             <button key={material.id} onClick={() => handleMaterialCodeSubmit(material.code)} className="w-full text-left p-2 rounded-md hover:bg-accent">
                               <p className="font-semibold">{material.code}</p>
                               <p className="text-xs text-muted-foreground">{material.description}</p>
                               <p className="text-xs text-muted-foreground">Stock: {material.currentStockUnits} {material.unitOfMeasure}</p>
                             </button>
                           ))}
                        </div>
                    )}
                </div>
            )}

            {materialScanStep === 'scanning' && (
              <div className="py-4 space-y-4">
                {renderScanArea(handleMaterialCodeSubmit)}
                <div className="flex flex-col gap-2">
                    <Button onClick={() => triggerScan(handleMaterialCodeSubmit)} disabled={isCapturing} className="w-full h-12">
                       {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5" />}
                       <span className="ml-2">Scansiona Codice</span>
                    </Button>
                    <Button variant="outline" className="w-full" onClick={() => setMaterialScanStep('initial')}>Annulla</Button>
                </div>
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
                scannedMaterialForPhase.type === 'GUAINA' ? (
                     <Form {...tubiGuainaWithdrawalForm}>
                        <form onSubmit={tubiGuainaWithdrawalForm.handleSubmit(onTubiGuainaWithdrawalSubmit)} className="space-y-4">
                            <Card><CardHeader><CardTitle className="text-lg">{scannedMaterialForPhase.code}</CardTitle><CardDescription>{scannedMaterialForPhase.description}</CardDescription></CardHeader></Card>
                             <FormField control={tubiGuainaWithdrawalForm.control} name="unit" render={({ field }) => ( <FormItem><FormControl><Input type="hidden" {...field} value="mt" /></FormControl></FormItem>)} />
                             <FormField control={tubiGuainaWithdrawalForm.control} name="quantity" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Metri da Prelevare (MT)</FormLabel>
                                    <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <DialogFooter><Button type="submit" disabled={tubiGuainaWithdrawalForm.formState.isSubmitting}><Send className="mr-2 h-4 w-4" />Registra Prelievo</Button></DialogFooter>
                        </form>
                    </Form>
                ) : scannedMaterialForPhase.type === 'TUBI' ? (
                     <Form {...tubiGuainaWithdrawalForm}>
                        <form onSubmit={tubiGuainaWithdrawalForm.handleSubmit(onTubiGuainaWithdrawalSubmit)} className="space-y-4">
                            <Card><CardHeader><CardTitle className="text-lg">{scannedMaterialForPhase.code}</CardTitle><CardDescription>{scannedMaterialForPhase.description}</CardDescription></CardHeader></Card>
                            <FormField control={tubiGuainaWithdrawalForm.control} name="unit" render={({ field }) => (
                                <FormItem className="space-y-3"><FormLabel>Prelievo per unità o peso?</FormLabel>
                                <FormControl>
                                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="n" /></FormControl><FormLabel className="font-normal">N° Pezzi</FormLabel></FormItem>
                                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="kg" /></FormControl><FormLabel className="font-normal">KG</FormLabel></FormItem>
                                    </RadioGroup>
                                </FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={tubiGuainaWithdrawalForm.control} name="quantity" render={({ field }) => (
                                <FormItem><FormLabel>Quantità da Prelevare ({tubiGuainaWithdrawalForm.watch('unit')?.toUpperCase()})</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <DialogFooter><Button type="submit" disabled={tubiGuainaWithdrawalForm.formState.isSubmitting}><Send className="mr-2 h-4 w-4" />Registra Prelievo</Button></DialogFooter>
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
                                            <Button type="button" variant="secondary" size="icon" onClick={() => handleOpenSimulator('lotto')}><PlayCircle className="h-4 w-4" /><span className="sr-only">Simula lotto</span></Button>
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
            {renderScanArea(handleLottoScanned)}
            <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button onClick={() => triggerScan(handleLottoScanned)} disabled={isCapturing} className="w-full sm:w-auto flex-1 h-12">
                   {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5" />}
                   <span className="ml-2">Scansiona Lotto</span>
                </Button>
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
                <DialogDescription>Inquadra il QR Code con il nome della fase per avviarla.</DialogDescription>
            </DialogHeader>
            {renderScanArea(handleLocalPhaseScanResult)}
            <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button onClick={() => triggerScan(handleLocalPhaseScanResult)} disabled={isCapturing} className="w-full sm:w-auto flex-1 h-12">
                   {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5" />}
                   <span className="ml-2">Scansiona Fase</span>
                </Button>
                <Button variant="secondary" onClick={() => handleOpenSimulator('phase')}>Simula</Button>
                <Button variant="outline" onClick={() => setIsPhaseScanDialogOpen(false)}>Annulla</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );

  const renderContinueOrCloseDialog = () => {
    if (!jobToFinalize) return null;
    const phaseThatTriggered = jobToFinalize.phases.find(p => p.status === 'completed' && p.materialConsumptions.some(mc => mc.closingWeight === undefined));
    const relevantSession = activeSessions.find(s => phaseThatTriggered?.materialConsumptions.some(mc => mc.materialId === s.materialId));


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
  
  const renderSessionConflictDialog = () => (
    <Dialog open={!!sessionConflict} onOpenChange={(open) => !open && setSessionConflict(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="text-amber-500" />
                    Sessione Materiale Attiva
                </DialogTitle>
                <DialogDescription>
                    Esiste già una sessione attiva per il materiale <span className="font-bold">{sessionConflict?.material.code}</span>. Cosa vuoi fare?
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-3">
                 <Button onClick={handleAddToActiveSession} className="w-full p-4 flex flex-col items-center justify-center gap-2 h-auto" variant="outline">
                    <Copy className="h-6 w-6" />
                    <div className="text-center">
                        <p className="font-semibold">Aggiungi a Sessione Attiva</p>
                        <p className="text-xs text-muted-foreground">Continua a usare lo stesso lotto per questa nuova commessa.</p>
                    </div>
                </Button>
                <Button onClick={handleStartNewLotto} className="w-full p-4 flex flex-col items-center justify-center gap-2 h-auto" variant="outline">
                    <PlusCircleIcon className="h-6 w-6" />
                    <div className="text-center">
                        <p className="font-semibold">Inizia Nuovo Lotto</p>
                        <p className="text-xs text-muted-foreground">Stai usando una nuova bobina/lotto di questo materiale.</p>
                    </div>
                </Button>
            </div>
             <DialogFooter>
                <Button variant="ghost" onClick={() => setSessionConflict(null)}>Annulla</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);


  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-4xl mx-auto">
          <OperatorNavMenu />
          
            
                {step === 'initial' && <div className="mt-8">{renderInitialView()}</div>}
                {step === 'scanning' && (
                  <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-3"><ScanLine className="h-7 w-7 text-primary" />Scansiona Commessa</CardTitle>
                        <CardDescription>Inquadra il QR code della commessa per iniziare.</CardDescription>
                      </CardHeader>
                      <CardContent>
                          {renderScanArea(handleScannedData)}
                      </CardContent>
                      <CardFooter className="flex-col gap-2">
                           <Button onClick={() => triggerScan(handleScannedData)} disabled={isCapturing || !!cameraError} className="w-full h-14">
                              {isCapturing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                              <span className="ml-2 text-lg">{isCapturing ? 'Scansionando...' : 'Scansiona'}</span>
                           </Button>
                          <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                      </CardFooter>
                  </Card>
                )}
                 {step === 'manual_input' && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Inserimento Manuale</CardTitle>
                                <CardDescription>Digita il codice della commessa (Ordine PF) da avviare.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative">
                                    <Label htmlFor="manualCode">Ordine PF</Label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Input
                                            id="manualCode"
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value)}
                                            placeholder="Es. Comm-123/24"
                                            autoFocus
                                            autoComplete="off"
                                        />
                                        <Button onClick={() => handleScannedData(manualCode)} disabled={!manualCode || isSearching}>
                                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            <span className="sr-only">Cerca</span>
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex-col gap-4">
                                <Button type="button" variant="outline" onClick={() => setStep('initial')} className="w-full">Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                {step === 'processing' && activeJob && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {renderJobDetailsCard(activeJob)}
                    {renderPhasesManagement()}
                  </div>
                )}

                {step === 'finished' && activeJob && renderFinishedView()}
            
          
          {renderMaterialScanDialog()}
          {renderLottoScanDialog()}
          {renderPhaseScanDialog()}
          {renderContinueOrCloseDialog()}
          {renderSessionConflictDialog()}

           <Dialog open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Simulatore Scansione QR</DialogTitle>
                        <DialogDescription>
                            Incolla il contenuto del QR code che vuoi simulare.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <Label htmlFor="simulator-input">Contenuto QR Code</Label>
                        <Input 
                            id="simulator-input"
                            value={simulatorInput}
                            onChange={(e) => setSimulatorInput(e.target.value)}
                            placeholder="Es. Comm-123/24@CODICE@100"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSimulatorOpen(false)}>Annulla</Button>
                        <Button onClick={handleSimulatorSubmit}>Simula Scansione</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isQualityProblemDialogOpen} onOpenChange={setIsQualityProblemDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Segnala Non Conformità</DialogTitle>
                        <DialogDescription>Descrivi il problema riscontrato durante il collaudo per la fase "{phaseForQualityProblem?.name}".</DialogDescription>
                    </DialogHeader>
                    <Form {...problemForm}>
                        <form onSubmit={problemForm.handleSubmit((data) => {
                            if (phaseForQualityProblem) {
                                handleQualityPhaseResult(phaseForQualityProblem.id, 'failed', data.notes);
                            }
                            setIsQualityProblemDialogOpen(false);
                            problemForm.reset();
                        })} className="py-4 space-y-4">
                            <FormField
                                control={problemForm.control}
                                name="notes"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Note sulla non conformità</FormLabel>
                                    <FormControl>
                                    <Input {...field} placeholder="Es. Saldatura fredda sul componente C12" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                             <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setIsQualityProblemDialogOpen(false)}>Annulla</Button>
                                <Button type="submit" variant="destructive">Invia Segnalazione</Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

        </div>
      </AppShell>
    </AuthGuard>
  );
}

function PhaseCard({ phase, job, permissions, handlers }: {
    phase: JobPhase,
    job: JobOrder,
    permissions: {
        canScanMaterial: boolean,
        canStartPhase: boolean,
        canPausePhase: boolean,
        canResumePhase: boolean,
        canCompletePhase: boolean,
        operatorHasPermissionForDepartment: boolean,
        isPhaseOwner: boolean,
        isSuperadvisor: boolean
    },
    handlers: {
        handleOpenPhaseScanDialog: (phase: JobPhase) => void,
        handleOpenMaterialScanDialog: (phase: JobPhase) => void,
        handlePausePhase: (phaseId: string) => void,
        handleResumePhase: (phaseId: string) => void,
        handleCompletePhase: (phaseId: string) => void,
        handleQualityPhaseResult?: (phaseId: string, result: 'passed' | 'failed', notes?: string) => void,
        handleForceStartPhase?: (phaseId: string) => void,
        openQualityProblemDialog: (isOpen: boolean) => void,
        setPhaseForQualityProblem: (phase: JobPhase) => void,
    }
}) {
    const { operator } = useAuth();
    if (!operator) return null;

    let phaseIcon = <PhasePendingIcon className="mr-2 h-5 w-5 text-muted-foreground" />;
    if (phase.status === 'in-progress') phaseIcon = <Hourglass className="mr-2 h-5 w-5 text-yellow-500 animate-spin" />;
    if (phase.status === 'paused') phaseIcon = <PausePhaseIcon className="mr-2 h-5 w-5 text-orange-500" />;
    if (phase.status === 'completed') {
      phaseIcon = <PhaseCompletedIcon className="mr-2 h-5 w-5 text-green-500" />;
      if (phase.qualityResult === 'failed') {
         phaseIcon = <ThumbsDown className="mr-2 h-5 w-5 text-destructive" />;
      }
    }
    
    const lastActiveWorkPeriod = (phase.workPeriods || []).length > 0 ? (phase.workPeriods || [])[(phase.workPeriods || []).length - 1] : null;

    const openProblemDialog = () => {
        handlers.setPhaseForQualityProblem(phase);
        handlers.openQualityProblemDialog(true);
    };

    return (
        <Card key={phase.id} className={`p-4 bg-card/50 ${!permissions.operatorHasPermissionForDepartment && 'opacity-60 bg-muted/30'}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center">
                {phaseIcon}
                <span className={`font-semibold ${!permissions.operatorHasPermissionForDepartment && 'text-muted-foreground'}`}>{phase.name} (Seq: {phase.sequence})</span>
            </div>
            <div className="flex items-center space-x-2">
                <Label htmlFor={`material-${phase.id}`} className="text-sm">Mat. Pronto:</Label>
                <Switch id={`material-${phase.id}`} checked={phase.materialReady} disabled={true} />
                {phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}
            </div>
            </div>
            
            {!permissions.operatorHasPermissionForDepartment && (
            <p className="text-xs text-amber-600 dark:text-amber-500 font-semibold mt-2">
                Fase non di competenza del tuo reparto.
            </p>
            )}
            {phase.status === 'in-progress' && permissions.isPhaseOwner && (
            <p className="text-xs text-green-500 font-semibold mt-2 flex items-center gap-1">
                <UserCheck className="h-4 w-4" />
                Stai lavorando a questa fase.
            </p>
            )}

            {phase.qualityResult && (
                <div className="mt-2">
                    <Badge variant={phase.qualityResult === 'passed' ? 'default' : 'destructive'}>
                        Esito: {phase.qualityResult === 'passed' ? 'Superato' : 'Fallito'}
                    </Badge>
                </div>
            )}

            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            {(phase.materialConsumptions || []).map((mc, index) => (
                <p key={index} className="font-semibold text-primary/90 text-xs bg-primary/10 p-2 rounded-md">
                    Materiale: {mc.materialCode} 
                    {mc.openingWeight !== undefined && ` (Aperto: ${mc.openingWeight} kg)`}
                    {mc.closingWeight !== undefined && ` (Chiuso: ${mc.closingWeight} kg)`}
                    {mc.pcs !== undefined && ` (Pezzi: ${mc.pcs})`}
                    {mc.lottoBobina && ` - Lotto: ${mc.lottoBobina}`}
                </p>
            ))}
            {lastActiveWorkPeriod?.start && (
                <p>Ultimo avvio: {format(new Date(lastActiveWorkPeriod.start), "dd/MM/yyyy HH:mm:ss")}</p>
            )}
            {phase.status === 'paused' && lastActiveWorkPeriod?.end && (
                <p>Messa in pausa il: {format(new Date(lastActiveWorkPeriod.end), "dd/MM/yyyy HH:mm:ss")}</p>
            )}
            {phase.type !== 'quality' && <p>Tempo di lavorazione effettivo: {calculateTotalActiveTime(phase.workPeriods || [])}</p>}
            </div>
            
            <div className="mt-3 flex flex-wrap gap-2">
            {permissions.canScanMaterial && (
                <Button size="sm" onClick={() => handlers.handleOpenMaterialScanDialog(phase)} variant="default" disabled={!permissions.operatorHasPermissionForDepartment}>
                    <Plus className="mr-2 h-4 w-4" /> Aggiungi Materiale
                </Button>
            )}
            {permissions.canStartPhase && phase.type !== 'quality' && (
                <Button size="sm" onClick={() => handlers.handleOpenPhaseScanDialog(phase)} variant="outline" className="border-primary text-primary hover:bg-primary/10">
                    <QrCode className="mr-2 h-4 w-4" /> Scansiona Fase per Avviare
                </Button>
            )}
            {permissions.canStartPhase && phase.type === 'quality' && handlers.handleQualityPhaseResult && (
                <div className="flex gap-2">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 h-12 w-16 flex-col" onClick={() => handlers.handleQualityPhaseResult?.(phase.id, 'passed')}>
                        <ThumbsUp className="h-5 w-5" />
                        <span className="text-xs">OK</span>
                    </Button>
                    <Button size="sm" variant="destructive" className="h-12 w-16 flex-col" onClick={openProblemDialog}>
                       <ThumbsDown className="h-5 w-5" />
                       <span className="text-xs">NC</span>
                    </Button>
                </div>
            )}
            {permissions.isSuperadvisor && phase.status === 'pending' && handlers.handleForceStartPhase && (
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={!permissions.operatorHasPermissionForDepartment}>
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
                            <AlertDialogAction onClick={() => handlers.handleForceStartPhase?.(phase.id)}>
                                Sì, forza avvio
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            {permissions.canPausePhase && (
                <Button size="sm" onClick={() => handlers.handlePausePhase(phase.id)} variant="outline" className="text-orange-500 border-orange-500 hover:bg-orange-500/10 hover:text-orange-500">
                <PausePhaseIcon className="mr-2 h-4 w-4" /> Metti in Pausa
                </Button>
            )}
            {permissions.canResumePhase && (
                <Button size="sm" onClick={() => handlers.handleResumePhase(phase.id)} variant="outline" className="text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500">
                <PlayCircle className="mr-2 h-4 w-4" /> Riprendi Fase
                </Button>
            )}
            {permissions.canCompletePhase && (
                <Button size="sm" onClick={() => handlers.handleCompletePhase(phase.id)} className="bg-green-600 hover:bg-green-700 text-primary-foreground" disabled={(job.isProblemReported && phase.status !== 'completed')}>
                <PhaseCompletedIcon className="mr-2 h-4 w-4" /> Completa Fase
                </Button>
            )}
            </div>
        </Card>
    );
}






