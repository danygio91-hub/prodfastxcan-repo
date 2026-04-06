'use client';

import React, { useState, useEffect } from 'react';
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
import { format, addWeeks, subWeeks, startOfWeek, getWeek } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { useMasterData } from '@/contexts/MasterDataProvider';
import { useAuth } from '@/components/auth/AuthProvider';

import WeeklyCapacityBoard from './WeeklyCapacityBoard';
import MasterConsole from './MasterConsole';
import OperatorSkillLoanDialog from './OperatorSkillLoanDialog';
import BacklogDrawer from './BacklogDrawer';
import { getWeeklyBoardData, saveWeeklyAllocation, advanceJobStatus, migrateJobOrderStatuses } from './weekly-actions';
import { assignJobToDate } from './actions';

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
        allocations: Record<string, string[]>
    }>({ jobOrders: [], unassignedJobs: [], allocations: {} });

    const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<{ deptId: string, week: number, year: number } | null>(null);

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

    useEffect(() => {
        loadData();
    }, [currentDate]);

    async function loadData(force: boolean = false) {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        
        try {
            const week = getWeek(currentDate, { weekStartsOn: 1 });
            const year = currentDate.getFullYear();
            
            const data = await getWeeklyBoardData(year, week);
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

    const handleJobMove = async (jobId: string, targetDate: string, targetDeptId?: string) => {
        // Ottimistico
        const jobToMove = [...boardData.jobOrders, ...boardData.unassignedJobs].find(j => j.id === jobId);
        if (!jobToMove) return;

        // Se targetDate è null/empty, stiamo tornando al backlog (non gestito qui per ora ma predisposto)
        const updatedAssigned = [...boardData.jobOrders.filter(j => j.id !== jobId), { ...jobToMove, assignedDate: targetDate, department: targetDeptId || jobToMove.department }];
        const updatedUnassigned = boardData.unassignedJobs.filter(j => j.id !== jobId);
        
        setBoardData({ ...boardData, jobOrders: updatedAssigned, unassignedJobs: updatedUnassigned });

        // Aggiorniamo sia la data che il reparto se necessario
        const res = await assignJobToDate(jobId, targetDate, targetDeptId);
        if (!res.success) {
            toast({ title: 'Errore Spostamento', description: res.message, variant: 'destructive' });
            loadData();
        }
    };

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const jobId = result.draggableId;
        const destId = result.destination.droppableId;
        
        if (destId === 'BACKLOG') return; // Ritorno al backlog non ancora implementato lato server

        // Dest format: "DEPT_ID|ISO_DATE"
        const [deptId, dateStr] = destId.split('|');
        if (dateStr) {
            handleJobMove(jobId, dateStr, deptId);
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

    const handleLoanSelect = async (operatorId: string) => {
        if (!selectedSlot) return;
        const { deptId, week, year } = selectedSlot;
        
        const key = `${year}_${week}_${deptId}`;
        const currentIds = boardData.allocations[key] || [];
        const newIds = [...new Set([...currentIds, operatorId])];
        
        const res = await saveWeeklyAllocation(year, week, deptId, newIds, uid);
        if (res.success) {
            setBoardData(prev => ({
                ...prev,
                allocations: {
                    ...prev.allocations,
                    [key]: newIds
                }
            }));
            setIsLoanDialogOpen(false);
            toast({ title: "Incarico salvato", description: "Operatore aggiunto per questa settimana." });
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
            <div className="space-y-6 flex flex-col h-full min-h-[calc(100vh-10rem)] p-4 md:p-8 bg-slate-50">
                {/* Header Master */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border-2 border-slate-100">
                    <div className="flex items-center gap-6">
                        <div className="h-16 w-16 bg-blue-700 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-blue-200">
                            <Zap className="h-8 w-8" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic text-slate-900">Power-Planning V2</h1>
                            <div className="flex items-center gap-3 mt-1.5">
                                <Badge variant="secondary" className="bg-emerald-600 text-white font-black uppercase text-[10px] tracking-[0.1em] px-3 py-0.5 rounded-full">Live Factory Core</Badge>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Capacità Vasi Comunicanti</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button 
                            variant="ghost" 
                            className="h-14 px-6 rounded-2xl bg-slate-900 text-white hover:bg-blue-600 transition-all font-black text-xs uppercase tracking-widest gap-3 shadow-lg"
                            onClick={() => setIsBacklogOpen(true)}
                        >
                            <LayoutGrid className="h-5 w-5" />
                            Commesse da Pianificare
                            <Badge className="bg-blue-500 text-white border-none ml-2">{boardData.unassignedJobs.length}</Badge>
                        </Button>

                        <div className="h-10 w-px bg-slate-200 mx-2" />

                        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border-2 border-slate-200 shadow-inner">
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-white" onClick={handlePrevWeek}><ChevronLeft className="h-6 w-6" /></Button>
                            <div className="px-6 font-black text-sm text-slate-900 min-w-[220px] text-center uppercase tracking-tighter">
                                SETT. {getWeek(currentDate, { weekStartsOn: 1 })} — {currentDate.getFullYear()}
                            </div>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-white" onClick={handleNextWeek}><ChevronRight className="h-6 w-6" /></Button>
                        </div>

                        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-2xl border-2 border-slate-100">
                            <Button 
                                variant={activeView === 'board' ? 'default' : 'ghost'} 
                                size="sm" 
                                className={cn("h-10 font-black text-[10px] uppercase px-6 rounded-xl transition-all", activeView === 'board' ? "bg-blue-700 shadow-lg shadow-blue-200" : "text-slate-400")}
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
                            className="h-12 w-12 border-2 rounded-2xl hover:bg-blue-50 hover:border-blue-300 text-slate-400 hover:text-blue-600 transition-all shadow-sm"
                            onClick={() => loadData(true)} 
                            disabled={isRefreshing}
                        >
                            <RefreshCcw className={cn("h-6 w-6", isRefreshing && "animate-spin")} />
                        </Button>
                    </div>
                </div>

                {/* Contenuto dinamico */}
                <div className="flex-1">
                    {activeView === 'board' ? (
                        <WeeklyCapacityBoard 
                            jobOrders={boardData.jobOrders}
                            operators={cachedOperators}
                            departments={cachedDepartments}
                            articles={cachedArticles}
                            allocations={boardData.allocations}
                            currentDate={currentDate}
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
                />

                {selectedSlot && (
                    <OperatorSkillLoanDialog 
                        isOpen={isLoanDialogOpen}
                        onClose={() => setIsLoanDialogOpen(false)}
                        targetDept={selectedSlot.deptId}
                        week={selectedSlot.week}
                        year={selectedSlot.year}
                        operators={cachedOperators}
                        currentAllocations={boardData.allocations[`${selectedSlot.year}_${selectedSlot.week}_${selectedSlot.deptId}`] || []}
                        onSelect={handleLoanSelect}
                    />
                )}
            </div>
        </DragDropContext>
    );
}
