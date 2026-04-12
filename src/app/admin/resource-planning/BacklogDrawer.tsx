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

import { cn } from '@/lib/utils';
import type { JobOrder, Article, WorkPhaseTemplate } from '@/types';
import { Button } from '@/components/ui/button';

interface BacklogDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    unassignedJobs: JobOrder[];
    articles: Article[];
    phaseTemplates: WorkPhaseTemplate[];
    onExclude?: (jobId: string) => void;
    onAssignDate: (jobId: string) => void;
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

    const calculateTotalHours = (job: JobOrder) => {
        const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;
        
        const phaseTimes = article.phaseTimes || {};
        const activeTemplates = phaseTemplates.filter(t => 
            phaseTimes[t.id]?.enabled !== false && 
            (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0
        );

        const totalMins = activeTemplates.reduce((acc, t) => {
            const time = phaseTimes[t.id].expectedMinutesPerPiece || 0;
            return acc + (time * job.qta);
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
                                        const totalHours = calculateTotalHours(job);
                                        const matched = isMatch(job);
                                        const searching = searchQuery.length >= 2;

                                        return (
                                            <div
                                                key={job.id}
                                                onClick={() => onAssignDate(job.id)}
                                                className={cn(
                                                    "group bg-white border-2 rounded-2xl p-4 shadow-sm transition-all flex items-start gap-4 cursor-pointer relative",
                                                    searching && !matched ? "opacity-30 grayscale-[0.5] border-slate-100" : "border-slate-100 hover:border-blue-400",
                                                    matched ? "bg-blue-50/30 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] scale-[1.02] ring-2 ring-blue-500/20" : ""
                                                )}
                                            >
                                                {matched && (
                                                    <div className="absolute -top-2 -right-2 flex h-5 w-5 pointer-events-none">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-5 w-5 bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center">
                                                            <Search className="h-2.5 w-2.5 text-white" />
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="flex-1 space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <Badge className="bg-slate-900 text-white font-black text-[10px] uppercase px-2 py-0.5 rounded-md">
                                                                {job.numeroODLInterno || job.numeroODL || 'ODL N/D'}
                                                            </Badge>
                                                            <span className="text-sm font-black text-slate-800 uppercase tracking-tight">{job.ordinePF}</span>
                                                        </div>
                                                        <Badge variant="outline" className="text-[10px] font-black bg-slate-50 text-slate-600 border-slate-200">
                                                            {job.qta} PZ
                                                        </Badge>
                                                    </div>

                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2">
                                                            <Package className="h-3.5 w-3.5 text-blue-500" />
                                                            <span className="text-xs font-black text-slate-700 uppercase">{job.details}</span>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide leading-none">{job.cliente}</p>
                                                    </div>

                                                    <div className="flex items-center justify-between pt-1 border-t border-slate-50">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("h-2 w-2 rounded-full", statusColors[job.status] || 'bg-slate-300')} />
                                                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">{job.status?.replace('_', ' ')}</span>
                                                        </div>
                                                        
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 border border-blue-100 rounded-md">
                                                                <Timer className="h-3 w-3 text-blue-600" />
                                                                <span className="text-[11px] font-black text-blue-700">{totalHours.toFixed(1)}h</span>
                                                            </div>
                                                            {onExclude && (
                                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full shrink-0" onClick={(e) => { e.stopPropagation(); onExclude(job.id); }}>
                                                                    <XCircle className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
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
