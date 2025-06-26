
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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
import { ArrowLeft, ListChecks, Package, PlusCircle } from 'lucide-react';
import { type JobOrder } from '@/lib/mock-data';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { getJobOrders, addJobOrder } from './actions';

const jobOrderFormSchema = z.object({
  ordinePF: z.string().min(1, "Ordine PF è obbligatorio."),
  numeroODL: z.string().min(1, "Numero ODL è obbligatorio."),
  department: z.string().min(1, "Reparto è obbligatorio."),
  details: z.string().min(1, "Codice Articolo è obbligatorio."),
  dataConsegnaFinale: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)."),
  postazioneLavoro: z.string().min(1, "Postazione di lavoro è obbligatoria."),
});

type JobOrderFormValues = z.infer<typeof jobOrderFormSchema>;

export default function AdminDataManagementCommessePage() {
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    getJobOrders().then(orders => {
      setJobOrders(orders);
    });
  }, []);

  const form = useForm<JobOrderFormValues>({
    resolver: zodResolver(jobOrderFormSchema),
    defaultValues: {
      ordinePF: "",
      numeroODL: "",
      department: "",
      details: "",
      dataConsegnaFinale: "",
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
                          <FormLabel>Numero ODL</FormLabel>
                          <FormControl>
                            <Input placeholder="Es. ODL-800" {...field} />
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
                            <Input placeholder="Es. Assemblaggio Componenti Elettronici" {...field} />
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
                          <FormLabel>Codice Articolo / Descrizione Lavorazione</FormLabel>
                          <FormControl>
                            <Input placeholder="Es. Assemblaggio prodotto Alfa" {...field} />
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
                          <FormLabel>Data Consegna Finale</FormLabel>
                          <FormControl>
                            <Input type="date" placeholder="YYYY-MM-DD" {...field} />
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

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <ListChecks className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline mb-1">Gestione Dati: Elenco Commesse</CardTitle>
                  <CardDescription>Visualizza e gestisci le commesse di produzione esistenti.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {jobOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ordine PF</TableHead>
                      <TableHead>N° ODL</TableHead>
                      <TableHead>Reparto</TableHead>
                      <TableHead className="min-w-[250px]">Codice Articolo</TableHead>
                      <TableHead>Data Consegna</TableHead>
                      <TableHead>Postazione Lavoro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobOrders.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">{job.ordinePF}</TableCell>
                        <TableCell>{job.numeroODL}</TableCell>
                        <TableCell>{job.department}</TableCell>
                        <TableCell>{job.details}</TableCell>
                        <TableCell>
                          {format(new Date(job.dataConsegnaFinale), "dd MMM yyyy", { locale: it })}
                        </TableCell>
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
                    Non ci sono commesse attualmente nel sistema. Puoi aggiungerne usando il pulsante apposito.
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
