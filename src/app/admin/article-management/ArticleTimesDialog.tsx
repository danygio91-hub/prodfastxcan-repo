
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
import { Timer, RefreshCcw, Save, Loader2, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Article, WorkPhaseTemplate, ArticlePhaseTime } from '@/lib/mock-data';
import { getProductionTimeAnalysisReport } from '../reports/actions';
import { saveArticlePhaseTimes } from './actions';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
  
  const [localPhaseTimes, setLocalPhaseTimes] = useState<Record<string, ArticlePhaseTime>>({});

  useEffect(() => {
    if (isOpen && article) {
      setLocalPhaseTimes(article.phaseTimes || {});
    }
  }, [isOpen, article]);

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
                description: `Non ci sono ancora rilevazioni cronometrate affidabili per l'articolo ${article.code}.`
            });
            setIsUpdating(false);
            return;
        }

        const newPhaseTimes = { ...localPhaseTimes };
        articleReport.averagePhaseTimes.forEach(rptPhase => {
            const template = phaseTemplates.find(t => t.name.toLowerCase() === rptPhase.name.toLowerCase());
            if (template) {
                newPhaseTimes[template.id] = {
                    ...(newPhaseTimes[template.id] || { expectedMinutesPerPiece: 0, enabled: true }),
                    detectedMinutesPerPiece: rptPhase.averageMinutesPerPiece
                };
            }
        });

        setLocalPhaseTimes(newPhaseTimes);
        toast({ title: "Tempi Rilevati Aggiornati", description: "I dati sono stati caricati dall'analisi tempi. Ricorda di salvare." });
    } catch (e) {
        toast({ variant: "destructive", title: "Errore", description: "Impossibile caricare l'analisi tempi." });
    } finally {
        setIsUpdating(false);
    }
  };

  const handleExpectedTimeChange = (phaseId: string, value: string) => {
    const numValue = parseFloat(value);
    setLocalPhaseTimes(prev => ({
        ...prev,
        [phaseId]: {
            ...(prev[phaseId] || { detectedMinutesPerPiece: 0, enabled: true }),
            expectedMinutesPerPiece: isNaN(numValue) ? 0 : numValue
        }
    }));
  };

  const handleToggleEnabled = (phaseId: string, checked: boolean) => {
    setLocalPhaseTimes(prev => ({
        ...prev,
        [phaseId]: {
            ...(prev[phaseId] || { expectedMinutesPerPiece: 0, detectedMinutesPerPiece: 0 }),
            enabled: checked
        }
    }));
  };

  const handleSave = async () => {
    if (!article) return;
    setIsPending(true);
    const result = await saveArticlePhaseTimes(article.id, localPhaseTimes);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        onClose(true);
    }
    setIsPending(false);
  };

  const sortedTemplates = useMemo(() => {
      return [...phaseTemplates].sort((a,b) => a.sequence - b.sequence);
  }, [phaseTemplates]);

  const stats = useMemo(() => {
    let totalExpected = 0;
    let totalDetected = 0;
    let expectedCount = 0;
    let detectedCount = 0;
    let enabledCount = 0;

    sortedTemplates.forEach(t => {
        const data = localPhaseTimes[t.id];
        // If data is undefined, we treat it as enabled: true by default
        const isEnabled = data ? data.enabled !== false : true;

        if (isEnabled) {
            enabledCount++;
            const expected = data?.expectedMinutesPerPiece || 0;
            const detected = data?.detectedMinutesPerPiece || 0;

            if (expected > 0) {
                totalExpected += expected;
                expectedCount++;
            }
            if (detected > 0) {
                totalDetected += detected;
                detectedCount++;
            }
        }
    });

    return {
        totalExpected,
        totalDetected,
        isExpectedComplete: enabledCount > 0 && expectedCount === enabledCount,
        isDetectedComplete: enabledCount > 0 && detectedCount === enabledCount,
        enabledCount
    };
  }, [sortedTemplates, localPhaseTimes]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
              <Timer className="h-6 w-6 text-primary" />
              Standard Tempi: {article?.code}
          </DialogTitle>
          <DialogDescription>
            Visualizza i tempi medi rilevati e imposta i tempi previsti (target) per ogni fase di lavorazione. I tempi sono espressi in **minuti per singolo pezzo**.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
                <div className="flex gap-4">
                    <div className={cn(
                        "p-3 border rounded-lg flex flex-col items-center justify-center min-w-[180px]",
                        stats.enabledCount === 0 ? "bg-muted" : stats.isExpectedComplete ? "bg-green-500/10 border-green-500/50" : "bg-yellow-500/10 border-yellow-500/50"
                    )}>
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">Tempo Previsto Totale</span>
                        <span className={cn(
                            "text-xl font-bold font-mono",
                            stats.enabledCount === 0 ? "text-muted-foreground" : stats.isExpectedComplete ? "text-green-600" : "text-yellow-600"
                        )}>
                            {stats.totalExpected.toFixed(4)} <small className="text-xs">min</small>
                        </span>
                    </div>

                    <div className={cn(
                        "p-3 border rounded-lg flex flex-col items-center justify-center min-w-[180px]",
                        stats.enabledCount === 0 ? "bg-muted" : stats.isDetectedComplete ? "bg-green-500/10 border-green-500/50" : "bg-yellow-500/10 border-yellow-500/50"
                    )}>
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">Tempo Rilevato Totale</span>
                        <span className={cn(
                            "text-xl font-bold font-mono",
                            stats.enabledCount === 0 ? "text-muted-foreground" : stats.isDetectedComplete ? "text-green-600" : "text-yellow-600"
                        )}>
                            {stats.totalDetected.toFixed(4)} <small className="text-xs">min</small>
                        </span>
                    </div>
                </div>

                <Button variant="outline" size="sm" onClick={handleUpdateTimes} disabled={isUpdating || !article}>
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                    Aggiorna Tempi Rilevati
                </Button>
            </div>

            <ScrollArea className="flex-1 border rounded-md">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                            <TableHead className="w-[50px]">Attiva</TableHead>
                            <TableHead>Fase di Lavorazione</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                    Tempi Rilevati (min/pz)
                                    <TooltipProvider><Tooltip><TooltipTrigger><Info className="h-3 w-3"/></TooltipTrigger><TooltipContent>Media storica calcolata dai report.</TooltipContent></Tooltip></TooltipProvider>
                                </div>
                            </TableHead>
                            <TableHead className="text-right w-[180px]">Tempi Previsti (min/pz)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedTemplates.map((phase) => {
                            const data = localPhaseTimes[phase.id];
                            // Default to enabled: true if not explicitly set
                            const isEnabled = data ? data.enabled !== false : true;
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
                                    <TableCell className="font-medium">{phase.name}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-[10px] uppercase">
                                            {phase.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-muted-foreground">
                                        {detectedTime > 0 ? detectedTime.toFixed(4) : 'N/D'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Input 
                                                type="number" 
                                                step="0.0001" 
                                                disabled={!isEnabled}
                                                className="w-24 text-right h-8"
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
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salva Standard Tempi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
