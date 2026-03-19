
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle 
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Timer, RefreshCcw, Save, Loader2, GitMerge } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Article, WorkPhaseTemplate, ArticlePhaseTime, WorkCycle } from '@/lib/mock-data';
import { getProductionTimeAnalysisReport } from '../reports/actions';
import { saveArticleStandardTimes } from './actions';
import { getWorkCycles } from '../work-cycle-management/actions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';

interface ArticleTimesDialogProps {
  isOpen: boolean;
  onClose: (refresh?: boolean) => void;
  article: Article | null;
  phaseTemplates: WorkPhaseTemplate[];
}

export default function ArticleTimesDialog({ isOpen, onClose, article, phaseTemplates }: ArticleTimesDialogProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);
  
  // View states
  const [activeView, setActiveView] = useState<'default' | 'secondary'>('default');
  
  // Data states
  const [primaryCycleId, setPrimaryCycleId] = useState<string>('manual');
  const [secondaryCycleId, setSecondaryCycleId] = useState<string>('manual');
  
  const [expectedTotalDefault, setExpectedTotalDefault] = useState<number>(0);
  const [expectedTotalSecondary, setExpectedTotalSecondary] = useState<number>(0);

  const [localPhaseTimesDefault, setLocalPhaseTimesDefault] = useState<Record<string, ArticlePhaseTime>>({});
  const [localPhaseTimesSecondary, setLocalPhaseTimesSecondary] = useState<Record<string, ArticlePhaseTime>>({});

  useEffect(() => {
    if (isOpen) {
        getWorkCycles().then(setWorkCycles);
        if (article) {
            setPrimaryCycleId(article.workCycleId || 'manual');
            setSecondaryCycleId(article.secondaryWorkCycleId || 'manual');
            
            setExpectedTotalDefault(article.expectedMinutesDefault || 0);
            setExpectedTotalSecondary(article.expectedMinutesSecondary || 0);

            setLocalPhaseTimesDefault(article.phaseTimes || {});
            setLocalPhaseTimesSecondary(article.phaseTimesSecondary || {});
        }
    }
  }, [isOpen, article]);

  const currentPhaseTimes = activeView === 'default' ? localPhaseTimesDefault : localPhaseTimesSecondary;
  const setCurrentPhaseTimes = activeView === 'default' ? setLocalPhaseTimesDefault : setLocalPhaseTimesSecondary;

  const handleUpdateTimes = async () => {
    if (!article) return;
    setIsUpdating(true);
    try {
        const report = await getProductionTimeAnalysisReport();
        const articleReport = report.find(r => r.articleCode.toUpperCase() === article.code.toUpperCase());
        
        if (!articleReport) {
            toast({
                variant: "destructive",
                title: "Nessun dato trovato",
                description: `Non ci sono ancora rilevazioni affidabili per l'articolo ${article.code}.`
            });
            setIsUpdating(false);
            return;
        }

        const newPhaseTimes = { ...currentPhaseTimes };
        articleReport.averagePhaseTimes.forEach(rptPhase => {
            const template = phaseTemplates.find(t => t.name.toLowerCase() === rptPhase.name.toLowerCase());
            if (template) {
                newPhaseTimes[template.id] = {
                    ...(newPhaseTimes[template.id] || { expectedMinutesPerPiece: 0, enabled: true }),
                    detectedMinutesPerPiece: rptPhase.averageMinutesPerPiece
                };
            }
        });

        setCurrentPhaseTimes(newPhaseTimes);
        toast({ title: "Tempi Rilevati Aggiornati", description: "I dati sono stati caricati dall'analisi tempi. Ricorda di salvare." });
    } catch (e) {
        toast({ variant: "destructive", title: "Errore", description: "Impossibile caricare l'analisi tempi." });
    } finally {
        setIsUpdating(false);
    }
  };

  const handleCycleChange = (cycleId: string, type: 'default' | 'secondary') => {
    if (type === 'default') setPrimaryCycleId(cycleId);
    else setSecondaryCycleId(cycleId);

    if (cycleId === 'manual') return;

    const selectedCycle = workCycles.find(c => c.id === cycleId);
    if (!selectedCycle) return;

    const cyclePhases = new Set(selectedCycle.phaseTemplateIds);
    const newPhaseTimes = { ...(type === 'default' ? localPhaseTimesDefault : localPhaseTimesSecondary) };

    phaseTemplates.forEach(t => {
        newPhaseTimes[t.id] = {
            ...(newPhaseTimes[t.id] || { expectedMinutesPerPiece: 0, detectedMinutesPerPiece: 0 }),
            enabled: cyclePhases.has(t.id)
        };
    });

    if (type === 'default') setLocalPhaseTimesDefault(newPhaseTimes);
    else setLocalPhaseTimesSecondary(newPhaseTimes);
    
    toast({ title: "Ciclo Applicato", description: `Le fasi sono state aggiornate in base al ciclo "${selectedCycle.name}".` });
  };

  const handleExpectedTimeChange = (phaseId: string, value: string) => {
    const numValue = parseFloat(value);
    setCurrentPhaseTimes(prev => ({
        ...prev,
        [phaseId]: {
            ...(prev[phaseId] || { detectedMinutesPerPiece: 0, enabled: true }),
            expectedMinutesPerPiece: isNaN(numValue) ? 0 : numValue
        }
    }));
  };

  const handleToggleEnabled = (phaseId: string, checked: boolean) => {
    if (activeView === 'default') setPrimaryCycleId('manual');
    else setSecondaryCycleId('manual');

    setCurrentPhaseTimes(prev => ({
        ...prev,
        [phaseId]: {
            ...(prev[phaseId] || { expectedMinutesPerPiece: 0, detectedMinutesPerPiece: 0 }),
            enabled: checked
        }
    }));
  };

  const sortedTemplates = useMemo(() => {
      return [...phaseTemplates].sort((a,b) => a.sequence - b.sequence);
  }, [phaseTemplates]);

  const stats = useMemo(() => {
    let totalExpected = 0;
    let totalDetected = 0;
    let expectedCompleteCount = 0;
    let detectedCompleteCount = 0;
    let enabledCount = 0;

    sortedTemplates.forEach(t => {
        const data = currentPhaseTimes[t.id];
        const isEnabled = data ? data.enabled !== false : false;

        if (isEnabled) {
            enabledCount++;
            const expected = data?.expectedMinutesPerPiece || 0;
            const detected = data?.detectedMinutesPerPiece || 0;

            totalExpected += expected;
            totalDetected += detected;

            if (expected > 0) expectedCompleteCount++;
            if (detected > 0) detectedCompleteCount++;
        }
    });

    return {
        totalExpected,
        totalDetected,
        isExpectedComplete: enabledCount > 0 && expectedCompleteCount === enabledCount,
        isDetectedComplete: enabledCount > 0 && detectedCompleteCount === enabledCount,
        enabledCount
    };
  }, [sortedTemplates, currentPhaseTimes]);

  const handleSave = async () => {
    if (!article) return;
    setIsPending(true);

    const data: Partial<Article> = {
        workCycleId: primaryCycleId,
        secondaryWorkCycleId: secondaryCycleId,
        expectedMinutesDefault: activeView === 'default' ? (stats.isExpectedComplete ? stats.totalExpected : expectedTotalDefault) : expectedTotalDefault,
        expectedMinutesSecondary: activeView === 'secondary' ? (stats.isExpectedComplete ? stats.totalExpected : expectedTotalSecondary) : expectedTotalSecondary,
        phaseTimes: localPhaseTimesDefault,
        phaseTimesSecondary: localPhaseTimesSecondary,
    };

    const result = await saveArticleStandardTimes(article.id, data);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) onClose(true);
    setIsPending(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[95vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
              <Timer className="h-6 w-6 text-primary" />
              Standard Tempi: {article?.code}
          </DialogTitle>
          <DialogDescription>
            Configura i cicli e i tempi target. Se tutte le fasi hanno un tempo, il totale verrà aggiornato automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 flex flex-col gap-4">
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-md">
                    <TabsTrigger value="default" className="gap-2"><Badge variant="outline">1</Badge> Ciclo Predefinito</TabsTrigger>
                    <TabsTrigger value="secondary" className="gap-2"><Badge variant="outline">2</Badge> Ciclo Secondario</TabsTrigger>
                </TabsList>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    <Card className="lg:col-span-4 bg-muted/20 border-primary/20">
                        <CardContent className="p-4 space-y-4">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
                                    <GitMerge className="h-3 w-3" /> 
                                    Ciclo Applicato ({activeView === 'default' ? 'Primario' : 'Secondario'})
                                </Label>
                                <Select 
                                    onValueChange={(v) => handleCycleChange(v, activeView)} 
                                    value={activeView === 'default' ? primaryCycleId : secondaryCycleId}
                                >
                                    <SelectTrigger className="w-full h-9 text-xs">
                                        <SelectValue placeholder="Seleziona..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual">Personalizzazione Manuale</SelectItem>
                                        {workCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
                                    <Timer className="h-3 w-3" />
                                    Tempo Previsto Totale (min)
                                </Label>
                                <div className="relative">
                                    <Input 
                                        type="number" 
                                        step="0.01" 
                                        className="text-lg font-black font-mono border-primary/30 h-12 pr-12"
                                        value={activeView === 'default' ? expectedTotalDefault : expectedTotalSecondary}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            if (activeView === 'default') setExpectedTotalDefault(val);
                                            else setExpectedTotalSecondary(val);
                                        }}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground text-xs">min</span>
                                </div>
                                {stats.isExpectedComplete && (
                                    <p className="text-[10px] text-green-600 font-bold flex items-center gap-1 animate-pulse">
                                        <RefreshCcw className="h-3 w-3"/> Verrà aggiornato a {stats.totalExpected.toFixed(2)} min al salvataggio
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <div className="lg:col-span-8 grid grid-cols-2 gap-4">
                        <div className={cn(
                            "p-4 border rounded-lg flex flex-col items-center justify-center transition-colors",
                            stats.isExpectedComplete ? "bg-green-500/10 border-green-500/50" : "bg-yellow-500/10 border-yellow-500/50"
                        )}>
                            <span className="text-[10px] uppercase font-black text-muted-foreground">Somma Fasi</span>
                            <span className={cn("text-2xl font-black font-mono", stats.isExpectedComplete ? "text-green-600" : "text-yellow-600")}>
                                {stats.totalExpected.toFixed(4)} <small className="text-xs">min</small>
                            </span>
                        </div>

                        <div className={cn(
                            "p-4 border rounded-lg flex flex-col items-center justify-center transition-colors",
                            stats.isDetectedComplete ? "bg-green-500/10 border-green-500/50" : "bg-muted"
                        )}>
                            <span className="text-[10px] uppercase font-black text-muted-foreground">Tempo Rilevato Medio</span>
                            <span className={cn("text-2xl font-black font-mono", stats.isDetectedComplete ? "text-green-600" : "text-muted-foreground")}>
                                {stats.totalDetected.toFixed(4)} <small className="text-xs">min</small>
                            </span>
                        </div>
                    </div>
                </div>
            </Tabs>

            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleUpdateTimes} disabled={isUpdating || !article}>
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                    Carica da Analisi Tempi
                </Button>
            </div>

            <ScrollArea className="flex-1 border rounded-md shadow-inner bg-card">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                        <TableRow>
                            <TableHead className="w-[50px]">Attiva</TableHead>
                            <TableHead>Fase di Lavorazione</TableHead>
                            <TableHead className="text-right">Rilevato (min)</TableHead>
                            <TableHead className="text-right w-[180px]">Previsto Target (min/pz)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedTemplates.map((phase) => {
                            const data = currentPhaseTimes[phase.id];
                            const isEnabled = data ? data.enabled !== false : false;
                            const detectedTime = data?.detectedMinutesPerPiece || 0;
                            const expectedTime = data?.expectedMinutesPerPiece || 0;

                            return (
                                <TableRow key={phase.id} className={cn(!isEnabled && "opacity-40 bg-muted/20")}>
                                    <TableCell>
                                        <Checkbox 
                                            checked={isEnabled} 
                                            onCheckedChange={(checked) => handleToggleEnabled(phase.id, !!checked)} 
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-sm uppercase tracking-tight">{phase.name}</span>
                                            <span className="text-[10px] text-muted-foreground uppercase">{phase.type}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-muted-foreground">
                                        {detectedTime > 0 ? detectedTime.toFixed(4) : '---'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Input 
                                                type="number" 
                                                step="0.0001" 
                                                disabled={!isEnabled}
                                                className="w-32 text-right h-9 font-mono font-bold bg-background"
                                                value={expectedTime || ''}
                                                onChange={(e) => handleExpectedTimeChange(phase.id, e.target.value)}
                                                placeholder="0.0000"
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>

        <DialogFooter className="p-6 pt-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onClose()}>Annulla</Button>
          <Button onClick={handleSave} disabled={isPending} className="px-8">
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salva Standard Tempi
          </Button>
        </DialogFooter>
      </Dialog>
    </Dialog>
  );
}
