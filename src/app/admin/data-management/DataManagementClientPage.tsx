
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListChecks, Package, PlusCircle, Upload, Loader2, Download, Trash2, FileText, AlertTriangle, Briefcase, XCircle } from 'lucide-react';
import { type JobOrder, type Reparto, reparti, type WorkCycle } from '@/lib/mock-data';
import { format, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { getPlannedJobOrders, getProductionJobOrders, addJobOrder, processAndValidateImport, commitImportedJobOrders, deleteSelectedJobOrders, deleteAllPlannedJobOrders, createODL, createMultipleODLs, cancelODL, cancelMultipleODLs, getWorkCycles } from './actions';

const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, "Cliente è obbligatorio."),
  ordinePF: z.string().min(1, "Ordine PF (ID Commessa) è obbligatorio."),
  numeroODL: z.string().min(1, "Ordine Nr Est è obbligatorio."),
  details: z.string().min(1, "Codice è obbligatorio."),
  qta: z.string().refine(val => !isNaN(Number(val)) && Number(val) > 0, { message: "Quantità deve essere un numero positivo." }),
  dataConsegnaFinale: z.string().optional(),
  department: z.enum(['CP', 'CG', 'BF', 'MAG'], {
    required_error: "Reparto è obbligatorio.",
  }),
  workCycleId: z.string().optional(),
});

type JobOrderFormValues = z.infer<typeof jobOrderFormSchema>;

interface DataManagementClientPageProps {
  initialPlannedJobOrders: JobOrder[];
  initialProductionJobOrders: JobOrder[];
  departmentMap: { [key in Reparto]?: string };
  workCycles: WorkCycle[];
}

export default function DataManagementClientPage({
  initialPlannedJobOrders,
  initialProductionJobOrders,
  departmentMap,
  workCycles,
}: DataManagementClientPageProps) {
  const [plannedJobOrders, setPlannedJobOrders] = useState<JobOrder[]>(initialPlannedJobOrders);
  const [productionJobOrders, setProductionJobOrders] = useState<JobOrder[]>(initialProductionJobOrders);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectedProductionRows, setSelectedProductionRows] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<{ newJobs: JobOrder[]; jobsToUpdate: JobOrder[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchPlannedJobOrders = useCallback(async () => {
    setPlannedJobOrders(await getPlannedJobOrders());
  }, []);

  const fetchProductionJobOrders = useCallback(async () => {
    setProductionJobOrders(await getProductionJobOrders());
  }, []);

  const form = useForm<JobOrderFormValues>({
    resolver: zodResolver(jobOrderFormSchema),
    defaultValues: {
      cliente: "",
      ordinePF: "",
      numeroODL: "",
      details: "",
      qta: "",
      dataConsegnaFinale: "",
      department: undefined,
      workCycleId: "",
    },
  });

  const handleExportPlanned = () => {
    const dataToExport = plannedJobOrders.map(job => ({
        'Cliente': job.cliente,
        'Ordine PF': job.ordinePF,
        'Ordine Nr Est': job.numeroODL,
        'Codice': job.details,
        'Qta': job.qta,
        'Data Consegna': job.dataConsegnaFinale,
        'Reparto': job.department,
        'Ciclo': job.workCycleId,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commesse Pianificate");
    XLSX.writeFile(wb, "commesse_pianificate.xlsx");
  };

  const handleExportProduction = () => {
    const dataToExport = productionJobOrders.map(job => ({
        'Cliente': job.cliente,
        'Ordine PF': job.ordinePF,
        'Ordine Nr Est': job.numeroODL,
        'Codice': job.details,
        'Qta': job.qta,
        'Data Consegna': job.dataConsegnaFinale,
        'Reparto': job.department,
        'Ciclo': job.workCycleId,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commesse in Produzione");
    XLSX.writeFile(wb, "commesse_in_produzione.xlsx");
  };

  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedRows(plannedJobOrders.map(job => job.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  const handleSelectAllProduction = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedProductionRows(productionJobOrders.map(job => job.id));
    } else {
      setSelectedProductionRows([]);
    }
  };

  const handleSelectProductionRow = (id: string) => {
    setSelectedProductionRows(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };
  
  const handleCreateOdl = async (jobId: string) => {
    const result = await createODL(jobId);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      fetchPlannedJobOrders();
      fetchProductionJobOrders();
    }
  };

  const handleCancelOdl = async (jobId: string) => {
    const result = await cancelODL(jobId);
    toast({
      title: result.success ? "Operazione Riuscita" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      fetchPlannedJobOrders();
      fetchProductionJobOrders();
    }
  };

  const handleCreateSelectedOdls = async () => {
    if (selectedRows.length === 0) return;
    const result = await createMultipleODLs(selectedRows);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        fetchPlannedJobOrders();
        fetchProductionJobOrders();
        setSelectedRows([]);
    }
  };

   const handleCancelSelectedOdls = async () => {
    if (selectedProductionRows.length === 0) return;
    const result = await cancelMultipleODLs(selectedProductionRows);
    toast({
        title: result.success ? "Operazione Riuscita" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        fetchPlannedJobOrders();
        fetchProductionJobOrders();
        setSelectedProductionRows([]);
    }
  };

  const handleAddNewJobOrder = async (values: JobOrderFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      formData.append(key, value || '');
    });

    const result = await addJobOrder(formData);

    if (result.success) {
      toast({
        title: "Operazione Riuscita",
        description: result.message,
      });
      form.reset();
      setIsAddDialogOpen(false);
      fetchPlannedJobOrders();
    } else {
       toast({
        variant: "destructive",
        title: "Errore",
        description: result.message || "Impossibile aggiungere la commessa.",
      });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("FileReader non ha restituito dati.");
        
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("Nessun foglio di lavoro trovato nel file Excel.");
        
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { raw: true });

        const filteredData = json.filter((row: any) => row && Object.values(row).some(cell => cell !== null && cell !== ''));

        if (filteredData.length === 0) {
          toast({ variant: "destructive", title: "File Vuoto o Invalido", description: "Il file Excel non contiene righe di dati valide." });
          return;
        }

        const headerMapping: { [key: string]: string } = {
          'cliente': 'cliente',
          'ordine pf': 'ordinePF',
          'ordine nr est': 'numeroODL',
          'codice': 'details',
          'qta': 'qta',
          'data consegna prevista': 'dataConsegnaFinale',
          'reparto': 'department',
          'ciclo': 'workCycleId'
        };

        const mappedJson = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
                const normalizedKey = key.trim().toLowerCase();
                const targetKey = headerMapping[normalizedKey];
                if (targetKey) {
                    const rawValue = row[key];
                    if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
                        normalizedRow[targetKey] = rawValue;
                    }
                }
            }
            
            if (!normalizedRow.ordinePF) {
              return null;
            }
            
            if (typeof normalizedRow.dataConsegnaFinale === 'number') {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                const jsTimestamp = excelEpoch.getTime() + normalizedRow.dataConsegnaFinale * 86400 * 1000;
                const date = new Date(jsTimestamp);
                if (isValid(date)) {
                    const timezoneOffset = date.getTimezoneOffset() * 60000;
                    const adjustedDate = new Date(date.getTime() + timezoneOffset);
                    normalizedRow.dataConsegnaFinale = format(adjustedDate, 'yyyy-MM-dd');
                } else {
                     delete normalizedRow.dataConsegnaFinale;
                }
            } else if (typeof normalizedRow.dataConsegnaFinale === 'string') {
                const dateString = String(normalizedRow.dataConsegnaFinale).trim();
                const formatsToTry = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy', 'yyyy-MM-dd', 'M/d/yy'];
                let parsedDate: Date | null = null;
                for (const fmt of formatsToTry) {
                    const tempDate = parse(dateString, fmt, new Date());
                    if (isValid(tempDate)) {
                        parsedDate = tempDate;
                        break;
                    }
                }
                 if (parsedDate && isValid(parsedDate)) {
                    normalizedRow.dataConsegnaFinale = format(parsedDate, 'yyyy-MM-dd');
                } else {
                    delete normalizedRow.dataConsegnaFinale;
                }
            }

            return normalizedRow;
        }).filter(Boolean);


        if (mappedJson.length === 0) {
          toast({ variant: "destructive", title: "Dati non validi", description: "Nessuna riga valida trovata nel file. Controllare che la colonna 'Ordine PF' sia presente e compilata."});
          return;
        }

        const result = await processAndValidateImport(mappedJson as any[]);
        toast({ title: "Analisi File", description: result.message });

        if (result.success) {
            // If there are jobs to update (duplicates), show the confirmation dialog.
            if (result.jobsToUpdate.length > 0) {
                setPendingImport({ newJobs: result.newJobs, jobsToUpdate: result.jobsToUpdate });
            } 
            // Otherwise, if there are only new jobs, import them directly.
            else if (result.newJobs.length > 0) {
                const commitResult = await commitImportedJobOrders({ newJobs: result.newJobs, jobsToUpdate: [] });
                toast({
                    title: "Importazione Completata",
                    description: commitResult.message,
                });
                fetchPlannedJobOrders();
            }
        }
      } catch (error) {
         toast({ variant: "destructive", title: "Errore di Importazione", description: error instanceof Error ? error.message : "Si è verificato un errore sconosciuto." });
      } finally {
        setIsImporting(false);
        if (event.target) event.target.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const handleConfirmImport = async (overwrite: boolean) => {
    if (!pendingImport) return;
    const dataToCommit = {
        newJobs: pendingImport.newJobs,
        jobsToUpdate: overwrite ? pendingImport.jobsToUpdate : [],
    };
    if (dataToCommit.newJobs.length === 0 && dataToCommit.jobsToUpdate.length === 0) {
        toast({ title: "Nessuna Azione", description: "Nessuna commessa da importare o aggiornare."});
    } else {
        const result = await commitImportedJobOrders(dataToCommit);
        toast({ title: "Operazione Completata", description: result.message });
        fetchPlannedJobOrders();
    }
    setPendingImport(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0) return;
    const result = await deleteSelectedJobOrders(selectedRows);
    if (result.success) {
      toast({ title: "Operazione Riuscita", description: result.message });
      fetchPlannedJobOrders();
      setSelectedRows([]);
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  const handleDeleteAll = async () => {
    const result = await deleteAllPlannedJobOrders();
    if (result.success) {
      toast({ title: "Operazione Riuscita", description: result.message });
      fetchPlannedJobOrders();
      setSelectedRows([]);
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  return (
      <div className="space-y-6">
        <AdminNavMenu />
        <div className="flex justify-end items-center gap-2 flex-wrap">
              <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx, .xls"
              className="hidden"
            />
            <Button onClick={handleImportClick} variant="outline" disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importa da Excel
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Aggiungi Commessa
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Aggiungi Nuova Commessa Pianificata</DialogTitle>
                  <DialogDescription>
                    Inserisci i dettagli per la nuova commessa. Apparirà in questo elenco.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleAddNewJobOrder)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-6">
                      <FormField control={form.control} name="cliente" render={({ field }) => ( <FormItem> <FormLabel>Cliente</FormLabel> <FormControl> <Input placeholder="Es. Rossi S.p.A." {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField control={form.control} name="ordinePF" render={({ field }) => ( <FormItem> <FormLabel>Ordine PF (ID Commessa)</FormLabel> <FormControl> <Input placeholder="Es. PF-006" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField control={form.control} name="numeroODL" render={({ field }) => ( <FormItem> <FormLabel>Ordine Nr Est</FormLabel> <FormControl> <Input placeholder="Es. ORD-CLIENTE-01" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField control={form.control} name="details" render={({ field }) => ( <FormItem> <FormLabel>Codice</FormLabel> <FormControl> <Input placeholder="Es. ART-00123" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField control={form.control} name="qta" render={({ field }) => ( <FormItem> <FormLabel>Quantità</FormLabel> <FormControl> <Input type="number" placeholder="Es. 100" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField control={form.control} name="dataConsegnaFinale" render={({ field }) => ( <FormItem> <FormLabel>Data Consegna prevista</FormLabel> <FormControl> <Input type="date" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <FormField
                        control={form.control}
                        name="department"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reparto</FormLabel>
                            <FormControl>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Seleziona un reparto di produzione" />
                                </SelectTrigger>
                                <SelectContent>
                                  {reparti
                                    .filter(r => r !== 'N/D' && r !== 'Officina')
                                    .map(r => (
                                      <SelectItem key={r} value={r}>
                                        {departmentMap[r] || r}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="workCycleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ciclo di Lavorazione (Opzionale)</FormLabel>
                            <FormControl>
                              <Select onValueChange={field.onChange} value={field.value}>
                                  <SelectTrigger>
                                      <SelectValue placeholder="Seleziona un ciclo di lavorazione" />
                                  </SelectTrigger>
                                  <SelectContent>
                                      <SelectItem value="">Nessun ciclo (solo dati anagrafici)</SelectItem>
                                      {workCycles.map(cycle => (
                                          <SelectItem key={cycle.id} value={cycle.id}>{cycle.name}</SelectItem>
                                      ))}
                                  </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    <DialogFooter>
                      <DialogClose asChild><Button type="button" variant="outline">Annulla</Button></DialogClose>
                      <Button type="submit">Aggiungi Commessa</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
        </div>

        <Tabs defaultValue="planned" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="planned">
                <ListChecks className="mr-2 h-4 w-4" />
                Commesse Pianificate
            </TabsTrigger>
            <TabsTrigger value="production">
                <Briefcase className="mr-2 h-4 w-4" />
                Commesse in Produzione
            </TabsTrigger>
          </TabsList>
          <TabsContent value="planned">
              <Card className="shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center space-x-3">
                      <ListChecks className="h-8 w-8 text-primary" />
                      <div>
                      <CardTitle className="text-2xl font-headline mb-1">Gestione Dati Commesse</CardTitle>
                      <CardDescription>Commesse inserite in attesa di essere inviate in produzione.</CardDescription>
                      </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={handleExportPlanned} disabled={plannedJobOrders.length === 0}>
                      <Download className="mr-2 h-4 w-4" />
                      Esporta
                    </Button>
                    {selectedRows.length > 0 && (
                      <>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <FileText className="mr-2 h-4 w-4" />
                                    Crea ODL Selezionate ({selectedRows.length})
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>Conferma Creazione ODL</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Verrà creato un ODL per ciascuna delle {selectedRows.length} commesse selezionate, spostandole in produzione. Sei sicuro di voler continuare?
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={handleCreateSelectedOdls}>Conferma e Crea</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="mr-2 h-4 w-4" />
                              Elimina Selezionate ({selectedRows.length})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Questa azione non può essere annullata. Verranno eliminate definitivamente {selectedRows.length} commesse pianificate.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annulla</AlertDialogCancel>
                              <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">Continua</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={plannedJobOrders.length === 0}>
                            Svuota Elenco
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Questa azione non può essere annullata. Verranno eliminate tutte le {plannedJobOrders.length} commesse pianificate.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAll} className="bg-destructive hover:bg-destructive/90">Sì, svuota elenco</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {plannedJobOrders.length > 0 ? (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead padding="checkbox">
                          <Checkbox
                            checked={selectedRows.length > 0 && selectedRows.length === plannedJobOrders.length}
                            onCheckedChange={handleSelectAll}
                            aria-label="Seleziona tutte"
                            indeterminate={selectedRows.length > 0 && selectedRows.length < plannedJobOrders.length}
                          />
                        </TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Ordine PF</TableHead>
                        <TableHead>Ordine Nr Est</TableHead>
                        <TableHead className="min-w-[200px]">Codice</TableHead>
                        <TableHead>Qta</TableHead>
                        <TableHead>Data Consegna prevista</TableHead>
                        <TableHead>Reparto</TableHead>
                        <TableHead>Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plannedJobOrders.map((job) => (
                        <TableRow key={job.id} data-state={selectedRows.includes(job.id) ? "selected" : undefined}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedRows.includes(job.id)}
                              onCheckedChange={() => handleSelectRow(job.id)}
                              aria-label={`Seleziona commessa ${job.id}`}
                            />
                          </TableCell>
                          <TableCell>{job.cliente}</TableCell>
                          <TableCell className="font-medium">{job.ordinePF}</TableCell>
                          <TableCell>{job.numeroODL}</TableCell>
                          <TableCell>{job.details}</TableCell>
                          <TableCell>{job.qta}</TableCell>
                          <TableCell>
                            {job.dataConsegnaFinale && isValid(parse(job.dataConsegnaFinale, 'yyyy-MM-dd', new Date())) ? format(parse(job.dataConsegnaFinale, 'yyyy-MM-dd', new Date()), "dd MMM yyyy", { locale: it }) : 'N/D'}
                          </TableCell>
                          <TableCell>{job.department}</TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" onClick={() => handleCreateOdl(job.id)}>
                              <FileText className="mr-2 h-4 w-4" />
                              Crea ODL
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Package className="h-16 w-16 text-muted-foreground mb-4" />
                    <p className="text-lg font-semibold text-muted-foreground">Nessuna commessa trovata.</p>
                    <p className="text-sm text-muted-foreground">
                      Aggiungi una commessa manualmente o importa da un file Excel per iniziare.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="production">
              <Card className="shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center space-x-3">
                        <Briefcase className="h-8 w-8 text-primary" />
                        <div>
                        <CardTitle className="text-2xl font-headline mb-1">Commesse in Produzione</CardTitle>
                        <CardDescription>Commesse per cui è stato creato un ODL. Per annullarlo, usa l'azione qui sotto.</CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={handleExportProduction} disabled={productionJobOrders.length === 0}>
                          <Download className="mr-2 h-4 w-4" />
                          Esporta
                      </Button>
                      {selectedProductionRows.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm">
                                <XCircle className="mr-2 h-4 w-4" />
                                Annulla ODL Selezionati ({selectedProductionRows.length})
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Sei sicuro di voler annullare gli ODL selezionati?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Questa azione riporterà le {selectedProductionRows.length} commesse selezionate allo stato di "Pianificata".
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                <AlertDialogAction onClick={handleCancelSelectedOdls} className="bg-destructive hover:bg-destructive/90">Sì, annulla ODL</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                      )}
                      </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {productionJobOrders.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                              <TableHead padding="checkbox">
                              <Checkbox
                                checked={selectedProductionRows.length > 0 && selectedProductionRows.length === productionJobOrders.length}
                                onCheckedChange={handleSelectAllProduction}
                                aria-label="Seleziona tutte"
                                indeterminate={selectedProductionRows.length > 0 && selectedProductionRows.length < productionJobOrders.length}
                              />
                            </TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Ordine PF</TableHead>
                            <TableHead>Ordine Nr Est</TableHead>
                            <TableHead className="min-w-[200px]">Codice</TableHead>
                            <TableHead>Qta</TableHead>
                            <TableHead>Data Consegna</TableHead>
                            <TableHead>Reparto</TableHead>
                            <TableHead>Azioni</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {productionJobOrders.map((job) => (
                            <TableRow key={job.id} data-state={selectedProductionRows.includes(job.id) ? "selected" : undefined}>
                                <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedProductionRows.includes(job.id)}
                                  onCheckedChange={() => handleSelectProductionRow(job.id)}
                                  aria-label={`Seleziona commessa ${job.id}`}
                                />
                              </TableCell>
                              <TableCell>{job.cliente}</TableCell>
                              <TableCell className="font-medium">{job.ordinePF}</TableCell>
                              <TableCell>{job.numeroODL}</TableCell>
                              <TableCell>{job.details}</TableCell>
                              <TableCell>{job.qta}</TableCell>
                              <TableCell>
                                {job.dataConsegnaFinale && isValid(parse(job.dataConsegnaFinale, 'yyyy-MM-dd', new Date())) ? format(parse(job.dataConsegnaFinale, 'yyyy-MM-dd', new Date()), "dd MMM yyyy", { locale: it }) : 'N/D'}
                              </TableCell>
                              <TableCell>{job.department}</TableCell>
                              <TableCell>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                      <XCircle className="mr-2 h-4 w-4" />
                                      Annulla ODL
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Sei sicuro di voler annullare l'ODL?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Questa azione riporterà la commessa '{job.id}' allo stato di "Pianificata" e la rimuoverà dalla Console di Produzione.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleCancelOdl(job.id)} className="bg-destructive hover:bg-destructive/90">Sì, annulla ODL</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Package className="h-16 w-16 text-muted-foreground mb-4" />
                      <p className="text-lg font-semibold text-muted-foreground">Nessuna commessa in produzione.</p>
                      <p className="text-sm text-muted-foreground">
                        Crea un ODL dalla tabella delle commesse pianificate per vederle qui.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
          </TabsContent>
        </Tabs>
        
        <AlertDialog open={!!pendingImport} onOpenChange={(open) => !open && setPendingImport(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center">
                        <AlertTriangle className="mr-2 h-6 w-6 text-yellow-500"/>
                        Duplicati Trovati
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        L'importazione ha trovato {pendingImport?.jobsToUpdate.length || 0} commesse che sono già presenti nel sistema. 
                        Vuoi sovrascrivere i dati di queste commesse con quelli del file Excel? Le nuove commesse verranno comunque aggiunte.
                    </AlertDialogDescription>
                    {pendingImport && pendingImport.jobsToUpdate.length > 0 && (
                        <div className="pt-2">
                            <Label className="font-semibold">Commesse duplicate:</Label>
                            <ScrollArea className="h-20 mt-1 rounded-md border p-2">
                                <ul className="text-sm text-muted-foreground list-disc pl-5">
                                    {pendingImport.jobsToUpdate.map(job => <li key={job.id}>{job.id}</li>)}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={() => handleConfirmImport(false)}>Importa solo nuove</Button>
                    <AlertDialogAction onClick={() => handleConfirmImport(true)}>Sovrascrivi e Importa</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}
