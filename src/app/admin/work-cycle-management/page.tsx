

"use client";

import React, { useState, useEffect, useTransition } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type WorkCycle, type WorkPhaseTemplate } from '@/lib/mock-data';
import { getWorkCycles, saveWorkCycle, deleteWorkCycle, getWorkPhaseTemplates, deleteSelectedWorkCycles } from './actions';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { GitMerge, PlusCircle, Edit, Trash2, Loader2 } from 'lucide-react';

const workCycleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome del ciclo deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione è obbligatoria.'),
  phaseTemplateIds: z.array(z.string()).min(1, 'Selezionare almeno una fase di lavorazione.'),
});

type WorkCycleFormValues = z.infer<typeof workCycleSchema>;

export default function WorkCycleManagementClientPage() {
  const [cycles, setCycles] = useState<WorkCycle[]>([]);
  const [phaseTemplates, setPhaseTemplates] = useState<WorkPhaseTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCycle, setEditingCycle] = useState<WorkCycle | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

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

  const handleOpenDialog = (cycle: WorkCycle | null = null) => {
    setEditingCycle(cycle);
    if (cycle) {
      form.reset({
        id: cycle.id,
        name: cycle.name,
        description: cycle.description,
        phaseTemplateIds: cycle.phaseTemplateIds || [],
      });
    } else {
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

    startTransition(async () => {
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
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      const result = await deleteWorkCycle(id);
      toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
      if (result.success) await fetchCycles();
    });
  };
  
  const handleDeleteSelected = async () => {
    startTransition(async () => {
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
    });
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedRows(checked === true ? cycles.map(c => c.id) : []);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };
  
  const getPhaseTypeLabel = (type: WorkPhaseTemplate['type']) => {
    switch (type) {
      case 'production': return 'Prod';
      case 'preparation': return 'Prep';
      case 'quality': return 'Qual';
      case 'packaging': return 'Pack';
      default: return 'N/D';
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
          <AdminNavMenu />
          <div className="flex justify-between items-center">
            <header>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <GitMerge className="h-8 w-8 text-primary" />
                Gestione Cicli di Lavorazione
              </h1>
              <p className="text-muted-foreground mt-2">
                Crea e gestisci i cicli di lavorazione standard da associare alle commesse.
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
                            checked={!isLoading && selectedRows.length > 0 && selectedRows.length === cycles.length}
                            onCheckedChange={handleSelectAll}
                            indeterminate={selectedRows.length > 0 && selectedRows.length < cycles.length}
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
          <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => {if (!isPending) e.preventDefault();}} onEscapeKeyDown={(e) => {if (!isPending) handleCloseDialog();}}>
            <DialogHeader>
              <DialogTitle>{editingCycle ? "Modifica Ciclo" : "Aggiungi Nuovo Ciclo"}</DialogTitle>
              <DialogDescription>
                Compila i campi e seleziona le fasi da includere in questo ciclo di lavorazione.
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
                <FormField
                  control={form.control}
                  name="phaseTemplateIds"
                  render={({ field }) => (
                    <FormItem>
                      <div className="mb-4">
                        <FormLabel>Fasi di Lavorazione da Includere</FormLabel>
                        <FormDescription>Seleziona le fasi che comporranno questo ciclo.</FormDescription>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border p-4">
                        {phaseTemplates.map((item) => (
                          <FormItem
                            key={item.id}
                            className="flex flex-row items-center space-x-3 space-y-0"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(item.id)}
                                onCheckedChange={(checked) => {
                                  const value = field.value || [];
                                  return checked
                                    ? field.onChange([...value, item.id])
                                    : field.onChange(value.filter((id) => id !== item.id));
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal text-sm">
                              {item.name} <span className='text-muted-foreground'>({getPhaseTypeLabel(item.type)})</span>
                            </FormLabel>
                          </FormItem>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
