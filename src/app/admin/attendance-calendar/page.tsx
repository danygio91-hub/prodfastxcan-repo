
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  CalendarDays, 
  PlusCircle, 
  Trash2, 
  UserMinus, 
  Settings2, 
  Stethoscope, 
  Plane, 
  Clock, 
  Loader2, 
  AlertTriangle,
  MonitorOff,
  User,
  Settings
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { getCalendarExceptions, saveCalendarException, deleteCalendarException } from './actions';
import { getOperators } from '../operator-management/actions';
import { getWorkstations } from '../workstation-management/actions';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { CalendarException, Operator, Workstation } from '@/lib/mock-data';

const exceptionSchema = z.object({
  resourceType: z.enum(['operator', 'machine']),
  targetId: z.string().min(1, "Seleziona una risorsa."),
  exceptionType: z.enum(['sick', 'vacation', 'permit', 'maintenance', 'other']),
  startDate: z.string().min(1, "Data inizio obbligatoria."),
  endDate: z.string().min(1, "Data fine obbligatoria."),
  hoursLost: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof exceptionSchema>;

export default function AttendanceCalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(exceptionSchema),
    defaultValues: {
      resourceType: 'operator',
      exceptionType: 'vacation',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    }
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [exc, ops, ws] = await Promise.all([
        getCalendarExceptions(),
        getOperators(),
        getWorkstations()
      ]);
      setExceptions(exc);
      setOperators(ops);
      setWorkstations(ws);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Errore caricamento dati' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setIsPending(true);
    
    let targetName = '';
    if (values.resourceType === 'operator') {
      targetName = operators.find(o => o.id === values.targetId)?.nome || 'Sconosciuto';
    } else {
      targetName = workstations.find(w => w.id === values.targetId)?.name || 'Macchina';
    }

    const result = await saveCalendarException({
      ...values,
      targetName,
    }, user.uid);

    if (result.success) {
      toast({ title: 'Successo', description: result.message });
      setIsDialogOpen(false);
      fetchData();
    } else {
      toast({ variant: 'destructive', title: 'Errore', description: result.message });
    }
    setIsPending(false);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const result = await deleteCalendarException(id, user.uid);
    if (result.success) {
      toast({ title: 'Eliminata' });
      fetchData();
    }
  };

  const getTypeBadge = (type: CalendarException['exceptionType']) => {
    switch (type) {
      case 'sick': return <Badge variant="destructive" className="gap-1"><Stethoscope className="h-3 w-3"/> Mutua</Badge>;
      case 'vacation': return <Badge variant="default" className="gap-1"><Plane className="h-3 w-3"/> Ferie</Badge>;
      case 'permit': return <Badge variant="outline" className="border-primary text-primary gap-1"><Clock className="h-3 w-3"/> Permesso</Badge>;
      case 'maintenance': return <Badge variant="secondary" className="gap-1"><Settings2 className="h-3 w-3"/> Manutenzione</Badge>;
      default: return <Badge variant="outline">Altro</Badge>;
    }
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <header className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <CalendarDays className="h-8 w-8 text-primary" />
                Calendario Presenze ed Eccezioni
              </h1>
              <p className="text-muted-foreground">Gestisci le assenze del personale e i fermi macchina per la pianificazione.</p>
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Nuova Eccezione
            </Button>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Registro Eccezioni</CardTitle>
              <CardDescription>Elenco cronologico degli eventi registrati.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data Inizio</TableHead>
                        <TableHead>Data Fine</TableHead>
                        <TableHead>Risorsa</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Ore Perse</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="text-right">Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exceptions.length > 0 ? exceptions.map((ex) => (
                        <TableRow key={ex.id}>
                          <TableCell>{format(parseISO(ex.startDate), 'dd/MM/yyyy')}</TableCell>
                          <TableCell>{format(parseISO(ex.endDate), 'dd/MM/yyyy')}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {ex.resourceType === 'operator' ? <User className="h-4 w-4 text-muted-foreground" /> : <Settings className="h-4 w-4 text-muted-foreground" />}
                              <span className="font-semibold">{ex.targetName}</span>
                            </div>
                          </TableCell>
                          <TableCell>{getTypeBadge(ex.exceptionType)}</TableCell>
                          <TableCell>{ex.hoursLost ? `${ex.hoursLost} h` : 'Giornata intera'}</TableCell>
                          <TableCell className="max-w-[200px] truncate italic text-xs">{ex.notes || '-'}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(ex.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )) : (
                        <TableRow><TableCell colSpan={7} className="text-center h-24">Nessuna eccezione registrata.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Registra Nuova Eccezione</DialogTitle>
              <DialogDescription>Inserisci i dettagli dell'assenza o del fermo macchina.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="resourceType" render={({ field }) => (
                    <FormItem><FormLabel>Tipo Risorsa</FormLabel>
                      <Select onValueChange={v => { field.onChange(v); form.setValue('targetId', ''); }} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="operator">Operatore</SelectItem><SelectItem value="machine">Macchina/Postazione</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="targetId" render={({ field }) => (
                    <FormItem><FormLabel>Soggetto</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {form.watch('resourceType') === 'operator' 
                            ? operators.map(o => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)
                            : workstations.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)
                          }
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="exceptionType" render={({ field }) => (
                  <FormItem><FormLabel>Tipo Evento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="vacation">Ferie / Permesso</SelectItem>
                        <SelectItem value="sick">Malattia / Mutua</SelectItem>
                        <SelectItem value="maintenance">Manutenzione / Fermo</SelectItem>
                        <SelectItem value="other">Altro</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem><FormLabel>Dal</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="endDate" render={({ field }) => (
                    <FormItem><FormLabel>Al</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="hoursLost" render={({ field }) => (
                  <FormItem><FormLabel>Ore Perse (lascia vuoto se tutto il giorno)</FormLabel><FormControl><Input type="number" step="0.5" {...field} /></FormControl></FormItem>
                )} />

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Note</FormLabel><FormControl><Input placeholder="Es. Visita medica" {...field} /></FormControl></FormItem>
                )} />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="animate-spin h-4 w-4" /> : 'Salva Evento'}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminAuthGuard>
  );
}
