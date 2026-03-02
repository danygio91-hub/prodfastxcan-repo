
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';

import { 
  type RawMaterial, 
  type RawMaterialType, 
  type ManualCommitment, 
  type ScrapRecord, 
  type Department, 
  type Article 
} from '@/lib/mock-data';

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
  type OrderedDetail
} from './actions';

import { Button } from '@/components/ui/button';
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
  Send
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDisplayStock } from '@/lib/utils';
import CommitmentManagementClientPage from './CommitmentManagementClientPage';
import BatchFormDialog from '../batch-management/BatchFormDialog';
import { type GroupedBatches } from '../batch-management/actions';

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
  type: z.enum(['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA']),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  unitOfMeasure: z.enum(['n', 'mt', 'kg']),
  conversionFactor: z.coerce.number().optional().nullable(),
  rapportoKgMt: z.coerce.number().optional().nullable(),
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

interface RawMaterialManagementClientPageProps {
  initialArticles: Article[];
  initialCommitments: ManualCommitment[];
  initialDepartments: Department[];
}

export default function RawMaterialManagementClientPage({ 
  initialArticles, 
  initialCommitments, 
}: RawMaterialManagementClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');
  
  const [searchTerm, setSearchTerm] = useState(codeFromUrl || '');
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isScrapsDialogOpen, setIsScrapsDialogOpen] = useState(false);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  
  const { toast } = useToast();

  const form = useForm<z.infer<typeof rawMaterialFormSchema>>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { type: 'BOB', unitOfMeasure: 'n' }
  });

  const watchedUOM = form.watch('unitOfMeasure');

  const refreshData = useCallback(async () => {
    if (searchTerm.length >= 2) {
      setIsSearching(true);
      try {
        const result = await searchMaterialsAndGetStatus(searchTerm);
        setRawMaterials(result.materials);
        setMaterialStatus(result.status);
      } catch (error) {
        toast({ variant: 'destructive', title: 'Errore', description: 'Magazzino non caricato.' });
      } finally {
        setIsSearching(false);
      }
    } else {
      setRawMaterials([]);
      setMaterialStatus([]);
    }
  }, [searchTerm, toast]);

  useEffect(() => {
    const timer = setTimeout(() => refreshData(), 500);
    return () => clearTimeout(timer);
  }, [searchTerm, refreshData]);

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
                    <Button asChild variant="outline" size="sm"><Link href="/admin/purchase-orders"><Truck className="mr-2 h-4 w-4" /> Ordini</Link></Button>
                    <Button onClick={() => { setSelectedMaterial(null); form.reset({ type: 'BOB', unitOfMeasure: 'n' }); setIsEditDialogOpen(true); }} size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Aggiungi</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead>Stock</TableHead><TableHead>Impegnato</TableHead><TableHead>Disponibile</TableHead><TableHead>Ordinato</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {isSearching ? (
                        <TableRow><TableCell colSpan={7} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : (rawMaterials.map((m) => {
                          const s = materialStatus.find(st => st.id === m.id);
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="font-bold">{m.code}</TableCell>
                              <TableCell className="truncate max-w-[200px] text-xs text-muted-foreground">{m.description}</TableCell>
                              <TableCell className="font-semibold">{formatDisplayStock(s ? s.stock : m.currentStockUnits, m.unitOfMeasure)}</TableCell>
                              <TableCell><button onClick={() => handleOpenCommitmentDetails(m.code)} className="text-amber-600 hover:underline">{s ? formatDisplayStock(s.impegnato, s.unitOfMeasure) : '-'}</button></TableCell>
                              <TableCell className={cn("font-bold", s && s.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>{s ? formatDisplayStock(s.disponibile, s.unitOfMeasure) : '-'}</TableCell>
                              <TableCell><button onClick={() => handleOpenOrderedDetails(m.code)} className="text-blue-600 hover:underline">{s && s.ordinato > 0 ? formatDisplayStock(s.ordinato, s.unitOfMeasure) : '-'}</button></TableCell>
                              <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); form.reset({ ...m }); setIsEditDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Modifica</DropdownMenuItem><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsBatchDialogOpen(true); }}><PackagePlus className="mr-2 h-4 w-4" /> Carica</DropdownMenuItem><DropdownMenuItem onSelect={() => handleOpenHistoryDialog(m)}><History className="mr-2 h-4 w-4" /> Storico</DropdownMenuItem><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsScrapsDialogOpen(true); }}><TestTube className="mr-2 h-4 w-4" /> Scarti</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setMaterialToDelete(m)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Elimina</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
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
              <FormField control={form.control} name="code" render={({ field }) => ( <FormItem><FormLabel>Codice</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
              <FormField control={form.control} name="description" render={({ field }) => ( <FormItem><FormLabel>Descrizione</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem> )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => ( <FormItem><FormLabel>Tipo</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="BOB">BOB</SelectItem><SelectItem value="TUBI">TUBI</SelectItem><SelectItem value="PF3V0">PF3V0</SelectItem><SelectItem value="GUAINA">GUAINA</SelectItem><SelectItem value="BARRA">BARRA</SelectItem></SelectContent></Select></FormItem> )} />
                <FormField control={form.control} name="unitOfMeasure" render={({ field }) => ( <FormItem><FormLabel>UOM</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="n">N</SelectItem><SelectItem value="mt">MT</SelectItem><SelectItem value="kg">KG</SelectItem></SelectContent></Select></FormItem> )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {watchedUOM === 'kg' ? ( <FormField control={form.control} name="rapportoKgMt" render={({ field }) => ( <FormItem><FormLabel>Rapporto Kg/mt</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem> )} /> ) : ( <FormField control={form.control} name="conversionFactor" render={({ field }) => ( <FormItem><FormLabel>Fattore Conversione</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem> )} /> )}
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button><Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salva</Button></DialogFooter>
            </form></Form>
        </DialogContent>
      </Dialog>

      {isBatchDialogOpen && groupedBatchMaterial && (
        <BatchFormDialog isOpen={isBatchDialogOpen} material={groupedBatchMaterial} batch={null} onClose={(refresh) => { setIsBatchDialogOpen(false); if(refresh) refreshData(); }} />
      )}

      <AlertDialog open={!!materialToDelete} onOpenChange={(open) => !open && setMaterialToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Elimina Materiale?</AlertDialogTitle><AlertDialogDescription>Azione definitiva.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (!materialToDelete) return; setIsPending(true); const r = await deleteRawMaterial(materialToDelete.id); if(r.success) refreshData(); setMaterialToDelete(null); setIsPending(false); }} className="bg-destructive hover:bg-destructive/90" disabled={isPending}>Sì, elimina</AlertDialogAction>
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
    </>
  );
}
