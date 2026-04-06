'use client';

import React, { useState, useMemo } from 'react';
import { format, addWeeks, startOfWeek, getWeek, parseISO, isSameWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from "@/components/ui/progress";
import { Button } from '@/components/ui/button';
import { Users, Timer, Info, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Boxes, Package, Factory, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

import type { JobOrder, Operator, Department, Article } from '@/types';
import { advanceJobStatus } from './weekly-actions';
import { useToast } from '@/hooks/use-toast';

interface WeeklyCapacityBoardProps {
    jobOrders: JobOrder[];
    operators: Operator[];
    departments: Department[];
    articles: Article[];
    allocations: Record<string, string[]>; // docId -> operatorIds
    currentDate: Date;
    onStatusAdvance: (jobId: string) => void;
    onManageAllocations: (deptId: string, week: number, year: number) => void;
}

export default function WeeklyCapacityBoard({
    jobOrders,
    operators,
    departments,
    articles,
    allocations,
    currentDate,
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

    const allDisplayDepts = [...coreDepts, ...satelliteDepts];

    const getJobLoadInDept = (job: JobOrder, deptId: string) => {
        const article = articles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;

        let relevantPhases: string[] = [];
        if (deptId === 'PREP') {
            relevantPhases = ['Taglio', 'Preparazione', 'Cavitazione'];
        } else if (deptId === 'PACK') {
            relevantPhases = ['Qualità', 'Imballaggio', 'Fornitura'];
        } else {
            // Reparti Core
            relevantPhases = Object.keys(article.phaseTimes || {}).filter(p => !['Taglio', 'Preparazione', 'Qualità', 'Imballaggio'].includes(p));
            if (job.department !== deptId) return 0;
        }

        const totalMins = relevantPhases.reduce((acc, pName) => {
            const time = article.phaseTimes?.[pName]?.expectedMinutesPerPiece || 0;
            return acc + (time * job.qta);
        }, 0);

        return totalMins / 60;
    };

    return (
        <div className="flex flex-col gap-6 p-6 bg-slate-100 rounded-[2rem] border-2 border-slate-200 shadow-inner overflow-x-auto min-h-[85vh]">
            <div className="flex gap-6 min-w-max pb-4">
                {allDisplayDepts.map(dept => {
                    const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                    
                    return (
                        <div key={dept.id} className={cn(
                            "flex flex-col w-[400px] gap-6 p-6 rounded-3xl border-2 transition-all shadow-sm",
                            isSatellite ? "bg-amber-50/50 border-amber-200/50" : "bg-white border-slate-200"
                        )}>
                            {/* Header Reparto */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("p-2 rounded-xl text-white shadow-md", isSatellite ? "bg-amber-500" : "bg-blue-600")}>
                                            {isSatellite ? (dept as any).icon : <Factory className="h-5 w-5" />}
                                        </div>
                                        <h2 className="text-lg font-black uppercase tracking-tighter text-slate-900">{dept.name}</h2>
                                    </div>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={cn("h-full w-1/4", isSatellite ? "bg-amber-300" : "bg-blue-300")} />
                                </div>
                            </div>

                            {/* Settimane */}
                            <div className="space-y-4">
                                {weeks.map(week => {
                                    const allocationKey = `${week.year}_${week.weekNum}_${dept.id}`;
                                    const assignedOperatorIds = allocations[allocationKey] || [];
                                    const capacityHours = assignedOperatorIds.length * 40;
                                    const weekStartDateStr = format(week.start, 'yyyy-MM-dd');
                                    
                                    const weekJobs = jobOrders.filter(job => {
                                        if (!job.assignedDate) return false;
                                        const jobDate = parseISO(job.assignedDate);
                                        const isInWeek = isSameWeek(jobDate, week.start, { weekStartsOn: 1 });
                                        if (!isInWeek) return false;

                                        if (isSatellite) return getJobLoadInDept(job, dept.id) > 0;
                                        return job.department?.toUpperCase() === dept.id.toUpperCase() || job.department === (dept as any).code;
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
                                                        "group border-2 transition-all duration-300 rounded-2xl overflow-hidden shadow-sm",
                                                        snapshot.isDraggingOver ? "bg-blue-50 border-blue-600 shadow-blue-100 scale-[1.01]" : "bg-white border-slate-100",
                                                        isOverloaded ? "border-red-300 bg-red-50/20 shadow-red-50" : ""
                                                    )}
                                                >
                                                    <CardHeader className="p-4 bg-slate-50 border-b flex flex-row items-center justify-between gap-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{week.label}</span>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="sm" 
                                                                    className="h-7 px-2 hover:bg-blue-600 hover:text-white rounded-lg gap-2 text-slate-400 font-black text-[10px] uppercase transition-all"
                                                                    onClick={() => onManageAllocations(dept.id, week.weekNum, week.year)}
                                                                >
                                                                    <Users className="h-3 w-3" />
                                                                    {assignedOperatorIds.length} Opt.
                                                                </Button>
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
                                                    <CardContent className="p-3 space-y-3 min-h-[120px] bg-white/50">
                                                        {weekJobs.map((job, index) => (
                                                            <Draggable key={job.id} draggableId={job.id} index={index}>
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
                                                        ))}
                                                        {provided.placeholder}
                                                    </CardContent>
                                                </Card>
                                            )}
                                        </Droppable>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function JobCompactCard({ job, load, onAdvance, innerRef, provided, isDragging }: { job: JobOrder, load: number, onAdvance: () => void, innerRef: any, provided: any, isDragging: boolean }) {
    const statusColors: Record<string, string> = {
        'DA_INIZIARE': 'bg-slate-400',
        'IN_PREPARAZIONE': 'bg-amber-400',
        'PRONTO_PROD': 'bg-emerald-400',
        'IN_PRODUZIONE': 'bg-blue-500',
        'FINE_PRODUZIONE': 'bg-purple-500',
        'QLTY_PACK': 'bg-pink-500',
        'CHIUSO': 'bg-slate-900'
    };

    return (
        <Card 
            ref={innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={cn(
                "p-3 bg-white border-2 border-slate-100 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group relative overflow-hidden",
                isDragging && "shadow-2xl border-blue-600 scale-[1.05] z-50"
            )}
        >
            <div className={cn("absolute left-0 top-0 bottom-0 w-1", statusColors[job.status] || 'bg-slate-200')} />
            <div className="flex flex-col gap-2 pl-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-tight truncate pr-4">{job.ordinePF}</span>
                    <Badge variant="outline" className="text-[8px] px-1 h-4 bg-slate-50 text-slate-600 border-slate-200 font-bold whitespace-nowrap">
                        {job.qta} PZ
                    </Badge>
                </div>
                <div className="flex items-center justify-between gap-1">
                    <p className="text-[9px] font-bold text-slate-400 uppercase truncate max-w-[140px] italic">{job.cliente}</p>
                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-blue-50 rounded-md border border-blue-100">
                        <Timer className="h-3 w-3 text-blue-500" />
                        <span className="text-[10px] font-black text-blue-700">{load.toFixed(1)}h</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-50">
                    <div className={cn("h-2 w-2 rounded-full shadow-sm", statusColors[job.status] || 'bg-slate-300')} />
                    <span className="text-[8px] font-black uppercase text-slate-800 tracking-tighter">{job.status?.replace('_', ' ')}</span>
                    
                    <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 transition-all hover:bg-blue-600 hover:text-white rounded-md"
                        onClick={(e) => { e.stopPropagation(); onAdvance(); }}
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </Card>
    );
}
