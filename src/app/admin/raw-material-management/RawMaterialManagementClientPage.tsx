
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isPast } from 'date-fns';
import { it } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import Link from 'next/link';

import { type RawMaterial, type RawMaterialBatch, type MaterialWithdrawal, type RawMaterialType, type ManualCommitment, type ScrapRecord, type Department, type Article } from '@/lib/mock-data';
import { saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials, addBatchToRawMaterial, getMaterialWithdrawalsForMaterial, getScrapsForMaterial, searchMaterialsAndGetStatus, type MaterialStatus, getMaterialCommitmentDetails, type CommitmentDetail } from './actions';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Boxes, PlusCircle, Edit, Trash2, Upload, Loader2, MoreVertical, History, PackagePlus, Search, ArrowUpCircle, ArrowDownCircle, TestTube, ClipboardList, Truck, ListChecks, Calendar } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDisplayStock } from '@/lib/utils';
import CommitmentManagementClientPage from './CommitmentManagementClientPage';

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

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  netQuantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
});

function ScrapsDialog({ isOpen, onOpenChange, material }: { isOpen: boolean, onOpenChange: (open: boolean) => void, material: RawMaterial | null }) {
    const [scraps, setScraps] = useState<ScrapRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    useEffect(() => { if (isOpen && material) { setIsLoading(true); getScrapsForMaterial(material.id).then(setScraps).finally(() => setIsLoading(false)); } }, [isOpen, material]);
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Storico Scarti: {material?.code}</DialogTitle></DialogHeader><ScrollArea className="max-h-[60vh] mt-4"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Commessa</TableHead><TableHead>Q.tà Scartata</TableHead><TableHead>Operatore</TableHead></TableRow></TableHeader><TableBody>{isLoading ? (<TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>) : scraps.length > 0 ? (scraps.map(s => (<TableRow key={s.id}><TableCell>{format(parseISO(s.declaredAt), 'dd/MM/yyyy HH:mm')}</TableCell><TableCell>{s.jobOrderCode}</TableCell><TableCell>{s.scrappedQuantity} pz</TableCell><TableCell>{s.operatorName}</TableCell></TableRow>))) : (<TableRow><TableCell colSpan={4} className="text-center h-24">Nessuno scarto.</TableCell></TableRow>)}</TableBody></Table></ScrollArea></DialogContent></Dialog>
    );
}

interface RawMaterialManagementClientPageProps { initialArticles: Article[]; initialCommitments: ManualCommitment[]; initialDepartments: Department[]; }

export default function RawMaterialManagementClientPage({ initialArticles, initialCommitments, initialDepartments }: RawMaterialManagementClientPageProps) {
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isBatchFormDialogOpen, setIsBatchFormDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isScrapsDialogOpen, setIsScrapsDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<RawMaterial | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(codeFromUrl || '');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [isCommitmentDialogOpen, setIsCommitmentDialogOpen] = useState(false);
  const [commitmentDetails, setCommitmentDetails] = useState<CommitmentDetail[]>([]);
  const [isLoadingCommitment, setIsLoadingCommitment] = useState(false);
  const [activeMaterialForDetails, setActiveMaterialForDetails] = useState<string | null>(null);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof rawMaterialFormSchema>>({ resolver: zodResolver(rawMaterialFormSchema), defaultValues: { type: 'BOB', unitOfMeasure: 'n' } });
  const batchForm = useForm<z.infer<typeof batchFormSchema>>({ resolver: zodResolver(batchFormSchema) });
  const watchedUOM = form.watch('unitOfMeasure');
  const refreshData = useCallback(() => { if (searchTerm.length >= 2) { setIsSearching(true); searchMaterialsAndGetStatus(searchTerm).then(result => { setRawMaterials(result.materials); setMaterialStatus(result.status); }).finally(() => setIsSearching(false)); } }, [searchTerm]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.length >= 2) {
        setRawMaterials([]);
        setMaterialStatus([]);
        setIsSearching(true);
        searchMaterialsAndGetStatus(searchTerm).then(result => { setRawMaterials(result.materials); setMaterialStatus(result.status); }).finally(() => setIsSearching(false));
      } else { setRawMaterials([]); setMaterialStatus([]); }
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const onEditSubmit = async (values: z.infer<typeof rawMaterialFormSchema>) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null) formData.append(key, String(value)); });
    setIsPending(true);
    const result = await saveRawMaterial(formData);
    toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) { refreshData(); setIsEditDialogOpen(false); }
    setIsPending(false);
  };

  const handleOpenHistoryDialog = async (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);
    const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
    const combined: Movement[] = [
        ...(material.batches || []).map((b): Movement => ({ type: 'Carico', date: b.date, description: b.inventoryRecordId ? `Inventario` : `Carico - Lotto: ${b.lotto || 'N/D'}`, quantity: Number(b.netQuantity) || 0, unit: material.unitOfMeasure.toUpperCase(), id: b.id })),
        ...withdrawals.map((w): Movement => ({ type: 'Scarico', date: w.withdrawalDate.toISOString(), description: w.jobOrderPFs?.join(', ') || 'Scarico', quantity: -(w.consumedUnits || w.consumedWeight), unit: w.consumedUnits ? material.unitOfMeasure.toUpperCase() : 'KG', id: w.id }))
    ];
    setMaterialMovements(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  };

  const handleOpenCommitmentDetails = async (materialCode: string) => {
    setActiveMaterialForDetails(materialCode);
    setIsLoadingCommitment(true);
    setIsCommitmentDialogOpen(true);
    try {
        const details = await getMaterialCommitmentDetails(materialCode);
        setCommitmentDetails(details);
    } catch (e) { toast({ variant: 'destructive', title: "Errore" }); setIsCommitmentDialogOpen(false); }
    finally { setIsLoadingCommitment(false); }
  };

  return (
      <div className="space-y-6">
        <header><h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3"><Boxes className="h-8 w-8 text-primary" />Gestione Materie Prime</h1></header>
        <Tabs defaultValue="list">
            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="list">Magazzino</TabsTrigger><TabsTrigger value="commitments">Impegni Manuali</TabsTrigger></TabsList>
            <TabsContent value="list">
                 <Card>
                    <CardHeader>
                        <div className="flex justify-between items-start flex-wrap gap-4">
                            <div><CardTitle>Magazzino Live</CardTitle></div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="relative w-full sm:w-auto"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca materiale..." className="pl-9 w-full sm:w-64" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                                <Button asChild variant="outline" size="sm"><Link href="/admin/purchase-orders"><Truck className="mr-2 h-4 w-4" /> Ordini</Link></Button>
                                <Button onClick={() => { setSelectedMaterial(null); form.reset({ type: 'BOB', unitOfMeasure: 'n' }); setIsEditDialogOpen(true); }} size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Aggiungi</Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto"><Table>
                            <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead>Stock</TableHead><TableHead>Impegnato</TableHead><TableHead>Disponibile</TableHead><TableHead>Ordinato</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                            <TableBody>
                            {isSearching ? <TableRow><TableCell colSpan={7} className="text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow> : (rawMaterials.length > 0) ? (
                                rawMaterials.map((m) => {
                                  const s = materialStatus.find(st => st.id === m.id);
                                  return (
                                    <TableRow key={m.id}>
                                        <TableCell className="font-bold">{m.code}</TableCell><TableCell className="truncate max-w-xs">{m.description}</TableCell>
                                        <TableCell className="font-semibold">{formatDisplayStock(s ? s.stock : m.currentStockUnits, m.unitOfMeasure)}</TableCell>
                                        <TableCell><button onClick={() => handleOpenCommitmentDetails(m.code)} className="text-amber-600 hover:underline">{s ? formatDisplayStock(s.impegnato, s.unitOfMeasure) : '-'}</button></TableCell>
                                        <TableCell className={cn("font-bold", s && s.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>{s ? formatDisplayStock(s.disponibile, s.unitOfMeasure) : '-'}</TableCell>
                                        <TableCell><Link href={`/admin/purchase-orders?materialCode=${encodeURIComponent(m.code)}`} className="text-blue-600 hover:underline">{s ? formatDisplayStock(s.ordinato, s.unitOfMeasure) : '-'}</Link></TableCell>
                                        <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); form.reset({ ...m }); setIsEditDialogOpen(true); }}>Modifica</DropdownMenuItem><DropdownMenuItem onSelect={() => handleOpenHistoryDialog(m)}>Storico</DropdownMenuItem><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsScrapsDialogOpen(true); }}>Scarti</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                                    </TableRow>
                                  )
                                })
                            ) : (<TableRow><TableCell colSpan={7} className="text-center py-10">Nessun risultato.</TableCell></TableRow>)}
                            </TableBody>
                        </Table></div>
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="commitments"><CommitmentManagementClientPage initialCommitments={initialCommitments} initialArticles={initialArticles} /></TabsContent>
        </Tabs>
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Anagrafica Mat. Prima</DialogTitle></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4 py-4"><FormField control={form.control} name="code" render={({ field }) => ( <FormItem> <FormLabel>Codice</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} /><FormField control={form.control} name="description" render={({ field }) => ( <FormItem> <FormLabel>Descrizione</FormLabel> <FormControl><Textarea {...field} /></FormControl> <FormMessage /> </FormItem> )} /><div className="grid grid-cols-2 gap-4"><FormField control={form.control} name="type" render={({ field }) => ( <FormItem> <FormLabel>Tipo</FormLabel> <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="BOB">BOB</SelectItem><SelectItem value="TUBI">TUBI</SelectItem><SelectItem value="PF3V0">PF3V0</SelectItem><SelectItem value="GUAINA">GUAINA</SelectItem><SelectItem value="BARRA">BARRA</SelectItem></SelectContent></Select> </FormItem> )} /><FormField control={form.control} name="unitOfMeasure" render={({ field }) => ( <FormItem> <FormLabel>UOM</FormLabel> <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="n">N</SelectItem><SelectItem value="mt">MT</SelectItem><SelectItem value="kg">KG</SelectItem></SelectContent></Select> </FormItem> )} /></div><div className="grid grid-cols-2 gap-4">{watchedUOM === 'kg' ? ( <FormField control={form.control} name="rapportoKgMt" render={({ field }) => ( <FormItem> <FormLabel>Kg/mt</FormLabel> <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /> ) : ( <FormField control={form.control} name="conversionFactor" render={({ field }) => ( <FormItem> <FormLabel>Fattore (kg)</FormLabel> <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /> )}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button><Button type="submit" disabled={isPending}>Salva</Button></DialogFooter></form></Form></DialogContent></Dialog>
        <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>Storico: {selectedMaterial?.code}</DialogTitle></DialogHeader><ScrollArea className="max-h-[60vh]"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrizione</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow></TableHeader><TableBody>{materialMovements.length > 0 ? materialMovements.map((m, idx) => (<TableRow key={idx}><TableCell>{format(parseISO(m.date), 'dd/MM/yyyy HH:mm')}</TableCell><TableCell><UiBadge variant={m.type === 'Carico' ? 'default' : 'destructive'}>{m.type}</Badge></TableCell><TableCell>{m.description}</TableCell><TableCell className="text-right font-mono">{m.quantity} {m.unit}</TableCell></TableRow>)) : <TableRow><TableCell colSpan={4} className="text-center">Nessun movimento.</TableCell></TableRow>}</TableBody></Table></ScrollArea></DialogContent></Dialog>
        <Dialog open={isCommitmentDialogOpen} onOpenChange={setIsCommitmentDialogOpen}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Dettaglio Impegnato: {activeMaterialForDetails}</DialogTitle></DialogHeader><ScrollArea className="max-h-[60vh] mt-4"><Table><TableHeader><TableRow><TableHead>Commessa</TableHead><TableHead>Articolo</TableHead><TableHead className="text-right">Quantità</TableHead><TableHead>Consegna</TableHead></TableRow></TableHeader><TableBody>{isLoadingCommitment ? (<TableRow><TableCell colSpan={4} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>) : commitmentDetails.length > 0 ? (commitmentDetails.map((det, idx) => (<TableRow key={idx}><TableCell className="font-mono font-bold">{det.jobId}</TableCell><TableCell className="text-xs">{det.articleCode}</TableCell><TableCell className="text-right font-semibold">{det.quantity.toFixed(2)}</TableCell><TableCell><span className={cn(det.deliveryDate !== 'N/D' && isPast(new Date(det.deliveryDate)) && "text-destructive font-bold")}>{det.deliveryDate !== 'N/D' ? format(parseISO(det.deliveryDate), 'dd/MM/yyyy') : 'N/D'}</span></TableCell></TableRow>))) : (<TableRow><TableCell colSpan={4} className="text-center h-24">Nessun impegno.</TableCell></TableRow>)}</TableBody></Table></ScrollArea><DialogFooter><DialogClose asChild><Button variant="outline">Chiudi</Button></DialogClose></DialogFooter></DialogContent></Dialog>
        <ScrapsDialog isOpen={isScrapsDialogOpen} onOpenChange={setIsScrapsDialogOpen} material={selectedMaterial} />
      </div>
  );
}
