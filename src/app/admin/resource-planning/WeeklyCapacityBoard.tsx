'use client';

import React, { useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { format, addWeeks, startOfWeek, endOfWeek, getWeek, parseISO, isSameWeek, isSameDay, isBefore, getDay, isPast, startOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from "@/components/ui/progress";
import { Button } from '@/components/ui/button';
import { 
    Users, Timer, Info, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, 
    Boxes, Package, Factory, Scissors, Calendar, Hash, PackageX, Search, XCircle,
    CalendarCheck, ChevronDown, ChevronUp, Box, Pause, Pencil, Wand2, Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { formatDisplayStock, parseRobustDate } from '@/lib/utils';
import { MRPTimelineEntry, aggregateMRPRequirements } from '@/lib/mrp-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from 'lucide-react';



import type { JobOrder, Operator, Department, Article, WorkPhaseTemplate } from '@/types';
import { advanceJobStatus } from './weekly-actions';
import { toggleExcludeFromPackingList } from './actions';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { getOverallStatus } from '@/lib/types';
import { getDerivedJobStatus } from '@/lib/job-status';
import { MRPSemaphore } from '@/components/mrp/MRPSemaphore';
import { ProcessedJob, isPreparationPhase, isProductionPhase, isQualityPackagingPhase } from './ssot-utils';
import { exportScaletta } from '../../../lib/export-scaletta';

interface WeeklyCapacityBoardProps {
    jobOrders: JobOrder[];
    processedJobs: ProcessedJob[];
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
    onUpdateSequence?: (jobId: string, seq: number) => void;
    onManageAllocations: (deptId: string, week: number, year: number) => void;
    onJobClick: (jobId: string, macroArea: string) => void;
    onQuickView: (job: JobOrder) => void;
    onEdit: (job: JobOrder) => void;
    rawMaterials?: any[];
    mrpTimelines?: Map<string, MRPTimelineEntry[]>;
    globalSettings?: any;
    isSimulationMode: boolean;
    onSimulationModeChange: (val: boolean) => void;
}

export interface WeeklyCapacityBoardRef {
    getExportJobs: (year: number, weekNum: number, deptId: string) => JobOrder[];
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

const WeeklyCapacityBoard = forwardRef<WeeklyCapacityBoardRef, WeeklyCapacityBoardProps>(({
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
    onEdit,
    rawMaterials = [],
    mrpTimelines = new Map(),
    globalSettings,
    isSimulationMode,
    onSimulationModeChange,
    processedJobs = [],
    onUpdateSequence
}, ref) => {
    const computedJobsRef = useRef<Record<string, JobOrder[]>>({});

    useImperativeHandle(ref, () => ({
        getExportJobs: (year: number, weekNum: number, deptId: string) => {
            return computedJobsRef.current[`${year}_${weekNum}_${deptId}`] || [];
        }
    }));
    
    // Pulizia all'avvio per evitare memory leaks
    useEffect(() => {
        computedJobsRef.current = {};
    }, [jobOrders, currentDate]);
    const { toast } = useToast();
    const router = useRouter();
    const [viewMode, setViewMode] = useState<'1W' | '2W'>('2W');
    const [activeResultIndex, setActiveResultIndex] = useState(0);
    const [statusFilter, setStatusFilter] = useState<string>('Tutte');
    const [showCompletedJobs, setShowCompletedJobs] = useState(true);

    const numWeeks = viewMode === '1W' ? 1 : 2;
    const settingsEfficiency = (globalSettings?.capacityBufferPercent || 85) / 100;

    // Costanti per il Check-up di Fattibilità
    const EFFICIENCY_FACTOR = settingsEfficiency;
    const DEFAULT_PREP_OPERATORS = 2;
    const DEFAULT_PACK_OPERATORS = 2;

    // Sanificazione Backlog: Escludiamo categoricamente stati IN_PIANIFICAZIONE o planned
    const sanitizedUnassigned = useMemo(() => {
        return unassignedJobs.filter(job => {
            const derived = getDerivedJobStatus(job);
            if (derived === 'CHIUSO') return false;
            return PRODUCTION_STATUS_WHITELIST.includes(job.status);
        });
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
        
        const allJobs = [...jobOrders, ...unassignedJobs];
        const matches = allJobs.filter(isMatch);
        
        // Ordiniamo cronologicamente: chiusi prima (storico), poi per data di consegna, poi quelli senza data (backlog)
        return matches.sort((a, b) => {
            const dateA = a.dataConsegnaFinale && a.dataConsegnaFinale !== 'N/D' ? a.dataConsegnaFinale : '9999-99-99';
            const dateB = b.dataConsegnaFinale && b.dataConsegnaFinale !== 'N/D' ? b.dataConsegnaFinale : '9999-99-99';
            return dateA.localeCompare(dateB);
        });
    }, [searchQuery, jobOrders, unassignedJobs, isMatch]);

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
        const macroArea = deptId === 'PREP' ? 'PREP' : deptId === 'PACK' ? 'PACK' : 'CORE';
        return getJobMRPData(job, deptId, macroArea, articles, phaseTemplates).expected;
    };

    const isMacroAreaCompleted = (job: JobOrder, type: 'preparation' | 'production' | 'quality_pack') => {
        const phases = job.phases || [];
        let relevantPhases = [];
        if (type === 'preparation') relevantPhases = phases.filter(p => isPreparationPhase(p.type));
        else if (type === 'production') relevantPhases = phases.filter(p => isProductionPhase(p.type));
        else relevantPhases = phases.filter(p => isQualityPackagingPhase(p.type));

        if (relevantPhases.length === 0) return true;
        return relevantPhases.every(p => p.status === 'completed' || p.status === 'skipped');
    };

    const getMacroAreaCompletionDate = (job: JobOrder, type: 'PREP' | 'CORE' | 'PACK'): Date | null => {
        const phases = job.phases || [];
        let relevantPhases = [];
        if (type === 'PREP') relevantPhases = phases.filter(p => isPreparationPhase(p.type));
        else if (type === 'CORE') relevantPhases = phases.filter(p => isProductionPhase(p.type));
        else relevantPhases = phases.filter(p => isQualityPackagingPhase(p.type));

        if (relevantPhases.length === 0) return null;
        if (!relevantPhases.every(p => p.status === 'completed' || p.status === 'skipped')) return null;

        let latestDate: Date | null = null;
        relevantPhases.forEach(p => {
            if (p.status === 'completed' && p.workPeriods && p.workPeriods.length > 0) {
                // Troviamo il periodo che finisce più tardi per questa fase
                p.workPeriods.forEach(wp => {
                    if (wp.end) {
                        const d = wp.end instanceof Date 
                            ? wp.end 
                            : (typeof wp.end === 'object' && 'seconds' in (wp.end as any))
                                ? new Date((wp.end as any).seconds * 1000)
                                : new Date(wp.end as string);
                        
                        if (!latestDate || d > latestDate) latestDate = d;
                    }
                });
            }
        });
        return latestDate;
    };

    const isMacroAreaStarted = (job: JobOrder, type: 'preparation' | 'production' | 'quality_pack') => {
        const phases = job.phases || [];
        let relevantPhases = [];
        if (type === 'preparation') relevantPhases = phases.filter(p => isPreparationPhase(p.type));
        else if (type === 'production') relevantPhases = phases.filter(p => isProductionPhase(p.type));
        else relevantPhases = phases.filter(p => isQualityPackagingPhase(p.type));

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
            const hasPrepPhases = (job.phases || []).some(p => isPreparationPhase(p.type));
            
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
                                
                                if (dept.id === 'PREP') {
                                    const jobCoreDept = departments.find(d => d.id === j.department || d.code === j.department);
                                    const dependsOnPrep = jobCoreDept?.dependsOnPreparation ?? false;
                                    const hasPrepPhases = (j.phases || []).some((p: any) => isPreparationPhase(p.type));
                                    if (dependsOnPrep || hasPrepPhases) return true;
                                }
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
                                        const isClosed = getDerivedJobStatus(j) === 'CHIUSO';
                                        const isProd = PRODUCTION_STATUS_WHITELIST.includes(j.status);
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
                                                {jobOrders.filter(j => getDerivedJobStatus(j) === 'CHIUSO').length}
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
                                <Label htmlFor="show-completed" className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Mostra Completati</Label>
                                <span className="text-[8px] font-bold text-emerald-500 uppercase italic leading-none">Fasi Concluse</span>
                            </div>
                            <Switch 
                                id="show-completed"
                                checked={showCompletedJobs}
                                onCheckedChange={setShowCompletedJobs}
                                className="data-[state=checked]:bg-emerald-600"
                            />
                        </div>

                        <div className="flex items-center gap-3 pr-2 border-l border-slate-800 pl-4">
                            <div className="flex flex-col items-end">
                                <Label htmlFor="simulation-mode" className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Check-up Venerdì</Label>
                                <span className="text-[8px] font-bold text-slate-600 uppercase italic leading-none">Proiezione Arretrati</span>
                            </div>
                            <Switch 
                                id="simulation-mode"
                                checked={isSimulationMode}
                                onCheckedChange={onSimulationModeChange}
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
                                    
                                    const weekJobs = processedJobs.filter(pj => {
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        
                                        // 1. Filtro Settimanale (SSoT Virtual Week)
                                        const areaVirtualWeek = pj.virtualWeeks ? pj.virtualWeeks[macroArea] : pj.virtualWeek;
                                        if (!isSameWeek(week.start, areaVirtualWeek, { weekStartsOn: 1 })) return false;

                                        // Toggle Mostra Completati
                                        const isAreaFinished = pj.isFinished[macroArea];
                                        if (!showCompletedJobs && isAreaFinished) return false;

                                        const job = pj.job;

                                        // 2. Filtro Reparto/MacroArea
                                        let matchesDept = false;
                                        if (isSatellite) {
                                            if (dept.id === 'PREP') {
                                                const jobCoreDept = departments.find(d => d.id === job.department || d.code === job.department);
                                                const dependsOnPrep = jobCoreDept?.dependsOnPreparation ?? false;
                                                const hasPrepPhases = (job.phases || []).some(p => isPreparationPhase(p.type));
                                                if (dependsOnPrep || hasPrepPhases) matchesDept = true;
                                            } else if (dept.id === 'PACK') {
                                                matchesDept = true;
                                            }
                                        } else {
                                            const jobDept = job.department?.toUpperCase() || '';
                                            const dCode = (dept as any).code?.toUpperCase() || '';
                                            const dName = (dept as any).name?.toUpperCase() || '';
                                            const dId = dept.id.toUpperCase();
                                            if (jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept)) {
                                                matchesDept = true;
                                            }
                                        }

                                        if (!matchesDept) return false;

                                        // 3. STRICT SEARCH FILTER (Hiding non-matches)
                                        if (searchQuery.length >= 2) {
                                            const q = searchQuery.toLowerCase().trim();
                                            const matchesSearch = (
                                                (job.numeroODLInterno?.toLowerCase().includes(q)) ||
                                                (job.ordinePF?.toLowerCase().includes(q)) ||
                                                (job.details?.toLowerCase().includes(q)) ||
                                                (job.cliente?.toLowerCase().includes(q))
                                            );
                                            if (!matchesSearch) return false;
                                        }

                                        // 4. STATUS FILTER
                                        if (statusFilter !== 'Tutte') {
                                            const dStatus = getDerivedJobStatus(job);
                                            let currentLabel = "";

                                            // Replicate matrix logic for filtering
                                            if (dStatus === 'DA_INIZIARE' || dStatus === 'IN_PREPARAZIONE') currentLabel = "IN PREP.";
                                            else if (dStatus === 'PRONTO_PROD') {
                                                if (macroArea === 'PREP') currentLabel = "COMPLETATA";
                                                else if (macroArea === 'CORE') currentLabel = "PRONTO PROD.";
                                                else currentLabel = "IN ATTESA";
                                            }
                                            else if (dStatus === 'IN_PRODUZIONE') {
                                                if (macroArea === 'PREP') currentLabel = "COMPLETATA";
                                                else if (macroArea === 'CORE') currentLabel = "IN LAV.";
                                                else currentLabel = "IN ATTESA";
                                            }
                                            else if (dStatus === 'FINE_PRODUZIONE' || dStatus === 'QLTY_PACK') {
                                                if (macroArea === 'PREP' || macroArea === 'CORE') currentLabel = "COMPLETATA";
                                                else currentLabel = "PRONTO PACK";
                                            }
                                            else if (dStatus === 'CHIUSO' || getCloneStatus(job, macroArea) === 'status-green') {
                                                currentLabel = "COMPLETATA";
                                            }

                                            if (currentLabel !== statusFilter) return false;
                                        }

                                        // 5. DEPARTMENT TEMPORAL FREEZING
                                        // Non necessario: le virtualWeeks gestiscono la scomparsa naturale nelle settimane in cui la fase non è completata.

                                        return true;
                                    });

                                    // Salva esattamente le commesse renderizzate per l'export SSoT
                                    computedJobsRef.current[`${week.year}_${week.weekNum}_${dept.id}`] = weekJobs.map(pj => pj.job);

                                    // Hybrid Smart Sorting
                                    weekJobs.sort((a, b) => {
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        
                                        // Priorità 1 (Stato): Completato in fondo
                                        const aFinished = a.isFinished[macroArea] ? 1 : 0;
                                        const bFinished = b.isFinished[macroArea] ? 1 : 0;
                                        if (aFinished !== bFinished) return aFinished - bFinished;
                                        
                                        // Priorità 2 (Data Scadenza): Dalla più in ritardo alla più lontana
                                        const dateA = a.job.dataConsegnaFinale && a.job.dataConsegnaFinale !== 'N/D' ? a.job.dataConsegnaFinale : '9999-99-99';
                                        const dateB = b.job.dataConsegnaFinale && b.job.dataConsegnaFinale !== 'N/D' ? b.job.dataConsegnaFinale : '9999-99-99';
                                        const dateDiff = dateA.localeCompare(dateB);
                                        if (dateDiff !== 0) return dateDiff;
                                        
                                        // Priorità 3 (Sequenza Giornaliera)
                                        const seqA = a.job.dailySequence || 0;
                                        const seqB = b.job.dailySequence || 0;
                                        return seqA - seqB;
                                    });

                                    const totalLoad = weekJobs.reduce((acc, pj) => {
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        const mrpData = getJobMRPData(pj.job, dept.id, macroArea, articles, phaseTemplates);
                                        return acc + mrpData.residual;
                                    }, 0);
                                    
                                    const totalWorked = weekJobs.reduce((acc, pj) => {
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        const mrpData = getJobMRPData(pj.job, dept.id, macroArea, articles, phaseTemplates, week.start);
                                        return acc + mrpData.weekTracked;
                                    }, 0);

                                    const isOverloaded = capacityHours > 0 && totalLoad > capacityHours;

                                    const totalJobs = weekJobs.length;
                                    const completedJobs = weekJobs.filter(pj => {
                                        const macroArea = dept.id === 'PREP' ? 'PREP' : dept.id === 'PACK' ? 'PACK' : 'CORE';
                                        return pj.isFinished[macroArea];
                                    }).length;
                                    const openJobs = totalJobs - completedJobs;

                                    return (
                                        <Card 
                                            key={`${dept.id}|${weekStartDateStr}`}
                                            className={cn(
                                                "group border transition-all duration-300 rounded-2xl overflow-hidden shadow-sm flex flex-col h-full bg-slate-900 border-slate-800",
                                                isOverloaded ? "border-red-900/50 bg-red-950/20 shadow-red-900/20" : ""
                                            )}
                                        >
                                            <CardHeader className="p-4 bg-slate-950/50 border-b border-slate-800 flex flex-col justify-between gap-3">
                                                <div className="flex items-center justify-between">
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
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                                                            <SelectTrigger className="h-7 w-[100px] bg-slate-900 border-slate-800 text-[9px] font-black uppercase text-slate-400 rounded-lg">
                                                                <div className="flex items-center gap-2">
                                                                    <Filter className="h-3 w-3 text-slate-500" />
                                                                    <SelectValue placeholder="Filtro" />
                                                                </div>
                                                            </SelectTrigger>
                                                            <SelectContent className="bg-slate-950 border-slate-800">
                                                                <SelectItem value="Tutte" className="text-[10px] font-bold uppercase">Tutte</SelectItem>
                                                                <SelectItem value="IN PREP." className="text-[10px] font-bold uppercase text-amber-500">IN PREP.</SelectItem>
                                                                <SelectItem value="PRONTO PROD." className="text-[10px] font-bold uppercase text-amber-400">PRONTO PROD.</SelectItem>
                                                                <SelectItem value="IN LAV." className="text-[10px] font-bold uppercase text-blue-400">IN LAV.</SelectItem>
                                                                <SelectItem value="PRONTO PACK" className="text-[10px] font-bold uppercase text-amber-500">PRONTO PACK</SelectItem>
                                                                <SelectItem value="IN ATTESA" className="text-[10px] font-bold uppercase text-slate-500">IN ATTESA</SelectItem>
                                                                <SelectItem value="COMPLETATA" className="text-[10px] font-bold uppercase text-emerald-500">COMPLETATA</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        
                                                        {/* Export Button */}
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm"
                                                            className="h-7 w-7 p-0 rounded-lg bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                                                            onClick={() => {
                                                                exportScaletta(weekJobs, dept.id, week.label);
                                                            }}
                                                        >
                                                            <Download className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800/50 shadow-inner w-full">
                                                    <div className="flex items-center gap-1.5 w-1/3">
                                                        <div className="flex flex-col items-center flex-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                                                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter">Capacità</span>
                                                            <span className="text-[11px] font-black text-slate-300">{capacityHours}h</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 w-1/3">
                                                        <div className={cn(
                                                            "flex flex-col items-center flex-1 border rounded-lg p-1 transition-all",
                                                            isOverloaded ? "bg-red-950/40 border-red-900/50" : "bg-slate-900 border-slate-800"
                                                        )}>
                                                            <span className={cn("text-[8px] font-black uppercase tracking-tighter flex items-center gap-1", isOverloaded ? "text-red-400 animate-pulse" : "text-slate-500")}>
                                                                {isOverloaded && <AlertTriangle className="h-2 w-2" />} Previsto
                                                            </span>
                                                            <span className={cn("text-[11px] font-black", isOverloaded ? "text-red-500" : "text-blue-500")}>{totalLoad.toFixed(1)}h</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 w-1/3">
                                                        <div className="flex flex-col items-center flex-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                                                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter">Lavorato</span>
                                                            <span className="text-[11px] font-black text-emerald-500">{totalWorked.toFixed(1)}h</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="p-3 space-y-3 min-h-[250px] bg-transparent flex-1">
                                                {weekJobs.map((pj) => {
                                                    const job = pj.job;
                                                    const isA = isMatch(job);
                                                    const isActive = isA && matchingJobs[activeResultIndex]?.id === job.id;
                                                    
                                                    const cardMacroArea = dept.id === 'PREP' ? 'PREP' : (dept.id === 'PACK' ? 'PACK' : 'CORE');
                                                    // In produzione/live, comunque calcoliamo i dettagli per la card (fatte, ecc)
                                                    const mrpData = getJobMRPData(job, dept.id, cardMacroArea, articles, phaseTemplates);

                                                    return (
                                                        <div 
                                                            key={job.id}
                                                            className={cn(
                                                                "relative transition-all duration-300",
                                                                isActive ? "z-20 bg-amber-950/20 rounded-2xl ring-4 ring-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.5)] scale-[1.05]" : ""
                                                            )}
                                                        >
                                                            <JobCompactCard 
                                                                job={job} 
                                                                load={pj.computedResidual[cardMacroArea]}
                                                                fatte={mrpData.done}
                                                                totalLoad={mrpData.expected}
                                                                onAdvance={() => onStatusAdvance(job.id)}
                                                                onToggleExclude={async (val) => {
                                                                    const res = await toggleExcludeFromPackingList(job.id, val);
                                                                    if(res.success) toast({ title: "Aggiornato", description: res.message });
                                                                }}
                                                                onClick={() => onJobClick(job.id, cardMacroArea)}
                                                                macroArea={cardMacroArea}
                                                                semaphoreStatus={getCloneStatus(job, cardMacroArea)}
                                                                isTechnicalDelay={checkTechnicalFeasibility(job, dept.id, week)}
                                                                onQuickView={() => onQuickView(job)}
                                                                onEdit={() => onEdit(job)}
                                                                linkedODLs={job.workGroupId ? jobOrders.filter(j => j.workGroupId === job.workGroupId && j.id !== job.id).map(j => j.numeroODLInterno || j.ordinePF) : []}
                                                                rawMaterials={rawMaterials}
                                                                mrpTimelines={mrpTimelines}
                                                                globalSettings={globalSettings}
                                                                isAreaFinished={pj.isFinished[cardMacroArea]}
                                                                onUpdateSequence={onUpdateSequence}
                                                            />
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
});

export default WeeklyCapacityBoard;

export function getJobMRPData(job: JobOrder, deptId: string, macroArea: 'PREP' | 'CORE' | 'PACK', articles: Article[], phaseTemplates: WorkPhaseTemplate[], weekStart?: Date) {
    const article = articles.find(a => a.code?.trim().toUpperCase() === job.details?.trim().toUpperCase());
    const phaseTimes = article?.phaseTimes || {};
    
    let deptPhases = phaseTemplates.filter(t => t.departmentCodes.includes(deptId));
    if (macroArea === 'PREP') {
        deptPhases = phaseTemplates.filter(t => isPreparationPhase(t.type));
    } else if (macroArea === 'PACK') {
        deptPhases = phaseTemplates.filter(t => isQualityPackagingPhase(t.type));
    } else {
        deptPhases = phaseTemplates.filter(t => isProductionPhase(t.type) && t.departmentCodes.includes(deptId));
    }

    let totalExpected = 0;
    let totalDone = 0;
    let totalResidual = 0;
    let totalTracked = 0;
    let weekTrackedMinsTotal = 0;

    const jobStatus = job.status?.toUpperCase() || '';
    const derivedStatus = getDerivedJobStatus(job) || '';
    const isActuallyClosed = derivedStatus === 'CHIUSO' || jobStatus === 'CHIUSO' || jobStatus === 'COMPLETATA';

    const isInPrep = ['IN_PREPARAZIONE', 'IN PREPARAZIONE', 'IN PREP.', 'IN PREP'].includes(jobStatus);
    const isProntoProd = ['PRONTO_PROD', 'PRONTO PROD', 'PRONTO PROD.', 'PRONTO PER PRODUZIONE'].includes(jobStatus);
    const isInProd = ['IN_PRODUZIONE', 'IN PRODUZIONE', 'IN PROD.', 'LAVORAZIONE', 'IN LAVORAZIONE', 'PRODUCTION'].includes(jobStatus);
    const isFinal = ['FINE_PRODUZIONE', 'FINE PRODUZIONE', 'FINE PROD.', 'QLTY_PACK', 'QLTY PACK', 'QLTY & PACK', 'PRONTO PER FINITURA', 'PRONTO'].includes(jobStatus) || isActuallyClosed;

    let logicalState = 'A'; 
    if (isInPrep) logicalState = 'B';
    else if (isProntoProd) logicalState = 'C';
    else if (isInProd) logicalState = 'D';
    else if (isFinal) logicalState = 'E';

    deptPhases.forEach(t => {
        const pt = phaseTimes[t.id] || phaseTimes[t.name];
        const jobPhase = (job.phases || []).find(p => p.name === t.name);

        // SSoT Pivot: Prioritize Job-level estimate over Article-level template
        const sourceExpectedMins = (jobPhase?.expectedMinutesPerPiece && jobPhase.expectedMinutesPerPiece > 0) 
            ? jobPhase.expectedMinutesPerPiece 
            : (pt?.expectedMinutesPerPiece || 0);

        if (!(sourceExpectedMins > 0) || (pt && pt.enabled === false)) {
            return;
        }

        const expectedMins = sourceExpectedMins * (job.qta || 0);
        totalExpected += expectedMins;

        let realTimeMins = 0;
        let localWeekTrackedMins = 0;

        if (jobPhase && jobPhase.workPeriods) {
            let wStartMs = 0;
            let wEndMs = 0;
            if (weekStart) {
                wStartMs = weekStart.getTime();
                // Assumiamo settimana esatta di 7 giorni
                wEndMs = wStartMs + 7 * 24 * 60 * 60 * 1000 - 1;
            }

            const realTimeMs = jobPhase.workPeriods.reduce((sum, wp) => {
                if (!wp.start || !wp.end) return sum;
                const start = (typeof wp.start === 'object' && 'seconds' in wp.start) ? new Date(wp.start.seconds * 1000) : new Date(wp.start as string);
                const end = (typeof wp.end === 'object' && 'seconds' in wp.end) ? new Date(wp.end.seconds * 1000) : new Date(wp.end as string);
                const diff = end.getTime() - start.getTime();
                
                if (weekStart && start.getTime() >= wStartMs && start.getTime() <= wEndMs) {
                    localWeekTrackedMins += diff > 0 ? (diff / 60000) : 0;
                }

                return diff > 0 ? sum + diff : sum;
            }, 0);
            realTimeMins = realTimeMs / 60000;
        }

        totalTracked += realTimeMins;
        weekTrackedMinsTotal += localWeekTrackedMins;

        if (logicalState === 'A') {
            totalDone += 0;
            totalResidual += expectedMins;
        } 
        else if (logicalState === 'B') {
            if (macroArea === 'PREP') {
                totalDone += realTimeMins;
                totalResidual += Math.max(0, expectedMins - realTimeMins);
            } else {
                totalDone += 0;
                totalResidual += expectedMins;
            }
        }
        else if (logicalState === 'C') {
            if (macroArea === 'PREP') {
                totalDone += (realTimeMins > 0 ? realTimeMins : expectedMins);
                totalResidual += 0;
            } else {
                totalDone += 0;
                totalResidual += expectedMins;
            }
        }
        else if (logicalState === 'D') {
            if (macroArea === 'PREP') {
                totalDone += (realTimeMins > 0 ? realTimeMins : expectedMins);
                totalResidual += 0;
            } else if (macroArea === 'CORE') {
                totalDone += realTimeMins;
                totalResidual += Math.max(0, expectedMins - realTimeMins);
            } else {
                totalDone += 0;
                totalResidual += expectedMins;
            }
        }
        else if (logicalState === 'E') {
            if (macroArea === 'PREP' || macroArea === 'CORE') {
                totalDone += (realTimeMins > 0 ? realTimeMins : expectedMins);
                totalResidual += 0;
            } else if (macroArea === 'PACK') {
                if (isActuallyClosed || jobPhase?.status === 'completed') {
                    totalDone += (realTimeMins > 0 ? realTimeMins : expectedMins);
                    totalResidual += 0;
                } else {
                    totalDone += realTimeMins;
                    totalResidual += Math.max(0, expectedMins - realTimeMins);
                }
            }
        }
    });

    return {
        residual: isNaN(totalResidual) ? 0 : totalResidual / 60,
        done: isNaN(totalDone) ? 0 : totalDone / 60,
        expected: isNaN(totalExpected) ? 0 : totalExpected / 60,
        tracked: isNaN(totalTracked) ? 0 : totalTracked / 60,
        weekTracked: isNaN(weekTrackedMinsTotal) ? 0 : weekTrackedMinsTotal / 60
    };
}

function JobCompactCard(props: { 
    job: JobOrder, 
    load: number, 
    fatte: number,
    onAdvance: () => void, 
    onToggleExclude: (val: boolean) => void | Promise<void>,
    onQuickView: () => void,
    onEdit: () => void,
    onClick: () => void,
    macroArea: 'PREP' | 'CORE' | 'PACK',
    semaphoreStatus: 'status-gray' | 'status-amber' | 'status-blue' | 'status-green',
    isTechnicalDelay: boolean,
    totalLoad: number,
    linkedODLs: string[],
    rawMaterials: any[],
    mrpTimelines: Map<string, MRPTimelineEntry[]>,
    globalSettings: any,
    isAreaFinished: boolean,
    onUpdateSequence?: (jobId: string, seq: number) => void
}) {
    const { 
        job, load, fatte, onAdvance, onToggleExclude, onQuickView, onEdit, onClick, 
        macroArea, semaphoreStatus, isTechnicalDelay, totalLoad, 
        linkedODLs = [], rawMaterials, mrpTimelines, globalSettings, isAreaFinished, onUpdateSequence
    } = props;

    const { toast } = useToast();
    const today = startOfDay(new Date());

    const rawContextualDateStr = macroArea === 'PREP' 
        ? (job.dataFinePreparazione || job.dataConsegnaFinale) 
        : job.dataConsegnaFinale;
        
    const contextualDate = parseRobustDate(rawContextualDateStr);
    const isOverdue = contextualDate && isPast(contextualDate) && !isSameDay(contextualDate, today) && !['CHIUSO', 'COMPLETATA'].includes(job.status?.toUpperCase() || '');
    
    const sColors: Record<string, string> = {
        'status-gray': 'bg-slate-750/30 border-slate-700/50 opacity-60 grayscale',
        'status-amber': 'bg-amber-950/20 border-amber-500/30 shadow-amber-900/5',
        'status-blue': 'bg-blue-950/30 border-blue-500/40 shadow-blue-900/10 active-row-glow',
        'status-green': 'bg-emerald-950/40 border-emerald-500/30 shadow-emerald-900/5 opacity-80'
    };

    const sIndicator: Record<string, string> = {
        'status-gray': 'bg-slate-600',
        'status-amber': 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
        'status-blue': 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]',
        'status-green': 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
    };

    const derivedStatus = getDerivedJobStatus(job);
    const isActuallyClosed = derivedStatus === 'CHIUSO' || ['CHIUSO', 'ARCHIVIATA'].includes(job.status?.toUpperCase() || '');
    
    const hasNoPhases = !job.phases || job.phases.length === 0;

    // Check if any phase in this macro area is estimated
    const isEstimated = job.phases.filter(p => {
        if (macroArea === 'PREP') return isPreparationPhase(p.type);
        if (macroArea === 'PACK') return isQualityPackagingPhase(p.type);
        return isProductionPhase(p.type);
    }).some(p => p.isEstimated);

    const getBadgeVisuals = () => {
        if (hasNoPhases) {
            return { label: "⚠️ CICLO MANCANTE", status: 'status-error' };
        }

        // 0. SSoT Forzatura se l'area è completata
        if (isAreaFinished) {
            return { label: "COMPLETATA", status: 'status-green' };
        }

        // 1. Matrice SSoT-AWARE per Colore e Testo
        
        // Regola A: In Preparazione / Da Iniziare
        if (derivedStatus === 'DA_INIZIARE' || derivedStatus === 'IN_PREPARAZIONE') {
            return { 
                label: "IN PREP.", 
                status: macroArea === 'PREP' ? 'status-amber' : 'status-gray' 
            };
        }

        // Regola B: Pronto Produzione (Prep terminata)
        if (derivedStatus === 'PRONTO_PROD') {
            if (macroArea === 'PREP') return { label: "COMPLETATA", status: 'status-green' };
            if (macroArea === 'CORE') return { label: "PRONTO PROD.", status: 'status-amber' };
            return { label: "IN ATTESA", status: 'status-gray' };
        }

        // Regola C: In Produzione
        if (derivedStatus === 'IN_PRODUZIONE') {
            if (macroArea === 'PREP') return { label: "COMPLETATA", status: 'status-green' };
            if (macroArea === 'CORE') return { label: "IN LAV.", status: 'status-blue' };
            return { label: "IN ATTESA", status: 'status-gray' };
        }

        // Regola D: Produzione Finita
        if (derivedStatus === 'FINE_PRODUZIONE' || derivedStatus === 'QLTY_PACK') {
            if (macroArea === 'PREP' || macroArea === 'CORE') return { label: "COMPLETATA", status: 'status-green' };
            return { label: "PRONTO PACK", status: 'status-amber' };
        }

        // Regola E: Chiuso
        if (isActuallyClosed || semaphoreStatus === 'status-green') {
            return { label: "COMPLETATA", status: 'status-green' };
        }

        // Fallback
        const labels: Record<string, string> = {
            'status-gray': 'IN ATTESA',
            'status-amber': 'PRONTA',
            'status-blue': 'IN LAV.',
            'status-green': 'COMPLETATA'
        };
        return { 
            label: job.workGroupId ? "IN GRUPPO" : (labels[semaphoreStatus] || semaphoreStatus), 
            status: semaphoreStatus 
        };
    };

    const visuals = getBadgeVisuals();
    const isClosed = visuals.status === 'status-green' && macroArea === 'PACK';

    const badgeColors: Record<string, string> = {
        'status-gray': 'bg-slate-900 text-slate-400 border border-slate-800',
        'status-amber': 'bg-amber-500 text-amber-950 font-black',
        'status-blue': 'bg-blue-600 text-white font-black',
        'status-green': 'bg-emerald-500 text-white',
        'status-error': 'bg-red-600 text-white font-black animate-pulse'
    };

    const isError = visuals.status === 'status-error';

    return (
        <div 
            onClick={onClick}
            className={cn(
                "group relative flex items-center h-11 px-3 border rounded-xl transition-all cursor-pointer overflow-hidden",
                sColors[visuals.status] || sColors['status-gray'],
                isError && "border-red-600 border-2 bg-red-950/20 shadow-[0_0_15px_rgba(220,38,38,0.5)]",
                job.hasMaterialShortage && !isError && "border-destructive border-2 shadow-[0_0_10px_rgba(239,68,68,0.4)]",
                job.isSuspended && !job.hasMaterialShortage && !isError && "border-yellow-500 border-2 shadow-[0_0_10px_rgba(234,179,8,0.4)]",
                isOverdue && !isClosed && visuals.status !== 'status-green' && !job.hasMaterialShortage && !job.isSuspended && !isError && "border-red-600/40 bg-red-950/5",
                isTechnicalDelay && !isClosed && !isError && "border-red-500 border-2 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
            )}
        >
            <div className={cn("absolute left-0 top-0 bottom-0 w-1", sIndicator[visuals.status] || 'bg-red-600')} />

            <div className="flex items-center w-full gap-3 pl-1">
                <div 
                    className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter shrink-0",
                        badgeColors[visuals.status],
                        job.workGroupId && "bg-indigo-600 text-white border-none cursor-help"
                    )}
                    onClick={(e) => {
                        if (job.workGroupId) {
                            e.stopPropagation();
                            toast({ title: "Azione Inibita", description: "Stato gestito dal WorkGroup. Usa la Console di Produzione.", variant: "destructive" });
                        }
                    }}
                >
                    {visuals.label}
                </div>

                {!isActuallyClosed && job.hasMaterialShortage && (
                    <div className="bg-destructive text-destructive-foreground px-1 py-0.5 rounded flex items-center gap-1 shrink-0" title="Manca Materiale">
                        <AlertTriangle className="h-3 w-3" />
                    </div>
                )}
                
                {!isActuallyClosed && job.isSuspended && !job.hasMaterialShortage && (
                    <div className="bg-yellow-500 text-white px-1 py-0.5 rounded flex items-center gap-1 shrink-0" title="Sospesa">
                        <Pause className="h-3 w-3 fill-white" />
                    </div>
                )}

                <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
                    <span className="text-[11px] font-black text-blue-400 uppercase truncate whitespace-nowrap shrink-0 max-w-[30%]">
                        {job.cliente}
                    </span>
                    <span className="text-slate-700 font-bold shrink-0">•</span>
                    <span className="text-[10px] font-bold text-slate-100 uppercase truncate whitespace-nowrap shrink-0 max-w-[30%]">
                        {job.ordinePF || 'N/D'}
                    </span>
                    <span className="text-slate-700 font-bold shrink-0">•</span>
                    <span className="text-[10px] font-black text-slate-200 uppercase truncate tracking-tight flex-1">
                        {job.details}
                    </span>
                </div>

                <div className="hidden xl:flex items-center justify-center gap-1.5 px-2 py-0.5 bg-slate-900/30 border border-slate-800/50 rounded-lg shrink-0 w-[90px]">
                    <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">ODL:</span>
                    <span className="text-[9px] font-black text-slate-500 truncate">{job.numeroODLInterno || 'N/D'}</span>
                </div>

                <div className="flex items-center justify-center gap-1.5 px-2 py-0.5 bg-slate-900/50 border border-slate-800 rounded-lg shrink-0 w-[85px]">
                    <Calendar className={cn("h-3 w-3 shrink-0", isOverdue ? "text-red-500" : "text-slate-400")} />
                    <span className={cn("text-[9px] font-black uppercase tracking-tight truncate", isOverdue ? "text-red-500 font-black" : "text-slate-400")}>
                        {contextualDate ? format(contextualDate, 'dd MMM', { locale: it }) : 'N/D'}
                    </span>
                </div>

                <div className="flex items-center justify-center gap-1.5 shrink-0 w-[50px] border-l border-slate-800">
                    <MRPSemaphore job={job} mrpTimelines={mrpTimelines} size="md" />
                    <TooltipProvider delayDuration={100}>
                        {isOverdue && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 cursor-help animate-pulse shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-slate-900 border-slate-700 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                                    Ritardo Consegna
                                </TooltipContent>
                            </Tooltip>
                        )}
                        {linkedODLs.length > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Hash className="h-3.5 w-3.5 text-indigo-400 cursor-help shrink-0" />
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

                <div className="flex items-center justify-center shrink-0 w-[55px]">
                    <Badge variant="outline" className="text-[9px] font-black px-1.5 h-6 bg-slate-900/40 text-slate-300 border-slate-800 shrink-0 w-full justify-center truncate">
                        {job.qta} PZ
                    </Badge>
                </div>

                {/* Progress Bar Fatto / Previsto -> Residuo */}
                <div className="hidden lg:flex flex-col justify-center gap-0.5 w-[110px] shrink-0">
                    <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-tighter w-full">
                        <span className="text-emerald-500">{fatte.toFixed(1)}h</span>
                        <span className="text-slate-500">/</span>
                        <span className="text-blue-500">{totalLoad.toFixed(1)}h</span>
                        <span className="text-slate-600 mx-0.5 shrink-0">→</span>
                        <span className={cn(isEstimated ? "text-blue-400/80 italic" : "text-red-400")}>{load.toFixed(1)}h</span>
                    </div>
                    <Progress value={totalLoad > 0 ? (fatte / totalLoad) * 100 : 0} className="h-1.5 w-full bg-slate-800 [&>div]:bg-emerald-500" />
                </div>

                {/* Sequence UI */}
                {onUpdateSequence ? (
                    <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md overflow-hidden shrink-0 w-[70px]" onClick={e => e.stopPropagation()}>
                        <div 
                            className="flex items-center justify-center w-5 h-7 bg-slate-900 hover:bg-slate-800 cursor-pointer border-r border-slate-800 transition-colors shrink-0"
                            onClick={() => onUpdateSequence(job.id, (job.dailySequence || 0) + 1)}
                        >
                            <ChevronDown className="h-3 w-3 text-slate-400" />
                        </div>
                        <input 
                            type="number" 
                            className="w-full h-7 bg-transparent text-[10px] font-black text-center text-blue-400 outline-none appearance-none"
                            value={job.dailySequence || 0}
                            onChange={(e) => onUpdateSequence(job.id, parseInt(e.target.value) || 0)}
                        />
                        <div 
                            className="flex items-center justify-center w-5 h-7 bg-slate-900 hover:bg-slate-800 cursor-pointer border-l border-slate-800 transition-colors shrink-0"
                            onClick={() => onUpdateSequence(job.id, (job.dailySequence || 0) - 1)}
                        >
                            <ChevronUp className="h-3 w-3 text-slate-400" />
                        </div>
                    </div>
                ) : <div className="w-[70px] shrink-0" />}

                <div className="flex items-center justify-end gap-1 shrink-0 w-[60px]">
                    <Button 
                        variant="ghost" 
                        className="h-7 w-7 p-0 flex items-center justify-center rounded-lg bg-slate-800/50 text-slate-400 hover:bg-emerald-600 hover:text-white transition-all shrink-0"
                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        className="h-7 w-7 p-0 flex items-center justify-center rounded-lg bg-slate-800/50 text-slate-400 hover:bg-blue-600 hover:text-white transition-all shrink-0"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            if (job.workGroupId) {
                                toast({ title: "Gestito in Gruppo", description: "Dettagli limitati in pianificazione settimanale.", variant: "default" });
                            }
                            onQuickView(); 
                        }}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

