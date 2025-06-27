"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
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
import { ListChecks, Package, PlusCircle, Upload, Loader2, Download, Trash2, FileText, AlertTriangle } from 'lucide-react';
import { type JobOrder } from '@/lib/mock-data';
import { format, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { getPlannedJobOrders, addJobOrder, processAndValidateImport, commitImportedJobOrders, deleteSelectedJobOrders, deleteAllPlannedJobOrders, createODL } from './actions';

const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, "Cliente è obbligatorio."),
  ordinePF: z.string().min(1, "Ordine PF (ID Commessa) è obbligatorio."),
  numeroODL: z.string().min(1, "Ordine Nr Est è obbligatorio."),
  details: z.string().min(1, "Codice è obbligatorio."),
  qta: z.string().refine(val => !isNaN(Number(val)) && Number(val) > 0, { message: "Quantità deve essere un numero positivo." }),
  dataConsegnaFinale: z.string().optional(),
  department: z.string().min(1, "Reparto è obbligatorio."),
});

type JobOrderFormValues = z.infer<typeof jobOrderFormSchema>;

export default function AdminDataManagementCommessePage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<{ newJobs: JobOrder[]; jobsToUpdate: JobOrder[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchJobOrders = () => {
    getPlannedJobOrders().then(orders => {
      setJobOrders(orders);
    });
  }
  
  useEffect(() => {
    fetchJobOrders();
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
      department: "",
    },
  });
  
  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedRows(jobOrders.map(job => job.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev =>
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
      fetchJobOrders();
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
      fetchJobOrders();
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
          'reparto': 'department'
        };

        const mappedJson = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
              const normalizedKey = key.trim().toLowerCase();
              if (headerMapping[normalizedKey]) {
                  const rawValue = row[key];
                  if (rawValue !== null && rawValue !== '') {
                      normalizedRow[headerMapping[normalizedKey]] = rawValue;
                  }
              }
            }

            if (!normalizedRow.ordinePF) {
              return null;
            }
            
            // Handle Excel date serial numbers
            if (typeof normalizedRow.dataConsegnaFinale === 'number') {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                const jsTimestamp = excelEpoch.getTime() + normalizedRow.dataConsegnaFinale * 86400 * 1000;
                const date = new Date(jsTimestamp);
                if (isValid(date)) {
                    normalizedRow.dataConsegnaFinale = format(date, 'yyyy-MM-dd');
                } else {
                     delete normalizedRow.dataConsegnaFinale;
                }
            } else if (typeof normalizedRow.dataConsegnaFinale === 'string') {
                // Attempt to parse string dates
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

        if (result.success && (result.newJobs.length > 0 || result.jobsToUpdate.length > 0)) {
             setPendingImport({ newJobs: result.newJobs, jobsToUpdate: result.jobsToUpdate });
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
        fetchJobOrders();
    }
    setPendingImport(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0) return;
    const result = await deleteSelectedJobOrders(selectedRows);
    if (result.success) {
      toast({ title: "Operazione Riuscita", description: result.message });
      fetchJobOrders();
      setSelectedRows([]);
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  const handleDeleteAll = async () => {
    const result = await deleteAllPlannedJobOrders();
    if (result.success) {
      toast({ title: "Operazione Riuscita", description: result.message });
      fetchJobOrders();
      setSelectedRows([]);
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  return (
    <AdminAuthGuard>
      <AppShell>
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
              <Button asChild variant="outline">
                <a href="/template_import_commesse.xlsx" download>
                  <Download className="mr-2 h-4 w-4" />
                  Scarica Template
                </a>
              </Button>
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
                <DialogContent className="sm:max-w-[525px]">
                  <DialogHeader>
                    <DialogTitle>Aggiungi Nuova Commessa Pianificata</DialogTitle>
                    <DialogDescription>
                      Inserisci i dettagli per la nuova commessa. Apparirà in questo elenco.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleAddNewJobOrder)} className="space-y-4 py-4">
                       <FormField control={form.control} name="cliente" render={({ field }) => ( <FormItem> <FormLabel>Cliente</FormLabel> <FormControl> <Input placeholder="Es. Rossi S.p.A." {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="ordinePF" render={({ field }) => ( <FormItem> <FormLabel>Ordine PF (ID Commessa)</FormLabel> <FormControl> <Input placeholder="Es. PF-006" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="numeroODL" render={({ field }) => ( <FormItem> <FormLabel>Ordine Nr Est</FormLabel> <FormControl> <Input placeholder="Es. ORD-CLIENTE-01" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="details" render={({ field }) => ( <FormItem> <FormLabel>Codice</FormLabel> <FormControl> <Input placeholder="Es. ART-00123" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="qta" render={({ field }) => ( <FormItem> <FormLabel>Quantità</FormLabel> <FormControl> <Input type="number" placeholder="Es. 100" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="dataConsegnaFinale" render={({ field }) => ( <FormItem> <FormLabel>Data Consegna prevista</FormLabel> <FormControl> <Input type="date" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                       <FormField control={form.control} name="department" render={({ field }) => ( <FormItem> <FormLabel>Reparto</FormLabel> <FormControl> <Input placeholder="Es. Assemblaggio" {...field} /> </FormControl> <FormMessage /> </FormItem> )} />
                      <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="outline">Annulla</Button></DialogClose>
                        <Button type="submit">Aggiungi Commessa</Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center space-x-3">
                    <ListChecks className="h-8 w-8 text-primary" />
                    <div>
                    <CardTitle className="text-2xl font-headline mb-1">Commesse Pianificate</CardTitle>
                    <CardDescription>Commesse inserite in attesa di essere inviate in produzione.</CardDescription>
                    </div>
                </div>
                 <div className="flex items-center gap-2">
                  {selectedRows.length > 0 && (
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
                  )}
                   <AlertDialog>
                      <AlertDialogTrigger asChild>
                         <Button variant="outline" size="sm" disabled={jobOrders.length === 0}>
                           Svuota Elenco
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Questa azione non può essere annullata. Verranno eliminate tutte le {jobOrders.length} commesse pianificate.
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
              {jobOrders.length > 0 ? (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead padding="checkbox">
                        <Checkbox
                          checked={selectedRows.length > 0 && selectedRows.length === jobOrders.length}
                          onCheckedChange={handleSelectAll}
                          aria-label="Seleziona tutte"
                          indeterminate={selectedRows.length > 0 && selectedRows.length < jobOrders.length}
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
                    {jobOrders.map((job) => (
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
        </div>
        
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

      </AppShell>
    </AdminAuthGuard>
  );
}
