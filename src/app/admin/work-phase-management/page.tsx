

"use client";

import React, { useState, useEffect, useTransition } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

import { type WorkPhaseTemplate, type Reparto, reparti } from '@/lib/mock-data';
import { getWorkPhaseTemplates, saveWorkPhaseTemplate, deleteWorkPhaseTemplate, getDepartmentMap, deleteSelectedWorkPhaseTemplates, updatePhasesOrder } from './actions';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from '@/components/ui/switch';
import { Workflow, PlusCircle, Edit, Trash2, Download, Save, Loader2, ListOrdered, Check, X } from 'lucide-react';

const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCodes: z.array(z.enum(reparti)).min(1, 'Selezionare almeno un reparto.'),
  type: z.enum(['preparation', 'production', 'quality'], { required_error: 'Specificare il tipo di fase' }),
  requiresMaterialScan: z.boolean().default(false).optional(),
});

type WorkPhaseFormValues = z.infer<typeof workPhaseSchema>;

export default function WorkPhaseManagementClientPage() {
  const [phases, setPhases] = useState<WorkPhaseTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<WorkPhaseTemplate | null>(null);
  const [departmentMap, setDepartmentMap] = useState<{ [key in Reparto]?: string }>({});
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isOrderChanged, setIsOrderChanged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const form = useForm<WorkPhaseFormValues>({
    resolver: zodResolver(workPhaseSchema),
    defaultValues: { id: undefined, name: "", description: "", departmentCodes: [], type: 'production', requiresMaterialScan: false },
  });
  
  const fetchPhases = async () => {
    setIsLoading(true);
    const data = await getWorkPhaseTemplates();
    setPhases(data);
    setIsOrderChanged(false); // Reset change tracker
    setIsLoading(false);
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
        type: phase.type || 'production',
        requiresMaterialScan: phase.requiresMaterialScan || false,
      });
    } else {
      form.reset({ id: undefined, name: "", description: "", departmentCodes: [], type: 'production', requiresMaterialScan: false });
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
    formData.append('type', values.type);
    if (values.type !== 'quality' && values.requiresMaterialScan) {
      formData.append('requiresMaterialScan', 'on');
    }

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
        'Tipo': phase.type === 'production' ? 'Produzione' : 'Preparazione',
        'Richiede Scansione Materiale': phase.requiresMaterialScan ? 'Sì' : 'No',
        'Nome Fase': phase.name,
        'Descrizione': phase.description,
        'Reparti': (phase.departmentCodes || []).map(code => departmentMap[code] || code).join(', '),
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fasi Lavorazione");
    XLSX.writeFile(wb, "fasi_lavorazione.xlsx");
  };
  
  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={8} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento fasi...</span>
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
                <Workflow className="h-8 w-8 text-primary" />
                Gestione Fasi di Lavorazione
                </h1>
                <p className="text-muted-foreground mt-2">
                Definisci le fasi "modello" e la loro sequenza per i cicli di lavorazione delle commesse.
                </p>
            </header>
            <div className="flex items-center gap-2">
                <Button onClick={handleExport} variant="outline" disabled={isLoading || phases.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Esporta
                </Button>
                <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
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
                            checked={!isLoading && selectedRows.length > 0 && selectedRows.length === phases.length}
                            onCheckedChange={handleSelectAll}
                            indeterminate={selectedRows.length > 0 && selectedRows.length < phases.length}
                            aria-label="Seleziona tutte"
                            disabled={isLoading}
                          />
                      </TableHead>
                      <TableHead className="w-[100px]">Sequenza</TableHead>
                      <TableHead>Nome Fase</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Scansione Mat.</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Reparti</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : phases.length > 0 ? (
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
                           <TableCell>
                            <Badge variant={phase.type === 'production' ? 'default' : phase.type === 'quality' ? 'secondary' : 'outline'}>
                              {phase.type === 'production' ? 'Produzione' : phase.type === 'quality' ? 'Qualità' : 'Preparazione'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {phase.requiresMaterialScan ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-muted-foreground" />}
                          </TableCell>
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
                        <TableCell colSpan={8} className="text-center h-24">Nessuna fase definita.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => {if (!isPending) e.preventDefault();}} onEscapeKeyDown={(e) => {if (!isPending) handleCloseDialog();}}>
            <DialogHeader>
              <DialogTitle>{editingPhase ? "Modifica Fase" : "Aggiungi Nuova Fase"}</DialogTitle>
              <DialogDescription>
                {editingPhase ? "Modifica i dettagli della fase." : "Compila i campi per aggiungere una nuova fase standard."}
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
                    name="type"
                    render={({ field }) => (
                    <FormItem className="space-y-3">
                        <FormLabel>Tipo di Fase</FormLabel>
                        <FormControl>
                        <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-1"
                        >
                            <FormItem className="flex items-center space-x-3 space-y-0">
                                <FormControl><RadioGroupItem value="production" /></FormControl>
                                <FormLabel className="font-normal">Produzione (sequenziale)</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0">
                                <FormControl><RadioGroupItem value="preparation" /></FormControl>
                                <FormLabel className="font-normal">Preparazione (indipendente)</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0">
                                <FormControl><RadioGroupItem value="quality" /></FormControl>
                                <FormLabel className="font-normal">Controllo Qualità (senza tempo)</FormLabel>
                            </FormItem>
                        </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                {form.watch('type') !== 'quality' && (
                  <FormField
                      control={form.control}
                      name="requiresMaterialScan"
                      render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                          <FormLabel className="text-base">
                              Richiede Scansione Materiale
                          </FormLabel>
                          <FormDescription>
                              Se attiva, l'operatore dovrà scansionare un materiale per avviare questa fase.
                          </FormDescription>
                          </div>
                          <FormControl>
                          <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                          />
                          </FormControl>
                      </FormItem>
                      )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="departmentCodes"
                  render={({ field }) => (
                    <FormItem>
                        <div className="mb-4">
                            <FormLabel>Reparti di Competenza</FormLabel>
                            <FormDescription>Seleziona uno o più reparti per questa fase.</FormDescription>
                        </div>
                      <div className="grid grid-cols-2 gap-2 rounded-lg border p-4">
                        {reparti.filter(r => r !== 'N/D' && r !== 'Officina').map((repartoCode) => (
                           <FormItem
                            key={repartoCode}
                            className="flex flex-row items-center space-x-3 space-y-0"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(repartoCode)}
                                onCheckedChange={(checked) => {
                                  const value = field.value || [];
                                  return checked
                                    ? field.onChange([...value, repartoCode])
                                    : field.onChange(
                                        value.filter(
                                          (code) => code !== repartoCode
                                        )
                                      );
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal text-sm">
                              {departmentMap[repartoCode] || repartoCode}
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
                    {editingPhase ? "Salva Modifiche" : "Aggiungi Fase"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
  );
}
