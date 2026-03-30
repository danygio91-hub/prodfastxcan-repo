

"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type WorkCycle, type WorkPhaseTemplate } from '@/types';
import { getWorkCycles, saveWorkCycle, deleteWorkCycle, getWorkPhaseTemplates, deleteSelectedWorkCycles } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { GitMerge, PlusCircle, Edit, Trash2, Loader2, ArrowLeft, ArrowRight, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

const workCycleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome del ciclo deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione è obbligatoria.'),
  phaseTemplateIds: z.array(z.string()).min(1, 'Selezionare almeno una fase di lavorazione.'),
});

type WorkCycleFormValues = z.infer<typeof workCycleSchema>;

function WorkCycleManagementContent() {
  const [cycles, setCycles] = useState<WorkCycle[]>([]);
  const [phaseTemplates, setPhaseTemplates] = useState<WorkPhaseTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCycle, setEditingCycle] = useState<WorkCycle | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  
  // New state for the two-column picker
  const [availablePhases, setAvailablePhases] = useState<WorkPhaseTemplate[]>([]);
  const [selectedPhases, setSelectedPhases] = useState<WorkPhaseTemplate[]>([]);


  const form = useForm<WorkCycleFormValues>({
    resolver: zodResolver(workCycleSchema),
    defaultValues: { id: undefined, name: "", description: "", phaseTemplateIds: [] },
  });

  const fetchCycles = async () => {
    setIsLoading(true);
    const data = await getWorkCycles();
    setCycles(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCycles();
    getWorkPhaseTemplates().then(setPhaseTemplates);
  }, []);
  
  useEffect(() => {
    form.setValue('phaseTemplateIds', selectedPhases.map(p => p.id));
  }, [selectedPhases, form]);


  const handleOpenDialog = (cycle: WorkCycle | null = null) => {
    setEditingCycle(cycle);
    if (cycle && cycle.phaseTemplateIds) {
      const cyclePhases = cycle.phaseTemplateIds.map(id => phaseTemplates.find(p => p.id === id)).filter(Boolean) as WorkPhaseTemplate[];
      setSelectedPhases(cyclePhases);
      setAvailablePhases(phaseTemplates.filter(p => !cycle.phaseTemplateIds.includes(p.id)));
      form.reset({
        id: cycle.id,
        name: cycle.name,
        description: cycle.description,
        phaseTemplateIds: cycle.phaseTemplateIds,
      });
    } else {
      setAvailablePhases([...phaseTemplates]);
      setSelectedPhases([]);
      form.reset({ id: undefined, name: "", description: "", phaseTemplateIds: [] });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingCycle(null);
    form.reset();
  };

  const onSubmit = async (values: WorkCycleFormValues) => {
    const formData = new FormData();
    if (values.id) formData.append('id', values.id);
    formData.append('name', values.name);
    formData.append('description', values.description);
    values.phaseTemplateIds.forEach(id => formData.append('phaseTemplateIds', id));

    setIsPending(true);
    const result = await saveWorkCycle(formData);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
        await fetchCycles();
        handleCloseDialog();
    }
    setIsPending(false);
  };

  const handleDelete = async (id: string) => {
    setIsPending(true);
    const result = await deleteWorkCycle(id);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchCycles();
    setIsPending(false);
  };
  
  const handleDeleteSelected = async () => {
    setIsPending(true);
    const result = await deleteSelectedWorkCycles(selectedRows);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        await fetchCycles();
        setSelectedRows([]);
    }
    setIsPending(false);
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedRows(checked === true ? cycles.map(c => c.id) : []);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };
  
  // --- New handlers for two-column picker ---
  const addPhaseToCycle = (phase: WorkPhaseTemplate) => {
    setAvailablePhases(prev => prev.filter(p => p.id !== phase.id));
    setSelectedPhases(prev => [...prev, phase]);
  };

  const removePhaseFromCycle = (phase: WorkPhaseTemplate) => {
    setSelectedPhases(prev => prev.filter(p => p.id !== phase.id));
    setAvailablePhases(prev => [...prev, phase].sort((a,b) => a.name.localeCompare(b.name)));

  };
  
  const movePhase = (index: number, direction: 'up' | 'down') => {
    const newSelectedPhases = [...selectedPhases];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newSelectedPhases.length) {
      const temp = newSelectedPhases[index];
      newSelectedPhases[index] = newSelectedPhases[targetIndex];
      newSelectedPhases[targetIndex] = temp;
      setSelectedPhases(newSelectedPhases);
    }
  };
  
  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={5} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento cicli...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <header>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <GitMerge className="h-8 w-8 text-primary" />
                Gestione Cicli di Lavorazione
              </h1>
              <p className="text-muted-foreground mt-2">
                Crea e ordina le sequenze di fasi da associare alle commesse.
              </p>
            </header>
            <div className="flex items-center gap-2">
                {selectedRows.length > 0 && (
                     <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" disabled={isPending}>
                              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                              Elimina ({selectedRows.length})
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Questa azione non può essere annullata. Verranno eliminati definitivamente {selectedRows.length} cicli.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteSelected}>Continua</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                )}
                <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Nuovo Ciclo
                </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Cicli di Lavorazione</CardTitle>
              <CardDescription>Questi cicli possono essere assegnati alle commesse durante la loro creazione.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                       <TableHead padding="checkbox">
                         <Checkbox
                            checked={!isLoading && selectedRows.length > 0 && selectedRows.length === cycles.length ? true : !isLoading && selectedRows.length > 0 ? 'indeterminate' : false}
                            onCheckedChange={handleSelectAll}
                            aria-label="Seleziona tutti"
                            disabled={isLoading}
                          />
                      </TableHead>
                      <TableHead>Nome Ciclo</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>N° Fasi</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : cycles.length > 0 ? (
                      cycles.map((cycle) => (
                        <TableRow key={cycle.id} data-state={selectedRows.includes(cycle.id) && "selected"}>
                           <TableCell padding="checkbox">
                             <Checkbox
                                checked={selectedRows.includes(cycle.id)}
                                onCheckedChange={() => handleSelectRow(cycle.id)}
                                aria-label={`Seleziona il ciclo ${cycle.name}`}
                              />
                          </TableCell>
                          <TableCell className="font-medium">{cycle.name}</TableCell>
                          <TableCell>{cycle.description}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{cycle.phaseTemplateIds.length}</Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(cycle)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Questa azione non può essere annullata. Il ciclo di lavorazione verrà eliminato.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(cycle.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">Nessun ciclo di lavorazione trovato.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-4xl" onInteractOutside={(e) => {if (isPending) e.preventDefault();}}>
            <DialogHeader>
              <DialogTitle>{editingCycle ? "Modifica Ciclo" : "Aggiungi Nuovo Ciclo"}</DialogTitle>
              <DialogDescription>
                Compila i campi, quindi aggiungi e ordina le fasi per definire la sequenza di questo ciclo.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-6">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Ciclo</FormLabel>
                    <FormControl><Input placeholder="Es. Ciclo Standard Elettronica" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrizione</FormLabel>
                    <FormControl><Textarea placeholder="Descrivi lo scopo di questo ciclo di lavorazione." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* Colonna Fasi Disponibili */}
                    <div className="space-y-2">
                        <FormLabel>Fasi Disponibili</FormLabel>
                        <div className="border rounded-md p-2 space-y-2 min-h-[200px]">
                            {availablePhases.map(phase => (
                                <div key={phase.id} className="flex items-center justify-between p-2 bg-background rounded-md">
                                    <span className="text-sm font-medium">{phase.name}</span>
                                    <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => addPhaseToCycle(phase)}>
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                             {availablePhases.length === 0 && <p className="text-xs text-muted-foreground text-center p-4">Nessuna fase da aggiungere.</p>}
                        </div>
                    </div>
                    
                    {/* Colonna Fasi nel Ciclo */}
                    <div className="space-y-2">
                         <FormField
                            control={form.control}
                            name="phaseTemplateIds"
                            render={() => (
                            <FormItem>
                               <FormLabel>Fasi nel Ciclo (in ordine di esecuzione)</FormLabel>
                               <div className="border rounded-md p-2 space-y-2 min-h-[200px]">
                                   {selectedPhases.map((phase, index) => (
                                       <div key={phase.id} className="flex items-center justify-between p-2 bg-secondary rounded-md">
                                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removePhaseFromCycle(phase)}>
                                                <ArrowLeft className="h-4 w-4" />
                                            </Button>
                                            <span className="text-sm font-semibold text-secondary-foreground flex-1 mx-2">{index + 1}. {phase.name}</span>
                                            <div className="flex flex-col gap-1">
                                                <Button type="button" size="icon" variant="outline" className="h-6 w-6" disabled={index === 0} onClick={() => movePhase(index, 'up')}>
                                                    <ArrowUp className="h-3 w-3" />
                                                </Button>
                                                <Button type="button" size="icon" variant="outline" className="h-6 w-6" disabled={index === selectedPhases.length - 1} onClick={() => movePhase(index, 'down')}>
                                                    <ArrowDown className="h-3 w-3" />
                                                </Button>
                                            </div>
                                       </div>
                                   ))}
                                    {selectedPhases.length === 0 && <p className="text-xs text-muted-foreground text-center p-4">Aggiungi fasi dalla colonna a sinistra.</p>}
                               </div>
                                <FormMessage />
                            </FormItem>
                         )}
                        />
                    </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isPending}>Annulla</Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {editingCycle ? "Salva Modifiche" : "Crea Ciclo"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
  );
}

export default function WorkCycleManagementPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <WorkCycleManagementContent />
      </AppShell>
    </AdminAuthGuard>
  );
}

    
