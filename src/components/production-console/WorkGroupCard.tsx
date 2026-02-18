
"use client";

import type { JobOrder, JobPhase, Operator, WorkGroup, RawMaterial, JobBillOfMaterialsItem } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Building, Circle, Hourglass, CheckCircle2, ShieldAlert, PauseCircle, MoreVertical, FastForward, CornerUpLeft, CornerDownRight, ListOrdered, Boxes, Users, PowerOff, Unlink, View, Combine, User, EyeOff, ChevronDown, ClipboardList, Copy, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import React, { useState, useMemo } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import BOMDialog from './BOMDialog';
import JobOrderCard from './JobOrderCard';

interface ActivePhaseInfo { phaseId: string; phaseName: string; operators: { id: string; name: string }[]; }

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
    group, jobsInGroup, allOperators, allRawMaterials, onProblemClick, onForceFinishClick, onForcePauseClick, onForceCompleteClick, onDissolveGroupClick, onOpenPhaseManager, onOpenMaterialManager, onToggleGuainaClick, isSelected, onSelect, overallStatus, getOverallStatus, onNavigateToAnalysis, onCopyArticleCode,
}: { 
    group: WorkGroup; jobsInGroup: JobOrder[]; allOperators: Operator[]; allRawMaterials: RawMaterial[]; onProblemClick: () => void; onForceFinishClick: (groupId: string) => void; onForcePauseClick: (groupId: string, operatorIds: string[]) => void; onForceCompleteClick: (groupId: string) => void; onDissolveGroupClick: (groupId: string) => void; onOpenPhaseManager: (item: JobOrder | WorkGroup) => void; onOpenMaterialManager: (item: JobOrder | WorkGroup) => void; onToggleGuainaClick: (itemId: string, phaseId: string, currentState: 'default' | 'postponed') => void; isSelected: boolean; onSelect: (groupId: string) => void; overallStatus: OverallStatus; getOverallStatus: (job: JobOrder) => OverallStatus; onNavigateToAnalysis: (articleCode: string) => void; onCopyArticleCode: (articleCode: string) => void;
}) {
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [isExplodeViewOpen, setIsExplodeViewOpen] = useState(false);
  const [isBOMDialogOpen, setIsBOMDialogOpen] = useState(false);
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const hasMatMissing = group.phases.some(p => p.materialStatus === 'missing');

  const syntheticJob: JobOrder = useMemo(() => {
    const compMap = new Map<string, { item: JobBillOfMaterialsItem, total: number }>();
    jobsInGroup.forEach(j => (j.billOfMaterials || []).forEach(i => {
        let req = (i.lunghezzaTaglioMm && i.lunghezzaTaglioMm > 0) ? (i.quantity * j.qta * i.lunghezzaTaglioMm / 1000) : i.quantity * j.qta;
        const ex = compMap.get(i.component);
        if (ex) ex.total += req; else compMap.set(i.component, { item: i, total: req });
    }));
    return { ...group, billOfMaterials: Array.from(compMap.values()).map(e => ({ ...e.item, quantity: e.total, isFromTemplate: false, isAggregated: true })), qta: 1 } as JobOrder;
  }, [group, jobsInGroup]);

  const activePhases = useMemo((): ActivePhaseInfo[] => {
    const map = new Map<string, ActivePhaseInfo>();
    group.phases?.forEach(p => {
        if (p.status === 'in-progress') {
            const ops = Array.from(new Map((p.workPeriods || []).filter(wp => wp.end === null).map(wp => { const o = allOperators.find(o => o.id === wp.operatorId); return o ? [o.id, { id: o.id, name: o.nome }] : null; }).filter(Boolean) as any).values()) as any;
            if (ops.length > 0) map.set(p.id, { phaseId: p.id, phaseName: p.name, operators: ops });
        }
    });
    return Array.from(map.values());
  }, [group, allOperators]);

  const progress = group.phases.length > 0 ? (group.phases.filter(p => p.status === 'completed' || p.status === 'skipped').length / group.phases.length) * 100 : 0;
  const isLive = group.phases.some(p => p.status === 'in-progress');
  const guaina = group.phases.find(p => p.name === "Taglio Guaina");
  const firstProd = group.phases.filter(p => p.type === 'production').sort((a,b) => a.sequence - b.sequence)[0];
  const isPostponed = guaina && firstProd && guaina.sequence > firstProd.sequence;

  return (
    <>
    <Collapsible asChild>
      <Card className={cn("relative flex flex-col h-full bg-card hover:bg-card/90 transition-all duration-300 border-2 border-teal-500/70", (group.isProblemReported || hasMatMissing) && "border-destructive/50", isSelected && "ring-2 ring-primary/50")}>
        <div className="flex-grow">
            <CardHeader className="pb-3 space-y-2">
                <div className="flex justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <Checkbox checked={isSelected} onCheckedChange={() => onSelect(group.id)} />
                        <TooltipProvider><Tooltip><TooltipTrigger><Combine className="h-5 w-5 text-teal-400" /></TooltipTrigger><TooltipContent><p>Gruppo: {group.id}</p></TooltipContent></Tooltip></TooltipProvider>
                        <CollapsibleTrigger asChild><div className="flex items-center gap-2 cursor-pointer group"><CardTitle className="font-headline text-base font-mono">{group.id}</CardTitle><ChevronDown className="h-5 w-5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:-rotate-180" /></div></CollapsibleTrigger>
                    </div>
                    <StatusBadge status={overallStatus} />
                </div>
                <div className="flex justify-between items-center gap-4">
                    <CardDescription className="flex items-center gap-2"><Building className="h-4 w-4 text-muted-foreground" />{group.cliente}</CardDescription>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setIsBOMDialogOpen(true); }}><ClipboardList className="h-4 w-4" /></Button>
                        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onOpenPhaseManager(group)}><ListOrdered className="mr-2 h-4 w-4" /> Fasi</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onOpenMaterialManager(group)}><Boxes className="mr-2 h-4 w-4" /> Materiali</DropdownMenuItem>
                                {guaina && (guaina.status === 'pending' || guaina.status === 'paused') && !group.phases.some(p => p.status === 'in-progress' || p.status === 'paused') && (
                                    <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()}>{isPostponed ? <CornerUpLeft className="mr-2 h-4 w-4" /> : <CornerDownRight className="mr-2 h-4 w-4" />} Sposta Guaina</DropdownMenuItem></AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Conferma</AlertDialogTitle><AlertDialogDescription>Spostare la guaina scioglierà il gruppo. Vuoi continuare?</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => onToggleGuainaClick(group.id, guaina.id, isPostponed ? 'postponed' : 'default')}>Conferma e Sciogli</AlertDialogAction></AlertDialogFooter>
                                    </AlertDialogContent></AlertDialog>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => { setSelectedOperators([]); setIsPauseDialogOpen(true); }} disabled={!isLive}><Users className="mr-2 h-4 w-4" /> Forza Pausa</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onForceFinishClick(group.id)} disabled={!['In Preparazione', 'Pronto per Produzione', 'In Lavorazione'].includes(overallStatus)}><FastForward className="mr-2 h-4 w-4" /> Forza Finitura</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onForceCompleteClick(group.id)} disabled={isLive || overallStatus === 'Completata'}><PowerOff className="mr-2 h-4 w-4" /> Forza Chiusura</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive"><Unlink className="mr-2 h-4 w-4" /> Annulla Gruppo</DropdownMenuItem></AlertDialogTrigger>
                                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Annullare gruppo?</AlertDialogTitle><AlertDialogDescription>Le commesse torneranno individuali.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Chiudi</AlertDialogCancel><AlertDialogAction onClick={() => onDissolveGroupClick(group.id)} className="bg-destructive">Sì, annulla</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                            </DropdownMenuContent></DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-grow space-y-4 pt-0">
                <div className="flex justify-between items-start gap-4 text-sm">
                    <p className="flex items-center gap-2 text-muted-foreground"><Boxes className="h-4 w-4" />{group.details}</p>
                    <div className="text-right"><span className="font-bold">{group.totalQuantity}</span><span className="text-muted-foreground text-xs ml-1">pz</span></div>
                </div>
                {activePhases.length > 0 && (
                  <div className="rounded-lg border-2 border-cyan-400/50 bg-cyan-900/20 p-3 space-y-2 animate-pulse">
                      {activePhases.map(info => (
                          <div key={info.phaseId}><p className="text-xs font-bold text-primary">{info.phaseName}:</p>
                            <div className="flex flex-wrap gap-1 mt-1">{info.operators.map(op => <Badge key={op.id} variant="outline" className="text-[10px] py-0 bg-background"><User className="h-2 w-2 mr-1" />{op.name}</Badge>)}</div>
                          </div>
                      ))}
                  </div>
                )}
            </CardContent>
        </div>
        <CardFooter className="flex-col items-start gap-2 pt-4">
          <div className="w-full"><div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Progresso</span><span>{Math.round(progress)}%</span></div><Progress value={progress} className="h-2" /></div>
        </CardFooter>
        <CollapsibleContent><div className="space-y-2 p-4"><Separator /><h4 className="text-sm font-semibold text-foreground/80 pt-2">Fasi</h4>
            {group.phases?.sort((a,b) => a.sequence - b.sequence).map(p => (
                <div key={p.id} className="flex items-center gap-3 text-sm text-muted-foreground">{getPhaseIcon(p.status)}<span className={cn(p.status === 'skipped' && 'line-through')}>{p.name}</span></div>
            ))}
            <Button variant="secondary" size="sm" className="w-full mt-4" onClick={() => setIsExplodeViewOpen(true)}><View className="mr-2 h-4 w-4" /> Esplodi ({jobsInGroup.length})</Button>
        </div></CollapsibleContent>
      </Card></Collapsible>
      
      {isBOMDialogOpen && <BOMDialog isOpen={isBOMDialogOpen} onOpenChange={setIsBOMDialogOpen} job={syntheticJob} allRawMaterials={allRawMaterials} />}

      <Dialog open={isPauseDialogOpen} onOpenChange={setIsPauseDialogOpen}>
          <DialogContent><DialogHeader><DialogTitle>Forza Pausa</DialogTitle></DialogHeader>
              <div className="py-4 space-y-2">
                  {activePhases.flatMap(p => p.operators).map(op => (
                      <div key={op.id} className="flex items-center space-x-2 p-2 border rounded-md">
                           <Checkbox checked={selectedOperators.includes(op.id)} onCheckedChange={c => setSelectedOperators(prev => c ? [...prev, op.id] : prev.filter(i => i !== op.id))} />
                           <Label className="flex-1">{op.name}</Label>
                      </div>
                  ))}
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setIsPauseDialogOpen(false)}>Annulla</Button><Button onClick={() => { onForcePauseClick(group.id, selectedOperators); setIsPauseDialogOpen(false); }} disabled={selectedOperators.length === 0}>Conferma</Button></DialogFooter>
          </DialogContent>
      </Dialog>
      
      <Dialog open={isExplodeViewOpen} onOpenChange={setIsExplodeViewOpen}>
          <DialogContent className="max-w-7xl h-[90vh]"><DialogHeader><DialogTitle>Commesse in Gruppo</DialogTitle></DialogHeader>
              <ScrollArea className="h-full mt-4"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{jobsInGroup.map(j => <JobOrderCard key={j.id} jobOrder={j} allRawMaterials={allRawMaterials} groupPhases={group.phases} allOperators={allOperators} onProblemClick={() => {}} onFetchAnalysis={() => {}} isAnalysisLoading={false} onForceFinishClick={() => {}} onRevertForceFinishClick={() => {}} onToggleGuainaClick={() => {}} onRevertPhaseClick={() => {}} onRevertCompletionClick={() => {}} onForcePauseClick={() => {}} onForceCompleteClick={() => {}} onResetJobOrderClick={() => {}} onOpenPhaseManager={() => {}} onOpenMaterialManager={() => {}} isSelected={false} onSelect={() => {}} overallStatus={getOverallStatus(j)} onNavigateToAnalysis={onNavigateToAnalysis} onCopyArticleCode={onCopyArticleCode} />)}</div></ScrollArea>
          </DialogContent>
      </Dialog>
    </>
  );
}
