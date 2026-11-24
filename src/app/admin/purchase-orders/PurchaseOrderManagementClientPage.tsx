
"use client";

import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Pencil, 
  Plus, 
  X, 
  Boxes, 
  ArrowUpDown,
  CheckCircle2,
  Package2,
  ArrowRight
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { type PurchaseOrder, type RawMaterial } from '@/types';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn, parseRobustDate } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSearchParams } from 'next/navigation';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  buildPurchaseOrderGroupKey,
  classifyOrderGroupStatus,
  getNextRowDefaultDeliveryDate,
  isOrderDateValidNotFuture,
  normalizeOrderNumber,
  resolvePurchaseOrderDate,
  resolvePurchaseOrderYear,
  type OrderGroupStatus,
} from '@/lib/purchase-order-utils';

const itemSchema = z.object({
  id: z.string().optional(),
  materialCode: z.string().min(1, "Il codice materiale è obbligatorio."),
  materialType: z.string().optional(),
  description: z.string().optional(),
  quantity: z.union([
    z.number().positive("La quantità deve essere positiva."),
    z.string().refine((val) => {
      if (!val || val.trim() === '') return false;
      const num = parseFloat(val.replace(',', '.'));
      return !isNaN(num) && num > 0;
    }, "La quantità deve essere positiva.")
  ]),
  unitOfMeasure: z.enum(['n', 'mt', 'kg']),
  expectedDeliveryDate: z.date({ required_error: "La data di consegna è obbligatoria." }),
});

const orderFormSchema = z.object({
  orderNumber: z.string().min(1, "Il numero ordine è obbligatorio."),
  orderDate: z
    .date({ required_error: "La data ordine è obbligatoria." })
    .refine((d) => isOrderDateValidNotFuture(d), {
      message: "La Data Ordine non può essere nel futuro.",
    }),
  supplierName: z.string().optional(),
  items: z.array(itemSchema).min(1, "Aggiungere almeno un materiale."),
});

type OrderFormValues = z.infer<typeof orderFormSchema>;

interface OrderGroup {
  groupKey: string;
  orderNumber: string;
  orderYear: number;
  orderDate: string;
  supplierName: string;
  items: PurchaseOrder[];
  groupStatus: OrderGroupStatus;
  isFullyReceived: boolean;
  earliestDelivery: string;
  latestDelivery: string;
}

const GROUP_STATUS_BADGE: Record<OrderGroupStatus, { label: string; className: string }> = {
  late: {
    label: 'IN RITARDO',
    className: 'bg-red-600 hover:bg-red-700 text-white shadow-xs',
  },
  partial: {
    label: 'PARZIALE',
    className: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  pending: {
    label: 'IN ATTESA',
    className: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  received: {
    label: 'RICEVUTO',
    className: 'bg-green-600 hover:bg-green-700 text-white',
  },
};

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

  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingOriginalIdentity, setEditingOriginalIdentity] = useState<{
    orderNumber: string;
    orderYear: number;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'open' | 'received'>('open');
  const [openStatusFilter, setOpenStatusFilter] = useState<'all' | 'late' | 'partial' | 'pending'>('all');
  const [receivedYearFilter, setReceivedYearFilter] = useState<string>('all');
  const [openSortDirection, setOpenSortDirection] = useState<'asc' | 'desc'>('asc');
  const [receivedSortDirection, setReceivedSortDirection] = useState<'asc' | 'desc'>('desc');
  
  const [openComboboxIndex, setOpenComboboxIndex] = useState<number | null>(null);
  
  const [materialSuggestions, setMaterialSuggestions] = useState<RawMaterial[]>([]);
  const [isSearchingMaterials, setIsSearchingMaterials] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const materialCatalogMap = useMemo(() => {
    const map = new Map<string, RawMaterial>();
    rawMaterials.forEach((m) => {
      if (m.code) {
        map.set(m.code.trim().toUpperCase(), m);
      }
    });
    return map;
  }, [rawMaterials]);

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
      orderDate: new Date(),
      supplierName: '',
      items: [
        {
          materialCode: '',
          materialType: '',
          description: '',
          quantity: 0,
          unitOfMeasure: 'kg',
          expectedDeliveryDate: new Date(),
        },
      ],
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items"
  });

  const allOrderGroups = useMemo<OrderGroup[]>(() => {
    const groupsMap: Record<string, OrderGroup> = {};

    orders.forEach((o) => {
      const cleanNumber = normalizeOrderNumber(o.orderNumber);
      const orderYear = resolvePurchaseOrderYear(o);
      const groupKey = buildPurchaseOrderGroupKey(cleanNumber, orderYear);

      if (!groupsMap[groupKey]) {
        groupsMap[groupKey] = {
          groupKey,
          orderNumber: cleanNumber || o.orderNumber,
          orderYear,
          orderDate: resolvePurchaseOrderDate(o),
          supplierName: o.supplierName || 'N/D',
          items: [],
          groupStatus: 'pending',
          isFullyReceived: false,
          earliestDelivery: '',
          latestDelivery: '',
        };
      }

      if (o.orderDate) {
        groupsMap[groupKey].orderDate = resolvePurchaseOrderDate(o);
      }
      if (!groupsMap[groupKey].supplierName || groupsMap[groupKey].supplierName === 'N/D') {
        if (o.supplierName) groupsMap[groupKey].supplierName = o.supplierName;
      }

      groupsMap[groupKey].items.push(o);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Object.values(groupsMap).map((group) => {
      group.items.sort((a, b) => String(a.expectedDeliveryDate || '').localeCompare(String(b.expectedDeliveryDate || '')));
      const groupStatus = classifyOrderGroupStatus(group.items, today);
      const isFullyReceived = groupStatus === 'received';

      const openItems = group.items.filter((i) => {
        const st = String(i.status || '').toLowerCase();
        const qty = Number(i.quantity || 0);
        const rec = Number(i.receivedQuantity || 0);
        return st !== 'received' && st !== 'cancelled' && !(qty > 0 && rec >= qty - 0.001);
      });

      const earliestPool = openItems.length > 0 ? openItems : group.items;
      const earliestDelivery = earliestPool.reduce(
        (min, i) => (min === '' || i.expectedDeliveryDate < min ? i.expectedDeliveryDate : min),
        ''
      );
      const latestDelivery = group.items.reduce(
        (max, i) => (max === '' || i.expectedDeliveryDate > max ? i.expectedDeliveryDate : max),
        ''
      );

      return {
        ...group,
        groupStatus,
        isFullyReceived,
        earliestDelivery,
        latestDelivery,
      };
    });
  }, [orders]);

  const availableReceivedYears = useMemo(() => {
    const years = new Set<number>();
    allOrderGroups.forEach((g) => {
      if (g.isFullyReceived) years.add(g.orderYear);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [allOrderGroups]);

  const searchFilteredGroups = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (!trimmed) return allOrderGroups;

    return allOrderGroups.filter((g) => {
      if (g.orderNumber.toLowerCase().includes(trimmed)) return true;
      if (g.supplierName.toLowerCase().includes(trimmed)) return true;
      if (String(g.orderYear).includes(trimmed)) return true;
      return g.items.some((item) => {
        if (item.materialCode.toLowerCase().includes(trimmed)) return true;
        const desc = item.description || materialCatalogMap.get(item.materialCode.trim().toUpperCase())?.description || '';
        return desc.toLowerCase().includes(trimmed);
      });
    });
  }, [allOrderGroups, searchTerm, materialCatalogMap]);

  const matchingOpenGroups = useMemo(
    () => searchFilteredGroups.filter((g) => !g.isFullyReceived),
    [searchFilteredGroups]
  );

  const matchingReceivedGroups = useMemo(
    () => searchFilteredGroups.filter((g) => g.isFullyReceived),
    [searchFilteredGroups]
  );

  const openStatusCounts = useMemo(() => {
    let late = 0;
    let partial = 0;
    let pending = 0;
    matchingOpenGroups.forEach((g) => {
      if (g.groupStatus === 'late') late++;
      else if (g.groupStatus === 'partial') partial++;
      else pending++;
    });
    return { total: matchingOpenGroups.length, late, partial, pending };
  }, [matchingOpenGroups]);

  const displayedOpenGroups = useMemo(() => {
    const filtered =
      openStatusFilter === 'all'
        ? matchingOpenGroups
        : matchingOpenGroups.filter((g) => g.groupStatus === openStatusFilter);

    return [...filtered].sort((a, b) => {
      const dateA = parseRobustDate(a.earliestDelivery)?.getTime() ?? 0;
      const dateB = parseRobustDate(b.earliestDelivery)?.getTime() ?? 0;
      return openSortDirection === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }, [matchingOpenGroups, openStatusFilter, openSortDirection]);

  const displayedReceivedGroups = useMemo(() => {
    const filtered =
      receivedYearFilter === 'all'
        ? matchingReceivedGroups
        : matchingReceivedGroups.filter((g) => String(g.orderYear) === receivedYearFilter);

    return [...filtered].sort((a, b) => {
      const dateA = parseRobustDate(a.latestDelivery || a.orderDate)?.getTime() ?? 0;
      const dateB = parseRobustDate(b.latestDelivery || b.orderDate)?.getTime() ?? 0;
      return receivedSortDirection === 'desc' ? dateB - dateA : dateA - dateB;
    });
  }, [matchingReceivedGroups, receivedYearFilter, receivedSortDirection]);

  const handleOpenDialog = (orderToEdit?: OrderGroup) => {
    if (orderToEdit) {
        setDialogMode('edit');
        setEditingOriginalIdentity({
          orderNumber: orderToEdit.orderNumber,
          orderYear: orderToEdit.orderYear,
        });
        const resolvedDate = parseRobustDate(orderToEdit.orderDate) ?? new Date();
        form.reset({
            orderNumber: orderToEdit.orderNumber,
            orderDate: resolvedDate,
            supplierName: orderToEdit.supplierName === 'N/D' ? '' : orderToEdit.supplierName,
            items: orderToEdit.items.map((item: PurchaseOrder) => ({
                id: item.id,
                materialCode: item.materialCode,
                materialType: item.materialType || '',
                description: item.description || '',
                quantity: item.quantity,
                unitOfMeasure: item.unitOfMeasure,
                expectedDeliveryDate: parseRobustDate(item.expectedDeliveryDate) ?? new Date(),
            }))
        });
    } else {
        setDialogMode('create');
        setEditingOriginalIdentity(null);
        form.reset({
            orderNumber: '',
            orderDate: new Date(),
            supplierName: '',
            items: [
              {
                materialCode: '',
                materialType: '',
                description: '',
                quantity: 0,
                unitOfMeasure: 'kg',
                expectedDeliveryDate: new Date(),
              },
            ]
        });
    }
    setIsDialogOpen(true);
  };

  const handleAddRow = () => {
    const currentItems = form.getValues('items');
    const nextDeliveryDate = getNextRowDefaultDeliveryDate(currentItems, new Date());
    const newIndex = currentItems.length;
    append({
      materialCode: '',
      materialType: '',
      description: '',
      quantity: 0,
      unitOfMeasure: 'kg',
      expectedDeliveryDate: nextDeliveryDate,
    });
    setTimeout(() => {
      document.getElementById(`item-material-trigger-${newIndex}`)?.focus();
    }, 60);
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
        toast({ title: "Importazione Riuscita", description: result.message });
        const updated = await getPurchaseOrders();
        setOrders(updated);
      } else {
        toast({ variant: 'destructive', title: "Errore", description: result.message });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: "Errore File" });
    } finally {
      setIsImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  const onManualSubmit = async (values: OrderFormValues) => {
    if (!user) return;
    setIsSaving(true);
    const payload = { 
        mode: dialogMode,
        orderNumber: values.orderNumber, 
        orderDate: values.orderDate.toISOString(),
        originalOrderNumber: editingOriginalIdentity?.orderNumber,
        originalOrderYear: editingOriginalIdentity?.orderYear,
        supplierName: values.supplierName || '', 
        items: values.items.map(item => {
          const numQuantity = typeof item.quantity === 'number'
            ? item.quantity
            : (parseFloat(item.quantity?.toString().replace(',', '.')) || 0);

          return { 
            id: item.id,
            materialCode: item.materialCode,
            materialType: item.materialType,
            description: item.description,
            quantity: numQuantity,
            unitOfMeasure: item.unitOfMeasure,
            expectedDeliveryDate: item.expectedDeliveryDate.toISOString(),
          };
        }) 
    };
    
    const result = await savePurchaseOrder(payload, user.uid);
    if (result.success) {
      toast({ title: dialogMode === 'edit' ? "Ordine Aggiornato" : "Ordine Salvato" });
      const updated = await getPurchaseOrders();
      setOrders(updated);
      setIsDialogOpen(false);
      form.reset();
    } else {
      toast({ variant: "destructive", title: "Errore", description: result.message });
    }
    setIsSaving(false);
  };

  const handleDeleteOrder = async (orderNumber: string, orderYear: number) => {
      if (!user) return;
      const res = await deleteOrderGroup(orderNumber, orderYear, user.uid);
      if (res.success) {
          toast({ title: "Ordine Eliminato", description: res.message });
          const cleanTarget = normalizeOrderNumber(orderNumber);
          setOrders(prev => prev.filter(o => !(normalizeOrderNumber(o.orderNumber) === cleanTarget && resolvePurchaseOrderYear(o) === orderYear)));
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

  const renderOrderAccordionList = (groups: OrderGroup[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return (
      <Accordion type="multiple" className="space-y-4">
        {groups.map((group) => {
          const badgeCfg = GROUP_STATUS_BADGE[group.groupStatus];
          const isLateGroup = group.groupStatus === 'late';
          const parsedOrderDate = parseRobustDate(group.orderDate);
          const parsedEarliest = group.earliestDelivery ? parseRobustDate(group.earliestDelivery) : null;

          return (
            <AccordionItem
              key={group.groupKey}
              value={group.groupKey}
              className={cn(
                "border rounded-lg bg-card overflow-hidden",
                isLateGroup && "border-red-300 dark:border-red-900/60"
              )}
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                <div className="flex flex-1 items-center justify-between gap-4 text-left">
                  <div className="flex items-center gap-4 min-w-0">
                    <Badge className={cn("min-w-[100px] justify-center uppercase font-bold shrink-0", badgeCfg.className)}>
                      {badgeCfg.label}
                    </Badge>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-lg font-mono">{group.orderNumber}</p>
                        <Badge variant="outline" className="font-mono text-xs px-1.5 py-0">
                          {group.orderYear}
                        </Badge>
                        {parsedOrderDate && (
                          <span className="text-xs text-muted-foreground">
                            Emesso: {format(parsedOrderDate, 'dd/MM/yyyy')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{group.supplierName}</p>
                    </div>
                  </div>
                  <div className="text-right mr-4 shrink-0">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">
                      {group.isFullyReceived ? 'Ultima Consegna' : 'Scadenza Prossima'}
                    </p>
                    <p className={cn("font-semibold text-sm flex items-center gap-1 justify-end", isLateGroup && "text-red-600 font-bold")}>
                      <CalendarIcon className="h-3 w-3" />
                      {parsedEarliest
                        ? format(parsedEarliest, 'dd/MM/yy')
                        : (group.earliestDelivery || '---')}
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
                          Questa azione eliminerà tutte le {group.items.length} righe dell'ordine {group.orderNumber} ({group.orderYear}).
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteOrder(group.orderNumber, group.orderYear)} className="bg-destructive">
                          Elimina Tutto
                        </AlertDialogAction>
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
                    {group.items.map(item => {
                      const residual = item.quantity - (item.receivedQuantity || 0);
                      const expDate = parseRobustDate(item.expectedDeliveryDate);
                      const isRowCompleted = item.status === 'received' || residual <= 0.001;
                      const isLate = !isRowCompleted && expDate !== null && expDate.getTime() < today.getTime();

                      return (
                        <TableRow key={item.id} className={cn(isLate && "bg-red-500/5 hover:bg-red-500/10")}>
                          <TableCell className="font-semibold">{item.materialCode}</TableCell>
                          <TableCell>{item.quantity} {item.unitOfMeasure.toUpperCase()}</TableCell>
                          <TableCell>{item.receivedQuantity || 0} {item.unitOfMeasure.toUpperCase()}</TableCell>
                          <TableCell className={cn("font-medium", isLate && "text-red-600 font-bold")}>
                            {expDate ? format(expDate, 'dd/MM/yy') : (item.expectedDeliveryDate || '---')}
                          </TableCell>
                          <TableCell>
                            {isLate ? (
                              <Badge variant="destructive" className="bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase">
                                IN RITARDO
                              </Badge>
                            ) : (
                              <Badge variant={item.status === 'received' ? 'default' : 'outline'} className={cn(item.status === 'received' && 'bg-green-600 hover:bg-green-700')}>
                                {item.status === 'received' ? 'OK' : item.status === 'partially_received' ? 'Parziale' : 'In Attesa'}
                              </Badge>
                            )}
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
                      );
                    })}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold font-headline flex items-center gap-3">
            <Truck className="h-8 w-8 text-primary" /> Ordini Fornitore
          </h1>
        </div>
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}>
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importa Excel
          </Button>
          <Button size="sm" onClick={() => handleOpenDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" /> Nuovo Ordine
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <CardTitle>Riepilogo Ordini Raggruppati</CardTitle>
              <CardDescription>Visualizza e gestisci gli ordini completi per fornitore e anno.</CardDescription>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca N° ordine, fornitore, materiale..."
                className="pl-9 pr-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="Pulisci ricerca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'open' | 'received')} className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <TabsList className="w-full lg:w-auto grid grid-cols-2 lg:inline-flex">
                <TabsTrigger value="open" className="gap-2">
                  <span>Ordini Aperti</span>
                  <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                    {matchingOpenGroups.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="received" className="gap-2">
                  <span>Evasi / Ricevuti</span>
                  <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                    {matchingReceivedGroups.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              {activeTab === 'open' ? (
                <div className="flex flex-wrap items-center gap-2 justify-between lg:justify-end">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={openStatusFilter === 'all' ? 'default' : 'outline'}
                      onClick={() => setOpenStatusFilter('all')}
                      className="h-8 text-xs"
                    >
                      Tutti ({openStatusCounts.total})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={openStatusFilter === 'late' ? 'destructive' : 'outline'}
                      onClick={() => setOpenStatusFilter('late')}
                      className={cn("h-8 text-xs", openStatusFilter !== 'late' && openStatusCounts.late > 0 && "border-red-300 text-red-700 hover:bg-red-50 dark:text-red-400")}
                    >
                      In Ritardo ({openStatusCounts.late})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={openStatusFilter === 'partial' ? 'default' : 'outline'}
                      onClick={() => setOpenStatusFilter('partial')}
                      className={cn("h-8 text-xs", openStatusFilter === 'partial' ? "bg-amber-500 hover:bg-amber-600 text-white" : (openStatusCounts.partial > 0 && "border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400"))}
                    >
                      Parziali ({openStatusCounts.partial})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={openStatusFilter === 'pending' ? 'default' : 'outline'}
                      onClick={() => setOpenStatusFilter('pending')}
                      className={cn("h-8 text-xs", openStatusFilter === 'pending' && "bg-blue-600 hover:bg-blue-700 text-white")}
                    >
                      In Attesa ({openStatusCounts.pending})
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="h-8 text-xs whitespace-nowrap"
                  >
                    <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                    Scadenza {openSortDirection === 'asc' ? '↑' : '↓'}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <Select value={receivedYearFilter} onValueChange={setReceivedYearFilter}>
                    <SelectTrigger className="w-[150px] h-8 text-xs">
                      <SelectValue placeholder="Tutti gli anni" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutti gli anni</SelectItem>
                      {availableReceivedYears.map((yr) => (
                        <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReceivedSortDirection(prev => prev === 'desc' ? 'asc' : 'desc')}
                    className="h-8 text-xs whitespace-nowrap"
                  >
                    <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                    Data {receivedSortDirection === 'desc' ? '↓' : '↑'}
                  </Button>
                </div>
              )}
            </div>

            <TabsContent value="open" className="mt-0">
              <ScrollArea className="h-[600px] pr-4">
                {displayedOpenGroups.length > 0 ? (
                  renderOrderAccordionList(displayedOpenGroups)
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-4">
                    <Package2 className="h-14 w-14 opacity-20" />
                    <p>Nessun ordine aperto trovato con i filtri correnti.</p>
                    {openStatusFilter !== 'all' && matchingOpenGroups.length > 0 && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setOpenStatusFilter('all')}>
                        Mostra tutti gli ordini aperti ({matchingOpenGroups.length})
                      </Button>
                    )}
                    {matchingReceivedGroups.length > 0 && (
                      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-foreground">
                        <span>
                          Trovati <strong>{matchingReceivedGroups.length}</strong> ordini in <strong>Evasi / Ricevuti</strong>
                        </span>
                        <Button type="button" size="sm" onClick={() => setActiveTab('received')}>
                          Apri scheda <ArrowRight className="ml-1.5 h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="received" className="mt-0">
              <ScrollArea className="h-[600px] pr-4">
                {displayedReceivedGroups.length > 0 ? (
                  renderOrderAccordionList(displayedReceivedGroups)
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-4">
                    <Package2 className="h-14 w-14 opacity-20" />
                    <p>Nessun ordine evaso/ricevuto trovato con i filtri correnti.</p>
                    {receivedYearFilter !== 'all' && matchingReceivedGroups.length > 0 && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setReceivedYearFilter('all')}>
                        Mostra tutti gli anni ({matchingReceivedGroups.length})
                      </Button>
                    )}
                    {matchingOpenGroups.length > 0 && (
                      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-foreground">
                        <span>
                          Trovati <strong>{matchingOpenGroups.length}</strong> ordini in <strong>Ordini Aperti</strong>
                        </span>
                        <Button type="button" size="sm" onClick={() => setActiveTab('open')}>
                          Apri scheda <ArrowRight className="ml-1.5 h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl h-[90vh] max-h-[90vh] flex flex-col p-6 overflow-hidden">
          <DialogHeader className="shrink-0 pb-2">
            <DialogTitle className="text-xl font-bold">
              {dialogMode === 'edit' && editingOriginalIdentity
                ? `Modifica Ordine: ${editingOriginalIdentity.orderNumber} (${editingOriginalIdentity.orderYear})`
                : 'Crea Nuovo Ordine Fornitore'}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onManualSubmit)} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Intestazione Statica Fissa */}
              <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b">
                <FormField control={form.control} name="orderNumber" render={({ field }) => ( 
                    <FormItem>
                        <FormLabel>N° Ordine</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Es. 123/G"
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          />
                        </FormControl>
                        <FormMessage />
                    </FormItem> 
                )} />
                <FormField control={form.control} name="orderDate" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Data Ordine (Creazione)</FormLabel>
                        <FormControl>
                          <MaskedDatePicker
                            id="order-date-input"
                            value={field.value}
                            onChange={field.onChange}
                            disabledDate={(date) => !isOrderDateValidNotFuture(date)}
                          />
                        </FormControl>
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

              {/* Area Mappa Righe Materiale Scrollabile Interna */}
              <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-4 pr-2">
                <h4 className="font-semibold flex items-center gap-2 pt-2"><Boxes className="h-4 w-4"/> Righe Materiale</h4>
                {fields.map((item, index) => (
                  <div key={item.id} className="p-4 border rounded-lg grid grid-cols-12 gap-3 items-end bg-muted/20 relative">
                    {/* 1. Materiale */}
                    <div className="col-span-12 sm:col-span-4">
                      <FormField control={form.control} name={`items.${index}.materialCode`} render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Materiale</FormLabel>
                          <Popover open={openComboboxIndex === index} onOpenChange={(open) => setOpenComboboxIndex(open ? index : null)}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button 
                                  id={`item-material-trigger-${index}`}
                                  type="button"
                                  variant="outline" 
                                  className="w-full justify-between"
                                >
                                  {field.value || "Seleziona..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                              <Command>
                                <CommandInput placeholder="Cerca minimo 2 char..." onValueChange={handleSearchMaterial} />
                                <CommandList>
                                  <CommandEmpty>{isSearchingMaterials ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2" /> : "Nessun materiale."}</CommandEmpty>
                                  <CommandGroup>
                                    {materialSuggestions.map((m) => (
                                      <CommandItem 
                                        key={m.id} 
                                        value={m.code} 
                                        onSelect={() => { 
                                          form.setValue(`items.${index}.materialCode`, m.code, { shouldValidate: true });
                                          form.setValue(`items.${index}.materialType`, m.type || '');
                                          form.setValue(`items.${index}.description`, m.description || '');
                                          form.setValue(`items.${index}.unitOfMeasure`, m.unitOfMeasure || 'kg');
                                          setOpenComboboxIndex(null); 
                                          setTimeout(() => {
                                            const qtyEl = document.getElementById(`item-qty-${index}`) as HTMLInputElement | null;
                                            qtyEl?.focus();
                                            qtyEl?.select();
                                          }, 50);
                                        }}
                                      >
                                        {m.code}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </FormItem>
                      )} />
                    </div>

                    {/* 2. Quantità */}
                    <div className="col-span-6 sm:col-span-2">
                      <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => ( 
                        <FormItem>
                          <FormLabel>Quantità</FormLabel>
                          <FormControl>
                            <Input 
                              id={`item-qty-${index}`}
                              type="number" 
                              step="any" 
                              placeholder="0"
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const deliveryEl = document.getElementById(`item-delivery-${index}`) as HTMLInputElement | null;
                                  deliveryEl?.focus();
                                  deliveryEl?.select();
                                }
                              }}
                            />
                          </FormControl>
                        </FormItem> 
                      )} />
                    </div>

                    {/* 3. UM */}
                    <div className="col-span-6 sm:col-span-2">
                      <FormField control={form.control} name={`items.${index}.unitOfMeasure`} render={({ field }) => ( 
                        <FormItem>
                          <FormLabel>UM</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger id={`item-um-${index}`} className="w-full">
                                <SelectValue placeholder="UM" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="n">n</SelectItem>
                              <SelectItem value="mt">mt</SelectItem>
                              <SelectItem value="kg">kg</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem> 
                      )} />
                    </div>

                    {/* 4. Consegna */}
                    <div className="col-span-10 sm:col-span-3">
                      <FormField 
                        control={form.control} 
                        name={`items.${index}.expectedDeliveryDate`} 
                        render={({ field }) => ( 
                          <FormItem>
                            <FormLabel>Consegna</FormLabel>
                            <FormControl>
                              <MaskedDatePicker 
                                id={`item-delivery-${index}`}
                                value={field.value} 
                                onChange={field.onChange}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (index === fields.length - 1) {
                                      handleAddRow();
                                    } else {
                                      document.getElementById(`item-material-trigger-${index + 1}`)?.focus();
                                    }
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem> 
                        )} 
                      />
                    </div>

                    {/* 5. Rimuovi Riga */}
                    <div className="col-span-2 sm:col-span-1">
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => remove(index)} 
                        className="text-destructive hover:bg-destructive/10"
                        title="Rimuovi riga"
                      >
                          <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full border-dashed py-3 font-medium hover:border-primary/50 hover:bg-primary/5 transition-all" 
                  onClick={handleAddRow}
                >
                  <Plus className="mr-2 h-4 w-4"/> Aggiungi riga materiale
                </Button>
              </div>

              {/* Footer Statico e Fisso */}
              <DialogFooter className="shrink-0 pt-4 border-t flex flex-row items-center justify-end gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsDialogOpen(false)} 
                  disabled={isSaving}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={isSaving} className="font-semibold shadow-md">
                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} 
                    {dialogMode === 'edit' ? "Salva Modifiche" : "Registra Ordine"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
