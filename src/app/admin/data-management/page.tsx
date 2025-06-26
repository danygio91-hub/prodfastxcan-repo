
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
  ordinePF: z.string().min(1, "Ordine PF è obbligatorio."),
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
    // Convert flat object to FormData
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
      // Re-fetch the job orders to update the list
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
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const json = XLSX.utils.sheet_to_json(worksheet, { cellDates: true });

        if (json.length === 0) {
          toast({
            variant: "destructive",
            title: "File Vuoto",
            description: "Il file Excel non contiene dati o è in un formato non riconosciuto.",
          });
          return;
        }

        // Map Excel columns to the structure expected by the server action
        const mappedJson = json.map((row: any) => {
          let finalDate = row['Consegna prevista'] || row['dataConsegnaFinale'];
          if (finalDate instanceof Date) {
            finalDate.setMinutes(finalDate.getMinutes() - finalDate.getTimezoneOffset());
            finalDate = finalDate.toISOString().split('T')[0];
          }

          return {
            cliente: String(row['Cliente'] || ''),
            ordinePF: String(row['Ordine PF'] || ''),
            numeroODL: String(row['Ordine Nr Est'] || ''),
            details: String(row['Codice'] || ''),
            qta: Number(row['Qtà'] || 0),
            dataConsegnaFinale: String(finalDate || ''),
            department: String(row['Reparto'] || ''),
          }
        });

        const result = await importJobOrders(mappedJson);
        
        toast({
          title: "Risultato Importazione",
          description: result.message,
        });

        if (result.message.includes('importate')) {
          getJobOrders().then(setJobOrders);
        }
      } catch (error) {
         toast({
          variant: "destructive",
          title: "Errore Lettura File",
          description: "Impossibile leggere il file. Assicurati che sia un file Excel (.xlsx, .xls) non corrotto.",
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
                          {format(new Date(job.dataConsegnaFinale), "dd MMM yyyy", { locale: it })}
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
