

import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Wrench, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, AlertTriangle as AlertTriangleIcon, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2, ClipboardList, Factory, Pause, Users, Link as LinkIcon } from 'lucide-react';
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

interface ActiveOperator {
  id: string;
  name: string;
  phaseName: string;
}

function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  // Priority 1: Terminal/Blocking states
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended') return 'Sospesa';
  if (jobOrder.status === 'completed') return 'Completata';

  // Check phases
  const preparationPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = (jobOrder.phases || []).filter(p => (p.type ?? 'production') === 'production');
  const finishingPhases = (jobOrder.phases || []).filter(p => p.type === 'quality' || p.type === 'packaging');
  
  const isAnyFinishingActive = finishingPhases.some(p => p.status !== 'pending');
  if (isAnyFinishingActive) return 'In Lavorazione';

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) return 'In Lavorazione';
  
  const allPreparationDone = preparationPhases.every(p => p.status === 'completed');

  if (allPreparationDone) {
    const allProductionSkippedOrDone = productionPhases.every(p => p.status === 'completed');
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
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function JobOrderCard({ 
    jobOrder,
    workGroup, 
    allOperators,
    onProblemClick, 
    onForceFinishClick, 
    onToggleGuainaClick, 
    onRevertPhaseClick, 
    onForcePauseClick 
}: { 
    jobOrder: JobOrder;
    workGroup?: WorkGroup | null; 
    allOperators: Operator[];
    onProblemClick: () => void; 
    onForceFinishClick: (jobId: string) => void; 
    onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; 
    onRevertPhaseClick: (jobId: string, phaseId: string) => void; 
    onForcePauseClick: (jobId: string, operatorIds: string[]) => void; 
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [selectedOperatorsToPause, setSelectedOperatorsToPause] = useState<string[]>([]);
  
  const activeOperators = useMemo(() => {
    const active: ActiveOperator[] = [];
    jobOrder.phases.forEach(phase => {
        if (phase.status === 'in-progress') {
            phase.workPeriods.forEach(wp => {
                if (wp.end === null) {
                    const operator = allOperators.find(op => op.id === wp.operatorId);
                    if(operator) {
                        active.push({ id: operator.id, name: operator.nome, phaseName: phase.name });
                    }
                }
            });
        }
    });
    return active;
  }, [jobOrder.phases, allOperators]);
  
  const handleOpenPauseDialog = () => {
    setSelectedOperatorsToPause([]); // Reset selection
    setIsPauseDialogOpen(true);
  };
  
  const handleConfirmPause = () => {
    if (selectedOperatorsToPause.length > 0) {
      onForcePauseClick(jobOrder.id, selectedOperatorsToPause);
    }
    setIsPauseDialogOpen(false);
  };

  const toggleOperatorSelection = (opId: string) => {
    setSelectedOperatorsToPause(prev => 
        prev.includes(opId) ? prev.filter(id => id !== opId) : [...prev, opId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedOperatorsToPause.length === activeOperators.length) {
      setSelectedOperatorsToPause([]);
    } else {
      setSelectedOperatorsToPause(activeOperators.map(op => op.id));
    }
  };


  const overallStatus = getOverallStatus(jobOrder);
  const currentPhase = getCurrentPhase(jobOrder.phases);
  const completedPhasesCount = jobOrder.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = jobOrder.phases.length > 0 ? (completedPhasesCount / jobOrder.phases.length) * 100 : 0;
  
  const deliveryDate = jobOrder.dataConsegnaFinale ? parseISO(jobOrder.dataConsegnaFinale) : null;
  const isOverdue = deliveryDate && isPast(deliveryDate) && overallStatus !== 'Completata';

  const problemDescription = jobOrder.problemType ? `${jobOrder.problemType.replace(/_/g, ' ')}: ${jobOrder.problemNotes || 'Nessuna nota.'}` : 'Vedi dettagli per risolvere.';
  
  const canForceFinish = ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus);
  
  const guainaPhase = jobOrder.phases.find(p => p.name === "Taglio Guaina");
  
  const firstProductionPhase = jobOrder.phases
      .filter(p => p.type === 'production')
      .sort((a,b) => a.sequence - b.sequence)[0];
      
  const isGuainaPostponed = guainaPhase && firstProductionPhase && guainaPhase.sequence > firstProductionPhase.sequence;

  const canToggleGuaina = guainaPhase && guainaPhase.status === 'pending';
  
  const isAnyPhaseInProgress = jobOrder.phases.some(p => p.status === 'in-progress');

  const isGroup = jobOrder.id.startsWith('group-');

  return (
    <>
    <Card 
      className={cn("flex flex-col h-full bg-card/80 hover:bg-card transition-colors duration-300", jobOrder.isProblemReported && "cursor-pointer border-destructive/50 hover:border-destructive")}
      onClick={jobOrder.isProblemReported ? onProblemClick : undefined}
    >
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <CardTitle className="font-headline text-lg">{isGroup ? jobOrder.details : jobOrder.ordinePF}</CardTitle>
          <StatusBadge status={overallStatus} />
        </div>
        <div className="flex justify-between items-center">
        <CardDescription className="flex items-center gap-2 pt-1">
          <Building className="h-4 w-4 text-muted-foreground" />
          {jobOrder.cliente}
        </CardDescription>
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div className="space-y-3 text-sm">
          {!isGroup && (
            <>
              <div className="flex items-center justify-between gap-4">
                <p className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{jobOrder.numeroODLInterno || 'N/D'}</span>
                </p>
                <p className="flex items-center gap-2 font-bold text-base">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  {jobOrder.qta} pz
                </p>
              </div>
              <p className="flex items-center gap-2">
                <Factory className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{jobOrder.department}</span>
              </p>
              <p className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                {jobOrder.details}
              </p>
              {deliveryDate && (
                <p className={cn("flex items-center gap-2 font-medium", isOverdue ? "text-destructive" : "text-muted-foreground")}>
                  {isOverdue ? <AlertTriangleIcon className="h-4 w-4"/> : <Calendar className="h-4 w-4" />}
                  <span>Consegna: {format(deliveryDate, 'dd MMM yyyy', { locale: it })}</span>
                </p>
              )}
            </>
          )}
          {isGroup && (
             <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <p className="flex items-center gap-2 font-bold text-base col-span-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  {jobOrder.qta} pz totali
                </p>
                 <p className="flex items-center gap-2 col-span-2">
                  <Factory className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{jobOrder.department}</span>
                </p>
                <p className="flex items-center gap-2 col-span-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span>Commesse nel gruppo:</span>
                </p>
                 <div className="col-span-2 flex flex-wrap gap-1">
                   {(jobOrder.jobOrderPFs || []).map(pf => <Badge key={pf} variant="secondary">{pf}</Badge>)}
                 </div>
            </div>
          )}
        </div>
        { (overallStatus === 'In Lavorazione' || overallStatus === 'In Preparazione') && currentPhase && (
           <div className={`p-3 rounded-md border ${currentPhase.status === 'paused' ? 'bg-orange-500/10 border-orange-500/20' : 'bg-accent/10 border-accent/20'}`}>
            <p className={`text-sm font-semibold flex items-center gap-2 ${currentPhase.status === 'paused' ? 'text-orange-500' : 'text-accent-foreground'}`}>
              {currentPhase.status === 'paused'
                ? <PauseCircle className="h-4 w-4" />
                : <Wrench className="h-4 w-4" />
              }
              <span>
                Fase Attuale: {currentPhase.name}
                {currentPhase.status === 'paused' && ' (In Pausa)'}
              </span>
            </p>
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
        <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground/80">Avanzamento Fasi</h4>
            {jobOrder.phases && jobOrder.phases.length > 0 ? (
                jobOrder.phases.sort((a,b) => a.sequence - b.sequence).map(phase => (
                    <div key={phase.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                        {getPhaseIcon(phase.status)}
                        <span className="flex-1">{phase.name}</span>
                        {phase.status === 'completed' && (
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
                        checked={selectedOperatorsToPause.length === activeOperators.length && activeOperators.length > 0}
                        onCheckedChange={toggleSelectAll}
                    />
                    <Label htmlFor="select-all">Seleziona Tutti</Label>
                </div>
                {activeOperators.map(op => (
                    <div key={op.id} className="flex items-center space-x-2 p-2 rounded-md border">
                         <Checkbox
                            id={op.id}
                            checked={selectedOperatorsToPause.includes(op.id)}
                            onCheckedChange={() => toggleOperatorSelection(op.id)}
                         />
                         <Label htmlFor={op.id} className="flex-1">
                            <span className="font-semibold">{op.name}</span>
                            <span className="text-xs text-muted-foreground"> (Fase: {op.phaseName})</span>
                         </Label>
                    </div>
                ))}
                {activeOperators.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessun operatore attivo su questa commessa.</p>}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsPauseDialogOpen(false)}>Annulla</Button>
                <Button onClick={handleConfirmPause} disabled={selectedOperatorsToPause.length === 0}>
                    Metti in Pausa Selezionati ({selectedOperatorsToPause.length})
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
}
