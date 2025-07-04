
import type { JobOrder, JobPhase } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Package, Building, Wrench, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle } from 'lucide-react';

function getOverallStatus(jobOrder: JobOrder): OverallStatus {
  // Priority 1: Terminal/Blocking states
  if (jobOrder.status === 'suspended') return 'Sospesa';
  if (jobOrder.isProblemReported) return 'Problema';
  if (jobOrder.status === 'completed') return 'Completata';

  // Check phases
  const preparationPhases = jobOrder.phases.filter(p => (p.type ?? 'production') === 'preparation');
  const productionPhases = jobOrder.phases.filter(p => (p.type ?? 'production') === 'production');

  const isAnyPreparationActive = preparationPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyPreparationActive) {
    return 'In Preparazione';
  }

  const isAnyProductionActive = productionPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
  if (isAnyProductionActive) {
    return 'In Lavorazione';
  }

  if (preparationPhases.length > 0) {
      const allPreparationDone = preparationPhases.every(p => p.status === 'completed');
      if (allPreparationDone && (productionPhases.length === 0 || productionPhases.every(p => p.status === 'pending'))) {
          return 'Pronto per Produzione';
      }
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

export default function JobOrderCard({ jobOrder }: { jobOrder: JobOrder }) {
  const overallStatus = getOverallStatus(jobOrder);
  const currentPhase = getCurrentPhase(jobOrder.phases);
  const completedPhasesCount = jobOrder.phases.filter(p => p.status === 'completed').length;
  const progressPercentage = jobOrder.phases.length > 0 ? (completedPhasesCount / jobOrder.phases.length) * 100 : 0;

  return (
    <Card className="flex flex-col h-full bg-card/80 hover:bg-card transition-colors duration-300">
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <CardTitle className="font-headline text-lg">{jobOrder.ordinePF}</CardTitle>
          <StatusBadge status={overallStatus} />
        </div>
        <CardDescription className="flex items-center gap-2 pt-1">
          <Building className="h-4 w-4 text-muted-foreground" />
          {jobOrder.cliente}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div>
          <p className="flex items-center gap-2 text-sm">
             <Package className="h-4 w-4 text-muted-foreground" />
            {jobOrder.details}
          </p>
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
          <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20">
            <p className="text-sm font-semibold flex items-center gap-2 text-destructive-foreground">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              Problema Segnalato
            </p>
          </div>
        )}
        <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground/80">Avanzamento Fasi</h4>
            {jobOrder.phases && jobOrder.phases.length > 0 ? (
                jobOrder.phases.sort((a,b) => a.sequence - b.sequence).map(phase => (
                    <div key={phase.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                        {getPhaseIcon(phase.status)}
                        <span>{phase.name}</span>
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
