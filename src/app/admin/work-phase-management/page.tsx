
"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type WorkPhaseTemplate, type Reparto, reparti } from '@/lib/mock-data';
import { getWorkPhaseTemplates, saveWorkPhaseTemplate, deleteWorkPhaseTemplate, getDepartmentMap } from './actions';

import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Workflow, PlusCircle, Edit, Trash2 } from 'lucide-react';

const workPhaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().min(10, 'La descrizione deve avere almeno 10 caratteri.'),
  departmentCode: z.enum(reparti),
});

type WorkPhaseFormValues = z.infer<typeof workPhaseSchema>;

export default function AdminWorkPhaseManagementPage() {
  const [phases, setPhases] = useState<WorkPhaseTemplate[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<WorkPhaseTemplate | null>(null);
  const [departmentMap, setDepartmentMap] = useState<{ [key in Reparto]?: string }>({});
  const { toast } = useToast();

  const form = useForm<WorkPhaseFormValues>({
    resolver: zodResolver(workPhaseSchema),
    defaultValues: { id: undefined, name: "", description: "", departmentCode: 'CP' },
  });

  const fetchPhases = async () => {
    const data = await getWorkPhaseTemplates();
    setPhases(data);
  };

  useEffect(() => {
    fetchPhases();
    getDepartmentMap().then(setDepartmentMap);
  }, []);

  const handleOpenDialog = (phase: WorkPhaseTemplate | null = null) => {
    setEditingPhase(phase);
    if (phase) {
      form.reset(phase);
    } else {
      form.reset({ id: undefined, name: "", description: "", departmentCode: 'CP' });
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
    Object.entries(values).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });

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
  };

  const handleDelete = async (id: string) => {
    const result = await deleteWorkPhaseTemplate(id);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchPhases();
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
                Definisci le fasi "modello" che possono essere incluse nei cicli di lavorazione delle commesse.
                </p>
            </header>
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Aggiungi Fase
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Fasi Standard</CardTitle>
              <CardDescription>Queste sono le fasi disponibili per la configurazione dei cicli di lavoro.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome Fase</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Reparto di Competenza</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {phases.length > 0 ? (
                      phases.map((phase) => (
                        <TableRow key={phase.id}>
                          <TableCell className="font-medium">{phase.name}</TableCell>
                          <TableCell className="max-w-sm truncate">{phase.description}</TableCell>
                          <TableCell>{departmentMap[phase.departmentCode] || phase.departmentCode}</TableCell>
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
                        <TableCell colSpan={4} className="text-center h-24">Nessuna fase definita.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[525px]" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
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
                        {reparti.map(r => <SelectItem key={r} value={r}>{departmentMap[r] || r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>Annulla</Button>
                  <Button type="submit">{editingPhase ? "Salva Modifiche" : "Aggiungi Fase"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminAuthGuard>
  );
}
