
"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { 
  Briefcase, 
  Loader2, 
  ShieldAlert, 
  Unlock, 
  Search, 
  Combine, 
  PowerOff, 
  Activity, 
  Calendar as CalendarIcon, 
  FastForward, 
  MoreVertical, 
  Undo2, 
  Unlink, 
  ListOrdered, 
  ArrowUp, 
  ArrowDown, 
  Circle, 
  CheckCircle2,
  Hourglass, 
  PauseCircle, 
  EyeOff, 
  RefreshCcw, 
  BarChart3, 
  Copy, 
  PlayCircle, 
  CheckSquare, 
  Boxes, 
  PackageX, 
  Package2, 
  PackageCheck,
  ChevronDown,
  AlertCircle,
  CalendarDays,
  Clock,
  Timer,
  Factory
} from 'lucide-react';
import type { JobOrder, JobPhase, Operator, WorkGroup, RawMaterial, WorkingHoursConfig, OperatorAssignment, Article, OverallStatus, ProductionSettings } from '@/types';
import { useMasterData } from '@/contexts/MasterDataProvider';
import JobOrderCard from '@/components/production-console/JobOrderCard';
import WorkGroupCard from '@/components/production-console/WorkGroupCard';
import GanttBoard from '@/components/production-console/GanttBoard';
import { getOperatorAssignments } from '@/app/admin/resource-planning/actions';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, getDocs, getDoc, doc, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useDebounce } from '../../../hooks/use-debounce';


import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { resolveJobProblem } from '@/app/scan-job/actions';
import { 
  forceFinishProduction, 
  toggleGuainaPhasePosition, 
  revertPhaseCompletion, 
  forcePauseOperators, 
  forceCompleteJob, 
  resetSingleCompletedJobOrder, 
  revertForceFinish, 
  forceFinishMultiple, 
  forceCompleteMultiple, 
  updatePhasesForJob, 
  revertCompletion, 
  reportMaterialMissing, 
  resolveMaterialMissing, 
  updateJobDeliveryDate,
  updateJobPrepDate,
  getAnalysisForArticle,
  getArticlesByCodes,
  getRawMaterialsByCodes,
  type ProductionTimeData
} from '@/app/admin/production-console/actions';
import { getProductionSettings } from '@/app/admin/production-settings/actions';
import { getOverallStatus } from '@/lib/types';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isSameDay, isPast, parseISO, startOfWeek, endOfWeek, getWeek, isValid, addWeeks } from 'date-fns';
import { it } from 'date-fns/locale';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { getWorkingHoursConfig } from '@/app/admin/working-hours/actions';
import { convertTimestampsToDates } from "@/lib/utils";


type FilterStatus = OverallStatus | 'all' | 'LIVE' | 'ACTIVE';

interface WeeklyGroup {
    weekNumber: number;
    weekLabel: string;
    items: (JobOrder | WorkGroup)[];
    totalPcs: number;
}

export default function ProductionConsoleClientPage() {
  const { 
    operators: cachedOperators, 
    articlesMap, 
    settings: cachedSettings, 
    workingHours: cachedWorkingHours,
    isLoading: isMasterLoading 
  } = useMasterData();

  const [viewMode, setViewMode] = useState<'list'|'gantt'>('list');

  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [assignments, setAssignments] = useState<OperatorAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isReallyLoading = isLoading || isMasterLoading;
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('ACTIVE');
  const [problemJob, setProblemJob] = useState<JobOrder | WorkGroup | null>(null);
  const [phaseManagedItem, setPhaseManagedItem] = useState<JobOrder | WorkGroup | null>(null);
  const [materialManagedItem, setMaterialManagedItem] = useState<JobOrder | WorkGroup | null>(null);
  const [analysisDataMap, setAnalysisDataMap] = useState<Map<string, ProductionTimeData | null>>(new Map());
  const [jobsWithLoadingAnalysis, setJobsWithLoadingAnalysis] = useState<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDataRefreshing, setIsDataRefreshing] = useState(false);
  
  const searchParams = useSearchParams();
  const groupIdFromUrl = searchParams.get('groupId');
  const searchFromUrl = searchParams.get('search') || searchParams.get('ordinePF');
  
  const [searchTerm, setSearchTerm] = useState(groupIdFromUrl || searchFromUrl || '');
  const [isTargetedLoad, setIsTargetedLoad] = useState(!!(groupIdFromUrl || searchFromUrl));
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // Auto-set filter to 'all' if coming from a direct search link
  useEffect(() => {
    if (searchFromUrl) {
      setActiveFilter('all');
    }
  }, [searchFromUrl]);

  const [completedDateFilter, setCompletedDateFilter] = useState<Date | undefined>(new Date());
  const [isDateFilterActive, setIsDateFilterActive] = useState(false);
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  
  const [editablePhases, setEditablePhases] = useState<JobPhase[]>([]);
  const [isOrderChanged, setIsOrderChanged] = useState(false);

  const { toast } = useToast();
  const { user, operator } = useAuth();
  const router = useRouter();
  
  const jobsLoadedRef = useRef(false);
  const groupsLoadedRef = useRef(false);

  const isJobLive = useCallback((item: JobOrder | WorkGroup): boolean => {
      return (item.phases || []).some(p => p.status === 'in-progress');
  }, []);
  
  const isOverdueItem = (item: JobOrder | WorkGroup) => {
    const deliveryDateString = item.dataConsegnaFinale;
    if (!deliveryDateString || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDateString)) return false;
    const deliveryDate = parseISO(deliveryDateString);
    return isPast(deliveryDate) && getOverallStatus(item) !== 'CHIUSO';
  };

  const loadAllData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsDataRefreshing(true);
    else setIsLoading(true);
    
    try {
        const currentGroupId = searchParams.get('groupId');
        const currentSearch = searchParams.get('search');
        const prodStatuses = [
            "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
            "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
            "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
            "Manca Materiale", "Problema", "Sospesa", "PRODUCTION", "PAUSED", "SUSPENDED"
        ];
        let jobsQuery = query(collection(db, "jobOrders"), where("status", "in", prodStatuses));
        let groupsQuery = query(collection(db, "workGroups"), where("status", "in", prodStatuses));

        if (showCompleted) {
            const compStatuses = ["completed", "CHIUSO", "shipped", "closed"];
            jobsQuery = query(collection(db, "jobOrders"), where("status", "in", compStatuses), limit(100));
            groupsQuery = query(collection(db, "workGroups"), where("status", "in", compStatuses), limit(50));
        }

        const [jobsSnap, groupsSnap] = await Promise.all([
            getDocs(jobsQuery),
            getDocs(groupsQuery)
        ]);

        const jobs = jobsSnap.docs.map(d => d.data() as JobOrder);
        const groups = groupsSnap.docs.map(d => d.data() as WorkGroup);

        setIsTargetedLoad(false);

        // Apply timestamp conversion using standard utility
        const finalJobs = jobs.map(item => convertTimestampsToDates(item));
        const finalGroups = groups.map(item => convertTimestampsToDates(item));

        setJobOrders(finalJobs);
        setWorkGroups(finalGroups);

        const start = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
        const end = format(addWeeks(parseISO(start), 4), 'yyyy-MM-dd');
        getOperatorAssignments(start, end).then(setAssignments);

        if (isManualRefresh) toast({ title: "Dati LIVE Aggiornati", description: "Le commesse sono state sincronizzate." });
    } catch (error) {
        console.error("Error loading console data:", error);
        toast({ variant: "destructive", title: "Errore", description: "Impossibile caricare i dati." });
    } finally {
        setIsLoading(false);
        setIsDataRefreshing(false);
    }
  }, [toast, showCompleted, searchParams]);

  useEffect(() => {
    // If we are in targeted load and search term becomes empty, trigger full load
    if (isTargetedLoad && searchTerm === '') {
        setIsTargetedLoad(false);
        router.replace('/admin/production-console'); // Clear query params
        loadAllData(true);
    }
  }, [searchTerm, isTargetedLoad, loadAllData, router]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  
  const workGroupsMap = useMemo(() => new Map(workGroups.map(g => [g.id, g])), [workGroups]);
  
  const { standaloneJobs, jobsByGroupId } = useMemo(() => {
    const grouped = new Map<string, JobOrder[]>();
    const standalone: JobOrder[] = [];
    jobOrders.forEach(job => {
      if (job.workGroupId && workGroupsMap.has(job.workGroupId)) {
        if (!grouped.has(job.workGroupId)) grouped.set(job.workGroupId, []);
        grouped.get(job.workGroupId)!.push(job);
      } else standalone.push(job);
    });
    return { standaloneJobs: standalone, jobsByGroupId: grouped };
  }, [jobOrders, workGroupsMap]);

  const applyFilters = <T extends JobOrder | WorkGroup>(items: T[]): T[] => {
      let f = items;
      if (showCompleted) {
          f = f.filter(i => getOverallStatus(i) === 'CHIUSO');
          if (isDateFilterActive && completedDateFilter) f = f.filter(i => i.overallEndTime && isSameDay(new Date(i.overallEndTime), completedDateFilter));
      } else {
          f = f.filter(i => getOverallStatus(i) !== 'CHIUSO');
          if (activeFilter !== 'all') {
             if (activeFilter === 'LIVE') f = f.filter(isJobLive);
             else if (activeFilter === 'ACTIVE') {
                 const activeStatuses = ['DA INIZIARE', 'IN PREP.', 'PRONTO PROD.', 'IN PROD.', 'FINE PROD.', 'QLTY & PACK'];
                 f = f.filter(i => activeStatuses.includes(getOverallStatus(i)));
             }
             else f = f.filter(i => getOverallStatus(i) === activeFilter);
          }
      }
      if (showOnlyOverdue) f = f.filter(isOverdueItem);
      if (debouncedSearchTerm) {
          const l = debouncedSearchTerm.toLowerCase();
          f = f.filter(i => {
              const isG = 'jobOrderIds' in i;
              if (isG) return (i as WorkGroup).id.toLowerCase().includes(l) || (i as WorkGroup).details.toLowerCase().includes(l) || (jobsByGroupId.get(i.id) || []).some(j => j.ordinePF.toLowerCase().includes(l));
              return (i as JobOrder).ordinePF.toLowerCase().includes(l) || (i as JobOrder).details.toLowerCase().includes(l) || (i as JobOrder).cliente.toLowerCase().includes(l);
          });
      }

      return f;
  };

  const filteredItems = useMemo(() => {
      const filteredStandalone = applyFilters(standaloneJobs);
      const filteredGroups = applyFilters(Array.from(workGroupsMap.values()));
      return [...filteredStandalone, ...filteredGroups];
  }, [standaloneJobs, workGroupsMap, activeFilter, debouncedSearchTerm, showCompleted, isDateFilterActive, completedDateFilter, showOnlyOverdue, isJobLive, jobsByGroupId]);


  const { weeklyGroups, daVerificare } = useMemo(() => {
      const weeksMap = new Map<string, WeeklyGroup>();
      const daVerificare: (JobOrder | WorkGroup)[] = [];

      filteredItems.forEach(item => {
          const dateStr = item.dataConsegnaFinale;
          if (!dateStr || dateStr === 'N/D' || !isValid(parseISO(dateStr))) {
              daVerificare.push(item);
              return;
          }

          const date = parseISO(dateStr);
          const weekNum = getWeek(date, { weekStartsOn: 1 });
          const weekStart = startOfWeek(date, { weekStartsOn: 1 });
          const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
          const year = format(date, 'yyyy');
          const key = `${year}-W${String(weekNum).padStart(2, '0')}`;

          if (!weeksMap.has(key)) {
              weeksMap.set(key, {
                  weekNumber: weekNum,
                  weekLabel: `Settimana ${weekNum} (${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')})`,
                  items: [],
                  totalPcs: 0
              });
          }

          const group = weeksMap.get(key)!;
          group.items.push(item);
          group.totalPcs += ('totalQuantity' in item) ? (item.totalQuantity || 0) : (item.qta || 0);
      });

      const sortedWeeks = Array.from(weeksMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([_, group]) => group);

      return { weeklyGroups: sortedWeeks, daVerificare };
  }, [filteredItems]);

  const handleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };
  
  const handleSelectItem = (itemId: string) => {
    setSelectedIds(prev =>
      prev.includes(itemId) ? prev.filter(selectedId => selectedId !== itemId) : [...prev, itemId]
    );
  };
  
  const handleBulkForceFinish = async () => {
    if (!user || selectedIds.length === 0) return;
    const result = await forceFinishMultiple(selectedIds, user.uid);
    toast({ title: result.success ? "Operazione Riuscita" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) setSelectedIds([]);
  };

  const handleBulkForceComplete = async () => {
    if (!user || selectedIds.length === 0) return;
    const result = await forceCompleteMultiple(selectedIds, user.uid);
    toast({ title: result.success ? "Operazione Riuscita" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) setSelectedIds([]);
  };
  
  const handleBulkReset = async () => {
     if (selectedIds.length === 0 || !user) return;
     setIsLoading(true);
     for (const id of selectedIds) { await resetSingleCompletedJobOrder(id, user.uid); }
     toast({ title: "Reset Completato" });
     setSelectedIds([]); setIsLoading(false);
  };

  const handleResolveProblem = async () => {
    if (!problemJob || !user) return;
    const result = await resolveJobProblem(problemJob.id, user.uid);
    toast({ title: result.success ? "Problema Risolto" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    setProblemJob(null);
  };

  const handleFilterClick = (filter: FilterStatus) => {
    setActiveFilter(filter);
    setShowCompleted(false);
  };

  const handleForceFinish = async (jobId: string) => { if (!user) return; await forceFinishProduction(jobId, user.uid); };
  const handleRevertForceFinish = async (jobId: string) => { if (!user) return; await revertForceFinish(jobId, user.uid); };
  const handleForceComplete = async (jobId: string) => { if (!user) return; await forceCompleteJob(jobId, user.uid); };
  const handleToggleGuaina = async (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => { if (!user) return; await toggleGuainaPhasePosition(jobId, phaseId, currentState); };
  const handleRevertPhase = async (jobId: string, phaseId: string) => { if (!user) return; await revertPhaseCompletion(jobId, phaseId, user.uid); };
  const handleRevertCompletion = async (itemId: string) => { if (!user) return; await revertCompletion(itemId, user.uid); };
  const handleForcePause = async (jobId: string, ops: string[], reason?: string, notes?: string) => { if (!user) return; await forcePauseOperators(jobId, ops, user.uid, reason, notes); };
  const onResetJobOrderClick = async (jobId: string) => { if (!user) return; await resetSingleCompletedJobOrder(jobId, user.uid); };
  const handleUpdateDeliveryDate = async (itemId: string, newDate: string) => { if (!user) return; await updateJobDeliveryDate(itemId, newDate, user.uid); };
  const handleUpdatePrepDate = async (itemId: string, newDate: string) => { if (!user) return; await updateJobPrepDate(itemId, newDate, user.uid); };
  const handleDissolveGroup = async (groupId: string) => { await dissolveWorkGroup(groupId); };

  const handleOpenPhaseManager = (item: JobOrder | WorkGroup) => {
    setPhaseManagedItem(item);
    setEditablePhases([...item.phases].sort((a,b) => a.sequence - b.sequence));
    setIsOrderChanged(false);
  };
  
  const handlePhaseStatusToggle = (phaseId: string) => {
    setEditablePhases(prev => {
      const news = prev.map(p => {
        if (p.id === phaseId) {
          if (p.status === 'pending') return { ...p, status: 'skipped' as const };
          if (p.status === 'skipped') return { ...p, status: 'pending' as const };
        }
        return p;
      });
      setIsOrderChanged(true); return news;
    });
  };

  const handleMovePhase = (index: number, direction: 'up' | 'down') => {
    setEditablePhases(prev => {
        const news = [...prev];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex >= 0 && targetIndex < news.length) {
            const temp = news[index];
            news[index] = news[targetIndex];
            news[targetIndex] = temp;
        }
        setIsOrderChanged(true); return news;
    });
  };
  
  const handleSaveChanges = async () => {
    if (!user || !phaseManagedItem) return;
    const res = await updatePhasesForJob(phaseManagedItem.id, editablePhases, user.uid);
    if (res.success) {
        toast({ title: "Fasi aggiornate" });
        setPhaseManagedItem(null);
    } else {
        toast({ variant: "destructive", title: "Errore", description: res.message });
    }
  };

  const handleFetchAnalysis = async (job: JobOrder) => {
    if (!job.id || !job.details) return;
    setJobsWithLoadingAnalysis(prev => new Set(prev).add(job.id));
    try {
        const analysis = await getAnalysisForArticle(job.details);
        if (analysis) {
            setAnalysisDataMap(prev => new Map(prev).set(job.id, analysis));
        } else {
            toast({ title: "Nessuna Analisi", description: "Dati insufficienti per generare una stima." });
        }
    } catch (e) { 
        toast({ variant: "destructive", title: "Errore Analisi" }); 
    } finally { 
        setJobsWithLoadingAnalysis(prev => { const n = new Set(prev); n.delete(job.id); return n; }); 
    }
  };

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiato!" });
  };

  const handleMaterialStatusToggle = async (itemId: string, phaseId: string, currentStatus?: string) => {
      if (!user) return;
      if (currentStatus === 'missing') {
          await resolveMaterialMissing(itemId, phaseId, user.uid);
      } else {
          await reportMaterialMissing(itemId, phaseId, user.uid);
      }
  };

  function getPhaseIconLocal(status: JobPhase['status']) {
    switch (status) {
      case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
      case 'in-progress': return <Hourglass className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'paused': return <PauseCircle className="h-4 w-4 text-orange-500" />;
      case 'completed': return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case 'skipped': return <EyeOff className="h-4 w-4 text-muted-foreground" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  }

  const renderItem = (item: JobOrder | WorkGroup) => {
      const isGroup = 'jobOrderIds' in item;
      if (isGroup) {
          return (
            <WorkGroupCard 
                key={item.id} 
                group={item as WorkGroup} 
                jobsInGroup={jobsByGroupId.get(item.id) || []} 
                allOperators={cachedOperators} 
                onProblemClick={() => setProblemJob(item as WorkGroup)} 
                onForceFinishClick={handleForceFinish} 
                onForcePauseClick={handleForcePause} 
                onForceCompleteClick={handleForceComplete} 
                onDissolveGroupClick={handleDissolveGroup} 
                onOpenPhaseManager={handleOpenPhaseManager} 
                onOpenMaterialManager={() => setMaterialManagedItem(item as WorkGroup)} 
                onToggleGuainaClick={handleToggleGuaina} 
                onUpdateDeliveryDate={handleUpdateDeliveryDate} 
                onUpdatePrepDate={handleUpdatePrepDate}
                isSelected={selectedIds.includes(item.id)} 
                onSelect={handleSelectItem} 
                overallStatus={getOverallStatus(item as WorkGroup)} 
                getOverallStatus={getOverallStatus} 
                onNavigateToAnalysis={handleNavigateToAnalysis} 
                onCopyArticleCode={handleCopy}
            />
          );
      }
      return (
        <JobOrderCard 
            key={item.id} 
            jobOrder={item as JobOrder} 
            allOperators={cachedOperators} 
            analysisData={analysisDataMap.get(item.id)} 
            onFetchAnalysis={() => handleFetchAnalysis(item as JobOrder)} 
            isAnalysisLoading={jobsWithLoadingAnalysis.has(item.id)} 
            onProblemClick={() => setProblemJob(item as JobOrder)} 
            onForceFinishClick={handleForceFinish} 
            onRevertForceFinishClick={handleRevertForceFinish} 
            onToggleGuainaClick={handleToggleGuaina} 
            onRevertPhaseClick={handleRevertPhase} 
            onRevertCompletionClick={handleRevertCompletion} 
            onForcePauseClick={handleForcePause} 
            onForceCompleteClick={handleForceComplete} 
            onResetJobOrderClick={onResetJobOrderClick} 
            onOpenPhaseManager={handleOpenPhaseManager} 
            onOpenMaterialManager={() => setMaterialManagedItem(item as JobOrder)} 
            onUpdateDeliveryDate={handleUpdateDeliveryDate} 
            onUpdatePrepDate={handleUpdatePrepDate}
            isSelected={selectedIds.includes(item.id)} 
            onSelect={handleSelectItem} 
            overallStatus={getOverallStatus(item as JobOrder)} 
            onNavigateToAnalysis={handleNavigateToAnalysis} 
            onCopyArticleCode={handleCopy}
            forceAllowActions={true}
        />
      );
  };

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <h1 className="text-3xl font-bold font-headline flex items-center gap-3">
                <Briefcase className="h-8 w-8 text-primary" /> Console Controllo Produzione
              </h1>
            </div>
            <div className="flex bg-muted p-1 rounded-lg items-center">
              <button onClick={() => setViewMode('list')} className={`px-4 py-1.5 flex items-center text-sm font-medium rounded-md transition-all ${viewMode === 'list' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                <ListOrdered className="w-4 h-4 mr-2" />
                Elenco
              </button>
              <button onClick={() => setViewMode('gantt')} className={`px-4 py-1.5 flex items-center text-sm font-medium rounded-md transition-all ${viewMode === 'gantt' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                <CalendarDays className="w-4 h-4 mr-2" />
                Gantt
              </button>
            </div>
            {viewMode === 'list' && (
              <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => loadAllData(true)} 
                  disabled={isDataRefreshing || isLoading}
                  className={cn("h-10", isDataRefreshing && "opacity-50")}
                >
                  {isDataRefreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                  Aggiorna Dati
                </Button>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Cerca..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
              </div>
            )}

        </header>

        {viewMode === 'gantt' && cachedSettings ? (
          <GanttBoard 
            jobOrders={filteredItems as JobOrder[]} 
            operators={cachedOperators} 
            assignments={assignments} 
            settings={cachedSettings}
            articles={Array.from(articlesMap.values())}
          />
        ) : (
          <>
            <Card className="p-6 bg-slate-900/50 border-slate-800/50 backdrop-blur-md rounded-[2rem] shadow-xl space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2 overflow-x-auto w-full pb-2 md:pb-0 scrollbar-hide">
                  <Button 
                      variant={activeFilter === 'ACTIVE' && !showCompleted ? 'default' : 'outline'} 
                      size="sm" 
                      onClick={() => handleFilterClick('ACTIVE')}
                      className={cn(
                          "h-10 text-[10px] font-black uppercase tracking-widest px-6 rounded-xl transition-all", 
                          activeFilter === 'ACTIVE' && !showCompleted ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600"
                      )}
                  >
                      SOLO ATTIVE
                  </Button>
                  
                  <div className="h-6 w-px bg-slate-800 mx-2" />
                  
                  {[
                    { label: 'DA INIZIARE', value: 'DA INIZIARE', color: 'bg-slate-400', icon: Package2 },
                    { label: 'IN PREP.', value: 'IN PREP.', color: 'bg-amber-500', icon: Timer },
                    { label: 'PRONTO PROD.', value: 'PRONTO PROD.', color: 'bg-emerald-500', icon: PlayCircle },
                    { label: 'IN PROD.', value: 'IN PROD.', color: 'bg-blue-600', icon: Factory },
                    { label: 'FINE PROD.', value: 'FINE PROD.', color: 'bg-purple-600', icon: CheckCircle2 },
                    { label: 'QLTY & PACK', value: 'QLTY & PACK', color: 'bg-pink-600', icon: Boxes },
                  ].map(f => (
                    <Button 
                      key={f.value} 
                      variant={activeFilter === f.value && !showCompleted ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => handleFilterClick(f.value as any)} 
                      className={cn(
                          "h-10 text-[10px] font-black uppercase gap-2 whitespace-nowrap px-4 rounded-xl border transition-all", 
                          activeFilter === f.value && !showCompleted ? `${f.color} text-white border-transparent shadow-lg` : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600"
                      )}
                    >
                      <f.icon className="h-4 w-4" /> {f.label}
                    </Button>
                  ))}

                  <div className="h-6 w-px bg-slate-800 mx-2" />

                  <Button 
                    variant={activeFilter === 'LIVE' && !showCompleted ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => handleFilterClick('LIVE')} 
                    className={cn(
                        "h-10 text-[10px] font-black uppercase gap-2 whitespace-nowrap px-4 rounded-xl border transition-all", 
                        activeFilter === 'LIVE' && !showCompleted ? "bg-red-600 text-white border-transparent shadow-lg animate-pulse" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600"
                    )}
                  >
                    <Activity className="h-4 w-4" /> LIVE
                  </Button>
                  
                  <Button 
                    variant={activeFilter === 'all' && !showCompleted ? 'default' : 'outline'} 
                    size="sm"
                    onClick={() => handleFilterClick('all')} 
                    className={cn(
                        "h-10 text-[10px] font-black uppercase gap-2 whitespace-nowrap px-4 rounded-xl border transition-all", 
                        activeFilter === 'all' && !showCompleted ? "bg-slate-700 text-white border-transparent shadow-lg" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600"
                    )}
                  >
                    TUTTE
                  </Button>
              </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800/50">
                <div className="flex items-center gap-6">
                    <div className="flex items-center space-x-2">
                        <Switch id="over-sw" checked={showOnlyOverdue} onCheckedChange={setShowOnlyOverdue} className="data-[state=checked]:bg-destructive" />
                        <Label htmlFor="over-sw" className="text-[10px] font-black uppercase tracking-widest text-destructive">Filtra Ritardi</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch id="comp-sw" checked={showCompleted} onCheckedChange={setShowCompleted} />
                        <Label htmlFor="comp-sw" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mostra CHIUSE</Label>
                    </div>
                </div>

                {showCompleted && (
                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center space-x-2">
                            <Switch id="dt-sw" checked={isDateFilterActive} onCheckedChange={setIsDateFilterActive} />
                            <Label htmlFor="dt-sw" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtra Data</Label>
                        </div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={cn("h-10 bg-slate-950 border-slate-800 text-slate-400 rounded-xl", !isDateFilterActive && "opacity-50")} disabled={!isDateFilterActive}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {completedDateFilter ? format(completedDateFilter, "PPP", { locale: it }) : "Data"}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-slate-950 border-slate-800" align="end">
                                <Calendar mode="single" selected={completedDateFilter} onSelect={setCompletedDateFilter} initialFocus className="text-slate-400" />
                            </PopoverContent>
                        </Popover>
                    </div>
                )}
          </div>
        </Card>
        
         {filteredItems.length > 0 && (
          <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                  <Checkbox id="sel-all" checked={selectedIds.length > 0 && selectedIds.length === filteredItems.length} onCheckedChange={handleSelectAll} />
                  <Label htmlFor="sel-all">Seleziona Tutte ({filteredItems.length})</Label>
              </div>
              {selectedIds.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Azioni di Gruppo ({selectedIds.length}) <MoreVertical className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger>
                     <DropdownMenuContent align="start">
                        <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()}><FastForward className="mr-2 h-4 w-4" /> Forza a Finitura</DropdownMenuItem></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confermi l'avanzamento forzato?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceFinish}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        
                        <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()}><PowerOff className="mr-2 h-4 w-4" /> Chiudi Item</DropdownMenuItem></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confermi la chiusura forzata?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceComplete}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        
                        <DropdownMenuSeparator />
                        <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive"><RefreshCcw className="mr-2 h-4 w-4" /> Annulla e Resetta</DropdownMenuItem></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro di voler resettare?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkReset} className="bg-destructive">Sì, Resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
              )}
          </div>
        )}

        {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="mt-4 text-muted-foreground">Aggiornamento...</p></div>
        ) : filteredItems.length > 0 ? (
          <div className="space-y-12">
            
            {daVerificare.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-3 border-b-2 border-destructive/20 pb-2">
                        <AlertCircle className="h-6 w-6 text-destructive" />
                        <h2 className="text-xl font-black uppercase tracking-tight text-destructive">Da Gestire e Verificare (N/D)</h2>
                        <Badge variant="destructive">{daVerificare.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {daVerificare.map(renderItem)}
                    </div>
                </section>
            )}

            {weeklyGroups.map((group) => (
                <section key={group.weekLabel} className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b-2 border-primary/20 pb-2">
                        <div className="flex items-center gap-3">
                            <CalendarDays className="h-6 w-6 text-primary" />
                            <h2 className="text-xl font-black uppercase tracking-tight text-primary">{group.weekLabel}</h2>
                            <Badge variant="outline" className="border-primary text-primary">{group.items.length} Item</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm font-bold text-muted-foreground">
                            <div className="flex items-center gap-1.5"><Package2 className="h-4 w-4"/> {group.totalPcs} pz totali</div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {group.items.map(renderItem)}
                    </div>
                </section>
            ))}

          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-lg mt-8"><Package2 className="h-16 w-16 text-muted-foreground mb-4" /><h2 className="text-xl font-semibold text-muted-foreground">Nessuna Commessa Trovata</h2></div>
        )}
        </>
      )}
      </div>
      
      <Dialog open={!!phaseManagedItem} onOpenChange={o => !o && setPhaseManagedItem(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Gestione Fasi: {phaseManagedItem?.id}</DialogTitle></DialogHeader>
           <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {editablePhases.map((phase, index) => (
                <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", (phase.status !== 'pending' && phase.status !== 'skipped') && 'bg-muted/50 opacity-70')}>
                  <div className="flex items-center gap-3">{getPhaseIconLocal(phase.status)}<span className={cn('font-medium', phase.status === 'skipped' && 'line-through text-muted-foreground')}>{phase.name}</span></div>
                  <div className="flex items-center gap-1">
                    {(phase.status === 'pending' || phase.status === 'skipped') ? (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => handleMovePhase(index, 'up')} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleMovePhase(index, 'down')} disabled={index === editablePhases.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => handlePhaseStatusToggle(phase.id)}>{phase.status === 'pending' ? <EyeOff className="mr-2 h-4 w-4" /> : <Undo2 className="mr-2 h-4 w-4" />}{phase.status === 'pending' ? 'Bypassa' : 'Ripristina'}</Button>
                      </>
                    ) : <Badge variant="secondary">{phase.status}</Badge>}
                  </div>
                </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPhaseManagedItem(null)}>Annulla</Button><Button onClick={handleSaveChanges} className={cn(isOrderChanged && 'bg-amber-500 animate-pulse')}>Salva Modifiche</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!materialManagedItem} onOpenChange={o => !o && setMaterialManagedItem(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Mancanza Materiale: {materialManagedItem?.id}</DialogTitle></DialogHeader>
           <div className="py-4 space-y-2">
            {(materialManagedItem?.phases || []).filter(p => p.type === 'preparation').map(phase => (
                <div key={phase.id} className="flex items-center justify-between p-3 rounded-md">
                  <div className="flex items-center gap-3">{phase.materialStatus === 'missing' ? <PackageX className="h-5 w-5 text-destructive" /> : <PackageCheck className="h-5 w-5 text-green-500" />}<span>{phase.name}</span></div>
                  <Button size="sm" variant={phase.materialStatus === 'missing' ? 'secondary' : 'destructive'} onClick={() => handleMaterialStatusToggle(materialManagedItem!.id, phase.id, phase.materialStatus)}>{phase.materialStatus === 'missing' ? <Unlock className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}{phase.materialStatus === 'missing' ? 'Risolvi' : 'Segnala'}</Button>
                </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

       <Dialog open={!!problemJob} onOpenChange={o => !o && setProblemJob(null)}>
        <DialogContent><DialogHeader><DialogTitle>Dettaglio Problema: {problemJob?.id}</DialogTitle></DialogHeader>
            <div className="space-y-4 text-sm pt-4">
                {problemJob?.problemType === 'MANCA_MATERIALE' && (
                    <ul className="list-disc pl-5 text-destructive">{(problemJob?.phases || []).filter(p => p.materialStatus === 'missing').map(p => <li key={p.id}>{p.name}</li>)}</ul>
                )}
                {problemJob?.problemNotes && <p className="text-muted-foreground p-2 bg-muted rounded-md">{problemJob.problemNotes}</p>}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setProblemJob(null)}>Chiudi</Button>
                { (operator?.role === 'supervisor' || operator?.role === 'admin') && (
                  <Button onClick={handleResolveProblem} className="bg-green-600 hover:bg-green-700">
                     <Unlock className="mr-2 h-4 w-4"/> Sblocca Commessa
                  </Button>
                )}
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
