

"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

import { type Workstation, type Department } from '@/lib/mock-data';
import { getWorkstations, saveWorkstation, deleteWorkstation, getDepartments } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Computer, PlusCircle, Edit, Trash2, Download, Loader2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

const workstationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  departmentCode: z.string().min(1, 'Selezionare un reparto.'),
});

type WorkstationFormValues = z.infer<typeof workstationSchema>;


function WorkstationManagementContent() {
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const { toast } = useToast();

  const form = useForm<WorkstationFormValues>({
    resolver: zodResolver(workstationSchema),
    defaultValues: { id: undefined, name: "" },
  });
  
  const operationalReparti = departments.filter(d => d.code !== 'N/D');


  const fetchWorkstations = async () => {
    setIsLoading(true);
    const data = await getWorkstations();
    setWorkstations(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchWorkstations();
    getDepartments().then(setDepartments);
  }, []);

  const handleOpenDialog = (workstation: Workstation | null = null) => {
    setEditingWorkstation(workstation);
    if (workstation) {
      form.reset(workstation);
    } else {
      form.reset({ id: undefined, name: "", departmentCode: undefined });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingWorkstation(null);
    form.reset();
  }

  const onSubmit = async (values: WorkstationFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });
    
    setIsPending(true);
    const result = await saveWorkstation(formData);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      await fetchWorkstations();
      handleCloseDialog();
    }
    setIsPending(false);
  };

  const handleDelete = async (id: string) => {
    setIsPending(true);
    const result = await deleteWorkstation(id);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchWorkstations();
    setIsPending(false);
  };
  
  const handleExport = () => {
    const departmentNameMap = new Map(departments.map(d => [d.code, d.name]));
    const dataToExport = workstations.map(ws => ({
        'ID': ws.id,
        'Nome Postazione': ws.name,
        'Reparto': departmentNameMap.get(ws.departmentCode) || ws.departmentCode,
    }));
    const ws_data = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws_data, "Postazioni");
    XLSX.writeFile(wb, "postazioni_lavoro.xlsx");
  };

  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={3} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento postazioni...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <header>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Computer className="h-8 w-8 text-primary" />
                Gestione Postazioni di Lavoro
                </h1>
                <p className="text-muted-foreground mt-2">
                Configura i banchi di lavoro, le macchine e le altre postazioni produttive.
                </p>
            </header>
            <div className="flex items-center gap-2">
                <Button onClick={handleExport} variant="outline" disabled={isLoading || workstations.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Esporta Postazioni
                </Button>
                <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Aggiungi Postazione
                </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Postazioni</CardTitle>
              <CardDescription>Queste sono le postazioni di lavoro disponibili in azienda.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome Postazione</TableHead>
                      <TableHead>Reparto di Competenza</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : workstations.length > 0 ? (
                      workstations.map((ws) => (
                        <TableRow key={ws.id}>
                          <TableCell className="font-medium">{ws.name}</TableCell>
                          <TableCell>{departments.find(d => d.code === ws.departmentCode)?.name || ws.departmentCode}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(ws)} disabled={isPending}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon" disabled={isPending}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Questa azione non può essere annullata. La postazione verrà eliminata.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(ws.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center h-24">Nessuna postazione definita.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[425px]" onInteractOutside={(e) => { if (!isPending) handleCloseDialog() }}>
            <DialogHeader>
              <DialogTitle>{editingWorkstation ? "Modifica Postazione" : "Aggiungi Nuova Postazione"}</DialogTitle>
              <DialogDescription>
                {editingWorkstation ? "Modifica i dettagli della postazione." : "Compila i campi per aggiungere una nuova postazione."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Postazione</FormLabel>
                    <FormControl><Input placeholder="Es. Banco Saldatura 01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="departmentCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reparto di Competenza</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona un reparto" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {operationalReparti.map(d => <SelectItem key={d.id} value={d.code}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isPending}>Annulla</Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {editingWorkstation ? "Salva Modifiche" : "Aggiungi Postazione"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
  );
}

export default function WorkstationManagementPage() {
    return (
        <AdminAuthGuard>
            <AppShell>
                <WorkstationManagementContent />
            </AppShell>
        </AdminAuthGuard>
    )
}
