
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type Department } from '@/lib/mock-data';
import { getDepartments, saveDepartment, deleteDepartments } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { ListTodo, PlusCircle, Edit, Trash2, Loader2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

const departmentSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1, "Il codice è obbligatorio.").max(10, "Il codice non può superare i 10 caratteri."),
  name: z.string().min(3, "Il nome deve avere almeno 3 caratteri."),
  macroAreas: z.array(z.enum(['PREPARAZIONE', 'PRODUZIONE', 'QLTY_PACK'])).min(1, "Seleziona almeno una macro area."),
  dependsOnPreparation: z.boolean().default(false),
});

type DepartmentFormValues = z.infer<typeof departmentSchema>;

export default function DepartmentManagementPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { 
      id: undefined, 
      code: "", 
      name: "", 
      macroAreas: ['PRODUZIONE'], 
      dependsOnPreparation: false 
    },
  });

  const fetchData = async () => {
    setIsLoading(true);
    const data = await getDepartments();
    setDepartments(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenDialog = (department: Department | null = null) => {
    setEditingDepartment(department);
    if (department) {
      form.reset({
        id: department.id,
        code: department.code,
        name: department.name,
        macroAreas: department.macroAreas || [],
        dependsOnPreparation: !!department.dependsOnPreparation
      });
    } else {
      form.reset({ 
        id: undefined, 
        code: "", 
        name: "", 
        macroAreas: ['PRODUZIONE'], 
        dependsOnPreparation: false 
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingDepartment(null);
    form.reset();
  };

  const onSubmit = async (values: DepartmentFormValues) => {
    const formData = new FormData();
    formData.append('id', values.id || "");
    formData.append('code', values.code);
    formData.append('name', values.name);
    values.macroAreas.forEach(area => formData.append('macroAreas', area));
    if (values.dependsOnPreparation) formData.append('dependsOnPreparation', 'on');

    setIsPending(true);
    const result = await saveDepartment(formData);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      await fetchData();
      handleCloseDialog();
    }
    setIsPending(false);
  };

  const handleDeleteSelected = async () => {
    setIsPending(true);
    const result = await deleteDepartments(selectedRows);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      await fetchData();
      setSelectedRows([]);
    }
    setIsPending(false);
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    setSelectedRows(checked === true ? departments.map(d => d.id) : []);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
  };

  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={5} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento reparti...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <header>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <ListTodo className="h-8 w-8 text-primary" />
                Gestione Reparti
              </h1>
              <p className="text-muted-foreground mt-2">
                Aggiungi, modifica o elimina i reparti produttivi e di servizio.
              </p>
            </header>
            <div className="flex items-center gap-2">
                {selectedRows.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={isPending}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                        Elimina ({selectedRows.length})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                        <AlertDialogDescription>
                          L'eliminazione di un reparto potrebbe causare problemi se è associato a operatori o fasi. Sei sicuro di voler eliminare {selectedRows.length} reparti?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteSelected}>Continua</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Nuovo Reparto
                </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Reparti</CardTitle>
              <CardDescription>Questi reparti saranno selezionabili nella gestione degli operatori e delle fasi.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead padding="checkbox">
                        <Checkbox
                          checked={!isLoading && selectedRows.length > 0 && selectedRows.length === departments.length ? true : !isLoading && selectedRows.length > 0 ? 'indeterminate' : false}
                          onCheckedChange={handleSelectAll}
                          aria-label="Seleziona tutti"
                          disabled={isLoading || departments.length === 0}
                        />
                      </TableHead>
                      <TableHead>Codice</TableHead>
                      <TableHead>Nome Reparto</TableHead>
                      <TableHead>Macro Area</TableHead>
                      <TableHead>Dip. Prep.</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : departments.length > 0 ? (
                      departments.map((dept) => (
                        <TableRow key={dept.id} data-state={selectedRows.includes(dept.id) && "selected"}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedRows.includes(dept.id)}
                              onCheckedChange={() => handleSelectRow(dept.id)}
                              aria-label={`Seleziona il reparto ${dept.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono">{dept.code}</TableCell>
                          <TableCell className="font-medium">{dept.name}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {dept.macroAreas?.map((area: string) => (
                                <Badge key={area} variant={area === 'PRODUZIONE' ? 'default' : area === 'PREPARAZIONE' ? 'secondary' : 'outline'}>
                                  {area}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {dept.dependsOnPreparation ? (
                              <Badge variant="warning">SI</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(dept)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center h-24">Nessun reparto trovato.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md" onInteractOutside={(e) => {if (!isPending) handleCloseDialog();}}>
            <DialogHeader>
              <DialogTitle>{editingDepartment ? "Modifica Reparto" : "Aggiungi Nuovo Reparto"}</DialogTitle>
              <DialogDescription>
                Compila i campi per definire un nuovo reparto aziendale.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField control={form.control} name="code" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Codice</FormLabel>
                    <FormControl><Input placeholder="Es. CP, MAG" {...field} disabled={!!editingDepartment} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Es. Controllo Qualità" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormItem>
                  <FormLabel>Macro Aree Pianificazione</FormLabel>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border p-4 bg-muted/20">
                    {['PREPARAZIONE', 'PRODUZIONE', 'QLTY_PACK'].map((area) => (
                      <FormField
                        key={area}
                        control={form.control}
                        name="macroAreas"
                        render={({ field }) => {
                          const isChecked = field.value?.includes(area as any);
                          return (
                            <FormItem key={area} className="flex flex-row items-center space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const currentValues = field.value || [];
                                    const nextValues = checked
                                      ? [...currentValues, area as any]
                                      : currentValues.filter((v) => v !== area);
                                    field.onChange(nextValues);
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-xs font-medium cursor-pointer uppercase">
                                {area === 'QLTY_PACK' ? 'QUALITÀ & PACK' : area}
                              </FormLabel>
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>

                {!(form.watch('macroAreas') || []).includes('PREPARAZIONE') && (
                  <FormField
                    control={form.control}
                    name="dependsOnPreparation"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm text-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Dipende da Preparazione</FormLabel>
                          <div className="text-[0.7rem] text-muted-foreground">
                            Se attivo, la produzione non può iniziare finché la preparazione non è conclusa.
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isPending}>Annulla</Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {editingDepartment ? "Salva Modifiche" : "Crea Reparto"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  </AdminAuthGuard>
  );
}
