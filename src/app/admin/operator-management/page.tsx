
"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type Operator, type Reparto, type OperatorRole, reparti, operatorReparti, roles } from '@/lib/mock-data';
import { getOperators, saveOperator, deleteOperator } from './actions';
import { cn } from '@/lib/utils';
import type { StatoOperatore } from '@/lib/mock-data';


import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Users, PlusCircle, Edit, Trash2, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';


const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, "Il nome è obbligatorio."),
  cognome: z.string().optional(),
  reparto: z.enum(['CP', 'CG', 'BF', 'MAG', 'N/D', 'Officina']),
  role: z.enum(['admin', 'superadvisor', 'operator']),
});

type OperatorFormValues = z.infer<typeof operatorFormSchema>;

const StatusBadge = ({ status }: { status: StatoOperatore }) => (
  <Badge
    className={cn(
      "text-xs font-semibold",
      status === 'attivo' && "bg-green-500/20 text-green-700 border-green-400",
      status === 'inattivo' && "bg-gray-500/20 text-gray-700 border-gray-400",
      status === 'in pausa' && "bg-orange-500/20 text-orange-700 border-orange-400"
    )}
    variant="outline"
  >
    {status.charAt(0).toUpperCase() + status.slice(1)}
  </Badge>
);

export default function AdminOperatorManagementPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  const { toast } = useToast();

  const form = useForm<OperatorFormValues>({
    resolver: zodResolver(operatorFormSchema),
    defaultValues: {
      id: undefined,
      nome: "",
      cognome: "",
      reparto: 'CP',
      role: 'operator',
    },
  });

  const watchedRole = form.watch('role');

  useEffect(() => {
    if (watchedRole === 'admin') {
      form.setValue('reparto', 'N/D');
    } else if (watchedRole === 'superadvisor') {
      form.setValue('reparto', 'Officina');
    }
  }, [watchedRole, form]);

  const fetchOperators = async () => {
    const data = await getOperators();
    setOperators(data);
  };

  useEffect(() => {
    fetchOperators();
  }, []);

  const handleOpenDialog = (operator: Operator | null = null) => {
    setEditingOperator(operator);
    if (operator) {
      form.reset(operator);
    } else {
      form.reset({ id: undefined, nome: "", cognome: "", reparto: 'CP', role: 'operator' });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingOperator(null);
    form.reset();
  }

  const onSubmit = async (values: OperatorFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value) {
        formData.append(key, value);
      }
    });

    const result = await saveOperator(formData);

    if (result.success) {
      toast({ title: "Successo", description: result.message });
      await fetchOperators();
      handleCloseDialog();
    } else {
      toast({
        variant: "destructive",
        title: "Errore",
        description: result.message || "Impossibile salvare l'operatore.",
      });
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteOperator(id);
    if (result.success) {
      toast({ title: "Successo", description: result.message });
      await fetchOperators();
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />

          <div className="flex justify-end">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Aggiungi Operatore
            </Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline">Gestione Operatori</CardTitle>
                  <CardDescription>Aggiungi, modifica o elimina gli account degli operatori.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Cognome</TableHead>
                      <TableHead>Reparto</TableHead>
                      <TableHead>Ruolo</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead>Privacy</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operators.length > 0 ? (
                      operators.map((op) => (
                        <TableRow key={op.id}>
                          <TableCell className="font-medium">{op.nome}</TableCell>
                          <TableCell>{op.cognome}</TableCell>
                          <TableCell>{op.reparto}</TableCell>
                          <TableCell className="capitalize">{op.role}</TableCell>
                          <TableCell><StatusBadge status={op.stato} /></TableCell>
                          <TableCell>
                             <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center justify-center">
                                    {op.privacySigned ? (
                                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    ) : (
                                        <ShieldAlert className="h-5 w-5 text-yellow-500" />
                                    )}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{op.privacySigned ? 'Informativa Firmata' : 'Informativa Non Firmata'}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(op)}>
                              <Edit className="h-4 w-4" />
                              <span className="sr-only">Modifica</span>
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon">
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">Elimina</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Questa azione non può essere annullata. L'operatore verrà eliminato definitivamente.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(op.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-24">Nessun operatore trovato.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[425px]" onInteractOutside={(e) => { e.preventDefault(); handleCloseDialog(); }} onEscapeKeyDown={(e) => { e.preventDefault(); handleCloseDialog(); }}>
            <DialogHeader>
              <DialogTitle>{editingOperator ? "Modifica Operatore" : "Aggiungi Nuovo Operatore"}</DialogTitle>
              <DialogDescription>
                {editingOperator ? "Modifica i dettagli dell'operatore." : "Compila i campi per aggiungere un nuovo operatore."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Es. Mario" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cognome (Opzionale)</FormLabel>
                    <FormControl><Input placeholder="Es. Rossi" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                 <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ruolo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona un ruolo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {watchedRole !== 'admin' && (
                  <FormField control={form.control} name="reparto" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reparto</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={watchedRole === 'superadvisor'}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona un reparto" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(watchedRole === 'operator' ? operatorReparti : reparti).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>Annulla</Button>
                  <Button type="submit">{editingOperator ? "Salva Modifiche" : "Aggiungi Operatore"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

      </AppShell>
    </AdminAuthGuard>
  );
}
