
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

import { type WorkPhaseTemplate, type Reparto, reparti } from '@/lib/mock-data';
import { getWorkPhaseTemplates, saveWorkPhaseTemplate, deleteWorkPhaseTemplate, getDepartmentMap, deleteSelectedWorkPhaseTemplates, updatePhasesOrder } from './actions';

import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Workflow, PlusCircle, Edit, Trash2, Download, Save, Loader2, ListOrdered } from 'lucide-react';

const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCodes: z.array(z.enum(reparti)).min(1, 'Selezionare almeno un reparto.'),
});

type WorkPhaseFormValues = z.infer<typeof workPhaseSchema>;

export default function AdminWorkPhaseManagementPage() {
  const [phases, setPhases] = useState<WorkPhaseTemplate[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<WorkPhaseTemplate | null>(null);
  const [departmentMap, setDepartmentMap] = useState<{ [key in Reparto]?: string }>({});
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isOrderChanged, setIsOrderChanged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const form = useForm<WorkPhaseFormValues>({
    resolver: zodResolver(workPhaseSchema),
    defaultValues: { id: undefined, name: "", description: "", departmentCodes: [] },
  });
  
  const fetchPhases = async () => {
    const data = await getWorkPhaseTemplates();
    setPhases(data);
    setIsOrderChanged(false); // Reset change tracker
  };

  useEffect(() => {
    fetchPhases();
    getDepartmentMap().then(setDepartmentMap);
  }, []);

  const handleOpenDialog = (phase: WorkPhaseTemplate | null = null) => {
    setEditingPhase(phase);
    if (phase) {
      form.reset({
        id: phase.id,
        name: phase.name,
        description: phase.description,
        departmentCodes: phase.departmentCodes || [],
      });
    } else {
      form.reset({ id: undefined, name: "", description: "", departmentCodes: [] });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPhase(null);
    form.reset();
  }

  const onSubmit = async (values: WorkPhaseFormValues) => {
    const formData = new FormData();
    if (values.id) formData.append('id', values.id);
    formData.append('name', values.name);
    formData.append('description', values.description);
    values.departmentCodes.forEach(code => formData.append('departmentCodes', code));

    startTransition(async () => {
      const result = await saveWorkPhaseTemplate(formData);
      toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });

      if (result.success) {
        await fetchPhases();
        handleCloseDialog();
      }
    });
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
        const result = await deleteWorkPhaseTemplate(id);
        toast({
            title: result.success ? "Successo" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) await fetchPhases();
    });
  };

  const handleDeleteSelected = async () => {
    startTransition(async () => {
        const result = await deleteSelectedWorkPhaseTemplates(selectedRows);
        toast({
            title: result.success ? "Successo" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            await fetchPhases();
            setSelectedRows([]);
        }
    });
  };

  const handleSequenceChange = (id: string, newSequence: string) => {
    const sequenceValue = parseInt(newSequence, 10);
    if (!isNaN(sequenceValue)) {
        setPhases(currentPhases =>
            currentPhases.map(phase =>
                phase.id === id ? { ...phase, sequence: sequenceValue } : phase
            )
        );
        setIsOrderChanged(true);
    }
  };

  const handleSaveOrder = async () => {
    startTransition(async () => {
        const phasesToUpdate = phases.map(({ id, sequence }) => ({ id, sequence }));
        const result = await updatePhasesOrder(phasesToUpdate);
        toast({
            title: result.success ? "Successo" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            await fetchPhases();
        }
    });
  };
  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedRows(checked === true ? phases.map(p => p.id) : []);
  };
  
  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };

  const handleExport = () => {
    const dataToExport = phases.map(phase => ({
        'Sequenza': phase.sequence,
        'Nome Fase': phase.name,
        'Descrizione': phase.description,
        'Reparti': (phase.departmentCodes || []).map(code => departmentMap[code] || code).join(', '),
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fasi Lavorazione");
    XLSX.writeFile(wb, "fasi_lavorazione.xlsx");
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />
          <div className="flex justify-between items-center">
            <header>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Workflow className="h-8 w-8 text-primary" />
                Gestione Fasi di Lavorazione
                </h1>
                <p className="text-muted-foreground mt-2">
                Definisci le fasi "modello" e la loro sequenza per i cicli di lavorazione delle commesse.
                </p>
            </header>
            <div className="flex items-center gap-2">
                <Button onClick={handleExport} variant="outline" disabled={phases.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Esporta
                </Button>
                <Button onClick={() => handleOpenDialog()}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Aggiungi
                </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <div>
                  <CardTitle>Elenco Fasi Standard</CardTitle>
                  <CardDescription>Queste sono le fasi disponibili per la configurazione dei cicli di lavoro.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {isOrderChanged && (
                    <Button onClick={handleSaveOrder} disabled={isPending}>
                       {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ListOrdered className="mr-2 h-4 w-4" />}
                       Salva Ordine
                    </Button>
                  )}
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
                                    Questa azione non può essere annullata. Verranno eliminate definitivamente {selectedRows.length} fasi.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteSelected}>Continua</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead padding="checkbox">
                         <Checkbox
                            checked={selectedRows.length > 0 && selectedRows.length === phases.length}
                            onCheckedChange={handleSelectAll}
                            indeterminate={selectedRows.length > 0 && selectedRows.length < phases.length}
                            aria-label="Seleziona tutte"
                          />
                      </TableHead>
                      <TableHead className="w-[100px]">Sequenza</TableHead>
                      <TableHead>Nome Fase</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Reparti</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {phases.length > 0 ? (
                      phases.map((phase) => (
                        <TableRow key={phase.id} data-state={selectedRows.includes(phase.id) && "selected"}>
                          <TableCell padding="checkbox">
                             <Checkbox
                                checked={selectedRows.includes(phase.id)}
                                onCheckedChange={() => handleSelectRow(phase.id)}
                                aria-label={`Seleziona la fase ${phase.name}`}
                              />
                          </TableCell>
                          <TableCell>
                            <Input
                                type="number"
                                value={phase.sequence}
                                onChange={(e) => handleSequenceChange(phase.id, e.target.value)}
                                className="w-16 h-8 text-center"
                             />
                          </TableCell>
                          <TableCell className="font-medium">{phase.name}</TableCell>
                          <TableCell className="max-w-sm truncate">{phase.description}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                                {(phase.departmentCodes || []).map(code => (
                                    <Badge key={code} variant="secondary">{departmentMap[code] || code}</Badge>
                                ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(phase)}>
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
                                    Questa azione non può essere annullata. La fase verrà eliminata.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(phase.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center h-24">Nessuna fase definita.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => {if (!isPending) e.preventDefault();}} onEscapeKeyDown={(e) => {if (!isPending) handleCloseDialog();}}>
            <DialogHeader>
              <DialogTitle>{editingPhase ? "Modifica Fase" : "Aggiungi Nuova Fase"}</DialogTitle>
              <DialogDescription>
                {editingPhase ? "Modifica i dettagli della fase." : "Compila i campi per aggiungere una nuova fase standard. La sequenza verrà assegnata automaticamente."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Fase</FormLabel>
                    <FormControl><Input placeholder="Es. Saldatura Manuale" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrizione</FormLabel>
                    <FormControl><Textarea placeholder="Descrivi lo scopo e le attività principali di questa fase." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField
                  control={form.control}
                  name="departmentCodes"
                  render={() => (
                    <FormItem>
                      <FormLabel>Reparti di Competenza</FormLabel>
                      <CardDescription>Seleziona uno o più reparti per questa fase.</CardDescription>
                      <div className="grid grid-cols-2 gap-2 rounded-lg border p-4">
                        {reparti.filter(r => r !== 'N/D').map((repartoCode) => (
                          <FormField
                            key={repartoCode}
                            control={form.control}
                            name="departmentCodes"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={repartoCode}
                                  className="flex flex-row items-center space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(repartoCode)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), repartoCode])
                                          : field.onChange(
                                              (field.value || []).filter(
                                                (value) => value !== repartoCode
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal text-sm">
                                    {departmentMap[repartoCode] || repartoCode}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
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
                    {editingPhase ? "Salva Modifiche" : "Aggiungi Fase"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminAuthGuard>
  );
}
