'use client';

import React, { useState, useMemo } from 'react';
import { format, addWeeks, startOfWeek, endOfWeek, getWeek, parseISO, isSameWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from "@/components/ui/progress";
import { Button } from '@/components/ui/button';
import { Users, Timer, Info, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Boxes, Package, Factory, Scissors, Calendar, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

import type { JobOrder, Operator, Department, Article } from '@/types';
import { advanceJobStatus } from './weekly-actions';
import { useToast } from '@/hooks/use-toast';

interface WeeklyCapacityBoardProps {
    jobOrders: JobOrder[];
    operators: Operator[];
    departments: Department[];
    articles: Article[];
    allocations: Record<string, { operatorId: string, hours: number }[]>; 
    phaseTemplates: any[];
    currentDate: Date;
    weeklyLimit: number;
    onStatusAdvance: (jobId: string) => void;
    onManageAllocations: (deptId: string, week: number, year: number) => void;
}

export default function WeeklyCapacityBoard({
    jobOrders,
    operators,
    departments,
    articles,
    allocations,
    phaseTemplates,
    currentDate,
    weeklyLimit,
    onStatusAdvance,
    onManageAllocations
}: WeeklyCapacityBoardProps) {
    const { toast } = useToast();
    const [numWeeks] = useState(4);

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
        // Filtriamo i template attivi nel ciclo dell'articolo
        const activeTemplates = phaseTemplates.filter(t => phaseTimes[t.id]?.enabled !== false && (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0);

        let relevantTemplates = [];
        if (deptId === 'PREP') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'preparation');
        } else if (deptId === 'PACK') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'quality' || t.type === 'packaging');
        } else {
            // Reparti Core: solo fasi di produzione E matching del reparto principale della commessa
            relevantTemplates = activeTemplates.filter(t => t.type === 'production');
            
            // Per i reparti CORE, filtriamo anche per appartenenza
            const jobDept = job.department?.toUpperCase() || '';
            const dCode = (departments.find(d => d.id === deptId) as any)?.code?.toUpperCase() || '';
            const dName = (departments.find(d => d.id === deptId) as any)?.name?.toUpperCase() || '';
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
                <div className="flex justify-between items-center mb-6 overflow-x-auto pb-2">
                    <TabsList className="bg-slate-950 h-14 p-1 rounded-2xl border border-slate-800">
                        {allDisplayDepts.map(dept => {
                            const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                            const tColors = getColors(dept.id, (dept as any).code);
                            return (
                                <TabsTrigger 
                                    key={dept.id} 
                                    value={dept.id} 
                                    className={cn("h-full px-6 rounded-xl font-black uppercase text-xs tracking-widest flex items-center gap-2 transition-all", tColors.tab)}
                                >
                                    {isSatellite ? (dept as any).icon : <Factory className="h-4 w-4" />}
                                    {dept.name}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </div>

                {allDisplayDepts.map(dept => {
                    const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                    const colors = getColors(dept.id, (dept as any).code);
                    
                    return (
                        <TabsContent key={dept.id} value={dept.id} className="mt-0 outline-none">
                            <div className={cn("grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 rounded-3xl border transition-all", colors.bg, colors.border)}>
                                {weeks.map(week => {
                                    const allocationKey = `${week.year}_${week.weekNum}_${dept.id}`;
                                    const weekAssignments = allocations[allocationKey] || [];
                                    const capacityHours = weekAssignments.reduce((acc, a) => acc + a.hours, 0);
                                    const weekStartDateStr = format(week.start, 'yyyy-MM-dd');
                                    
                                    const weekJobs = jobOrders.filter(job => {
                                        const jobDateStr = job.dataConsegnaFinale?.trim();
                                        if (!jobDateStr || jobDateStr === 'N/D') return false;
                                        const jobDate = parseISO(jobDateStr);
                                        if (isNaN(jobDate.getTime())) return false;
                                        
                                        const isSame = isSameWeek(jobDate, week.start, { weekStartsOn: 1 });
                                        const isFirstWeek = isSameWeek(week.start, currentDate, { weekStartsOn: 1 });
                                        const isPast = jobDate < startOfWeek(currentDate, { weekStartsOn: 1 });
                                        const normalizedStatus = job.status?.toUpperCase() || '';
                                        const isClosed = ['CHIUSO', 'COMPLETATA', 'COMPLETED', 'FINE_PRODUZIONE', 'CONCLUSA', 'CONCLUSI'].includes(normalizedStatus);
                                        
                                        const isApplicable = isClosed ? isSame : (isSame || (isPast && isFirstWeek));
                                        if (!isApplicable) return false;

                                        if (isSatellite) return getJobLoadInDept(job, dept.id) > 0;
                                        
                                        const jobDept = job.department?.toUpperCase() || '';
                                        const dCode = (dept as any).code?.toUpperCase() || '';
                                        const dName = (dept as any).name?.toUpperCase() || '';
                                        const dId = dept.id.toUpperCase();
                                        
                                        return jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept);
                                    });

                                    const totalLoad = weekJobs.reduce((acc, job) => acc + getJobLoadInDept(job, dept.id), 0);
                                    const isOverloaded = capacityHours > 0 && totalLoad > capacityHours;

                                    return (
                                        <Droppable key={`${dept.id}|${weekStartDateStr}`} droppableId={`${dept.id}|${weekStartDateStr}`}>
                                            {(provided, snapshot) => (
                                                <Card 
                                                    ref={provided.innerRef}
                                                    {...provided.droppableProps}
                                                    className={cn(
                                                        "group border transition-all duration-300 rounded-2xl overflow-hidden shadow-sm flex flex-col h-full",
                                                        snapshot.isDraggingOver ? "bg-slate-800 border-blue-600 shadow-lg shadow-blue-900/50 scale-[1.01]" : "bg-slate-900 border-slate-800",
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
                                                    <CardContent className="p-3 space-y-3 min-h-[120px] bg-transparent flex-1">
                                                        {weekJobs.map((job, index) => {
                                                            const isClosedCard = ['CHIUSO', 'COMPLETATA', 'COMPLETED', 'FINE_PRODUZIONE', 'CONCLUSA', 'CONCLUSI'].includes(job.status?.toUpperCase() || '');
                                                            return (
                                                             <Draggable key={job.id} draggableId={job.id} index={index} isDragDisabled={isClosedCard}>
                                                                {(provided, dSnapshot) => (
                                                                    <JobCompactCard 
                                                                        job={job} 
                                                                        load={getJobLoadInDept(job, dept.id)} 
                                                                        onAdvance={() => onStatusAdvance(job.id)}
                                                                        innerRef={provided.innerRef}
                                                                        provided={provided}
                                                                        isDragging={dSnapshot.isDragging}
                                                                    />
                                                                )}
                                                             </Draggable>
                                                            );
                                                        })}
                                                        {provided.placeholder}
                                                    </CardContent>
                                                </Card>
                                            )}
                                        </Droppable>
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

function JobCompactCard({ job, load, onAdvance, innerRef, provided, isDragging }: { job: JobOrder, load: number, onAdvance: () => void, innerRef: any, provided: any, isDragging: boolean }) {
    const statusColors: Record<string, string> = {
        'DA_INIZIARE': 'bg-slate-400',
        'IN_PREPARAZIONE': 'bg-amber-400',
        'PRONTO_PROD': 'bg-emerald-400',
        'IN_PRODUZIONE': 'bg-blue-500',
        'FINE_PRODUZIONE': 'bg-green-600',
        'COMPLETATA': 'bg-green-600',
        'COMPLETED': 'bg-green-600',
        'QLTY_PACK': 'bg-pink-500',
        'CHIUSO': 'bg-emerald-900'
    };

    const isClosed = ['CHIUSO', 'COMPLETATA', 'COMPLETED', 'FINE_PRODUZIONE', 'CONCLUSA', 'CONCLUSI'].includes(job.status?.toUpperCase() || '');
    
    // Formattazione data visiva
    let formattedDate = 'N/D';
    if (job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D') {
        try { formattedDate = format(parseISO(job.dataConsegnaFinale), 'dd/MM/yyyy'); } catch (e) {}
    }

    return (
        <Card 
            ref={innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={cn(
                "p-3 border shadow-sm transition-all group relative overflow-hidden",
                isClosed ? "bg-emerald-950/20 border-emerald-900/40 opacity-70" : "bg-slate-900 border-slate-800 hover:shadow-lg hover:border-slate-600",
                isDragging && "shadow-2xl shadow-blue-900/50 border-blue-600 scale-[1.05] z-50 bg-slate-800"
            )}
        >
            <div className={cn("absolute left-0 top-0 bottom-0 w-1", statusColors[job.status?.toUpperCase()] || 'bg-slate-600')} />
            <div className="flex flex-col gap-2 pl-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-200 uppercase tracking-tight truncate pr-4">{job.ordinePF}</span>
                    <Badge variant="outline" className={cn("text-[8px] px-1 h-4 font-bold whitespace-nowrap", isClosed ? "bg-emerald-950 text-emerald-500 border-emerald-900/50" : "bg-slate-950 text-slate-400 border-slate-800")}>
                        {job.qta} PZ
                    </Badge>
                </div>
                
                {/* Dettagli Aggiuntivi: Codice Articolo e Data Consegna */}
                <div className="flex items-center justify-between mt-0.5">
                    <div className="flex items-center gap-1 min-w-0">
                        <Hash className="h-3 w-3 text-slate-600 shrink-0" />
                        <span className="text-[9px] font-bold text-slate-400 uppercase truncate">{job.details || 'N/D'}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                        <Calendar className="h-3 w-3 text-indigo-500" />
                        <span className="text-[9px] font-bold text-indigo-400">{formattedDate}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-[9px] font-bold text-slate-500 uppercase truncate max-w-[140px] italic">{job.cliente}</p>
                    <div className={cn("flex items-center gap-1.5 px-1.5 py-0.5 rounded-md border shrink-0", isClosed ? "bg-emerald-950/50 border-emerald-900/50" : "bg-slate-950 border-slate-800")}>
                        <Timer className={cn("h-3 w-3", isClosed ? "text-emerald-500" : "text-blue-500")} />
                        <span className={cn("text-[10px] font-black", isClosed ? "text-emerald-400" : "text-blue-400")}>{load.toFixed(1)}h</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-800/50">
                    <div className={cn("h-2 w-2 rounded-full shadow-sm shrink-0", statusColors[job.status?.toUpperCase()] || 'bg-slate-600')} />
                    <span className={cn("text-[8px] font-black uppercase tracking-tighter truncate", isClosed ? "text-emerald-500" : "text-slate-400")}>{job.status?.replace('_', ' ')}</span>
                    
                    {!isClosed && (
                        <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-all hover:bg-slate-800 hover:text-white text-slate-500 rounded-md"
                            onClick={(e) => { e.stopPropagation(); onAdvance(); }}
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    );
}
