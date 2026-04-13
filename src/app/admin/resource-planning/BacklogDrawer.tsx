'use client';

import React, { useState, useMemo } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
    Search, 
    Box, 
    Package, 
    Timer, 
    Filter, 
    AlertCircle, 
    LayoutList,
    ChevronRight,
    GripVertical,
    XCircle,
    Calendar as CalendarIcon
} from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import { it } from 'date-fns/locale';

import { cn } from '@/lib/utils';
import type { JobOrder, Article, WorkPhaseTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Hash } from 'lucide-react';

interface BacklogDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    unassignedJobs: JobOrder[];
    articles: Article[];
    phaseTemplates: WorkPhaseTemplate[];
    onExclude?: (jobId: string) => void;
    onAssignDate: (jobId: string, macroArea: string) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

export default function BacklogDrawer({ 
    isOpen, 
    onClose, 
    unassignedJobs, 
    articles,
    phaseTemplates,
    onExclude, 
    onAssignDate,
    searchQuery,
    onSearchChange
}: BacklogDrawerProps) {
    const isMatch = (job: JobOrder) => {
        if (!searchQuery || searchQuery.trim().length < 2) return false;
        const q = searchQuery.toLowerCase().trim();
        return (
            (job.numeroODLInterno?.toLowerCase().includes(q)) ||
            (job.ordinePF?.toLowerCase().includes(q)) ||
            (job.details?.toLowerCase().includes(q))
        );
    };

    const filteredJobs = useMemo(() => {
        // Il backlog in realtà non dovrebbe essere filtrato se vogliamo mantenere il comportamento "Highlight vs Dim"
        // MA il componente originale filtrava. Decidiamo di mantenerli tutti ma evidenziare, 
        // O filtrare se la ricerca è specifica (locale) e evidenziare se globale?
        // Spec specifica: "La ricerca e l'evidenziazione devono funzionare anche nel Backlog"
        // Seguiamo la linea del Tabellone: MOSTRA TUTTO, DIM quelli che non matchano.
        return unassignedJobs;
    }, [unassignedJobs]);


    const statusColors: Record<string, string> = {
        'DA_INIZIARE': 'bg-slate-500',
        'IN_PREPARAZIONE': 'bg-amber-500',
        'PRONTO_PROD': 'bg-emerald-500',
        'IN_PRODUZIONE': 'bg-blue-600',
        'FINE_PRODUZIONE': 'bg-purple-600',
        'QLTY_PACK': 'bg-pink-600',
        'CHIUSO': 'bg-emerald-900'
    };

    const calculateRemainingHours = (job: JobOrder) => {
        const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;
        
        const phaseTimes = article.phaseTimes || {};
        const activeTemplates = phaseTemplates.filter(t => 
            phaseTimes[t.id]?.enabled !== false && 
            (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0
        );

        const remainingMins = activeTemplates.reduce((acc, t) => {
            const pt = phaseTimes[t.id];
            const jobPhase = job.phases.find(p => p.name === t.name);
            const isCompleted = jobPhase && (jobPhase.status === 'completed' || jobPhase.status === 'skipped');
            
            if (!isCompleted) {
                return acc + (pt.expectedMinutesPerPiece * job.qta);
            }
            return acc;
        }, 0);

        return remainingMins / 60;
    };

    const calculateTotalHours = (job: JobOrder) => {
        const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;
        
        const phaseTimes = article.phaseTimes || {};
        const activeTemplates = phaseTemplates.filter(t => 
            phaseTimes[t.id]?.enabled !== false && 
            (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0
        );

        const totalMins = activeTemplates.reduce((acc, t) => {
            const pt = phaseTimes[t.id];
            return acc + (pt.expectedMinutesPerPiece * job.qta);
        }, 0);

        return totalMins / 60;
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent side="left" className="w-[400px] sm:w-[450px] p-0 border-r-4 border-blue-600 shadow-2xl bg-white">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 bg-slate-900 text-white">
                        <SheetHeader>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-600 rounded-lg">
                                    <Box className="h-5 w-5 text-white" />
                                </div>
                                <SheetTitle className="text-xl font-black uppercase tracking-tighter text-white">Commesse da Assegnare</SheetTitle>
                            </div>
                            <SheetDescription className="text-slate-400 font-bold text-xs uppercase tracking-widest">
                                {unassignedJobs.length} commesse da assegnare nel tabellone
                            </SheetDescription>
                        </SheetHeader>

                        <div className="mt-6 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder="Cerca ODL, Articolo o Cliente..." 
                                className="h-11 pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-500 font-bold rounded-xl focus-visible:ring-blue-500"
                                value={searchQuery}
                                onChange={(e) => onSearchChange(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden p-4">
                        <ScrollArea className="h-full pr-4">
                            <div className="space-y-3 pb-8">
                                {filteredJobs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-12 text-center opacity-40">
                                        <LayoutList className="h-12 w-12 text-slate-300 mb-4" />
                                        <p className="text-sm font-black uppercase tracking-widest text-slate-400 italic">Nessuna commessa trovata</p>
                                    </div>
                                ) : (
                                    filteredJobs.map((job) => {
                                        const remainingHours = calculateRemainingHours(job);
                                        const totalHours = calculateTotalHours(job);
                                        const matched = isMatch(job);
                                        const searching = searchQuery.length >= 2;
                                        
                                        const deliveryDateStr = job.dataConsegnaFinale;
                                        let deliveryDate: Date | null = null;
                                        if (deliveryDateStr) {
                                            if (typeof (deliveryDateStr as any).toDate === 'function') {
                                                deliveryDate = (deliveryDateStr as any).toDate();
                                            } else if (typeof deliveryDateStr === 'string') {
                                                if (/^\d{4}-\d{2}-\d{2}/.test(deliveryDateStr)) {
                                                    try { deliveryDate = parseISO(deliveryDateStr); } catch(e) {}
                                                } else if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(deliveryDateStr)) {
                                                    const parts = deliveryDateStr.split(/[\/-]/);
                                                    if (parts.length === 3) {
                                                        deliveryDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                                                    }
                                                }
                                            }
                                        }
                                        const isOverdue = deliveryDate && isPast(deliveryDate) && !['CHIUSO', 'COMPLETATA'].includes(job.status?.toUpperCase() || '');
                                        const hasMaterialMissing = job.phases.some(p => p.materialStatus === 'missing') || job.isProblemReported;

                                        return (
                                            <div
                                                key={job.id}
                                                onClick={() => onAssignDate(job.id, 'CORE')}
                                                className={cn(
                                                    "group relative flex items-center h-11 px-3 border rounded-xl transition-all cursor-pointer overflow-hidden",
                                                    searching && !matched ? "opacity-30 grayscale-[0.5] border-slate-100" : "bg-white border-slate-100 hover:border-blue-400 shadow-sm",
                                                    matched ? "bg-blue-50/50 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] scale-[1.02] ring-2 ring-blue-500/20 z-10" : ""
                                                )}
                                            >
                                                {/* Indicatore Stato Verticale */}
                                                <div className={cn("absolute left-0 top-0 bottom-0 w-1", statusColors[job.status] || 'bg-slate-300')} />

                                                {matched && (
                                                    <div className="absolute top-0 right-0 p-1">
                                                        <Search className="h-2.5 w-2.5 text-blue-600" />
                                                    </div>
                                                )}

                                                <div className="flex items-center w-full gap-2 pl-1">
                                                    {/* Badge Stato Testuale */}
                                                    <div className="px-1 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded text-[7px] font-black uppercase shrink-0">
                                                        {job.status?.replace('_', ' ')}
                                                    </div>

                                                    {/* ODL & Articolo */}
                                                    <div className="flex items-center gap-2 min-w-0 max-w-[40%]">
                                                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight truncate whitespace-nowrap">
                                                            {job.numeroODLInterno || job.numeroODL || 'ODL N/D'} - {job.details}
                                                        </span>
                                                        {/* Cliente */}
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase truncate italic shrink-0">
                                                            {job.cliente}
                                                        </span>
                                                    </div>

                                                    <div className="flex-grow" />

                                                    {/* Data */}
                                                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 border border-slate-100 rounded shrink-0">
                                                        <CalendarIcon className={cn("h-3 w-3", isOverdue ? "text-red-500" : "text-slate-400")} />
                                                        <span className={cn("text-[9px] font-bold", isOverdue ? "text-red-500" : "text-slate-500")}>
                                                            {deliveryDate ? format(deliveryDate, 'dd-MM') : 'N/D'}
                                                        </span>
                                                    </div>

                                                    {/* Alert Icons */}
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <TooltipProvider delayDuration={100}>
                                                            {hasMaterialMissing && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Box className="h-3 w-3 text-red-500 cursor-help" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="bg-slate-900 border-slate-700 text-[10px] font-bold text-red-400">
                                                                        Allerta Materie Prime
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                            {isOverdue && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <AlertCircle className="h-3 w-3 text-amber-500 cursor-help" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="bg-slate-900 border-slate-700 text-[10px] font-bold text-amber-400">
                                                                        In ritardo rispetto alla data prevista
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                            {job.workGroupId && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Hash className="h-3 w-3 text-indigo-400 cursor-help" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="bg-slate-900 border-slate-700 text-[10px] font-bold text-indigo-300">
                                                                        Commessa concatenata
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </TooltipProvider>
                                                    </div>

                                                    {/* Badge Quantità */}
                                                    <Badge variant="outline" className="text-[9px] font-black px-1.5 h-5 bg-slate-50 text-slate-500 border-slate-200 shrink-0">
                                                        {job.qta} PZ
                                                    </Badge>

                                                    {/* Ore (Rim/Tot) */}
                                                    <div className="flex items-center gap-1 px-1.5 h-6 bg-blue-50 border border-blue-100 rounded-lg shrink-0 min-w-[55px] justify-center">
                                                        <Timer className="h-3 w-3 text-blue-600" />
                                                        <span className="text-[9px] font-black text-blue-700">
                                                            {remainingHours.toFixed(1)}h
                                                        </span>
                                                    </div>

                                                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Footer Info */}
                    <div className="p-4 bg-slate-50 border-t flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-3 w-3 text-blue-600" />
                            <span className="text-[9px] font-bold text-slate-500 uppercase italic">Clicca sulle card per assegnare una data nel tabellone</span>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
