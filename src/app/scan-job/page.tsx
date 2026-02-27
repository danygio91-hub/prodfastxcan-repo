"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { QrCode, CheckCircle, AlertTriangle, Package, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert, Loader2, Boxes, Keyboard, Send, UserCheck, ScanLine, Camera, LogOut, EyeOff, RefreshCcw, Unlock } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import type { JobOrder, JobPhase, WorkPeriod } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob, getJobOrderById, handlePhaseScanResult, isOperatorActiveOnAnyJob, updateOperatorStatus } from './actions';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { cn } from '@/lib/utils';
import MaterialAssociationDialog from './MaterialAssociationDialog';

function calculateTotalActiveTime(workPeriods: WorkPeriod[]): string {
  let total = 0;
  workPeriods.forEach(p => { if (p.end) total += new Date(p.end).getTime() - new Date(p.start).getTime(); });
  if (total === 0) return workPeriods.some(p => p.end === null) ? "Iniziata" : "0s";
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

function getPhaseIcon(status: JobPhase['status'], qualityResult?: JobPhase['qualityResult']) {
  if (status === 'completed') return <PhaseCompletedIcon className="h-4 w-4 text-green-500" />;
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-yellow-500 animate-spin" />;
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
            <div className="flex items-center">{getPhaseIcon(phase.status, phase.qualityResult)}<span className="font-semibold ml-2">{phase.name}</span></div>
            <div className="flex items-center space-x-2"><Label className="text-sm">Mat. Pronto:</Label>{phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}</div>
          </div>
          {isOwner && <p className="text-xs text-green-500 font-semibold mt-2 flex items-center gap-1"><UserCheck className="h-4 w-4" />Stai lavorando qui.</p>}
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
  const { activeJob, setActiveJob, setActiveJobId, isLoading: isJobLoading, setIsStatusBarHighlighted } = useActiveJob();
  const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'processing' | 'finished' | 'loading'>('loading');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);
  const [isMaterialAssociationDialogOpen, setIsMaterialAssociationDialogOpen] = useState(false);
  const [phaseForMaterialAssociation, setPhaseForMaterialAssociation] = useState<JobPhase | null>(null);

  useEffect(() => { 
    if (!isJobLoading) {
      setStep(activeJob ? (activeJob.status === 'completed' ? 'finished' : 'processing') : 'initial');
    }
  }, [isJobLoading, activeJob]);

  const stopCamera = useCallback(() => { 
    if (streamRef.current) { 
      streamRef.current.getTracks().forEach(t => t.stop()); 
      streamRef.current = null; 
    } 
  }, []);

  const triggerScan = useCallback(async (onScan: (data: string) => void) => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      setIsCapturing(true);
      try {
          const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) onScan(codes[0].rawValue);
          else toast({ variant: 'destructive', title: 'Nessun Codice' });
      } catch (e) { toast({ variant: 'destructive', title: 'Errore Scansione' }); }
      finally { setIsCapturing(false); }
  }, [toast]);

  const handleScannedData = useCallback(async (data: string) => {
    stopCamera();
    const parts = data.split('@');
    if (parts.length !== 3) { toast({ variant: 'destructive', title: 'QR non Valido' }); return; }
    const result = await verifyAndGetJobOrder({ ordinePF: parts[0], codice: parts[1], qta: parts[2] });
    if ('error' in result) toast({ variant: 'destructive', title: result.title, description: result.error });
    else setActiveJobId(result.id);
  }, [toast, stopCamera, setActiveJobId]);

  const handlePausePhase = (id: string) => {
    if (!activeJob || !operator) return;
    const job = JSON.parse(JSON.stringify(activeJob));
    const p = job.phases.find((p:any) => p.id === id);
    if (!p || p.status !== 'in-progress') return;
    const wpIdx = p.workPeriods.findIndex((wp:any) => wp.operatorId === operator.id && wp.end === null);
    if (wpIdx !== -1) { p.workPeriods[wpIdx].end = new Date(); if (!p.workPeriods.some((wp:any) => wp.end === null)) p.status = 'paused'; }
    updateOperatorStatus(operator.id, job.id, null);
    updateJob(job);
  };

  const handleResumePhase = async (id: string) => {
      if (!activeJob || !operator) return;
      const avail = await isOperatorActiveOnAnyJob(operator.id, activeJob.id.startsWith('group-') ? activeJob.id : undefined);
      if (!avail.available) { setIsStatusBarHighlighted(true); return; }
      const job = JSON.parse(JSON.stringify(activeJob));
      const p = job.phases.find((p:any) => p.id === id);
      p.status = 'in-progress'; job.status = 'production';
      if (!p.workPeriods) p.workPeriods = [];
      p.workPeriods.push({ start: new Date(), end: null, operatorId: operator.id });
      await updateOperatorStatus(operator.id, job.id, p.name);
      updateJob(job);
  };

  const handleCompletePhase = (id: string) => {
    if (!activeJob || !operator) return;
    const job = JSON.parse(JSON.stringify(activeJob));
    const p = job.phases.find((p:any) => p.id === id);
    const wpIdx = p.workPeriods.findIndex((wp:any) => wp.operatorId === operator.id && wp.end === null);
    if (wpIdx !== -1) p.workPeriods[wpIdx].end = new Date();
    if (!p.workPeriods.some((wp:any) => wp.end === null)) p.status = 'completed';
    updateOperatorStatus(operator.id, job.id, null);
    updateJob(job);
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

  const renderScanArea = (onScan: any) => {
    return (
      <div className="relative aspect-video bg-black rounded overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        <div className="absolute inset-0 border-2 border-primary/50 m-8 rounded" />
      </div>
    );
  };

  if (step === 'loading') return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-primary" /></div></AppShell>;

  return (
    <>
      <AuthGuard>
        <AppShell>
          <div className="space-y-6 max-w-4xl mx-auto">
            {step === 'initial' && (
              <Card>
                <CardHeader className="text-center">
                  <QrCode className="mx-auto h-12 w-12 text-primary"/>
                  <CardTitle>Inizia Nuova Commessa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={() => setStep('scanning')} className="w-full h-16 text-lg" size="lg">Avvia Scansione</Button>
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
                  {renderScanArea(handleScannedData)}
                  <div className="flex flex-col gap-2 mt-4">
                    <Button onClick={() => triggerScan(handleScannedData)} className="w-full h-14">{isCapturing ? <Loader2 className="animate-spin" /> : <Camera />} Scansiona</Button>
                    <Button variant="outline" onClick={() => setStep('initial')}>Indietro</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 'processing' && activeJob && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>{activeJob.ordinePF}</CardTitle>
                      <CardDescription>{activeJob.cliente} - {activeJob.details}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>ODL: <strong>{activeJob.numeroODLInterno || 'N/D'}</strong></p>
                      <p>Qta: <strong>{activeJob.qta}</strong></p>
                    </CardContent>
                    <CardFooter>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="destructive" className="w-full"><LogOut className="mr-2 h-4 w-4" /> Abbandona Commessa</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Uscirai dalla lavorazione corrente. Assicurati di aver messo in pausa le fasi attive.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>No</AlertDialogCancel><AlertDialogAction onClick={() => setActiveJobId(null)}>Sì, Abbandona</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardFooter>
                  </Card>
                </div>
                <Card>
                  <CardHeader><CardTitle>Fasi Lavorazione</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {activeJob.phases.sort((a,b) => a.sequence - b.sequence).map(p => (
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
        </AppShell>
      </AuthGuard>

      <Dialog open={isPhaseScanDialogOpen} onOpenChange={setIsPhaseScanDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Avvia Fase: {phaseForPhaseScan?.name}</DialogTitle></DialogHeader>
          {renderScanArea(() => {})}
          <DialogFooter>
            <Button onClick={() => triggerScan((val) => { 
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
          onSessionStart={() => setIsMaterialAssociationDialogOpen(false)} 
          onWithdrawalComplete={() => { if (activeJob) getJobOrderById(activeJob.id).then(j => setActiveJob(j)); setIsMaterialAssociationDialogOpen(false); }} 
        />
      )}
    </>
  );
}
