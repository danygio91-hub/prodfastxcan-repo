
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';

import {
  type RawMaterial,
  type RawMaterialType,
  type ManualCommitment,
  type ScrapRecord,
  type Department,
  type Article
} from '@/types';

import {
  saveRawMaterial,
  deleteRawMaterial,
  getMaterialWithdrawalsForMaterial,
  getScrapsForMaterial,
  searchMaterialsAndGetStatus,
  type MaterialStatus,
  getMaterialCommitmentDetails,
  type CommitmentDetail,
  getMaterialOrderedDetails,
  type OrderedDetail,
  adjustRawMaterialStock,
  bulkUpdateRawMaterials,
  getBatchesForReturn,
  returnMaterialToBatch
} from './actions';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Boxes,
  PlusCircle,
  MoreVertical,
  History,
  Search,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  Truck,
  Copy,
  Calendar,
  ClipboardList,
  Edit,
  Trash2,
  PackagePlus,
  TestTube,
  Save,
  Send,
  Upload
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDisplayStock } from '@/lib/utils';
import CommitmentManagementClientPage from './CommitmentManagementClientPage';
import BatchFormDialog from '../batch-management/BatchFormDialog';
import { type GroupedBatches } from '../batch-management/actions';
import { useDebounce } from '../../../hooks/use-debounce';



import { type GlobalSettings } from '@/lib/settings-types';

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string;
  description: string;
  quantity: number;
  unit: string;
  id: string;
};

const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.string().min(1, 'Seleziona una tipologia.'),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  unitOfMeasure: z.string().min(1, 'Seleziona un\'unità di misura.'),
  conversionFactor: z.coerce.number().optional().nullable(),
  rapportoKgMt: z.coerce.number().optional().nullable(),
  minStockLevel: z.coerce.number().optional().nullable(),
  reorderLot: z.coerce.number().optional().nullable(),
  leadTimeDays: z.coerce.number().optional().nullable(),
});

function ScrapsDialog({ isOpen, onOpenChange, material }: { isOpen: boolean, onOpenChange: (open: boolean) => void, material: RawMaterial | null }) {
  const [scraps, setScraps] = useState<ScrapRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && material) {
      setIsLoading(true);
      getScrapsForMaterial(material.id)
        .then(setScraps)
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, material]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Storico Scarti: {material?.code}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Commessa</TableHead>
                <TableHead>Q.tà Scartata</TableHead>
                <TableHead>Operatore</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : scraps.length > 0 ? (
                scraps.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>{format(parseISO(s.declaredAt), 'dd/MM/yyyy HH:mm')}</TableCell>
                    <TableCell>{s.jobOrderCode}</TableCell>
                    <TableCell>{s.scrappedQuantity} pz</TableCell>
                    <TableCell>{s.operatorName}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">Nessuno scarto registrato.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ReturnMaterialDialog({ isOpen, onOpenChange, material, onConfirm }: { isOpen: boolean, onOpenChange: (open: boolean) => void, material: RawMaterial | null, onConfirm: () => void }) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [lots, setLots] = useState<any[]>([]);
  const [isLoadingLots, setIsLoadingLots] = useState(false);

  useEffect(() => {
    if (isOpen && material) {
      setIsLoadingLots(true);
      getBatchesForReturn(material.id)
        .then(setLots)
        .finally(() => setIsLoadingLots(false));
    }
  }, [isOpen, material]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setIsPending(true);
    const result = await returnMaterialToBatch(formData);
    toast({ title: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) {
      onConfirm();
      onOpenChange(false);
    }
    setIsPending(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reso da Produzione: {material?.code}</DialogTitle>
          <DialogDescription>Re-immetti a stock materiale avanzato su un lotto esistente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <input type="hidden" name="materialId" value={material?.id || ''} />
          
          <div className="space-y-2">
            <Label>Seleziona Lotto da Rimpinguare</Label>
            <Select name="batchId" required>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingLots ? "Caricamento lotti..." : "Scegli lotto..."} />
              </SelectTrigger>
              <SelectContent>
                {lots.map(l => (
                  <SelectItem key={l.lotto} value={l.lotto}>{l.lottoLabel} (Disp: {l.available.toFixed(2)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantità da Rendere</Label>
              <Input type="number" step="any" name="returnQuantity" required />
            </div>
            <div className="space-y-2">
              <Label>Unità</Label>
              <Select name="returnUnits" defaultValue={material?.unitOfMeasure || 'n'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="n">PZ</SelectItem>
                  <SelectItem value="mt">MT</SelectItem>
                  <SelectItem value="kg">KG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Note / Causale Reso</Label>
            <Input name="notes" placeholder="Esempio: Avanzo di produzione ODL 123" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
            <Button type="submit" disabled={isPending || isLoadingLots}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpCircle className="mr-2 h-4 w-4" />}
              Conferma Reso
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RawMaterialManagementClientPageProps {
  initialArticles: Article[];
  initialCommitments: ManualCommitment[];
  initialDepartments: Department[];
  globalSettings: GlobalSettings;
}

export default function RawMaterialManagementClientPage({
  initialArticles,
  initialCommitments,
  globalSettings,
}: RawMaterialManagementClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');

  const [searchTerm, setSearchTerm] = useState(codeFromUrl || '');
  const debouncedSearchTerm = useDebounce(searchTerm, 600);

  const [isPending, setIsPending] = useState(false);
  const [isCommitmentDialogOpen, setIsCommitmentDialogOpen] = useState(false);
  const [commitmentDetails, setCommitmentDetails] = useState<CommitmentDetail[]>([]);
  const [isLoadingCommitment, setIsLoadingCommitment] = useState(false);
  const [activeMaterialForDetails, setActiveMaterialForDetails] = useState<string | null>(null);

  const [isOrderedDialogOpen, setIsOrderedDialogOpen] = useState(false);
  const [orderedDetails, setOrderedDetails] = useState<OrderedDetail[]>([]);
  const [isLoadingOrdered, setIsLoadingOrdered] = useState(false);
  const [activeMaterialForOrderedDetails, setActiveMaterialForOrderedDetails] = useState<string | null>(null);

  const [materialToDelete, setMaterialToDelete] = useState<RawMaterial | null>(null);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isScrapsDialogOpen, setIsScrapsDialogOpen] = useState(false);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isAdjustStockDialogOpen, setIsAdjustStockDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);
  const [importedItems, setImportedItems] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const { toast } = useToast();

  const form = useForm<z.infer<typeof rawMaterialFormSchema>>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { type: globalSettings.rawMaterialTypes[0]?.id || '', unitOfMeasure: globalSettings.unitsOfMeasure[0] || 'n', minStockLevel: null, reorderLot: null, leadTimeDays: null }
  });

  const watchedType = form.watch('type');
  const watchedUOM = form.watch('unitOfMeasure');

  const typeConfig = useMemo(() => globalSettings.rawMaterialTypes.find(t => t.id === watchedType), [watchedType, globalSettings.rawMaterialTypes]);

  // Change default unit when type changes (only for new items)
  useEffect(() => {
    if (!form.getValues('id') && typeConfig) {
        form.setValue('unitOfMeasure', typeConfig.defaultUnit);
    }
  }, [typeConfig, form]);

  const lastSearchTermRef = useRef(debouncedSearchTerm);

  const refreshData = useCallback(async () => {
    const currentSearch = debouncedSearchTerm;
    lastSearchTermRef.current = currentSearch;
    setIsSearching(true);
    
    try {
      const result = await searchMaterialsAndGetStatus(currentSearch);
      
      // Staleness guard
      if (currentSearch === lastSearchTermRef.current) {
        setRawMaterials(result.materials);
        setMaterialStatus(result.status);
        setHasMore(result.materials.length >= 50);
        setIsSearching(false);
      }
    } catch (error) {
      if (currentSearch === lastSearchTermRef.current) {
        setIsSearching(false);
        toast({ variant: 'destructive', title: 'Errore', description: 'Magazzino non caricato.' });
      }
    }
  }, [debouncedSearchTerm, toast]);


  const handleLoadMore = async () => {
      if (rawMaterials.length === 0) return;
      setIsLoadingMore(true);
      try {
        const lastCode = rawMaterials[rawMaterials.length - 1].code;
        const result = await searchMaterialsAndGetStatus(searchTerm, lastCode);
        setRawMaterials(prev => {
            const newIds = new Set(result.materials.map(m => m.id));
            const filteredPrev = prev.filter(m => !newIds.has(m.id));
            return [...filteredPrev, ...result.materials];
        });
        setMaterialStatus(prev => {
            const newIds = new Set(result.status.map(s => s.id));
            return [...prev.filter(s => !newIds.has(s.id)), ...result.status];
        });
        setHasMore(result.materials.length >= 50);
      } catch(e){}
      setIsLoadingMore(false);
  };

  useEffect(() => {
    refreshData();
  }, [debouncedSearchTerm, refreshData]);


  const onEditSubmit = async (values: z.infer<typeof rawMaterialFormSchema>) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => { if (value) formData.append(key, String(value)); });
    setIsPending(true);
    const res = await saveRawMaterial(formData);
    toast({ title: res.message, variant: res.success ? "default" : "destructive" });
    if (res.success) { refreshData(); setIsEditDialogOpen(false); }
    setIsPending(false);
  };

  const handleOpenHistoryDialog = async (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);
    setMaterialMovements([]);
    try {
      const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
      const combined: Movement[] = [
        ...(material.batches || []).map((b): Movement => ({ type: 'Carico', date: b.date, description: b.inventoryRecordId ? `Inventario` : `Carico - Lotto: ${b.lotto || 'N/D'}`, quantity: b.netQuantity, unit: material.unitOfMeasure.toUpperCase(), id: b.id })),
        ...withdrawals.map((w): Movement => ({ type: 'Scarico', date: w.withdrawalDate.toISOString(), description: w.jobOrderPFs?.join(', ') || 'Scarico', quantity: -(w.consumedUnits || w.consumedWeight || 0), unit: w.consumedUnits ? material.unitOfMeasure.toUpperCase() : 'KG', id: w.id }))
      ];
      setMaterialMovements(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) { toast({ variant: 'destructive', title: 'Errore storico' }); }
  };

  const handleOpenCommitmentDetails = async (code: string) => {
    setActiveMaterialForDetails(code); setIsLoadingCommitment(true); setIsCommitmentDialogOpen(true);
    try { const details = await getMaterialCommitmentDetails(code); setCommitmentDetails(details); }
    catch (e) { toast({ variant: 'destructive', title: "Errore impegni" }); setIsCommitmentDialogOpen(false); }
    finally { setIsLoadingCommitment(false); }
  };

  const handleOpenOrderedDetails = async (code: string) => {
    setActiveMaterialForOrderedDetails(code); setIsLoadingOrdered(true); setIsOrderedDialogOpen(true);
    try { const details = await getMaterialOrderedDetails(code); setOrderedDetails(details); }
    catch (e) { toast({ variant: 'destructive', title: "Errore ordini" }); setIsOrderedDialogOpen(false); }
    finally { setIsLoadingOrdered(false); }
  };

  const groupedBatchMaterial: GroupedBatches | null = useMemo(() => {
    if (!selectedMaterial) return null;
    return { materialId: selectedMaterial.id, materialCode: selectedMaterial.code, materialDescription: selectedMaterial.description, unitOfMeasure: selectedMaterial.unitOfMeasure, currentStockUnits: selectedMaterial.currentStockUnits, currentWeightKg: selectedMaterial.currentWeightKg, lots: [] };
  }, [selectedMaterial]);

  const onAdjustStock = async (newStock: number) => {
    if (!selectedMaterial) return;
    setIsPending(true);
    const res = await adjustRawMaterialStock(selectedMaterial.id, newStock);
    toast({ title: res.message, variant: res.success ? "default" : "destructive" });
    if (res.success) {
      refreshData();
      setIsAdjustStockDialogOpen(false);
    }
    setIsPending(false);
  };

  return (
    <>
      <div className="space-y-6">
        <header><h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3"><Boxes className="h-8 w-8 text-primary" />Gestione Materie Prime</h1></header>
        <Tabs defaultValue="list">
          <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="list">Magazzino Live</TabsTrigger><TabsTrigger value="commitments">Impegni Manuali</TabsTrigger></TabsList>
          <TabsContent value="list">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div className="space-y-1"><CardTitle>Magazzino Live</CardTitle><CardDescription>Giacenze ricalcolate.</CardDescription></div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-full sm:w-auto"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca..." className="pl-9 w-full sm:w-64" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept=".xlsx, .xls" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsImporting(true);
                        try {
                          const buffer = await file.arrayBuffer();
                          const workbook = XLSX.read(buffer, { type: 'array' });
                          const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                          setImportedItems(json);
                          setIsImportPreviewOpen(true);
                        } catch (err) {
                          toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile leggere il file Excel.' });
                        } finally {
                          setIsImporting(false);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                      {isImporting ? <Loader2 className="mr-2 h-3 w-4 animate-spin" /> : <Upload className="mr-2 h-3 w-4" />}
                      Importa Excel
                    </Button>
                    <Button asChild variant="outline" size="sm"><Link href="/admin/purchase-orders"><Truck className="mr-2 h-4 w-4" /> Ordini</Link></Button>
                    <Button onClick={() => { setSelectedMaterial(null); form.reset({ type: globalSettings.rawMaterialTypes[0]?.id || '', unitOfMeasure: globalSettings.unitsOfMeasure[0] || 'n', minStockLevel: null, reorderLot: null, leadTimeDays: null }); setIsEditDialogOpen(true); }} size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Aggiungi</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead>UOM</TableHead><TableHead>Stock</TableHead><TableHead>Impegnato</TableHead><TableHead>Disponibile</TableHead><TableHead>Ordinato</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {isSearching ? (
                        <TableRow><TableCell colSpan={7} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : (rawMaterials.map((m) => {
                        const s = materialStatus.find(st => st.id === m.id);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="font-bold">{m.code}</TableCell>
                            <TableCell className="truncate max-w-[200px] text-xs text-muted-foreground">{m.description}</TableCell>
                            <TableCell className="text-xs font-medium text-muted-foreground uppercase">{m.unitOfMeasure}</TableCell>
                            <TableCell className="font-semibold">{formatDisplayStock(s ? s.stock : m.currentStockUnits, m.unitOfMeasure)}</TableCell>
                            <TableCell><button onClick={() => handleOpenCommitmentDetails(m.code)} className="text-amber-600 hover:underline">{s ? formatDisplayStock(s.impegnato, s.unitOfMeasure) : '-'}</button></TableCell>
                            <TableCell className={cn("font-bold", s && s.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>{s ? formatDisplayStock(s.disponibile, s.unitOfMeasure) : '-'}</TableCell>
                            <TableCell><button onClick={() => handleOpenOrderedDetails(m.code)} className="text-blue-600 hover:underline">{s && s.ordinato > 0 ? formatDisplayStock(s.ordinato, s.unitOfMeasure) : '-'}</button></TableCell>
                          <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); form.reset({ ...m }); setIsEditDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Modifica</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsBatchDialogOpen(true); }}><PackagePlus className="mr-2 h-4 w-4" /> Carica</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsReturnDialogOpen(true); }} className="text-teal-600 focus:text-teal-700 focus:bg-teal-50"><ArrowUpCircle className="mr-2 h-4 w-4" /> Reso Merce</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsAdjustStockDialogOpen(true); }}><History className="mr-2 h-4 w-4 text-amber-600" /> <span className="text-amber-600">Aggiusta Stock</span></DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleOpenHistoryDialog(m)}><History className="mr-2 h-4 w-4" /> Storico</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsScrapsDialogOpen(true); }}><TestTube className="mr-2 h-4 w-4" /> Scarti</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setMaterialToDelete(m)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Elimina</DropdownMenuItem>
                          </DropdownMenuContent></DropdownMenu></TableCell>
                        </TableRow>
                      )
                    })
                    )}
                    </TableBody>
                  </Table>
                  {hasMore && !isSearching && (
                      <div className="p-4 flex justify-center border-t">
                          <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                              {isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Carica Altri
                          </Button>
                      </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="commitments"><CommitmentManagementClientPage initialCommitments={initialCommitments} initialArticles={initialArticles} /></TabsContent>
        </Tabs>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Anagrafica Materia Prima</DialogTitle></DialogHeader>
          <Form {...form}><form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4 py-4">
            <FormField control={form.control} name="code" render={({ field }) => (<FormItem><FormLabel>Codice</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Descrizione</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="type" render={({ field }) => (<FormItem><FormLabel>Tipo</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{globalSettings.rawMaterialTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent></Select></FormItem>)} />
              <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (<FormItem><FormLabel>UOM</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{globalSettings.unitsOfMeasure.map(u => <SelectItem key={u} value={u}>{u.toUpperCase()}</SelectItem>)}</SelectContent></Select></FormItem>)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {typeConfig?.hasConversion && (
                <FormField
                  control={form.control}
                  name={watchedUOM === 'mt' ? "rapportoKgMt" : "conversionFactor"}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {typeConfig.conversionType === 'kg/mt' ? 'Rapporto KG/MT' :
                         typeConfig.conversionType === 'kg/unit' ? 'Peso Unitario (KG/Pz)' :
                         'Fattore Conversione'}
                      </FormLabel>
                      <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                  )}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
               <FormField control={form.control} name="minStockLevel" render={({ field }) => (<FormItem><FormLabel>Sottoscorta</FormLabel><FormControl><Input type="number" step="any" placeholder="Soglia allarme" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
               <FormField control={form.control} name="reorderLot" render={({ field }) => (<FormItem><FormLabel>Lotto Riordino</FormLabel><FormControl><Input type="number" step="any" placeholder={`${watchedUOM.toUpperCase()} per ordine`} {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="leadTimeDays" render={({ field }) => (<FormItem><FormLabel>Tempo Approvvigionamento (gg)</FormLabel><FormControl><Input type="number" step="any" placeholder="Giorni necessari" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button><Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salva</Button></DialogFooter>
          </form></Form>
        </DialogContent>
      </Dialog>

      {isBatchDialogOpen && groupedBatchMaterial && (
        <BatchFormDialog isOpen={isBatchDialogOpen} material={groupedBatchMaterial} batch={null} onClose={(refresh) => { setIsBatchDialogOpen(false); if (refresh) refreshData(); }} />
      )}

      <AlertDialog open={!!materialToDelete} onOpenChange={(open) => !open && setMaterialToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Elimina Materiale?</AlertDialogTitle><AlertDialogDescription>Azione definitiva.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (!materialToDelete) return; setIsPending(true); const r = await deleteRawMaterial(materialToDelete.id); if (r.success) refreshData(); setMaterialToDelete(null); setIsPending(false); }} className="bg-destructive hover:bg-destructive/90" disabled={isPending}>Sì, elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>Storico: {selectedMaterial?.code}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh]"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrizione</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow></TableHeader>
            <TableBody>{materialMovements.map((m, idx) => (<TableRow key={idx}><TableCell>{format(parseISO(m.date), 'dd/MM/yy HH:mm')}</TableCell><TableCell><Badge>{m.type}</Badge></TableCell><TableCell className="text-xs truncate max-w-sm">{m.description}</TableCell><TableCell className={cn("text-right font-mono", m.type === 'Carico' ? 'text-green-600' : 'text-destructive')}>{m.quantity.toFixed(2)} {m.unit}</TableCell></TableRow>))}</TableBody>
          </Table></ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isCommitmentDialogOpen} onOpenChange={setIsCommitmentDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Dettaglio Impegnato: {activeMaterialForDetails}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh] mt-4"><Table><TableHeader><TableRow><TableHead>Commessa</TableHead><TableHead>Articolo</TableHead><TableHead className="text-right">Quantità</TableHead><TableHead>Consegna</TableHead></TableRow></TableHeader>
            <TableBody>{isLoadingCommitment ? (<TableRow><TableCell colSpan={4} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>) : commitmentDetails.map((det, idx) => (<TableRow key={idx}><TableCell className="font-mono">{det.jobId}</TableCell><TableCell className="text-xs">{det.articleCode}</TableCell><TableCell className="text-right font-semibold">{det.quantity.toFixed(2)}</TableCell><TableCell>{det.deliveryDate !== 'N/D' ? format(parseISO(det.deliveryDate), 'dd/MM/yy') : 'N/D'}</TableCell></TableRow>))}</TableBody>
          </Table></ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isOrderedDialogOpen} onOpenChange={setIsOrderedDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Dettaglio Ordinato: {activeMaterialForOrderedDetails}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh] mt-4"><Table><TableHeader><TableRow><TableHead>N° Ordine</TableHead><TableHead>Fornitore</TableHead><TableHead className="text-right">Residuo</TableHead><TableHead>Prevista</TableHead></TableRow></TableHeader>
            <TableBody>{isLoadingOrdered ? (<TableRow><TableCell colSpan={4} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>) : orderedDetails.map((det, idx) => (<TableRow key={idx}><TableCell className="font-mono">{det.orderNumber}</TableCell><TableCell className="text-xs">{det.supplierName}</TableCell><TableCell className="text-right font-bold text-primary">{(det.quantity - det.receivedQuantity).toFixed(2)}</TableCell><TableCell>{format(parseISO(det.expectedDeliveryDate), 'dd/MM/yy')}</TableCell></TableRow>))}</TableBody>
          </Table></ScrollArea>
        </DialogContent>
      </Dialog>

      <ScrapsDialog isOpen={isScrapsDialogOpen} onOpenChange={setIsScrapsDialogOpen} material={selectedMaterial} />
      <ReturnMaterialDialog isOpen={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen} material={selectedMaterial} onConfirm={refreshData} />

      <Dialog open={isAdjustStockDialogOpen} onOpenChange={setIsAdjustStockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aggiusta Stock: {selectedMaterial?.code}</DialogTitle>
            <DialogDescription>
              Inserisci la nuova giacenza fisica rilevata. Questa operazione sovrascriverà il totale attuale e azzererà i lotti se impostata a 0.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nuova Giacenza ({selectedMaterial?.unitOfMeasure.toUpperCase()})</Label>
                <Input 
                  type="number" 
                  step="any" 
                  autoFocus
                  defaultValue={selectedMaterial?.currentStockUnits || 0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onAdjustStock(Number((e.target as HTMLInputElement).value));
                    }
                  }}
                  id="new-stock-input"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAdjustStockDialogOpen(false)}>Annulla</Button>
            <Button 
              onClick={() => {
                const val = (document.getElementById('new-stock-input') as HTMLInputElement).value;
                onAdjustStock(Number(val));
              }}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salva Rettifica
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportPreviewOpen} onOpenChange={setIsImportPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Anteprima Importazione Materie Prime</DialogTitle>
            <DialogDescription>
              Verranno importati o aggiornati {importedItems.length} elementi. Verifica la corrispondenza delle colonne.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden border rounded-md my-4">
            <ScrollArea className="h-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CODICE</TableHead>
                    <TableHead>DESCRIZIONE</TableHead>
                    <TableHead>TIPO</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">RAPPORTO KG/MT (o PZ)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importedItems.slice(0, 100).map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-bold">{item.CODICE || item.Codice || item.codice || '??'}</TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]">{item.DESCRIZIONE || item.Descrizione || item.descrizione}</TableCell>
                      <TableCell>{item.TIPO || item.Tipo || item.tipo}</TableCell>
                      <TableCell>{item.UOM || item.uom}</TableCell>
                      <TableCell className="text-right font-mono">
                        {item['RAPPORTO KG/MT'] || item['Rapporto KG/MT'] || item['KG/MT'] || item['KG/PZ'] || 0}
                      </TableCell>
                    </TableRow>
                  ))}
                  {importedItems.length > 100 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground italic">
                        ... e altri {importedItems.length - 100} elementi.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportPreviewOpen(false)}>Annulla</Button>
            <Button 
              onClick={async () => {
                if (!user) return;
                setIsPending(true);
                const res = await bulkUpdateRawMaterials(importedItems, user.uid);
                toast({ title: res.message, variant: res.success ? 'default' : 'destructive' });
                if (res.success) {
                  setIsImportPreviewOpen(false);
                  refreshData();
                }
                setIsPending(false);
              }}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Conferma Importazione
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
