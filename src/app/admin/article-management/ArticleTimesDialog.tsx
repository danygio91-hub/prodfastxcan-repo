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
import { Timer, RefreshCcw, Save, Loader2, Copy } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Article, WorkPhaseTemplate, ArticlePhaseTime, WorkCycle } from '@/types';
import { saveArticleStandardTimes, refreshArticleHistoricalTimes } from './actions';
import { getWorkCycles } from '../work-cycle-management/actions';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';

interface ArticleTimesDialogProps {
    isOpen: boolean;
    onClose: (refresh?: boolean, updatedArticle?: Article) => void;
    article: Article | null;
    phaseTemplates: WorkPhaseTemplate[];
}

function applyCyclePhases(
    cycleId: string,
    cyclesList: WorkCycle[],
    currentTimes: Record<string, ArticlePhaseTime>,
    phaseTemplates: WorkPhaseTemplate[]
): Record<string, ArticlePhaseTime> {
    if (cycleId === 'manual') return currentTimes;

    const selectedCycle = cyclesList.find(c => c.id === cycleId);
    if (!selectedCycle) return currentTimes;

    const cyclePhases = new Set(selectedCycle.phaseTemplateIds);
    const newPhaseTimes = { ...currentTimes };

    phaseTemplates.forEach(t => {
        const existing = newPhaseTimes[t.id];
        newPhaseTimes[t.id] = {
            ...(existing || { expectedMinutesPerPiece: "" as any, detectedMinutesPerPiece: 0 }),
            enabled: cyclePhases.has(t.id)
        };
    });

    return newPhaseTimes;
}

export default function ArticleTimesDialog({ isOpen, onClose, article, phaseTemplates }: ArticleTimesDialogProps) {
    const { toast } = useToast();
    const [isPending, setIsPending] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);

    const [activeView, setActiveView] = useState<'default' | 'secondary'>('default');
    const [primaryCycleId, setPrimaryCycleId] = useState<string>('manual');
    const [secondaryCycleId, setSecondaryCycleId] = useState<string>('manual');
    const [expectedTotalDefault, setExpectedTotalDefault] = useState<number | string>("");
    const [expectedTotalSecondary, setExpectedTotalSecondary] = useState<number | string>("");
    const [localPhaseTimesDefault, setLocalPhaseTimesDefault] = useState<Record<string, ArticlePhaseTime>>({});
    const [localPhaseTimesSecondary, setLocalPhaseTimesSecondary] = useState<Record<string, ArticlePhaseTime>>({});

    useEffect(() => {
        if (isOpen) {
            getWorkCycles().then((cycles) => {
                setWorkCycles(cycles);
                if (article) {
                    const primaryId = article.workCycleId || 'manual';
                    const secondaryId = article.secondaryWorkCycleId || 'manual';

                    setPrimaryCycleId(primaryId);
                    setSecondaryCycleId(secondaryId);
                    setExpectedTotalDefault(article.expectedMinutesDefault || "");
                    setExpectedTotalSecondary(article.expectedMinutesSecondary || "");
                    
                    const roundTo3 = (v: any) => {
                        const parsed = parseFloat(v);
                        if (isNaN(parsed)) return "";
                        return (Math.round(parsed * 1000) / 1000).toString();
                    };

                    const prepareInitialTimes = (obj: Record<string, ArticlePhaseTime>) => {
                        const res: Record<string, ArticlePhaseTime> = {};
                        Object.keys(obj).forEach(key => {
                            res[key] = {
                                ...obj[key],
                                expectedMinutesPerPiece: obj[key].expectedMinutesPerPiece !== undefined ? roundTo3(obj[key].expectedMinutesPerPiece) as any : ""
                            };
                        });
                        return res;
                    };

                    let initialDefault = prepareInitialTimes(article.phaseTimes || {});
                    let initialSecondary = prepareInitialTimes(article.phaseTimesSecondary || {});

                    // Auto-populate from historicalTimes
                    if (article.historicalTimes?.averagePhaseTimes) {
                        const historicalUpdates: Record<string, number> = {};
                        article.historicalTimes.averagePhaseTimes.forEach((rptPhase: any) => {
                            const template = phaseTemplates.find(t => t.name.trim().toUpperCase() === rptPhase.name.trim().toUpperCase());
                            if (template) {
                                historicalUpdates[template.id] = rptPhase.averageMinutesPerPiece;
                            }
                        });

                        const applyHistorical = (phaseTimesObj: Record<string, ArticlePhaseTime>) => {
                            const newObj = { ...phaseTimesObj };
                            Object.keys(historicalUpdates).forEach(templateId => {
                                const existingExpected = newObj[templateId]?.expectedMinutesPerPiece;
                                newObj[templateId] = {
                                    ...(newObj[templateId] || { expectedMinutesPerPiece: "", enabled: true }),
                                    detectedMinutesPerPiece: historicalUpdates[templateId],
                                    expectedMinutesPerPiece: existingExpected !== undefined && existingExpected !== null ? existingExpected : "" as any
                                };
                            });
                            return newObj;
                        };

                        initialDefault = applyHistorical(initialDefault);
                        initialSecondary = applyHistorical(initialSecondary);
                    }

                    // Apply standard phases of the cycles if they are assigned, preserving existing times/targets
                    if (primaryId !== 'manual') {
                        initialDefault = applyCyclePhases(primaryId, cycles, initialDefault, phaseTemplates);
                    }
                    if (secondaryId !== 'manual') {
                        initialSecondary = applyCyclePhases(secondaryId, cycles, initialSecondary, phaseTemplates);
                    }

                    setLocalPhaseTimesDefault(initialDefault);
                    setLocalPhaseTimesSecondary(initialSecondary);
                }
            });
        }
    }, [isOpen, article, phaseTemplates]);

    const currentPhaseTimes = activeView === 'default' ? localPhaseTimesDefault : localPhaseTimesSecondary;

    const stats = useMemo(() => {
        let totalExpected = 0;
        let totalDetected = 0;
        let expectedCompleteCount = 0;
        let enabledCount = 0;

        phaseTemplates.forEach(t => {
            const data = currentPhaseTimes[t.id];
            const isEnabled = data ? data.enabled !== false : false;
            if (isEnabled) {
                enabledCount++;
                const expected = parseFloat(data?.expectedMinutesPerPiece as any) || 0;
                totalExpected += expected;
                totalDetected += (data?.detectedMinutesPerPiece || 0);
                if (expected > 0) expectedCompleteCount++;
            }
        });

        return {
            totalExpected,
            totalDetected,
            isExpectedComplete: enabledCount > 0 && expectedCompleteCount === enabledCount,
        };
    }, [phaseTemplates, currentPhaseTimes]);

    const handleUpdateTimes = async () => {
        if (!article) return;
        setIsUpdating(true);
        try {
            const result = await refreshArticleHistoricalTimes(article.code);
            
            if (!result.success || !result.historicalTimes || !result.historicalTimes.averagePhaseTimes || result.historicalTimes.averagePhaseTimes.length === 0) {
                toast({ variant: "destructive", title: "Nessun dato trovato", description: `Non ci sono nuove rilevazioni calcolabili per ${article.code}.` });
                return;
            }

            const newPhaseTimes = { ...currentPhaseTimes };
            result.historicalTimes.averagePhaseTimes.forEach((rptPhase: any) => {
                const template = phaseTemplates.find(t => t.name.trim().toUpperCase() === rptPhase.name.trim().toUpperCase());
                if (template) {
                    newPhaseTimes[template.id] = {
                        ...(newPhaseTimes[template.id] || { expectedMinutesPerPiece: "", enabled: true }),
                        detectedMinutesPerPiece: rptPhase.averageMinutesPerPiece
                    };
                }
            });

            if (activeView === 'default') setLocalPhaseTimesDefault(newPhaseTimes);
            else setLocalPhaseTimesSecondary(newPhaseTimes);

            toast({ title: "Tempi Aggiornati", description: "Dati caricati dall'analisi in tempo reale." });
        } catch (e) {
            toast({ variant: "destructive", title: "Errore", description: "Impossibile caricare l'analisi." });
        } finally {
            setIsUpdating(false);
        }
    };

    const handleCopyToTarget = () => {
        const newPhaseTimes = { ...currentPhaseTimes };
        let copied = 0;
        Object.keys(newPhaseTimes).forEach(key => {
            const data = newPhaseTimes[key];
            if (data && data.enabled !== false && data.detectedMinutesPerPiece && data.detectedMinutesPerPiece > 0) {
                const roundedVal = Math.round(data.detectedMinutesPerPiece * 1000) / 1000;
                newPhaseTimes[key] = {
                    ...data,
                    expectedMinutesPerPiece: roundedVal.toString() as any
                };
                copied++;
            }
        });

        if (copied > 0) {
            if (activeView === 'default') setLocalPhaseTimesDefault(newPhaseTimes);
            else setLocalPhaseTimesSecondary(newPhaseTimes);
            toast({ title: "Copiato", description: `Copiati ${copied} valori storici nei target.` });
        } else {
            toast({ variant: "destructive", title: "Nessun dato", description: "Nessun valore storico valido da copiare." });
        }
    };

    const handleCycleChange = (cycleId: string, type: 'default' | 'secondary') => {
        if (type === 'default') setPrimaryCycleId(cycleId);
        else setSecondaryCycleId(cycleId);

        if (cycleId === 'manual') return;

        const currentTimes = type === 'default' ? localPhaseTimesDefault : localPhaseTimesSecondary;
        const newPhaseTimes = applyCyclePhases(cycleId, workCycles, currentTimes, phaseTemplates);

        if (type === 'default') setLocalPhaseTimesDefault(newPhaseTimes);
        else setLocalPhaseTimesSecondary(newPhaseTimes);
    };

    const handleExpectedTimeChange = (phaseId: string, value: string) => {
        const cleanValue = value.replace(',', '.');
        if (activeView === 'default') {
            setLocalPhaseTimesDefault(prev => ({ ...prev, [phaseId]: { ...(prev[phaseId] || { detectedMinutesPerPiece: 0, enabled: true }), expectedMinutesPerPiece: cleanValue as any } }));
        } else {
            setLocalPhaseTimesSecondary(prev => ({ ...prev, [phaseId]: { ...(prev[phaseId] || { detectedMinutesPerPiece: 0, enabled: true }), expectedMinutesPerPiece: cleanValue as any } }));
        }
    };

    const handleExpectedTimeBlur = (phaseId: string) => {
        const roundAndFormat = (val: any) => {
            const parsed = parseFloat(val);
            if (isNaN(parsed)) return "";
            return (Math.round(parsed * 1000) / 1000).toString();
        };

        if (activeView === 'default') {
            setLocalPhaseTimesDefault(prev => {
                const item = prev[phaseId];
                if (!item) return prev;
                return {
                    ...prev,
                    [phaseId]: {
                        ...item,
                        expectedMinutesPerPiece: roundAndFormat(item.expectedMinutesPerPiece) as any
                    }
                };
            });
        } else {
            setLocalPhaseTimesSecondary(prev => {
                const item = prev[phaseId];
                if (!item) return prev;
                return {
                    ...prev,
                    [phaseId]: {
                        ...item,
                        expectedMinutesPerPiece: roundAndFormat(item.expectedMinutesPerPiece) as any
                    }
                };
            });
        }
    };

    const handleToggleEnabled = (phaseId: string, checked: boolean) => {
        if (activeView === 'default') {
            setPrimaryCycleId('manual');
            setLocalPhaseTimesDefault(prev => ({ ...prev, [phaseId]: { ...(prev[phaseId] || { expectedMinutesPerPiece: "", detectedMinutesPerPiece: 0 }), enabled: checked } }));
        } else {
            setSecondaryCycleId('manual');
            setLocalPhaseTimesSecondary(prev => ({ ...prev, [phaseId]: { ...(prev[phaseId] || { expectedMinutesPerPiece: "", detectedMinutesPerPiece: 0 }), enabled: checked } }));
        }
    };

    const handleSave = async () => {
        if (!article) return;
        setIsPending(true);

        const parseTimes = (obj: Record<string, ArticlePhaseTime>) => {
            const res: Record<string, ArticlePhaseTime> = {};
            Object.keys(obj).forEach(key => {
                res[key] = {
                    ...obj[key],
                    expectedMinutesPerPiece: parseFloat(obj[key].expectedMinutesPerPiece as any) || 0
                };
            });
            return res;
        };

        const data: Partial<Article> = {
            workCycleId: primaryCycleId,
            secondaryWorkCycleId: secondaryCycleId,
            expectedMinutesDefault: activeView === 'default' && stats.isExpectedComplete ? stats.totalExpected : (parseFloat(expectedTotalDefault as string) || 0),
            expectedMinutesSecondary: activeView === 'secondary' && stats.isExpectedComplete ? stats.totalExpected : (parseFloat(expectedTotalSecondary as string) || 0),
            phaseTimes: parseTimes(localPhaseTimesDefault),
            phaseTimesSecondary: parseTimes(localPhaseTimesSecondary),
        };

        const result = await saveArticleStandardTimes(article.id, data);
        toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
        if (result.success) {
            const updatedArticle: Article = {
                ...article,
                ...data,
            };
            onClose(true, updatedArticle);
        }
        setIsPending(false);
    };

    const sortedTemplates = [...phaseTemplates].sort((a, b) => a.name.localeCompare(b.name));


    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-5xl h-[95vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="flex items-center gap-2"><Timer className="h-6 w-6 text-primary" />Standard Tempi: {article?.code}</DialogTitle>
                    <DialogDescription>Configura cicli e target. Il totale si aggiorna se tutte le fasi hanno un valore.</DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden px-6 flex flex-col gap-4">
                    <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 max-w-md">
                            <TabsTrigger value="default">Ciclo Predefinito</TabsTrigger>
                            <TabsTrigger value="secondary">Ciclo Secondario</TabsTrigger>
                        </TabsList>

                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                            <Card className="lg:col-span-4 bg-muted/20 border-primary/20">
                                <CardContent className="p-4 space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase text-muted-foreground">Ciclo Applicato</Label>
                                        <Select onValueChange={(v) => handleCycleChange(v, activeView)} value={activeView === 'default' ? primaryCycleId : secondaryCycleId}>
                                            <SelectTrigger className="w-full h-9 text-xs"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="manual">Manuale</SelectItem>
                                                {workCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase text-muted-foreground">Tempo Previsto Totale (min/pz)</Label>
                                        <div className="relative">
                                            <Input
                                                type="number" step="0.01" 
                                                className="text-lg font-black font-mono h-12 appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                placeholder="Es. 1.5"
                                                value={activeView === 'default' ? expectedTotalDefault : expectedTotalSecondary}
                                                onChange={(e) => {
                                                    const rawVal = e.target.value;
                                                    const val = rawVal === "" ? "" : parseFloat(rawVal) || 0;
                                                    const calcVal = val === "" ? 0 : val;
                                                    
                                                    const cycleId = activeView === 'default' ? primaryCycleId : secondaryCycleId;
                                                    const currentTimes = activeView === 'default' ? localPhaseTimesDefault : localPhaseTimesSecondary;
                                                    
                                                    const newTimes = { ...currentTimes };
                                                    const cycle = workCycles.find(c => c.id === cycleId);
                                                    
                                                    if (cycle && cycle.phaseTemplateIds) {
                                                        cycle.phaseTemplateIds.forEach((templateId, index) => {
                                                            const weight = cycle.phaseWeights ? cycle.phaseWeights[index] : 0;
                                                            const phaseData = newTimes[templateId];
                                                            
                                                            if (phaseData && phaseData.enabled !== false) {
                                                                if (phaseData.detectedMinutesPerPiece && phaseData.detectedMinutesPerPiece > 0) {
                                                                    // Condizione A: Vince lo Storico Reale
                                                                    const roundedVal = Math.round(phaseData.detectedMinutesPerPiece * 1000) / 1000;
                                                                    newTimes[templateId] = {
                                                                        ...phaseData,
                                                                        expectedMinutesPerPiece: roundedVal.toString() as any
                                                                    };
                                                                } else {
                                                                    // Condizione B: Fallback Teorico
                                                                    const calculated = (calcVal * (weight || 0)) / 100;
                                                                    const roundedVal = Math.round(calculated * 1000) / 1000;
                                                                    newTimes[templateId] = {
                                                                        ...phaseData,
                                                                        expectedMinutesPerPiece: roundedVal > 0 ? roundedVal.toString() as any : ""
                                                                    };
                                                                }
                                                            }
                                                        });
                                                    }

                                                    if (activeView === 'default') {
                                                        setExpectedTotalDefault(val);
                                                        setLocalPhaseTimesDefault(newTimes);
                                                    } else {
                                                        setExpectedTotalSecondary(val);
                                                        setLocalPhaseTimesSecondary(newTimes);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleSave();
                                                    }
                                                }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs">min/pz</span>
                                        </div>
                                        {stats.isExpectedComplete && <p className="text-[10px] text-green-600 font-bold animate-pulse">Auto-update a {stats.totalExpected.toFixed(2)} min/pz</p>}
                                    </div>
                                </CardContent>
                            </Card>
                            <div className="lg:col-span-8 grid grid-cols-2 gap-4">
                                <div className="p-4 border rounded-lg flex flex-col items-center justify-center bg-muted/10">
                                    <span className="text-[10px] uppercase font-black text-muted-foreground">Somma Fasi</span>
                                    <span className="text-2xl font-black font-mono">{stats.totalExpected.toFixed(4)} min/pz</span>
                                </div>
                                <div className="p-4 border rounded-lg flex flex-col items-center justify-center bg-muted/10">
                                    <span className="text-[10px] uppercase font-black text-muted-foreground">Tempo Medio Storico</span>
                                    <span className="text-2xl font-black font-mono text-muted-foreground">{stats.totalDetected.toFixed(4)} min/pz</span>
                                </div>
                            </div>
                        </div>
                    </Tabs>

                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={handleCopyToTarget}><Copy className="mr-2 h-4 w-4" />Copia in Target</Button>
                        <Button variant="outline" size="sm" onClick={handleUpdateTimes} disabled={isUpdating}><RefreshCcw className={cn("mr-2 h-4 w-4", isUpdating && "animate-spin")} />Carica Analisi</Button>
                    </div>

                    <ScrollArea className="flex-1 border rounded-md bg-card">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                <TableRow>
                                    <TableHead className="w-[50px]">Attiva</TableHead>
                                    <TableHead>Fase</TableHead>
                                    <TableHead className="text-right">Storico (min/pz)</TableHead>
                                    <TableHead className="text-right w-[180px]">Target (min/pz)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedTemplates.map((phase) => {
                                    const data = currentPhaseTimes[phase.id];
                                    const isEnabled = data ? data.enabled !== false : false;
                                    return (
                                        <TableRow key={phase.id} className={cn(!isEnabled && "opacity-40")}>
                                            <TableCell><Checkbox checked={isEnabled} onCheckedChange={(c) => handleToggleEnabled(phase.id, !!c)} /></TableCell>
                                            <TableCell><div className="flex flex-col"><span className="font-bold text-sm uppercase">{phase.name}</span><span className="text-[10px] text-muted-foreground uppercase">{phase.type}</span></div></TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">{data?.detectedMinutesPerPiece ? data.detectedMinutesPerPiece.toFixed(4) : '---'}</TableCell>
                                            <TableCell className="text-right">
                                                <Input 
                                                    type="number" 
                                                    step="0.001" 
                                                    disabled={!isEnabled} 
                                                    className="w-32 text-right h-9 font-mono" 
                                                    value={data?.expectedMinutesPerPiece ?? ''} 
                                                    onChange={(e) => handleExpectedTimeChange(phase.id, e.target.value)} 
                                                    onBlur={() => handleExpectedTimeBlur(phase.id)}
                                                />
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
                    <Button onClick={handleSave} disabled={isPending}>{isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salva</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
