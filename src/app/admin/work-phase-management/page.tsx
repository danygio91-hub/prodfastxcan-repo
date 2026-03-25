
"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

import { type WorkPhaseTemplate, RawMaterialType, type Department } from '@/lib/mock-data';
import { getWorkPhaseTemplates, saveWorkPhaseTemplate, deleteWorkPhaseTemplate, getDepartments, deleteSelectedWorkPhaseTemplates } from './actions';


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
import { Workflow, PlusCircle, Edit, Trash2, Download, Save, Loader2, ListOrdered, Check, X, Timer } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AdminAuthGuard from '@/components/AdminAuthGuard';

const materialTypes: RawMaterialType[] = ['BOB', 'TUBI', 'PF3V0', 'GUAINA'];

// Base schema without department enum
const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCodes: z.array(z.string()).min(1, 'Selezionare almeno un reparto.'),
  type: z.enum(['preparation', 'production', 'quality', 'packaging'], { required_error: 'Specificare il tipo di fase' }),
  tracksTime: z.boolean().default(true).optional(),
  requiresMaterialScan: z.boolean().default(false).optional(),
  requiresMaterialSearch: z.boolean().default(false).optional(),
  requiresMaterialAssociation: z.boolean().default(false).optional(),
  allowedMaterialTypes: z.array(z.string()).optional(),
  isIndependent: z.boolean().default(false).optional(),
});


type WorkPhaseFormValues = z.infer<typeof workPhaseSchema>;

export default function WorkPhaseManagementClientPage() {
  const [phases, setPhases] = useState<WorkPhaseTemplate[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<WorkPhaseTemplate | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);


  const { toast } = useToast();

  const form = useForm<WorkPhaseFormValues>({
    resolver: zodResolver(workPhaseSchema),
    defaultValues: { id: undefined, name: "", description: "", departmentCodes: [], type: 'production', tracksTime: true, requiresMaterialScan: false, requiresMaterialSearch: false, requiresMaterialAssociation: false, allowedMaterialTypes: [], isIndependent: false },
  });
  
  const fetchAllData = async () => {
    setIsLoading(true);
    const [phasesData, departmentsData] = await Promise.all([
      getWorkPhaseTemplates(),
      getDepartments(),
    ]);
    setPhases(phasesData);
    setDepartments(departmentsData);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchAllData();
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
        tracksTime: phase.tracksTime !== false,
        requiresMaterialScan: phase.requiresMaterialScan || false,
        requiresMaterialSearch: phase.requiresMaterialSearch || false,
        requiresMaterialAssociation: phase.requiresMaterialAssociation || false,
        allowedMaterialTypes: phase.allowedMaterialTypes || [],
        isIndependent: phase.isIndependent || false,
      });
    } else {
      form.reset({ id: undefined, name: "", description: "", departmentCodes: [], type: 'production', tracksTime: true, requiresMaterialScan: false, requiresMaterialSearch: false, requiresMaterialAssociation: false, allowedMaterialTypes: [], isIndependent: false });
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
    if (values.tracksTime) formData.append('tracksTime', 'on');
    if (values.type !== 'quality') {
        if (values.requiresMaterialScan) formData.append('requiresMaterialScan', 'on');
        if (values.requiresMaterialSearch) formData.append('requiresMaterialSearch', 'on');
        if (values.requiresMaterialAssociation) formData.append('requiresMaterialAssociation', 'on');
    }
    if (values.isIndependent) formData.append('isIndependent', 'on');
    (values.allowedMaterialTypes || []).forEach(type => formData.append('allowedMaterialTypes', type));


    setIsPending(true);
    const result = await saveWorkPhaseTemplate(formData);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
        await fetchAllData();
        handleCloseDialog();
    }
    setIsPending(false);
  };

  const handleDelete = async (id: string) => {
    setIsPending(true);
    const result = await deleteWorkPhaseTemplate(id);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchAllData();
    setIsPending(false);
  };

  const handleDeleteSelected = async () => {
    setIsPending(true);
    const result = await deleteSelectedWorkPhaseTemplates(selectedRows);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        await fetchAllData();
        setSelectedRows([]);
    }
    setIsPending(false);
  };


  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedRows(checked === true ? phases.map(p => p.id) : []);
  };
  
  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };

  const handleExport = () => {
    const departmentNameMap = new Map(departments.map(d => [d.code, d.name]));
    const dataToExport = phases.map(phase => ({
        'Tipo': phase.type === 'production' ? 'Produzione' : 'Preparazione',

        'Traccia Tempo': phase.tracksTime ? 'Sì' : 'No',
        'Richiede Scansione Materiale': phase.requiresMaterialScan ? 'Sì' : 'No',
        'Richiede Associazione Materiale': phase.requiresMaterialAssociation ? 'Sì' : 'No',
        'Nome Fase': phase.name,
        'Descrizione': phase.description,
        'Reparti': (phase.departmentCodes || []).map(code => departmentNameMap.get(code) || code).join(', '),
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fasi Lavorazione");
    XLSX.writeFile(wb, "fasi_lavorazione.xlsx");
  };
  
  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={10} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento fasi...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
    <AdminAuthGuard>
        <AppShell>
            <div className="space-y-6">
            <div className="flex justify-between items-center">
                <header>
                    <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Workflow className="h-8 w-8 text-primary" />
                    Gestione Fasi di Lavorazione
                    </h1>
                    <p className="text-muted-foreground mt-2">
                    Definisci le fasi "modello" e le loro proprietà per i cicli di lavorazione delle commesse.

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
                                checked={!isLoading && selectedRows.length > 0 && selectedRows.length === phases.length ? true : !isLoading && selectedRows.length > 0 ? 'indeterminate' : false}
                                onCheckedChange={handleSelectAll}
                                aria-label="Seleziona tutte"
                                disabled={isLoading}
                            />
                        </TableHead>
                        <TableHead>Nome Fase</TableHead>

                        <TableHead>Tipo</TableHead>
                        <TableHead>Traccia Tempo</TableHead>
                        <TableHead>Scansione Mat.</TableHead>
                        <TableHead>Associa Mat.</TableHead>
                        <TableHead>Ricerca Mat.</TableHead>
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

                            <TableCell className="font-medium">{phase.name}</TableCell>
                            <TableCell>
                                <Badge variant={phase.type === 'production' ? 'default' : phase.type === 'quality' ? 'secondary' : phase.type === 'packaging' ? 'outline' : 'destructive'}>
                                {phase.type === 'production' ? 'Produzione' : phase.type === 'quality' ? 'Qualità' : phase.type === 'packaging' ? 'Packaging' : 'Preparazione'}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                                {phase.tracksTime !== false ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-muted-foreground" />}
                            </TableCell>
                             <TableCell className="text-center">
                                {phase.requiresMaterialScan ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="text-center">
                                {phase.requiresMaterialAssociation ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-muted-foreground" />}
                            </TableCell>
                             <TableCell className="text-center">
                                {phase.requiresMaterialSearch ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="max-w-sm truncate">{phase.description}</TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {(phase.departmentCodes || []).map(code => (
                                        <Badge key={code} variant="secondary">{(departments.find(d => d.code === code))?.name || code}</Badge>
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
                            <TableCell colSpan={10} className="text-center h-24">Nessuna fase definita.</TableCell>
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
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
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
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  const isTimeTracked = value === 'preparation' || value === 'production';
                                  form.setValue('tracksTime', isTimeTracked);
                                }}
                                defaultValue={field.value}
                                className="flex flex-col space-y-1"
                            >
                                <FormItem className="flex items-center space-x-3 space-y-0">
                                    <FormControl><RadioGroupItem value="preparation" /></FormControl>
                                    <FormLabel className="font-normal">Preparazione</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-3 space-y-0">
                                    <FormControl><RadioGroupItem value="production" /></FormControl>
                                    <FormLabel className="font-normal">Produzione</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-3 space-y-0">
                                    <FormControl><RadioGroupItem value="quality" /></FormControl>
                                    <FormLabel className="font-normal">Controllo Qualità</FormLabel>
                                </FormItem>
                                <FormItem className="flex items-center space-x-3 space-y-0">
                                    <FormControl><RadioGroupItem value="packaging" /></FormControl>
                                    <FormLabel className="font-normal">Packaging</FormLabel>
                                </FormItem>
                            </RadioGroup>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                      control={form.control}
                      name="tracksTime"
                      render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                          <FormLabel className="text-base flex items-center gap-2">
                              <Timer className="h-4 w-4" />
                              Abilita Conteggio Tempo
                          </FormLabel>
                          <FormDescription>
                              Se attivo, il tempo speso in questa fase verrà conteggiato.
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
                     <FormField
                      control={form.control}
                      name="isIndependent"
                      render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                          <FormLabel className="text-base">
                              Lavorazione Indipendente
                          </FormLabel>
                          <FormDescription>
                            Se attivo, la fase non seguirà la sequenza e sarà avviabile in qualsiasi momento.
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
                    {form.watch('type') === 'preparation' && (
                    <div className="space-y-4">
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
                        <FormField
                        control={form.control}
                        name="requiresMaterialSearch"
                        render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                            <FormLabel className="text-base">
                                Richiede Ricerca Materiale
                            </FormLabel>
                            <FormDescription>
                                Se attiva, l'operatore cercherà il materiale manualmente.
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
                         <FormField
                        control={form.control}
                        name="requiresMaterialAssociation"
                        render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                            <FormLabel className="text-base">
                                Associazione Materiale Facoltativa
                            </FormLabel>
                            <FormDescription>
                                Se attiva, mostra il pulsante "Associa Materiale".
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
                    {(form.watch('requiresMaterialScan') || form.watch('requiresMaterialSearch')) && (
                        <FormField
                            control={form.control}
                            name="allowedMaterialTypes"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="mb-4">
                                        <FormLabel>Tipi di Materiale Ammessi</FormLabel>
                                        <FormDescription>
                                            Seleziona quali tipi di materiale sono permessi per questa fase.
                                        </FormDescription>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 rounded-lg border p-4">
                                        {materialTypes.map((type) => (
                                            <FormField
                                                key={type}
                                                control={form.control}
                                                name="allowedMaterialTypes"
                                                render={({ field }) => {
                                                    return (
                                                        <FormItem key={type} className="flex flex-row items-start space-x-3 space-y-0">
                                                            <FormControl>
                                                                <Checkbox
                                                                    checked={field.value?.includes(type)}
                                                                    onCheckedChange={(checked) => {
                                                                        return checked
                                                                            ? field.onChange([...(field.value || []), type])
                                                                            : field.onChange(
                                                                                    (field.value || []).filter(
                                                                                        (value) => value !== type
                                                                                    )
                                                                                )
                                                                    }}
                                                                />
                                                            </FormControl>
                                                            <FormLabel className="font-normal">{type}</FormLabel>
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
                    )}
                    </div>
                    )}
                    <FormField
                      control={form.control}
                      name="departmentCodes"
                      render={() => (
                        <FormItem>
                          <div className="mb-4">
                            <FormLabel>Reparti di Competenza</FormLabel>
                            <FormDescription>
                              Seleziona uno o più reparti per questa fase.
                            </FormDescription>
                          </div>
                          <div className="grid grid-cols-2 gap-2 rounded-lg border p-4">
                            {departments
                              .filter((d: Department) => {
                                const phaseType = form.watch('type');
                                if (phaseType === 'preparation') return d.macroAreas?.includes('PREPARAZIONE');
                                if (phaseType === 'production') return d.macroAreas?.includes('PRODUZIONE');
                                if (phaseType === 'quality' || phaseType === 'packaging') return d.macroAreas?.includes('QLTY_PACK');
                                return false;
                              })
                              .map((dept: Department) => (
                                <FormField
                                  key={dept.id}
                                  control={form.control}
                                  name="departmentCodes"
                                  render={({ field }) => (
                                    <FormItem
                                      key={dept.id}
                                      className="flex flex-row items-center space-x-3 space-y-0"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(dept.code)}
                                          onCheckedChange={(checked) => {
                                            const currentValue = field.value || [];
                                            const newValue = checked
                                              ? [...currentValue, dept.code]
                                              : currentValue.filter((value) => value !== dept.code);
                                            field.onChange(newValue);
                                          }}
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal text-sm">
                                        {dept.name}
                                      </FormLabel>
                                    </FormItem>
                                  )}
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
        </div>
    </AppShell>
  </AdminAuthGuard>
  );
}

