'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, UserPlus, Info, AlertTriangle, CheckCircle2, Loader2, Boxes, Factory, Archive } from 'lucide-react';
import { format, addWeeks, subWeeks, startOfWeek, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { getDepartmentPlanningSnapshot, saveOperatorAssignment, getOperatorAssignments } from './actions';
import { getOperators } from '../operator-management/actions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Operator, OperatorAssignment } from '@/lib/mock-data';

export default function ResourcePlanningClientPage() {
    const { toast } = useToast();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [snapshot, setSnapshot] = useState<any>(null);
    const [operators, setOperators] = useState<Operator[]>([]);
    const [assignments, setAssignments] = useState<OperatorAssignment[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedDept, setSelectedDept] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [selectedOperator, setSelectedOperator] = useState<string>('');

    const startOfCurrentWeek = startOfWeek(currentDate, { weekStartsOn: 1 });

    useEffect(() => {
        loadData();
    }, [currentDate]);

    async function loadData(force: boolean = false) {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        
        try {
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const [snap, ops, assigns] = await Promise.all([
                getDepartmentPlanningSnapshot(dateStr, force),
                getOperators(),
                getOperatorAssignments(
                    format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
                    format(addWeeks(startOfCurrentWeek, 1), 'yyyy-MM-dd')
                )
            ]);
            setSnapshot(snap);
            setOperators(ops.filter(o => o.isReal));
            setAssignments(assigns);
            if (force) toast({ title: 'Aggiornamento completato', description: 'La nuova analisi è stata calcolata e salvata.' });
        } catch (error) {
            toast({ title: 'Errore', description: 'Impossibile caricare i dati.', variant: 'destructive' });
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }

    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    const openLoanDialog = (deptCode: string, date: string) => {
        setSelectedDept(deptCode);
        setSelectedDate(date);
        setIsDialogOpen(true);
    };

    const handleCreateLoan = async () => {
        if (!selectedOperator || !selectedDept || !selectedDate) return;
        
        const res = await saveOperatorAssignment({
            operatorId: selectedOperator,
            departmentCode: selectedDept,
            startDate: selectedDate,
            endDate: selectedDate,
            type: 'loan'
        }, 'admin-uid'); 

        if (res.success) {
            toast({ title: 'Successo', description: 'Prestito operatore registrato.' });
            setIsDialogOpen(false);
            setSelectedOperator('');
            loadData();
        } else {
            toast({ title: 'Errore', description: res.message, variant: 'destructive' });
        }
    };

    const suggestedOperators = useMemo(() => {
        if (!selectedDept || !selectedDate || !snapshot) return [];
        
        return operators.filter(op => {
            const canWorkInTarget = op.reparto.includes(selectedDept);
            if (!canWorkInTarget && selectedDept !== 'QLTY_PACK' && selectedDept !== 'MAG') return false;

            const currentAssign = assignments.find(a => a.operatorId === op.id && a.startDate === selectedDate);
            if (currentAssign?.departmentCode === selectedDept) return false;

            return true;
        });
    }, [selectedDept, selectedDate, operators, assignments, snapshot]);

    const findDeptName = (code: string | null) => {
      if (!snapshot || !code) return "";
      for (const area in snapshot.macroAreas) {
        const dept = snapshot.macroAreas[area].find((d: any) => d.code === code);
        if (dept) return dept.name;
      }
      return code;
    };

    const renderPlanningTable = (departments: any[]) => (
      <div className="rounded-md border overflow-hidden bg-card">
          <Table>
              <TableHeader>
                  <TableRow className="bg-muted/50">
                      <TableHead className="w-[200px] font-bold text-left px-4">Reparto</TableHead>
                      {snapshot?.days.map((day: string) => (
                          <TableHead key={day} className="text-center">
                              <div className="uppercase text-[10px] text-muted-foreground">{format(parseISO(day), 'EEE', { locale: it })}</div>
                              <div className="font-bold">{format(parseISO(day), 'dd/MM')}</div>
                          </TableHead>
                      ))}
                  </TableRow>
              </TableHeader>
              <TableBody>
                  {departments && departments.length > 0 ? departments.map((dept: any) => (
                      <TableRow key={dept.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-semibold p-4 text-left">
                            <div className="flex flex-col">
                              <span>{dept.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{dept.code}</span>
                            </div>
                          </TableCell>
                          {dept.data.map((dayData: any) => {
                              const isCritical = dayData.balance < -0.1;
                              const hasSurplus = dayData.balance > 4;
                              
                              return (
                                  <TableCell key={dayData.date} className="p-2">
                                      <div 
                                          onClick={() => openLoanDialog(dept.code, dayData.date)}
                                          className={`h-24 rounded-lg border p-2 flex flex-col justify-between cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${
                                              isCritical ? 'border-destructive/50 bg-destructive/5 shadow-[inset_0_0_10px_rgba(239,68,68,0.05)]' : 
                                              hasSurplus ? 'border-emerald-500/50 bg-emerald-50/50' : 'bg-card'
                                          }`}
                                      >
                                          <div className="flex justify-between items-start">
                                              <div className="text-[10px] font-medium text-muted-foreground uppercase opacity-70">Bilancio</div>
                                              {isCritical && <div className="px-1.5 py-0.5 rounded bg-destructive text-[8px] font-bold text-white uppercase tracking-tighter">Sotto-Soglia</div>}
                                          </div>
                                          <div className={`text-2xl font-black text-center ${isCritical ? 'text-destructive' : dayData.balance >= 0.1 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                              {dayData.balance > 0.05 ? '+' : ''}{dayData.balance.toFixed(0)}h
                                          </div>
                                          <div className="text-[10px] font-medium flex justify-center gap-3 text-muted-foreground/60 pt-1 border-t border-dashed">
                                              <span>{dayData.demandHours.toFixed(0)}D</span>
                                              <span>{dayData.supplyHours.toFixed(0)}O</span>
                                          </div>
                                      </div>
                                  </TableCell>
                              );
                          })}
                      </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={(snapshot?.days.length || 0) + 1} className="h-32 text-center text-muted-foreground">
                        Nessun reparto configurato per questa area.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
          </Table>
      </div>
    );

    if (loading && !snapshot) return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Caricamento pianificazione risorse...</p>
      </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight font-headline">Pianificazione Risorse</h1>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-muted-foreground text-sm">Analisi "congelata" del carico di lavoro settimanale.</p>
                      {snapshot?.updatedAt && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-[10px] text-blue-700 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          Ultimo aggiornamento: {format(parseISO(snapshot.updatedAt), 'dd/MM HH:mm')}
                        </div>
                      )}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-card p-1 rounded-lg border shadow-sm">
                      <Button variant="ghost" size="icon" onClick={handlePrevWeek}><ChevronLeft className="h-4 w-4" /></Button>
                      <div className="px-4 font-medium flex items-center gap-2 min-w-[220px] justify-center text-sm">
                          <CalendarIcon className="h-4 w-4 text-primary" />
                          Settimana {format(startOfCurrentWeek, 'dd/MM')} - {format(addWeeks(startOfCurrentWeek, 6/7), 'dd/MM/yyyy')}
                      </div>
                      <Button variant="ghost" size="icon" onClick={handleNextWeek}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                  <Button 
                    variant="default" 
                    className="shadow-md bg-blue-600 hover:bg-blue-700" 
                    onClick={() => loadData(true)} 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                    Esegui Nuova Analisi
                  </Button>
                </div>
            </div>

            <Tabs defaultValue="PRODUZIONE" className="space-y-6">
                <TabsList className="grid w-full grid-cols-3 lg:w-[600px] border">
                    <TabsTrigger value="PREPARAZIONE" className="flex gap-2 items-center">
                      <Boxes className="h-4 w-4" />
                      PREPARAZIONE
                    </TabsTrigger>
                    <TabsTrigger value="PRODUZIONE" className="flex gap-2 items-center">
                      <Factory className="h-4 w-4" />
                      PRODUZIONE
                    </TabsTrigger>
                    <TabsTrigger value="QLTY_PACK" className="flex gap-2 items-center">
                      <Archive className="h-4 w-4" />
                      QLTY & PACK
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="PREPARAZIONE" className="space-y-4 outline-none">
                  <div className="bg-muted/30 p-4 rounded-lg border border-dashed text-xs text-muted-foreground mb-4">
                    Questa sezione mostra il carico dei reparti logistici che preparano le materie prime per la produzione successiva.
                  </div>
                  {renderPlanningTable(snapshot?.macroAreas?.PREPARAZIONE)}
                </TabsContent>

                <TabsContent value="PRODUZIONE" className="space-y-4 outline-none">
                  <div className="bg-muted/30 p-4 rounded-lg border border-dashed text-xs text-muted-foreground mb-4">
                    Visualizzazione suddivisa per i singoli reparti produttivi (Connessioni, Barre, etc.).
                  </div>
                  {renderPlanningTable(snapshot?.macroAreas?.PRODUZIONE)}
                </TabsContent>

                <TabsContent value="QLTY_PACK" className="space-y-4 outline-none">
                  <div className="bg-muted/30 p-4 rounded-lg border border-dashed text-xs text-muted-foreground mb-4">
                    Area dedicata al controllo qualità finale e all'imballaggio/spedizione.
                  </div>
                  {renderPlanningTable(snapshot?.macroAreas?.QLTY_PACK)}
                </TabsContent>
            </Tabs>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <UserPlus className="h-5 w-5 text-primary" />
                          Gestione Prestito Operatore
                        </DialogTitle>
                        <DialogDescription>
                            Assegna una risorsa al reparto <strong>{findDeptName(selectedDept)}</strong> per il giorno {selectedDate && format(parseISO(selectedDate), 'dd MMMM', { locale: it })}.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Seleziona Operatore Compatibile</label>
                            <Select value={selectedOperator} onValueChange={setSelectedOperator}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Scegli un operatore..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {suggestedOperators.map(op => (
                                        <SelectItem key={op.id} value={op.id}>
                                            {op.nome} ({op.reparto.join(', ')})
                                        </SelectItem>
                                    ))}
                                    {suggestedOperators.length === 0 && (
                                        <div className="p-2 text-xs text-muted-foreground text-center">Nessun operatore compatibile trovato.</div>
                                    )}
                                </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-2">
                                <Info className="h-3 w-3" /> Mostra solo operatori che hanno questo reparto nelle proprie competenze.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annulla</Button>
                        <Button onClick={handleCreateLoan} disabled={!selectedOperator}>Conferma Prestito</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
