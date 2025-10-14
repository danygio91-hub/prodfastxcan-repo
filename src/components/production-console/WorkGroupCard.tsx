

import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2, ClipboardList, Factory, Users, PowerOff, RefreshCcw, EyeOff, ListOrdered, ArrowUp, ArrowDown, Unlink, View } from 'lucide-react';
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
import JobOrderCard from './JobOrderCard';


interface ActivePhaseInfo {
  phaseId: string;
  phaseName: string;
  operators: { id: string; name: string }[];
}

function getOverallStatus(jobOrder: JobOrder | WorkGroup): OverallStatus {
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

export default function WorkGroupCard({ 
    group,
    jobsInGroup,
    allOperators,
    onProblemClick,
    onForceFinishClick,
    onRevertForceFinishClick,
    onToggleGuainaClick,
    onRevertPhaseClick,
    onForcePauseClick,
    onForceCompleteClick,
    onResetJobOrderClick,
    onDissolveGroupClick,
    isSelected,
    onSelect,
}: { 
    group: WorkGroup;
    jobsInGroup: JobOrder[];
    allOperators: Operator[];
    onProblemClick: () => void;
    onForceFinishClick: (groupId: string) => void;
    onRevertForceFinishClick: (groupId: string) => void;
    onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; 
    onRevertPhaseClick: (jobId: string, phaseId: string) => void; 
    onForcePauseClick: (groupId: string, operatorIds: string[]) => void;
    onForceCompleteClick: (groupId: string) => void;
    onResetJobOrderClick: (jobId: string) => void;
    onDissolveGroupClick: (groupId: string) => void;
    isSelected: boolean;
    onSelect: (groupId: string) => void;
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [isPhaseManagerOpen, setIsPhaseManagerOpen] = useState(false);
  const [isExplodeViewOpen, setIsExplodeViewOpen] = useState(false);
  const [editablePhases, setEditablePhases] = useState<JobPhase[]>([]);
  const [isOrderChanged, setIsOrderChanged] = useState(false);
  const [selectedOperatorsToPause, setSelectedOperatorsToPause] = useState<string[]>([]);
  
  const { user } = useAuth();
  const { toast } = useToast();

  const activePhasesWithOperators = useMemo((): ActivePhaseInfo[] => {
    const activePhasesMap = new Map<string, ActivePhaseInfo>();
    
    (group.phases || []).forEach(phase => {
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
  }, [group, allOperators]);
  
  const handleOpenPauseDialog = () => {
    setSelectedOperatorsToPause([]);
    setIsPauseDialogOpen(true);
  };

  const handleOpenPhaseManager = () => {
    setEditablePhases([...group.phases].sort((a,b) => a.sequence - b.sequence));
    setIsOrderChanged(false);
    setIsPhaseManagerOpen(true);
  };
  
  const handleConfirmPause = () => {
    if (selectedOperatorsToPause.length > 0) {
      onForcePauseClick(group.id, selectedOperatorsToPause);
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
      setIsOrderChanged(true);
      return newPhases;
    });
  };
  
  const handleMovePhase = (index: number, direction: 'up' | 'down') => {
    setEditablePhases(prevPhases => {
        const newPhases = [...prevPhases];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex >= 0 && targetIndex < newPhases.length) {
            [newPhases[index], newPhases[targetIndex]] = [newPhases[targetIndex], newPhases[index]];
        }
        setIsOrderChanged(true);
        return newPhases;
    });
  };
  
  const handleSaveChanges = async () => {
    if (!user) return;
    const result = await updatePhasesForJob(group.id, editablePhases, user.uid);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
    });
    if (result.success) {
      setIsPhaseManagerOpen(false);
    }
  };

  const overallStatus = getOverallStatus(group);
  const completedPhasesCount = group.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = group.phases.length > 0 ? (completedPhasesCount / group.phases.length) * 100 : 0;
  
  const problemDescription = group.problemType ? `${group.problemType.replace(/_/g, ' ')}: ${group.problemNotes || 'Nessuna nota.'}` : 'Vedi dettagli per risolvere.';
  
  const canForceFinish = ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus);
  const isAnyPhaseInProgress = activePhasesWithOperators.length > 0;
  const canForceComplete = !isAnyPhaseInProgress && overallStatus !== 'Completata';

  return (
    <>
      <Card 
        className={cn(
            "relative flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300 border-2 border-primary/50", 
            group.isProblemReported && "cursor-pointer border-destructive/50 hover:border-destructive",
            isSelected && "border-primary ring-2 ring-primary/50",
        )}
        onClick={group.isProblemReported ? onProblemClick : undefined}
      >
         <CardHeader className="pb-3 space-y-2">
             <div className="flex justify-between items-center gap-4">
                 <div className="flex items-center gap-3">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelect(group.id)}
                        aria-label={`Seleziona gruppo ${group.id}`}
                        className="h-4 w-4"
                    />
                    <CardTitle className="font-headline text-lg flex items-center gap-2">
                       <Combine className="h-5 w-5 text-primary" />
                       Gruppo: {group.id}
                    </CardTitle>
                </div>
                 <StatusBadge status={overallStatus} />
            </div>
            <div className="flex justify-between items-center gap-4">
                 <CardDescription className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    {group.cliente}
                </CardDescription>
                <div className="flex items-center gap-1">
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
                               <DropdownMenuItem onSelect={handleOpenPauseDialog} disabled={!isAnyPhaseInProgress}>
                                  <Users className="mr-2 h-4 w-4" />
                                  <span>Forza Pausa Operatori</span>
                              </DropdownMenuItem>
                               {canForceFinish && (
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()}><FastForward className="mr-2 h-4 w-4" />Forza a Finitura</DropdownMenuItem></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Conferma Azione</AlertDialogTitle><AlertDialogDescription>Forzare tutte le fasi di produzione del gruppo a 'completata'?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onForceFinishClick(group.id)}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              )}
                              {canForceComplete && (
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()}><PowerOff className="mr-2 h-4 w-4" />Forza Chiusura Gruppo</DropdownMenuItem></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Conferma Azione</AlertDialogTitle><AlertDialogDescription>Stai per impostare manualmente questo gruppo come 'Completato'.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onForceCompleteClick(group.id)}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                  </AlertDialog>
                              )}
                              <DropdownMenuSeparator />
                              <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                                          <Unlink className="mr-2 h-4 w-4" />
                                          <span>Annulla Gruppo</span>
                                      </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                      <AlertDialogHeader><AlertDialogTitle>Sei sicuro di voler annullare il gruppo?</AlertDialogTitle><AlertDialogDescription>Le commesse torneranno individuali e dovranno essere gestite singolarmente.</AlertDialogDescription></AlertDialogHeader>
                                      <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onDissolveGroupClick(group.id)} className="bg-destructive hover:bg-destructive/90">Sì, annulla gruppo</AlertDialogAction></AlertDialogFooter>
                                  </AlertDialogContent>
                              </AlertDialog>
                          </DropdownMenuContent>
                      </DropdownMenu>
                </div>
            </div>

            {group.isProblemReported && (
                <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
                    <ShieldAlert className="mr-2 h-4 w-4" /> Problema segnalato!
                </p>
            )}
        </CardHeader>
        <CardContent className="flex-grow space-y-4 pt-0">
           <div className="flex justify-between items-start gap-4">
              <div className="space-y-3 text-sm">
                 <p className="flex items-center gap-2 text-muted-foreground">
                      <Package className="h-4 w-4" />
                      {group.details}
                  </p>
              </div>
              <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-bold">{group.qta}</span>
                    <span className="text-muted-foreground text-xs">pz totali</span>
                  </div>
              </div>
           </div>
          
          <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground/80">Avanzamento Fasi</h4>
              {group.phases && group.phases.length > 0 ? (
                  group.phases.sort((a,b) => a.sequence - b.sequence).map(phase => (
                      <div key={phase.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                          {getPhaseIcon(phase.status)}
                          <span className={cn("flex-1", phase.status === 'skipped' && 'line-through')}>{phase.name}</span>
                      </div>
                  ))
              ) : (
                  <p className="text-sm text-muted-foreground">Nessuna fase definita per questo gruppo.</p>
              )}
          </div>
           <Button variant="secondary" size="sm" className="w-full mt-4" onClick={() => setIsExplodeViewOpen(true)}>
                <View className="mr-2 h-4 w-4" />
                Esplodi e Vedi Dettagli Commesse ({jobsInGroup.length})
            </Button>
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

      <Dialog open={isExplodeViewOpen} onOpenChange={setIsExplodeViewOpen}>
          <DialogContent className="max-w-7xl h-[90vh]">
              <DialogHeader>
                  <DialogTitle>Dettaglio Commesse nel Gruppo: {group.id}</DialogTitle>
              </DialogHeader>
              <div className="h-full overflow-y-auto p-2">
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {jobsInGroup.map(job => (
                          <JobOrderCard
                              key={job.id}
                              jobOrder={job}
                              workGroup={group}
                              allOperators={allOperators}
                              onProblemClick={() => {}}
                              onForceFinishClick={() => {}}
                              onRevertForceFinishClick={() => {}}
                              onToggleGuainaClick={() => {}}
                              onRevertPhaseClick={() => {}}
                              onForcePauseClick={() => {}}
                              onForceCompleteClick={() => {}}
                              onResetJobOrderClick={() => {}}
                              isSelected={false}
                              onSelect={() => {}}
                          />
                      ))}
                  </div>
              </div>
          </DialogContent>
      </Dialog>
    </>
  );
}
