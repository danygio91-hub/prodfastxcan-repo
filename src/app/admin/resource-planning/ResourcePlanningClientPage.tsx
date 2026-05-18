'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
    Zap,
    Download,
    FileSpreadsheet
} from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, getWeek, parseISO, isSameWeek, startOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { getOverallStatus } from '@/lib/types';
import { getDerivedJobStatus } from '@/lib/job-status';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn, normalizeDateStr, parseRobustDate } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
    saveMassiveAllocation,
    selfHealJobPhases
} from './weekly-actions';
import { getWorkCycles } from '../data-management/actions';
import { updateJobDeliveryDate, updateJobDepartment, forceCloseAndExclude } from './actions';
import MassiveAllocationDialog from './MassiveAllocationDialog';
import QuickJobOrderDialog from './QuickJobOrderDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
    DropdownMenu, 
    DropdownMenuContent, 
    DropdownMenuGroup, 
    DropdownMenuItem, 
    DropdownMenuLabel, 
    DropdownMenuSeparator, 
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { calculateMRPTimelines } from '@/lib/mrp-utils';
import { exportPlanningToExcel } from '@/lib/excel-export';
import type { WeeklyCapacityBoardRef } from './WeeklyCapacityBoard';
import { processJobsSSoT } from './ssot-utils';
import { EditStandardJobModal } from '@/components/mrp/EditStandardJobModal';

import type { JobOrder, Department } from '@/types';

export default function ResourcePlanningClientPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const uid = user?.uid || '';
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeView, setActiveView] = useState<'board' | 'console'>('board');
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    const [isBacklogOpen, setIsBacklogOpen] = useState(false);
    const [quickViewJob, setQuickViewJob] = useState<any | null>(null);
    
    const boardRef = useRef<WeeklyCapacityBoardRef>(null);

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
        settings?: any,
        rawMaterials?: any[],
        purchaseOrders?: any[],
        manualCommitments?: any[],
        globalSettings?: any,
        activeSessions?: any[]
    }>({ jobOrders: [], unassignedJobs: [], allocations: {} });
    const [phaseTemplates, setPhaseTemplates] = useState<any[]>([]);

    const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false);
    const [isMassiveDialogOpen, setIsMassiveDialogOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<{ deptId: string, week: number, year: number } | null>(null);
    const [pendingMove, setPendingMove] = useState<{
        jobId: string, 
        dateStr: string, 
        deptId: string, 
        suggestedDate: string,
        dateField: string,
        dialogTitle: string
    } | null>(null);
    
    // Editing state
    const [isEditStandardModalOpen, setIsEditStandardModalOpen] = useState(false);
    const [jobToEdit, setJobToEdit] = useState<JobOrder | null>(null);
    const [workCycles, setWorkCycles] = useState<any[]>([]);
    


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

    const mrpTimelines = useMemo(() => {
        if (!boardData.rawMaterials) return new Map();
        return calculateMRPTimelines(
            [...boardData.jobOrders, ...boardData.unassignedJobs],
            boardData.rawMaterials,
            boardData.purchaseOrders || [],
            boardData.manualCommitments || [],
            cachedArticles,
            boardData.globalSettings || null,
            boardData.activeSessions || []
        );
    }, [boardData, cachedArticles]);

    // --- SINGLE SOURCE OF TRUTH (SSoT) PIPELINE ---
    const processedJobs = useMemo(() => {
        return processJobsSSoT(
            boardData.jobOrders,
            currentDate,
            isSimulationMode,
            cachedDepartments,
            cachedArticles,
            phaseTemplates
        );
    }, [boardData.jobOrders, currentDate, isSimulationMode, cachedDepartments, cachedArticles, phaseTemplates]);

    useEffect(() => {
        loadData();
    }, [currentDate]);

    // --- SELF-HEALING ENGINE ---
    // [REMOVED HOTFIX] Messo in pausa il self-healing automatico per evitare infinite loops in assenza di ciclo in anagrafica.
    // L'utente deve correggere manualmente dal data-management.    // --- UNIFIED SSoT CALCULATION FOR GLOBAL LOAD & CAPACITY ---
    const globalMetrics = useMemo(() => {
        const year = currentYear;
        const wNum = currentWeek;
        const currentWStart = startOfDay(startOfWeek(currentDate, { weekStartsOn: 1 }));

        // 1. Calculate Total Capacity (Sum of all allocations for the week)
        let totalCapacity = 0;
        Object.keys(boardData.allocations).forEach(k => {
            if (k.startsWith(`${year}_${wNum}_`)) {
                totalCapacity += boardData.allocations[k].reduce((acc, a) => acc + a.hours, 0);
            }
        });

        // 2. Calculate Total Load (Direct SSoT Summation)
        let prepLoad = 0;
        let coreLoad = 0;
        let packLoad = 0;

        const coreDepts = displayDepts.filter(d => d.id !== 'PREP' && d.id !== 'PACK');
        
        processedJobs.forEach(pj => {
            // FONDAMENTALE: Se la settimana virtuale non è quella corrente, la commessa vale 0 per questo header
            const isPrepWeek = pj.virtualWeeks ? isSameWeek(pj.virtualWeeks.PREP, currentWStart, { weekStartsOn: 1 }) : isSameWeek(pj.virtualWeek, currentWStart, { weekStartsOn: 1 });
            const isCoreWeek = pj.virtualWeeks ? isSameWeek(pj.virtualWeeks.CORE, currentWStart, { weekStartsOn: 1 }) : isSameWeek(pj.virtualWeek, currentWStart, { weekStartsOn: 1 });
            const isPackWeek = pj.virtualWeeks ? isSameWeek(pj.virtualWeeks.PACK, currentWStart, { weekStartsOn: 1 }) : isSameWeek(pj.virtualWeek, currentWStart, { weekStartsOn: 1 });

            const job = pj.job;

            // A. PREPARAZIONE (Mirror tab filtering logic)
            if (isPrepWeek) {
                const jobCoreDept = cachedDepartments.find(d => d.id === job.department || (d as any).code === job.department);
                const dependsOnPrep = jobCoreDept?.dependsOnPreparation ?? false;
                const hasPrepPhases = (job.phases || []).some(p => p.type === 'preparation');
                if (dependsOnPrep && hasPrepPhases) {
                    prepLoad += pj.computedResidual.PREP;
                }
            }

            // B. PRODUZIONE / CORE (Check if dept is in displayDepts)
            if (isCoreWeek) {
                const isCoreVisible = coreDepts.some(d => {
                    const jDept = job.department?.toUpperCase() || '';
                    const dId = d.id.toUpperCase();
                    const dCode = (d as any).code?.toUpperCase() || '';
                    const dName = (d as any).name?.toUpperCase() || '';
                    return jDept === dId || jDept === dCode || jDept === dName || dName.includes(jDept);
                });
                if (isCoreVisible) {
                    coreLoad += pj.computedResidual.CORE;
                }
            }

            // C. PACK & QLTY (Shows all jobs with pack residual)
            if (isPackWeek) {
                packLoad += pj.computedResidual.PACK;
            }
        });

        const totalLoad = prepLoad + coreLoad + packLoad;
        const debugString = `Prep (${prepLoad.toFixed(1)}h) + Prod (${coreLoad.toFixed(1)}h) + Pack (${packLoad.toFixed(1)}h) = ${totalLoad.toFixed(1)}h`;

        return { 
            load: totalLoad, 
            capacity: totalCapacity,
            debugString,
            prepLoad,
            coreLoad,
            packLoad
        };
    }, [currentDate, boardData.allocations, processedJobs, displayDepts, cachedDepartments, currentYear, currentWeek, isSimulationMode]);


    async function loadData(force: boolean = false) {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        
        try {
            const week = currentWeek;
            const year = currentYear;
            
            const data = await getWeeklyBoardData(year, week);
            const templates = await getPlanningWorkPhaseTemplates();
            const cycles = await getWorkCycles();
            setPhaseTemplates(templates);
            setWorkCycles(cycles);
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

    const handleJobMove = async (jobId: string, confirmedDate: string, targetDeptId?: string, dateField: string = 'dataConsegnaFinale') => {
        const jobToMove = [...boardData.jobOrders, ...boardData.unassignedJobs].find(j => j.id === jobId);
        if (!jobToMove) return;

        const updatedAssigned = [...boardData.jobOrders.filter(j => j.id !== jobId), { ...jobToMove, [dateField]: confirmedDate, department: targetDeptId || jobToMove.department }];
        const updatedUnassigned = boardData.unassignedJobs.filter(j => j.id !== jobId);
        
        setBoardData({ ...boardData, jobOrders: updatedAssigned, unassignedJobs: updatedUnassigned });
        setPendingMove(null);

        const res = await updateJobDeliveryDate(jobId, confirmedDate, dateField);
        if (!res.success) toast({ title: 'Errore Spostamento', description: res.message, variant: 'destructive' });

        if (targetDeptId && targetDeptId !== jobToMove.department && !['PREP', 'PACK'].includes(targetDeptId)) {
            const res2 = await updateJobDepartment(jobId, targetDeptId);
            if (!res2.success) toast({ title: 'Errore Spostamento Reparto', description: res2.message, variant: 'destructive' });
        }
        loadData();
    };

    const handleSearchJump = (targetDate: Date) => {
        // Teletrasporto: impostiamo il lunedì della settimana target come inizio della board
        setCurrentDate(startOfWeek(targetDate, { weekStartsOn: 1 }));
        toast({
            title: "Navigazione Automatica",
            description: `Focus sulla settimana del ${format(targetDate, 'dd/MM/yyyy')}`,
            variant: "default"
        });
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

    const handleRequestAssignment = (jobId: string, suggestedDate?: string, deptId?: string, macroArea: string = 'CORE') => {
        const dateToUse = suggestedDate || format(new Date(), 'yyyy-MM-dd');
        
        const isPrep = macroArea === 'PREP';
        const dateField = isPrep ? 'dataFinePreparazione' : 'dataConsegnaFinale';
        const dialogTitle = isPrep ? 'Pianifica Preparazione' : 'Pianifica Consegna';

        setPendingMove({ 
            jobId, 
            dateStr: dateToUse, 
            deptId: deptId || '', 
            suggestedDate: dateToUse,
            dateField,
            dialogTitle
        });
    };

    const handleExport = (scope: 'current' | 'next' | 'both', deptIds: string[] | 'ALL') => {
        const weekNumCurrent = currentWeek;
        const nextWeekDate = addWeeks(currentDate, 1);
        const weekNumNext = getWeek(nextWeekDate, { weekStartsOn: 1 });

        const deptsToProcess = deptIds === 'ALL' ? cachedDepartments.map(d => d.id) : deptIds;
        const finalExportJobs: any[] = [];
        
        deptsToProcess.forEach(dId => {
            if (scope === 'current' || scope === 'both') {
                const jobs = boardRef.current?.getExportJobs(currentYear, weekNumCurrent, dId) || [];
                finalExportJobs.push(...jobs);
            }
            if (scope === 'next' || scope === 'both') {
                const yearNext = weekNumNext < weekNumCurrent ? currentYear + 1 : currentYear;
                const jobs = boardRef.current?.getExportJobs(yearNext, weekNumNext, dId) || [];
                finalExportJobs.push(...jobs);
            }
        });

        if (finalExportJobs.length === 0) {
            toast({ title: "Nessun dato", description: "Non ci sono commesse pianificate per i criteri selezionati.", variant: "destructive" });
            return;
        }

        let deptName = 'PRODUZIONE';
        if (deptIds !== 'ALL' && deptIds.length === 1) {
            if (deptIds[0] === 'PREP') deptName = 'PREPARAZIONE';
            else if (deptIds[0] === 'PACK') deptName = 'QUALITÀ E IMBALLO';
            else {
                const targetDept = cachedDepartments.find(d => d.id === deptIds[0]);
                if (targetDept) deptName = targetDept.name.toUpperCase();
            }
        }

        const weekLabel = scope === 'current' ? `${currentWeek}` : (scope === 'next' ? `${weekNumNext}` : 'Multi');

        exportPlanningToExcel(
            finalExportJobs, 
            deptIds.includes('PREP') ? 'PREP' : (deptIds.includes('PACK') ? 'PACK' : 'CORE'),
            weekLabel,
            deptName
        );
        
        toast({ title: "Report Generato", description: `Scaricamento del report per ${deptName} in corso...` });
    };

    const handleEditJob = (job: JobOrder) => {
        setJobToEdit(job);
        setIsEditStandardModalOpen(true);
    };

    if (loading && !isRefreshing && !boardData.jobOrders.length && !boardData.unassignedJobs.length) return (
        <div className="flex flex-col items-center justify-center p-24 space-y-4 h-[60vh]">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-400 animate-pulse">Accessing Weekly Capacity Grid...</p>
        </div>
    );

    return (
            <div className="flex flex-col h-full bg-slate-950 relative overflow-hidden">
                {/* Header Master */}
                <div className="flex flex-col lg:flex-row justify-between items-center gap-4 bg-slate-900 px-6 py-3 border-b border-slate-800 shadow-xl z-10 shrink-0">
                    <div className="flex items-center gap-6">
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
                            className="h-12 px-4 rounded-xl bg-slate-800 text-white hover:bg-blue-600 transition-all font-black text-[10px] uppercase tracking-widest gap-2 shadow-lg hover:shadow-blue-900/50 border border-slate-700"
                            onClick={() => setIsBacklogOpen(true)}
                        >
                            <LayoutGrid className="h-4 w-4" />
                            DA ASSEGNARE
                            <Badge className="bg-blue-500 text-white border-none ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full shadow-inner text-[9px]">{boardData.unassignedJobs.length}</Badge>
                        </Button>

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button 
                                        variant="ghost" 
                                        className="h-12 w-12 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex items-center justify-center shadow-lg hover:shadow-emerald-900/50 border border-emerald-500/30"
                                        onClick={() => setIsMassiveDialogOpen(true)}
                                    >
                                        <Zap className="h-5 w-5 fill-white" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="bg-emerald-900 border-emerald-700 text-white font-black uppercase text-[10px] tracking-widest">
                                    Pianificazione Massiva
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <div className="h-8 w-px bg-slate-800 mx-1 hidden lg:block" />

                        <div className="flex flex-col items-start gap-1">
                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest px-1">Selettore Settimana</span>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shadow-inner">
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white" onClick={handlePrevWeek}><ChevronLeft className="h-5 w-5" /></Button>
                                    <div className="px-4 font-black text-sm text-slate-200 min-w-[170px] text-center uppercase tracking-tighter">
                                        SETT. {currentWeek} — {currentYear}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white" onClick={handleNextWeek}><ChevronRight className="h-5 w-5" /></Button>
                                </div>
                                <div className="flex flex-col gap-1 items-end pl-8 pr-8 border-l border-slate-800 ml-4 min-w-[240px]" title={globalMetrics.debugString}>
                                    <div className="flex items-center gap-4 text-[11px] font-black uppercase tracking-tight w-full justify-between">
                                        <span className="text-slate-500 whitespace-nowrap">Carico Totale:</span>
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-[16px]", globalMetrics.capacity > 0 && globalMetrics.load > globalMetrics.capacity ? "text-red-500 animate-pulse font-black" : "text-blue-400")}>
                                                {globalMetrics.load.toFixed(1)}h
                                            </span>
                                            <span className="text-slate-600 font-normal">/</span>
                                            <span className="text-slate-400 text-[11px]">Cap: {globalMetrics.capacity}h</span>
                                        </div>
                                    </div>
                                    <Progress value={globalMetrics.capacity > 0 ? (globalMetrics.load / globalMetrics.capacity)*100 : 0} className="h-2 w-full bg-slate-800 [&>div]:bg-blue-500 shadow-inner" />
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

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button 
                                                variant="outline" 
                                                size="icon"
                                                className="h-12 w-12 rounded-xl bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-lg border border-slate-700 shrink-0"
                                            >
                                                <Download className="h-5 w-5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-64 bg-slate-900 border-slate-800 text-slate-200">
                                <DropdownMenuLabel className="text-blue-400 uppercase tracking-tighter font-black">Scarica Report Excel</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-slate-800" />
                                
                                {/* SETTIMANA CORRENTE */}
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="focus:bg-slate-800">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        <span>Settimana Corrente</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent className="bg-slate-900 border-slate-800 text-slate-200">
                                            <DropdownMenuItem className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('current', ['PREP'])}>PREPARAZIONE</DropdownMenuItem>
                                            <DropdownMenuSeparator className="bg-slate-800" />
                                            {cachedDepartments.filter(d => d.macroAreas?.includes('PRODUZIONE')).map(d => (
                                                <DropdownMenuItem key={d.id} className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('current', [d.id])}>
                                                    REPARTO: {d.name}
                                                </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator className="bg-slate-800" />
                                            <DropdownMenuItem className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('current', ['PACK'])}>QUALITÀ & IMBALLO</DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>

                                {/* SETTIMANA PROSSIMA */}
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="focus:bg-slate-800">
                                        <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                                        <span>Settimana Prossima</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent className="bg-slate-900 border-slate-800 text-slate-200">
                                            <DropdownMenuItem className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('next', ['PREP'])}>PREPARAZIONE</DropdownMenuItem>
                                            <DropdownMenuSeparator className="bg-slate-800" />
                                            {cachedDepartments.filter(d => d.macroAreas?.includes('PRODUZIONE')).map(d => (
                                                <DropdownMenuItem key={d.id} className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('next', [d.id])}>
                                                    REPARTO: {d.name}
                                                </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator className="bg-slate-800" />
                                            <DropdownMenuItem className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('next', ['PACK'])}>QUALITÀ & IMBALLO</DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>

                                <DropdownMenuSeparator className="bg-slate-800" />
                                
                                {/* ENTRAMBE LE SETTIMANE (Macroaree) */}
                                <DropdownMenuLabel className="text-[10px] text-slate-500 uppercase py-2 px-2 font-black tracking-widest">Due Settimane Combinate</DropdownMenuLabel>
                                <DropdownMenuItem className="focus:bg-amber-600 focus:text-white" onClick={() => handleExport('both', ['PREP'])}>
                                    <FileSpreadsheet className="mr-2 h-4 w-4 text-amber-500" />
                                    PREPARAZIONE (Totale)
                                </DropdownMenuItem>
                                <DropdownMenuItem className="focus:bg-blue-600 focus:text-white" onClick={() => handleExport('both', cachedDepartments.filter(d => d.macroAreas?.includes('PRODUZIONE')).map(d => d.id))}>
                                    <FileSpreadsheet className="mr-2 h-4 w-4 text-blue-500" />
                                    PRODUZIONE (Totale)
                                </DropdownMenuItem>
                                <DropdownMenuItem className="focus:bg-emerald-600 focus:text-white" onClick={() => handleExport('both', ['PACK'])}>
                                    <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-500" />
                                    QUALITÀ & IMBALLO (Totale)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-900 border-slate-700 text-white font-black uppercase text-[10px] tracking-widest">
                                    Esporta Report
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

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
                            ref={boardRef}
                            jobOrders={boardData.jobOrders}
                            processedJobs={processedJobs}
                            unassignedJobs={boardData.unassignedJobs}
                            operators={planningOperators}
                            departments={cachedDepartments}
                            articles={cachedArticles}
                            allocations={boardData.allocations}
                            phaseTemplates={phaseTemplates}
                            currentDate={currentDate}
                            weeklyLimit={weeklyLimitHours}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            onJumpToDate={handleSearchJump}
                            onOpenBacklog={() => setIsBacklogOpen(true)}
                            onStatusAdvance={handleStatusAdvance}
                            onManageAllocations={(deptId, week, year) => {
                                setSelectedSlot({ deptId, week, year });
                                setIsLoanDialogOpen(true);
                            }}
                            onJobClick={(jobId, macroArea) => handleRequestAssignment(jobId, undefined, undefined, macroArea)}
                            onQuickView={(job) => setQuickViewJob(job)}
                            onEdit={handleEditJob}
                            rawMaterials={boardData.rawMaterials || []}
                            mrpTimelines={mrpTimelines}
                            globalSettings={boardData.globalSettings}
                            isSimulationMode={isSimulationMode}
                            onSimulationModeChange={setIsSimulationMode}
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
                    articles={cachedArticles}
                    phaseTemplates={phaseTemplates}
                    onExclude={handleExcludeJob}
                    onAssignDate={(jobId) => handleRequestAssignment(jobId)}
                    onEdit={handleEditJob}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    rawMaterials={boardData.rawMaterials || []}
                    mrpTimelines={mrpTimelines}
                    globalSettings={boardData.globalSettings}
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
                                <AlertDialogTitle className="text-slate-100">{pendingMove.dialogTitle}</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-400">
                                    Conferma la {pendingMove.dialogTitle.toLowerCase()} per consolidare il piano. 
                                    Se cambi reparto (tra quelli compatibili), verrà aggiornato il dipartimento principale.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-4">
                                <label className="text-xs font-bold text-slate-300 uppercase tracking-widest block mb-2">
                                    {pendingMove.dateField === 'dataFinePreparazione' ? 'Data Fine Preparazione' : 'Data Consegna Finale'}
                                </label>
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
                                    onClick={() => handleJobMove(pendingMove.jobId, pendingMove.suggestedDate, pendingMove.deptId, pendingMove.dateField)}
                                >
                                    Conferma
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}

                <QuickJobOrderDialog 
                    isOpen={!!quickViewJob}
                    onClose={() => setQuickViewJob(null)}
                    job={quickViewJob}
                    onActionSuccess={() => loadData(true)}
                />

                {isEditStandardModalOpen && jobToEdit && (
                    <EditStandardJobModal
                        isOpen={isEditStandardModalOpen}
                        onClose={() => {
                            setIsEditStandardModalOpen(false);
                            setJobToEdit(null);
                            loadData(true);
                        }}
                        job={jobToEdit}
                        departments={cachedDepartments}
                        workCycles={workCycles}
                    />
                )}
            </div>
    );
}
