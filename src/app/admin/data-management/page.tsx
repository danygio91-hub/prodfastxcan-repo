
"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
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
import { ArrowLeft, ListChecks, Package, PlusCircle, Upload, Loader2, Download, Trash2, FileText } from 'lucide-react';
import { type JobOrder } from '@/lib/mock-data';
import { format, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { getJobOrders, addJobOrder, importJobOrders, deleteSelectedJobOrders, deleteAllJobOrders } from './actions';

const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, "Cliente è obbligatorio."),
  ordinePF: z.string().min(1, "Ordine PF (ID Commessa) è obbligatorio."),
  numeroODL: z.string().min(1, "Ordine Nr Est è obbligatorio."),
  details: z.string().min(1, "Codice è obbligatorio."),
  qta: z.string().refine(val => !isNaN(Number(val)) && Number(val) > 0, { message: "Quantità deve essere un numero positivo." }),
  dataConsegnaFinale: z.string().optional(), // Can be empty or a valid date string
  department: z.string().min(1, "Reparto è obbligatorio."),
});

type JobOrderFormValues = z.infer<typeof jobOrderFormSchema>;

export default function AdminDataManagementCommessePage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchJobOrders = () => {
    getJobOrders().then(orders => {
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
  
  const handleCreateOdl = (jobId: string) => {
    toast({
      title: "Funzionalità in sviluppo",
      description: `La creazione dell'ODL per la commessa ${jobId} sarà implementata a breve.`,
    });
  };

  const handleAddNewJobOrder = async (values: JobOrderFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      formData.append(key, value || '');
    });
    formData.append('postazioneLavoro', '');

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
        if (!data) {
          throw new Error("FileReader non ha restituito dati.");
        }

        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            throw new Error("Nessun foglio di lavoro trovato nel file Excel.");
        }
        const worksheet = workbook.Sheets[sheetName];
        
        const json = XLSX.utils.sheet_to_json(worksheet, {
            raw: true, // Keep raw values to handle dates robustly
        });

        const filteredData = json.filter((row: any) => 
            Object.values(row).some(cell => cell !== null && cell !== ''));

        if (filteredData.length === 0) {
          toast({
            variant: "destructive",
            title: "File Vuoto o Invalido",
            description: "Il file Excel non contiene righe di dati valide.",
          });
          setIsImporting(false);
          if (event.target) event.target.value = "";
          return;
        }

        const normalizedData = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
                if (Object.prototype.hasOwnProperty.call(row, key)) {
                    normalizedRow[key.trim().toLowerCase()] = row[key];
                }
            }
            return normalizedRow;
        });

        const requiredHeaders = ['cliente', 'ordine pf', 'ordine nr est', 'codice', 'qtà', 'data consegna prevista', 'reparto'];
        const firstRowHeaders = Object.keys(normalizedData[0] as any);
        const missingHeaders = requiredHeaders.filter(h => !firstRowHeaders.includes(h));
        
        if (missingHeaders.length > 0) {
           throw new Error(`Intestazioni mancanti o errate. Assicurati che il file Excel contenga le colonne corrette (non importa se maiuscole/minuscole). Colonne non trovate: ${missingHeaders.join(', ')}`);
        }
        
        const mappedJson = normalizedData.map((row: any) => {
          let finalDateStr = '';
          const dateValue = row['data consegna prevista'];

          if (dateValue) {
            let parsedDate: Date | null = null;
            if (dateValue instanceof Date && isValid(dateValue)) {
                parsedDate = dateValue;
            } else if (typeof dateValue === 'string') {
                 const dateString = String(dateValue).trim();
                 if (dateString) {
                    const formatsToTry = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy', 'yyyy-MM-dd'];
                    for (const fmt of formatsToTry) {
                        const tempDate = parse(dateString, fmt, new Date());
                        if (isValid(tempDate)) {
                            parsedDate = tempDate;
                            break; 
                        }
                    }
                 }
            } else if (typeof dateValue === 'number') {
                // Fallback for Excel serial dates if cellDates:true fails
                const excelEpoch = new Date(1899, 11, 30);
                const jsDate = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
                if (isValid(jsDate)) {
                    parsedDate = jsDate;
                }
            }
            
            if (parsedDate && isValid(parsedDate)) {
                 finalDateStr = format(parsedDate, 'yyyy-MM-dd');
            }
          }

          const qtaRaw = row['qtà'];
          const qtaNum = qtaRaw !== undefined && qtaRaw !== null && String(qtaRaw).trim() !== ''
            ? Number(String(qtaRaw).replace(',', '.'))
            : 0;

          return {
            cliente: String(row['cliente'] || ''),
            ordinePF: String(row['ordine pf'] || ''),
            numeroODL: String(row['ordine nr est'] || ''),
            details: String(row['codice'] || ''),
            qta: isNaN(qtaNum) ? 0 : qtaNum,
            dataConsegnaFinale: finalDateStr,
            department: String(row['reparto'] || ''),
          }
        });

        const result = await importJobOrders(mappedJson);
        
        toast({
          title: "Risultato Importazione",
          description: result.message,
        });

        if (result.success) {
          fetchJobOrders();
        }
      } catch (error) {
         toast({
          variant: "destructive",
          title: "Errore di Importazione",
          description: error instanceof Error ? error.message : "Si è verificato un errore sconosciuto. Controlla il formato del file e la correttezza dei dati.",
        });
      } finally {
        setIsImporting(false);
        if (event.target) {
          event.target.value = "";
        }
      }
    };
    reader.readAsArrayBuffer(file);
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
    const result = await deleteAllJobOrders();
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
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <Link href="/admin/dashboard" passHref>
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Torna alla Dashboard Admin
              </Button>
            </Link>
            <div className="flex items-center gap-2 flex-wrap justify-end flex-grow">
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
                    <DialogTitle>Aggiungi Nuova Commessa</DialogTitle>
                    <DialogDescription>
                      Inserisci i dettagli per la nuova commessa di produzione.
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
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center space-x-3">
                    <ListChecks className="h-8 w-8 text-primary" />
                    <div>
                    <CardTitle className="text-2xl font-headline mb-1">Gestione Dati: Elenco Commesse</CardTitle>
                    <CardDescription>Visualizza, aggiungi o importa le commesse di produzione.</CardDescription>
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
                            Questa azione non può essere annullata. Verranno eliminate definitivamente {selectedRows.length} commesse.
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
                            Questa azione non può essere annullata. Verranno eliminate tutte le {jobOrders.length} commesse.
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
                      <TableHead>Qtà</TableHead>
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
                          {job.dataConsegnaFinale ? format(new Date(job.dataConsegnaFinale), "dd MMM yyyy", { locale: it }) : 'N/D'}
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
      </AppShell>
    </AdminAuthGuard>
  );
}

    