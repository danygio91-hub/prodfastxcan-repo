

"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

import { type Operator, type Reparto, reparti } from '@/lib/mock-data';
import { saveOperator, deleteOperator } from './actions';
import { cn } from '@/lib/utils';
import type { StatoOperatore, OperatorRole } from '@/lib/mock-data';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Users, PlusCircle, Edit, Trash2, CheckCircle2, ShieldAlert, Download, Mail, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';


const operatorFormSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1, "Il nome è obbligatorio."),
  cognome: z.string().optional(),
  email: z.string().email("Formato email non valido.").refine(email => email.endsWith('@prodfastxcan.app'), {
    message: "L'email deve terminare con @prodfastxcan.app",
  }),
  reparto: z.array(z.string()).max(3, "Puoi selezionare al massimo 3 reparti.").optional(),
  role: z.enum(['admin', 'superadvisor', 'operator']),
}).refine(data => {
    if (data.role === 'operator') {
        return data.reparto && data.reparto.length > 0;
    }
    return true;
}, {
    message: "Selezionare almeno un reparto per il ruolo operatore.",
    path: ["reparto"],
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

interface OperatorManagementClientPageProps {
  initialOperators: Operator[];
}

export default function OperatorManagementClientPage({ initialOperators }: OperatorManagementClientPageProps) {
  const [operators, setOperators] = useState<Operator[]>(initialOperators);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const form = useForm<OperatorFormValues>({
    resolver: zodResolver(operatorFormSchema),
    defaultValues: {
      id: undefined,
      nome: "",
      cognome: "",
      email: "",
      reparto: [],
      role: 'operator',
    },
  });

  const watchedRole = form.watch('role');
  const roles: OperatorRole[] = ['admin', 'superadvisor', 'operator'];
  const operationalReparti = reparti.filter(r => r !== 'N/D' && r !== 'Officina');


  useEffect(() => {
    if (watchedRole === 'admin' || watchedRole === 'superadvisor') {
      form.setValue('reparto', []);
    }
  }, [watchedRole, form]);

  const refreshData = () => {
    router.refresh();
  };

  const handleOpenDialog = (operator: Operator | null = null) => {
    setEditingOperator(operator);
    if (operator) {
      form.reset({
        id: operator.id,
        nome: operator.nome,
        cognome: operator.cognome || '',
        email: operator.email || '',
        reparto: Array.isArray(operator.reparto) ? operator.reparto : [operator.reparto],
        role: operator.role,
      });
    } else {
      form.reset({ id: undefined, nome: "", cognome: "", email: "", reparto: [], role: 'operator' });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingOperator(null);
    form.reset();
  }

  const onSubmit = async (values: OperatorFormValues) => {
    const result = await saveOperator(values);

    if (result.success) {
      toast({ title: "Successo", description: result.message });
      refreshData();
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
      refreshData();
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  const handleExport = () => {
    const dataToExport = operators.map(op => ({
        'ID': op.id,
        'Nome': op.nome,
        'Cognome': op.cognome,
        'Email': op.email,
        'Reparto': Array.isArray(op.reparto) ? op.reparto.join(', ') : op.reparto,
        'Ruolo': op.role,
        'Stato': op.stato,
        'Privacy Firmata': op.privacySigned ? 'Sì' : 'No',
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Operatori");
    XLSX.writeFile(wb, "elenco_operatori.xlsx");
  };

  return (
      <div className="space-y-6">
        <AdminNavMenu />

        <div className="flex justify-end gap-2">
          <Button onClick={handleExport} variant="outline" disabled={operators.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Esporta Operatori
          </Button>
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
                    <TableHead>Email</TableHead>
                    <TableHead>Reparto</TableHead>
                    <TableHead>Ruolo</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Privacy</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operators.length > 0 ? (
                    operators.map((op) => {
                      const opReparti = Array.isArray(op.reparto) ? op.reparto : [op.reparto];
                      const validReparti = op.role === 'superadvisor' ? ['Officina'] : opReparti.filter(r => reparti.includes(r));
                      
                      return (
                      <TableRow key={op.id}>
                        <TableCell className="font-medium">{op.nome} {op.cognome}</TableCell>
                        <TableCell>{op.email}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {validReparti.map(r => <Badge key={r} variant="secondary">{r}</Badge>)}
                          </div>
                        </TableCell>
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
                      )
                    })
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

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { e.preventDefault(); handleCloseDialog(); }} onEscapeKeyDown={(e) => { e.preventDefault(); handleCloseDialog(); }}>
            <DialogHeader>
              <DialogTitle>{editingOperator ? "Modifica Operatore" : "Aggiungi Nuovo Operatore"}</DialogTitle>
              <DialogDescription>
                {editingOperator ? "Modifica i dettagli dell'operatore." : "Compila i campi per aggiungere un nuovo operatore. L'email deve corrispondere a quella dell'utente creato in Firebase Authentication."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Nome</FormLabel>
                        <FormControl><Input placeholder="Es. Mario" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                    )} />
                    <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Cognome</FormLabel>
                        <FormControl><Input placeholder="Es. Rossi" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                    )} />
                </div>
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center"><Mail className="mr-2 h-4 w-4"/>Email (per il login)</FormLabel>
                    <FormControl><Input type="email" placeholder="es. m.rossi@prodfastxcan.app" {...field} /></FormControl>
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
                {watchedRole === 'operator' && (
                  <FormField
                    control={form.control}
                    name="reparto"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel>Reparti di Competenza</FormLabel>
                          <FormDescription>
                            Seleziona uno o più reparti (max 3).
                          </FormDescription>
                        </div>
                        {operationalReparti.map((item) => (
                          <FormField
                            key={item}
                            control={form.control}
                            name="reparto"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={item}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(item)}
                                      onCheckedChange={(checked) => {
                                        const currentValue = field.value || [];
                                        return checked
                                          ? field.onChange([...currentValue, item])
                                          : field.onChange(
                                              currentValue.filter(
                                                (value) => value !== item
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal">
                                    {item}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>Annulla</Button>
                  <Button type="submit">{editingOperator ? "Salva Modifiche" : "Aggiungi Operatore"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

      </div>
  );
}
