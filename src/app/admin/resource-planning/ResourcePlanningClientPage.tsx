'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Info, AlertTriangle, CheckCircle2, Loader2, Boxes, Factory, Archive, Briefcase, LayoutGrid, Clock, Users, Timer, RefreshCcw } from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { getPlanningData, getDepartmentPlanningSnapshot, getOperatorAssignments } from './actions';
import { migrateDepartments } from './maintenance';
import { endOfWeek } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import GanttBoard from '@/components/production-console/GanttBoard';
import ResourceAssignmentDialog from './ResourceAssignmentDialog';
import { useAuth } from '@/components/auth/AuthProvider';
import WeekKanbanBoard from '@/components/production-console/WeekKanbanBoard';
import { buildMRPTimelines, isJobReadyForProduction, cn } from '@/lib/utils';
import { assignJobToDate } from './actions';
import type { JobOrder, Operator, OperatorAssignment, Department, Article } from '@/lib/mock-data';

export default function ResourcePlanningClientPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const uid = user?.uid || '';
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    // Core Data
    const [data, setData] = useState<{
        jobOrders: JobOrder[],
        operators: Operator[],
        departments: Department[],
        assignments: OperatorAssignment[],
        articles: Article[],
        settings: any,
        rawMaterials?: any[],
        purchaseOrders?: any[],
        manualCommitments?: any[]
    } | null>(null);
    
    // Analysis Snapshot
    const [snapshot, setSnapshot] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<string>('PRODUZIONE');
    const [activeSubTab, setActiveSubTab] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'kanban' | 'split' | 'gantt' | 'list'>('kanban');
    const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);

    useEffect(() => {
        loadData();
    }, [currentDate]);

    async function loadData(force: boolean = false) {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        
        try {
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const [planningData, snap] = await Promise.all([
                getPlanningData(dateStr),
                getDepartmentPlanningSnapshot(dateStr, force)
            ]);
            
            setData(planningData);
            setSnapshot(snap);
            
            // Set initial subtab for Produzione if not set
            if (activeTab === 'PRODUZIONE' && !activeSubTab) {
                const firstProdDept = planningData.departments.find(d => d.macroAreas?.includes('PRODUZIONE'));
                if (firstProdDept) setActiveSubTab(firstProdDept.code);
            }
        } catch (error) {
            toast({ title: 'Errore', description: 'Impossibile caricare i dati di pianificazione.', variant: 'destructive' });
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }

    async function refreshSnapshot(force: boolean = true) {
        setIsRefreshing(true);
        try {
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const sw = startOfWeek(currentDate, { weekStartsOn: 1 });
            const ew = endOfWeek(currentDate, { weekStartsOn: 1 });
            
            const [newAssignments, snap] = await Promise.all([
                getOperatorAssignments(format(sw, 'yyyy-MM-dd'), format(ew, 'yyyy-MM-dd')),
                getDepartmentPlanningSnapshot(dateStr, force)
            ]);
            
            if (data) {
                setData({ ...data, assignments: newAssignments });
            }
            setSnapshot(snap);
        } catch (error) {
            toast({ title: 'Errore', description: 'Ricalcolo capacità fallito.', variant: 'destructive' });
        } finally {
            setIsRefreshing(false);
        }
    }

    const startOfCurrentWeek = startOfWeek(currentDate, { weekStartsOn: 1 });
    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    // Filter jobs by current tab and sub-tab
    const filteredJobs = useMemo(() => {
        if (!data) return [];
        return data.jobOrders.filter(job => {
            // First level: MacroArea
            if (activeTab === 'PREPARAZIONE') {
                return job.status === 'planned' || job.phases?.some((p: any) => p.type === 'preparation');
            }

            if (activeTab === 'QLTY_PACK') {
                return job.phases?.some((p: any) => p.type === 'quality' || p.type === 'packaging');
            }
            if (activeTab === 'PRODUZIONE') {
                if (!activeSubTab) return job.phases?.some((p: any) => p.type === 'production');
                return job.department === activeSubTab;
            }

            return false;
        });
    }, [data, activeTab, activeSubTab]);

    // Filter departments for SUB-TABS (Produzione only)
    const productionDepartments = useMemo(() => {
        if (!data) return [];
        return data.departments.filter(d => d.macroAreas?.includes('PRODUZIONE'));
    }, [data]);

    // Filter operators for the FOCUSED GANTT
    const focusedOperators = useMemo(() => {
        if (!data) return [];
        // Show all if not in a specific department, or filter by current sub-tab
        if (activeTab === 'PRODUZIONE' && activeSubTab) {
            return data.operators.filter(op => 
                op.reparto.includes(activeSubTab) || 
                data.assignments.some((a: any) => a.operatorId === op.id && a.departmentCode === activeSubTab)
            );
        }
        // For Prep or QltyPack, we might show relevant depts
        if (activeTab === 'PREPARAZIONE') return data.operators.filter(op => op.reparto.includes('MAG'));

        if (activeTab === 'QLTY_PACK') return data.operators.filter(op => op.reparto.includes('CG') || op.reparto.includes('MAG') || op.reparto.includes('Collaudo'));
        
        return data.operators;
    }, [data, activeTab, activeSubTab]);

    // Stats for the current selection
    const weekStats = useMemo(() => {
        if (!snapshot || !activeTab) return null;
        
        // If it's PRODUZIONE and we have a subtab, look for that specific dept
        if (activeTab === 'PRODUZIONE' && activeSubTab) {
            const dept = snapshot.macroAreas['PRODUZIONE']?.find((d: any) => d.code === activeSubTab);
            if (!dept) return null;
            const demand = dept.data.reduce((acc: number, d: any) => acc + d.areaSpecificDemand, 0);
            const supply = dept.data.reduce((acc: number, d: any) => acc + d.supplyHours, 0);
            return { demand, supply, balance: supply - demand };
        }

        // Otherwise aggregate for the MacroArea
        const areaDepts = snapshot.macroAreas[activeTab] || [];
        let totalDemand = 0;
        let totalSupply = 0;
        areaDepts.forEach((dept: any) => {
            totalDemand += dept.data.reduce((acc: number, d: any) => acc + (d.areaSpecificDemand || d.demandHours), 0);
            totalSupply += dept.data.reduce((acc: number, d: any) => acc + d.supplyHours, 0);
        });
        return { demand: totalDemand, supply: totalSupply, balance: totalSupply - totalDemand };
    }, [snapshot, activeTab, activeSubTab]);

    // Get current department dependency

    const dependsOnPrep = useMemo(() => {
        if (activeTab !== 'PRODUZIONE' || !activeSubTab) return true;
        const dept = data?.departments.find(d => d.code === activeSubTab);
        return dept?.dependsOnPreparation ?? true;
    }, [data, activeTab, activeSubTab]);

    // MRP Timelines calculation
    const mrpTimelines = useMemo(() => {
        if (!data?.jobOrders || !data?.rawMaterials) return new Map();
        return buildMRPTimelines(
            data.jobOrders,
            data.rawMaterials,
            data.articles,
            data.purchaseOrders || [],
            data.manualCommitments || []
        );
    }, [data]);

    const handleJobDrop = async (jobId: string, assignedDate: string | null) => {
        // Optimistic update
        if (data) {
            const updatedJobs = data.jobOrders.map(j => 
                j.id === jobId ? { ...j, assignedDate: assignedDate || undefined } : j
            );
            setData({ ...data, jobOrders: updatedJobs });
        }

        const res = await assignJobToDate(jobId, assignedDate);
        if (!res.success) {
            toast({ title: 'Errore', description: res.message, variant: 'destructive' });
            // Revert on failure
            loadData(false);
        }
    };

    if (loading && !data) return (

        <div className="flex flex-col items-center justify-center p-24 space-y-4 h-[60vh]">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Inizializzazione Power-Planning Hub...</p>
        </div>
    );

    return (
        <div className="space-y-6 flex flex-col h-full min-h-[calc(100vh-12rem)]">
            {/* --- HEADER SECTION --- */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-card p-4 rounded-xl shadow-sm border">
                <div>
                    <h1 className="text-3xl font-black tracking-tighter uppercase italic text-primary/80">Power-Planning Hub</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold uppercase text-[10px]">Active Production Control</Badge>
                        {snapshot?.isIpothesis && (
                             <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold uppercase text-[10px] animate-pulse">
                                <AlertTriangle className="h-3 w-3 mr-1" /> Dati Ipotetici (Tempi mancanti)
                             </Badge>
                        )}
                        {snapshot?.updatedAt && !isNaN(parseISO(snapshot.updatedAt).getTime()) && (
                            <span className="text-[10px] text-muted-foreground ml-2">Sincronizzato: {format(parseISO(snapshot.updatedAt), 'HH:mm')}</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrevWeek}><ChevronLeft className="h-4 w-4" /></Button>
                        <div className="px-3 font-bold text-xs flex items-center gap-2 min-w-[150px] justify-center">
                            {format(startOfCurrentWeek, 'dd MMM', { locale: it })} - {format(addWeeks(startOfCurrentWeek, 1), 'dd MMM', { locale: it })}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextWeek}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                    
                    <Button variant="outline" size="sm" onClick={() => setIsAssignmentDialogOpen(true)}>
                        <Users className="h-4 w-4 mr-2" />
                        GESTIONE RISORSE
                    </Button>

                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={async () => {
                            if (confirm("Aggiornare lo schema dei reparti (CG -> Connessioni Grandi, etc.)?")) {
                                const res = await migrateDepartments(uid);
                                toast({ title: res.success ? "Successo" : "Errore", description: res.message });
                                if (res.success) loadData(true);
                            }
                        }}
                        className="text-[10px] text-slate-600 hover:text-slate-400"
                    >
                        FIX SCHEMA
                    </Button>

                    <Button 
                        variant="default" 
                        size="sm"
                        className="font-bold shadow-md bg-blue-600 hover:bg-blue-700 h-9" 
                        onClick={() => loadData(true)} 
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                        RICALCOLA
                    </Button>

                    <div className="w-px h-8 bg-border mx-2" />

                    <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg">
                        <Button variant={viewMode === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="h-7 text-[10px] font-bold" onClick={() => setViewMode('kanban')}><LayoutGrid className="mr-1 h-3 w-3" /> SETTIMANA</Button>
                        <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 text-[10px] font-bold" onClick={() => setViewMode('list')}><LayoutGrid className="mr-1 h-3 w-3" /> LISTA</Button>
                        <Button variant={viewMode === 'split' ? 'secondary' : 'ghost'} size="sm" className="h-7 text-[10px] font-bold" onClick={() => setViewMode('split')}><Briefcase className="mr-1 h-3 w-3" /> SPLIT</Button>
                        <Button variant={viewMode === 'gantt' ? 'secondary' : 'ghost'} size="sm" className="h-7 text-[10px] font-bold" onClick={() => setViewMode('gantt')}><Timer className="mr-1 h-3 w-3" /> GANTT</Button>
                    </div>
                </div>
            </div>

            {/* --- MACRO TABS --- */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col gap-4">
                <TabsList className="grid grid-cols-3 w-full max-w-2xl bg-muted/50 p-1 rounded-xl h-12">
                    <TabsTrigger value="PREPARAZIONE" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white font-black text-xs transition-all uppercase tracking-widest gap-2">
                        <Boxes className="h-4 w-4" /> PREPARAZIONE
                    </TabsTrigger>
                    <TabsTrigger value="PRODUZIONE" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white font-black text-xs transition-all uppercase tracking-widest gap-2">
                        <Factory className="h-4 w-4" /> PRODUZIONE
                    </TabsTrigger>
                    <TabsTrigger value="QLTY_PACK" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white font-black text-xs transition-all uppercase tracking-widest gap-2">
                        <Archive className="h-4 w-4" /> QLTY & PACK
                    </TabsTrigger>
                </TabsList>
            
            {data && (
                <ResourceAssignmentDialog 
                    isOpen={isAssignmentDialogOpen}
                onClose={() => {
                    setIsAssignmentDialogOpen(false);
                    refreshSnapshot(true); // Solo snapshot, evita di ricaricare 700+ ordini
                }}
                    operators={data.operators}
                    departments={data.departments}
                    initialAssignments={data.assignments}
                    currentDate={currentDate}
                    uid={uid}
                />
            )}


                {/* --- SUB-TABS (Produzione Only) --- */}
                {activeTab === 'PRODUZIONE' && (
                    <div className="flex flex-wrap items-center gap-2 p-1 bg-muted/20 rounded-lg border border-dashed">
                        {productionDepartments.map(dept => (
                            <Button 
                                key={dept.code} 
                                variant={activeSubTab === dept.code ? 'default' : 'outline'} 
                                size="sm" 
                                className={cn("h-7 text-[10px] font-black uppercase tracking-tight transition-all", activeSubTab === dept.code ? "bg-blue-700 ring-2 ring-blue-200" : "bg-white")}
                                onClick={() => setActiveSubTab(dept.code)}
                            >
                                {dept.name}
                            </Button>
                        ))}

                        {weekStats && (
                            <div className="ml-auto flex items-center gap-4 px-3 py-1 bg-background rounded border shadow-sm">
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-muted-foreground uppercase font-bold">Carico Ore</span>
                                    <span className="text-xs font-black text-red-600">{weekStats.demand.toFixed(1)}h</span>
                                </div>
                                <div className="w-px h-6 bg-border" />
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-muted-foreground uppercase font-bold">Capacità</span>
                                    <span className="text-xs font-black text-emerald-600">{weekStats.supply.toFixed(1)}h</span>
                                </div>
                                <div className="w-px h-6 bg-border" />
                                <div className="flex flex-col">
                                    <span className="text-[8px] text-muted-foreground uppercase font-bold">Bilancio</span>
                                    <span className={cn("text-xs font-black", weekStats.balance < 0 ? "text-red-600" : "text-emerald-600")}>
                                        {weekStats.balance > 0 ? '+' : ''}{weekStats.balance.toFixed(1)}h
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}


                {/* --- MAIN CONTENT AREA --- */}
                <div className={cn(
                    "grid gap-4 flex-1 transition-all duration-500",
                    viewMode === 'split' ? "grid-cols-1 xl:grid-cols-12" : "grid-cols-1"
                )}>
                    
                    {/* --- ODL LIST (LEFT PANE) --- */}
                    {(viewMode === 'list' || viewMode === 'split') && (
                        <Card className={cn("overflow-hidden flex flex-col shadow-xl", viewMode === 'split' ? "xl:col-span-4 h-[70vh]" : "h-full")}>
                            <CardHeader className="py-3 px-4 bg-muted/10 border-b flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-sm font-black flex items-center gap-2">
                                        <ListCheckIcon /> LISTA ODL {activeTab}
                                        <Badge variant="secondary" className="h-5 text-[10px] font-bold">{filteredJobs.length}</Badge>
                                    </CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 flex-1 overflow-hidden">
                                <ScrollArea className="h-full p-4">
                                    <div className="space-y-3">
                                        {filteredJobs.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-full pt-20 text-muted-foreground opacity-50">
                                                <Boxes className="h-10 w-10 mb-2" />
                                                <p className="text-xs italic">Nessuna commessa attiva in quest'area.</p>
                                            </div>
                                        ) : (
                                            filteredJobs.map(job => (
                                                <ODLPlanningCard 
                                                    key={job.id} 
                                                    job={job} 
                                                    isReady={isJobReadyForProduction(job, dependsOnPrep)} 
                                                    articles={data?.articles || []}
                                                    activeTab={activeTab}
                                                    activeSubTab={activeSubTab}
                                                />
                                            ))


                                        )}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    )}

                    {/* --- KANBAN BOARD (FULL WIDTH) --- */}
                    {viewMode === 'kanban' && (
                        <div className="h-[75vh]">
                            <WeekKanbanBoard 
                                jobOrders={filteredJobs}
                                articles={data?.articles || []}
                                snapshot={snapshot}
                                activeTab={activeTab}
                                activeSubTab={activeSubTab}
                                currentWeekStart={startOfCurrentWeek}
                                rawMaterials={data?.rawMaterials || []}
                                mrpTimelines={mrpTimelines}
                                onJobDrop={handleJobDrop}
                            />
                        </div>
                    )}

                    {/* --- GANTT (RIGHT PANE) --- */}
                    {(viewMode === 'gantt' || viewMode === 'split') && (
                        <div className={cn("flex flex-col gap-4", viewMode === 'split' ? "xl:col-span-8" : "h-full")}>
                           <GanttBoard 
                             jobOrders={filteredJobs} 
                             operators={focusedOperators} 
                             assignments={data?.assignments || []} 
                             settings={data?.settings || {}} 
                             articles={data?.articles || []}
                             timelineStartProp={currentDate}
                           />
                        </div>
                    )}
                </div>
            </Tabs>
        </div>
    );
}

function ListCheckIcon() {
    return <LayoutGrid className="h-4 w-4 text-primary" />;
}

function ODLPlanningCard({ job, isReady, articles, activeTab, activeSubTab }: { job: JobOrder, isReady: boolean, articles: Article[], activeTab: string, activeSubTab: string | null }) {
    const totalPhases = job.phases?.length || 1;
    const completedPhases = job.phases?.filter((p: any) => p.status === 'completed').length || 0;
    const progress = (completedPhases / totalPhases) * 100;

    // Calculate hours for the relevant phases in this macroarea/dept
    const { hours, isIpothesis } = useMemo(() => {
        if (!job.details) return { hours: 0, isIpothesis: false };
        const article = articles.find(a => a.code.toUpperCase() === job.details.toUpperCase());
        
        let hasUsedFallback = false;
        if (!article || !article.phaseTimes) hasUsedFallback = true;

        const relevantPhases = (job.phases || []).filter((p: any) => {
            if (activeTab === 'PREPARAZIONE') return p.type === 'preparation';
            if (activeTab === 'QLTY_PACK') return p.type === 'quality' || p.type === 'packaging';
            if (activeTab === 'PRODUZIONE') {
                if (!activeSubTab) return p.type === 'production';
                return p.type === 'production' && job.department === activeSubTab;
            }

            return false;
        });

        const totalMinutes = relevantPhases.reduce((acc: number, phase: any) => {
            const phaseTimeObj = article?.phaseTimes?.[phase.name];
            if (!phaseTimeObj) hasUsedFallback = true;
            const time = phaseTimeObj?.expectedMinutesPerPiece || 10;
            return acc + (time * job.qta);
        }, 0);

        return { hours: totalMinutes / 60, isIpothesis: hasUsedFallback };
    }, [job, articles, activeTab, activeSubTab]);

    return (
        <Card className="hover:shadow-lg transition-all cursor-pointer border-l-4 border-l-primary group bg-white">
            <CardContent className="p-3 space-y-3">
                <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-800">{job.ordinePF}</span>
                            <Badge variant="outline" className="text-[9px] h-4 leading-none bg-slate-50 font-mono">{job.numeroODLInterno || '-'}</Badge>
                        </div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{job.details} — {job.cliente}</p>
                    </div>
                    {isReady ? (
                        <div className="bg-emerald-500 text-white rounded-full p-1 shadow-sm"><CheckCircle2 className="h-4 w-4" /></div>
                    ) : (
                        <div className="bg-amber-500/20 text-amber-600 rounded-full p-1"><Clock className="h-4 w-4" /></div>
                    )}
                </div>

                <div className="flex items-center gap-4 text-[10px] font-bold text-muted-foreground">
                    <div className="flex items-center gap-1"><Boxes className="h-3 w-3" /> QTA: {job.qta}</div>
                    <div className="flex items-center gap-2 text-primary">
                        <div className="flex items-center gap-1">
                            <Timer className="h-3 w-3" /> {hours.toFixed(1)}h
                        </div>
                        {isIpothesis && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge variant="outline" className="h-4 px-1 bg-amber-50 text-amber-600 border-amber-200 text-[8px] animate-pulse">
                                            TEMPO IPOTETICO
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p className="text-[10px]">Tempi mancanti in anagrafica articolo. Usato valore di default (10m/pezzo).</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                    {job.dataConsegnaFinale && (
                        <div className={cn("flex items-center gap-1", isReady ? "text-emerald-600" : "text-amber-600")}>
                            <CalendarIcon className="h-3 w-3" /> {format(parseISO(job.dataConsegnaFinale), 'dd/MM')}
                        </div>
                    )}
                </div>

                <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                        <span className="text-muted-foreground uppercase">Avanzamento</span>
                        <span>{completedPhases}/{totalPhases} FASI</span>
                    </div>
                    <Progress value={progress} className="h-1.5 bg-slate-100" />
                </div>
            </CardContent>
        </Card>
    );
}

