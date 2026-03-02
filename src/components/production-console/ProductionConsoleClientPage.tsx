"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  Hourglass, 
  PauseCircle, 
  CheckCircle2, 
  EyeOff, 
  RefreshCcw, 
  BarChart3, 
  Copy, 
  PlayCircle, 
  CheckSquare, 
  Boxes, 
  PackageX, 
  Package2, 
  PackageCheck
} from 'lucide-react';
import type { JobOrder, JobPhase, Operator, WorkGroup, RawMaterial } from '@/lib/mock-data';
import type { OverallStatus } from '@/lib/types';
import JobOrderCard from '@/components/production-console/JobOrderCard';
import WorkGroupCard from '@/components/production-console/WorkGroupCard';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
  getProductionTimeAnalysisMap, 
  type ProductionTimeData, 
  updateJobDeliveryDate 
} from '@/app/admin/production-console/actions';
import { getOverallStatus } from '@/lib/types';
import { dissolveWorkGroup } from '@/app/admin/work-group-management/actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isSameDay, isPast, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type FilterStatus = OverallStatus | 'all' | 'LIVE';

function getPhaseIcon(status: JobPhase['status']) {
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'paused': return <PauseCircle className="h-4 w-4 text-orange-500" />;
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case 'skipped': return <EyeOff className="h-4 w-4 text-muted-foreground" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function ProductionConsoleClientPage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [allOperators, setAllOperators] = useState<Operator[]>([]);
  const [allRawMaterials, setAllRawMaterials] = useState<RawMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('all');
  const [problemJob, setProblemJob] = useState<JobOrder | WorkGroup | null>(null);
  const [phaseManagedItem, setPhaseManagedItem] = useState<JobOrder | WorkGroup | null>(null);
  const [materialManagedItem, setMaterialManagedItem] = useState<JobOrder | WorkGroup | null>(null);
  const [analysisDataMap, setAnalysisDataMap] = useState<Map<string, ProductionTimeData | null>>(new Map());
  const [jobsWithLoadingAnalysis, setJobsWithLoadingAnalysis] = useState<Set<string>>(new Set());

  const searchParams = useSearchParams();
  const groupIdFromUrl = searchParams.get('groupId');
  const [searchTerm, setSearchTerm] = useState(groupIdFromUrl || '');
  const [completedDateFilter, setCompletedDateFilter] = useState<Date | undefined>(new Date());
  const [isDateFilterActive, setIsDateFilterActive] = useState(false);
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
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
  
  const isOverdue = (item: JobOrder | WorkGroup) => {
    const deliveryDateString = item.dataConsegnaFinale;
    if (!deliveryDateString || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDateString)) return false;
    const deliveryDate = parseISO(deliveryDateString);
    return isPast(deliveryDate) && getOverallStatus(item) !== 'Completata';
  };

  useEffect(() => {
    setIsLoading(true);
    const unsubscribeJobs = onSnapshot(query(collection(db, "jobOrders"), where("status", "in", ["production", "suspended", "completed", "paused"])), (snap) => {
        const jobs = snap.docs.map(doc => JSON.parse(JSON.stringify(doc.data()), (key, value) => {
            if ((['start', 'end', 'overallStartTime', 'overallEndTime', 'odlCreationDate', 'createdAt']).includes(key) && value && typeof value === 'object' && value.seconds !== undefined) return new Date(value.seconds * 1000);
            return value;
        }) as JobOrder);
        setJobOrders(jobs); jobsLoadedRef.current = true; if (groupsLoadedRef.current) setIsLoading(false);
    });
    const unsubscribeGroups = onSnapshot(collection(db, "workGroups"), (snap) => {
        const groups = snap.docs.map(doc => JSON.parse(JSON.stringify(doc.data()), (key, value) => {
            if ((['createdAt', 'overallStartTime', 'overallEndTime']).includes(key) && value && typeof value === 'object' && value.seconds !== undefined) return new Date(value.seconds * 1000);
            return value;
        }) as WorkGroup);
        setWorkGroups(groups); groupsLoadedRef.current = true; if (jobsLoadedRef.current) setIsLoading(false);
    });
    onSnapshot(collection(db, "operators"), (snap) => setAllOperators(snap.docs.map(d => d.data() as Operator)));
    onSnapshot(collection(db, "rawMaterials"), (snap) => setAllRawMaterials(snap.docs.map(d => ({id: d.id, ...d.data()} as RawMaterial))));
    return () => { unsubscribeJobs(); unsubscribeGroups(); };
  }, [toast]);
  
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
          f = f.filter(i => getOverallStatus(i) === 'Completata');
          if (isDateFilterActive && completedDateFilter) f = f.filter(i => i.overallEndTime && isSameDay(new Date(i.overallEndTime), completedDateFilter));
      } else {
          f = f.filter(i => getOverallStatus(i) !== 'Completata');
          if (activeFilter !== 'all') f = activeFilter === 'LIVE' ? f.filter(isJobLive) : f.filter(i => getOverallStatus(i) === activeFilter);
      }
      if (showOnlyOverdue) f = f.filter(isOverdue);
      if (searchTerm) {
          const l = searchTerm.toLowerCase();
          f = f.filter(i => {
              const isG = 'jobOrderIds' in i;
              if (isG) return (i as WorkGroup).id.toLowerCase().includes(l) || (i as WorkGroup).details.toLowerCase().includes(l) || (jobsByGroupId.get(i.id) || []).some(j => j.ordinePF.toLowerCase().includes(l));
              return (i as JobOrder).ordinePF.toLowerCase().includes(l) || (i as JobOrder).details.toLowerCase().includes(l) || (i as JobOrder).cliente.toLowerCase().includes(l);
          });
      }
      return f;
  };

  const filteredStandaloneJobs = useMemo(() => applyFilters(standaloneJobs), [standaloneJobs, activeFilter, searchTerm, showCompleted, isDateFilterActive, completedDateFilter, showOnlyOverdue, isJobLive, jobsByGroupId]);
  const filteredGroups = useMemo(() => applyFilters(Array.from(workGroupsMap.values())), [workGroupsMap, activeFilter, searchTerm, showCompleted, isDateFilterActive, completedDateFilter, showOnlyOverdue, isJobLive, jobsByGroupId]);

  const jobCount = filteredStandaloneJobs.length + filteredGroups.length;

  useEffect(() => {
    setSelectedIds([]);
  }, [activeFilter, searchTerm, showCompleted]);

  const selectedItems = useMemo(() => {
      const selectedJobs = standaloneJobs.filter(j => selectedIds.includes(j.id));
      const selectedGroups = workGroups.filter(g => selectedIds.includes(g.id));
      return [...selectedJobs, ...selectedGroups];
  }, [selectedIds, standaloneJobs, workGroups]);
  
  const bulkActionsState = useMemo(() => {
    if (selectedItems.length === 0) return { canForceFinish: false, canForceComplete: false, canReset: false };
    const statuses = selectedItems.map(item => getOverallStatus(item));
    const canForceFinish = statuses.every(status => ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione', 'Sospesa', 'Problema', 'Manca Materiale'].includes(status));
    const canForceComplete = selectedItems.every(item => !isJobLive(item)) && statuses.every(status => status !== 'Completata');
    const canReset = selectedItems.length > 0;
    return { canForceFinish, canForceComplete, canReset };
  }, [selectedItems, isJobLive]);

  const handleSelectAll = () => {
    const allVisibleIds = [...filteredStandaloneJobs.map(j => j.id), ...filteredGroups.map(g => g.id)];
    if (selectedIds.length === allVisibleIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allVisibleIds);
    }
  };
  
  const handleSelectItem = (itemId: string) => {
    setSelectedIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
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

  const handleForceFinish = async (jobId: string) => { if (!user) return; await forceFinishProduction(jobId, user.uid); };
  const handleRevertForceFinish = async (jobId: string) => { if (!user) return; await revertForceFinish(jobId, user.uid); };
  const handleForceComplete = async (jobId: string) => { if (!user) return; await forceCompleteJob(jobId, user.uid); };
  const handleToggleGuaina = async (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => { if (!user) return; await toggleGuainaPhasePosition(jobId, phaseId, currentState); };
  const handleRevertPhase = async (jobId: string, phaseId: string) => { if (!user) return; await revertPhaseCompletion(jobId, phaseId, user.uid); };
  const handleRevertCompletion = async (itemId: string) => { if (!user) return; await revertCompletion(itemId, user.uid); };
  const handleForcePause = async (jobId: string, ops: string[]) => { if (!user) return; await forcePauseOperators(jobId, ops, user.uid); };
  const onResetJobOrderClick = async (jobId: string) => { if (!user) return; await resetSingleCompletedJobOrder(jobId, user.uid); };
  const handleUpdateDeliveryDate = async (itemId: string, newDate: string) => { if (!user) return; await updateJobDeliveryDate(itemId, newDate, user.uid); };
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
    if (!job.id) return;
    setJobsWithLoadingAnalysis(prev => new Set(prev).add(job.id));
    try {
        const map = await getProductionTimeAnalysisMap();
        setAnalysisDataMap(prev => new Map(prev).set(job.id, map.get(job.details) || null));
    } catch (e) { toast({ variant: "destructive", title: "Errore Analisi" }); }
    finally { setJobsWithLoadingAnalysis(prev => { const n = new Set(prev); n.delete(job.id); return n; }); }
  };

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiato!" });
  };

  const handleFilterClick = (filter: FilterStatus) => {
    setActiveFilter(filter);
    setShowCompleted(false);
  };

  const handleMaterialStatusToggle = async (itemId: string, phaseId: string, currentStatus?: string) => {
      if (!user) return;
      if (currentStatus === 'missing') {
          await resolveMaterialMissing(itemId, phaseId, user.uid);
      } else {
          await reportMaterialMissing(itemId, phaseId, user.uid);
      }
  };

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div><h1 className="text-3xl font-bold font-headline flex items-center gap-3"><Briefcase className="h-8 w-8 text-primary" /> Console Controllo Produzione</h1></div>
            <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
        </header>
        
        <Card className="p-2 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-1">
              {[
                { label: 'Tutte', value: 'all', icon: Briefcase },
                { label: 'In Corso (Live)', value: 'LIVE', icon: Activity },
                { label: 'In Lavorazione', value: 'In Lavorazione', icon: Hourglass },
                { label: 'Sospesa', value: 'Sospesa', icon: PauseCircle },
                { label: 'Problema', value: 'Problema', icon: ShieldAlert },
                { label: 'Manca Materiale', value: 'Manca Materiale', icon: PackageX },
              ].map(f => (
                <Button key={f.value} variant={activeFilter === f.value && !showCompleted ? 'secondary' : 'ghost'} onClick={() => handleFilterClick(f.value as any)} className="text-xs sm:text-sm">
                  <f.icon className={cn("mr-2 h-4 w-4", f.value === 'LIVE' && "text-red-400 animate-pulse")} /> {f.label}
                </Button>
              ))}
          </div>
           <div className="border-t pt-2 flex items-center justify-center gap-4 flex-wrap">
                  <div className="flex items-center space-x-2"><Switch id="over-sw" checked={showOnlyOverdue} onCheckedChange={setShowOnlyOverdue} /><Label htmlFor="over-sw" className="text-destructive">Filtra Ritardi</Label></div>
                  <div className="flex items-center space-x-2"><Switch id="comp-sw" checked={showCompleted} onCheckedChange={setShowCompleted} /><Label htmlFor="comp-sw">Mostra Completate</Label></div>
                  {showCompleted && (
                    <div className="flex items-center gap-2">
                      <Switch id="dt-sw" checked={isDateFilterActive} onCheckedChange={setIsDateFilterActive} /><Label htmlFor="dt-sw">Filtra Data</Label>
                      <Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-[200px] justify-start", !isDateFilterActive && "opacity-50")} disabled={!isDateFilterActive}><CalendarIcon className="mr-2 h-4 w-4" />{completedDateFilter ? format(completedDateFilter, "PPP", { locale: it }) : "Data"}</Button></PopoverTrigger>
                      <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={completedDateFilter} onSelect={setCompletedDateFilter} initialFocus /></PopoverContent></Popover>
                    </div>
                  )}
           </div>
        </Card>
        
         {jobCount > 0 && (
          <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                  <Checkbox id="sel-all" checked={selectedIds.length > 0 && selectedIds.length === jobCount} onCheckedChange={handleSelectAll} />
                  <Label htmlFor="sel-all">Seleziona Tutte ({jobCount})</Label>
              </div>
              {selectedIds.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Azioni di Gruppo ({selectedIds.length}) <MoreVertical className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger>
                     <DropdownMenuContent align="start">
                        {bulkActionsState.canForceFinish && (
                            <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()}><FastForward className="mr-2 h-4 w-4" /> Forza a Finitura</DropdownMenuItem></AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confermi l'avanzamento forzato?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceFinish}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        )}
                        {bulkActionsState.canForceComplete && (
                            <AlertDialog><AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()}><PowerOff className="mr-2 h-4 w-4" /> Chiudi Item</DropdownMenuItem></AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confermi la chiusura forzata?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceComplete}>Conferma</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        )}
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
        ) : jobCount > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredGroups.map(group => (
              <WorkGroupCard 
                  key={group.id} group={group} jobsInGroup={jobsByGroupId.get(group.id) || []} allOperators={allOperators} allRawMaterials={allRawMaterials} onProblemClick={() => setProblemJob(group)} onForceFinishClick={handleForceFinish} onForcePauseClick={handleForcePause} onForceCompleteClick={handleForceComplete} onDissolveGroupClick={handleDissolveGroup} onOpenPhaseManager={handleOpenPhaseManager} onOpenMaterialManager={() => setMaterialManagedItem(group)} onToggleGuainaClick={handleToggleGuaina} onUpdateDeliveryDate={handleUpdateDeliveryDate} isSelected={selectedIds.includes(group.id)} onSelect={handleSelectItem} overallStatus={getOverallStatus(group)} getOverallStatus={getOverallStatus} onNavigateToAnalysis={handleNavigateToAnalysis} onCopyArticleCode={handleCopy}
              />
            ))}
            {filteredStandaloneJobs.map(job => (
                <JobOrderCard 
                  key={job.id} jobOrder={job} allOperators={allOperators} allRawMaterials={allRawMaterials} analysisData={analysisDataMap.get(job.id)} onFetchAnalysis={() => handleFetchAnalysis(job)} isAnalysisLoading={jobsWithLoadingAnalysis.has(job.id)} onProblemClick={() => setProblemJob(job)} onForceFinishClick={handleForceFinish} onRevertForceFinishClick={handleRevertForceFinish} onToggleGuainaClick={handleToggleGuaina} onRevertPhaseClick={handleRevertPhase} onRevertCompletionClick={handleRevertCompletion} onForcePauseClick={handleForcePause} onForceCompleteClick={handleForceComplete} onResetJobOrderClick={onResetJobOrderClick} onOpenPhaseManager={handleOpenPhaseManager} onOpenMaterialManager={() => setMaterialManagedItem(job)} onUpdateDeliveryDate={handleUpdateDeliveryDate} isSelected={selectedIds.includes(job.id)} onSelect={handleSelectItem} overallStatus={getOverallStatus(job)} onNavigateToAnalysis={handleNavigateToAnalysis} onCopyArticleCode={handleCopy}
                />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-lg mt-8"><Package2 className="h-16 w-16 text-muted-foreground mb-4" /><h2 className="text-xl font-semibold text-muted-foreground">Nessuna Commessa Trovata</h2></div>
        )}
      </div>
      
      <Dialog open={!!phaseManagedItem} onOpenChange={o => !o && setPhaseManagedItem(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Gestione Fasi: {phaseManagedItem?.id}</DialogTitle></DialogHeader>
           <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {editablePhases.map((phase, index) => (
                <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", (phase.status !== 'pending' && phase.status !== 'skipped') && 'bg-muted/50 opacity-70')}>
                  <div className="flex items-center gap-3">{getPhaseIcon(phase.status)}<span className={cn('font-medium', phase.status === 'skipped' && 'line-through text-muted-foreground')}>{phase.name}</span></div>
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
                { operator && (operator.role === 'supervisor' || operator.role === 'admin') && (
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
