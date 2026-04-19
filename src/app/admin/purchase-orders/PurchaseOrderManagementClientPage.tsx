
"use client";

import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Truck, 
  PlusCircle, 
  Search, 
  Trash2, 
  Upload, 
  Loader2, 
  Calendar as CalendarIcon, 
  Save, 
  ChevronsUpDown, 
  Check, 
  Pencil, 
  Plus, 
  X, 
  Boxes, 
  ArrowUpDown,
  CheckCircle2,
  Package2
} from 'lucide-react';
import { getPurchaseOrders, deleteOrderGroup, importPurchaseOrders, savePurchaseOrder, closePurchaseOrder } from './actions';
import { getRawMaterials } from '../raw-material-management/actions';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { type PurchaseOrder, type RawMaterial } from '@/types';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSearchParams } from 'next/navigation';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const itemSchema = z.object({
  id: z.string().optional(),
  materialCode: z.string().min(1, "Il codice materiale è obbligatorio."),
  quantity: z.coerce.number().positive("La quantità deve essere positiva."),
  unitOfMeasure: z.enum(['n', 'mt', 'kg']),
  expectedDeliveryDate: z.date({ required_error: "La data di consegna è obbligatoria." }),
});

const orderFormSchema = z.object({
  orderNumber: z.string().min(1, "Il numero ordine è obbligatorio."),
  supplierName: z.string().optional(),
  items: z.array(itemSchema).min(1, "Aggiungere almeno un materiale."),
});

type OrderFormValues = z.infer<typeof orderFormSchema>;

export default function PurchaseOrderManagementClientPage({ 
  initialOrders,
  rawMaterials
}: { 
  initialOrders: PurchaseOrder[],
  rawMaterials: RawMaterial[]
}) {
  const searchParams = useSearchParams();
  const materialCodeParam = searchParams.get('materialCode');
  
  const [orders, setOrders] = useState<PurchaseOrder[]>(initialOrders);
  const [searchTerm, setSearchTerm] = useState(materialCodeParam || '');
  const [isImporting, setIsImporting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingOrderNumber, setEditingOrderNumber] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  const [openComboboxIndex, setOpenComboboxIndex] = useState<number | null>(null);
  
  const [materialSuggestions, setMaterialSuggestions] = useState<RawMaterial[]>([]);
  const [isSearchingMaterials, setIsSearchingMaterials] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearchMaterial = (term: string) => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (term.length < 2) {
          setMaterialSuggestions([]);
          setIsSearchingMaterials(false);
          return;
      }
      setIsSearchingMaterials(true);
      searchTimeoutRef.current = setTimeout(async () => {
          try {
             const res = await getRawMaterials(term);
             setMaterialSuggestions(res);
          } catch(e) {} finally {
             setIsSearchingMaterials(false);
          }
      }, 400);
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (materialCodeParam) {
      setSearchTerm(materialCodeParam);
    }
  }, [materialCodeParam]);

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      orderNumber: '',
      supplierName: '',
      items: [{ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() }]
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items"
  });

  const groupedOrders = useMemo(() => {
    const groups: Record<string, {
        orderNumber: string;
        supplierName: string;
        items: PurchaseOrder[];
        earliestDelivery: string;
        status: 'pending' | 'received';
    }> = {};

    orders.forEach(o => {
        if (!groups[o.orderNumber]) {
            groups[o.orderNumber] = {
                orderNumber: o.orderNumber,
                supplierName: o.supplierName || 'N/D',
                items: [],
                earliestDelivery: '',
                status: 'received'
            };
        }
        groups[o.orderNumber].items.push(o);
        if (o.status === 'pending' || o.status === 'partially_received') {
            groups[o.orderNumber].status = 'pending';
        }
    });

    Object.values(groups).forEach(group => {
        const pendingItems = group.items.filter(i => i.status === 'pending' || i.status === 'partially_received');
        if (pendingItems.length > 0) {
            group.earliestDelivery = pendingItems.reduce((min, i) => 
                (min === '' || i.expectedDeliveryDate < min) ? i.expectedDeliveryDate : min, ''
            );
        } else {
            group.earliestDelivery = group.items.reduce((min, i) => 
                (min === '' || i.expectedDeliveryDate < min) ? i.expectedDeliveryDate : min, ''
            );
        }
    });

    let result = Object.values(groups);

    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        result = result.filter(g => 
            g.orderNumber.toLowerCase().includes(lower) ||
            g.supplierName.toLowerCase().includes(lower) ||
            g.items.some(i => i.materialCode.toLowerCase().includes(lower))
        );
    }

    result.sort((a, b) => {
        const dateA = new Date(a.earliestDelivery).getTime();
        const dateB = new Date(b.earliestDelivery).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return result;
  }, [orders, searchTerm, sortDirection]);

  const handleOpenDialog = (orderToEdit?: any) => {
    if (orderToEdit) {
        setEditingOrderNumber(orderToEdit.orderNumber);
        form.reset({
            orderNumber: orderToEdit.orderNumber,
            supplierName: orderToEdit.supplierName,
            items: orderToEdit.items.map((item: PurchaseOrder) => ({
                id: item.id,
                materialCode: item.materialCode,
                quantity: item.quantity,
                unitOfMeasure: item.unitOfMeasure,
                expectedDeliveryDate: new Date(item.expectedDeliveryDate)
            }))
        });
    } else {
        setEditingOrderNumber(null);
        form.reset({
            orderNumber: '',
            supplierName: '',
            items: [{ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() }]
        });
    }
    setIsDialogOpen(true);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const json: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      const result = await importPurchaseOrders(json, user.uid);
      if (result.success) {
        toast({ title: "Importazione Riuscita" });
        const updated = await getPurchaseOrders();
        setOrders(updated);
      } else toast({ variant: 'destructive', title: "Errore", description: result.message });
    } catch (e) { toast({ variant: 'destructive', title: "Errore File" }); }
    finally { setIsImporting(false); }
  };

  const onManualSubmit = async (values: OrderFormValues) => {
    if (!user) return;
    setIsSaving(true);
    const payload = { 
        orderNumber: values.orderNumber, 
        supplierName: values.supplierName || '', 
        items: values.items.map(item => ({ 
            ...item, 
            expectedDeliveryDate: item.expectedDeliveryDate.toISOString() 
        })) 
    };
    
    const result = await savePurchaseOrder(payload, user.uid);
    if (result.success) {
      toast({ title: editingOrderNumber ? "Ordine Aggiornato" : "Ordini Salvati" });
      const updated = await getPurchaseOrders();
      setOrders(updated);
      setIsDialogOpen(false);
      form.reset();
    } else toast({ variant: "destructive", title: "Errore", description: result.message });
    setIsSaving(false);
  };

  const handleDeleteOrder = async (orderNumber: string) => {
      if (!user) return;
      const res = await deleteOrderGroup(orderNumber, user.uid);
      if (res.success) {
          toast({ title: "Ordine Eliminato" });
          setOrders(prev => prev.filter(o => o.orderNumber !== orderNumber));
      } else {
          toast({ variant: "destructive", title: "Errore", description: res.message });
      }
  };

  const handleCloseItem = async (itemId: string) => {
      if (!user) return;
      const res = await closePurchaseOrder(itemId, user.uid);
      if (res.success) {
          toast({ title: "Riga chiusa" });
          const updated = await getPurchaseOrders();
          setOrders(updated);
      } else {
          toast({ variant: "destructive", title: "Errore", description: res.message });
      }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div><h1 className="text-3xl font-bold font-headline flex items-center gap-3"><Truck className="h-8 w-8 text-primary" /> Ordini Fornitore</h1></div>
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}><Upload className="mr-2 h-4 w-4" /> Importa Excel</Button>
          <Button size="sm" onClick={() => handleOpenDialog()}><PlusCircle className="mr-2 h-4 w-4" /> Nuovo Ordine</Button>
        </div>
      </header>

      <Card>
        <CardHeader>
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <CardTitle>Riepilogo Ordini Raggruppati</CardTitle>
                    <CardDescription>Visualizza e gestisci gli ordini completi per fornitore.</CardDescription>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Cerca ordine, materiale..." 
                            className="pl-9" 
                            value={searchTerm} 
                            onChange={(e) => setSearchTerm(e.target.value)} 
                        />
                    </div>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                        className="whitespace-nowrap"
                    >
                        <ArrowUpDown className="mr-2 h-4 w-4" />
                        Scadenza {sortDirection === 'asc' ? '↑' : '↓'}
                    </Button>
                </div>
            </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px] pr-4">
            <Accordion type="multiple" className="space-y-4">
                {groupedOrders.length > 0 ? groupedOrders.map((group) => (
                    <AccordionItem key={group.orderNumber} value={group.orderNumber} className="border rounded-lg bg-card overflow-hidden">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                            <div className="flex flex-1 items-center justify-between gap-4 text-left">
                                <div className="flex items-center gap-4">
                                    <Badge 
                                        className={cn(
                                            "min-w-[100px] justify-center uppercase font-bold",
                                            group.status === 'pending' ? "bg-amber-500 hover:bg-amber-600" : "bg-green-600 hover:bg-green-700"
                                        )}
                                    >
                                        {group.status === 'pending' ? 'In Attesa' : 'Ricevuto'}
                                    </Badge>
                                    <div>
                                        <p className="font-bold text-lg font-mono">{group.orderNumber}</p>
                                        <p className="text-xs text-muted-foreground">{group.supplierName}</p>
                                    </div>
                                </div>
                                <div className="text-right mr-4">
                                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Scadenza Prossima</p>
                                    <p className="font-semibold text-sm flex items-center gap-1 justify-end">
                                        <CalendarIcon className="h-3 w-3" />
                                        {group.earliestDelivery ? format(parseISO(group.earliestDelivery), 'dd/MM/yy') : '---'}
                                    </p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 border-t pt-2">
                            <div className="flex justify-end gap-2 mb-4 mt-2">
                                <Button size="sm" variant="outline" onClick={() => handleOpenDialog(group)}>
                                    <Pencil className="mr-2 h-4 w-4" /> Modifica Ordine
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="destructive">
                                            <Trash2 className="mr-2 h-4 w-4" /> Elimina
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Sei sicuro di voler eliminare l'intero ordine?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Questa azione eliminerà tutte le {group.items.length} righe dell'ordine {group.orderNumber}.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteOrder(group.orderNumber)} className="bg-destructive">Elimina Tutto</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Materiale</TableHead>
                                        <TableHead>Quantità</TableHead>
                                        <TableHead>Ricevuta</TableHead>
                                        <TableHead>Data Consegna</TableHead>
                                        <TableHead>Stato</TableHead>
                                        <TableHead className="text-right">Azioni</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {group.items.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-semibold">{item.materialCode}</TableCell>
                                            <TableCell>{item.quantity} {item.unitOfMeasure.toUpperCase()}</TableCell>
                                            <TableCell>{item.receivedQuantity || 0} {item.unitOfMeasure.toUpperCase()}</TableCell>
                                            <TableCell>{format(parseISO(item.expectedDeliveryDate), 'dd/MM/yy')}</TableCell>
                                            <TableCell>
                                                <Badge variant={item.status === 'received' ? 'default' : 'outline'} className={cn(item.status === 'received' && 'bg-green-600 hover:bg-green-700')}>
                                                    {item.status === 'received' ? 'OK' : item.status === 'partially_received' ? 'Parziale' : 'In Attesa'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {item.status !== 'received' && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="ghost" className="h-8 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                                                                <CheckCircle2 className="mr-1 h-3 w-3" /> Chiudi
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Chiudere forzatamente la riga?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    La quantità ordinata ({item.quantity}) verrà equiparata a quella ricevuta ({item.receivedQuantity || 0}). 
                                                                    La riga non risulterà più come "in arrivo".
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleCloseItem(item.id)}>Conferma Chiusura</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </AccordionContent>
                    </AccordionItem>
                )) : (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Package2 className="h-16 w-16 opacity-20 mb-4" />
                        <p>Nessun ordine trovato.</p>
                    </div>
                )}
            </Accordion>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingOrderNumber ? `Modifica Ordine: ${editingOrderNumber}` : 'Crea Nuovo Ordine Fornitore'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onManualSubmit)} className="flex-1 overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b">
                <FormField control={form.control} name="orderNumber" render={({ field }) => ( 
                    <FormItem>
                        <FormLabel>N° Ordine</FormLabel>
                        <FormControl><Input {...field} disabled={!!editingOrderNumber} placeholder="Es. 123/G" /></FormControl>
                        <FormMessage />
                    </FormItem> 
                )} />
                <FormField control={form.control} name="supplierName" render={({ field }) => ( 
                    <FormItem>
                        <FormLabel>Fornitore</FormLabel>
                        <FormControl><Input {...field} placeholder="Nome Fornitore" /></FormControl>
                        <FormMessage />
                    </FormItem> 
                )} />
              </div>
              <ScrollArea className="flex-1 py-4">
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2"><Boxes className="h-4 w-4"/> Righe Materiale</h4>
                  {fields.map((item, index) => (
                    <div key={item.id} className="p-4 border rounded-lg grid grid-cols-12 gap-3 items-end bg-muted/20 relative">
                      <div className="col-span-12 sm:col-span-4">
                        <FormField control={form.control} name={`items.${index}.materialCode`} render={({ field }) => (
                          <FormItem className="flex flex-col"><FormLabel>Materiale</FormLabel>
                            <Popover open={openComboboxIndex === index} onOpenChange={(open) => setOpenComboboxIndex(open ? index : null)}>
                              <PopoverTrigger asChild><FormControl><Button variant="outline" className="w-full justify-between">{field.value || "Seleziona..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></FormControl></PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command><CommandInput placeholder="Cerca minimo 2 char..." onValueChange={handleSearchMaterial} /><CommandList><CommandEmpty>{isSearchingMaterials ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2" /> : "Nessun materiale."}</CommandEmpty><CommandGroup>
                                {materialSuggestions.map((m) => (<CommandItem key={m.id} value={m.code} onSelect={() => { form.setValue(`items.${index}.materialCode`, m.code); form.setValue(`items.${index}.unitOfMeasure`, m.unitOfMeasure); setOpenComboboxIndex(null); }}>{m.code}</CommandItem>))}
                              </CommandGroup></CommandList></Command></PopoverContent>
                            </Popover>
                          </FormItem>
                        )} />
                      </div>
                      <div className="col-span-6 sm:col-span-2"><FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => ( <FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem> )} /></div>
                      <div className="col-span-6 sm:col-span-2"><FormField control={form.control} name={`items.${index}.unitOfMeasure`} render={({ field }) => ( <FormItem><FormLabel>UM</FormLabel><FormControl><Input readOnly {...field} className="bg-muted"/></FormControl></FormItem> )} /></div>
                      <div className="col-span-10 sm:col-span-3">
                        <FormField 
                          control={form.control} 
                          name={`items.${index}.expectedDeliveryDate`} 
                          render={({ field }) => ( 
                            <FormItem>
                              <FormLabel>Consegna</FormLabel>
                              <FormControl>
                                <MaskedDatePicker 
                                  value={field.value} 
                                  onChange={field.onChange} 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem> 
                          )} 
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive">
                            <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => append({ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() })}><Plus className="mr-2 h-4 w-4"/> Aggiungi riga materiale</Button>
                </div>
              </ScrollArea>
              <DialogFooter className="pt-4 border-t">
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} 
                    {editingOrderNumber ? "Salva Modifiche" : "Registra Ordine"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
