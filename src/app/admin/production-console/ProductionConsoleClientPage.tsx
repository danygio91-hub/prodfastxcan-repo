"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Briefcase, Package2, Loader2, ShieldAlert, Unlock, User, Search, Combine, PowerOff, Activity, Calendar as CalendarIcon, Link as LinkIcon, FastForward, Trash2, MoreVertical, Undo2, Unlink, ListOrdered, ArrowUp, ArrowDown, Circle, Hourglass, PauseCircle, CheckCircle2, EyeOff, ArchiveRestore, PackageX, PackageCheck, Boxes, PlayCircle, CheckSquare, RefreshCcw, BarChart3, Copy, ClipboardList, ChevronDown } from 'lucide-react';
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
import { forceFinishProduction, toggleGuainaPhasePosition, revertPhaseCompletion, forcePauseOperators, forceCompleteJob, resetSingleCompletedJobOrder, revertForceFinish, forceFinishMultiple, forceCompleteMultiple, updatePhasesForJob, revertCompletion, reportMaterialMissing, resolveMaterialMissing, getProductionTimeAnalysisMap, type ProductionTimeData, updateJobDeliveryDate } from '@/app/admin/production-console/actions';
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
  const { user } = useAuth();
  const router = useRouter();
  
  const jobsLoadedRef = useRef(false);
  const groupsLoadedRef = useRef(false);

  const isJobLive = useCallback((jobOrder: JobOrder | WorkGroup): boolean => {
      return (jobOrder.phases || []).some(p => p.status === 'in-progress');
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

  const filteredStandalone = useMemo(() => applyFilters(standaloneJobs), [standaloneJobs, activeFilter, searchTerm, showCompleted, isDateFilterActive, completedDateFilter, showOnlyOverdue, isJobLive]);
  const filteredGroups = useMemo(() => applyFilters(Array.from(workGroupsMap.values())), [workGroupsMap, activeFilter, searchTerm, showCompleted, isDateFilterActive, completedDateFilter, showOnlyOverdue, isJobLive]);

  const handleFetchAnalysis = async (job: JobOrder) => {
    setJobsWithLoadingAnalysis(prev => new Set(prev).add(job.id));
    try {
        const analysisMap = await getProductionTimeAnalysisMap();
        setAnalysisDataMap(prev => new Map(prev).set(job.id, analysisMap.get(job.details) || null));
    } catch (e) { toast({ variant: "destructive", title: "Errore Analisi" }); }
    finally { setJobsWithLoadingAnalysis(prev => { const n = new Set(prev); n.delete(job.id); return n; }); }
  };

  const handleResolveProblem = async () => {
    if (!problemJob || !user) return;
    const res = await resolveJobProblem(problemJob.id, user.uid);
    toast({ title: res.message, variant: res.success ? "default" : "destructive" });
    if(res.success) setProblemJob(null);
  };

  const handleOpenPhaseManager = (item: JobOrder | WorkGroup) => {
    setPhaseManagedItem(item);
    setEditablePhases([...item.phases].sort((a,b) => a.sequence - b.sequence));
    setIsOrderChanged(false);
  };

  const handleSaveChanges = async () => {
    if (!user || !phaseManagedItem) return;
    const res = await updatePhasesForJob(phaseManagedItem.id, editablePhases, user.uid);
    toast({ title: res.message, variant: res.success ? 'default' : 'destructive' });
    if (res.success) setPhaseManagedItem(null);
  };

  const handleForceFinish = async (id: string) => { await forceFinishProduction(id, user?.uid || ''); };
  const handleForcePause = async (id: string, ops: string[]) => { await forcePauseOperators(id, ops, user?.uid || ''); };
  const handleForceComplete = async (id: string) => { await forceCompleteJob(id, user?.uid || ''); };
  const handleDissolveGroup = async (id: string) => { await dissolveWorkGroup(id); };
  const handleRevertPhase = async (jid: string, pid: string) => { await revertPhaseCompletion(jid, pid, user?.uid || ''); };
  const handleRevertForceFinish = async (id: string) => { await revertForceFinish(id, user?.uid || ''); };
  const handleRevertCompletion = async (id: string) => { await revertCompletion(id, user?.uid || ''); };
  const onResetJobOrderClick = async (id: string) => { await resetSingleCompletedJobOrder(id, user?.uid || ''); };
  const handleUpdateDeliveryDate = async (id: string, date: string) => { await updateJobDeliveryDate(id, date, user?.uid || ''); };

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };

  const handleCopyArticleCode = (articleCode: string) => {
    navigator.clipboard.writeText(articleCode);
    toast({ title: "Codice copiato" });
  };

  return (
    <>
      <div className="space-y-6">
          <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div><h1 className="text-3xl font-bold font-headline flex items-center gap-3"><Briefcase className="h-8 w-8 text-primary" /> Console Controllo Produzione</h1></div>
              <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
          </header>
          
          <Card className="p-2 flex flex-wrap items-center justify-center gap-4">
              <div className="flex flex-wrap justify-center gap-1">
                  {[{label:'Tutte',value:'all',icon:Briefcase},{label:'In Corso (Live)',value:'LIVE',icon:Activity}].map(f => (
                      <Button key={f.value} variant={activeFilter === f.value ? 'secondary' : 'ghost'} onClick={() => setActiveFilter(f.value as any)} size="sm">
                          <f.icon className={cn("mr-2 h-4 w-4", f.value === 'LIVE' && "text-red-400 animate-pulse")} /> {f.label}
                      </Button>
                  ))}
              </div>
              <div className="flex items-center gap-4">
                  <div className="flex items-center space-x-2"><Switch id="overdue" checked={showOnlyOverdue} onCheckedChange={setShowOnlyOverdue} /><Label htmlFor="overdue" className="text-destructive">Ritardi</Label></div>
                  <div className="flex items-center space-x-2"><Switch id="completed" checked={showCompleted} onCheckedChange={setShowCompleted} /><Label htmlFor="completed">Completate</Label></div>
              </div>
          </Card>

          {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                  <Badge variant="outline">Selezionate: {selectedIds.length}</Badge>
                  <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm"><RefreshCcw className="mr-2 h-4 w-4"/> Annulla e Resetta</Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Azzererà le lavorazioni e lo stock.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>No</AlertDialogCancel><AlertDialogAction onClick={async () => { for(const id of selectedIds) await resetSingleCompletedJobOrder(id, user!.uid); setSelectedIds([]); toast({title: "Reset completato"}); }} className="bg-destructive">Sì, resetta</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
              </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredGroups.map(g => (
                  <WorkGroupCard 
                    key={g.id} 
                    group={g} 
                    jobsInGroup={jobsByGroupId.get(g.id) || []} 
                    allOperators={allOperators} 
                    allRawMaterials={allRawMaterials} 
                    onProblemClick={() => setProblemJob(g)} 
                    onForceFinishClick={handleForceFinish} 
                    onForcePauseClick={handleForcePause} 
                    onForceCompleteClick={handleForceComplete} 
                    onDissolveGroupClick={handleDissolveGroup} 
                    onOpenPhaseManager={handleOpenPhaseManager} 
                    onOpenMaterialManager={() => setMaterialManagedItem(g)} 
                    onToggleGuainaClick={toggleGuainaPhasePosition} 
                    onUpdateDeliveryDate={handleUpdateDeliveryDate} 
                    isSelected={selectedIds.includes(g.id)} 
                    onSelect={id => setSelectedIds(p => p.includes(id) ? p.filter(x => x!==id) : [...p, id])} 
                    overallStatus={getOverallStatus(g)} 
                    getOverallStatus={getOverallStatus} 
                    onNavigateToAnalysis={handleNavigateToAnalysis} 
                    onCopyArticleCode={handleCopyArticleCode} 
                  />
              ))}
              {filteredStandalone.map(j => (
                  <JobOrderCard 
                    key={j.id} 
                    jobOrder={j} 
                    allOperators={allOperators} 
                    allRawMaterials={allRawMaterials} 
                    analysisData={analysisDataMap.get(j.id)} 
                    onFetchAnalysis={() => handleFetchAnalysis(j)} 
                    isAnalysisLoading={jobsWithLoadingAnalysis.has(j.id)} 
                    onProblemClick={() => setProblemJob(j)} 
                    onForceFinishClick={handleForceFinish} 
                    onRevertForceFinishClick={handleRevertForceFinish} 
                    onToggleGuainaClick={toggleGuainaPhasePosition} 
                    onRevertPhaseClick={handleRevertPhase} 
                    onRevertCompletionClick={handleRevertCompletion} 
                    onForcePauseClick={handleForcePause} 
                    onForceCompleteClick={handleForceComplete} 
                    onResetJobOrderClick={onResetJobOrderClick} 
                    onOpenPhaseManager={handleOpenPhaseManager} 
                    onOpenMaterialManager={() => setMaterialManagedItem(j)} 
                    onUpdateDeliveryDate={handleUpdateDeliveryDate} 
                    isSelected={selectedIds.includes(j.id)} 
                    onSelect={id => setSelectedIds(p => p.includes(id) ? p.filter(x => x!==id) : [...p, id])} 
                    overallStatus={getOverallStatus(j)} 
                    onNavigateToAnalysis={handleNavigateToAnalysis} 
                    onCopyArticleCode={handleCopyArticleCode} 
                  />
              ))}
          </div>

          <Dialog open={!!phaseManagedItem} onOpenChange={o => !o && setPhaseManagedItem(null)}>
              <DialogContent><DialogHeader><DialogTitle>Fasi: {phaseManagedItem?.id}</DialogTitle></DialogHeader>
                  <div className="space-y-2 py-4">{editablePhases.map((p, i) => (<div key={p.id} className="flex justify-between items-center p-2 border rounded">{p.name}<Badge>{p.status}</Badge></div>))}</div>
                  <DialogFooter><Button onClick={handleSaveChanges}>Salva</Button></DialogFooter>
              </DialogContent>
          </Dialog>
      </div>
    </>
  );
}