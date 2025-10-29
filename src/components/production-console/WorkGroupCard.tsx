
import type { JobOrder, JobPhase, Operator, WorkGroup } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, MoreVertical, FastForward, CornerUpLeft, CornerDownRight, ListOrdered, Boxes, Users, PowerOff, Unlink, View, Combine, User, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import React, { useState, useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import JobOrderCard from './JobOrderCard';
import { Separator } from '@/components/ui/separator';
import type { ProductionTimeData } from '@/app/admin/production-console/actions';


interface ActivePhaseInfo {
  phaseId: string;
  phaseName: string;
  operators: { id: string; name: string }[];
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
    analysisData,
    onProblemClick,
    onForceFinishClick,
    onForcePauseClick,
    onForceCompleteClick,
    onDissolveGroupClick,
    onOpenPhaseManager,
    onOpenMaterialManager,
    onToggleGuainaClick,
    isSelected,
    onSelect,
    overallStatus,
    getOverallStatus,
}: { 
    group: WorkGroup;
    jobsInGroup: JobOrder[];
    allOperators: Operator[];
    analysisData?: ProductionTimeData | null;
    onProblemClick: () => void;
    onForceFinishClick: (groupId: string) => void;
    onForcePauseClick: (groupId: string, operatorIds: string[]) => void;
    onForceCompleteClick: (groupId: string) => void;
    onDissolveGroupClick: (groupId: string) => void;
    onOpenPhaseManager: (item: JobOrder | WorkGroup) => void;
    onOpenMaterialManager: (item: JobOrder | WorkGroup) => void;
    onToggleGuainaClick: (jobId: string, phaseId: string) => void; 
    isSelected: boolean;
    onSelect: (groupId: string) => void;
    overallStatus: OverallStatus;
    getOverallStatus: (job: JobOrder) => OverallStatus;
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [isExplodeViewOpen, setIsExplodeViewOpen] = useState(false);
  const [selectedOperatorsToPause, setSelectedOperatorsToPause] = useState<string[]>([]);
  const hasMaterialMissing = group.phases.some(p => p.materialStatus === 'missing');

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

  const completedPhasesCount = group.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = group.phases.length > 0 ? (completedPhasesCount / group.phases.length) * 100 : 0;
  
  const canForceFinish = ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus);
  const isAnyPhaseInProgress = activePhasesWithOperators.length > 0;
  const canForceComplete = !isAnyPhaseInProgress && overallStatus !== 'Completata';
  
  const guainaPhase = group.phases.find(p => p.name === "Taglio Guaina");
  const isWorkInProgress = group.phases.some(p => p.status === 'in-progress' || p.status === 'paused');
  const canToggleGuaina = guainaPhase && (guainaPhase.status === 'pending' || guainaPhase.status === 'paused') && !isWorkInProgress;
  
  const firstProductionPhase = group.phases
      .filter(p => p.type === 'production')
      .sort((a,b) => a.sequence - b.sequence)[0];
  const isGuainaPostponed = guainaPhase && firstProductionPhase && guainaPhase.sequence > firstProductionPhase.sequence;


  return (
    <>
      <Card 
        className={cn(
            "relative flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300 border-2 border-teal-500/70", 
            (group.isProblemReported || hasMaterialMissing) && "cursor-pointer border-destructive/50 hover:border-destructive",
            isSelected && "border-primary ring-2 ring-primary/50",
        )}
        onClick={(group.isProblemReported || hasMaterialMissing) ? onProblemClick : undefined}
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
                    <TooltipProvider>
                       <Tooltip>
                           <TooltipTrigger>
                               <Combine className="h-5 w-5 text-teal-400" />
                           </TooltipTrigger>
                           <TooltipContent>
                               <p>Gruppo: {group.id}</p>
                           </TooltipContent>
                       </Tooltip>
                   </TooltipProvider>
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
                             <DropdownMenuItem onSelect={() => onOpenPhaseManager(group)} disabled={overallStatus === 'Completata'}>
                                  <ListOrdered className="mr-2 h-4 w-4" />
                                  <span>Gestisci Fasi</span>
                              </DropdownMenuItem>
                               <DropdownMenuItem onSelect={() => onOpenMaterialManager(group)} disabled={overallStatus === 'Completata'}>
                                  <Boxes className="mr-2 h-4 w-4" />
                                  <span>Gestisci Materiali</span>
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
                                            <AlertDialogAction onClick={() => onToggleGuainaClick(group.id, guainaPhase.id)}>Conferma</AlertDialogAction>
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
                                      <AlertDialogFooter><AlertDialogCancel>Chiudi</AlertDialogCancel><AlertDialogAction onClick={() => onDissolveGroupClick(group.id)} className="bg-destructive hover:bg-destructive/90">Sì, annulla gruppo</AlertDialogAction></AlertDialogFooter>
                                  </AlertDialogContent>
                              </AlertDialog>
                          </DropdownMenuContent>
                      </DropdownMenu>
                </div>
            </div>

            {(group.isProblemReported || hasMaterialMissing) && (
                <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
                    <ShieldAlert className="mr-2 h-4 w-4" />
                     {group.isProblemReported ? "Problema segnalato!" : "Materiale mancante!"}
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

             <div className="space-y-1 text-sm">
                <p className="font-semibold text-foreground/80">Commesse nel Gruppo:</p>
                <div className="flex flex-wrap gap-1">
                    {group.jobOrderPFs?.map(pf => <Badge key={pf} variant="secondary">{pf}</Badge>)}
                </div>
             </div>
          
           {isAnyPhaseInProgress && (
                <div className="rounded-lg border-2 border-cyan-400/50 bg-cyan-900/20 p-3 space-y-3 animate-pulse">
                    <h4 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                        <Hourglass className="h-4 w-4 text-cyan-500"/>
                        Operatori Attivi
                    </h4>
                    {activePhasesWithOperators.map(info => (
                        <div key={info.phaseId} className="pl-2">
                           <p className="font-semibold text-primary">{info.phaseName}:</p>
                           <div className="flex flex-wrap gap-2 pt-1">
                               {info.operators.map(op => (
                                   <Badge key={op.id} variant="outline" className="flex items-center gap-1.5 py-1 bg-background">
                                       <User className="h-3 w-3" />
                                       {op.name}
                                   </Badge>
                               ))}
                           </div>
                        </div>
                    ))}
                </div>
            )}
          <Separator />

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
      
      <Dialog open={isPauseDialogOpen} onOpenChange={setIsPauseDialogOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Seleziona Operatori da Mettere in Pausa</DialogTitle>
                  <DialogDescription>
                      Scegli quali operatori attivi sul gruppo <span className="font-bold">{group.id}</span> vuoi mettere in pausa.
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
                  {activePhasesWithOperators.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessun operatore attivo su questo gruppo.</p>}
              </div>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setIsPauseDialogOpen(false)}>Annulla</Button>
                  <Button onClick={handleConfirmPause} disabled={selectedOperatorsToPause.length === 0}>
                      Metti in Pausa Selezionati ({selectedOperatorsToPause.length})
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
      
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
                              allOperators={allOperators}
                              analysisData={analysisData}
                              onProblemClick={() => {}}
                              onForceFinishClick={() => {}}
                              onRevertForceFinishClick={() => {}}
                              onToggleGuainaClick={() => {}}
                              onRevertPhaseClick={() => {}}
                              onRevertCompletionClick={() => {}}
                              onForcePauseClick={() => {}}
                              onForceCompleteClick={() => {}}
                              onResetJobOrderClick={() => {}}
                              onOpenPhaseManager={() => {}}
                              onOpenMaterialManager={() => {}}
                              isSelected={false}
                              onSelect={() => {}}
                              overallStatus={getOverallStatus(job)}
                              onNavigateToAnalysis={() => {}}
                              onCopyArticleCode={() => {}}
                          />
                      ))}
                  </div>
              </div>
          </DialogContent>
      </Dialog>
    </>
  );
}
