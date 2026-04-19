'use client';

import React, { useState, useMemo } from 'react';
import { format, addWeeks, startOfWeek, endOfWeek, getWeek, parseISO, isSameWeek, isSameDay, isBefore, getDay, isPast, startOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from "@/components/ui/progress";
import { Button } from '@/components/ui/button';
import { 
    Users, Timer, Info, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, 
    Boxes, Package, Factory, Scissors, Calendar, Hash, PackageX, Search, XCircle,
    Zap, CalendarCheck, ChevronDown, ChevronUp, Box, Pause
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { formatDisplayStock, parseRobustDate } from '@/lib/utils';
import { MRPTimelineEntry } from '@/lib/mrp-utils';



import type { JobOrder, Operator, Department, Article, WorkPhaseTemplate } from '@/types';
import { advanceJobStatus } from './weekly-actions';
import { toggleExcludeFromPackingList } from './actions';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { getOverallStatus } from '@/lib/types';

interface WeeklyCapacityBoardProps {
    jobOrders: JobOrder[];
    unassignedJobs: JobOrder[];
    operators: Operator[];
    departments: Department[];
    articles: Article[];
    allocations: Record<string, { operatorId: string, hours: number }[]>; 
    phaseTemplates: any[];
    currentDate: Date;
    weeklyLimit: number;
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    onJumpToDate?: (d: Date) => void;
    onOpenBacklog?: () => void;
    onStatusAdvance: (jobId: string) => void;
    onManageAllocations: (deptId: string, week: number, year: number) => void;
    onJobClick: (jobId: string, macroArea: string) => void;
    onQuickView: (job: JobOrder) => void;
    rawMaterials?: any[];
    mrpTimelines?: Map<string, MRPTimelineEntry[]>;
    globalSettings?: any;
}

// Whitelists Ufficiali Dogana (Gestione Commesse) per Audit 1:1
const PRODUCTION_STATUS_WHITELIST = [
    "In Produzione", "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK",
    "da_iniziare", "in_preparazione", "pronto_prod", "in_produzione", "fine_produzione", "qlty_pack",
    "DA INIZIARE", "IN PREPARAZIONE", "PRONTO PROD", "IN PRODUZIONE", "FINE PRODUZIONE", "QLTY PACK",
    "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
    "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
    "Manca Materiale", "Problema", "Sospesa", "PRODUCTION", "PAUSED", "SUSPENDED", "IN PROD.", "FINE PROD.", "PRONTO PROD.", "QLTY & PACK", "PRONTO",
    "Da Produrre", "In Attesa", "Lavorazione"
];

const COMPLETED_STATUS_WHITELIST = [
    "Completata", "CHIUSO", "completed", "shipped", "closed", "COMPLETATA", "Chiuso", "Consegnata", "SPEDITA"
];

export default function WeeklyCapacityBoard({
    jobOrders,
    unassignedJobs = [],
    operators,
    departments,
    articles,
    allocations,
    phaseTemplates,
    currentDate,
    weeklyLimit,
    searchQuery = '',
    onSearchChange,
    onJumpToDate,
    onOpenBacklog,
    onStatusAdvance,
    onManageAllocations,
    onJobClick,
    onQuickView,
    rawMaterials = [],
    mrpTimelines = new Map(),
    globalSettings
}: WeeklyCapacityBoardProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [viewMode, setViewMode] = useState<'1W' | '2W'>('2W');
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    const [activeResultIndex, setActiveResultIndex] = useState(0);

    const numWeeks = viewMode === '1W' ? 1 : 2;

    // Costanti per il Check-up di Fattibilità
    const EFFICIENCY_FACTOR = 0.85;
    const DEFAULT_PREP_OPERATORS = 2;
    const DEFAULT_PACK_OPERATORS = 2;

    // Sanificazione Backlog: Escludiamo categoricamente stati IN_PIANIFICAZIONE o planned
    const sanitizedUnassigned = useMemo(() => {
        return unassignedJobs.filter(job => PRODUCTION_STATUS_WHITELIST.includes(job.status));
    }, [unassignedJobs]);

    // Logica di Matching per la Ricerca Globale
    const isMatch = (job: JobOrder) => {
        if (!searchQuery || searchQuery.trim().length < 2) return false;
        const q = searchQuery.toLowerCase().trim();
        return (
            (job.numeroODLInterno?.toLowerCase().includes(q)) ||
            (job.ordinePF?.toLowerCase().includes(q)) ||
            (job.details?.toLowerCase().includes(q))
        );
    };

    // Memo degli tutti i job che corrispondono alla ricerca, ordinati cronologicamente
    const matchingJobs = useMemo(() => {
        if (!searchQuery || searchQuery.trim().length < 2) return [];
        
        const allJobs = [...jobOrders, ...sanitizedUnassigned];
        const matches = allJobs.filter(isMatch);
        
        // Ordiniamo cronologicamente: chiusi prima (storico), poi per data di consegna, poi quelli senza data (backlog)
        return matches.sort((a, b) => {
            const dateA = a.dataConsegnaFinale && a.dataConsegnaFinale !== 'N/D' ? a.dataConsegnaFinale : '9999-99-99';
            const dateB = b.dataConsegnaFinale && b.dataConsegnaFinale !== 'N/D' ? b.dataConsegnaFinale : '9999-99-99';
            return dateA.localeCompare(dateB);
        });
    }, [searchQuery, jobOrders, sanitizedUnassigned, isMatch]);

    const jumpToMatch = (index: number) => {
        const target = matchingJobs[index];
        if (!target) return;

        setActiveResultIndex(index);

        if (target.dataConsegnaFinale && target.dataConsegnaFinale !== 'N/D') {
            const date = parseISO(target.dataConsegnaFinale);
            if (!isNaN(date.getTime())) {
                onJumpToDate?.(date);
            }
        } else {
            // Se non ha data, apriamo il backlog
            onOpenBacklog?.();
            toast({ 
                title: "Match nel Backlog", 
                description: `L'ODL ${target.numeroODLInterno || target.ordinePF} è nel backlog.`,
                variant: "default"
            });
        }
    };

    const handleSearchSubmit = (e?: React.KeyboardEvent) => {
        if (e && e.key !== 'Enter') return;
        if (matchingJobs.length === 0) {
            if (searchQuery.length >= 3) {
                toast({ title: "Nessun Risultato", description: "Non abbiamo trovato commesse corrispondenti.", variant: "destructive" });
            }
            return;
        }

        // Se premiamo invio, andiamo al prossimo match (ciclico)
        const nextIdx = (activeResultIndex + 1) % matchingJobs.length;
        jumpToMatch(nextIdx);
    };

    const prevMatch = () => {
        const nextIdx = (activeResultIndex - 1 + matchingJobs.length) % matchingJobs.length;
        jumpToMatch(nextIdx);
    };

    const nextMatch = () => {
        const nextIdx = (activeResultIndex + 1) % matchingJobs.length;
        jumpToMatch(nextIdx);
    };



    const weeks = useMemo(() => {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        return Array.from({ length: numWeeks }).map((_, i) => {
            const d = addWeeks(start, i);
            const wNum = getWeek(d, { weekStartsOn: 1 });
            return {
                start: d,
                weekNum: wNum,
                year: d.getFullYear(),
                key: `${d.getFullYear()}_${wNum}`,
                label: `SETTIMANA ${wNum}`,
                range: `${format(d, 'dd MMM')} - ${format(addWeeks(d, 0), 'dd MMM')}`
            };
        });
    }, [currentDate, numWeeks]);

    // FIX: Fallback robusto per i reparti Core (PRODUZIONE)
    const coreDepts = useMemo(() => {
        const identified = departments.filter(d => 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes(d.id.toUpperCase()) || 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes(d.code.toUpperCase())
        );
        // Se non trova i nomi specifici, pesca tutti quelli con MacroArea PRODUZIONE
        if (identified.length === 0) {
            return departments.filter(d => d.macroAreas?.includes('PRODUZIONE'));
        }
        return identified;
    }, [departments]);

    const satelliteDepts = [
        { id: 'PREP', name: 'PREPARAZIONE', icon: <Scissors className="h-4 w-4" /> },
        { id: 'PACK', name: 'PACK & QLTY', icon: <Package className="h-4 w-4" /> }
    ];

    const allDisplayDepts = [
        satelliteDepts[0], // PREPARAZIONE prima
        ...coreDepts,      // Reparti Core al centro
        satelliteDepts[1]  // PACK & QLTY alla fine
    ];

    const getJobLoadInDept = (job: JobOrder, deptId: string) => {
        const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;

        const phaseTimes = article.phaseTimes || {};
        const activeTemplates = phaseTemplates.filter(t => phaseTimes[t.id]?.enabled !== false && (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0);

        let relevantTemplates = [];
        if (deptId === 'PREP') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'preparation');
        } else if (deptId === 'PACK') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'quality' || t.type === 'packaging');
        } else {
            relevantTemplates = activeTemplates.filter(t => t.type === 'production');
            
            const jobDept = job.department?.toUpperCase() || '';
            const targetDept = departments.find(d => d.id === deptId);
            const dCode = targetDept?.code?.toUpperCase() || '';
            const dName = targetDept?.name?.toUpperCase() || '';
            const dId = deptId.toUpperCase();
            
            const isMatchingDept = jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept);
            if (!isMatchingDept) return 0;
        }

        const totalMins = relevantTemplates.reduce((acc, t) => {
            const time = phaseTimes[t.id].expectedMinutesPerPiece || 0;
            return acc + (time * job.qta);
        }, 0);

        return totalMins / 60;
    };

    const isMacroAreaCompleted = (job: JobOrder, type: 'preparation' | 'production' | 'quality_pack') => {
        const phases = job.phases || [];
        let relevantPhases = [];
        if (type === 'preparation') relevantPhases = phases.filter(p => p.type === 'preparation');
        else if (type === 'production') relevantPhases = phases.filter(p => p.type === 'production');
        else relevantPhases = phases.filter(p => p.type === 'quality' || p.type === 'packaging');

        if (relevantPhases.length === 0) return true;
        return relevantPhases.every(p => p.status === 'completed' || p.status === 'skipped');
    };

    const isMacroAreaStarted = (job: JobOrder, type: 'preparation' | 'production' | 'quality_pack') => {
        const phases = job.phases || [];
        let relevantPhases = [];
        if (type === 'preparation') relevantPhases = phases.filter(p => p.type === 'preparation');
        else if (type === 'production') relevantPhases = phases.filter(p => p.type === 'production');
        else relevantPhases = phases.filter(p => p.type === 'quality' || p.type === 'packaging');

        return relevantPhases.some(p => p.status === 'in-progress' || p.status === 'paused');
    };

    const getCloneStatus = (job: JobOrder, currentArea: 'PREP' | 'CORE' | 'PACK'): 'status-gray' | 'status-amber' | 'status-blue' | 'status-green' => {
        if (currentArea === 'PREP') {
            if (isMacroAreaCompleted(job, 'preparation')) return 'status-green';
            if (isMacroAreaStarted(job, 'preparation')) return 'status-blue';
            return 'status-amber'; // La Prep è sempre pronta (o quasi) se la commessa è avviata
        }

        if (currentArea === 'CORE') {
            if (isMacroAreaCompleted(job, 'production')) return 'status-green';
            if (isMacroAreaStarted(job, 'production')) return 'status-blue';
            
            // Ambra se Prep è finita (o non necessaria)
            const prepNeeded = departments.find(d => d.id === job.department || d.code === job.department)?.dependsOnPreparation;
            const hasPrepPhases = (job.phases || []).some(p => p.type === 'preparation');
            
            if (prepNeeded && hasPrepPhases) {
                if (isMacroAreaCompleted(job, 'preparation')) return 'status-amber';
                return 'status-gray';
            }
            return 'status-amber';
        }

        if (currentArea === 'PACK') {
            if (isMacroAreaCompleted(job, 'quality_pack')) return 'status-green';
            if (isMacroAreaStarted(job, 'quality_pack')) return 'status-blue';
            
            // Ambra se Core è finito
            if (isMacroAreaCompleted(job, 'production')) return 'status-amber';
            return 'status-gray';
        }

        return 'status-gray';
    };

    const checkTechnicalFeasibility = (job: JobOrder, deptId: string, week: { start: Date, weekNum: number, year: number }) => {
        // STEP 0: Se il clone è già COMPLETATO (Verde), non segnalare allarmi
        const macroArea = deptId === 'PREP' ? 'PREP' : deptId === 'PACK' ? 'PACK' : 'CORE';
        if (getCloneStatus(job, macroArea) === 'status-green') return false;

        // 1. Identifica il numero di operatori
        let numOperators = 0;
        if (deptId === 'PREP') numOperators = DEFAULT_PREP_OPERATORS;
        else if (deptId === 'PACK') numOperators = DEFAULT_PACK_OPERATORS;
        else {
            const allocationKey = `${week.year}_${week.weekNum}_${deptId}`;
            numOperators = allocations[allocationKey]?.length || 0;
        }

        if (numOperators <= 0) return true; // Se non ci sono risorse impostate, l'alert non scatta per ora

        // 2. Calcola Indice Giorno (0=Lunedì, 4=Venerdì). Cap a 4 per weekend come da specifica.
        const refDate = job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D' ? parseISO(job.dataConsegnaFinale) : null;
        if (!refDate) return false;

        let dayIdx = getDay(refDate) - 1; // getDay: 0=Domenica, 1=Lunedì...
        if (dayIdx === -1) dayIdx = 4; // Domenica -> Venerdì (indice 4)
        if (dayIdx > 4) dayIdx = 4; // Sabato -> Venerdì (indice 4)
        if (dayIdx < 0) dayIdx = 0; // Per sicurezza

        // 3. Capacità Cumulata Giornaliera
        const dailyHours = numOperators * 8 * EFFICIENCY_FACTOR;
        const cumulativeCapacity = (dayIdx + 1) * dailyHours;

        // 4. Carico del Clone in questa macro-area
        const jobLoad = getJobLoadInDept(job, deptId);

        return jobLoad > cumulativeCapacity;
    };

    const deptColors: Record<string, { tab: string, border: string, bg: string }> = {
        'PREP': { tab: 'data-[state=active]:bg-amber-600 data-[state=active]:text-white text-amber-500', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
        'PACK': { tab: 'data-[state=active]:bg-slate-600 data-[state=active]:text-white text-slate-400', border: 'border-slate-500/30', bg: 'bg-slate-600/10' },
        'CG': { tab: 'data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-emerald-500', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
        'CP': { tab: 'data-[state=active]:bg-orange-600 data-[state=active]:text-white text-orange-500', border: 'border-orange-500/30', bg: 'bg-orange-500/10' },
        'BF': { tab: 'data-[state=active]:bg-sky-600 data-[state=active]:text-white text-sky-500', border: 'border-sky-500/30', bg: 'bg-sky-500/10' },
    };

    const getColors = (id: string, code?: string) => {
        return deptColors[id] || deptColors[code || ''] || { tab: 'data-[state=active]:bg-blue-600 text-blue-500', border: 'border-slate-800', bg: 'bg-slate-900' };
    };

    return (
        <div className="flex flex-col gap-4 p-4 bg-slate-900 rounded-xl border border-slate-800 shadow-inner flex-1 min-h-[500px]">
            <Tabs defaultValue={allDisplayDepts[0]?.id} className="w-full">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-6">
                    <TabsList className="bg-slate-950 h-14 p-1 rounded-2xl border border-slate-800">
                        {allDisplayDepts.map(dept => {
                            const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                            const tColors = getColors(dept.id, (dept as any).code);
                            
                            // Verifica se il reparto contiene match per la ricerca
                            const hasMatchInDept = searchQuery.length >= 2 && jobOrders.some(j => {
                                if (!isMatch(j)) return false;
                                
                                const jobDept = j.department?.toUpperCase() || '';
                                const dCode = (dept as any).code?.toUpperCase() || '';
                                const dName = (dept as any).name?.toUpperCase() || '';
                                const dId = dept.id.toUpperCase();
                                
                                if (dept.id === 'PREP' && (j.phases || []).some(p => p.type === 'preparation')) return true;
                                if (dept.id === 'PACK') return true; 

                                return jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept);
                            });

                            return (
                                <TabsTrigger 
                                    key={dept.id} 
                                    value={dept.id} 
                                    className={cn("relative h-full px-6 rounded-xl font-black uppercase text-xs tracking-widest flex items-center gap-2 transition-all", tColors.tab)}
                                >
                                    {isSatellite ? (dept as any).icon : <Factory className="h-4 w-4" />}
                                    {dept.name}
                                    {hasMatchInDept && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                                        </span>
                                    )}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>

                    <div className="flex items-center gap-6 bg-slate-950 p-2 rounded-2xl border border-slate-800">
                        {/* Global Search Bar */}
                        <div className="flex items-center gap-2">
                            <div className="relative group min-w-[320px]">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-blue-400 transition-colors">
                                    <Search className="h-4 w-4" />
                                </div>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        onSearchChange?.(e.target.value);
                                        setActiveResultIndex(0); // Reset index on type
                                    }}
                                    onKeyDown={handleSearchSubmit}
                                    placeholder="Cerca ODL, Ordine o Codice..."
                                    className="w-full h-10 bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 text-xs font-bold text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all shadow-inner"
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => onSearchChange?.('')}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
                                    >
                                        <XCircle className="h-4 w-4" />
                                    </button>
                                )}
                            </div>

                            {/* View Mode Toggle: 1W vs 2W */}
                            <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1 h-10 shadow-inner">
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => setViewMode('1W')}
                                    className={cn(
                                        "h-8 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                                        viewMode === '1W' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                                    )}
                                >
                                    1 Sett.
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => setViewMode('2W')}
                                    className={cn(
                                        "h-8 px-3 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                                        viewMode === '2W' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                                    )}
                                >
                                    2 Sett.
                                </Button>
                            </div>

                            {/* Multi-Match Navigation Controls */}
                            {matchingJobs.length > 1 && (
                                <div className="flex items-center gap-1 bg-slate-900 border border-indigo-900/30 rounded-xl px-2 h-10 shadow-lg shadow-indigo-950/20">
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20"
                                        onClick={prevMatch}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="flex items-center gap-1 px-1">
                                        <span className="text-[10px] font-black text-indigo-400 min-w-[30px] text-center uppercase tracking-tighter">
                                            {activeResultIndex + 1} <span className="text-[8px] opacity-40 mx-0.5">di</span> {matchingJobs.length}
                                        </span>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20"
                                        onClick={nextMatch}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Audit Contatori: Riconciliazione SSoT con Dogana */}
                        <div className="flex items-center gap-2 pl-2 border-l border-slate-800 ml-2">
                            <div className="flex flex-col items-center">
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter leading-none mb-1">In Produzione</span>
                                <Badge className="bg-blue-600/20 text-blue-400 border border-blue-500/30 font-black text-xs px-2.5 h-6">
                                    {[...jobOrders, ...sanitizedUnassigned].filter(j => {
                                        // Utilizziamo le whitelist ufficiali per il conteggio "In Produzione"
                                        const isProd = PRODUCTION_STATUS_WHITELIST.includes(j.status);
                                        const isClosed = COMPLETED_STATUS_WHITELIST.includes(j.status);
                                        
                                        return isProd && !isClosed;
                                    }).length}
                                </Badge>
                            </div>
                            <div className="h-8 w-px bg-slate-800 mx-1" />
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex flex-col items-center cursor-help">
                                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter leading-none mb-1">Chiuse Visibili</span>
                                            <Badge variant="outline" className="bg-slate-900 border-slate-700 text-slate-500 font-bold text-xs px-2.5 h-6">
                                                {jobOrders.filter(j => 
                                                    COMPLETED_STATUS_WHITELIST.some(s => s.toLowerCase() === (j.status || '').toLowerCase())
                                                ).length}
                                            </Badge>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-900 border-slate-700 text-[10px] font-bold text-slate-300">
                                        Commesse chiuse/concluse caricate nel range visibile della board.
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <div className="flex items-center gap-3 pr-2 border-l border-slate-800 pl-4">
                            <div className="flex flex-col items-end">
                                <Label htmlFor="simulation-mode" className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Check-up Venerdì</Label>
                                <span className="text-[8px] font-bold text-slate-600 uppercase italic leading-none">Proiezione Arretrati</span>
                            </div>
                            <Switch 
                                id="simulation-mode"
                                checked={isSimulationMode}
                                onCheckedChange={setIsSimulationMode}
                                className="data-[state=checked]:bg-blue-600"
                            />
                        </div>
                    </div>
                </div>

                {allDisplayDepts.map(dept => {
                    const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                    const colors = getColors(dept.id, (dept as any).code);
                    
                    return (
                        <TabsContent key={dept.id} value={dept.id} className="mt-0 outline-none">
                            <div className={cn(
                                "grid gap-6 p-6 rounded-3xl border transition-all", 
                                viewMode === '1W' ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
                                colors.bg, 
                                colors.border
                            )}>
                                {weeks.map(week => {
                                    const allocationKey = `${week.year}_${week.weekNum}_${dept.id}`;
                                    const weekAssignments = allocations[allocationKey] || [];
                                    const capacityHours = weekAssignments.reduce((acc, a) => acc + a.hours, 0);
                                    const weekStartDateStr = format(week.start, 'yyyy-MM-dd');
                                    
                                    const weekJobs = jobOrders.filter(job => {
                                        const displayStatus = getOverallStatus(job);
                                        const isClosed = displayStatus === 'CHIUSO';
                                        
                                        // 1. DATA DI RIFERIMENTO DINAMICA (effectiveBoardDate)
                                        // Se CHIUSO: usiamo la data reale di fine (SSoT Storico)
                                        // Se ATTIVA: usiamo la data di consegna finale (SSoT Pianificazione)
                                        let referenceDate: Date | null = null;

                                        if (isClosed) {
                                            if (job.overallEndTime) {
                                                // Gestione robusta: potrebbe essere un Timestamp di Firestore o un oggetto Date
                                                const rawEnd = job.overallEndTime;
                                                referenceDate = (rawEnd && typeof rawEnd === 'object' && 'seconds' in rawEnd)
                                                    ? new Date(rawEnd.seconds * 1000)
                                                    : new Date(rawEnd);
                                            }
                                        } else {
                                            if (job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D') {
                                                // Fallback parsing robusto per date non standard
                                                referenceDate = parseISO(job.dataConsegnaFinale);
                                                if (isNaN(referenceDate.getTime()) && String(job.dataConsegnaFinale).includes('/')) {
                                                    const parts = String(job.dataConsegnaFinale).split('/');
                                                    if (parts.length === 3) {
                                                        const [d, m, y] = parts;
                                                        referenceDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
                                                    }
                                                }
                                            }
                                        }

                                        const currentBoardStart = startOfWeek(currentDate, { weekStartsOn: 1 });

                                        // 2. FALLBACK PER COMMESSE SENZA DATA (EVITA SPARIZIONI)
                                        if ((!referenceDate || isNaN(referenceDate.getTime())) && !isClosed) {
                                            referenceDate = currentBoardStart;
                                        }

                                        if (!referenceDate || isNaN(referenceDate.getTime())) return false;

                                        // 3. LOGICA DI ASSEGNAZIONE COLONNA (Deduplicazione e Ritardi)
                                        const naturalWeekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
                                        
                                        // STEP A: Calcoliamo lo stato del clone per decidere l'ancoraggio
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        const cloneStatus = getCloneStatus(job, macroArea);
                                        const isGreen = cloneStatus === 'status-green';

                                        // Il ritardo (overdue) si applica SOLO alle commesse aperte e ai cloni NON ancora finiti (non verdi)
                                        const isOverdue = !isClosed && !isGreen && referenceDate < currentBoardStart;

                                        let assignedWeekStart: Date;
                                        if (isOverdue) {
                                            // Se è in ritardo (e il clone è ancora aperto), va SEMPRE nella prima colonna visualizzata
                                            assignedWeekStart = currentBoardStart;
                                        } else {
                                            // Altrimenti va nella sua settimana naturale (Pianificata o di Chiusura Reale)
                                            // Questo garantisce l'ancoraggio storico dei "Verdi"
                                            assignedWeekStart = naturalWeekStart;
                                        }

                                        // Infine verifichiamo se la colonna corrente è quella assegnata
                                        const isAssignedToThisColumn = isSameWeek(week.start, assignedWeekStart, { weekStartsOn: 1 });

                                        // LOGICA SIMULAZIONE (Spazzaneve)
                                        if (isSimulationMode) {
                                            const isPastOrCurrentWeek = (assignedWeekStart < currentBoardStart) || isSameWeek(assignedWeekStart, currentBoardStart, { weekStartsOn: 1 });
                                            
                                            // Il rollover si applica SOLO se il clone non è ancora finito (e non è CHIUSO)
                                            const isArrearage = !isClosed && !isGreen && isPastOrCurrentWeek;

                                            if (isArrearage) {
                                                // Se è un arretrato, lo facciamo apparire SOLO nella SECONDA colonna (Proiezione Lunedì)
                                                const secondWeek = weeks[1];
                                                if (secondWeek && isSameWeek(week.start, secondWeek.start, { weekStartsOn: 1 })) {
                                                    return true; 
                                                }
                                                return false; // scompare dalla sua colonna originale (passato/corrente) per saltare avanti
                                            }
                                        }

                                        if (!isAssignedToThisColumn) return false;

                                        if (isSatellite) {
                                            if (dept.id === 'PREP') {
                                                // Mostra solo se il reparto core ha dependsOnPreparation: true E ci sono fasi prep
                                                const jobCoreDept = departments.find(d => d.id === job.department || d.code === job.department);
                                                const dependsOnPrep = jobCoreDept?.dependsOnPreparation ?? false;
                                                const hasPrepPhases = (job.phases || []).some(p => p.type === 'preparation');
                                                if (!dependsOnPrep || !hasPrepPhases) return false;
                                                return true;
                                            }
                                            if (dept.id === 'PACK') return true; // Mostra sempre
                                            return false;
                                        }
                                        
                                        const jobDept = job.department?.toUpperCase() || '';
                                        const dCode = (dept as any).code?.toUpperCase() || '';
                                        const dName = (dept as any).name?.toUpperCase() || '';
                                        const dId = dept.id.toUpperCase();
                                        
                                        return jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept);
                                    });

                                    const totalLoad = weekJobs.reduce((acc, job) => acc + getJobLoadInDept(job, dept.id), 0);
                                    const isOverloaded = capacityHours > 0 && totalLoad > capacityHours;

                                    return (
                                        <Card 
                                            key={`${dept.id}|${weekStartDateStr}`}
                                            className={cn(
                                                "group border transition-all duration-300 rounded-2xl overflow-hidden shadow-sm flex flex-col h-full bg-slate-900 border-slate-800",
                                                isOverloaded ? "border-red-900/50 bg-red-950/20 shadow-red-900/20" : ""
                                            )}
                                        >

                                                    <CardHeader className="p-4 bg-slate-950/50 border-b border-slate-800 flex flex-row items-center justify-between gap-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{week.label}</span>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button 
                                                                                variant="ghost" 
                                                                                size="sm" 
                                                                                className="h-7 px-2 hover:bg-blue-600 hover:text-white rounded-lg gap-2 text-slate-400 font-black text-[10px] uppercase transition-all"
                                                                                onClick={() => onManageAllocations(dept.id, week.weekNum, week.year)}
                                                                            >
                                                                                <Users className="h-3 w-3" />
                                                                                {weekAssignments.length} Opt.
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        {weekAssignments.length > 0 && (
                                                                            <TooltipContent className="bg-slate-900 border-slate-700 p-3 shadow-2xl rounded-xl min-w-[180px]">
                                                                                <h4 className="text-[10px] font-black uppercase text-slate-500 mb-2 border-b border-slate-800 pb-1">Operatori Assegnati</h4>
                                                                                <div className="space-y-2">
                                                                                    {weekAssignments.map(a => {
                                                                                        const op = operators.find(o => o.id === a.operatorId);
                                                                                        return (
                                                                                            <div key={a.operatorId} className="flex justify-between items-center gap-4">
                                                                                                <span className="text-[10px] font-bold text-slate-200">{op?.nome || '???'}</span>
                                                                                                <Badge className="bg-blue-600/20 text-blue-400 border-none text-[9px] font-black h-4 px-1">{a.hours}h</Badge>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </TooltipContent>
                                                                        )}
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                                <span className="text-[10px] font-bold text-slate-400">({capacityHours}h)</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end">
                                                            <div className="flex items-center gap-2">
                                                                {isOverloaded && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                                                                <span className={cn("text-sm font-black italic tracking-tighter", isOverloaded ? "text-red-600 animate-pulse" : "text-blue-600")}>
                                                                    {totalLoad.toFixed(1)}h
                                                                </span>
                                                            </div>
                                                            <Progress value={capacityHours > 0 ? (totalLoad / capacityHours) * 100 : 0} className={cn("h-1.5 w-16 mt-1.5", isOverloaded ? "[&>div]:bg-red-500" : "[&>div]:bg-blue-600")} />
                                                        </div>
                                                    </CardHeader>
                                                    <CardContent className="p-3 space-y-3 min-h-[250px] bg-transparent flex-1">
                                                        {weekJobs.map((job) => {
                                                            const isA = isMatch(job);
                                                            const isActive = isA && matchingJobs[activeResultIndex]?.id === job.id;
                                                            
                                                            return (
                                                                <div 
                                                                    key={job.id}
                                                                    className={cn(
                                                                        "relative transition-all duration-300",
                                                                        searchQuery.length >= 2 && !isA ? "opacity-20 grayscale-[0.8] scale-[0.98]" : "opacity-100",
                                                                        isA && !isActive ? "z-10 bg-slate-950/30 rounded-2xl ring-2 ring-blue-500/50 shadow-md scale-[1.01]" : "",
                                                                        isActive ? "z-20 bg-amber-950/20 rounded-2xl ring-4 ring-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.5)] scale-[1.05]" : ""
                                                                    )}
                                                                >
                                                                    <JobCompactCard 
                                                                        job={job} 
                                                                        load={getJobRemainingLoadInDept(job, dept.id, articles, phaseTemplates)}
                                                                        totalLoad={getJobLoadInDept(job, dept.id)}
                                                                        onAdvance={() => onStatusAdvance(job.id)}
                                                                        onToggleExclude={async (val) => {
                                                                            const res = await toggleExcludeFromPackingList(job.id, val);
                                                                            if(res.success) toast({ title: "Aggiornato", description: res.message });
                                                                        }}
                                                                        onClick={() => onJobClick(job.id, dept.id === 'PREP' ? 'PREP' : (dept.id === 'PACK' ? 'PACK' : 'CORE'))}
                                                                        macroArea={dept.id === 'PREP' ? 'PREP' : (dept.id === 'PACK' ? 'PACK' : 'CORE')}
                                                                        semaphoreStatus={getCloneStatus(job, dept.id === 'PREP' ? 'PREP' : (dept.id === 'PACK' ? 'PACK' : 'CORE'))}
                                                                        isTechnicalDelay={checkTechnicalFeasibility(job, dept.id, week)}
                                                                        onQuickView={() => onQuickView(job)}
                                                                        linkedODLs={job.workGroupId ? jobOrders.filter(j => j.workGroupId === job.workGroupId && j.id !== job.id).map(j => j.numeroODLInterno || j.ordinePF) : []}
                                                                        rawMaterials={rawMaterials}
                                                                        mrpTimelines={mrpTimelines}
                                                                        globalSettings={globalSettings}
                                                                    />
                                                                    {isA && (
                                                                        <div className="absolute -top-3 -right-3 flex h-6 w-6 pointer-events-none z-30">
                                                                            <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isActive ? "bg-amber-400" : "bg-blue-400")}></span>
                                                                            <span className={cn("relative inline-flex rounded-full h-6 w-6 border-2 border-white shadow-lg flex items-center justify-center", isActive ? "bg-amber-500" : "bg-blue-600")}>
                                                                                {isActive ? <Zap className="h-3 w-3 text-white fill-white" /> : <Search className="h-3 w-3 text-white" />}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}

                                                    </CardContent>
                                                </Card>
                                    );
                                })}
                            </div>
                        </TabsContent>
                    );
                })}
            </Tabs>
        </div>
    );
}


function getJobRemainingLoadInDept(job: JobOrder, deptId: string, articles: Article[], phaseTemplates: WorkPhaseTemplate[]) {
    const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
    if (!article) return 0;
    
    const phaseTimes = article.phaseTimes || {};
    const deptPhases = phaseTemplates.filter(t => t.departmentCodes.includes(deptId));
    
    // Filtriamo solo per le fasi NON completate
    const remainingMins = deptPhases.reduce((acc, t) => {
        const pt = phaseTimes[t.id];
        const jobPhase = job.phases.find(p => p.name === t.name);
        const isCompleted = jobPhase && (jobPhase.status === 'completed' || jobPhase.status === 'skipped');
        
        if (!isCompleted && pt?.enabled !== false && (pt?.expectedMinutesPerPiece || 0) > 0) {
            return acc + (pt.expectedMinutesPerPiece * job.qta);
        }
        return acc;
    }, 0);

    return remainingMins / 60;
}

function JobCompactCard(props: { 
    job: JobOrder, 
    load: number, 
    onAdvance: () => void, 
    onToggleExclude: (val: boolean) => void | Promise<void>,
    onQuickView: () => void,
    onClick: () => void,
    macroArea: 'PREP' | 'CORE' | 'PACK',
    semaphoreStatus: 'status-gray' | 'status-amber' | 'status-blue' | 'status-green',
    isTechnicalDelay: boolean,
    totalLoad: number,
    linkedODLs: string[],
    rawMaterials: any[],
    mrpTimelines: Map<string, MRPTimelineEntry[]>,
    globalSettings: any
}) {
    const { 
        job, load, onAdvance, onToggleExclude, onQuickView, onClick, 
        macroArea, semaphoreStatus, isTechnicalDelay, totalLoad, 
        linkedODLs = [], rawMaterials, mrpTimelines, globalSettings 
    } = props;

    const today = startOfDay(new Date());

    // SSoT: Logica Date Contestuali con Parsing Robusto e Fallback Obbligatorio
    const rawContextualDateStr = macroArea === 'PREP' 
        ? (job.dataFinePreparazione || job.dataConsegnaFinale) 
        : job.dataConsegnaFinale;
        
    const contextualDate = parseRobustDate(rawContextualDateStr);

    // SSoT: Alert Ritardo
    const isOverdue = contextualDate && isPast(contextualDate) && !isSameDay(contextualDate, today) && !['CHIUSO', 'COMPLETATA'].includes(job.status?.toUpperCase() || '');
    
    // SSoT: Alert Materiali (Time-Phased MRP)
    const stockStatus = (() => {
        if (!job.billOfMaterials || job.billOfMaterials.length === 0) {
            return { color: 'text-slate-500', icon: Info, label: 'Nessuna BOM definita' };
        }
        
        const componentEntries: { entry: MRPTimelineEntry, item: any }[] = [];
        job.billOfMaterials.forEach(item => {
            const matCode = item.component?.toUpperCase();
            const timeline = mrpTimelines.get(matCode) || [];
            const entry = timeline.find(e => e.jobId === job.id);
            if (entry) componentEntries.push({ entry, item });
        });

        if (componentEntries.length === 0) {
             return { color: 'text-red-500', icon: XCircle, label: 'Materiali non configurati', details: ['Controllare anagrafica materiali'] };
        }

        const isRed = componentEntries.some(ce => ce.entry.status === 'RED');
        const isAmber = !isRed && componentEntries.some(ce => ce.entry.status === 'AMBER');
        
        // Costruiamo i dettagli specifici partendo dai messaggi del motore MRP
        // Aggiungiamo il prefisso col codice componente per chiarezza nel tooltip
        const combinedDetails = componentEntries.flatMap(ce => {
            const prefix = ce.item.component;
            return ce.entry.details.map((d: string) => d.startsWith('Fabbisogno') ? `📦 ${prefix} - ${d}` : d);
        });

        if (isRed) {
            return { color: 'text-red-500', icon: XCircle, label: 'MANCANZA MATERIALI', details: combinedDetails };
        }
        if (isAmber) {
            return { color: 'text-amber-500', icon: AlertTriangle, label: 'COPERTURA DA ORDINE', details: combinedDetails };
        }
        return { color: 'text-green-500', icon: CheckCircle2, label: 'TUTTO DISPONIBILE', details: combinedDetails };
    })();

    const StockIcon = stockStatus.icon;
    
    const sColors: Record<string, string> = {
        'status-gray': 'bg-slate-750/30 border-slate-700/50 opacity-60 grayscale',
        'status-amber': 'bg-amber-950/20 border-amber-500/30 shadow-amber-900/5',
        'status-blue': 'bg-blue-950/30 border-blue-500/40 shadow-blue-900/10 active-row-glow',
        'status-green': 'bg-emerald-950/40 border-emerald-500/30 shadow-emerald-900/5'
    };

    const sIndicator: Record<string, string> = {
        'status-gray': 'bg-slate-600',
        'status-amber': 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
        'status-blue': 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]',
        'status-green': 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
    };

    const statusLabels: Record<string, string> = {
        'status-gray': 'IN ATTESA',
        'status-amber': 'PRONTA',
        'status-blue': 'IN LAV.',
        'status-green': 'COMPLETATA'
    };

    const isClosed = semaphoreStatus === 'status-green' && macroArea === 'PACK';

    return (
        <div 
            onClick={onClick}
            className={cn(
                "group relative flex items-center h-11 px-3 border rounded-xl transition-all cursor-pointer overflow-hidden",
                sColors[semaphoreStatus],
                job.hasMaterialShortage && "border-destructive border-2 shadow-[0_0_10px_rgba(239,68,68,0.4)]",
                job.isSuspended && !job.hasMaterialShortage && "border-yellow-500 border-2 shadow-[0_0_10px_rgba(234,179,8,0.4)]",
                isOverdue && !isClosed && semaphoreStatus !== 'status-green' && !job.hasMaterialShortage && !job.isSuspended && "border-red-600/40 bg-red-950/5",
                isTechnicalDelay && !isClosed && "border-red-500 border-2 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
            )}
        >
            {/* Indicatore Stato Verticale */}
            <div className={cn("absolute left-0 top-0 bottom-0 w-1", sIndicator[semaphoreStatus])} />

            <div className="flex items-center w-full gap-3 pl-1">
                {/* Badge Stato Testuale */}
                <div className={cn(
                    "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter shrink-0",
                    isClosed ? "bg-emerald-500 text-white" : "bg-slate-900 text-slate-400 border border-slate-800"
                )}>
                    {statusLabels[semaphoreStatus]}
                </div>

                {job.hasMaterialShortage && (
                    <div className="bg-destructive text-destructive-foreground px-1 py-0.5 rounded flex items-center gap-1 shrink-0" title="Manca Materiale">
                        <AlertTriangle className="h-3 w-3" />
                    </div>
                )}
                
                {job.isSuspended && !job.hasMaterialShortage && (
                    <div className="bg-yellow-500 text-white px-1 py-0.5 rounded flex items-center gap-1 shrink-0" title="Sospesa">
                        <Pause className="h-3 w-3 fill-white" />
                    </div>
                )}

                {/* Informazioni Commessa: CLIENTE - ORDINE PF - CODICE ARTICOLO */}
                <div className="flex items-center gap-2 min-w-0 max-w-[45%]">
                    {/* CLIENTE */}
                    <span className="text-[11px] font-black text-blue-400 uppercase truncate whitespace-nowrap shrink-0">
                        {job.cliente}
                    </span>
                    
                    <span className="text-slate-700 font-bold">•</span>

                    {/* ORDINE PF */}
                    <span className="text-[10px] font-bold text-slate-100 uppercase truncate whitespace-nowrap">
                        {job.ordinePF || 'N/D'}
                    </span>

                    <span className="text-slate-700 font-bold">•</span>

                    {/* CODICE ARTICOLO */}
                    <span className="text-[10px] font-black text-slate-200 uppercase truncate tracking-tight">
                        {job.details}
                    </span>
                </div>

                {/* N° ODL (Secondario) */}
                <div className="hidden xl:flex items-center gap-1.5 px-2 py-0.5 bg-slate-900/30 border border-slate-800/50 rounded-lg ml-2 shrink-0">
                    <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">ODL:</span>
                    <span className="text-[9px] font-black text-slate-500">{job.numeroODLInterno || 'N/D'}</span>
                </div>

                {/* Spazio flessibile */}
                <div className="flex-grow" />

                {/* Data */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-900/50 border border-slate-800 rounded-lg shrink-0">
                    <Calendar className={cn("h-3 w-3", isOverdue ? "text-red-500" : "text-slate-400")} />
                    <span className={cn("text-[9px] font-black uppercase tracking-tight", isOverdue ? "text-red-500 font-black" : "text-slate-400")}>
                        {contextualDate ? format(contextualDate, 'dd MMM', { locale: it }) : 'N/D'}
                    </span>
                </div>

                {/* Alert Icons */}
                <div className="flex items-center gap-1.5 shrink-0 px-1 border-l border-slate-800 ml-1">
                    <TooltipProvider delayDuration={100}>
                        {/* Stock Alert SSoT */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={cn("cursor-help p-0.5 rounded-full hover:bg-slate-800 transition-colors", stockStatus.color)}>
                                    <StockIcon className="h-4 w-4" />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="bg-slate-900 border-slate-700 p-2 shadow-2xl">
                                <div className="flex flex-col gap-1.5 min-w-[150px]">
                                    <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5">
                                        <StockIcon className={cn("h-3.5 w-3.5", stockStatus.color)} />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-200">{stockStatus.label}</span>
                                    </div>
                                    {stockStatus.details && (
                                        <ul className="space-y-1">
                                            {stockStatus.details.map((d, i) => (
                                                <li key={i} className="text-[9px] font-bold text-slate-400 leading-tight">{d}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </TooltipContent>
                        </Tooltip>

                        {/* Delay Alert */}
                        {isOverdue && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 cursor-help animate-pulse" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-slate-900 border-slate-700 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                                    Ritardo Consegna
                                </TooltipContent>
                            </Tooltip>
                        )}

                        {/* Batch Alert */}
                        {linkedODLs.length > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Hash className="h-3.5 w-3.5 text-indigo-400 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-slate-900 border-slate-700">
                                    <div className="flex flex-col gap-1 text-[9px]">
                                        <span className="font-black text-indigo-300 uppercase tracking-widest border-b border-indigo-900/50 pb-1 mb-1">Batch di Produzione</span>
                                        <div className="flex flex-wrap gap-1">
                                            {linkedODLs.map((odl, i) => (
                                                <span key={i} className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800/30 font-bold">{odl}</span>
                                            ))}
                                        </div>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </TooltipProvider>
                </div>

                {/* Badge Quantità */}
                <Badge variant="outline" className="text-[9px] font-black px-1.5 h-6 bg-slate-900/40 text-slate-300 border-slate-800 shrink-0">
                    {job.qta} PZ
                </Badge>

                {/* Ore (Rim/Tot) */}
                <div className="flex items-center gap-1.5 px-2 h-7 bg-blue-600/10 border border-blue-500/20 rounded-lg shrink-0 min-w-[65px] justify-center">
                    <Timer className="h-3 w-3 text-blue-400" />
                    <span className="text-[10px] font-black text-blue-300">
                        {load.toFixed(1)}h
                        {totalLoad > load && (
                             <span className="text-slate-500 ml-1 font-bold">/ {totalLoad.toFixed(1)}</span>
                        )}
                    </span>
                </div>

                <Button 
                    variant="ghost" 
                    className="h-7 w-7 p-0 flex items-center justify-center rounded-lg bg-slate-800/50 text-slate-400 hover:bg-blue-600 hover:text-white transition-all shrink-0"
                    onClick={(e) => { e.stopPropagation(); onQuickView(); }}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
