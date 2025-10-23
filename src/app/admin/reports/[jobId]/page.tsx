
"use client";

import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getJobDetailReport, updateWorkPeriodsForPhase } from '../actions';
import { notFound, useRouter } from 'next/navigation';
import { BarChart3, ArrowLeft, Package, User, Clock, Calendar, CheckCircle2, Circle, Hourglass, ShieldAlert, XCircle, Pencil, Save, Loader2, ThumbsDown, Copy } from 'lucide-react';
import type { JobPhase, WorkPeriod } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { format, parseISO, toDate } from 'date-fns';
import { it } from 'date-fns/locale';
import { useAuth } from '@/components/auth/AuthProvider';
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';


type EditableWorkPeriod = Omit<WorkPeriod, 'start' | 'end'> & {
  start: string;
  end: string | null;
};


function getPhaseIcon(status: JobPhase['status'], qualityResult?: JobPhase['qualityResult']) {
  if (status === 'completed') {
    if (qualityResult === 'passed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (qualityResult === 'failed') return <ThumbsDown className="h-4 w-4 text-destructive" />;
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  }
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-yellow-500 animate-spin" />;
    case 'paused': return <Hourglass className="h-4 w-4 text-orange-500" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function JobReportDetailPage({ params }: { params: { jobId: string } }) {
  const { jobId } = params;
  const { operator } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [report, setReport] = useState<Awaited<ReturnType<typeof getJobDetailReport>> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<JobPhase | null>(null);
  const [editablePeriods, setEditablePeriods] = useState<EditableWorkPeriod[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const fetchReport = React.useCallback(async () => {
    setIsLoading(true);
    const reportData = await getJobDetailReport(jobId);
    setReport(reportData);
    setIsLoading(false);
  }, [jobId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);
  
  const handleOpenEditModal = (phase: JobPhase) => {
    setSelectedPhase(phase);
    const periodsToEdit = (phase.workPeriods || []).map(wp => ({
        ...wp,
        start: format(new Date(wp.start), "yyyy-MM-dd'T'HH:mm:ss"),
        end: wp.end ? format(new Date(wp.end), "yyyy-MM-dd'T'HH:mm:ss") : null,
    }));
    setEditablePeriods(periodsToEdit);
    setIsEditModalOpen(true);
  };
  
  const handlePeriodChange = (index: number, field: 'start' | 'end', value: string) => {
    const updatedPeriods = [...editablePeriods];
    updatedPeriods[index] = { ...updatedPeriods[index], [field]: value };
    setEditablePeriods(updatedPeriods);
  };
  
  const handleSaveChanges = async () => {
    if (!report || !selectedPhase || !operator?.uid) return;
    setIsSaving(true);
    
    // Convert back to Date objects for the server action
    const periodsToSave = editablePeriods.map(p => ({
        ...p,
        start: toDate(p.start),
        end: p.end ? toDate(p.end) : null
    }));

    const result = await updateWorkPeriodsForPhase(report.id, selectedPhase.id, periodsToSave, operator.uid);
    
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
        await fetchReport(); // Refetch data to show updated times
        setIsEditModalOpen(false);
    }
    setIsSaving(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
        title: "Copiato!",
        description: `Il codice "${text}" è stato copiato negli appunti.`,
    });
  }

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };

  if (isLoading || !report) {
    if (!isLoading && !report) {
        notFound();
    }
    return (
      <AdminAuthGuard>
        <AppShell>
           <div className="flex items-center justify-center h-64">
             <Loader2 className="h-12 w-12 animate-spin text-primary" />
           </div>
        </AppShell>
      </AdminAuthGuard>
    );
  }

  const isSupervisorOrAdmin = operator?.role === 'admin' || operator?.role === 'supervisor';
  const timeTrackingPhases = (report.phases || []).filter(p => p.tracksTime !== false);
  const isTimeReliable = timeTrackingPhases.every(p => p.timeElapsed !== '00:00:00');

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">

          <Button asChild variant="outline" className="w-fit">
            <Link href="/admin/reports">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Torna ai Report
            </Link>
          </Button>

          <header>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              Dettaglio Commessa: {report.id}
            </h1>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Riepilogo Commessa</CardTitle>
              {report.isProblemReported && (
                <CardDescription className="text-destructive font-semibold flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" /> Problema Segnalato
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
                <div className="flex items-center gap-3">
                    <Package className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Articolo</p>
                        <ContextMenu>
                            <ContextMenuTrigger>
                                <p className="font-semibold hover:text-primary hover:underline cursor-pointer">{report.details}</p>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                                <ContextMenuItem onSelect={() => handleNavigateToAnalysis(report.details)}>
                                    <BarChart3 className="mr-2 h-4 w-4"/>
                                    Analisi Tempi Articolo
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => handleCopy(report.details)}>
                                    <Copy className="mr-2 h-4 w-4"/>
                                    Copia Codice Articolo
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenu>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <User className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Cliente</p>
                        <p className="font-semibold">{report.cliente}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Tempo Totale Lavorazione</p>
                        <p className={cn("font-semibold", isTimeReliable ? 'text-green-600' : 'text-amber-600')}>
                          {report.totalTimeElapsed}
                          <span className="text-xs font-normal ml-2">({isTimeReliable ? 'Affidabile' : 'Parziale'})</span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Calendar className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Data Consegna Prevista</p>
                        <p className="font-semibold">{report.dataConsegnaFinale ? format(parseISO(report.dataConsegnaFinale), 'dd MMM yyyy', { locale: it }) : 'N/D'}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cn(report.status === 'completed' ? 'border-green-500 text-green-500' : 'border-yellow-500 text-yellow-500')}>Stato</Badge>
                    <div>
                        <p className="text-muted-foreground">Stato Globale</p>
                        <p className="font-semibold">{report.status ? (report.status.charAt(0).toUpperCase() + report.status.slice(1)) : 'N/D'}</p>
                    </div>
                </div>
            </CardContent>
          </Card>
          
          <Card>
             <CardHeader>
                <CardTitle>Dettaglio Fasi</CardTitle>
                <CardDescription>Analisi dei tempi e degli operatori per ogni fase di lavorazione.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fase</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead>Esito</TableHead>
                          <TableHead>Tempo Impiegato</TableHead>
                          <TableHead>Operatori</TableHead>
                           {isSupervisorOrAdmin && <TableHead className="text-right">Azioni</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.phases.length > 0 ? report.phases.sort((a,b) => a.sequence - b.sequence).map((phase) => (
                          <TableRow key={phase.id}>
                            <TableCell className="font-medium">{phase.name}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    {getPhaseIcon(phase.status, phase.qualityResult)}
                                    <span>{phase.status ? phase.status.charAt(0).toUpperCase() + phase.status.slice(1) : 'N/D'}</span>
                                </div>
                            </TableCell>
                            <TableCell>
                                {phase.qualityResult === 'passed' && <Badge className="bg-green-600 hover:bg-green-700">Superato</Badge>}
                                {phase.qualityResult === 'failed' && <Badge variant="destructive">Fallito</Badge>}
                            </TableCell>
                            <TableCell>
                              {phase.tracksTime !== false ? (
                                (phase as any).timeElapsed
                              ) : (
                                <span className="text-muted-foreground italic">Non tracciato</span>
                              )}
                            </TableCell>
                            <TableCell>{(phase as any).operators}</TableCell>
                            {isSupervisorOrAdmin && (
                                <TableCell className="text-right">
                                    <Button variant="outline" size="icon" onClick={() => handleOpenEditModal(phase)} disabled={(phase.workPeriods || []).length === 0}>
                                        <Pencil className="h-4 w-4" />
                                        <span className="sr-only">Modifica tempi fase {phase.name}</span>
                                    </Button>
                                </TableCell>
                            )}
                          </TableRow>
                        )) : (
                             <TableRow>
                                <TableCell colSpan={isSupervisorOrAdmin ? 6 : 5} className="text-center h-24">Nessuna fase definita per questa commessa.</TableCell>
                            </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Modifica Periodi di Lavoro</DialogTitle>
                    <DialogDescription>
                        Fase: <span className="font-semibold">{selectedPhase?.name}</span>. Modifica data e ora di inizio e fine per ogni periodo.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 max-h-[60vh] overflow-y-auto">
                    <div className="space-y-4">
                        {editablePeriods.map((period, index) => (
                            <div key={index} className="p-4 border rounded-lg grid grid-cols-1 md:grid-cols-2 gap-4">
                               <p className="md:col-span-2 font-medium">Operatore: {report.operatorsMap?.[period.operatorId] || period.operatorId}</p>
                                <div className="space-y-2">
                                    <Label htmlFor={`start-${index}`}>Inizio</Label>
                                    <Input 
                                        id={`start-${index}`}
                                        type="datetime-local" 
                                        value={period.start} 
                                        onChange={(e) => handlePeriodChange(index, 'start', e.target.value)}
                                    />
                                </div>
                                 <div className="space-y-2">
                                    <Label htmlFor={`end-${index}`}>Fine</Label>
                                    <Input 
                                        id={`end-${index}`}
                                        type="datetime-local" 
                                        value={period.end ?? ''} 
                                        onChange={(e) => handlePeriodChange(index, 'end', e.target.value)}
                                        disabled={period.end === null}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>Annulla</Button>
                    <Button onClick={handleSaveChanges} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                        Salva Modifiche
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </AppShell>
    </AdminAuthGuard>
  );
}
