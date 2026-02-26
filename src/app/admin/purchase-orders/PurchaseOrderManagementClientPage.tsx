"use client";

import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { format, parseISO, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Truck, PlusCircle, Search, Trash2, Download, Upload, Loader2, Calendar as CalendarIcon, Save, ChevronsUpDown, Check, MoreVertical, XCircle, CheckCircle2, Pencil, Plus, X } from 'lucide-react';
import { getPurchaseOrders, deletePurchaseOrder, importPurchaseOrders, savePurchaseOrder, closePurchaseOrder } from './actions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { type PurchaseOrder, type RawMaterial } from '@/lib/mock-data';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSearchParams } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const itemSchema = z.object({
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
  const [openComboboxIndex, setOpenComboboxIndex] = useState<number | null>(null);
  
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

  const handleOpenDialog = () => {
    form.reset({
      orderNumber: '',
      supplierName: '',
      items: [{ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() }]
    });
    setIsDialogOpen(true);
  };

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const lower = searchTerm.toLowerCase();
    return orders.filter(o => 
      o.orderNumber.toLowerCase().includes(lower) ||
      (o.supplierName || '').toLowerCase().includes(lower) ||
      o.materialCode.toLowerCase().includes(lower)
    );
  }, [orders, searchTerm]);

  const handleDownloadTemplate = () => {
    const templateData = [
      { 
        "N° Ordine": "ORD-2024-001",
        "Fornitore": "FORNITORE ALPHA",
        "Codice Materiale": "BOB-ROSSO-01",
        "Quantità": 500,
        "Unità": "mt",
        "Data Consegna": "30/08/2024"
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ordini Fornitore");
    XLSX.writeFile(wb, "template_ordini_fornitore.xlsx");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsImporting(true);
    toast({ title: 'Analisi file...', description: 'Lettura ordini in corso.' });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const json: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      
      const result = await importPurchaseOrders(json, user.uid);
      if (result.success) {
        toast({ title: "Importazione Riuscita", description: result.message });
        const updated = await getPurchaseOrders();
        setOrders(updated);
      } else {
        toast({ variant: 'destructive', title: "Errore", description: result.message });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: "Errore File", description: "Impossibile leggere il file Excel." });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onManualSubmit = async (values: OrderFormValues) => {
    if (!user) return;
    setIsSaving(true);
    
    const payload = {
      orderNumber: values.orderNumber,
      supplierName: values.supplierName || '',
      items: values.items.map(item => ({
        ...item,
        expectedDeliveryDate: item.expectedDeliveryDate.toISOString(),
      }))
    };

    const result = await savePurchaseOrder(payload, user.uid);

    if (result.success) {
      toast({ title: "Ordini Salvati", description: `L'ordine ${values.orderNumber} con ${values.items.length} materiali è stato registrato.` });
      const updated = await getPurchaseOrders();
      setOrders(updated);
      setIsDialogOpen(false);
      form.reset();
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const result = await deletePurchaseOrder(id, user.uid);
    if (result.success) {
      toast({ title: "Eliminato" });
      setOrders(prev => prev.filter(o => o.id !== id));
    }
  };

  const handleForceClose = async (id: string) => {
      if (!user) return;
      const result = await closePurchaseOrder(id, user.uid);
      if (result.success) {
          toast({ title: "Ordine Chiuso", description: "L'ordine è stato marcato come completato manualmente." });
          const updated = await getPurchaseOrders();
          setOrders(updated);
      } else {
          toast({ variant: "destructive", title: "Errore", description: result.message });
      }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
            <Truck className="h-8 w-8 text-primary" />
            Ordini Fornitore
          </h1>
          <p className="text-muted-foreground mt-1">Gestisci e monitora l'arrivo delle materie prime.</p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={handleDownloadTemplate} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> Template
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}>
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />} Carica Excel
          </Button>
          <Button size="sm" onClick={handleOpenDialog}>
            <PlusCircle className="mr-2 h-4 w-4" /> Crea Ordine
          </Button>
        </div>
      </header>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Nuovo Ordine Fornitore</DialogTitle>
            <DialogDescription>Inserisci i dettagli del materiale in arrivo. Puoi aggiungere più righe per lo stesso ordine.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onManualSubmit)} className="flex-1 overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b">
                <FormField control={form.control} name="orderNumber" render={({ field }) => (
                  <FormItem><FormLabel>N° Ordine</FormLabel><FormControl><Input placeholder="Es. ORD-2024-001" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="supplierName" render={({ field }) => (
                  <FormItem><FormLabel>Fornitore (Opzionale)</FormLabel><FormControl><Input placeholder="Es. Rossi Metalli" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <ScrollArea className="flex-1 py-4">
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2"><Boxes className="h-4 w-4"/> Righe Materiale</h4>
                  {fields.map((item, index) => (
                    <div key={item.id} className="p-4 border rounded-lg relative bg-muted/30 grid grid-cols-12 gap-3 items-end">
                      <div className="col-span-12 sm:col-span-4">
                        <FormField control={form.control} name={`items.${index}.materialCode`} render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Codice Materiale</FormLabel>
                            <Popover open={openComboboxIndex === index} onOpenChange={(open) => setOpenComboboxIndex(open ? index : null)}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")}>
                                    {field.value || "Scrivi per cercare..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Digita codice..." />
                                  <CommandList>
                                    <CommandEmpty>Nessun materiale trovato.</CommandEmpty>
                                    <CommandGroup>
                                      {rawMaterials.map((material) => (
                                        <CommandItem
                                          key={material.id}
                                          value={material.code}
                                          onSelect={() => {
                                            form.setValue(`items.${index}.materialCode`, material.code);
                                            form.setValue(`items.${index}.unitOfMeasure`, material.unitOfMeasure);
                                            setOpenComboboxIndex(null);
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-4 w-4", material.code === field.value ? "opacity-100" : "opacity-0")} />
                                          {material.code}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="col-span-6 sm:col-span-2">
                        <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (
                          <FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>

                      <div className="col-span-6 sm:col-span-2">
                        <FormField control={form.control} name={`items.${index}.unitOfMeasure`} render={({ field }) => (
                          <FormItem><FormLabel>Unità</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent><SelectItem value="n">N</SelectItem><SelectItem value="mt">MT</SelectItem><SelectItem value="kg">KG</SelectItem></SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>

                      <div className="col-span-10 sm:col-span-3">
                        <FormField control={form.control} name={`items.${index}.expectedDeliveryDate`} render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Consegna</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                    {field.value ? format(field.value, "dd/MM/yy") : <span>Data</span>}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="col-span-2 sm:col-span-1 flex justify-center pb-1">
                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} disabled={fields.length === 1}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => append({ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() })}>
                    <Plus className="mr-2 h-4 w-4"/> Aggiungi riga materiale
                  </Button>
                </div>
              </ScrollArea>

              <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Annulla</Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                  Registra Ordine
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Riepilogo Ordini</CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cerca ordine, fornitore..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stato</TableHead>
                  <TableHead>N° Ordine</TableHead>
                  <TableHead>Fornitore</TableHead>
                  <TableHead>Materiale</TableHead>
                  <TableHead>Quantità</TableHead>
                  <TableHead>Ricevuto</TableHead>
                  <TableHead>Data Consegna Prevista</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => {
                    const isPending = order.status === 'pending' || order.status === 'partially_received';
                    return (
                    <TableRow key={order.id} className={cn(!isPending && "opacity-60 bg-muted/30")}>
                      <TableCell>
                        <Badge variant={order.status === 'received' ? 'default' : order.status === 'pending' ? 'secondary' : 'outline'} className={cn(order.status === 'partially_received' && "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100")}>
                          {order.status === 'pending' ? 'In attesa' : order.status === 'received' ? 'Completato' : order.status === 'partially_received' ? 'Parziale' : order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-semibold">{order.orderNumber}</TableCell>
                      <TableCell>{order.supplierName || 'N/D'}</TableCell>
                      <TableCell>{order.materialCode}</TableCell>
                      <TableCell className="font-bold">{order.quantity} {order.unitOfMeasure.toUpperCase()}</TableCell>
                      <TableCell className={cn("font-mono", (order.receivedQuantity || 0) > 0 && "text-green-600 font-bold")}>
                        {order.receivedQuantity || 0} {order.unitOfMeasure.toUpperCase()}
                      </TableCell>
                      <TableCell className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                        {order.expectedDeliveryDate ? format(parseISO(order.expectedDeliveryDate), 'dd/MM/yyyy') : 'N/D'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {isPending && (
                                    <>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <DropdownMenuItem onSelect={e => e.preventDefault()}>
                                                    <CheckCircle2 className="mr-2 h-4 w-4 text-green-600"/> Chiudi Manualmente
                                                </DropdownMenuItem>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Conferma Chiusura Ordine</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Sei sicuro di voler chiudere l'ordine {order.orderNumber}? 
                                                        Questa azione lo rimuoverà dall'ordinato in magazzino anche se non tutta la merce è stata caricata.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleForceClose(order.id)}>Sì, chiudi ordine</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive">
                                            <Trash2 className="mr-2 h-4 w-4"/> Elimina
                                        </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                            <AlertDialogDescription>L'ordine verrà rimosso permanentemente.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(order.id)} className="bg-destructive hover:bg-destructive/90">Elimina</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )})
                ) : (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Nessun ordine fornitore trovato.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
