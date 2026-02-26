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
import { Truck, PlusCircle, Search, Trash2, Download, Upload, Loader2, Calendar as CalendarIcon, Save, ChevronsUpDown, Check, MoreVertical, XCircle, CheckCircle2, Pencil, Plus, X, Boxes } from 'lucide-react';
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
    const templateData = [{ "N° Ordine": "ORD-2024-001", "Fornitore": "FORNITORE ALPHA", "Codice Materiale": "BOB-ROSSO-01", "Quantità": 500, "Unità": "mt", "Data Consegna": "30/08/2024" }];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ordini Fornitore");
    XLSX.writeFile(wb, "template_ordini_fornitore.xlsx");
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
    const payload = { orderNumber: values.orderNumber, supplierName: values.supplierName || '', items: values.items.map(item => ({ ...item, expectedDeliveryDate: item.expectedDeliveryDate.toISOString() })) };
    const result = await savePurchaseOrder(payload, user.uid);
    if (result.success) {
      toast({ title: "Ordini Salvati" });
      const updated = await getPurchaseOrders();
      setOrders(updated);
      setIsDialogOpen(false);
      form.reset();
    } else toast({ variant: "destructive", title: "Errore", description: result.message });
    setIsSaving(false);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div><h1 className="text-3xl font-bold font-headline flex items-center gap-3"><Truck className="h-8 w-8 text-primary" /> Ordini Fornitore</h1></div>
        <div className="flex items-center gap-2 pt-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={handleDownloadTemplate} variant="outline" size="sm"><Download className="mr-2 h-4 w-4" /> Template</Button>
          <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}><Upload className="mr-2 h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={handleOpenDialog}><PlusCircle className="mr-2 h-4 w-4" /> Crea Ordine</Button>
        </div>
      </header>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>Nuovo Ordine Fornitore</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onManualSubmit)} className="flex-1 overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b">
                <FormField control={form.control} name="orderNumber" render={({ field }) => ( <FormItem><FormLabel>N° Ordine</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                <FormField control={form.control} name="supplierName" render={({ field }) => ( <FormItem><FormLabel>Fornitore</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
              </div>
              <ScrollArea className="flex-1 py-4">
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2"><Boxes className="h-4 w-4"/> Righe Materiale</h4>
                  {fields.map((item, index) => (
                    <div key={item.id} className="p-4 border rounded-lg grid grid-cols-12 gap-3 items-end bg-muted/20">
                      <div className="col-span-12 sm:col-span-4">
                        <FormField control={form.control} name={`items.${index}.materialCode`} render={({ field }) => (
                          <FormItem className="flex flex-col"><FormLabel>Materiale</FormLabel>
                            <Popover open={openComboboxIndex === index} onOpenChange={(open) => setOpenComboboxIndex(open ? index : null)}>
                              <PopoverTrigger asChild><FormControl><Button variant="outline" className="w-full justify-between">{field.value || "Seleziona..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></FormControl></PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command><CommandInput placeholder="Cerca..." /><CommandList><CommandEmpty>No.</CommandEmpty><CommandGroup>
                                {rawMaterials.map((m) => (<CommandItem key={m.id} value={m.code} onSelect={() => { form.setValue(`items.${index}.materialCode`, m.code); form.setValue(`items.${index}.unitOfMeasure`, m.unitOfMeasure); setOpenComboboxIndex(null); }}>{m.code}</CommandItem>))}
                              </CommandGroup></CommandList></Command></PopoverContent>
                            </Popover>
                          </FormItem>
                        )} />
                      </div>
                      <div className="col-span-6 sm:col-span-2"><FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => ( <FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem> )} /></div>
                      <div className="col-span-6 sm:col-span-2"><FormField control={form.control} name={`items.${index}.unitOfMeasure`} render={({ field }) => ( <FormItem><FormLabel>UM</FormLabel><FormControl><Input readOnly {...field} className="bg-muted"/></FormControl></FormItem> )} /></div>
                      <div className="col-span-10 sm:col-span-3"><FormField control={form.control} name={`items.${index}.expectedDeliveryDate`} render={({ field }) => ( <FormItem><FormLabel>Consegna</FormLabel><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start">{field.value ? format(field.value, "dd/MM/yy") : "Data"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover></FormItem> )} /></div>
                      <div className="col-span-2 sm:col-span-1"><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}><X className="h-4 w-4" /></Button></div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => append({ materialCode: '', quantity: 0, unitOfMeasure: 'n', expectedDeliveryDate: new Date() })}><Plus className="mr-2 h-4 w-4"/> Aggiungi materiale</Button>
                </div>
              </ScrollArea>
              <DialogFooter className="pt-4 border-t"><Button type="submit" disabled={isSaving}>{isSaving ? <Loader2 className="animate-spin" /> : <Save />} Registra Ordine</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card><CardHeader><CardTitle>Riepilogo Ordini</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Stato</TableHead><TableHead>N° Ordine</TableHead><TableHead>Materiale</TableHead><TableHead>Quantità</TableHead><TableHead>Consegna</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
            <TableBody>{filteredOrders.map(o => (<TableRow key={o.id}><TableCell><Badge>{o.status}</Badge></TableCell><TableCell className="font-mono">{o.orderNumber}</TableCell><TableCell>{o.materialCode}</TableCell><TableCell>{o.quantity} {o.unitOfMeasure.toUpperCase()}</TableCell><TableCell>{format(parseISO(o.expectedDeliveryDate), 'dd/MM/yy')}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => deletePurchaseOrder(o.id, user!.uid).then(r => { if(r.success) setOrders(p => p.filter(x => x.id !== o.id)); })}><Trash2 className="h-4 w-4"/></Button></TableCell></TableRow>))}</TableBody></Table></div>
        </CardContent>
      </Card>
    </div>
  );
}
