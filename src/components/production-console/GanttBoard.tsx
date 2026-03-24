import React, { useState, useMemo } from 'react';
import type { JobOrder, Operator, OperatorAssignment, Article } from '@/lib/mock-data';
import { type ProductionSettings } from '@/app/admin/production-settings/actions';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { startOfWeek, addDays, addWeeks, addMonths, differenceInMinutes, differenceInDays, format, startOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { GanttScheduler } from '@/lib/gantt-scheduler';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, Save } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { bulkUpdateJobOrders } from '@/app/admin/production-console/actions';

interface GanttBoardProps {
  jobOrders: JobOrder[];
  operators: Operator[];
  assignments: OperatorAssignment[];
  settings: ProductionSettings;
  articles: Article[];
}

export default function GanttBoard({ jobOrders, operators, assignments, settings, articles }: GanttBoardProps) {
  const [viewMode, setViewMode] = useState<'daily'|'weekly'|'monthly'>('weekly');
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localJobs, setLocalJobs] = useState<JobOrder[]>(jobOrders);
  const { user } = useAuth();
  const { toast } = useToast();

  React.useEffect(() => {
    setLocalJobs(jobOrders);
  }, [jobOrders]);

  const handleRecalculate = async () => {
    setIsCalculating(true);
    try {
        const scheduler = new GanttScheduler(operators, assignments, settings);
        const updatedJobs = await Promise.all(localJobs.map(async (job) => {
            // Only reschedule if not completed
            const isCompleted = (job.phases || []).every(p => p.status === 'completed');
            if (isCompleted) return job;
            
            const result = await scheduler.scheduleJobBackward(job, articles);
            return result.job;
        }));
        setLocalJobs(updatedJobs);
        toast({ title: "Schedulazione Ricalcolata", description: "Le date sono state aggiornate in base alla capacità attuale. Clicca 'Salva' per confermare." });
    } catch (e) {
        toast({ variant: "destructive", title: "Errore Schedulazione", description: e instanceof Error ? e.message : "Errore sconosciuto" });
    } finally {
        setIsCalculating(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const res = await bulkUpdateJobOrders(localJobs, user.uid);
    setIsSaving(false);
    toast({ title: res.success ? "Salvataggio completato" : "Errore", description: res.message, variant: res.success ? "default" : "destructive" });
  };
  
  // Calculate timeline boundaries
  const timelineStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  
  const { totalDays, pixelsPerMinute, gridTickMinutes } = useMemo(() => {
    switch (viewMode) {
      case 'daily': return { totalDays: 3, pixelsPerMinute: 2, gridTickMinutes: 60 }; // 1 hr ticks
      case 'weekly': return { totalDays: 14, pixelsPerMinute: 0.5, gridTickMinutes: 24 * 60 }; // 1 day ticks
      case 'monthly': return { totalDays: 60, pixelsPerMinute: 0.1, gridTickMinutes: 7 * 24 * 60 }; // 1 week ticks
    }
  }, [viewMode]);

  const totalMinutes = totalDays * 24 * 60;
  const totalWidth = totalMinutes * pixelsPerMinute;
  
  // Extract all blocks
  const blocksByOperator = useMemo(() => {
      const map = new Map<string, { start: Date, end: Date, jobId: string, phaseName: string, orderTitle: string, status: string, isPlanned: boolean }[]>();
      
      operators.forEach(op => map.set(op.id, []));
      
      localJobs.forEach(job => {
          (job.phases || []).forEach(phase => {
              (phase.workPeriods || []).forEach(wp => {
                  if (wp.operatorId && map.has(wp.operatorId) && wp.start && wp.end) {
                      const startParams = typeof wp.start === 'object' && 'seconds' in wp.start ? new Date((wp.start as any).seconds * 1000) : new Date(wp.start);
                      const endParams = typeof wp.end === 'object' && 'seconds' in wp.end ? new Date((wp.end as any).seconds * 1000) : new Date(wp.end);
                      
                      map.get(wp.operatorId)!.push({
                          start: startParams,
                          end: endParams,
                          jobId: job.id,
                          phaseName: phase.name,
                          orderTitle: `${job.ordinePF} - ${job.cliente}`,
                          status: phase.status,
                          isPlanned: phase.status === 'pending'
                      });
                  }
              });
          });
      });
      return map;
  }, [jobOrders, operators]);

  const ticks = useMemo(() => {
      const t = [];
      for (let i = 0; i <= totalMinutes; i += gridTickMinutes) {
          t.push(i);
      }
      return t;
  }, [totalMinutes, gridTickMinutes]);
  
  return (
    <Card className="w-full h-[80vh] flex flex-col mt-4">
      <CardHeader className="py-3 border-b flex flex-row items-center justify-between bg-muted/20">
        <div>
          <CardTitle className="text-xl">Pianificazione Gantt a Capacità Finita</CardTitle>
        </div>
        <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={isCalculating} className="bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900">
                {isCalculating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                Ricalcola
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving || isCalculating} className="bg-green-600 hover:bg-green-700">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salva
            </Button>
            <div className="w-px h-6 bg-border mx-2" />
            <button onClick={() => setViewMode('daily')} className={`px-3 py-1 rounded text-sm transition-colors ${viewMode === 'daily'? 'bg-primary text-primary-foreground shadow' : 'bg-muted hover:bg-muted/80'}`}>Giornaliera</button>
            <button onClick={() => setViewMode('weekly')} className={`px-3 py-1 rounded text-sm transition-colors ${viewMode === 'weekly'? 'bg-primary text-primary-foreground shadow' : 'bg-muted hover:bg-muted/80'}`}>Settimanale</button>
            <button onClick={() => setViewMode('monthly')} className={`px-3 py-1 rounded text-sm transition-colors ${viewMode === 'monthly'? 'bg-primary text-primary-foreground shadow' : 'bg-muted hover:bg-muted/80'}`}>Mensile</button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden relative bg-card">
        <ScrollArea className="w-full h-full">
           <div className="flex h-full min-h-max border-b relative">
               {/* Left Fixed Column: Operators */}
               <div className="w-48 sm:w-64 flex-shrink-0 bg-muted/30 border-r z-20 sticky left-0 flex flex-col shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                   <div className="h-12 border-b flex items-center px-4 font-semibold text-sm bg-muted/40 backdrop-blur">
                       Spazio / Risorsa
                   </div>
                   {operators.filter(op => op.role === 'operator' && op.isReal).map(op => (
                       <div key={op.id} className="h-16 border-b flex flex-col justify-center px-4 bg-background/95 hover:bg-muted/50 transition-colors">
                           <span className="font-medium text-sm truncate">{op.nome}</span>
                           <span className="text-xs text-muted-foreground truncate">{op.reparto?.join(', ') || 'Nessun Reparto'}</span>
                       </div>
                   ))}
               </div>

               {/* Right Scrollable Column: Timeline Grid */}
               <div className="flex-1 relative" style={{ width: totalWidth, minWidth: totalWidth }}>
                   {/* Timeline Header (Time Ticks) */}
                   <div className="h-12 border-b relative bg-muted/10">
                       {ticks.map(tickMinutes => {
                           const tickDate = new Date(timelineStart.getTime() + tickMinutes * 60000);
                           let label = '';
                           if (viewMode === 'daily') {
                               label = format(tickDate, 'HH:mm');
                           } else if (viewMode === 'weekly') {
                               label = format(tickDate, 'EEEE dd', { locale: it });
                           } else {
                               label = `W${format(tickDate, 'I')}`; // Week number
                           }
                           
                           return (
                               <div key={tickMinutes} className="absolute top-0 bottom-0 border-l border-muted/50 px-2 pt-3 text-xs text-muted-foreground font-medium" style={{ left: tickMinutes * pixelsPerMinute }}>
                                   {label}
                               </div>
                           );
                       })}
                   </div>
                   
                   {/* Timeline Rows (Blocks) */}
                   <div style={{ position: 'relative' }}>
                       {/* Background vertical grid lines */}
                       {ticks.map(tickMinutes => (
                           <div key={`grid-${tickMinutes}`} className="absolute top-0 bottom-full h-[1000px] border-l border-muted/20 pointer-events-none z-0" style={{ left: tickMinutes * pixelsPerMinute }}></div>
                       ))}
                       
                       {/* Operator Rows data */}
                       {operators.filter(op => op.role === 'operator' && op.isReal).map((op, rowIndex) => {
                           const blocks = blocksByOperator.get(op.id) || [];
                           
                           return (
                               <div key={`row-${op.id}`} className="h-16 border-b relative z-10 group hover:bg-primary/5 transition-colors">
                                   {blocks.map((block, i) => {
                                       const offsetMinutes = differenceInMinutes(block.start, timelineStart);
                                       const durationMinutes = Math.max(differenceInMinutes(block.end, block.start), 5); // min visual width
                                       
                                       // Don't render if outside view
                                       if (offsetMinutes + durationMinutes < 0 || offsetMinutes > totalMinutes) return null;
                                       
                                       const left = offsetMinutes * pixelsPerMinute;
                                       const width = durationMinutes * pixelsPerMinute;
                                       
                                       const bgColor = block.isPlanned ? 'bg-amber-500/90 hover:bg-amber-600' : 'bg-emerald-500/90 hover:bg-emerald-600';
                                       
                                       return (
                                           <Popover key={i}>
                                             <PopoverTrigger asChild>
                                                <div 
                                                    className={`absolute top-2 bottom-2 rounded-md shadow-sm border border-black/10 cursor-pointer overflow-hidden flex items-center px-2 transition-all hover:ring-2 hover:ring-primary hover:z-20 ${bgColor}`}
                                                    style={{ left: `${Math.max(0, left)}px`, width: `${Math.min(width, totalWidth - left)}px` }}
                                                >
                                                    <span className="text-white text-xs font-medium truncate pointer-events-none">
                                                        {block.orderTitle}
                                                    </span>
                                                </div>
                                             </PopoverTrigger>
                                             <PopoverContent className="w-64 p-3 gap-2 flex flex-col shadow-xl">
                                                <div className="font-semibold">{block.orderTitle}</div>
                                                <div className="text-sm">Fase: <span className="font-medium">{block.phaseName}</span></div>
                                                <div className="flex justify-between items-center mt-2">
                                                    <Badge variant="outline">{block.status}</Badge>
                                                    <span className="text-xs text-muted-foreground">{format(block.start, 'dd/MM HH:mm')} - {format(block.end, 'dd/MM HH:mm')}</span>
                                                </div>
                                             </PopoverContent>
                                           </Popover>
                                       );
                                   })}
                               </div>
                           );
                       })}
                   </div>
               </div>
           </div>
           <ScrollBar orientation="horizontal" className="h-3" />
           <ScrollBar orientation="vertical" />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
