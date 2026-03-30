import React, { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useRouter } from 'next/navigation';
import { format, addWeeks, subWeeks, addDays, parseISO, isBefore, startOfDay, getWeek, isPast, isSameWeek, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { JobOrder, Article, RawMaterial } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Boxes, Timer, Star, TrendingUp, FileText, MonitorPlay, Calendar as CalendarIcon, Clock, Search, X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toggleJobPriority, bulkUpdateJobSortOrder } from '@/app/admin/resource-planning/actions';
import { useToast } from '@/hooks/use-toast';
import AttachmentViewerDialog from './AttachmentViewerDialog';

export interface WeekKanbanBoardProps {
  jobOrders: JobOrder[];
  mrpTimelines: Map<string, any[]>;
  rawMaterials: RawMaterial[];
  articles: Article[];
  currentWeekStart: Date; // Monday
  snapshot: any; // Contains capacity data
  activeTab: string;
  activeSubTab: string | null;
  onJobDrop: (jobId: string, assignedDate: string | null) => void;
  selectedJobIds: string[];
  onToggleSelection: (jobId: string) => void;
  onBatchSelection: (ids: string[], selected: boolean) => void;
}

interface MrpStatus {
  alert: boolean;
  dateArrival: string | null;
  text: string;
}

// Helper per calcolare lo stato MRP a livello di board (per i filtri)
const getMrpStatus = (job: JobOrder, rawMaterials: RawMaterial[], mrpTimelines: Map<string, any[]>): MrpStatus => {
    if (!job.billOfMaterials || job.billOfMaterials.length === 0) return { alert: false, dateArrival: null, text: 'Nessuna BOM' };
    let earliestCoverDate: string | null = null;
    let hasMissing = false;
    job.billOfMaterials.forEach((item: any) => {
       const matCode = item.component.toUpperCase();
       const mat = rawMaterials.find((m: RawMaterial) => m.code.toUpperCase() === matCode);
       if (!mat) { hasMissing = true; return; }
       const timeline = mrpTimelines.get(matCode) || [];
       const jobEntry = timeline.find((e: any) => e.jobId === job.id);
       if (jobEntry && jobEntry.date !== 'IMMEDIATA') {
           hasMissing = true;
           if (jobEntry.date !== 'MAI' && (!earliestCoverDate || isBefore(parseISO(jobEntry.date), parseISO(earliestCoverDate)))) {
               earliestCoverDate = jobEntry.date;
           }
       }
    });
    if (hasMissing) {
        if (earliestCoverDate) return { alert: true, dateArrival: earliestCoverDate, text: `Arrivo mat: ${format(parseISO(earliestCoverDate), 'dd/MM')}` };
        return { alert: true, dateArrival: null, text: 'Materiale Mancante (No ordini)' };
    }
    return { alert: false, dateArrival: null, text: 'Mat. OK' };
};

export default function WeekKanbanBoard({
  jobOrders,
  mrpTimelines,
  rawMaterials,
  articles,
  currentWeekStart,
  snapshot,
  activeTab,
  activeSubTab,
  onJobDrop,
  selectedJobIds,
  onToggleSelection,
  onBatchSelection
}: WeekKanbanBoardProps) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [showPriorityOnly, setShowPriorityOnly] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  // GENERATE 5 WEEKS + 1 BEYOND
  const workWeeks = useMemo(() => {
    return Array.from({ length: 5 }).map((_, i) => {
        const d = addWeeks(currentWeekStart, i);
        return {
            date: format(d, 'yyyy-MM-dd'),
            weekNum: getWeek(d, { weekStartsOn: 1 }),
            label: `SETTIMANA ${getWeek(d, { weekStartsOn: 1 })}`,
            range: `${format(d, 'dd MMM')} - ${format(addDays(d, 6), 'dd MMM')}`
        };
    });
  }, [currentWeekStart]);

  const [columns, setColumns] = useState<Record<string, JobOrder[]>>({ unassigned: [], beyond: [] });

  useEffect(() => {
    const cols: Record<string, JobOrder[]> = { unassigned: [], beyond: [] };
    workWeeks.forEach(w => { cols[w.date] = []; });

    // 1. LOCAL FILTERING
    const filteredJobs = jobOrders.filter(job => {
        const matchesSearch = !searchTerm || 
            job.ordinePF.toLowerCase().includes(searchTerm.toLowerCase()) || 
            job.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.cliente.toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesPriority = !showPriorityOnly || job.isPriority;
        
        let matchesMissing = true;
        if (showMissingOnly) {
            const status = getMrpStatus(job, rawMaterials, mrpTimelines);
            matchesMissing = status.alert;
        }

        return matchesSearch && matchesPriority && matchesMissing;
    });

    // 2. DISTRIBUTION INTO COLUMNS
    filteredJobs.forEach(job => {
      if (!job.assignedDate) {
        cols.unassigned.push(job);
        return;
      }

      const assignedDate = job.assignedDate;
      const firstWeekStart = workWeeks[0].date;
      const lastWeekEnd = format(addDays(parseISO(workWeeks[workWeeks.length - 1].date), 6), 'yyyy-MM-dd');

      if (assignedDate < firstWeekStart) {
        // Still show it in the first week but marked as carryover
        const carryoverJob = { ...job, isCarryover: true } as any;
        cols[firstWeekStart].push(carryoverJob);
      } else if (assignedDate > lastWeekEnd) {
        cols.beyond.push(job);
      } else {
        // Find which week it falls into
        const targetWeek = workWeeks.find(w => {
            const wStart = w.date;
            const wEnd = format(addDays(parseISO(wStart), 6), 'yyyy-MM-dd');
            return assignedDate >= wStart && assignedDate <= wEnd;
        });

        if (targetWeek && cols[targetWeek.date]) {
            cols[targetWeek.date].push(job);
        } else {
            cols.unassigned.push(job);
        }
      }
    });

    // SORTING LOGIC: 1. sortIndex, 2. dataConsegnaFinale
    Object.keys(cols).forEach(key => {
        cols[key].sort((a: any, b: any) => {
            if (a.sortIndex !== undefined && b.sortIndex !== undefined) return a.sortIndex - b.sortIndex;
            if (a.sortIndex !== undefined) return -1;
            if (b.sortIndex !== undefined) return 1;
            
            if (!a.dataConsegnaFinale) return 1;
            if (!b.dataConsegnaFinale) return -1;
            return a.dataConsegnaFinale.localeCompare(b.dataConsegnaFinale);
        });
    });

    setColumns(cols);
  }, [jobOrders, workWeeks]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Source and Destination columns
    const sourceCol = [...(columns[source.droppableId] || [])];
    const destCol = source.droppableId === destination.droppableId ? sourceCol : [...(columns[destination.droppableId] || [])];
    
    // Check if it's a multi-select move
    const movedItem = sourceCol[source.index];
    const isMultiMove = selectedJobIds.includes(movedItem.id);
    const movingJobIds = isMultiMove ? selectedJobIds : [movedItem.id];
    
    // Extract items to move
    const movingJobs = sourceCol.filter(j => movingJobIds.includes(j.id));
    const remainingSource = sourceCol.filter(j => !movingJobIds.includes(j.id));
    
    // We update local state first for instant feedback (Optimistic)
    let newColumns = { ...columns };
    
    if (source.droppableId === destination.droppableId) {
        // Reordering in same column
        const finalDest = [...remainingSource];
        finalDest.splice(destination.index, 0, ...movingJobs);
        newColumns[source.droppableId] = finalDest;
    } else {
        // Moving to different column
        const finalDest = [...destCol];
        finalDest.splice(destination.index, 0, ...movingJobs);
        newColumns[source.droppableId] = remainingSource;
        newColumns[destination.droppableId] = finalDest;
    }

    setColumns(newColumns);

    const isSpecialCol = destination.droppableId === 'unassigned' || destination.droppableId === 'beyond';
    const newDate = isSpecialCol ? null : destination.droppableId;
    
    // 1. Update assignment date (Monday of the week)
    onJobDrop(movedItem.id, newDate);

    // 2. Persist sort order for ALL items in the destination column
    const targetCol = newColumns[destination.droppableId];
    const updates = targetCol.map((item, index) => ({
        id: item.id,
        sortIndex: index
    }));
    await bulkUpdateJobSortOrder(updates);
  };

  const handleTogglePriority = async (jobId: string, currentPriority: boolean) => {
      const newValue = !currentPriority;
      const updatedCols = { ...columns };
      Object.keys(updatedCols).forEach(key => {
          updatedCols[key] = updatedCols[key].map(j => j.id === jobId ? { ...j, isPriority: newValue } : j);
      });
      setColumns(updatedCols);

      const res = await toggleJobPriority(jobId, newValue);
      if (!res.success) {
          toast({ variant: 'destructive', title: 'Errore', description: res.message });
      }
  };

  const getCapacityForWeek = (monday: string) => {
      if (!snapshot || !activeTab) return { supply: 0, demand: 0 };
      const weekDays = Array.from({ length: 7 }).map((_, i) => format(addDays(parseISO(monday), i), 'yyyy-MM-dd'));
      let supply = 0;
      let demand = 0;

      weekDays.forEach(day => {
          if (activeTab === 'PRODUZIONE' && activeSubTab) {
              const dept = snapshot.macroAreas['PRODUZIONE']?.find((d: any) => d.code === activeSubTab);
              const dayData = dept?.data?.find((d: any) => d.date === day);
              if (dayData) { supply += dayData.supplyHours || 0; demand += dayData.areaSpecificDemand || 0; }
          } else {
              const areaDepts = snapshot.macroAreas[activeTab] || [];
              areaDepts.forEach((dept: any) => {
                  const dayData = dept?.data?.find((d: any) => d.date === day);
                  if (dayData) {
                      supply += (dayData.supplyHours || 0);
                      demand += (dayData.areaSpecificDemand || dayData.demandHours || 0);
                  }
              });
          }
      });
      return { supply, demand };
  };

  const commonProps = {
    activeTab,
    activeSubTab,
    articles,
    mrpTimelines,
    rawMaterials,
    onTogglePriority: handleTogglePriority,
    selectedJobIds,
    onToggleSelection,
    onBatchSelection,
    mounted
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* FILTER BAR - PREMIUM DESIGN */}
      <div className="flex flex-wrap items-center gap-4 bg-white/80 backdrop-blur-md p-3 rounded-2xl border-2 border-slate-100 shadow-sm transition-all hover:shadow-md sticky top-0 z-10 mx-2">
        <div className="relative flex-1 min-w-[300px] group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
            <Input 
                placeholder="Cerca Commessa, Articolo o Cliente..." 
                className="pl-9 h-10 bg-slate-50 border-none focus-visible:ring-2 focus-visible:ring-blue-500 font-bold text-sm rounded-xl"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full transition-colors">
                    <X className="h-3.5 w-3.5 text-slate-500" />
                </button>
            )}
        </div>

        <div className="flex items-center gap-6 px-4 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center space-x-2">
                <Switch id="missing-mat" checked={showMissingOnly} onCheckedChange={setShowMissingOnly} />
                <Label htmlFor="missing-mat" className="text-[10px] font-black uppercase tracking-tight cursor-pointer flex items-center gap-1.5">
                    <AlertTriangle className={cn("h-3 w-3", showMissingOnly ? "text-red-500 animate-pulse" : "text-slate-400")} />
                    Manca Materiale
                </Label>
            </div>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center space-x-2">
                <Switch id="priority-only" checked={showPriorityOnly} onCheckedChange={setShowPriorityOnly} />
                <Label htmlFor="priority-only" className="text-[10px] font-black uppercase tracking-tight cursor-pointer flex items-center gap-1.5">
                    <Star className={cn("h-3 w-3", showPriorityOnly ? "text-amber-500 fill-amber-500" : "text-slate-400")} />
                    Alta Priorità
                </Label>
            </div>
        </div>

        {selectedJobIds.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl shadow-lg animate-in fade-in zoom-in duration-300">
                <Filter className="h-4 w-4" />
                <span className="text-xs font-black uppercase tracking-tighter">Selezionate: {selectedJobIds.length}</span>
                <button onClick={() => onBatchSelection([], false)} className="ml-2 hover:bg-white/20 p-0.5 rounded transition-colors">
                    <X className="h-4 w-4" />
                </button>
            </div>
        )}
      </div>

    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full w-full overflow-x-auto overflow-y-hidden gap-6 pb-4 px-2 scrollbar-thin scrollbar-thumb-slate-300">
        <Column 
          id="unassigned" 
          title="DA PIANIFICARE" 
          jobs={columns.unassigned || []} 
          isUnassigned 
          {...commonProps} 
        />

        {workWeeks.map((week, idx) => {
          const cap = getCapacityForWeek(week.date);
          return (
            <Column 
              key={week.date} 
              id={week.date} 
              title={week.label}
              subtitle={week.range}
              jobs={columns[week.date] || []} 
              capacity={cap.supply}
              demand={cap.demand}
              isCurrentWeek={idx === 0}
              {...commonProps}
            />
          );
        })}

        <Column 
          id="beyond" 
          title="OLTRE"
          subtitle="Commisse a lungo termine"
          jobs={columns.beyond || []} 
          isFuture
          {...commonProps} 
        />
      </div>
    </DragDropContext>
    </div>
  );
}

function Column({ id, title, subtitle, jobs, isUnassigned, isFuture, capacity, demand, articles, activeTab, activeSubTab, mrpTimelines, rawMaterials, onTogglePriority, selectedJobIds, onToggleSelection, onBatchSelection, isCurrentWeek, mounted }: any) {
  const isOverloaded = !isUnassigned && !isFuture && demand > capacity;
  const allJobsInColIds = jobs.map((j: any) => j.id);
  const isAllSelected = allJobsInColIds.length > 0 && allJobsInColIds.every((id: string) => selectedJobIds.includes(id));
  const isSomeSelected = !isAllSelected && allJobsInColIds.some((id: string) => selectedJobIds.includes(id));

  return (
    <div className={cn(
        "flex flex-col w-[350px] shrink-0 h-full rounded-2xl border-2 transition-all shadow-sm",
        isCurrentWeek ? "bg-blue-50/40 border-blue-200/50 ring-2 ring-blue-100/20" : "bg-slate-50/50 border-slate-200",
        isUnassigned && "bg-slate-100/30 border-dashed"
    )}>
      <div className={cn(
        "p-4 border-b rounded-t-2xl shrink-0 flex flex-col gap-2",
        isOverloaded ? "bg-red-50/80 border-red-200" : "bg-white/80 backdrop-blur-sm"
      )}>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <input 
                    type="checkbox" 
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isSomeSelected; }}
                    onChange={(e) => onBatchSelection(allJobsInColIds, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer transition-transform hover:scale-110"
                />
                <div className="flex flex-col">
                    <h3 className="font-black text-sm uppercase text-slate-800 tracking-tight leading-none">{title}</h3>
                    {subtitle && <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic">{subtitle}</p>}
                </div>
            </div>
            <Badge variant="secondary" className="bg-slate-800 text-white border-none font-black px-2 py-0.5 text-xs">{jobs.length}</Badge>
        </div>

        {!isUnassigned && !isFuture && capacity > 0 && (
          <div className="space-y-1.5 mt-1">
             <div className="flex justify-between items-end text-[10px] font-black uppercase tracking-tighter">
                <span className="text-slate-500">Allocazione Week</span>
                <span className={isOverloaded ? "text-red-600 animate-pulse" : "text-emerald-600"}>
                    {demand.toFixed(1)}h / {capacity.toFixed(0)}h
                </span>
             </div>
             <Progress 
                value={Math.min(100, (demand / capacity) * 100)} 
                className={cn("h-2 bg-slate-100", isOverloaded && "[&>div]:bg-red-500")} 
             />
          </div>
        )}
      </div>

      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div 
            {...provided.droppableProps} 
            ref={provided.innerRef}
            className={cn(
              "flex-1 p-3 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-slate-300 transition-colors",
              snapshot.isDraggingOver ? "bg-blue-50/30" : ""
            )}
          >
            {jobs.map((job: any, index: number) => (
               <Draggable key={job.id} draggableId={job.id} index={index}>
                 {(provided, dSnapshot) => (
                   <div
                     ref={provided.innerRef}
                     {...provided.draggableProps}
                     {...provided.dragHandleProps}
                     style={{ ...provided.draggableProps.style }}
                   >
                      <JobKanbanCard 
                        job={job} 
                        articles={articles} 
                        activeTab={activeTab} 
                        activeSubTab={activeSubTab} 
                        mrpTimelines={mrpTimelines}
                        rawMaterials={rawMaterials}
                        isDragging={dSnapshot.isDragging}
                        columnId={id}
                        isCarryover={job.isCarryover}
                        onTogglePriority={onTogglePriority}
                      isSelected={selectedJobIds.includes(job.id)}
                      onToggleSelection={onToggleSelection}
                      selectionCount={selectedJobIds.includes(job.id) ? selectedJobIds.length : 0}
                      isMounted={mounted}
                    />
                   </div>
                 )}
               </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

const JobKanbanCard = React.memo(({ job, articles, activeTab, activeSubTab, mrpTimelines, rawMaterials, isDragging, columnId, isCarryover, onTogglePriority, isSelected, onToggleSelection, selectionCount, isMounted }: any): JSX.Element => {
  const router = useRouter();
  const [isAttachmentsDialogOpen, setIsAttachmentsDialogOpen] = useState(false);
  const article = useMemo(() => articles.find((a: Article) => a.code.toUpperCase() === job.details?.toUpperCase()), [articles, job.details]);
  const attachments = job.attachments || article?.attachments || [];
  const progress = useMemo(() => {
    if (!job.phases || job.phases.length === 0) return 0;
    const completed = job.phases.filter((p: any) => p.status === 'completed').length;
    return (completed / job.phases.length) * 100;
  }, [job.phases]);

  const { hours, isIpothesis } = useMemo(() => {
    if (!job.details) return { hours: 0, isIpothesis: false };
    const article = articles.find((a: Article) => a.code.toUpperCase() === job.details.toUpperCase());
    let hasUsedFallback = false;
    const relevantPhases = (job.phases || []).filter((phase: any) => {
        if (activeTab === 'PREPARAZIONE') return phase.type === 'preparation';
        if (activeTab === 'QLTY_PACK') return phase.type === 'quality' || phase.type === 'packaging';
        if (activeTab === 'PRODUZIONE') {
            if (!activeSubTab) return phase.type === 'production';
            return phase.type === 'production' && job.department === activeSubTab;
        }
        return false;
    });
    const totalMinutes = relevantPhases.reduce((acc: number, phase: any) => {
        const time = article?.phaseTimes?.[phase.name]?.expectedMinutesPerPiece || 10;
        if (!article?.phaseTimes?.[phase.name]) hasUsedFallback = true;
        return acc + (time * job.qta);
    }, 0);
    return { hours: totalMinutes / 60, isIpothesis: hasUsedFallback };
  }, [job, articles, activeTab, activeSubTab]);

  const mrpStatus: MrpStatus = useMemo(() => getMrpStatus(job, rawMaterials, mrpTimelines), [job, rawMaterials, mrpTimelines]);

  const isMrpConflict = columnId !== 'unassigned' && columnId !== 'beyond' && mrpStatus.alert && mrpStatus.dateArrival && isBefore(parseISO(columnId), startOfDay(parseISO(mrpStatus.dateArrival)));
  const isMrpCritical = columnId !== 'unassigned' && columnId !== 'beyond' && mrpStatus.alert && !mrpStatus.dateArrival;
  const isMultiDay = hours > 8;

  return (
    <Card className={cn(
      "transition-all cursor-grab active:cursor-grabbing border-l-4 group bg-white shadow-sm hover:shadow-md",
      isDragging && "shadow-xl ring-2 ring-primary/50 rotate-2 opacity-90",
      job.isPriority && "ring-2 ring-red-500 animate-pulse border-l-red-600",
      !job.isPriority && (job.status === 'production' ? "border-l-blue-500" : "border-l-slate-300"),
      (isMrpConflict || isMrpCritical) ? "bg-red-50/80 border-l-red-500" : "",
      isSelected && "ring-2 ring-blue-400"
    )}>
      <CardContent className="p-3 space-y-2">
         <div className="flex justify-between items-start">
            <div className="flex items-start gap-2 max-w-[80%]">
               <input 
                 type="checkbox" 
                 checked={isSelected}
                 onChange={(e) => { e.stopPropagation(); onToggleSelection(job.id); }}
                 className="mt-0.5 h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
               />
               <div className="space-y-0.5 overflow-hidden">
                   <div className="flex items-center gap-1">
                       <span className={cn("text-xs font-black truncate", isMrpConflict ? "text-red-900" : "text-slate-800")}>{job.ordinePF}</span>
                       {job.numeroODLInterno && <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded truncate">{job.numeroODLInterno}</span>}
                   </div>
                   <div className="flex flex-wrap gap-1 mt-0.5">
                      <p className={cn("text-[9px] font-bold uppercase truncate", isMrpConflict ? "text-red-700/80" : "text-muted-foreground")}>{job.details}</p>
                      {isCarryover && (
                        <Badge variant="outline" className="h-3.5 px-1 bg-blue-50 text-blue-600 border-blue-200 text-[7px] font-black animate-pulse uppercase">
                          🔄 CONT.
                        </Badge>
                      )}
                   </div>
               </div>
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
                <button 
                  onClick={(e) => { e.stopPropagation(); onTogglePriority(job.id, !!job.isPriority); }}
                  className={cn("p-1 rounded-full transition-colors", job.isPriority ? "text-red-600 bg-red-100" : "text-slate-300 hover:text-slate-500 hover:bg-slate-100")}
                >
                    <Star className={cn("h-3.5 w-3.5", job.isPriority && "fill-current")} />
                </button>
                {attachments.length > 0 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setIsAttachmentsDialogOpen(true); }}
                    className="p-1 rounded-full text-blue-500 bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                      <FileText className="h-3.5 w-3.5" />
                  </button>
                )}

                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    const param = job.workGroupId || job.ordinePF;
                    const type = job.workGroupId ? 'groupId' : 'search';
                    router.push(`/admin/production-console?${type}=${param}`); 
                  }}
                  className="p-1 rounded-full text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                  title="Vai alla Console Produzione"
                >
                    <MonitorPlay className="h-3.5 w-3.5" />
                </button>
                {mrpStatus.alert ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <AlertTriangle className={cn("h-4 w-4 shrink-0", isMrpConflict || isMrpCritical ? "text-red-600 animate-pulse" : "text-amber-500")} />
                            </TooltipTrigger>
                            <TooltipContent className="bg-white border text-black shadow-xl">
                                <p className="font-bold text-xs">{mrpStatus.text}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                )}
            </div>
         </div>

         {isDragging && selectionCount > 1 && (
             <div className="absolute -top-3 -right-3 bg-blue-600 text-white text-[10px] font-black h-6 w-6 rounded-full flex items-center justify-center shadow-lg border-2 border-white animate-bounce z-50">
                {selectionCount}
             </div>
         )}

         <div className="space-y-2">
             <div className="space-y-1">
                 <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase">
                     <span>Progresso</span>
                     <span>{Math.round(progress)}%</span>
                 </div>
                 <Progress value={progress} className="h-1 bg-slate-100" />
             </div>

             {/* DUE DATE DISPLAY */}
             {isMounted && job.dataConsegnaFinale && (
                 <div className={cn(
                     "flex items-center justify-between p-1.5 rounded-lg border-2 transition-all",
                     (isPast(parseISO(job.dataConsegnaFinale)) || isSameWeek(parseISO(job.dataConsegnaFinale), new Date(), { weekStartsOn: 1 })) 
                        ? "bg-red-50 border-red-200 text-red-600 animate-[pulse_2s_infinite]" 
                        : "bg-slate-50 border-slate-100 text-slate-600"
                 )}>
                    <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        <span className="text-[10px] font-black uppercase tracking-tighter">
                            Consegna: {format(parseISO(job.dataConsegnaFinale), 'dd/MM/yyyy')}
                        </span>
                    </div>
                    {isPast(parseISO(job.dataConsegnaFinale)) && (
                        <Badge variant="destructive" className="h-4 px-1 text-[8px] font-black animate-bounce">RITARDO</Badge>
                    )}
                 </div>
             )}
         </div>

         <div className={cn("flex items-center justify-between text-[10px] font-bold", isMrpConflict ? "text-red-700" : "text-slate-500")}>
             <div className="flex items-center gap-1">
                 <Boxes className="h-3 w-3" /> {job.qta}
             </div>
             <div className="flex items-center gap-2">
                 {isMultiDay && (
                     <TooltipProvider>
                         <Tooltip>
                             <TooltipTrigger asChild><TrendingUp className="h-3.5 w-3.5 text-amber-500" /></TooltipTrigger>
                             <TooltipContent><p className="text-xs font-bold">Lavoro Multi-giorno ({hours.toFixed(1)}h)</p></TooltipContent>
                         </Tooltip>
                     </TooltipProvider>
                 )}
                 <div className={cn("flex items-center gap-1", isIpothesis && !isMrpConflict && "text-amber-600")}>
                     <Timer className="h-3 w-3" /> {hours.toFixed(1)}h
                 </div>
             </div>
         </div>

         <AttachmentViewerDialog 
           isOpen={isAttachmentsDialogOpen} 
           onOpenChange={setIsAttachmentsDialogOpen} 
           attachments={attachments} 
         />
      </CardContent>
    </Card>
  );
});

JobKanbanCard.displayName = 'JobKanbanCard';
