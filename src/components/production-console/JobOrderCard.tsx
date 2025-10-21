import type { JobOrder, JobPhase, Operator } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2, ClipboardList, Factory, Users, PowerOff, RefreshCcw, EyeOff, ListOrdered, ArrowUp, ArrowDown, ArchiveRestore, Boxes, User } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import Link from 'next/link';
import { it } from 'date-fns/locale';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '../ui/separator';

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

export default function JobOrderCard({ 
    jobOrder,
    allOperators,
    onProblemClick, 
    onForceFinishClick,
    onRevertForceFinishClick,
    onToggleGuainaClick, 
    onRevertPhaseClick, 
    onForcePauseClick,
    onForceCompleteClick,
    onResetJobOrderClick,
    onOpenPhaseManager,
    onOpenMaterialManager,
    onRevertCompletionClick,
    isSelected,
    onSelect,
    overallStatus
}: { 
    jobOrder: JobOrder;
    allOperators: Operator[];
    onProblemClick: () => void; 
    onForceFinishClick: (jobId: string) => void;
    onRevertForceFinishClick: (jobId: string) => void;
    onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; 
    onRevertPhaseClick: (jobId: string, phaseId: string) => void; 
    onForcePauseClick: (jobId: string, operatorIds: string[]) => void; 
    onForceCompleteClick: (jobId: string) => void;
    onResetJobOrderClick: (jobId: string) => void;
    onOpenPhaseManager: (item: JobOrder) => void;
    onOpenMaterialManager: (item: JobOrder) => void;
    onRevertCompletionClick: (jobId: string) => void;
    isSelected: boolean;
    onSelect: (jobId: string) => void;
    overallStatus: OverallStatus;
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [selectedOperatorsToPause, setSelectedOperatorsToPause] = useState<string[]>([]);
  const hasMaterialMissing = jobOrder.phases.some(p => p.materialStatus === 'missing');
  

  const activePhasesWithOperators = useMemo((): ActivePhaseInfo[] => {
    const activePhasesMap = new Map<string, ActivePhaseInfo>();
    
    (jobOrder.phases || []).forEach(phase => {
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
  }, [jobOrder, allOperators]);
  
  const handleOpenPauseDialog = () => {
    setSelectedOperatorsToPause([]);
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
  
  const completedPhasesCount = jobOrder.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = jobOrder.phases.length > 0 ? (completedPhasesCount / jobOrder.phases.length) * 100 : 0;
  
  const deliveryDateString = jobOrder.dataConsegnaFinale;
  const deliveryDate = deliveryDateString && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDateString)
    ? parseISO(deliveryDateString)
    : null;
    
  const isOverdue = deliveryDate && isPast(new Date(deliveryDate.toDateString())) && overallStatus !== 'Completata';
  
  const isAnyPhaseActive = activePhasesWithOperators.length > 0;
  const canForceFinish = ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus);
  const canForceComplete = !isAnyPhaseActive && overallStatus !== 'Completata';

  const isForcedToFinish = jobOrder.phases.some(p => p.forced);


  const guainaPhase = jobOrder.phases.find(p => p.name === "Taglio Guaina");
  
  const firstProductionPhase = jobOrder.phases
      .filter(p => p.type === 'production')
      .sort((a,b) => a.sequence - b.sequence)[0];
      
  const isGuainaPostponed = guainaPhase && firstProductionPhase && guainaPhase.sequence > firstProductionPhase.sequence;

  const isWorkInProgress = jobOrder.phases.some(p => p.status === 'in-progress' || p.status === 'paused');
  const canToggleGuaina = guainaPhase && (guainaPhase.status === 'pending' || guainaPhase.status === 'paused') && !isWorkInProgress;
  
  const isPartOfGroup = !!jobOrder.workGroupId;

  return (
    <>
      <Card 
        className={cn(
            "relative flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300", 
            (jobOrder.isProblemReported || hasMaterialMissing) && "cursor-pointer border-destructive/50 hover:border-destructive",
            isSelected && "border-primary ring-2 ring-primary/50",
            isPartOfGroup && "shadow-none border-border/70",
            isOverdue && 'border-destructive/30'
        )}
        onClick={(jobOrder.isProblemReported || hasMaterialMissing) ? onProblemClick : undefined}
      >
         <CardHeader className="pb-3 space-y-2">
             <div className="flex justify-between items-center gap-4">
                 <div className="flex items-center gap-3">
                    {!isPartOfGroup && (
                      <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onSelect(jobOrder.id)}
                          aria-label={`Seleziona commessa ${jobOrder.id}`}
                          className="h-4 w-4"
                      />
                    )}
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
                    {!isPartOfGroup && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                        <Link href={`/admin/reports/${jobOrder.id}`}><CheckSquare className="h-4 w-4" /></Link>
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
                    {!isPartOfGroup && (
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                              </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                             <DropdownMenuItem onSelect={() => onOpenPhaseManager(jobOrder)} disabled={overallStatus === 'Completata'}>
                                  <ListOrdered className="mr-2 h-4 w-4" />
                                  <span>Gestisci Fasi</span>
                              </DropdownMenuItem>
                               <DropdownMenuItem onSelect={() => onOpenMaterialManager(jobOrder)} disabled={overallStatus === 'Completata'}>
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
                                              <AlertDialogAction onClick={() => onToggleGuainaClick(jobOrder.id, guainaPhase.id, isGuainaPostponed ? 'postponed' : 'default')}>Conferma</AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                              )}
                               <DropdownMenuSeparator />
                               <DropdownMenuItem onSelect={handleOpenPauseDialog} disabled={!isAnyPhaseActive}>
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
                               {jobOrder.forcedCompletion && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-amber-600 focus:text-amber-700">
                                      <ArchiveRestore className="mr-2 h-4 w-4" />
                                      <span>Riapri Commessa</span>
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Sei sicuro di voler riaprire?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Questa azione riporterà la commessa al suo ultimo stato di avanzamento, annullando la chiusura forzata.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => onRevertCompletionClick(jobOrder.id)}>Sì, riapri</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
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
                    )}
                </div>
            </div>

            {(jobOrder.isProblemReported || hasMaterialMissing) && (
                <p className="text-sm text-destructive font-semibold mt-2 flex items-center">
                    <ShieldAlert className="mr-2 h-4 w-4" /> 
                    {jobOrder.isProblemReported ? "Problema segnalato!" : "Materiale mancante!"}
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
           
           {isAnyPhaseActive && (
              <div className="rounded-lg border-2 border-cyan-400/50 bg-cyan-400/10 p-3 space-y-3 animate-pulse dark:bg-cyan-900/20">
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
              {jobOrder.phases && jobOrder.phases.length > 0 ? (
                  jobOrder.phases.sort((a,b) => a.sequence - b.sequence).map(phase => (
                      <div key={phase.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                          {getPhaseIcon(phase.status)}
                          <span className={cn("flex-1", phase.status === 'skipped' && 'line-through')}>{phase.name}</span>
                          {phase.status === 'completed' && overallStatus !== 'Completata' && !isPartOfGroup && (
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
    </>
  );
}
