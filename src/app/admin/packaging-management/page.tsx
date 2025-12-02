
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

import { type Packaging, type PackagingAssociation, RawMaterialTypeValues } from '@/lib/mock-data';
import { getPackagingItems, savePackagingItem, deletePackagingItem } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Archive, PlusCircle, Edit, Trash2, Loader2, Weight, Link2 } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

const packagingAssociationTypes: PackagingAssociation[] = [...RawMaterialTypeValues, 'PRODOTTO'];

const packagingSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Il nome deve avere almeno 3 caratteri.'),
  description: z.string().optional(),
  weightKg: z.coerce.number().min(0, 'Il peso non può essere negativo.'),
  associatedTypes: z.array(z.string()).optional(),
});

type PackagingFormValues = z.infer<typeof packagingSchema>;

export default function PackagingManagementPage() {
  const [items, setItems] = useState<Packaging[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Packaging | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  const form = useForm<PackagingFormValues>({
    resolver: zodResolver(packagingSchema),
    defaultValues: { id: undefined, name: "", description: "", weightKg: 0, associatedTypes: [] },
  });

  const fetchData = async () => {
    setIsLoading(true);
    const data = await getPackagingItems();
    setItems(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenDialog = (item: Packaging | null = null) => {
    setEditingItem(item);
    if (item) {
      form.reset({
        ...item,
        associatedTypes: item.associatedTypes || [],
      });
    } else {
      form.reset({ id: undefined, name: "", description: "", weightKg: 0, associatedTypes: [] });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingItem(null);
    form.reset();
  };

  const onSubmit = async (values: PackagingFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (key === 'associatedTypes' && Array.isArray(value)) {
        value.forEach(v => formData.append(key, v));
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });
    
    setIsPending(true);
    const result = await savePackagingItem(formData);
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

  const handleDelete = async (id: string) => {
    setIsPending(true);
    const result = await deletePackagingItem(id);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchData();
    setIsPending(false);
  };
  
  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={5} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento imballi...</span>
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
                <Archive className="h-8 w-8 text-primary" />
                Gestione Imballi (Tare)
              </h1>
              <p className="text-muted-foreground mt-2">
                Definisci gli imballi e le relative tare da associare ai materiali.
              </p>
            </header>
            <div className="flex items-center gap-2">
                <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Nuovo Imballo
                </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Anagrafica Imballi</CardTitle>
              <CardDescription>Elenco degli imballi, del loro peso (tara) e a cosa sono associati.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome Imballo</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Peso (Kg)</TableHead>
                      <TableHead>Associazione</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : items.length > 0 ? (
                      items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.description || 'N/D'}</TableCell>
                          <TableCell>{Number(item.weightKg)}</TableCell>
                           <TableCell>
                            <div className="flex flex-wrap gap-1">
                                {item.associatedTypes && item.associatedTypes.length > 0 ? 
                                item.associatedTypes.map(type => <Badge key={type} variant="outline">{type}</Badge>) :
                                <span className="text-xs text-muted-foreground">Nessuna</span>
                                }
                            </div>
                           </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(item)}>
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
                                    Questa azione non può essere annullata. L'imballo verrà eliminato.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(item.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">Nessun imballo trovato.</TableCell>
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
              <DialogTitle>{editingItem ? "Modifica Imballo" : "Aggiungi Nuovo Imballo"}</DialogTitle>
              <DialogDescription>
                Compila i campi per definire un nuovo tipo di imballo e la sua tara.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Es. Rocchetto Grande" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrizione (Opzionale)</FormLabel>
                    <FormControl><Input placeholder="Materiale, dimensioni, etc." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="weightKg" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Peso / Tara (Kg)</FormLabel>
                     <div className="relative">
                        <Weight className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <FormControl><Input type="number" step="0.001" placeholder="Es. 0.150" className="pl-9" {...field} /></FormControl>
                     </div>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField
                    control={form.control}
                    name="associatedTypes"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel className="flex items-center gap-2"><Link2 className="h-4 w-4"/> Associazione</FormLabel>
                          <FormDescription>
                            Seleziona per cosa può essere usato questo imballo.
                          </FormDescription>
                        </div>
                        <div className="grid grid-cols-2 gap-2 p-4 border rounded-md">
                        {packagingAssociationTypes.map((item) => (
                          <FormField
                            key={item}
                            control={form.control}
                            name="associatedTypes"
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
                                          : field.onChange(currentValue.filter((value) => value !== item));
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
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />


                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isPending}>Annulla</Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {editingItem ? "Salva Modifiche" : "Crea Imballo"}
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

    

    
