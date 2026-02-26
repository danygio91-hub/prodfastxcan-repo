"use client";

import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react';
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
import { QrCode, CheckCircle, AlertTriangle, Package, ListChecks, PlayCircle, PauseCircle as PausePhaseIcon, CheckCircle2 as PhaseCompletedIcon, Circle, Hourglass, PowerOff, PackageCheck, PackageX, Activity, ShieldAlert, Loader2, Boxes, Keyboard, Send, UserCheck, ScanLine, Camera, MoveLeft, ThumbsDown, ThumbsUp, Link as LinkIcon, Unlink, ArchiveRestore, EyeOff, RefreshCcw, Unlock, Users } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import type { JobOrder, JobPhase, WorkPeriod, WorkGroup } from '@/lib/mock-data';
import { verifyAndGetJobOrder, updateJob, getJobOrderById, handlePhaseScanResult, isOperatorActiveOnAnyJob, createWorkGroup, updateWorkGroup, postponeQualityPhase, reportMaterialMissing, updateOperatorStatus, resolveJobProblem, dissolveWorkGroup } from './actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import MaterialAssociationDialog from './MaterialAssociationDialog';

const problemReportSchema = z.object({
  problemType: z.enum(["FERMO_MACCHINA", "MANCA_MATERIALE", "PROBLEMA_QUALITA", "ALTRO"]).optional(),
  notes: z.string().max(150, { message: "Max 150 caratteri." }).optional(),
});
type ProblemReportFormValues = z.infer<typeof problemReportSchema>;

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
    const otherActive = (phase.workPeriods || []).some(wp => wp.operatorId !== operator.id && wp.end === null);
    
    return (
      <Card className={cn("p-4 bg-card/50", !hasPerm && 'opacity-60 bg-muted/30')}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center">{getPhaseIcon(phase.status, phase.qualityResult)}<span className="font-semibold ml-2">{phase.name}</span></div>
            <div className="flex items-center space-x-2"><Label className="text-sm">Mat. Pronto:</Label>{phase.materialReady ? <PackageCheck className="h-5 w-5 text-green-500" /> : <PackageX className="h-5 w-5 text-red-500" />}</div>
          </div>
          {isOwner && <p className="text-xs text-green-500 font-semibold mt-2 flex items-center gap-1"><UserCheck className="h-4 w-4" />Stai lavorando qui.</p>}
          {otherActive && <p className="text-xs text-blue-500 font-semibold mt-2">Altri operatori attivi.</p>}
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(phase.materialConsumptions || []).map((mc, i) => <p key={i} className="bg-primary/5 p-1 rounded">Materiale: {mc.materialCode} {mc.lottoBobina && ` - Lotto: ${mc.lottoBobina}`}</p>)}
            {phase.type !== 'quality' && <p>Tempo effettivo: {calculateTotalActiveTime(phase.workPeriods || [])}</p>}
          </div>
          <div className="mt-3 flex gap-2">
            {hasPerm && phase.type === 'preparation' && <Button size="sm" onClick={() => handlers.handleOpenMaterialAssociationDialog(phase)}>Associa Materiale</Button>}
            {canStart && phase.type !== 'quality' && <Button size="sm" onClick={() => handlers.handleOpenPhaseScanDialog(phase)} variant="outline"><QrCode className="mr-2 h-4 w-4" /> Avvia</Button>}
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
  const { activeSessions, startSession } = useActiveMaterialSession();
  const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'processing' | 'finished' | 'loading' | 'group_scanning'>('loading');
  const [isPending, startTransition] = useTransition();
  const [groupScanList, setGroupScanList] = useState<JobOrder[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [isProblemReportDialogOpen, setIsProblemReportDialogOpen] = useState(false);
  const [isPhaseScanDialogOpen, setIsPhaseScanDialogOpen] = useState(false);
  const [phaseForPhaseScan, setPhaseForPhaseScan] = useState<JobPhase | null>(null);
  const [isContinueOrCloseDialogOpen, setIsContinueOrCloseDialogOpen] = useState(false);
  const [jobToFinalize, setJobToFinalize] = useState<JobOrder | null>(null);
  const [materialMissingPhase, setMaterialMissingPhase] = useState<JobPhase | null>(null);
  const [isMaterialAssociationDialogOpen, setIsMaterialAssociationDialogOpen] = useState(false);
  const [phaseForMaterialAssociation, setPhaseForMaterialAssociation] = useState<JobPhase | null>(null);

  const problemForm = useForm<ProblemReportFormValues>({ resolver: zodResolver(problemReportSchema) });

  const forceJobDataRefresh = useCallback(async (jobId: string) => {
    const fresh = await getJobOrderById(jobId);
    if (fresh) setActiveJob(fresh);
  }, [setActiveJob]);

  useEffect(() => { if (!isJobLoading) setStep(activeJob ? (activeJob.status === 'completed' ? 'finished' : 'processing') : 'initial'); }, [isJobLoading, activeJob]);

  const startCamera = useCallback(async () => {
    setHasCameraPermission(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch (error) { setHasCameraPermission(false); toast({ variant: 'destructive', title: 'Errore Fotocamera' }); }
  }, [toast]);

  const stopCamera = useCallback(() => { if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; } }, []);

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

  if (step === 'loading') return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-4xl mx-auto">
          {step === 'initial' && (
            <Card><CardHeader><CardTitle>Scansione Commessa</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={() => setStep('scanning')} className="w-full" size="lg"><QrCode className="mr-2" /> Avvia Scansione</Button>
                <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full"><Keyboard className="mr-2" /> Manuale</Button>
              </CardContent>
            </Card>
          )}
          {step === 'scanning' && (
            <Card><CardContent className="pt-6">{renderScanArea(handleScannedData)}<Button onClick={() => triggerScan(handleScannedData)} className="w-full mt-4 h-14">{isCapturing ? <Loader2 className="animate-spin" /> : <Camera />} Scansiona</Button></CardContent></Card>
          )}
          {step === 'processing' && activeJob && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle>{activeJob.ordinePF}</CardTitle><CardDescription>{activeJob.cliente} - {activeJob.details}</CardDescription></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>ODL: {activeJob.numeroODLInterno || 'N/D'}</p><p>Qta: <strong>{activeJob.qta}</strong></p>
                </CardContent>
              </Card>
              <Card><CardHeader><CardTitle>Fasi Lavorazione</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {activeJob.phases.sort((a,b) => a.sequence - b.sequence).map(p => (
                    <PhaseCard key={p.id} phase={p} job={activeJob} handlers={{handleOpenPhaseScanDialog, handleMaterialMissing: () => setMaterialMissingPhase(p), handlePausePhase, handleResumePhase, handleCompletePhase, handleOpenMaterialAssociationDialog}} />
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
          {step === 'finished' && <Card><CardHeader><CardTitle>Completata</CardTitle></CardHeader><CardFooter><Button onClick={() => setActiveJobId(null)}>Nuova Scansione</Button></CardFooter></Card>}
        </div>
        <Dialog open={isPhaseScanDialogOpen} onOpenChange={setIsPhaseScanDialogOpen}>
          <DialogContent><DialogHeader><DialogTitle>Scansione Fase</DialogTitle></DialogHeader>
            {renderScanArea((val) => { if(val.toLowerCase() === phaseForPhaseScan?.name.toLowerCase()) { handlePhaseScanResult(activeJob!.id, phaseForPhaseScan!.id, operator!.id); setIsPhaseScanDialogOpen(false); } })}
            <Button onClick={() => triggerScan((val) => { if(val.toLowerCase() === phaseForPhaseScan?.name.toLowerCase()) { handlePhaseScanResult(activeJob!.id, phaseForPhaseScan!.id, operator!.id); setIsPhaseScanDialogOpen(false); } })}>Scansiona</Button>
          </DialogContent>
        </Dialog>
        {isMaterialAssociationDialogOpen && phaseForMaterialAssociation && (
          <MaterialAssociationDialog isOpen={isMaterialAssociationDialogOpen} onOpenChange={setIsMaterialAssociationDialogOpen} phase={phaseForMaterialAssociation} job={activeJob} onSessionStart={(sd, t) => { startSession(sd, t); setIsMaterialAssociationDialogOpen(false); }} onWithdrawalComplete={() => { forceJobDataRefresh(activeJob!.id); setIsMaterialAssociationDialogOpen(false); }} />
        )}
      </AppShell>
    </AuthGuard>
  );

  function renderScanArea(onScan: any) {
    return (
      <div className="relative aspect-video bg-black rounded overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        <div className="absolute inset-0 border-2 border-primary/50 m-8 rounded" />
      </div>
    );
  }
}
