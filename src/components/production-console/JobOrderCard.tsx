
import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Wrench, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, AlertTriangle as AlertTriangleIcon, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2, ClipboardList, Factory, Pause, Users, Link as LinkIcon, PowerOff, RefreshCcw, EyeOff, ListOrdered, ArrowUp, ArrowDown } from 'lucide-react';
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

  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'suspended' || jobOrder.status === 'paused') return 'Sospesa';

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
  
  return 'Da Iniziare';
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
    onProblemClick, 
    onForceFinishClick,
    onRevertForceFinishClick,
    onToggleGuainaClick, 
    onRevertPhaseClick, 
    onForcePauseClick,
    onForceCompleteClick,
    onResetJobOrderClick,
    isSelected,
    onSelect,
}: { 
    jobOrder: JobOrder;
    workGroup?: WorkGroup | null; 
    allOperators: Operator[];
    onProblemClick: () => void; 
    onForceFinishClick: (jobId: string) => void;
    onRevertForceFinishClick: (jobId: string) => void;
    onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; 
    onRevertPhaseClick: (jobId: string, phaseId: string) => void; 
    onForcePauseClick: (jobId: string, operatorIds: string[]) => void; 
    onForceCompleteClick: (jobId: string) => void;
    onResetJobOrderClick: (jobId: string) => void;
    isSelected: boolean;
    onSelect: (jobId: string) => void;
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
    setSelectedOperatorsToPause([]);
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
      return prevPhases.map(p => {
        if (p.id === phaseId) {
          if (p.status === 'pending') return { ...p, status: 'skipped' as const };
          if (p.status === 'skipped') return { ...p, status: 'pending' as const };
        }
        return p;
      });
    });
  };
  
  const handleMovePhase = (index: number, direction: 'up' | 'down') => {
    setEditablePhases(prevPhases => {
      const newPhases = [...prevPhases];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex >= 0 && targetIndex < newPhases.length) {
        // Swap sequences
        const currentSequence = newPhases[index].sequence;
        newPhases[index].sequence = newPhases[targetIndex].sequence;
        newPhases[targetIndex].sequence = currentSequence;
      }
      
      // Re-sort the array based on the new sequences to reflect the change in UI
      return newPhases.sort((a,b) => a.sequence - b.sequence);
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
            "relative flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300", 
            jobOrder.isProblemReported && "cursor-pointer border-destructive/50 hover:border-destructive",
            isSelected && "border-primary ring-2 ring-primary/50"
        )}
        onClick={jobOrder.isProblemReported ? onProblemClick : undefined}
      >
         <CardHeader className="pb-3 space-y-2">
             <div className="flex justify-between items-center gap-4">
                 <div className="flex items-center gap-3">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelect(jobOrder.id)}
                        aria-label={`Seleziona commessa ${jobOrder.id}`}
                        className="h-4 w-4"
                    />
                    <CardTitle className="font-headline text-lg">{jobOrder.ordinePF}</CardTitle>
                </div>
                 <StatusBadge status={overallStatus} />
            </div>
            <div className="flex justify-between items-center gap-4">
                 <CardDescription className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    {jobOrder.cliente}
                </CardDescription>
                <div className="flex items-center gap-1">
                    {!isGroup && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                        <Link href={`/admin/reports/${jobOrder.id}`} target="_blank"><CheckSquare className="h-4 w-4" /></Link>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Vedi Dettagli Report</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                        <Link href={`/admin/data-management/print?jobId=${encodeURIComponent(jobOrder.id)}`} target="_blank"><Printer className="h-4 w-4" /></Link>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Stampa Scheda</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                           <DropdownMenuItem onSelect={handleOpenPhaseManager} disabled={overallStatus === 'Completata'}>
                                <ListOrdered className="mr-2 h-4 w-4" />
                                <span>Gestisci Fasi</span>
                            </DropdownMenuItem>
                            {canToggleGuaina && guainaPhase && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                        {isGuainaPostponed ? <CornerUpLeft className="mr-2 h-4 w-4" /> : <CornerDownRight className="mr-2 h-4 w-4" />}
                                        <span>{isGuainaPostponed ? 'Ripristina Guaina' : 'Posticipa Guaina'}</span>
                                        </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Conferma Spostamento Fase</AlertDialogTitle>
                                            <AlertDialogDescription>
                                            Stai per {isGuainaPostponed ? 'riportare la fase "Taglio Guaina" alla sua posizione originale.' : 'posticipare la fase "Taglio Guaina" a dopo la produzione.'} Vuoi continuare?
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
                             {canForceFinish && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()}><FastForward className="mr-2 h-4 w-4" />Forza a Finitura</DropdownMenuItem></AlertDialogTrigger>
                                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Conferma Azione</AlertDialogTitle><AlertDialogDescription>Forzare tutte le fasi di produzione a 'completata'?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onForceFinishClick(jobOrder.id)}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                </AlertDialog>
                            )}
                             {isForcedToFinish && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-amber-600 focus:text-amber-700"><Undo2 className="mr-2 h-4 w-4" />Annulla Forzatura</DropdownMenuItem></AlertDialogTrigger>
                                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Annullare la Forzatura?</AlertDialogTitle><AlertDialogDescription>Le fasi completate forzatamente verranno resettate allo stato 'in attesa'.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onRevertForceFinishClick(jobOrder.id)}>Sì, annulla</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                </AlertDialog>
                            )}
                            {canForceComplete && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()}><PowerOff className="mr-2 h-4 w-4" />Forza Chiusura Commessa</DropdownMenuItem></AlertDialogTrigger>
                                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Conferma Azione</AlertDialogTitle><AlertDialogDescription>Stai per impostare manualmente questa commessa come 'Completata'.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onForceCompleteClick(jobOrder.id)}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                </AlertDialog>
                            )}
                            <DropdownMenuSeparator />
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
            </div>

            {jobOrder.isProblemReported && (
                <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
                    <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato!
                </p>
            )}
        </CardHeader>
        <CardContent className="flex-grow space-y-4 pt-0">
           <div className="flex justify-between items-start gap-4">
              <div className="space-y-3 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                      <ClipboardList className="h-4 w-4" />
                      <span className="font-semibold text-foreground">{jobOrder.numeroODLInterno || 'N/D'}</span>
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                      <Factory className="h-4 w-4" />
                      {jobOrder.department}
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                      <Package className="h-4 w-4" />
                      {jobOrder.details}
                  </p>
                  {deliveryDate && (
                      <p className={cn("flex items-center gap-2 font-medium", isOverdue ? "text-destructive" : "text-muted-foreground")}>
                          <Calendar className="h-4 w-4" />
                          <span>Consegna: {format(deliveryDate, 'dd MMM yyyy', { locale: it })}</span>
                      </p>
                  )}
              </div>
              <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-bold">{jobOrder.qta}</span>
                    <span className="text-muted-foreground text-xs">pz</span>
                  </div>
              </div>
           </div>
          
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
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
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
            {editablePhases.sort((a,b) => a.sequence - b.sequence).map((phase, index) => {
              const canBeModified = phase.status === 'pending' || phase.status === 'skipped';
              return (
                <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", !canBeModified && 'bg-muted/50 opacity-70')}>
                  <div className="flex items-center gap-3">
                    {getPhaseIcon(phase.status)}
                    <span className={cn('font-medium', phase.status === 'skipped' && 'line-through text-muted-foreground')}>{phase.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {canBeModified ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMovePhase(index, 'up')}
                          disabled={index === 0 || !canBeModified}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMovePhase(index, 'down')}
                          disabled={index === editablePhases.length - 1 || !canBeModified}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePhaseStatusToggle(phase.id)}
                        >
                          {phase.status === 'pending' ? <EyeOff className="mr-2 h-4 w-4" /> : <Undo2 className="mr-2 h-4 w-4" />}
                          {phase.status === 'pending' ? 'Bypassa' : 'Ripristina'}
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary">{phase.status}</Badge>
                    )}
                  </div>
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
