

"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Briefcase, Package2, Loader2, ShieldAlert, Unlock, User, Search, Combine, PowerOff, Activity, Calendar as CalendarIcon, Link as LinkIcon, FastForward, Trash2, MoreVertical, Undo2, Unlink, ListOrdered, ArrowUp, ArrowDown, Circle, Hourglass, PauseCircle, CheckCircle2, EyeOff, ArchiveRestore, PackageX, PackageCheck, Boxes, PlayCircle, CheckSquare, AlertTriangle, BarChart3, Copy, ClipboardList } from 'lucide-react';
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { resolveJobProblem } from '@/app/scan-job/actions';
import { forceFinishProduction, toggleGuainaPhasePosition, revertPhaseCompletion, forcePauseOperators, forceCompleteJob, resetSingleCompletedJobOrder, revertForceFinish, forceFinishMultiple, forceCompleteMultiple, updatePhasesForJob, revertCompletion, reportMaterialMissing, resolveMaterialMissing, getProductionTimeAnalysisMap, type ProductionTimeData } from '@/app/admin/production-console/actions';
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
import { StatusBadge } from '@/components/production-console/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useRouter } from 'next/navigation';


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


function ProductionConsoleView() {
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

  // This effect will listen for changes in the main data lists (jobOrders, workGroups)
  // and update the state of the currently open dialog (`materialManagedItem`).
  // This ensures the dialog content is always in sync with the real-time data.
  useEffect(() => {
    if (materialManagedItem) {
      const isGroup = materialManagedItem.id.startsWith('group-');
      const sourceList = isGroup ? workGroups : jobOrders;
      const updatedItem = sourceList.find(item => item.id === materialManagedItem.id);
      if (updatedItem) {
        setMaterialManagedItem(updatedItem);
      }
    }
  }, [jobOrders, workGroups, materialManagedItem]);

  const isJobLive = useCallback((jobOrder: JobOrder | WorkGroup): boolean => {
      return (jobOrder.phases || []).some(p => p.status === 'in-progress');
  }, []);
  
  const isOverdue = (item: JobOrder | WorkGroup) => {
    const deliveryDateString = item.dataConsegnaFinale;
    if (!deliveryDateString || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDateString)) {
        return false;
    }
    const deliveryDate = parseISO(deliveryDateString);
    return isPast(deliveryDate) && getOverallStatus(item) !== 'Completata';
  };

  useEffect(() => {
    setIsLoading(true);
    const jobsRef = collection(db, "jobOrders");
    const groupsRef = collection(db, "workGroups");
    const opsRef = collection(db, "operators");
    const materialsRef = collection(db, "rawMaterials");

    const unsubscribeJobs = onSnapshot(query(jobsRef, where("status", "in", ["production", "suspended", "completed", "paused"])), (querySnapshot) => {
        const jobs: JobOrder[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return JSON.parse(JSON.stringify(data), (key, value) => {
                if ((['start', 'end', 'overallStartTime', 'overallEndTime', 'odlCreationDate', 'createdAt']).includes(key) && value && typeof value === 'object' && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                }
                return value;
            }) as JobOrder;
        });
        setJobOrders(jobs);
        jobsLoadedRef.current = true;
        if (groupsLoadedRef.current) {
          setIsLoading(false);
        }
    }, (error) => {
        console.error("Error fetching realtime job orders:", error);
        toast({ variant: "destructive", title: "Errore di Sincronizzazione", description: "Impossibile caricare i dati della console in tempo reale." });
        setIsLoading(false);
    });

    const unsubscribeGroups = onSnapshot(query(groupsRef), (querySnapshot) => {
        const groups: WorkGroup[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return JSON.parse(JSON.stringify(data), (key, value) => {
                if ((key === 'createdAt' || key === 'overallStartTime' || key === 'overallEndTime') && value && value.seconds !== undefined) {
                    return new Date(value.seconds * 1000);
                }
                return value;
            }) as WorkGroup;
        });
        setWorkGroups(groups);
        groupsLoadedRef.current = true;
        if (jobsLoadedRef.current) {
            setIsLoading(false);
        }
    }, (error) => {
        console.error("Error fetching realtime work groups:", error);
        setIsLoading(false);
    });
    
    const unsubscribeOps = onSnapshot(opsRef, (querySnapshot) => {
        setAllOperators(querySnapshot.docs.map(doc => doc.data() as Operator));
    }, (error) => {
        console.error("Error fetching operators:", error);
    });
    
     const unsubscribeMaterials = onSnapshot(materialsRef, (querySnapshot) => {
        setAllRawMaterials(querySnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as RawMaterial));
    }, (error) => {
        console.error("Error fetching realtime raw materials:", error);
    });

    return () => {
      unsubscribeJobs();
      unsubscribeGroups();
      unsubscribeOps();
      unsubscribeMaterials();
    };
  }, [toast]);
  
  const workGroupsMap = useMemo(() => new Map(workGroups.map(g => [g.id, g])), [workGroups]);
  
  const { standaloneJobs, jobsByGroupId } = useMemo(() => {
    const grouped = new Map<string, JobOrder[]>();
    const standalone: JobOrder[] = [];

    jobOrders.forEach(job => {
      if (job.workGroupId && workGroupsMap.has(job.workGroupId)) {
        if (!grouped.has(job.workGroupId)) {
          grouped.set(job.workGroupId, []);
        }
        grouped.get(job.workGroupId)!.push(job);
      } else {
        standalone.push(job);
      }
    });
    return { standaloneJobs: standalone, jobsByGroupId: grouped };
  }, [jobOrders, workGroupsMap]);


  const applyFilters = <T extends JobOrder | WorkGroup>(items: T[]): T[] => {
      let filtered = items;

      // Main filter logic
      if (showCompleted) {
          filtered = filtered.filter(item => getOverallStatus(item) === 'Completata');
          if (isDateFilterActive && completedDateFilter) {
              filtered = filtered.filter(item => 
                  item.overallEndTime && isSameDay(new Date(item.overallEndTime), completedDateFilter)
              );
          }
      } else {
          filtered = filtered.filter(item => getOverallStatus(item) !== 'Completata');
          if (activeFilter !== 'all') {
              if (activeFilter === 'LIVE') {
                  filtered = filtered.filter(isJobLive);
              } else {
                  filtered = filtered.filter(item => getOverallStatus(item) === activeFilter);
              }
          }
      }

      // Secondary filters
      if (showOnlyOverdue) {
          filtered = filtered.filter(isOverdue);
      }

      if (searchTerm) {
          const lowercasedFilter = searchTerm.toLowerCase();
          filtered = filtered.filter(item => {
              const isGroup = 'jobOrderIds' in item;
              if (isGroup) {
                  const group = item as WorkGroup;
                  const groupMatches = group.id.toLowerCase().includes(lowercasedFilter) || 
                                       group.details.toLowerCase().includes(lowercasedFilter) ||
                                       group.cliente.toLowerCase().includes(lowercasedFilter);
                  
                  const jobsInGroup = jobsByGroupId.get(group.id) || [];
                  const anyJobMatches = jobsInGroup.some(job =>
                    job.ordinePF.toLowerCase().includes(lowercasedFilter) ||
                    job.details.toLowerCase().includes(lowercasedFilter) ||
                    (job.numeroODL?.toLowerCase() || '').includes(lowercasedFilter) ||
                    (job.numeroODLInterno?.toLowerCase() || '').includes(lowercasedFilter)
                  );
                  return groupMatches || anyJobMatches;
              } else {
                  const job = item as JobOrder;
                  return (job.cliente?.toLowerCase() || '').includes(lowercasedFilter) ||
                         job.ordinePF.toLowerCase().includes(lowercasedFilter) ||
                         (job.numeroODL?.toLowerCase() || '').includes(lowercasedFilter) ||
                         (job.numeroODLInterno?.toLowerCase() || '').includes(lowercasedFilter) ||
                         job.details.toLowerCase().includes(lowercasedFilter);
              }
          });
      }
      
      return filtered;
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
    if (selectedItems.length === 0) {
      return { canForceFinish: false, canForceComplete: false, canReset: false };
    }
    
    const statuses = selectedItems.map(item => getOverallStatus(item));
    
    const canForceFinish = statuses.every(status => ['In Preparazione', 'Pronto per Produzione', 'In Lavorazione', 'Sospesa', 'Problema', 'Manca Materiale'].includes(status));
    const canForceComplete = selectedItems.every(item => !isJobLive(item)) && statuses.every(status => status !== 'Completata');
    const canReset = statuses.every(status => status === 'Completata');

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
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) setSelectedIds([]);
  };

  const handleBulkForceComplete = async () => {
    if (!user || selectedIds.length === 0) return;
    const result = await forceCompleteMultiple(selectedIds, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) setSelectedIds([]);
  };
  
  const handleBulkReset = () => {
     if (selectedIds.length === 0) return;
     selectedIds.forEach(id => onResetJobOrderClick(id));
     setSelectedIds([]);
  };

  const handleResolveProblem = async () => {
    if (!problemJob || !user) return;
    const result = await resolveJobProblem(problemJob.id, user.uid);
    toast({
        title: result.success ? "Problema Risolto" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    setProblemJob(null);
  };

  const handleForceFinish = async (jobId: string) => {
     if (!user) return;
     const result = await forceFinishProduction(jobId, user.uid);
      toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  }
  
  const handleRevertForceFinish = async (jobId: string) => {
    if (!user) return;
    const result = await revertForceFinish(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  };

  const handleForceComplete = async (jobId: string) => {
    if (!user) return;
    const result = await forceCompleteJob(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  };

  const handleToggleGuaina = async (jobId: string, phaseId: string, currentState: 'default' | 'postponed') => {
      if (!user) return;
      const result = await toggleGuainaPhasePosition(jobId, phaseId, currentState);
      toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  }

  const handleRevertPhase = async (jobId: string, phaseId: string) => {
    if (!user) return;
    const result = await revertPhaseCompletion(jobId, phaseId, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  };
  
  const handleRevertCompletion = async (itemId: string) => {
    if (!user) return;
    const result = await revertCompletion(itemId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? 'default' : 'destructive',
    });
  }

  const handleForcePause = async (jobId: string, operatorIdsToPause: string[]) => {
    if (!user) return;
    const result = await forcePauseOperators(jobId, operatorIdsToPause, user.uid);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
  };

  const onResetJobOrderClick = async (jobId: string) => {
    if (!user) return;
    const result = await resetSingleCompletedJobOrder(jobId, user.uid);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  }
  
  const handleDissolveGroup = async (groupId: string) => {
    const result = await dissolveWorkGroup(groupId);
    toast({
      title: result.success ? "Gruppo Annullato" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
  }
  
  const handleOpenPhaseManager = (item: JobOrder | WorkGroup) => {
    setPhaseManagedItem(item);
    setEditablePhases([...item.phases].sort((a,b) => a.sequence - b.sequence));
    setIsOrderChanged(false);
  };
  
  const handlePhaseStatusToggle = (phaseId: string) => {
    setEditablePhases(prevPhases => {
      const newPhases = prevPhases.map(p => {
        if (p.id === phaseId) {
          if (p.status === 'pending') return { ...p, status: 'skipped' as const };
          if (p.status === 'skipped') return { ...p, status: 'pending' as const };
        }
        return p;
      });
      setIsOrderChanged(true);
      return newPhases;
    });
  };

  const handleMaterialStatusToggle = async (itemId: string, phaseId: string, currentStatus?: 'available' | 'missing') => {
    if (!user) return;
    const action = currentStatus === 'missing' ? resolveMaterialMissing : reportMaterialMissing;
    const result = await action(itemId, phaseId, user.uid);
     toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
    });
    // Realtime listener will handle the update
  };
  
  const handleMovePhase = (index: number, direction: 'up' | 'down') => {
    setEditablePhases(prevPhases => {
        const newPhases = [...prevPhases];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex >= 0 && targetIndex < newPhases.length) {
            [newPhases[index], newPhases[targetIndex]] = [newPhases[targetIndex], newPhases[index]];
        }
        setIsOrderChanged(true);
        return newPhases;
    });
  };
  
  const handleSaveChanges = async () => {
    if (!user || !phaseManagedItem) return;
    const result = await updatePhasesForJob(phaseManagedItem.id, editablePhases, user.uid);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
    });
    if (result.success) {
      setPhaseManagedItem(null);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
        title: "Copiato!",
        description: `"${text}" è stato copiato negli appunti.`,
    });
  }

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };
  
  const filterOptions: { label: string; value: FilterStatus; icon: React.ElementType }[] = [
    { label: 'Tutte', value: 'all', icon: Briefcase },
    { label: 'Da Iniziare', value: 'Da Iniziare', icon: Circle },
    { label: 'In Corso (Live)', value: 'LIVE', icon: Activity },
    { label: 'In Lavorazione', value: 'In Lavorazione', icon: Hourglass },
    { label: 'Sospesa', value: 'Sospesa', icon: PauseCircle },
    { label: 'Problema', value: 'Problema', icon: ShieldAlert },
    { label: 'Manca Materiale', value: 'Manca Materiale', icon: PackageX },
    { label: 'Pronto per Produzione', value: 'Pronto per Produzione', icon: PlayCircle },
    { label: 'Pronto per Finitura', value: 'Pronto per Finitura', icon: CheckSquare },
  ];
  
  const handleFilterClick = (value: FilterStatus) => {
      if (showCompleted) {
        setShowCompleted(false);
      }
      setActiveFilter(value);
  }

  const handleFetchAnalysis = async (job: JobOrder) => {
    if (!job.id) return;

    setJobsWithLoadingAnalysis(prev => new Set(prev).add(job.id));

    try {
        const analysisMap = await getProductionTimeAnalysisMap();
        const data = analysisMap.get(job.details);
        setAnalysisDataMap(prevMap => {
            const newMap = new Map(prevMap);
            newMap.set(job.id, data || null);
            return newMap;
        });
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Errore Analisi Tempi",
            description: "Impossibile caricare i dati di analisi.",
        });
        // Clear data for this job on error
        setAnalysisDataMap(prevMap => {
             const newMap = new Map(prevMap);
             newMap.set(job.id, null);
             return newMap;
        });
    } finally {
        setJobsWithLoadingAnalysis(prev => {
            const newSet = new Set(prev);
            newSet.delete(job.id);
            return newSet;
        });
    }
  };


  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Briefcase className="h-8 w-8 text-primary" />
                    Console Controllo Produzione
                </h1>
                <p className="text-muted-foreground mt-1">
                    Panoramica in tempo reale delle commesse inviate in produzione.
                </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Cerca commessa, cliente, articolo..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </header>
        
        <Card className="p-2 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-1">
              {filterOptions.map(filter => (
              <Button
                  key={filter.value}
                  variant={activeFilter === filter.value && !showCompleted ? 'secondary' : 'ghost'}
                  onClick={() => handleFilterClick(filter.value)}
                  className="capitalize px-3 py-1 h-auto text-xs sm:text-sm"
              >
                  <filter.icon className={cn("mr-2 h-4 w-4", filter.value === 'LIVE' && "text-red-400 animate-pulse")} />
                  {filter.label}
              </Button>
              ))}
          </div>
           <div className="border-t pt-2 flex items-center justify-center gap-4 flex-wrap">
                  <div className="flex items-center space-x-2">
                     <Switch id="overdue-filter-switch" checked={showOnlyOverdue} onCheckedChange={setShowOnlyOverdue} />
                     <Label htmlFor="overdue-filter-switch" className="text-destructive">Filtra Ritardi</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                      <Switch id="completed-filter-switch" checked={showCompleted} onCheckedChange={setShowCompleted} />
                      <Label htmlFor="completed-filter-switch">Mostra Completate</Label>
                  </div>

                  {showCompleted && (
                    <>
                      <div className="flex items-center space-x-2">
                          <Switch id="date-filter-switch" checked={isDateFilterActive} onCheckedChange={setIsDateFilterActive} />
                          <Label htmlFor="date-filter-switch">Filtra per data</Label>
                      </div>
                      <Popover>
                          <PopoverTrigger asChild>
                              <Button
                                  variant={"outline"}
                                  className={cn("w-[240px] justify-start text-left font-normal", !completedDateFilter && "text-muted-foreground", !isDateFilterActive && "opacity-50 cursor-not-allowed")}
                                  disabled={!isDateFilterActive}
                              >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {completedDateFilter ? format(completedDateFilter, "PPP", { locale: it }) : <span>Scegli una data</span>}
                              </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="center">
                              <Calendar
                                  mode="single"
                                  selected={completedDateFilter}
                                  onSelect={setCompletedDateFilter}
                                  initialFocus
                              />
                          </PopoverContent>
                      </Popover>
                    </>
                  )}
           </div>
        </Card>
        
         {jobCount > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                  <Checkbox
                      id="select-all"
                      checked={selectedIds.length > 0 && selectedIds.length === jobCount ? true : selectedIds.length > 0 ? 'indeterminate' : false}
                      onCheckedChange={handleSelectAll}
                      disabled={jobCount === 0}
                  />
                  <Label htmlFor="select-all">Seleziona Tutte ({jobCount})</Label>
              </div>
              {selectedIds.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Azioni di Gruppo ({selectedIds.length})
                        <MoreVertical className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                     <DropdownMenuContent align="start">
                        {bulkActionsState.canForceFinish && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                        <FastForward className="mr-2 h-4 w-4" /> Forza a Finitura
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Confermi l'azione?</AlertDialogTitle><AlertDialogDescription>Stai per forzare {selectedIds.length} item alla finitura. Le fasi di produzione verranno completate d'ufficio.</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceFinish}>Conferma</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                        {bulkActionsState.canForceComplete && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                        <PowerOff className="mr-2 h-4 w-4" /> Chiudi Commesse/Gruppi
                                    </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Confermi l'azione?</AlertDialogTitle><AlertDialogDescription>Stai per chiudere forzatamente {selectedIds.length} item. Lo stato verrà impostato su "Completata".</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkForceComplete}>Conferma</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                         {bulkActionsState.canReset && (
                          <>
                           <DropdownMenuSeparator />
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                                      <Trash2 className="mr-2 h-4 w-4" /> Annulla e Resetta
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per resettare {selectedIds.length} commesse allo stato 'pianificata', azzerando ogni lavorazione e ripristinando lo stock.</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleBulkReset} className="bg-destructive hover:bg-destructive/90">Sì, Annulla e Resetta</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                    </DropdownMenuContent>
                  </DropdownMenu>
              )}
          </div>
        )}

        {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 text-muted-foreground">Aggiornamento commesse...</p>
          </div>
        ) : jobCount > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredGroups.map(group => (
              <WorkGroupCard 
                  key={group.id}
                  group={group}
                  jobsInGroup={jobsByGroupId.get(group.id) || []}
                  allOperators={allOperators}
                  allRawMaterials={allRawMaterials}
                  onProblemClick={() => setProblemJob(group)}
                  onForceFinishClick={handleForceFinish}
                  onForcePauseClick={handleForcePause}
                  onForceCompleteClick={handleForceComplete}
                  onDissolveGroupClick={handleDissolveGroup}
                  onOpenPhaseManager={handleOpenPhaseManager}
                  onOpenMaterialManager={() => setMaterialManagedItem(group)}
                  onToggleGuainaClick={handleToggleGuaina}
                  isSelected={selectedIds.includes(group.id)}
                  onSelect={handleSelectItem}
                  overallStatus={getOverallStatus(group)}
                   getOverallStatus={getOverallStatus}
                   onNavigateToAnalysis={handleNavigateToAnalysis}
                   onCopyArticleCode={handleCopy}
              />
            ))}
            {filteredStandaloneJobs.map(job => (
                <JobOrderCard 
                  key={job.id} 
                  jobOrder={job}
                  allOperators={allOperators}
                  allRawMaterials={allRawMaterials}
                  analysisData={analysisDataMap.get(job.id)}
                  onFetchAnalysis={() => handleFetchAnalysis(job)}
                  isAnalysisLoading={jobsWithLoadingAnalysis.has(job.id)}
                  onProblemClick={() => setProblemJob(job)}
                  onForceFinishClick={handleForceFinish}
                  onRevertForceFinishClick={handleRevertForceFinish}
                  onToggleGuainaClick={handleToggleGuaina}
                  onRevertPhaseClick={handleRevertPhase}
                  onRevertCompletionClick={handleRevertCompletion}
                  onForcePauseClick={handleForcePause}
                  onForceCompleteClick={handleForceComplete}
                  onResetJobOrderClick={onResetJobOrderClick}
                  onOpenPhaseManager={handleOpenPhaseManager}
                  onOpenMaterialManager={() => setMaterialManagedItem(job)}
                  isSelected={selectedIds.includes(job.id)}
                  onSelect={handleSelectItem}
                  overallStatus={getOverallStatus(job)}
                  onNavigateToAnalysis={handleNavigateToAnalysis}
                  onCopyArticleCode={handleCopy}
                />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg mt-8">
              <Package2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-muted-foreground">
                {jobOrders.length === 0 ? "Nessuna Commessa in Produzione" : "Nessuna Commessa Trovata"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                  {jobOrders.length === 0
                    ? <>Non ci sono ancora commesse in lavorazione. <Link href="/admin/data-management" className="text-primary underline hover:text-primary/80">Crea un ODL</Link> per iniziare.</>
                    : `Nessuna commessa corrisponde ai filtri impostati.`
                  }
              </p>
          </div>
        )}
      </div>
      
      <Dialog open={!!phaseManagedItem} onOpenChange={(open) => !open && setPhaseManagedItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Gestione Fasi per: {phaseManagedItem?.id}</DialogTitle>
            <DialogDescription>
              Bypassa le fasi non necessarie o ripristina quelle saltate. Le modifiche sono possibili solo per le fasi non ancora iniziate.
            </DialogDescription>
          </DialogHeader>
           <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {editablePhases.map((phase, index) => {
              const canBeModified = phase.status === 'pending' || phase.status === 'skipped';
              return (
                <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", !canBeModified && 'bg-muted/50 opacity-70')}>
                  <div className="flex items-center gap-3">
                    {getPhaseIcon(phase.status)}
                    <span className={cn('font-medium', phase.status === 'skipped' && 'line-through text-muted-foreground')}>{phase.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {canBeModified ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMovePhase(index, 'up')}
                          disabled={index === 0 || !canBeModified}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMovePhase(index, 'down')}
                          disabled={index === editablePhases.length - 1 || !canBeModified}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePhaseStatusToggle(phase.id)}
                        >
                          {phase.status === 'pending' ? <EyeOff className="mr-2 h-4 w-4" /> : <Undo2 className="mr-2 h-4 w-4" />}
                          {phase.status === 'pending' ? 'Bypassa' : 'Ripristina'}
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary">{phase.status}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhaseManagedItem(null)}>Annulla</Button>
            <Button 
                onClick={handleSaveChanges} 
                className={cn(isOrderChanged && 'bg-amber-500 hover:bg-amber-600 text-white animate-pulse')}
            >
                Salva Modifiche
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!materialManagedItem} onOpenChange={(open) => !open && setMaterialManagedItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Gestione Materiale per: {materialManagedItem?.id}</DialogTitle>
            <DialogDescription>
             Segnala la mancanza di materiale per una fase di preparazione o risolvi una segnalazione esistente.
            </DialogDescription>
          </DialogHeader>
           <div className="py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {(materialManagedItem?.phases || []).filter(p => p.type === 'preparation').map((phase) => {
              const isMissing = phase.materialStatus === 'missing';
              return (
                <div key={phase.id} className={cn("flex items-center justify-between p-3 rounded-md", phase.status !== 'pending' && 'bg-muted/50 opacity-70')}>
                  <div className="flex items-center gap-3">
                     {isMissing ? <PackageX className="h-5 w-5 text-destructive" /> : <PackageCheck className="h-5 w-5 text-green-500" />}
                    <span className={cn('font-medium', phase.status !== 'pending' && 'text-muted-foreground')}>{phase.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant={isMissing ? 'secondary' : 'destructive'} disabled={phase.status !== 'pending'}>
                           {isMissing ? <Unlock className="mr-2 h-4 w-4" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                           {isMissing ? 'Risolvi' : 'Manca Materiale'}
                        </Button>
                      </AlertDialogTrigger>
                       <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                              <AlertDialogDescription>
                                  {isMissing ? 'Stai per marcare il materiale come disponibile, sbloccando la fase.' : 'Stai per marcare il materiale come mancante, bloccando la fase e la commessa.'}
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>Annulla</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleMaterialStatusToggle(materialManagedItem!.id, phase.id, phase.materialStatus)}>Conferma</AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                     </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterialManagedItem(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       <Dialog open={!!problemJob} onOpenChange={(open) => !open && setProblemJob(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><ShieldAlert className="text-destructive"/> Dettaglio Problema: {problemJob?.id}</DialogTitle>
                <DialogDescription asChild>
                    <div className="space-y-4 text-sm pt-4">
                        {problemJob?.problemType === 'MANCA_MATERIALE' && (
                           <div>
                                <p className="font-bold text-foreground">Materiale Mancante per le fasi:</p>
                                <ul className="list-disc pl-5 text-destructive">
                                   {(problemJob?.phases || []).filter(p => p.materialStatus === 'missing').map(p => <li key={p.id}>{p.name}</li>)}
                                </ul>
                           </div>
                        )}
                        { problemJob?.isProblemReported && problemJob?.problemType !== 'MANCA_MATERIALE' && (
                          <>
                            <p><strong className="text-foreground">Tipo:</strong> <span className="text-destructive">{problemJob?.problemType?.replace(/_/g, ' ') || 'N/D'}</span></p>
                          </>
                        )}
                        {problemJob?.problemReportedBy && (
                            <p><strong className="text-foreground">Segnalato da:</strong> {problemJob.problemReportedBy}</p>
                        )}
                        {problemJob?.problemNotes && (
                            <div>
                                <p className="font-bold text-foreground">Note Operatore:</p>
                                <p className="text-muted-foreground p-2 bg-muted rounded-md">{problemJob?.problemNotes || 'Nessuna nota fornita.'}</p>
                            </div>
                        )}
                    </div>
                </DialogDescription>
            </DialogHeader>
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

export default function ProductionConsoleClientPage() {
    return (
        <React.Suspense fallback={
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">Caricamento console...</p>
            </div>
        }>
            <ProductionConsoleView />
        </React.Suspense>
    )
}
