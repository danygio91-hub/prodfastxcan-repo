'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    Calendar as CalendarIcon, 
    ChevronLeft, 
    ChevronRight, 
    Loader2, 
    RefreshCcw, 
    LayoutGrid, 
    Settings2, 
    Zap
} from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, getWeek, parseISO, isSameWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import { getOverallStatus } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

import { useMasterData } from '@/contexts/MasterDataProvider';
import { useAuth } from '@/components/auth/AuthProvider';

import WeeklyCapacityBoard from './WeeklyCapacityBoard';
import MasterConsole from './MasterConsole';
import OperatorSkillLoanDialog from './OperatorSkillLoanDialog';
import BacklogDrawer from './BacklogDrawer';
import { 
    getWeeklyBoardData, 
    saveWeeklyAllocation, 
    advanceJobStatus, 
    migrateJobOrderStatuses, 
    getPlanningWorkPhaseTemplates,
    saveMassiveAllocation
} from './weekly-actions';
import { updateJobDeliveryDate, updateJobDepartment, forceCloseAndExclude } from './actions';
import MassiveAllocationDialog from './MassiveAllocationDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { DragDropContext, DropResult } from '@hello-pangea/dnd';

export default function ResourcePlanningClientPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const uid = user?.uid || '';
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeView, setActiveView] = useState<'board' | 'console'>('board');
    const [isBacklogOpen, setIsBacklogOpen] = useState(false);
    
    const { 
        operators: cachedOperators, 
        articles: cachedArticles, 
        departments: cachedDepartments, 
        isLoading: isMasterLoading 
    } = useMasterData();
    
    const [boardData, setBoardData] = useState<{
        jobOrders: any[],
        unassignedJobs: any[],
        allocations: Record<string, { operatorId: string, hours: number }[]>,
        settings?: any
    }>({ jobOrders: [], unassignedJobs: [], allocations: {} });
    const [phaseTemplates, setPhaseTemplates] = useState<any[]>([]);

    const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false);
    const [isMassiveDialogOpen, setIsMassiveDialogOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<{ deptId: string, week: number, year: number } | null>(null);
    const [pendingMove, setPendingMove] = useState<{jobId: string, dateStr: string, deptId: string, suggestedDate: string} | null>(null);

    const planningOperators = useMemo(() => {
        return cachedOperators.filter(op => op.role !== 'admin' && op.isReal !== false);
    }, [cachedOperators]);

    const currentYear = currentDate.getFullYear();
    const currentWeek = getWeek(currentDate, { weekStartsOn: 1 });

    const displayDepts = useMemo(() => {
        const core = cachedDepartments.filter(d => 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes(d.id.toUpperCase()) || 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes((d as any).code?.toUpperCase() || '')
        );
        const identified = core.length > 0 ? core : cachedDepartments.filter(d => d.macroAreas?.includes('PRODUZIONE'));
        
        return [
            { id: 'PREP', name: 'PREPARAZIONE' },
            ...identified,
            { id: 'PACK', name: 'PACK & QLTY' }
        ];
    }, [cachedDepartments]);

    const weeklyLimitHours = useMemo(() => {
        const percent = boardData.settings?.capacityBufferPercent || 85;
        // 8 ore * percentuale * 5 giorni lavorativi
        return Math.round((8 * (percent / 100)) * 5);
    }, [boardData.settings]);

    // Migrazione automatica all'avvio
    useEffect(() => {
        if (uid) {
            migrateJobOrderStatuses(uid).then(res => {
                if (res.success && res.count && res.count > 0) {
                    toast({ title: "Dati Sincronizzati", description: `${res.count} commesse aggiornate alla nuova pipeline.` });
                }
            });
        }
    }, [uid]);

    const [globalMetrics, setGlobalMetrics] = useState({ load: 0, capacity: 0 });

    const getJobLoadLocal = (job: any, deptId: string) => {
        const article = cachedArticles.find(a => a.code.toUpperCase() === job.details?.toUpperCase());
        if (!article) return 0;
        
        const phaseTimes = article.phaseTimes || {};
        const activeTemplates = phaseTemplates.filter(t => phaseTimes[t.id]?.enabled !== false && (phaseTimes[t.id]?.expectedMinutesPerPiece || 0) > 0);
        
        let relevantTemplates = [];
        if (deptId === 'PREP') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'preparation');
        } else if (deptId === 'PACK') {
            relevantTemplates = activeTemplates.filter(t => t.type === 'quality' || t.type === 'packaging');
        } else {
            // Reparti Core
            relevantTemplates = activeTemplates.filter(t => t.type === 'production');
            
            const jobDept = job.department?.toUpperCase() || '';
            const targetDept = cachedDepartments.find(d => d.id === deptId);
            const dCode = targetDept?.code?.toUpperCase() || '';
            const dName = targetDept?.name?.toUpperCase() || '';
            const dId = deptId.toUpperCase();
            
            const isMatchingDept = jobDept === dId || jobDept === dCode || jobDept === dName || dName.includes(jobDept);
            if (!isMatchingDept) return 0;
        }
        
        return relevantTemplates.reduce((acc, t) => acc + (phaseTimes[t.id].expectedMinutesPerPiece * job.qta), 0) / 60;
    };

    useEffect(() => {
        loadData();
    }, [currentDate]);

    useEffect(() => {
        const wNum = getWeek(currentDate, { weekStartsOn: 1 });
        const year = currentDate.getFullYear();
        let cap = 0;
        Object.keys(boardData.allocations).forEach(k => {
            if (k.startsWith(`${year}_${wNum}_`)) {
                cap += boardData.allocations[k].reduce((acc, a) => acc + a.hours, 0);
            }
        });

        let load = 0;
        const currentWStart = startOfWeek(currentDate, { weekStartsOn: 1 });
        
        // Unifichiamo la logica di identificazione dei reparti con quella del tabellone
        const coreDepts = cachedDepartments.filter(d => 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes(d.id.toUpperCase()) || 
            ['PICCOLE', 'GRANDI', 'BARRE'].includes(d.code?.toUpperCase() || '') ||
            d.macroAreas?.includes('PRODUZIONE')
        );
        const depts = [...coreDepts, {id: 'PREP'}, {id: 'PACK'}];
        
        boardData.jobOrders.forEach(job => {
            const displayStatus = getOverallStatus(job);
            const isClosed = displayStatus === 'CHIUSO';
            
            let refDate = job.dataConsegnaFinale && job.dataConsegnaFinale !== 'N/D' 
                ? parseISO(job.dataConsegnaFinale) 
                : null;
                
            if (isClosed && job.overallEndTime) {
                refDate = new Date(job.overallEndTime);
            }

            if ((!refDate || isNaN(refDate.getTime())) && !isClosed) {
                refDate = currentWStart;
            }

            if (!refDate || isNaN(refDate.getTime())) return;

            const naturalWeekStart = startOfWeek(refDate, { weekStartsOn: 1 });
            const isOverdue = !isClosed && refDate < currentWStart;

            let assignedWeekStart: Date;
            if (isOverdue) {
                assignedWeekStart = currentWStart;
            } else {
                assignedWeekStart = naturalWeekStart;
            }

            if (isSameWeek(currentWStart, assignedWeekStart, { weekStartsOn: 1 })) {
                depts.forEach(d => {
                    load += getJobLoadLocal(job, d.id);
                });
            }
        });
        setGlobalMetrics({ load, capacity: cap });
    }, [currentDate, boardData, cachedArticles, cachedDepartments]);

    async function loadData(force: boolean = false) {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        
        try {
            const week = getWeek(currentDate, { weekStartsOn: 1 });
            const year = currentDate.getFullYear();
            
            const data = await getWeeklyBoardData(year, week);
            const templates = await getPlanningWorkPhaseTemplates();
            setPhaseTemplates(templates);
            setBoardData(data);
        } catch (error) {
            toast({ title: 'Errore', description: 'Impossibile caricare i dati settimanali.', variant: 'destructive' });
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }

    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    const handleJobMove = async (jobId: string, confirmedDate: string, targetDeptId?: string) => {
        const jobToMove = [...boardData.jobOrders, ...boardData.unassignedJobs].find(j => j.id === jobId);
        if (!jobToMove) return;

        const updatedAssigned = [...boardData.jobOrders.filter(j => j.id !== jobId), { ...jobToMove, dataConsegnaFinale: confirmedDate, department: targetDeptId || jobToMove.department }];
        const updatedUnassigned = boardData.unassignedJobs.filter(j => j.id !== jobId);
        
        setBoardData({ ...boardData, jobOrders: updatedAssigned, unassignedJobs: updatedUnassigned });
        setPendingMove(null);

        const res = await updateJobDeliveryDate(jobId, confirmedDate);
        if (!res.success) toast({ title: 'Errore Spostamento', description: res.message, variant: 'destructive' });

        if (targetDeptId && targetDeptId !== jobToMove.department && !['PREP', 'PACK'].includes(targetDeptId)) {
            const res2 = await updateJobDepartment(jobId, targetDeptId);
            if (!res2.success) toast({ title: 'Errore Spostamento Reparto', description: res2.message, variant: 'destructive' });
        }
        loadData();
    };

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const jobId = result.draggableId;
        const destId = result.destination.droppableId;
        if (destId === 'BACKLOG') return;

        const [deptId, dateStr] = destId.split('|');
        if (dateStr) {
            const dropWeekStart = parseISO(dateStr);
            const fridayDate = format(new Date(dropWeekStart.getFullYear(), dropWeekStart.getMonth(), dropWeekStart.getDate() + 4), 'yyyy-MM-dd');
            setPendingMove({ jobId, dateStr, deptId, suggestedDate: fridayDate });
        }
    };

    const handleExcludeJob = async (jobId: string) => {
        if(confirm("Sei sicuro di voler chiudere ed escludere questa commessa dalla packing list?")) {
            setBoardData(prev => ({
                ...prev,
                unassignedJobs: prev.unassignedJobs.filter(j => j.id !== jobId),
                jobOrders: prev.jobOrders.filter(j => j.id !== jobId)
            }));
            const res = await forceCloseAndExclude(jobId, uid);
            if(res.success) toast({ title: "Sanatoria eseguita", description: "Commessa chiusa ed esclusa." });
            else { toast({ title: "Errore", description: res.message, variant: "destructive" }); loadData(); }
        }
    };

    const handleStatusAdvance = async (jobId: string) => {
        const res = await advanceJobStatus(jobId);
        if (res.success) {
            toast({ title: 'Stato avanzato', description: `Commessa ora in ${res.newStatus}` });
            const updatedJobs = boardData.jobOrders.map(j => 
                j.id === jobId ? { ...j, status: res.newStatus } : j
            );
            const updatedUnassigned = boardData.unassignedJobs.map(j => 
                j.id === jobId ? { ...j, status: res.newStatus } : j
            );
            setBoardData({ ...boardData, jobOrders: updatedJobs, unassignedJobs: updatedUnassigned });
        }
    };

    const handleLoanSelect = async (operatorId: string, hours: number) => {
        if (!selectedSlot) return;
        const { deptId, week, year } = selectedSlot;
        
        const key = `${year}_${week}_${deptId}`;
        const currentAssignments = boardData.allocations[key] || [];
        
        // Se già presente, aggiorniamo le ore? Per ora seguiamo il desiderio del "+" che aggiunge.
        // Se esisteva già lo stesso operatore nello stesso reparto, lo sovrascriviamo o segnaliamo.
        let newAssignments = [...currentAssignments];
        const existingIdx = newAssignments.findIndex(a => a.operatorId === operatorId);
        if (existingIdx >= 0) {
            newAssignments[existingIdx] = { ...newAssignments[existingIdx], hours };
        } else {
            newAssignments.push({ operatorId, hours });
        }
        
        const res = await saveWeeklyAllocation(year, week, deptId, newAssignments, uid);
        if (res.success) {
            setBoardData(prev => ({
                ...prev,
                allocations: {
                    ...prev.allocations,
                    [key]: newAssignments
                }
            }));
            setIsLoanDialogOpen(false);
            toast({ title: "Incarico salvato", description: `Operatore assegnato con ${hours} ore.` });
        }
    };

    const handleMassiveSave = async (operatorId: string, distributions: { departmentId: string, hours: number }[]) => {
        const res = await saveMassiveAllocation(currentYear, currentWeek, operatorId, distributions, uid);
        if (res.success) {
            // Aggiorniamo lo stato locale
            setBoardData(prev => {
                const newAlloc = { ...prev.allocations };
                distributions.forEach(d => {
                    const key = `${currentYear}_${currentWeek}_${d.departmentId}`;
                    const current = newAlloc[key] || [];
                    const idx = current.findIndex(a => a.operatorId === operatorId);
                    
                    let next = [...current];
                    if (d.hours > 0) {
                        if (idx >= 0) next[idx] = { ...next[idx], hours: d.hours };
                        else next.push({ operatorId, hours: d.hours });
                    } else {
                        if (idx >= 0) next.splice(idx, 1);
                    }
                    newAlloc[key] = next;
                });
                return { ...prev, allocations: newAlloc };
            });
            toast({ title: "Pianificazione Salvata", description: "Tutte le allocazioni sono state aggiornate." });
        }
    };

    if (loading && !boardData.jobOrders.length && !boardData.unassignedJobs.length) return (
        <div className="flex flex-col items-center justify-center p-24 space-y-4 h-[60vh]">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-400 animate-pulse">Accessing Weekly Capacity Grid...</p>
        </div>
    );

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
                {/* Header Master */}
                <div className="flex flex-col lg:flex-row justify-between items-center gap-4 bg-slate-900 px-6 py-3 border-b border-slate-800 shadow-xl z-10 shrink-0">
                    <div className="flex items-center gap-6">
                        <div className="h-14 w-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-900/50">
                            <Zap className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tighter uppercase italic text-white flex items-center gap-3">
                                Power-Planning V2
                            </h1>
                            <div className="flex items-center gap-3 mt-1.5">
                                <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black uppercase text-[10px] tracking-[0.1em] px-2 py-0.5 rounded-md">Live Factory Core</Badge>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest hidden sm:inline-block">Capacità Vasi Comunicanti</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button 
                            variant="ghost" 
                            className="h-12 px-6 rounded-xl bg-slate-800 text-white hover:bg-blue-600 transition-all font-black text-[11px] uppercase tracking-widest gap-2 shadow-lg hover:shadow-blue-900/50 border border-slate-700"
                            onClick={() => setIsBacklogOpen(true)}
                        >
                            <LayoutGrid className="h-4 w-4" />
                            Commesse da Assegnare
                            <Badge className="bg-blue-500 text-white border-none ml-1.5 h-6 w-6 p-0 flex items-center justify-center rounded-full shadow-inner">{boardData.unassignedJobs.length}</Badge>
                        </Button>

                        <Button 
                            variant="ghost" 
                            className="h-12 px-6 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-all font-black text-[11px] uppercase tracking-widest gap-2 shadow-lg hover:shadow-emerald-900/50 border border-emerald-500/30"
                            onClick={() => setIsMassiveDialogOpen(true)}
                        >
                            <Zap className="h-4 w-4 fill-white" />
                            Pianificazione Massiva
                        </Button>

                        <div className="h-8 w-px bg-slate-800 mx-1 hidden lg:block" />

                        <div className="flex flex-col items-start gap-1">
                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest px-1">Selettore Settimana</span>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shadow-inner">
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white" onClick={handlePrevWeek}><ChevronLeft className="h-5 w-5" /></Button>
                                    <div className="px-4 font-black text-sm text-slate-200 min-w-[170px] text-center uppercase tracking-tighter">
                                        SETT. {getWeek(currentDate, { weekStartsOn: 1 })} — {currentDate.getFullYear()}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white" onClick={handleNextWeek}><ChevronRight className="h-5 w-5" /></Button>
                                </div>
                                <div className="flex flex-col gap-1 items-end pl-2 pr-4 border-l border-slate-800">
                                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-tight">
                                        <span className="text-slate-400">Carico Totale:</span>
                                        <span className={cn(globalMetrics.capacity > 0 && globalMetrics.load > globalMetrics.capacity ? "text-red-500 animate-pulse" : "text-blue-400")}>
                                            {globalMetrics.load.toFixed(1)}h
                                        </span>
                                        <span className="text-slate-600">/</span>
                                        <span className="text-slate-400">Cap: {globalMetrics.capacity}h</span>
                                    </div>
                                    <Progress value={globalMetrics.capacity > 0 ? (globalMetrics.load / globalMetrics.capacity)*100 : 0} className="h-1.5 w-32 bg-slate-800 [&>div]:bg-blue-500" />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                            <Button 
                                variant={activeView === 'board' ? 'default' : 'ghost'} 
                                size="sm" 
                                className={cn("h-9 font-black text-[10px] uppercase px-5 rounded-lg transition-all", activeView === 'board' ? "bg-blue-600 shadow-lg shadow-blue-900/50 text-white" : "text-slate-500 hover:text-slate-300")}
                                onClick={() => setActiveView('board')}
                            >
                                TABELLONE
                            </Button>
                            <Button 
                                variant={activeView === 'console' ? 'default' : 'ghost'} 
                                size="sm" 
                                className={cn("h-10 font-black text-[10px] uppercase px-6 rounded-xl transition-all", activeView === 'console' ? "bg-blue-700 shadow-lg shadow-blue-200" : "text-slate-400")}
                                onClick={() => setActiveView('console')}
                            >
                                CONSOLE MASTER
                            </Button>
                        </div>

                        <Button 
                            variant="outline" 
                            size="icon"
                            className="h-12 w-12 border rounded-xl bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-400 hover:text-white transition-all shadow-sm shrink-0"
                            onClick={() => loadData(true)} 
                            disabled={isRefreshing}
                        >
                            <RefreshCcw className={cn("h-6 w-6", isRefreshing && "animate-spin")} />
                        </Button>
                    </div>
                </div>

                {/* Contenuto dinamico */}
                <div className="flex-1 overflow-auto p-4 md:p-6 pb-24">
                    {activeView === 'board' ? (
                        <WeeklyCapacityBoard 
                            jobOrders={boardData.jobOrders}
                            operators={planningOperators}
                            departments={cachedDepartments}
                            articles={cachedArticles}
                            allocations={boardData.allocations}
                            phaseTemplates={phaseTemplates}
                            currentDate={currentDate}
                            weeklyLimit={weeklyLimitHours}
                            onStatusAdvance={handleStatusAdvance}
                            onManageAllocations={(deptId, week, year) => {
                                setSelectedSlot({ deptId, week, year });
                                setIsLoanDialogOpen(true);
                            }}
                        />
                    ) : (
                        <MasterConsole 
                            jobOrders={[...boardData.jobOrders, ...boardData.unassignedJobs]}
                            articles={cachedArticles}
                            onRefresh={() => loadData(true)}
                        />
                    )}
                </div>

                {/* Drawer Backlog */}
                <BacklogDrawer 
                    isOpen={isBacklogOpen}
                    onClose={() => setIsBacklogOpen(false)}
                    unassignedJobs={boardData.unassignedJobs}
                    onExclude={handleExcludeJob}
                />

                {selectedSlot && (
                    <OperatorSkillLoanDialog 
                        isOpen={isLoanDialogOpen}
                        onClose={() => setIsLoanDialogOpen(false)}
                        targetDept={selectedSlot.deptId}
                        week={selectedSlot.week}
                        year={selectedSlot.year}
                        operators={planningOperators}
                        currentAllocations={boardData.allocations}
                        weeklyLimit={weeklyLimitHours}
                        onSelect={handleLoanSelect}
                    />
                )}

                <MassiveAllocationDialog 
                    isOpen={isMassiveDialogOpen}
                    onClose={() => setIsMassiveDialogOpen(false)}
                    week={currentWeek}
                    year={currentYear}
                    operators={planningOperators}
                    displayDepts={displayDepts}
                    currentAllocations={boardData.allocations}
                    weeklyLimit={weeklyLimitHours}
                    onSave={handleMassiveSave}
                />

                {pendingMove && (
                    <AlertDialog open={!!pendingMove} onOpenChange={(o) => !o && setPendingMove(null)}>
                        <AlertDialogContent className="bg-slate-900 border-slate-700">
                            <AlertDialogHeader>
                                <AlertDialogTitle className="text-slate-100">Conferma Spostamento</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-400">
                                    Conferma la nuova data di consegna finale per lo spostamento. Verrà impostato questo giorno per consolidare il piano. Se cambi reparto (tra quelli compatibili), verrà aggiornato.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-4">
                                <label className="text-xs font-bold text-slate-300 uppercase tracking-widest block mb-2">Nuova Data Consegna Finale</label>
                                <input 
                                    type="date" 
                                    className="w-full h-12 bg-slate-950 border border-slate-800 rounded-xl px-4 text-white"
                                    value={pendingMove.suggestedDate}
                                    onChange={(e) => setPendingMove({...pendingMove, suggestedDate: e.target.value})}
                                />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel className="bg-slate-800 text-slate-200 border-none hover:bg-slate-700 hover:text-white">Annulla</AlertDialogCancel>
                                <AlertDialogAction 
                                    className="bg-blue-600 text-white hover:bg-blue-700"
                                    onClick={() => handleJobMove(pendingMove.jobId, pendingMove.suggestedDate, pendingMove.deptId)}
                                >
                                    Conferma Spostamento
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </div>
        </DragDropContext>
    );
}
