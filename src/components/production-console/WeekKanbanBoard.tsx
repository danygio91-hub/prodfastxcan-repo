import React, { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { format, addDays, parseISO, isBefore, startOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { JobOrder, Article, RawMaterial } from '@/lib/mock-data';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Boxes, Timer, Star, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { toggleJobPriority } from '@/app/admin/resource-planning/actions';
import { useToast } from '@/hooks/use-toast';

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
}

interface MrpStatus {
  alert: boolean;
  dateArrival: string | null;
  text: string;
}

export default function WeekKanbanBoard({
  jobOrders,
  mrpTimelines,
  rawMaterials,
  articles,
  currentWeekStart,
  snapshot,
  activeTab,
  activeSubTab,
  onJobDrop
}: WeekKanbanBoardProps) {
  const { toast } = useToast();
  // Genera le chiavi per i 5 giorni lavorativi (Lunedì - Venerdì)
  const workDays = useMemo(() => {
    return Array.from({ length: 5 }).map((_, i) => format(addDays(currentWeekStart, i), 'yyyy-MM-dd'));
  }, [currentWeekStart]);

  const [columns, setColumns] = useState<Record<string, JobOrder[]>>({ unassigned: [], future: [] });

  // Inizializza le colonne in base alle assegnazioni
  useEffect(() => {
    const cols: Record<string, JobOrder[]> = {
      unassigned: [],
      future: []
    };
    workDays.forEach(day => { cols[day] = []; });

    jobOrders.forEach(job => {
      if (!job.assignedDate) {
        cols.unassigned.push(job);
        return;
      }

      const assignedDate = job.assignedDate;
      const firstDay = workDays[0];
      const lastDay = workDays[workDays.length - 1];

      if (assignedDate < firstDay) {
        // Carryover: assigned before this week, but not finished
        // We "force" it into the first day of the week (Monday)
        const carryoverJob = { ...job, isCarryover: true } as any;
        cols[firstDay].push(carryoverJob);
      } else if (assignedDate > lastDay) {
        // Future job: belongs to a future week
        cols.future.push(job);
      } else if (cols[assignedDate]) {
        // Standard assignment within this week
        cols[assignedDate].push(job);
      } else {
        // Fallback for safety
        cols.unassigned.push(job);
      }
    });

    setColumns(cols);
  }, [jobOrders, workDays]);

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Optimistic UI update
    const sourceCol = [...(columns[source.droppableId] || [])];
    const destCol = source.droppableId === destination.droppableId ? sourceCol : [...(columns[destination.droppableId] || [])];

    const [movedItem] = sourceCol.splice(source.index, 1);
    destCol.splice(destination.index, 0, movedItem);

    setColumns({
        ...columns,
        [source.droppableId]: sourceCol,
        [destination.droppableId]: destCol,
    });

    // Se droppiamo in 'future', manteniamo la vecchia data se era già futura, 
    // altrimenti mettiamo null o una data lontana. 
    // Per ora, se va in 'unassigned' o 'future' lato action mettiamo null (Da Pianificare).
    const isSpecialCol = destination.droppableId === 'unassigned' || destination.droppableId === 'future';
    const newDate = isSpecialCol ? null : destination.droppableId;
    
    // Call server action
    onJobDrop(movedItem.id, newDate);
  };

  const handleTogglePriority = async (jobId: string, currentPriority: boolean) => {
      const newValue = !currentPriority;
      // Optimistic locally
      const updatedCols = { ...columns };
      Object.keys(updatedCols).forEach(key => {
          updatedCols[key] = updatedCols[key].map(j => j.id === jobId ? { ...j, isPriority: newValue } : j);
      });
      setColumns(updatedCols);

      const res = await toggleJobPriority(jobId, newValue);
      if (!res.success) {
          toast({ variant: 'destructive', title: 'Errore', description: res.message });
          // Revert could be handled by refreshing jobOrders prop from parent
      }
  };

  // Capacity calculations for headers
  const getCapacityForDay = (day: string) => {
      if (!snapshot || !activeTab) return { supply: 0, demand: 0 };
      
      let supply = 0;
      let demand = 0;

      if (activeTab === 'PRODUZIONE' && activeSubTab) {
          const dept = snapshot.macroAreas['PRODUZIONE']?.find((d: any) => d.code === activeSubTab);
          const dayData = dept?.data?.find((d: any) => d.date === day);
          if (dayData) { supply = dayData.supplyHours || 0; demand = dayData.areaSpecificDemand || 0; }
      } else {
          const areaDepts = snapshot.macroAreas[activeTab] || [];
          areaDepts.forEach((dept: any) => {
              const dayData = dept?.data?.find((d: any) => d.date === day);
              if (dayData) {
                  supply += dayData.supplyHours || 0;
                  demand += dayData.areaSpecificDemand || dayData.demandHours || 0;
              }
          });
      }
      return { supply, demand };
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full w-full overflow-x-auto overflow-y-hidden gap-4 pb-4 px-2">
        {/* UNASSIGNED COLUMN */}
        <Column 
          id="unassigned" 
          title="Da Pianificare" 
          jobs={columns.unassigned || []} 
          isUnassigned 
          articles={articles} 
          activeTab={activeTab} 
          activeSubTab={activeSubTab}
          mrpTimelines={mrpTimelines}
          rawMaterials={rawMaterials}
          onTogglePriority={handleTogglePriority}
        />

        {/* WORK DAYS COLUMNS */}
        {workDays.map(day => {
          const cap = getCapacityForDay(day);
          const liveDemand = (columns[day] || []).reduce((acc, job) => {
              const article = articles.find(a => a.code.toUpperCase() === job.details.toUpperCase());
              const relevantPhases = (job.phases || []).filter(phase => {
                  if (activeTab === 'PREPARAZIONE') return phase.type === 'preparation';
                  if (activeTab === 'QLTY_PACK') return phase.type === 'quality' || phase.type === 'packaging';
                  if (activeTab === 'PRODUZIONE') {
                      if (!activeSubTab) return phase.type === 'production';
                      return phase.type === 'production' && job.department === activeSubTab;
                  }
                  return false;
              });
              const totalMinutes = relevantPhases.reduce((tAcc, phase) => {
                  const time = article?.phaseTimes?.[phase.name]?.expectedMinutesPerPiece || 10;
                  return tAcc + (time * job.qta);
              }, 0);
              return acc + (totalMinutes / 60);
          }, 0);

          return (
            <Column 
              key={day} 
              id={day} 
              title={format(parseISO(day), 'EEEE dd MMM', { locale: it })}
              jobs={columns[day] || []} 
              capacity={cap.supply}
              demand={liveDemand}
              articles={articles}
              activeTab={activeTab}
              activeSubTab={activeSubTab}
              mrpTimelines={mrpTimelines}
              rawMaterials={rawMaterials}
              onTogglePriority={handleTogglePriority}
            />
          );
        })}

        {/* FUTURE COLUMN */}
        <Column 
          id="future" 
          title={`Future (${columns.future?.length || 0})`}
          jobs={columns.future || []} 
          isFuture
          articles={articles} 
          activeTab={activeTab} 
          activeSubTab={activeSubTab}
          mrpTimelines={mrpTimelines}
          rawMaterials={rawMaterials}
          onTogglePriority={handleTogglePriority}
        />
      </div>
    </DragDropContext>
  );
}

function Column({ id, title, jobs, isUnassigned, isFuture, capacity, demand, articles, activeTab, activeSubTab, mrpTimelines, rawMaterials, onTogglePriority }: any) {
  const isOverloaded = !isUnassigned && !isFuture && demand > capacity;

  return (
    <div className="flex flex-col w-[320px] shrink-0 h-full bg-slate-50/50 rounded-xl border border-slate-200">
      <div className={cn(
        "p-3 border-b rounded-t-xl shrink-0 flex flex-col justify-center",
        (isUnassigned || isFuture) ? "bg-slate-200/50" : (isOverloaded ? "bg-red-50 border-red-200" : "bg-white")
      )}>
        <h3 className="font-bold text-sm uppercase text-slate-700 truncate">{title}</h3>
        {!isUnassigned && !isFuture && (
          <div className="flex justify-between items-center mt-2 text-xs font-bold">
             <span className="text-slate-500">Cap. {capacity.toFixed(1)}h</span>
             <span className={isOverloaded ? "text-red-600 font-black animate-pulse" : "text-blue-600"}>
                {demand.toFixed(1)}h
             </span>
          </div>
        )}
      </div>

      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div 
            {...provided.droppableProps} 
            ref={provided.innerRef}
            className={cn(
              "flex-1 p-2 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-300 transition-colors",
              snapshot.isDraggingOver ? "bg-slate-100/80 ring-2 ring-primary/20 ring-inset rounded-b-xl" : ""
            )}
          >
            {jobs.map((job: any, index: number) => (
               <Draggable key={job.id} draggableId={job.id} index={index}>
                 {(provided, dSnapshot) => (
                   <div
                     ref={provided.innerRef}
                     {...provided.draggableProps}
                     {...provided.dragHandleProps}
                     style={{
                        ...provided.draggableProps.style,
                     }}
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

function JobKanbanCard({ job, articles, activeTab, activeSubTab, mrpTimelines, rawMaterials, isDragging, columnId, isCarryover, onTogglePriority }: any): JSX.Element {
  
  // Progress calculation
  const progress = useMemo(() => {
    if (!job.phases || job.phases.length === 0) return 0;
    const completed = job.phases.filter((p: any) => p.status === 'completed').length;
    return (completed / job.phases.length) * 100;
  }, [job.phases]);

  // Hours calculation
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
        const timeObj = article?.phaseTimes?.[phase.name];
        if (!timeObj) hasUsedFallback = true;
        const time = timeObj?.expectedMinutesPerPiece || 10;
        return acc + (time * job.qta);
    }, 0);

    return { hours: totalMinutes / 60, isIpothesis: hasUsedFallback };
  }, [job, articles, activeTab, activeSubTab]);

  // MRP Status calculation
  const mrpStatus: MrpStatus = useMemo(() => {
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
        if (earliestCoverDate) {
            return { alert: true, dateArrival: earliestCoverDate, text: `Arrivo mat: ${format(parseISO(earliestCoverDate), 'dd/MM')}` };
        }
        return { alert: true, dateArrival: null, text: 'Materiale Mancante (No ordini)' };
    }
    return { alert: false, dateArrival: null, text: 'Mat. OK' };
  }, [job, rawMaterials, mrpTimelines]);

  const isMrpConflict = columnId !== 'unassigned' && columnId !== 'future' && mrpStatus.alert && mrpStatus.dateArrival && isBefore(parseISO(columnId), startOfDay(parseISO(mrpStatus.dateArrival)));
  const isMrpCritical = columnId !== 'unassigned' && columnId !== 'future' && mrpStatus.alert && !mrpStatus.dateArrival;

  const isMultiDay = hours > 8;

  return (
    <Card className={cn(
      "transition-all cursor-grab active:cursor-grabbing border-l-4 group bg-white shadow-sm hover:shadow-md",
      isDragging && "shadow-xl ring-2 ring-primary/50 rotate-2 opacity-90",
      job.isPriority && "ring-2 ring-red-500 animate-pulse border-l-red-600",
      !job.isPriority && (job.status === 'production' ? "border-l-blue-500" : "border-l-slate-300"),
      (isMrpConflict || isMrpCritical) ? "bg-red-50/80 border-l-red-500" : ""
    )}>
      <CardContent className="p-3 space-y-2">
         <div className="flex justify-between items-start">
            <div className="space-y-0.5 max-w-[70%]">
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
            
            <div className="flex items-center gap-1.5 shrink-0">
                <button 
                  onClick={(e) => { e.stopPropagation(); onTogglePriority(job.id, !!job.isPriority); }}
                  className={cn("p-1 rounded-full transition-colors", job.isPriority ? "text-red-600 bg-red-100" : "text-slate-300 hover:text-slate-500 hover:bg-slate-100")}
                >
                    <Star className={cn("h-3.5 w-3.5", job.isPriority && "fill-current")} />
                </button>

                {mrpStatus.alert ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <AlertTriangle className={cn("h-4 w-4 shrink-0", isMrpConflict || isMrpCritical ? "text-red-600 animate-pulse" : "text-amber-500")} />
                            </TooltipTrigger>
                            <TooltipContent className="bg-white border text-black shadow-xl">
                                <p className="font-bold text-xs">{mrpStatus.text}</p>
                                {isMrpConflict && <p className="text-red-600 text-[10px] font-bold mt-1">Conflitto: Giorno pianificato precedente all'arrivo merce!</p>}
                                {isMrpCritical && <p className="text-red-600 text-[10px] font-bold mt-1">Nessun ordine fornitore presente.</p>}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                )}
            </div>
         </div>

         {/* Progress Bar Mini */}
         <div className="space-y-1">
             <div className="flex justify-between items-center text-[7px] font-bold text-slate-400 uppercase">
                 <span>Progresso</span>
                 <span>{Math.round(progress)}%</span>
             </div>
             <Progress value={progress} className="h-1 bg-slate-100" />
         </div>

         <div className={cn("flex items-center justify-between text-[10px] font-bold", isMrpConflict ? "text-red-700" : "text-slate-500")}>
             <div className="flex items-center gap-1">
                 <Boxes className="h-3 w-3" /> {job.qta}
             </div>
             
             <div className="flex items-center gap-2">
                 {isMultiDay && (
                     <TooltipProvider>
                         <Tooltip>
                             <TooltipTrigger asChild>
                                 <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                             </TooltipTrigger>
                             <TooltipContent>
                                 <p className="text-xs font-bold">Lavoro Multi-giorno ({hours.toFixed(1)}h)</p>
                                 <p className="text-[10px]">Supera le 8h medie giornaliere.</p>
                             </TooltipContent>
                         </Tooltip>
                     </TooltipProvider>
                 )}
                 <div className={cn("flex items-center gap-1", isIpothesis && !isMrpConflict && "text-amber-600")}>
                     <Timer className="h-3 w-3" /> {hours.toFixed(1)}h
                 </div>
             </div>
         </div>
      </CardContent>
    </Card>
  );
}
