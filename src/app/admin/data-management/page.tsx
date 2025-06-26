
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, ListChecks, Package, PlusCircle, Upload, Loader2, Download } from 'lucide-react';
import { type JobOrder } from '@/lib/mock-data';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { getJobOrders, addJobOrder, importJobOrders } from './actions';

const jobOrderFormSchema = z.object({
  cliente: z.string().min(1, "Cliente è obbligatorio."),
  ordinePF: z.string().min(1, "Ordine PF (ID Commessa) è obbligatorio."),
  numeroODL: z.string().min(1, "Ordine Nr Est è obbligatorio."),
  details: z.string().min(1, "Codice è obbligatorio."),
  qta: z.string().refine(val => !isNaN(Number(val)) && Number(val) > 0, { message: "Quantità deve essere un numero positivo." }),
  dataConsegnaFinale: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)."),
  department: z.string().min(1, "Reparto è obbligatorio."),
  postazioneLavoro: z.string().min(1, "Postazione di lavoro è obbligatoria."),
});

type JobOrderFormValues = z.infer<typeof jobOrderFormSchema>;

export default function AdminDataManagementCommessePage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    getJobOrders().then(orders => {
      setJobOrders(orders);
    });
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
      postazioneLavoro: "",
    },
  });

  const handleAddNewJobOrder = async (values: JobOrderFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const result = await addJobOrder(formData);

    if (result.success) {
      toast({
        title: "Operazione Riuscita",
        description: result.message,
      });
      form.reset();
      setIsAddDialogOpen(false);
      getJobOrders().then(orders => {
        setJobOrders(orders);
      });
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

        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            throw new Error("Nessun foglio di lavoro trovato nel file Excel.");
        }
        const worksheet = workbook.Sheets[sheetName];
        
        const json = XLSX.utils.sheet_to_json(worksheet, { cellDates: true, raw: false });

        // Filter out empty rows that might be read by the library
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

        const requiredHeaders = ['cliente', 'ordine pf', 'ordine nr est', 'codice', 'qtà', 'consegna prevista', 'reparto'];
        const firstRowHeaders = Object.keys(normalizedData[0] as any);
        const missingHeaders = requiredHeaders.filter(h => !firstRowHeaders.includes(h));
        
        if (missingHeaders.length > 0) {
           throw new Error(`Intestazioni mancanti o errate. Assicurati che il file Excel contenga le colonne corrette (non importa se maiuscole/minuscole). Colonne non trovate: ${missingHeaders.join(', ')}`);
        }
        
        const mappedJson = normalizedData.map((row: any) => {
          let finalDate = row['consegna prevista'];

          if (finalDate instanceof Date) {
            const year = finalDate.getFullYear();
            if(year > 1900) {
              const month = String(finalDate.getMonth() + 1).padStart(2, '0');
              const day = String(finalDate.getDate()).padStart(2, '0');
              finalDate = `${year}-${month}-${day}`;
            } else {
              finalDate = '';
            }
          } else if (typeof finalDate === 'string' && finalDate.trim()) {
              if (/^\d{4}-\d{2}-\d{2}$/.test(finalDate.trim())) {
                finalDate = finalDate.trim();
              } else if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(finalDate.trim())) {
                const parts = finalDate.trim().split(/[\/-]/);
                finalDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
              } else {
                finalDate = '';
              }
          } else {
             finalDate = '';
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
            dataConsegnaFinale: String(finalDate || ''),
            department: String(row['reparto'] || ''),
          }
        });

        const result = await importJobOrders(mappedJson);
        
        toast({
          title: "Risultato Importazione",
          description: result.message,
        });

        if (result.success && result.message.includes('importate')) {
          getJobOrders().then(setJobOrders);
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

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <Link href="/admin/dashboard" passHref>
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Torna alla Dashboard Admin
              </Button>
            </Link>
            <div className="flex items-center gap-4">
              <Button asChild variant="outline">
                <a href="/template_import_commesse.xlsx" download>
                  <Download className="mr-2 h-4 w-4" />
                  Scarica Template
                </a>
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
                className="hidden"
              />
              <Button onClick={handleImportClick} variant="outline" disabled={isImporting}>
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {isImporting ? "Importazione..." : "Importa da Excel"}
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
                       <FormField
                        control={form.control}
                        name="cliente"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Cliente</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. Rossi S.p.A." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="ordinePF"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ordine PF (ID Commessa)</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. PF-006" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="numeroODL"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ordine Nr Est</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. ORD-CLIENTE-01" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                       <FormField
                        control={form.control}
                        name="details"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Codice</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. ART-00123" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="qta"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Quantità</FormLabel>
                            <FormControl>
                              <Input type="number" placeholder="Es. 100" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dataConsegnaFinale"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Consegna prevista</FormLabel>
                            <FormControl>
                              <Input type="date" placeholder="YYYY-MM-DD" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="department"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reparto</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. Assemblaggio" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="postazioneLavoro"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Postazione di Lavoro Prevista</FormLabel>
                            <FormControl>
                              <Input placeholder="Es. Postazione A-01" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="outline">Annulla</Button>
                        </DialogClose>
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
              <div className="flex items-center space-x-3">
                <ListChecks className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline mb-1">Gestione Dati: Elenco Commesse</CardTitle>
                  <CardDescription>Visualizza, aggiungi o importa le commesse di produzione.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {jobOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Ordine PF</TableHead>
                      <TableHead>Ordine Nr Est</TableHead>
                      <TableHead className="min-w-[200px]">Codice</TableHead>
                      <TableHead>Qtà</TableHead>
                      <TableHead>Consegna Prevista</TableHead>
                      <TableHead>Reparto</TableHead>
                      <TableHead>Postazione Lavoro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobOrders.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>{job.cliente}</TableCell>
                        <TableCell className="font-medium">{job.ordinePF}</TableCell>
                        <TableCell>{job.numeroODL}</TableCell>
                        <TableCell>{job.details}</TableCell>
                        <TableCell>{job.qta}</TableCell>
                        <TableCell>
                          {job.dataConsegnaFinale ? format(new Date(job.dataConsegnaFinale), "dd MMM yyyy", { locale: it }) : 'N/D'}
                        </TableCell>
                        <TableCell>{job.department}</TableCell>
                        <TableCell>{job.postazioneLavoro}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-lg font-semibold text-muted-foreground">Nessuna commessa trovata.</p>

                  <p className="text-sm text-muted-foreground">
                    Non ci sono commesse attualmente nel sistema. Puoi aggiungerne una manualmente o importarle da un file Excel.
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

    