
import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Wrench, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, AlertTriangle as AlertTriangleIcon, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2, ClipboardList, Factory, Pause, Users, Link as LinkIcon, PowerOff, RefreshCcw, EyeOff, ListOrdered } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import Link from 'next/link';
import { it } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import React, { useState, useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '../ui/label';
import { Badge } from '@/components/ui/badge';
import { updatePhasesForJob } from '@/app/admin/production-console/actions';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';


interface ActivePhaseInfo {
  phaseId: string;
  phaseName: string;
  operators: { id: string; name: string }[];
}


function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  const allPhases = jobOrder.phases || [];
  const allPhasesCompleted = allPhases.length > 0 && allPhases.every(p => p.status === 'completed' || p.status === 'skipped');

  if (allPhasesCompleted || jobOrder.status === 'completed') {
      return 'Completata';
  }

  // Priority 1: Terminal/Blocking states (after completion check)
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended' || jobOrder.status === 'paused') return 'Sospesa';

  // Check phases
  const preparationPhases = allPhases.filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = allPhases.filter(p => (p.type ?? 'production') === 'production');
  const finishingPhases = allPhases.filter(p => p.type === 'quality' || p.type === 'packaging');
  
  const isAnyFinishingActive = finishingPhases.some(p => p.status !== 'pending');
  if (isAnyFinishingActive) return 'In Lavorazione';

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) return 'In Lavorazione';
  
  const allPreparationDone = preparationPhases.every(p => p.status === 'completed' || p.status === 'skipped');

  if (allPreparationDone) {
    const allProductionSkippedOrDone = productionPhases.every(p => p.status === 'completed' || p.status === 'skipped');
    if (allProductionSkippedOrDone) {
        return 'Pronto per Finitura';
    }
     const isAnyProductionStarted = productionPhases.some(p => p.status !== 'pending');
      if (isAnyProductionStarted) {
         return 'In Lavorazione';
      }
      return 'Pronto per Produzione';
  }
  
  const isAnyPreparationStarted = preparationPhases.some(p => p.status !== 'pending');
  if (isAnyPreparationStarted) {
    return 'In Preparazione';
  }
  
  // Default state if no other condition is met
  return 'Da Iniziare';
}


function getCurrentPhase(phases: JobPhase[]): JobPhase | undefined {
  // Prioritize in-progress over paused for display
  return phases.find(p => p.status === 'in-progress') || phases.find(p => p.status === 'paused');
}

function getPhaseIcon(status: JobPhase['status']) {
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'paused': return <PauseCircle className="h-4 w-4 text-orange-500" />;
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case 'skipped': return <EyeOff className="h-4 w-4 text-muted-foreground" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function JobOrderCard({ 
    jobOrder,
    workGroup, 
    allOperators,
    isSelected,
    onSelect,
    onProblemClick, 
    onForceFinishClick,
    onRevertForceFinishClick,
    onToggleGuainaClick, 
    onRevertPhaseClick, 
    onForcePauseClick,
    onForceCompleteClick,
    onResetJobOrderClick,
}: { 
    jobOrder: JobOrder;
    workGroup?: WorkGroup | null; 
    allOperators: Operator[];
    isSelected: boolean;
    onSelect: (jobId: string) => void;
    onProblemClick: () => void; 
    onForceFinishClick: (jobId: string) => void;
    onRevertForceFinishClick: (jobId: string) => void;
    onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; 
    onRevertPhaseClick: (jobId: string, phaseId: string) => void; 
    onForcePauseClick: (jobId: string, operatorIds: string[]) => void; 
    onForceCompleteClick: (jobId: string) => void;
    onResetJobOrderClick: (jobId: string) => void;
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [isPhaseManagerOpen, setIsPhaseManagerOpen] = useState(false);
  const [editablePhases, setEditablePhases] = useState<JobPhase[]>([]);
  const [selectedOperatorsToPause, setSelectedOperatorsToPause] = useState<string[]>([]);
  
  const { user } = useAuth();
  const { toast } = useToast();
  
  const activePhasesWithOperators = useMemo((): ActivePhaseInfo[] => {
    const activePhasesMap = new Map<string, ActivePhaseInfo>();
    const source = (jobOrder.id.startsWith('group-') && workGroup) ? workGroup : jobOrder;
    
    if (!source) return [];

    (source.phases || []).forEach(phase => {
        if (phase.status === 'in-progress') {
            const phaseOperators: ActivePhaseInfo['operators'] = [];
            (phase.workPeriods || []).forEach(wp => {
                if (wp.end === null) {
                    const operator = allOperators.find(op => op.id === wp.operatorId);
                    if (operator) {
                        phaseOperators.push({ id: operator.id, name: operator.nome });
                    }
                }
            });

            if (phaseOperators.length > 0) {
                if (!activePhasesMap.has(phase.id)) {
                    activePhasesMap.set(phase.id, {
                        phaseId: phase.id,
                        phaseName: phase.name,
                        operators: [],
                    });
                }
                activePhasesMap.get(phase.id)!.operators.push(...phaseOperators);
            }
        }
    });

    return Array.from(activePhasesMap.values());
  }, [jobOrder, workGroup, allOperators]);
  
  const handleOpenPauseDialog = () => {
    setSelectedOperatorsToPause([]); // Reset selection
    setIsPauseDialogOpen(true);
  };

  const handleOpenPhaseManager = () => {
    setEditablePhases(jobOrder.phases);
    setIsPhaseManagerOpen(true);
  };
  
  const handleConfirmPause = () => {
    if (selectedOperatorsToPause.length > 0) {
      onForcePauseClick(jobOrder.id, selectedOperatorsToPause);
    }
    setIsPauseDialogOpen(false);
  };

  const toggleOperatorSelection = (opId: string) => {
    setSelectedOperatorsToPause(prev =>
      prev.includes(opId) ? prev.filter(currentId => currentId !== opId) : [...prev, opId]
    );
  };

  const toggleSelectAll = () => {
    const allActiveOperatorIds = activePhasesWithOperators.flatMap(p => p.operators.map(op => op.id));
    if (selectedOperatorsToPause.length === allActiveOperatorIds.length) {
      setSelectedOperatorsToPause([]);
    } else {
      setSelectedOperatorsToPause(allActiveOperatorIds);
    }
  };

  const handlePhaseStatusToggle = (phaseId: string) => {
    setEditablePhases(prevPhases => {
      const newPhases = prevPhases.map(p => {
        if (p.id === phaseId) {
          if (p.status === 'pending') return { ...p, status: 'skipped' as const };
          if (p.status === 'skipped') return { ...p, status: 'pending' as const };
        }
        return p;
      });
      return newPhases;
    });
  };
  
  const handleSaveChanges = async () => {
    if (!user) return;
    const result = await updatePhasesForJob(jobOrder.id, editablePhases, user.uid);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
    });
    if (result.success) {
      setIsPhaseManagerOpen(false);
    }
  };


  const overallStatus = getOverallStatus(jobOrder);
  const completedPhasesCount = jobOrder.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = jobOrder.phases.length > 0 ? (completedPhasesCount / jobOrder.phases.length) * 100 : 0;
  
  const deliveryDateString = jobOrder.dataConsegnaFinale;
  const deliveryDate = deliveryDateString && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDateString)
    ? parseISO(deliveryDateString)
    : null;
    
  const isOverdue = deliveryDate && isPast(deliveryDate) && overallStatus !== 'Completata';

  const problemDescription = jobOrder.problemType ? `${jobOrder.problemType.replace(/_/g, ' ')}: ${jobOrder.problemNotes || 'Nessuna nota.'}` : 'Vedi dettagli per risolvere.';
  
  const canForceFinish = ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus);
  const isAnyPhaseInProgress = activePhasesWithOperators.length > 0;
  const canForceComplete = !isAnyPhaseInProgress && overallStatus !== 'Completata';

  const isForcedToFinish = jobOrder.phases.some(p => p.forced);


  const guainaPhase = jobOrder.phases.find(p => p.name === "Taglio Guaina");
  
  const firstProductionPhase = jobOrder.phases
      .filter(p => p.type === 'production')
      .sort((a,b) => a.sequence - b.sequence)[0];
      
  const isGuainaPostponed = guainaPhase && firstProductionPhase && guainaPhase.sequence > firstProductionPhase.sequence;

  const canToggleGuaina = guainaPhase && guainaPhase.status === 'pending';
  
  const isGroup = jobOrder.id.startsWith('group-');

  return (
    <>
    <Card 
      className={cn(
          "flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300", 
          jobOrder.isProblemReported && "cursor-pointer border-destructive/50 hover:border-destructive",
          isSelected && "border-primary ring-2 ring-primary"
      )}
      onClick={jobOrder.isProblemReported ? onProblemClick : undefined}
    >
      <CardHeader>
        <div className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4">
            <div className="pt-1">
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onSelect(jobOrder.id)}
                    className="h-5 w-5"
                    aria-label={`Seleziona commessa ${jobOrder.id}`}
                />
            </div>
            <div>
                <CardTitle className="font-headline text-lg">{jobOrder.ordinePF}</CardTitle>
                <CardDescription className="flex items-center gap-2 pt-1">
                <Building className="h-4 w-4 text-muted-foreground" />
                {jobOrder.cliente}
                </CardDescription>
            </div>
            <StatusBadge status={overallStatus} />
        </div>
        <div className="flex justify-between items-center mt-2">
            <div></div>
            <TooltipProvider>
            <div className="flex items-center">
                {workGroup && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-blue-500 hover:bg-blue-500/10 hover:text-blue-500" asChild>
                            <Link href={`/admin/work-group-management?groupId=${workGroup.id}`}>
                                <LinkIcon className="h-4 w-4" />
                            </Link>
                        </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="font-semibold">Gruppo: {workGroup.id}</p>
                            <ul className="list-disc pl-4 text-xs">
                                {workGroup.jobOrderPFs?.map(pf => <li key={pf}>{pf}</li>)}
                            </ul>
                        </TooltipContent>
                    </Tooltip>
                )}
                {!isGroup && (
                <>
                    <Tooltip>
                    <TooltipTrigger asChild>
                        <Button asChild variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                        <Link href={`/admin/reports/${jobOrder.id}`}>
                            <CheckSquare className="h-4 w-4"/>
                        </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Vedi Dettagli Report</p>
                    </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                    <TooltipTrigger asChild>
                        <Button asChild variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                        <Link href={`/admin/data-management/print?jobId=${encodeURIComponent(jobOrder.id)}`} target="_blank">
                            <Printer className="h-4 w-4"/>
                        </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Stampa Scheda Lavorazione</p>
                    </TooltipContent>
                    </Tooltip>
                </>
                )}
                <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={handleOpenPhaseManager} disabled={overallStatus === 'Completata'}>
                        <ListOrdered className="mr-2 h-4 w-4" />
                        <span>Gestisci Fasi</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {isForcedToFinish ? (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-amber-600 focus:text-amber-600">
                            <Undo2 className="mr-2 h-4 w-4" />
                            <span>Annulla Forza a Finitura</span>
                        </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Annullare la forzatura?</AlertDialogTitle>
                            <AlertDialogDescription>
                            Questa azione ripristinerà le fasi di produzione completate artificialmente allo stato "in attesa".
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Chiudi</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onRevertForceFinishClick(jobOrder.id)}>Sì, annulla</AlertDialogAction>
                        </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    ) : (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!canForceFinish}>
                            <FastForward className="mr-2 h-4 w-4" />
                            <span>Forza a Finitura</span>
                            </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Forzare l'avanzamento?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Questa azione completerà tutte le fasi di produzione e renderà la commessa pronta per la finitura (collaudo/packaging).
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onForceFinishClick(jobOrder.id)}>Conferma</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!canForceComplete}>
                            <PowerOff className="mr-2 h-4 w-4" />
                            <span>Chiudi Commessa</span>
                            </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Forzare la chiusura della commessa?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Questa azione imposterà lo stato della commessa su "Completata" anche se non tutte le fasi di finitura sono state eseguite.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onForceCompleteClick(jobOrder.id)}>Sì, chiudi commessa</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    {canToggleGuaina && guainaPhase && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                {isGuainaPostponed ? <CornerUpLeft className="mr-2 h-4 w-4" /> : <CornerDownRight className="mr-2 h-4 w-4" />}
                                <span>{isGuainaPostponed ? 'Ripristina Posizione Guaina' : 'Posticipa Taglio Guaina'}</span>
                                </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Conferma Spostamento Fase</AlertDialogTitle>
                                    <AlertDialogDescription>
                                    Stai per {isGuainaPostponed ? 'riportare la fase "Taglio Guaina" alla sua posizione originale nel ciclo di preparazione.' : 'posticipare la fase "Taglio Guaina" alla fine del ciclo di produzione.'} Vuoi continuare?
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onToggleGuainaClick(jobOrder.id, guainaPhase.id, isGuainaPostponed ? 'postponed' : 'default')}>Conferma</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={handleOpenPauseDialog} disabled={!isAnyPhaseInProgress}>
                        <Users className="mr-2 h-4 w-4" />
                        <span>Forza Pausa Operatori</span>
                    </DropdownMenuItem>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            <span>Annulla e Resetta</span>
                            </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Questa azione è irreversibile. La commessa <span className="font-bold">{jobOrder.ordinePF}</span> verrà riportata allo stato "pianificata", le lavorazioni azzerate e lo stock dei materiali consumati verrà ripristinato.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onResetJobOrderClick(jobOrder.id)} className="bg-destructive hover:bg-destructive/90">Sì, annulla e resetta</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </DropdownMenuContent>
                </DropdownMenu>
            </div>
            </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div className="space-y-3 text-sm">
           <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <p className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{jobOrder.numeroODLInterno || 'N/D'}</span>
              </p>
              <p className="flex items-center gap-2 font-bold text-base justify-end">
                <Package className="h-4 w-4 text-muted-foreground" />
                {jobOrder.qta} pz
              </p>
              <p className="flex items-center gap-2 col-span-2">
                <Factory className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{jobOrder.department}</span>
              </p>
              <p className="flex items-center gap-2 col-span-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                {jobOrder.details}
              </p>
              {deliveryDate && (
                <p className={cn("flex items-center gap-2 font-medium col-span-2", isOverdue ? "text-destructive" : "text-muted-foreground")}>
                  {isOverdue ? <AlertTriangleIcon className="h-4 w-4"/> : <Calendar className="h-4 w-4" />}
                  <span>Consegna: {format(deliveryDate, 'dd MMM yyyy', { locale: it })}</span>
                </p>
              )}
          </div>
        </div>
        
        {activePhasesWithOperators.length > 0 && (
          <div className="p-3 rounded-md border bg-blue-600/10 border-blue-600/20 space-y-2">
            {activePhasesWithOperators.map(activePhase => (
              <div key={activePhase.phaseId}>
                <p className="text-sm font-semibold flex items-center gap-2 text-blue-800 dark:text-blue-300">
                  <Hourglass className="h-4 w-4 animate-spin" />
                  <span>Fase Attuale: {activePhase.phaseName}</span>
                </p>
                <div className="mt-1 pl-6">
                    <p className="text-xs font-semibold flex items-center gap-2 text-blue-700 dark:text-blue-400">
                        <Users className="h-4 w-4" />
                        Operatori: {activePhase.operators.map(op => op.name).join(', ')}
                    </p>
                </div>
              </div>
            ))}
          </div>
        )}

         {overallStatus === 'Problema' && (
           <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20">
                        <p className="text-sm font-semibold flex items-center gap-2 text-destructive-foreground">
                        <ShieldAlert className="h-4 w-4 text-destructive" />
                        Problema Segnalato
                        </p>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{problemDescription}</p>
                </TooltipContent>
            </Tooltip>
           </TooltipProvider>
        )}
        {overallStatus === 'Completata' && jobOrder.overallEndTime && (
             <div className="p-3 bg-green-500/10 rounded-md border border-green-500/20">
                <p className="text-sm font-semibold flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Completata il: {format(new Date(jobOrder.overallEndTime), 'dd/MM/yyyy HH:mm')}
                </p>
            </div>
        )}
        <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground/80">Avanzamento Fasi</h4>
            {jobOrder.phases && jobOrder.phases.length > 0 ? (
                jobOrder.phases.sort((a,b) => a.sequence - b.sequence).map(phase => (
                    <div key={phase.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                        {getPhaseIcon(phase.status)}
                        <span className={cn("flex-1", phase.status === 'skipped' && 'line-through')}>{phase.name}</span>
                        {phase.status === 'completed' && overallStatus !== 'Completata' && (
                           <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                                      <Undo2 className="h-4 w-4" />
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Ripristinare la fase?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Questa azione riporterà la fase "{phase.name}" allo stato di pausa, conservando il tempo di lavoro già registrato. Sei sicuro?
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => onRevertPhaseClick(jobOrder.id, phase.id)}>Sì, ripristina</AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                        )}
                    </div>
                ))
            ) : (
                <p className="text-sm text-muted-foreground">Nessuna fase definita per questa commessa.</p>
            )}
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 pt-4">
        <div className="w-full">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progresso</span>
                <span>{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
        </div>
      </CardFooter>
    </Card>
     <Dialog open={isPauseDialogOpen} onOpenChange={setIsPauseDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Seleziona Operatori da Mettere in Pausa</DialogTitle>
                <DialogDescription>
                    Scegli quali operatori attivi sulla commessa <span className="font-bold">{jobOrder.ordinePF}</span> vuoi mettere in pausa.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-3">
                 <div className="flex items-center space-x-2">
                    <Checkbox
                        id="select-all"
                        checked={selectedOperatorsToPause.length === activePhasesWithOperators.flatMap(p => p.operators).length && activePhasesWithOperators.length > 0}
                        onCheckedChange={toggleSelectAll}
                    />
                    <Label htmlFor="select-all">Seleziona Tutti</Label>
                </div>
                {activePhasesWithOperators.flatMap(p => p.operators).map(op => (
                    <div key={op.id} className="flex items-center space-x-2 p-2 rounded-md border">
                         <Checkbox
                            id={op.id}
                            checked={selectedOperatorsToPause.includes(op.id)}
                            onCheckedChange={() => toggleOperatorSelection(op.id)}
                         />
                         <Label htmlFor={op.id} className="flex-1">
                            <span className="font-semibold">{op.name}</span>
                         </Label>
                    </div>
                ))}
                {activePhasesWithOperators.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessun operatore attivo su questa commessa.</p>}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsPauseDialogOpen(false)}>Annulla</Button>
                <Button onClick={handleConfirmPause} disabled={selectedOperatorsToPause.length === 0}>
                    Metti in Pausa Selezionati ({selectedOperatorsToPause.length})
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    <Dialog open={isPhaseManagerOpen} onOpenChange={setIsPhaseManagerOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Gestione Fasi per: {jobOrder.ordinePF}</DialogTitle>
          <DialogDescription>
            Bypassa le fasi non necessarie o ripristina quelle saltate. Le modifiche sono possibili solo per le fasi non ancora iniziate.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {editablePhases.sort((a,b) => a.sequence - b.sequence).map(phase => {
            const canBeModified = phase.status === 'pending' || phase.status === 'skipped';
            return (
              <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", !canBeModified && 'bg-muted/50 opacity-70')}>
                <div className="flex items-center gap-3">
                  {getPhaseIcon(phase.status)}
                  <span className={cn('font-medium', phase.status === 'skipped' && 'line-through text-muted-foreground')}>{phase.name}</span>
                </div>
                {canBeModified ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePhaseStatusToggle(phase.id)}
                  >
                    {phase.status === 'pending' ? <EyeOff className="mr-2 h-4 w-4" /> : <Undo2 className="mr-2 h-4 w-4" />}
                    {phase.status === 'pending' ? 'Bypassa' : 'Ripristina'}
                  </Button>
                ) : (
                  <Badge variant="secondary">{phase.status}</Badge>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsPhaseManagerOpen(false)}>Annulla</Button>
          <Button onClick={handleSaveChanges}>Salva Modifiche</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
