"use client";

import React, { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { forcePauseOperators } from "@/app/admin/production-console/actions";
import { getOperatorDashboardData, editOperatorWorkPeriodTime, reopenOperatorPhase } from "@/app/admin/production-console/actions";
import { Loader2, Pause, Edit2, RotateCcw, Save, X, Activity, Lock } from "lucide-react";
import { useAuth } from '@/components/auth/AuthProvider';
import { format, parseISO } from 'date-fns';
import { Operator } from '@/types';

export default function OperatorCommandCenter({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);

  // Timeline state
  const [timelineData, setTimelineData] = useState<Record<string, any[]>>({});
  const [activeJobsData, setActiveJobsData] = useState<Record<string, any[]>>({});
  const [loadingTimelines, setLoadingTimelines] = useState<Record<string, boolean>>({});
  const [editingLog, setEditingLog] = useState<{ id: string, start: string, end: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const q = query(collection(db, 'operators'), orderBy('nome'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...d.data() } as Operator));
      setOperators(ops);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [open]);

  const loadTimeline = async (operatorId: string, activeJobId?: string | null, activePhaseName?: string | null) => {
    setLoadingTimelines(prev => ({ ...prev, [operatorId]: true }));
    try {
      const data = await getOperatorDashboardData(operatorId, activeJobId, activePhaseName);
      setTimelineData(prev => ({ ...prev, [operatorId]: data.timeline }));
      setActiveJobsData(prev => ({ ...prev, [operatorId]: data.activeOrPausedJobs }));
    } catch (err) {
      console.error(err);
      toast({ title: "Errore", description: "Impossibile caricare la timeline.", variant: "destructive" });
    } finally {
      setLoadingTimelines(prev => ({ ...prev, [operatorId]: false }));
    }
  };

  const handleForcePause = async (e: React.MouseEvent, operator: Operator) => {
    e.stopPropagation();
    if (!operator.activeJobId) {
      toast({ title: "Attenzione", description: "L'operatore non è attivo su nessuna commessa." });
      return;
    }
    const res = await forcePauseOperators(operator.activeJobId, [operator.id], user?.uid, "Pausa Forzata da Admin", "Pausa Forzata da Torre di Controllo");
    if (res.success) {
      toast({ title: "Successo", description: "Operatore messo in pausa." });
    } else {
      toast({ title: "Errore", description: res.message, variant: "destructive" });
    }
  };

  const handleSaveTime = async (opId: string, logId: string, jobId: string, phaseId: string, wpIndex: number) => {
    if (!editingLog) return;
    const res = await editOperatorWorkPeriodTime(jobId, phaseId, wpIndex, editingLog.start, editingLog.end, user?.uid || '');
    if (res.success) {
      toast({ title: "Successo", description: "Tempo aggiornato correttamente." });
      setEditingLog(null);
      loadTimeline(opId);
    } else {
      toast({ title: "Errore", description: res.message, variant: "destructive" });
    }
  };

  const handleReopenPhase = async (opId: string, jobId: string, phaseId: string) => {
    const res = await reopenOperatorPhase(jobId, phaseId, opId, user?.uid || '');
    if (res.success) {
      toast({ title: "Fase Riaperta", description: res.message });
      const op = operators.find(o => o.id === opId);
      loadTimeline(opId, op?.activeJobId, op?.activePhaseName);
    } else {
      toast({ title: "Errore", description: res.message, variant: "destructive" });
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-6 border-b pb-4">
          <SheetTitle className="flex items-center gap-2 text-2xl font-bold font-headline">
            <Activity className="h-6 w-6 text-blue-600" />
            Torre di Controllo Operatori
          </SheetTitle>
          <p className="text-sm text-muted-foreground">Gestisci lo stato, i tempi e le sessioni degli operatori in tempo reale.</p>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : (
          <Accordion type="single" collapsible className="w-full space-y-2" onValueChange={(val) => { 
            if(val) {
              const op = operators.find(o => o.id === val);
              loadTimeline(val, op?.activeJobId, op?.activePhaseName); 
            }
          }}>
            {operators.map(op => {
              const isPaused = op.stato === 'in pausa';
              const isActive = op.stato === 'attivo' || (!!op.activeJobId && !isPaused);
              const isInactive = !isActive && !isPaused;
              
              const displayStatus = isActive ? 'ATTIVO' : isPaused ? 'IN PAUSA' : 'INATTIVO';

              return (
                <AccordionItem key={op.id} value={op.id} className="border-slate-800 rounded-lg px-4 bg-slate-900/50 overflow-hidden">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex flex-1 items-center justify-between pr-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold
                          ${isActive ? 'bg-green-600' : isPaused ? 'bg-amber-500' : 'bg-slate-400'}`}>
                          {getInitials(op.nome)}
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="font-semibold text-slate-100">{op.nome}</span>
                          <div className="flex items-center gap-2 text-xs mt-1">
                            <Badge variant={isActive ? "default" : isPaused ? "secondary" : "outline"}
                                   className={isActive ? "bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30" : isPaused ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-amber-500/30" : "bg-slate-800 text-slate-400 border-slate-700"}>
                              {displayStatus}
                            </Badge>
                            {isActive && op.activeJobId && (
                              <span className="text-slate-400 truncate max-w-[150px] sm:max-w-[200px]" title={`${decodeURIComponent(op.activeJobId)} - ${op.activePhaseName}`}>
                                {op.activePhaseName} - {decodeURIComponent(op.activeJobId)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {isActive && (
                        <Button size="sm" variant="outline" className="h-8 text-amber-500 border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-400 bg-transparent"
                                onClick={(e) => handleForcePause(e, op)}>
                          <Pause className="h-4 w-4 mr-1" /> Pausa Forzata
                        </Button>
                      )}
                    </div>
                  </AccordionTrigger>
                  
                  <AccordionContent className="pt-2 pb-4 space-y-4">
                    {/* SEZIONE 1: ATTIVITÀ IN CORSO / IN SOSPESO */}
                    {activeJobsData[op.id]?.length > 0 && (
                      <div className="bg-slate-800/50 rounded-md p-4 border border-slate-700/50">
                        <h4 className="font-semibold text-sm mb-3 text-slate-300">Attività in Corso / In Sospeso</h4>
                        <div className="space-y-3">
                          {activeJobsData[op.id].map((job, idx) => {
                             const isPaused = job.phaseStatus === 'paused';
                             const percent = job.expectedMinutes > 0 ? Math.min(100, (job.detectedMinutes / job.expectedMinutes) * 100) : 0;
                             const remaining = Math.max(0, job.expectedMinutes - job.detectedMinutes);
                             
                             return (
                               <div key={idx} className={`p-3 border rounded-md shadow-sm text-sm ${isPaused ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-800 border-blue-500/30'}`}>
                                 <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <div className="font-semibold text-slate-200">{job.jobOrderPF} <span className="text-slate-400 font-normal">| {job.phaseName}</span></div>
                                     <div className="text-xs text-slate-400 truncate max-w-[250px]" title={job.details}>{job.details}</div>
                                   </div>
                                   <Badge variant={isPaused ? "secondary" : "default"} className={isPaused ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}>
                                     {isPaused ? 'IN PAUSA' : 'IN PRODUZIONE'}
                                   </Badge>
                                 </div>
                                 <div className="flex justify-between text-xs mb-1 mt-3">
                                   <span className="text-slate-400">Inizio: {job.sessionStart ? format(parseISO(job.sessionStart), 'dd/MM HH:mm') : 'N/D'}</span>
                                   <span className="font-medium text-slate-300">
                                     Speso: {Math.round(job.detectedMinutes)}m / {Math.round(job.expectedMinutes)}m
                                     {remaining > 0 && ` (Residuo ~${Math.round(remaining)}m)`}
                                   </span>
                                 </div>
                                 <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
                                    <div className={`${isPaused ? 'bg-amber-500' : 'bg-blue-500'} h-1.5 rounded-full`} style={{ width: `${percent}%` }}></div>
                                 </div>
                               </div>
                             );
                          })}
                        </div>
                      </div>
                    )}

                    {/* SEZIONE 2: TIMELINE DI OGGI */}
                    <div className="bg-slate-800/50 rounded-md p-4 border border-slate-700/50">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-semibold text-sm text-slate-300">Timeline di Oggi</h4>
                        {timelineData[op.id]?.length > 0 && (
                          <Badge variant="outline" className="bg-slate-900 border-slate-700 text-slate-300 font-normal shadow-sm">
                            Totale Chiuso: {(() => {
                              const totalMin = timelineData[op.id].reduce((acc: number, log: any) => {
                                if (log.start && log.end) {
                                  return acc + Math.max(0, Math.round((new Date(log.end).getTime() - new Date(log.start).getTime()) / 60000));
                                }
                                return acc;
                              }, 0);
                              return `${Math.floor(totalMin / 60).toString().padStart(2, '0')}:${(totalMin % 60).toString().padStart(2, '0')}`;
                            })()}
                          </Badge>
                        )}
                      </div>
                      
                      {loadingTimelines[op.id] ? (
                        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                      ) : timelineData[op.id]?.length > 0 ? (
                        <div className="space-y-3">
                          {timelineData[op.id].map((log, idx) => {
                            const logId = `${log.jobId}-${log.phaseId}-${log.workPeriodIndex}`;
                            const isEditing = editingLog?.id === logId;

                            return (
                              <div key={logId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-800 border border-slate-700 rounded-md shadow-sm text-sm">
                                <div className="flex-1">
                                  <div className="font-medium text-slate-200">{log.jobOrderPF} <span className="text-slate-400 font-normal">| {log.phaseName}</span></div>
                                  <div className="text-xs text-slate-400 truncate" title={log.details}>{log.details}</div>
                                </div>
                                
                                {isEditing ? (
                                  <div className="flex items-center gap-2">
                                    <Input 
                                      type="datetime-local" 
                                      className="h-8 text-xs w-[180px] bg-slate-900 border-slate-600 text-slate-200" 
                                      value={editingLog.start.slice(0, 16)} 
                                      onChange={(e) => setEditingLog({ ...editingLog, start: new Date(e.target.value).toISOString() })}
                                    />
                                    <span className="text-slate-400">-</span>
                                    <Input 
                                      type="datetime-local" 
                                      className="h-8 text-xs w-[180px] bg-slate-900 border-slate-600 text-slate-200" 
                                      value={editingLog.end ? editingLog.end.slice(0, 16) : ''} 
                                      onChange={(e) => setEditingLog({ ...editingLog, end: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                                    />
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-slate-700" onClick={() => handleSaveTime(op.id, logId, log.jobId, log.phaseId, log.workPeriodIndex)}>
                                      <Save className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-slate-700" onClick={() => setEditingLog(null)}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-4">
                                    <div className={`text-xs font-mono px-2 py-1 rounded border flex items-center gap-2 ${!log.end ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-slate-900 text-slate-300 border-slate-700'}`}>
                                      <span>{format(parseISO(log.start), 'HH:mm')} - {log.end ? format(parseISO(log.end), 'HH:mm') : 'In Corso...'}</span>
                                      {log.end && (
                                        <span className="text-slate-500 font-medium">
                                          • {Math.max(0, Math.round((new Date(log.end).getTime() - new Date(log.start).getTime()) / 60000))} min
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {!log.end ? (
                                        <div className="flex items-center gap-1 text-slate-500 px-2" title="Impossibile modificare un'attività in corso. Forza la pausa prima di editare.">
                                          <Lock className="h-3.5 w-3.5" />
                                        </div>
                                      ) : (
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-slate-700" title="Modifica Tempo" onClick={() => setEditingLog({ id: logId, start: log.start, end: log.end || new Date().toISOString() })}>
                                          <Edit2 className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                      {log.phaseStatus === 'completed' && (
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-amber-400 hover:bg-slate-700" title="Riapri Fase" onClick={() => handleReopenPhase(op.id, log.jobId, log.phaseId)}>
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 text-center py-4">Nessuna attività registrata per oggi.</div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </SheetContent>
    </Sheet>
  );
}
