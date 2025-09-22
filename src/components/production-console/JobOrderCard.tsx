
import type { JobOrder, JobPhase } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Wrench, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, Calendar, AlertTriangle as AlertTriangleIcon, Printer, MoreVertical, FastForward, CheckSquare, CornerDownRight, CornerUpLeft, Undo2 } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import Link from 'next/link';
import { it } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export default function JobOrderCard({ jobOrder, onProblemClick, onForceFinishClick, onToggleGuainaClick, onRevertPhaseClick }: { jobOrder: JobOrder; onProblemClick: () => void; onForceFinishClick: (jobId: string) => void; onToggleGuainaClick: (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => void; onRevertPhaseClick: (jobId: string, phaseId: string) => void; }) {
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


  return (
    <Card 
      className={cn("flex flex-col h-full bg-card/80 hover:bg-card transition-colors duration-300", jobOrder.isProblemReported && "cursor-pointer border-destructive/50 hover:border-destructive")}
      onClick={jobOrder.isProblemReported ? onProblemClick : undefined}
    >
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <CardTitle className="font-headline text-lg">{jobOrder.ordinePF}</CardTitle>
          <StatusBadge status={overallStatus} />
        </div>
        <div className="flex justify-between items-center">
        <CardDescription className="flex items-center gap-2 pt-1">
          <Building className="h-4 w-4 text-muted-foreground" />
          {jobOrder.cliente}
        </CardDescription>
        <TooltipProvider>
          <div className="flex items-center">
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm">
             <Package className="h-4 w-4 text-muted-foreground" />
            {jobOrder.details}
          </p>
           {deliveryDate && (
            <p className={cn("flex items-center gap-2 text-sm font-medium", isOverdue ? "text-destructive" : "text-muted-foreground")}>
              {isOverdue ? <AlertTriangleIcon className="h-4 w-4"/> : <Calendar className="h-4 w-4" />}
              <span>Consegna: {format(deliveryDate, 'dd MMM yyyy', { locale: it })}</span>
            </p>
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
                                          Questa azione riporterà la fase "{phase.name}" allo stato "In attesa" e azzererà il tempo di lavoro registrato. Sei sicuro?
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
  );
}
