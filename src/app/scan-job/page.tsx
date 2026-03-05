
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
import { QrCode, CheckCircle, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle, Hourglass, PackageCheck, PackageX, Loader2, Camera, LogOut, EyeOff, AlertTriangle, Combine, Trash2, Check, ArrowLeft, Unlink, View } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { JobOrder, JobPhase, WorkPeriod, ActiveMaterialSessionData, RawMaterialType, WorkGroup } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob, getJobOrderById, handlePhaseScanResult, isOperatorActiveOnAnyJob, updateOperatorStatus, createWorkGroup, dissolveWorkGroup, updateWorkGroup } from './actions';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import { cn } from '@/lib/utils';
import MaterialAssociationDialog from './MaterialAssociationDialog';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

function calculateTotalActiveTime(workPeriods: WorkPeriod[]): string {
  let total = 0;
  workPeriods.forEach(p => { if (p.end) total += new Date(p.end).getTime() - new Date(p.start).getTime(); });
  if (total === 0) return workPeriods.some(p => p.end === null) ? "Iniziata" : "0s";
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

function getPhaseIcon(status: JobPhase['status']) {
  if (status === 'completed') return <PhaseCompletedIcon className="h-4 w-4 text-green-500" />;
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'paused': return <PausePhaseIcon className="h-4 w-4 text-orange-500" />;
    case 'skipped': return <EyeOff className="h-4 w-4 text-muted-foreground" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

const PhaseCard = ({ phase, job, handlers }: { phase: JobPhase, job: JobOrder, handlers: any }) => {
    const { operator } = useAuth();
    if (!operator) return null;
    const isSuper = operator.role === 'supervisor';
    const operatorReparti = operator.reparto || [];
    const hasPerm = isSuper || (phase.departmentCodes || []).some(dc => operatorReparti.includes(dc));
    const isOwner = (phase.workPeriods || []).some(wp => wp.operatorId === operator.id && wp.end === null);
    const canStart = hasPerm && phase.status === 'pending' && phase.materialReady;
    const canPause = !job.isProblemReported && phase.status === 'in-progress' && isOwner;
    const canResume = hasPerm && !job.isProblemReported && (phase.status === 'paused' || (phase.status === 'in-progress' && !isOwner));
    const canComplete = (phase.status === 'in-progress' || phase.status === 'paused') && isOwner;
    
    return (
      <Card className={cn("p-4 bg-card/50", !hasPerm && 'opacity-60 bg-muted/30')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">{getPhaseIcon(phase.status)}<span className="font-semibold ml-2">{phase.name}</span></div>
            <div className="flex items-center space-x-2"><Label className="text-sm">Mat. Pronto:</Label>{phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}</div>
          </div>
          {isOwner && <p className="text-xs text-green-500 font-semibold mt-2 flex items-center gap-1">Stai lavorando qui.</p>}
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(phase.materialConsumptions || []).map((mc, i) => <p key={i}>Materiale: {mc.materialCode} {mc.lottoBobina && ` - Lotto: ${mc.lottoBobina}`}</p>)}
            {phase.type !== 'quality' && <p>Tempo effettivo: {calculateTotalActiveTime(phase.workPeriods || [])}</p>}
          </div>
          <div className="mt-3 flex gap-2">
            {hasPerm && phase.type === 'preparation' && <Button size="sm" onClick={() => handlers.handleOpenMaterialAssociationDialog(phase)}>Associa Materiale</Button>}
            {canStart && <Button size="sm" onClick={() => handlers.handleOpenPhaseScanDialog(phase)} variant="outline"><QrCode className="mr-2 h-4 w-4" /> Avvia</Button>}
            {canPause && <Button size="sm" onClick={() => handlers.handlePausePhase(phase.id)} variant="outline" className="text-orange-500 border-orange-500">Pausa</Button>}
            {canResume && <Button size="sm" onClick={() => handlers.handleResumePhase(phase.id)} variant="outline" className="text-yellow-500 border-yellow-500">Riprendi</Button>}
            {canComplete && <Button size="sm" onClick={() => handlers.handleCompletePhase(phase.id)} className="bg-green-600 hover:bg-green-700">Completa</Button>}
          </div>
      </Card>
    );
};

export default function ScanJobPage() {
  const { toast } = useToast();
  const { operator } = useAuth();
  const { activeJob, setActiveJob, setActiveJobId, isLoading: isJobLoading } = useActiveJob();
  const { startSession } = useActiveMaterialSession();
  
  const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'processing' | 'finished' | 'loading'>('loading');
  const [isCapturing, setIsCapturing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);
  const [isMaterialAssociationDialogOpen, setIsMaterialAssociationDialogOpen] = useState(false);
  const [phaseForMaterialAssociation, setPhaseForMaterialAssociation] = useState<JobPhase | null>(null);

  const [isGroupingDialogOpen, setIsGroupingDialogOpen] = useState(false);
  const [isGroupingScanActive, setIsGroupingScanActive] = useState(false);
  const [jobsToGroup, setJobsToGroup] = useState<JobOrder[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isDissolving, setIsDissolving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const groupingVideoRef = useRef<HTMLVideoElement>(null);

  const { hasPermission: hasCameraPermission } = useCameraStream(step === 'scanning' || isPhaseScanDialogOpen, videoRef);
  const { hasPermission: hasGroupingCameraPermission } = useCameraStream(isGroupingScanActive, groupingVideoRef);

  useEffect(() => { 
    if (!isJobLoading) {
      setStep(activeJob ? (activeJob.status === 'completed' ? 'finished' : 'processing') : 'initial');
    }
  }, [isJobLoading, activeJob]);

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
    }
  };

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

  const handleDissolveGroupLocal = async () => {
    if (!activeJob?.workGroupId) return;
    
    const isAnyActive = activeJob.phases.some(p => p.status === 'in-progress');
    if (isAnyActive) {
        toast({ 
            variant: "destructive", 
            title: "Operazione Bloccata", 
            description: "Metti in pausa tutte le fasi attive prima di scollegare il gruppo." 
        });
        return;
    }

    setIsDissolving(true);
    const result = await dissolveWorkGroup(activeJob.workGroupId);
    if (result.success) {
        toast({ title: "Gruppo Scollegato", description: "Le commesse sono tornate individuali." });
        setActiveJobId(null);
    } else {
        toast({ variant: "destructive", title: "Errore", description: result.message });
    }
    setIsDissolving(false);
  };

  const handlePausePhase = async (id: string) => {
    if (!activeJob || !operator) return;
    const job = JSON.parse(JSON.stringify(activeJob));
    const p = job.phases.find((p:any) => p.id === id);
    if (!p || p.status !== 'in-progress') return;
    
    const myWorkPeriodIndex = p.workPeriods.findIndex((wp:any) => wp.operatorId === operator.id && wp.end === null);
    if (myWorkPeriodIndex !== -1) { 
        p.workPeriods[myWorkPeriodIndex].end = new Date(); 
        if (!p.workPeriods.some((wp:any) => wp.end === null)) p.status = 'paused'; 
    }
    
    await updateOperatorStatus(operator.id, null, null);
    handleUpdateJobOrGroup(job);
  };

  const handleResumePhase = async (id: string) => {
      if (!activeJob || !operator) return;
      
      const avail = await isOperatorActiveOnAnyJob(operator.id, activeJob.id);
      if (!avail.available) {
          toast({ variant: 'destructive', title: 'Operatore Occupato', description: `Sei già attivo sulla commessa ${avail.activeJobId} nella fase ${avail.activePhaseName}.` });
          return;
      }

      const job = JSON.parse(JSON.stringify(activeJob));
      const p = job.phases.find((p:any) => p.id === id);
      if (!p) return;

      p.status = 'in-progress'; 
      job.status = 'production';
      
      if (!p.workPeriods) p.workPeriods = [];
      p.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
      
      await updateOperatorStatus(operator.id, job.id, p.name);
      handleUpdateJobOrGroup(job);
  };

  const handleCompletePhase = async (id: string) => {
    if (!activeJob || !operator) return;
    const job = JSON.parse(JSON.stringify(activeJob));
    const p = job.phases.find((p:any) => p.id === id);
    if (!p) return;

    const myWorkPeriodIndex = p.workPeriods.findIndex((wp:any) => wp.operatorId === operator.id && wp.end === null);
    if (myWorkPeriodIndex !== -1) p.workPeriods[myWorkPeriodIndex].end = new Date();
    
    if (!p.workPeriods.some((wp:any) => wp.end === null)) p.status = 'completed';
    
    await updateOperatorStatus(operator.id, null, null);
    handleUpdateJobOrGroup(job);
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
                  <Button onClick={() => setStep('scanning')} className="w-full h-16 text-lg" size="lg">Avvia Scansione</Button>
                  <Button onClick={() => setIsGroupingDialogOpen(true)} className="w-full h-16 text-lg bg-teal-500 hover:bg-teal-600 text-white" size="lg">
                    <Combine className="mr-2 h-6 w-6" /> Concatena Commesse
                  </Button>
                  <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full h-12">Inserimento Manuale</Button>
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
                        <div>
                            <CardTitle>{activeJob.ordinePF}</CardTitle>
                            <CardDescription>{activeJob.cliente} - {activeJob.details}</CardDescription>
                        </div>
                        {activeJob.workGroupId && <Badge className="bg-teal-500">GRUPPO</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>ODL: <strong>{activeJob.numeroODLInterno || 'N/D'}</strong></p>
                      <p>Qta Totale: <strong>{activeJob.qta}</strong></p>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
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
                                    <AlertDialogAction onClick={handleDissolveGroupLocal}>Sì, Scollega</AlertDialogAction>
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
                      <PhaseCard key={p.id} phase={p} job={activeJob} handlers={{handleOpenPhaseScanDialog, handlePausePhase, handleResumePhase, handleCompletePhase, handleOpenMaterialAssociationDialog}} />
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
                <Button onClick={() => triggerScan(videoRef, (val) => { 
                  if(val.toLowerCase() === phaseForPhaseScan?.name.toLowerCase()) { 
                    handlePhaseScanResult(activeJob!.id, phaseForPhaseScan!.id, operator!.id); 
                    setIsPhaseScanDialogOpen(false); 
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
              onSessionStart={(data, type) => {
                startSession(data, type);
                setIsMaterialAssociationDialogOpen(false);
              }} 
              onWithdrawalComplete={() => { if (activeJob) getJobOrderById(activeJob.id).then(j => setActiveJob(j)); setIsMaterialAssociationDialogOpen(false); }} 
            />
          )}
        </>
      </AppShell>
    </AuthGuard>
  );
}
