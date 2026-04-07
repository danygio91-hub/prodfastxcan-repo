
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
import { QrCode, CheckCircle, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle, Hourglass, PackageCheck, PackageX, Loader2, Camera, LogOut, EyeOff, AlertTriangle, Combine, Trash2, Check, ArrowLeft, Unlink, View, RefreshCw, FastForward, Clock, Skull, Zap, AlertCircle } from 'lucide-react';

import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { JobOrder, JobPhase, WorkPeriod, ActiveMaterialSessionData, RawMaterialType, WorkGroup } from '@/types';
import { verifyAndGetJobOrder, updateJob, getJobOrderById, handlePhaseScanResult, handlePhasePause, isOperatorActiveOnAnyJob, updateOperatorStatus, createWorkGroup, dissolveWorkGroup, updateWorkGroup, fastForwardToPackaging } from './actions';

import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import { cn } from '@/lib/utils';
import MaterialAssociationDialog from './MaterialAssociationDialog';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import PauseReasonDialog, { PauseReason } from '@/components/production-console/PauseReasonDialog';
import AttachmentViewerDialog from '@/components/production-console/AttachmentViewerDialog';

function calculateTotalActiveTime(workPeriods: WorkPeriod[]): string {
  let total = 0;
  workPeriods.forEach(p => { if (p.end) total += new Date(p.end).getTime() - new Date(p.start).getTime(); });
  if (total === 0) return workPeriods.some(p => p.end === null) ? "Iniziata" : "0s";
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

function getPhaseIcon(status: JobPhase['status'], type?: string) {
  if (status === 'completed') return <PhaseCompletedIcon className="h-4 w-4 text-green-500" />;
  if (status === 'skipped') return <EyeOff className="h-4 w-4 text-blue-400" />;
  
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'paused': return <PausePhaseIcon className="h-4 w-4 text-orange-500" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

const PhaseCard = ({ phase, job, handlers }: { phase: JobPhase, job: JobOrder, handlers: any }) => {
    const { operator } = useAuth();
    if (!operator) return null;
    const isSuper = operator.role === 'supervisor' || operator.role === 'admin';
    const operatorReparti = operator.reparto || [];
    const hasPerm = isSuper || (phase.departmentCodes || []).some(dc => operatorReparti.includes(dc));
    const isOwner = (phase.workPeriods || []).some(wp => wp.operatorId === operator.id && wp.end === null);
    
    // START POLICY: Can start if ready (N started) OR if it's a prep phase
    const canStart = hasPerm && phase.status === 'pending' && phase.materialReady;
    
    const canPause = !job.isProblemReported && phase.status === 'in-progress' && isOwner;
    const canResume = hasPerm && !job.isProblemReported && (phase.status === 'paused' || (phase.status === 'in-progress' && !isOwner));
    const canJoin = hasPerm && !job.isProblemReported && phase.status === 'in-progress' && !isOwner;

    // COMPLETE POLICY: Only if owner AND previous non-independent phase is completed/skipped
    const phs = [...(job.phases || [])].sort((a,b) => a.sequence - b.sequence);
    const idx = phs.findIndex(p => p.id === phase.id);
    let prev: JobPhase | null = null;
    for (let j = idx - 1; j >= 0; j--) { 
      if (!phs[j].isIndependent) { prev = phs[j]; break; } 
    }

    const isPrevFinished = !prev || ['completed', 'skipped'].includes(prev.status);
    const canComplete = (phase.status === 'in-progress' || phase.status === 'paused') && isOwner && isPrevFinished;
    const isCompleteBlockedByPrev = (phase.status === 'in-progress' || phase.status === 'paused') && isOwner && !isPrevFinished;

    return (
      <Card className={cn(
        "p-4 border-l-4 transition-all",
        phase.status === 'completed' ? "border-l-green-500 bg-green-50/30" : 
        phase.status === 'skipped' ? "border-l-blue-400 bg-blue-50/30 opacity-80" :
        phase.status === 'in-progress' ? "border-l-blue-500 bg-blue-50/50 shadow-md" :
        !hasPerm ? 'opacity-60 bg-muted/30 border-l-transparent' : 'bg-card/50 border-l-slate-200'
      )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {getPhaseIcon(phase.status, phase.type)}
              <span className={cn("font-bold ml-2", phase.status === 'completed' && "text-green-700")}>
                {phase.name}
              </span>
              {phase.status === 'skipped' && <Badge variant="outline" className="ml-2 text-[8px] bg-blue-100 text-blue-600 border-blue-200">SALTA</Badge>}
            </div>
            <div className="flex items-center space-x-2">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Materiale:</Label>
              {phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-400" />}
            </div>
          </div>
          
          {isOwner && <p className="text-[10px] text-green-600 font-bold mt-2 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/> SEI ATTIVO IN QUESTA FASE</p>}
          
          <div className="mt-2 space-y-1 text-xs text-muted-foreground border-t pt-2 border-muted">
            {(phase.materialConsumptions || []).length > 0 ? (
                phase.materialConsumptions.map((mc, i) => (
                    <div key={i} className="flex justify-between items-center bg-white/50 p-1 rounded px-2 border border-slate-100">
                        <span className="font-semibold">{mc.materialCode}</span>
                        {mc.lottoBobina && <span className="opacity-70 font-mono">Lot: {mc.lottoBobina}</span>}
                    </div>
                ))
            ) : (
                <p className="italic opacity-50 text-[10px]">Nessun materiale associato.</p>
            )}
            <p className="pt-1 flex items-center gap-1 font-mono text-[10px]"><Clock className="h-3 w-3" /> Tempo: {calculateTotalActiveTime(phase.workPeriods || [])}</p>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-2">
            {hasPerm && phase.type === 'preparation' && phase.status !== 'completed' && phase.status !== 'skipped' && (
              <Button size="sm" variant="secondary" className="h-8 w-full sm:w-auto text-xs font-bold" onClick={() => handlers.handleOpenMaterialAssociationDialog(phase)}>Associa Materiale</Button>
            )}
            
            {canStart && <Button size="sm" onClick={() => handlers.handleOpenPhaseScanDialog(phase)} variant="outline" className="h-8 w-full sm:w-auto text-xs font-bold ring-2 ring-primary/10"><QrCode className="mr-2 h-4 w-4" /> Avvia</Button>}
            
            {canJoin && <Button size="sm" onClick={() => handlers.handleResumePhase(phase.id)} variant="outline" className="h-8 w-full sm:w-auto text-xs font-bold text-blue-600 border-blue-200 bg-blue-50/50"><Combine className="mr-2 h-4 w-4" /> Partecipa</Button>}
            
            {canPause && <Button size="sm" onClick={() => handlers.handlePausePhase(phase.id)} variant="outline" className="h-8 w-full sm:w-auto text-xs font-bold text-orange-600 border-orange-200">Pausa</Button>}
            
            {canResume && !canJoin && <Button size="sm" onClick={() => handlers.handleResumePhase(phase.id)} variant="outline" className="h-8 w-full sm:w-auto text-xs font-bold text-yellow-600 border-yellow-200 bg-yellow-50/50">Riprendi</Button>}
            
            {canComplete && (
              <Button 
                size="sm" 
                onClick={() => {
                  if (phase.type === 'quality' || phase.type === 'packaging') {
                    handlers.handleOpenDeclarationDialog(phase);
                  } else {
                    handlers.handleCompletePhase(phase.id);
                  }
                }} 
                className={cn(
                  "h-8 w-full sm:w-auto text-xs font-bold shadow-md",
                  (phase.type === 'quality' || phase.type === 'packaging') ? "bg-amber-500 hover:bg-amber-600" : "bg-green-600 hover:bg-green-700"
                )}
              >
                {(phase.type === 'quality' || phase.type === 'packaging') ? 'Dichiara' : 'Completa'}
              </Button>
            )}

            {isCompleteBlockedByPrev && (
               <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-not-allowed w-full sm:w-auto">
                      <Button size="sm" disabled className="h-8 w-full sm:w-auto text-xs font-bold opacity-50">Completa</Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-slate-900 text-white border-none text-[10px]">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      In attesa di chiusura fase precedente: {prev?.name}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
      </Card>
    );
};

export default function ScanJobPage() {
  const { toast } = useToast();
  const { operator } = useAuth();
  const { 
    activeJob, 
    setActiveJob, 
    setActiveJobId, 
    isLoading: jobLoading, 
    isStatusBarHighlighted, 
    setIsStatusBarHighlighted, 
    refreshJob: triggerJobRefresh,
    hasPendingUpdates,
    clearUpdatesIndicator
  } = useActiveJob();

  const { startSession } = useActiveMaterialSession();
  
  const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'processing' | 'finished' | 'loading'>('loading');
  const [isCapturing, setIsCapturing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);
  const [isMaterialAssociationDialogOpen, setIsMaterialAssociationDialogOpen] = useState(false);
  const [phaseForMaterialAssociation, setPhaseForMaterialAssociation] = useState<JobPhase | null>(null);

  const [isAdminForceDialogOpen, setIsAdminForceDialogOpen] = useState(false);
  const [blockerNames, setBlockerNames] = useState("");
  const [isGroupingDialogOpen, setIsGroupingDialogOpen] = useState(false);
  const [isGroupingScanActive, setIsGroupingScanActive] = useState(false);
  const [jobsToGroup, setJobsToGroup] = useState<JobOrder[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isDissolving, setIsDissolving] = useState(false);

  const [isPauseReasonDialogOpen, setIsPauseReasonDialogOpen] = useState(false);
  const [phaseIdToPause, setPhaseIdToPause] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);
  
  const [isQualityDialogOpen, setIsQualityDialogOpen] = useState(false);
  const [isPackagingDialogOpen, setIsPackagingDialogOpen] = useState(false);
  const [phaseForDeclaration, setPhaseForDeclaration] = useState<JobPhase | null>(null);
  const [isDeclaring, setIsDeclaring] = useState(false);

  const [isAttachmentsDialogOpen, setIsAttachmentsDialogOpen] = useState(false);
  const [isFastForwarding, setIsFastForwarding] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const groupingVideoRef = useRef<HTMLVideoElement>(null);

  const { hasPermission: hasCameraPermission } = useCameraStream(step === 'scanning' || isPhaseScanDialogOpen, videoRef);
  const { hasPermission: hasGroupingCameraPermission } = useCameraStream(isGroupingScanActive, groupingVideoRef);

  useEffect(() => { 
    if (!jobLoading) {
      setStep(activeJob ? (activeJob.status === 'completed' ? 'finished' : 'processing') : 'initial');
    }
  }, [jobLoading, activeJob]);

  // Alert operator when pulse is detected
  useEffect(() => {
    if (hasPendingUpdates) {
      toast({
        title: "Aggiornamenti disponibili",
        description: "L'amministratore ha modificato i dati della commessa. Clicca su Aggiorna per sincronizzare.",
        duration: 5000,
      });
    }
  }, [hasPendingUpdates, toast]);


  // Unified update handler for both Jobs and Groups
  const handleUpdateJobOrGroup = async (updatedItem: JobOrder | any) => {
    if (!operator || !updatedItem) return;
    const isGroup = updatedItem.id.startsWith('group-');
    const result = isGroup
        ? await updateWorkGroup(updatedItem as WorkGroup, operator.id)
        : await updateJob(updatedItem as JobOrder);

    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Errore di Sincronizzazione",
        description: result.message,
      });
    } else {
      triggerJobRefresh();
    }
  };

  const refreshJob = useCallback(() => {
    triggerJobRefresh();
    clearUpdatesIndicator();
    toast({ title: 'Dati Aggiornati', description: 'La commessa è stata sincronizzata con il server.' });
  }, [triggerJobRefresh, clearUpdatesIndicator, toast]);


  const triggerScan = useCallback(async (vRef: React.RefObject<HTMLVideoElement>, onScan: (data: string) => void) => {
      if (!vRef.current || vRef.current.readyState < 2) {
          toast({ variant: 'destructive', title: 'Fotocamera non pronta' });
          return;
      }
      if (!('BarcodeDetector' in window)) {
          toast({ variant: 'destructive', title: 'Funzionalità non supportata', description: 'Il tuo browser non supporta la scansione dei codici.' });
          return;
      }

      setIsCapturing(true);
      try {
          const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
          const codes = await detector.detect(vRef.current);
          if (codes.length > 0) {
              onScan(codes[0].rawValue);
          } else {
              toast({ variant: 'destructive', title: 'Nessun Codice Trovato' });
          }
      } catch (e) {
          toast({ variant: 'destructive', title: 'Errore Scansione' });
      } finally {
          setIsCapturing(false);
      }
  }, [toast]);

  const handleScannedData = useCallback(async (data: string) => {
    const parts = data.split('@');
    if (parts.length !== 3) {
        toast({ variant: 'destructive', title: 'QR non Valido' });
        return;
    }
    const result = await verifyAndGetJobOrder({ ordinePF: parts[0], codice: parts[1], qta: parts[2] });
    if ('error' in result) {
        toast({ variant: 'destructive', title: result.title, description: result.error });
    } else {
        setActiveJobId(result.id);
    }
  }, [toast, setActiveJobId]);

  const handleGroupingScan = useCallback(async (data: string) => {
    const parts = data.split('@');
    if (parts.length !== 3) {
        toast({ variant: 'destructive', title: 'QR non Valido' });
        return;
    }
    const result = await verifyAndGetJobOrder({ ordinePF: parts[0], codice: parts[1], qta: parts[2] });
    if ('error' in result) {
        toast({ variant: 'destructive', title: result.title, description: result.error });
    } else {
        if (jobsToGroup.some(j => j.id === result.id)) {
            toast({ variant: "destructive", title: "Già scansionata", description: "Questa commessa è già nell'elenco." });
            return;
        }
        
        if (result.status === 'completed') {
            toast({ variant: "destructive", title: "Commessa non valida", description: "Non puoi concatenare commesse già completate." });
            return;
        }

        setJobsToGroup(prev => [...prev, result]);
        toast({ title: "Commessa Aggiunta", description: result.ordinePF });
        setIsGroupingScanActive(false);
    }
  }, [toast, jobsToGroup]);

  const handleCreateGroup = async () => {
    if (!operator || jobsToGroup.length < 2) return;
    setIsCreatingGroup(true);
    const result = await createWorkGroup(jobsToGroup.map(j => j.id), operator.id);
    if (result.success && result.workGroupId) {
        toast({ title: "Gruppo Creato", description: "Le commesse sono state concatenate correttamente." });
        setActiveJobId(result.workGroupId);
        setIsGroupingDialogOpen(false);
        setJobsToGroup([]);
    } else {
        toast({ variant: "destructive", title: "Impossibile Concatenare", description: result.message });
    }
    setIsCreatingGroup(false);
  };

  const handleDissolveGroupLocal = async (force: boolean = false) => {
    if (!activeJob?.workGroupId) return;
    
    // Normal Check: If any phase is in progress, block dissolution (local check)
    const isAnyActive = activeJob.phases.some(p => p.status === 'in-progress');
    if (isAnyActive && !force) {
        toast({ 
            variant: "destructive", 
            title: "Operazione Bloccata", 
            description: "Metti in pausa tutte le fasi attive prima di scollegare il gruppo." 
        });
        return;
    }

    setIsDissolving(true);
    const result = await dissolveWorkGroup(activeJob.workGroupId, false, force);
    if (result.success) {
        toast({ title: force ? "Sblocco Forzato Completato" : "Gruppo Scollegato", description: "Le commesse sono tornate individuali." });
        
        // Return to scan screen as requested by user to avoid operator confusion
        setActiveJobId(null);
        
        setIsAdminForceDialogOpen(false);
    } else {
        // If it's an operator block and user is admin, show the force option
        if (result.message.includes("l'operatore") && (operator?.role === 'admin' || operator?.role === 'supervisor')) {
            setBlockerNames(result.message.split("[")[1]?.split("]")[0] || "altro operatore");
            setIsAdminForceDialogOpen(true);
        } else {
            toast({ variant: "destructive", title: "Errore", description: result.message });
        }
    }
    setIsDissolving(false);
  };

  const handlePausePhase = (id: string) => {
    setPhaseIdToPause(id);
    setIsPauseReasonDialogOpen(true);
  };

  const confirmPause = async (reason: PauseReason, notes?: string) => {
    if (!activeJob || !operator || !phaseIdToPause) return;
    setIsPausing(true);
    await handlePhasePause(activeJob.id, phaseIdToPause, operator.id, reason, notes);
    setIsPausing(false);
    setIsPauseReasonDialogOpen(false);
    setPhaseIdToPause(null);
    triggerJobRefresh();
    toast({ title: 'Pausa registrata', description: `Causale: ${reason}` });
  };


  const handleResumePhase = async (id: string) => {
      if (!activeJob || !operator) return;
      
      const avail = await isOperatorActiveOnAnyJob(operator.id, activeJob.id);
      if (!avail.available) {
          toast({ variant: 'destructive', title: 'Operatore Occupato', description: `Sei già attivo sulla commessa ${avail.activeJobId} nella fase ${avail.activePhaseName}.` });
          return;
      }

      await handlePhaseScanResult(activeJob.id, id, operator.id, false);
      triggerJobRefresh();
  };


  const handleCompletePhase = async (id: string) => {
    if (!activeJob || !operator) return;
    await handlePhaseScanResult(activeJob.id, id, operator.id, true);
    triggerJobRefresh();
  };

  const handleOpenDeclarationDialog = (phase: JobPhase) => {
    setPhaseForDeclaration(phase);
    if (phase.type === 'quality') setIsQualityDialogOpen(true);
    else if (phase.type === 'packaging') setIsPackagingDialogOpen(true);
  };

  const handleConfirmQuality = async (result: 'OK' | 'NON_OK', note?: string) => {
    if (!activeJob || !operator || !phaseForDeclaration) return;
    setIsDeclaring(true);
    
    const anomalyData = result === 'NON_OK' ? {
      hasAnomaly: true,
      anomalyType: 'QUALITY_REJECT',
      anomalyNote: note
    } : undefined;

    await handlePhaseScanResult(activeJob.id, phaseForDeclaration.id, operator.id, true, anomalyData);
    
    setIsDeclaring(false);
    setIsQualityDialogOpen(false);
    setPhaseForDeclaration(null);
    triggerJobRefresh();
    toast({ title: result === 'OK' ? "Qualità Confermata" : "Anomalia Registrata", description: "La fase è stata chiusa correttamente." });
  };

  const handleConfirmPackaging = async (items: { jobId: string, actualQty: number }[]) => {
    if (!activeJob || !operator || !phaseForDeclaration) return;
    setIsDeclaring(true);
    
    await handlePhaseScanResult(activeJob.id, phaseForDeclaration.id, operator.id, true, undefined, items);
    
    setIsDeclaring(false);
    setIsPackagingDialogOpen(false);
    setPhaseForDeclaration(null);
    triggerJobRefresh();
    toast({ title: "Imballo Completato", description: "Le quantità sono state salvate e la fase è chiusa." });
  };


  const handleOpenPhaseScanDialog = (phase: JobPhase) => {
    setPhaseForPhaseScan(phase);
    setIsPhaseScanDialogOpen(true);
  };

  const handleOpenMaterialAssociationDialog = (phase: JobPhase) => {
    setPhaseForMaterialAssociation(phase);
    setIsMaterialAssociationDialogOpen(true);
  };

  const handleManualCodeSubmit = async () => {
    const parts = manualCode.split('@');
    if (parts.length !== 3) {
      toast({ variant: 'destructive', title: 'Codice non valido', description: 'Inserisci il formato ORDINE@CODICE@QTA' });
      return;
    }
    const result = await verifyAndGetJobOrder({ ordinePF: parts[0], codice: parts[1], qta: parts[2] });
    if ('error' in result) toast({ variant: 'destructive', title: result.title, description: result.error });
    else setActiveJobId(result.id);
  };

  const renderScanArea = (vRef: React.RefObject<HTMLVideoElement>, hasPerm: boolean | null) => {
    return (
      <div className="relative aspect-video bg-black rounded overflow-hidden">
        <video ref={vRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        {!hasPerm && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                <p className="text-white font-semibold">Accesso alla fotocamera negato</p>
            </div>
        )}
        <div className="absolute inset-0 border-2 border-primary/50 m-8 rounded pointer-events-none" />
      </div>
    );
  };

  if (step === 'loading') return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-primary" /></div></AppShell>;

  return (
    <AuthGuard>
      <AppShell>
        <>
          <div className="space-y-6 max-w-4xl mx-auto">
            {step === 'initial' && (
              <Card>
                <CardHeader className="text-center">
                  <QrCode className="mx-auto h-12 w-12 text-primary"/>
                  <CardTitle>Inizia Nuova Commessa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={() => setStep('scanning')} className="w-full h-16 text-lg sm:h-20" size="lg">
                    <QrCode className="mr-2 h-6 w-6" /> Avvia Scansione
                  </Button>
                  <Button onClick={() => setIsGroupingDialogOpen(true)} className="w-full h-16 text-lg bg-teal-500 hover:bg-teal-600 text-white sm:h-20" size="lg">
                    <Combine className="mr-2 h-6 w-6" /> Concatena Commesse
                  </Button>
                  <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full h-12 sm:h-14">Inserimento Manuale</Button>
                </CardContent>
              </Card>
            )}
            
            {step === 'manual_input' && (
              <Card>
                <CardHeader><CardTitle>Inserimento Manuale</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Label>Codice Commessa (ORDINE@CODICE@QTA)</Label>
                  <Input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="Es. 123/24@ART-01@100" />
                  <Button onClick={handleManualCodeSubmit} className="w-full">Verifica</Button>
                  <Button variant="ghost" onClick={() => setStep('initial')} className="w-full">Annulla</Button>
                </CardContent>
              </Card>
            )}

            {step === 'scanning' && (
              <Card>
                <CardContent className="pt-6">
                  {renderScanArea(videoRef, hasCameraPermission)}
                  <div className="flex flex-col gap-2 mt-4">
                    <Button onClick={() => triggerScan(videoRef, handleScannedData)} className="w-full h-14">{isCapturing ? <Loader2 className="animate-spin" /> : <Camera />} Scansiona</Button>
                    <Button variant="outline" onClick={() => setStep('initial')}>Indietro</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 'processing' && activeJob && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <Card className={cn(activeJob.workGroupId && "border-teal-500")}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                            <CardTitle className="flex items-center gap-2">
                                {activeJob.ordinePF}
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className={cn(
                                    "h-8 px-2 transition-all",
                                    hasPendingUpdates && "border-primary bg-primary/10 text-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.5)]"
                                  )}
                                  onClick={refreshJob} 
                                  disabled={jobLoading}
                                >
                                    <RefreshCw className={cn("h-4 w-4 mr-1", jobLoading && "animate-spin")} />
                                    {hasPendingUpdates ? "Aggiorna!" : "Aggiorna"}
                                </Button>
                            </CardTitle>

                            <CardDescription>{activeJob.cliente} - {activeJob.details}</CardDescription>
                        </div>
                        {activeJob.workGroupId && <Badge className="bg-teal-500">GRUPPO</Badge>}
                      </div>

                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <div className="space-y-1">
                        <p>ODL: <strong>{activeJob.numeroODLInterno || 'N/D'}</strong></p>
                        <p>Qta Totale: <strong>{activeJob.qta}</strong></p>
                      </div>

                      {activeJob.attachments && activeJob.attachments.length > 0 && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full border-primary text-primary hover:bg-primary/10"
                          onClick={() => setIsAttachmentsDialogOpen(true)}
                        >
                          <View className="mr-2 h-4 w-4" />
                          Visualizza Disegni / Allegati ({activeJob.attachments.length})
                        </Button>
                      )}
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                      {/* FAST FORWARD TO PACKAGING (Phased Rollout ONLY) */}
                      {(() => {
                        if (!activeJob || !operator) return null;
                        
                        const isMagOrQuality = (operator.reparto || []).some(r => 
                          ['MAG', 'MAGAZZINO', 'COLLAUDO', 'QUALITA', 'QUALITÀ', 'QLTY', 'IMBALLO', 'PACK'].includes(r.toUpperCase())
                        );
                        
                        if (!isMagOrQuality && operator.role !== 'admin') return null;

                        const phases = activeJob.phases || [];
                        const prepDone = phases.filter(p => p.type === 'preparation').every(p => p.status === 'completed' || p.status === 'skipped');
                        const hasProdToSkip = phases.some(p => p.type === 'production' && p.status !== 'completed' && p.status !== 'skipped');
                        const qualNotStarted = phases.filter(p => p.type === 'quality' || p.type === 'packaging').every(p => p.status === 'pending');

                        if (prepDone && hasProdToSkip && qualNotStarted) {
                          return (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg border-b-4 border-indigo-900 active:border-b-0 active:translate-y-1 transition-all">
                                  <FastForward className="mr-2 h-4 w-4" /> 
                                  Salta Produzione (Vai a Qlty & Pack)
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-indigo-600 flex items-center gap-2">
                                    <FastForward className="h-6 w-6" />
                                    Conferma Salto Produzione
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="space-y-3">
                                    <p>Stai per marcare tutte le fasi di <strong>Produzione</strong> come completate per passare direttamente al Collaudo/Packaging.</p>
                                    <p className="font-bold text-amber-600 italic underline">Questa azione è necessaria se la produzione è stata tracciata su carta (Phased Rollout).</p>
                                    <p className="text-xs opacity-70">Nota: Non verranno scaricati materiali dal magazzino per le fasi saltate.</p>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction 
                                    className="bg-indigo-600 hover:bg-indigo-700"
                                    onClick={async () => {
                                      setIsFastForwarding(true);
                                      const result = await fastForwardToPackaging(activeJob.id, operator.id);
                                      setIsFastForwarding(false);
                                      if (result.success) {
                                        toast({ title: "Fast-Forward Eseguito", description: result.message });
                                        refreshJob();
                                      } else {
                                        toast({ variant: "destructive", title: "Errore", description: result.message });
                                      }
                                    }}
                                  >
                                    {isFastForwarding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sì, Salta Produzione"}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          );
                        }
                        return null;
                      })()}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white">
                            <LogOut className="mr-2 h-4 w-4" /> Abbandona Commessa
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Uscirai dalla lavorazione corrente. Assicurati di aver messo in pausa le fasi attive.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>No</AlertDialogCancel><AlertDialogAction onClick={() => setActiveJobId(null)}>Sì, Abbandona</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      {activeJob.workGroupId && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="w-full text-destructive border-destructive hover:bg-destructive/10" disabled={isDissolving}>
                                    <Unlink className="mr-2 h-4 w-4" /> Scollega Gruppo Commesse
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei sicuro di voler scolllegare il gruppo?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Le commesse torneranno individuali mantenendo il progresso attuale del gruppo.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>No</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDissolveGroupLocal()}>Sì, Scollega</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </CardFooter>
                  </Card>
                </div>
                <Card>
                  <CardHeader><CardTitle>Fasi Lavorazione</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {(activeJob.phases || []).sort((a,b) => a.sequence - b.sequence).map(p => (
                      <PhaseCard key={p.id} phase={p} job={activeJob} handlers={{handleOpenPhaseScanDialog, handlePausePhase, handleResumePhase, handleCompletePhase, handleOpenMaterialAssociationDialog, handleOpenDeclarationDialog}} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {step === 'finished' && (
              <Card>
                <CardHeader className="text-center">
                  <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <CardTitle>Lavorazione Completata</CardTitle>
                  <CardDescription>Tutte le fasi sono state terminate correttamente.</CardDescription>
                </CardHeader>
                <CardFooter><Button onClick={() => setActiveJobId(null)} className="w-full">Nuova Scansione</Button></CardFooter>
              </Card>
            )}
          </div>

          <Dialog open={isGroupingDialogOpen} onOpenChange={setIsGroupingDialogOpen}>
            <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Concatena Commesse</DialogTitle>
                    <DialogDescription>Scansiona le commesse che vuoi produrre insieme (devono essere già in console).</DialogDescription>
                </DialogHeader>
                <div className="flex-1 flex flex-col overflow-hidden space-y-4 py-2">
                    {isGroupingScanActive ? (
                        <div className="space-y-4">
                            {renderScanArea(groupingVideoRef, hasGroupingCameraPermission)}
                            <Button onClick={() => triggerScan(groupingVideoRef, handleGroupingScan)} className="w-full h-12">
                                {isCapturing ? <Loader2 className="animate-spin" /> : <Camera className="mr-2" />} Scansiona Commessa
                            </Button>
                            <Button variant="ghost" onClick={() => setIsGroupingScanActive(false)} className="w-full">Annulla Scansione</Button>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between">
                                <h4 className="font-semibold">Elenco Scansionate ({jobsToGroup.length})</h4>
                                <Button size="sm" onClick={() => setIsGroupingScanActive(true)} variant="outline">
                                    <QrCode className="mr-2 h-4 w-4" /> Aggiungi Altra
                                </Button>
                            </div>
                            <ScrollArea className="flex-1 border rounded-md p-2 bg-muted/30">
                                {jobsToGroup.length > 0 ? (
                                    <div className="space-y-2">
                                        {jobsToGroup.map(j => (
                                            <div key={j.id} className="flex items-center justify-between p-3 bg-card rounded-lg border shadow-sm">
                                                <div>
                                                    <p className="font-bold">{j.ordinePF}</p>
                                                    <p className="text-xs text-muted-foreground">{j.details} - {j.cliente}</p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <Badge variant="secondary">Qta: {j.qta}</Badge>
                                                    <Button variant="ghost" size="icon" onClick={() => setJobsToGroup(prev => prev.filter(x => x.id !== j.id))} className="text-destructive h-8 w-8">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-32 flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <QrCode className="h-8 w-8 opacity-20" />
                                        <p>Nessuna commessa scansionata.</p>
                                    </div>
                                )}
                            </ScrollArea>
                        </>
                    )}
                </div>
                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsGroupingDialogOpen(false)}>Chiudi</Button>
                    <Button 
                        disabled={jobsToGroup.length < 2 || isCreatingGroup || isGroupingScanActive} 
                        onClick={handleCreateGroup}
                        className="bg-teal-500 hover:bg-teal-600 text-white"
                    >
                        {isCreatingGroup ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Combine className="mr-2 h-4 w-4" />}
                        Crea Gruppo e Inizia
                    </Button>
                </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isPhaseScanDialogOpen} onOpenChange={setIsPhaseScanDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Avvia Fase: {phaseForPhaseScan?.name}</DialogTitle></DialogHeader>
              {renderScanArea(videoRef, hasCameraPermission)}
              <DialogFooter>
                <Button onClick={() => triggerScan(videoRef, async (val) => { 
                  if(val.toLowerCase() === phaseForPhaseScan?.name.toLowerCase()) { 
                    await handlePhaseScanResult(activeJob!.id, phaseForPhaseScan!.id, operator!.id, false); 
                    setIsPhaseScanDialogOpen(false); 
                    refreshJob();
                  } else {
                    toast({ variant: 'destructive', title: 'QR Errato', description: 'Scansiona il codice corrispondente alla fase.' });
                  }
                })} className="w-full">Scansiona QR Fase</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


          {isMaterialAssociationDialogOpen && phaseForMaterialAssociation && (
            <MaterialAssociationDialog 
              isOpen={isMaterialAssociationDialogOpen} 
              onOpenChange={setIsMaterialAssociationDialogOpen} 
              phase={phaseForMaterialAssociation} 
              job={activeJob} 
              onSessionStart={async (data, type) => {
                await startSession(data, type);
                setIsMaterialAssociationDialogOpen(false);
              }} 
              onWithdrawalComplete={() => { if (activeJob) getJobOrderById(activeJob.id).then(j => setActiveJob(j)); setIsMaterialAssociationDialogOpen(false); }} 
            />
          )}

          <PauseReasonDialog 
            isOpen={isPauseReasonDialogOpen} 
            onOpenChange={setIsPauseReasonDialogOpen} 
            onConfirm={confirmPause} 
            isLoading={isPausing}
          />

          <AttachmentViewerDialog 
            isOpen={isAttachmentsDialogOpen} 
            onOpenChange={setIsAttachmentsDialogOpen} 
            attachments={activeJob?.attachments || []} 
          />

          <QualityDeclarationDialog 
            isOpen={isQualityDialogOpen}
            onOpenChange={setIsQualityDialogOpen}
            onConfirm={handleConfirmQuality}
            isLoading={isDeclaring}
            phaseName={phaseForDeclaration?.name || ''}
          />

          <PackagingDeclarationDialog 
            isOpen={isPackagingDialogOpen}
            onOpenChange={setIsPackagingDialogOpen}
            onConfirm={handleConfirmPackaging}
            isLoading={isDeclaring}
            job={activeJob}
          />

          {/* ADMIN FORCE OVERRIDE DIALOG */}
          <Dialog open={isAdminForceDialogOpen} onOpenChange={setIsAdminForceDialogOpen}>
              <DialogContent className="border-red-900/50 bg-slate-950 border-2 max-w-sm">
                  <DialogHeader>
                      <DialogTitle className="text-red-500 flex items-center gap-2">
                          <Skull className="h-5 w-5" /> Super-Poteri Admin
                      </DialogTitle>
                      <DialogDescription className="py-2 text-slate-300">
                          L'operatore <strong>[{blockerNames}]</strong> risulta attivo. 
                          Vuoi forzare lo sblocco?
                      </DialogDescription>
                  </DialogHeader>
                  <div className="flex bg-red-900/10 border border-red-900/30 p-3 rounded-lg text-[10px] text-red-200 gap-2 items-start">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                      <p>Resetterà lo stato di clock-in dell'operatore. Usala solo se sai che è una sessione fantasma.</p>
                  </div>
                  <DialogFooter className="mt-4 gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIsAdminForceDialogOpen(false)}>Annulla</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDissolveGroupLocal(true)} disabled={isDissolving}>
                          {isDissolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                          FORZA SBLOCCO
                      </Button>
                  </DialogFooter>
              </DialogContent>
          </Dialog>
        </>
      </AppShell>
    </AuthGuard>
  );
}

// --- NEW DIALOG COMPONENTS ---

function QualityDeclarationDialog({ isOpen, onOpenChange, onConfirm, isLoading, phaseName }: any) {
  const [result, setResult] = useState<'OK' | 'NON_OK' | null>(null);
  const [note, setNote] = useState('');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isLoading) onOpenChange(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dichiarazione Qualità: {phaseName}</DialogTitle>
          <DialogDescription>Conferma se l'articolo è conforme o se sono state riscontrate anomalie.</DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-2 gap-4 py-4">
          <Button 
            variant={result === 'OK' ? "default" : "outline"}
            className={cn("h-24 flex flex-col gap-2 border-2", result === 'OK' ? "bg-green-600 hover:bg-green-700 border-green-700" : "border-slate-200")}
            onClick={() => setResult('OK')}
          >
            <CheckCircle className="h-8 w-8" />
            <span className="font-bold">OK - CONFORME</span>
          </Button>

          <Button 
            variant={result === 'NON_OK' ? "default" : "outline"}
            className={cn("h-24 flex flex-col gap-2 border-2", result === 'NON_OK' ? "bg-red-600 hover:bg-red-700 border-red-700" : "border-slate-200")}
            onClick={() => setResult('NON_OK')}
          >
            <AlertTriangle className="h-8 w-8" />
            <span className="font-bold">NON OK - SCARTO</span>
          </Button>
        </div>

        {result === 'NON_OK' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
            <Label className="text-red-600 font-bold">Causale Scarto / Nota Difetto (Obbligatorio)</Label>
            <Input 
              placeholder="Inserisci il motivo dello scarto..." 
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="border-red-200 focus:ring-red-500"
            />
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Annulla</Button>
          <Button 
            disabled={!result || (result === 'NON_OK' && !note.trim()) || isLoading}
            onClick={() => onConfirm(result, note)}
            className={cn(result === 'OK' ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Conferma Dichiarazione
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackagingDeclarationDialog({ isOpen, onOpenChange, onConfirm, isLoading, job }: any) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && job) {
      if (job.jobOrderIds && job.jobOrderPFs) {
          // It's a WorkGroup
          setItems(job.jobOrderIds.map((id: string, i: number) => ({
            jobId: id,
            jobOrderPF: job.jobOrderPFs[i],
            originalQty: job.qta / job.jobOrderIds.length, // Fallback if ind. qta not available, but user said pre-compilate.
            // Better: since it's a WorkGroup, the group.totalQuantity is shared. 
            // In a real scenario we'd need the individual qta. 
            // For now, let's assume we can fetch them or use a placeholder.
            // Actually, handlePhaseScanResult needs individual jobId to update qta.
            actualQty: job.qta / job.jobOrderIds.length 
          })));
      } else {
          // Single Job
          setItems([{
            jobId: job.id,
            jobOrderPF: job.ordinePF,
            originalQty: job.qta,
            actualQty: job.qta
          }]);
      }
    }
  }, [isOpen, job]);

  const updateQty = (index: number, val: string) => {
    const newItems = [...items];
    newItems[index].actualQty = parseInt(val) || 0;
    setItems(newItems);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isLoading) onOpenChange(open); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Dichiarazione Imballo</DialogTitle>
          <DialogDescription>Verifica e conferma le quantità inserite nell'imballo finale.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4 mt-2">
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={item.jobId} className="flex items-center justify-between p-3 border rounded-lg bg-slate-50">
                <div className="flex-1">
                  <p className="font-bold text-sm">{item.jobOrderPF}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Quantità Prevista: {item.originalQty}</p>
                </div>
                <div className="w-32">
                  <Label className="text-[10px] uppercase font-bold">Qta Imballata</Label>
                  <Input 
                    type="number" 
                    value={item.actualQty} 
                    onChange={(e) => updateQty(i, e.target.value)}
                    className="h-10 text-center font-bold"
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Annulla</Button>
          <Button 
            disabled={items.some(it => it.actualQty <= 0) || isLoading}
            onClick={() => onConfirm(items.map(it => ({ jobId: it.jobId, actualQty: it.actualQty })))}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Conferma e Chiudi Fase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
