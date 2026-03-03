
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
import { Timer, RefreshCcw, Save, Loader2, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Article, WorkPhaseTemplate, ArticlePhaseTime } from '@/lib/mock-data';
import { getProductionTimeAnalysisReport } from '../reports/actions';
import { saveArticlePhaseTimes } from './actions';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
                    ...(newPhaseTimes[template.id] || { expectedMinutesPerPiece: 0 }),
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
            ...(prev[phaseId] || { detectedMinutesPerPiece: 0 }),
            expectedMinutesPerPiece: isNaN(numValue) ? 0 : numValue
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
              <Timer className="h-6 w-6 text-primary" />
              Standard Tempi: {article?.code}
          </DialogTitle>
          <DialogDescription>
            Visualizza i tempi medi rilevati e imposta i tempi previsti (target) per ogni fase di lavorazione. I tempi sono espressi in **minuti per singolo pezzo**.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6">
            <div className="flex justify-end mb-4">
                <Button variant="outline" size="sm" onClick={handleUpdateTimes} disabled={isUpdating || !article}>
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                    Aggiorna Tempi Rilevati
                </Button>
            </div>

            <ScrollArea className="h-[calc(85vh-250px)] border rounded-md">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
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
                            const data = localPhaseTimes[phase.id] || { expectedMinutesPerPiece: 0, detectedMinutesPerPiece: 0 };
                            return (
                                <TableRow key={phase.id}>
                                    <TableCell className="font-medium">{phase.name}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-[10px] uppercase">
                                            {phase.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-muted-foreground">
                                        {data.detectedMinutesPerPiece > 0 ? data.detectedMinutesPerPiece.toFixed(4) : 'N/D'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Input 
                                                type="number" 
                                                step="0.0001" 
                                                className="w-24 text-right h-8"
                                                value={data.expectedMinutesPerPiece || ''}
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
