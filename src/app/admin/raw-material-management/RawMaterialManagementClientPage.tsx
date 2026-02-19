"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';

import { type RawMaterial, type RawMaterialBatch, type MaterialWithdrawal, type RawMaterialType, type ManualCommitment, type ScrapRecord, type Department, type Article } from '@/lib/mock-data';
import { saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials, addBatchToRawMaterial, getMaterialWithdrawalsForMaterial, getScrapsForMaterial, searchMaterialsAndGetStatus, type MaterialStatus } from './actions';

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
import { Boxes, PlusCircle, Edit, Trash2, Upload, Loader2, MoreVertical, History, PackagePlus, Search, ArrowUpCircle, ArrowDownCircle, TestTube, ClipboardList, Send } from 'lucide-react';
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

    useEffect(() => {
        if (isOpen && material) {
            setIsLoading(true);
            getScrapsForMaterial(material.id).then(setScraps).finally(() => setIsLoading(false));
        }
    }, [isOpen, material]);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Storico Scarti per: {material?.code}</DialogTitle></DialogHeader>
                <ScrollArea className="max-h-[60vh] mt-4">
                    <Table>
                        <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Commessa</TableHead><TableHead>Q.tà Scartata</TableHead><TableHead>Operatore</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                            ) : scraps.length > 0 ? (
                                scraps.map(s => (<TableRow key={s.id}><TableCell>{format(parseISO(s.declaredAt), 'dd/MM/yyyy HH:mm')}</TableCell><TableCell>{s.jobOrderCode}</TableCell><TableCell>{s.scrappedQuantity} pz</TableCell><TableCell>{s.operatorName}</TableCell></TableRow>))
                            ) : (<TableRow><TableCell colSpan={4} className="text-center h-24">Nessuno scarto registrato.</TableCell></TableRow>)}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export default function RawMaterialManagementClientPage({ initialArticles, initialCommitments }: { initialArticles: Article[]; initialCommitments: ManualCommitment[]; }) {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof rawMaterialFormSchema>>({ resolver: zodResolver(rawMaterialFormSchema), defaultValues: { type: 'BOB', unitOfMeasure: 'n' } });
  const batchForm = useForm<z.infer<typeof batchFormSchema>>({ resolver: zodResolver(batchFormSchema) });
  const watchedUOM = form.watch('unitOfMeasure');
  
  const refreshData = useCallback(() => {
    if (searchTerm.length >= 2) {
        setIsSearching(true);
        searchMaterialsAndGetStatus(searchTerm).then(result => {
          setRawMaterials(result.materials);
          setMaterialStatus(result.status);
        }).finally(() => setIsSearching(false));
    }
  }, [searchTerm]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.length >= 2) {
        setIsSearching(true);
        searchMaterialsAndGetStatus(searchTerm).then(result => {
          setRawMaterials(result.materials);
          setMaterialStatus(result.status);
        }).finally(() => setIsSearching(false));
      } else {
        setRawMaterials([]);
        setMaterialStatus([]);
      }
    }, 300);
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

  const onBatchSubmit = async (values: z.infer<typeof batchFormSchema>) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => { if (value) formData.append(key, String(value)); });
    setIsPending(true);
    const result = await addBatchToRawMaterial(formData);
    toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) { refreshData(); setIsBatchFormDialogOpen(false); }
    setIsPending(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(worksheet);
      const result = await commitImportedRawMaterials(json);
      toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
      if (result.success) refreshData();
    } catch (error) { toast({ variant: "destructive", title: "Errore Importazione", description: "Errore durante la lettura del file." }); }
    finally { setIsImporting(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleDelete = async () => {
    if (!materialToDelete) return;
    setIsPending(true);
    const result = await deleteRawMaterial(materialToDelete.id);
    toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) { setRawMaterials(prev => prev.filter(m => m.id !== materialToDelete.id)); setMaterialToDelete(null); }
    setIsPending(false);
  };

  const handleOpenHistoryDialog = async (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);
    const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
    const updated = rawMaterials.find(m => m.id === material.id) || material;
    const combined: Movement[] = [
        ...(updated.batches || []).map((b): Movement => ({ type: 'Carico', date: b.date, description: b.inventoryRecordId ? `Inventario - Lotto: ${b.lotto || 'INV'}` : `Carico Manuale - Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`, quantity: Number(b.netQuantity) || 0, unit: updated.unitOfMeasure.toUpperCase(), id: b.id })),
        ...withdrawals.map((w): Movement => {
            const units = Number(w.consumedUnits) || 0;
            return { type: 'Scarico', date: w.withdrawalDate.toISOString(), description: w.jobOrderPFs && w.jobOrderPFs.length > 0 && w.jobOrderPFs[0] !== 'SCARICO_MANUALE' ? `Commesse: ${w.jobOrderPFs.join(', ')}` : 'Scarico Manuale', quantity: -units, unit: units ? updated.unitOfMeasure.toUpperCase() : 'KG', id: w.id };
        })
    ];
    setMaterialMovements(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  };

  return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3"><Boxes className="h-8 w-8 text-primary" />Gestione Materie Prime</h1>
          <p className="text-muted-foreground mt-1">Monitoraggio real-time del magazzino e gestione anagrafica.</p>
        </header>

        <Tabs defaultValue="list">
            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="list"><Search className="mr-2 h-4 w-4" /> Elenco Materie Prime</TabsTrigger><TabsTrigger value="commitments"><ClipboardList className="mr-2 h-4 w-4" /> Impegni Manuali</TabsTrigger></TabsList>
            <TabsContent value="list">
                 <Card>
                    <CardHeader>
                        <div className="flex justify-between items-start flex-wrap gap-4">
                            <div><CardTitle className="font-headline">Magazzino Live</CardTitle><CardDescription>Dati ricalcolati live dai movimenti storici.</CardDescription></div>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                                <div className="relative w-full sm:w-auto"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca materiale..." className="pl-9 w-full sm:w-64" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                                <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}><Upload className="mr-2 h-4 w-4" /> Importa</Button>
                                <Button onClick={() => { setSelectedMaterial(null); form.reset({ type: 'BOB', unitOfMeasure: 'n', conversionFactor: null, rapportoKgMt: null }); setIsEditDialogOpen(true); }} size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Aggiungi</Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader><TableRow><TableHead padding="checkbox"><Checkbox checked={selectedRows.length > 0 && selectedRows.length === rawMaterials.length} onCheckedChange={(c) => setSelectedRows(c ? rawMaterials.map(m => m.id) : [])} /></TableHead><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead>Stock Attuale</TableHead><TableHead>Impegnato</TableHead><TableHead>Disponibile</TableHead><TableHead>Unità</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                            <TableBody>
                            {isSearching ? <TableRow><TableCell colSpan={8} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></TableCell></TableRow> : (rawMaterials.length > 0) ? (
                                rawMaterials.map((m) => {
                                  const s = materialStatus.find(st => st.id === m.id);
                                  const displayStock = s ? s.stock : m.currentStockUnits;
                                  return (
                                    <TableRow key={m.id}>
                                        <TableCell padding="checkbox"><Checkbox checked={selectedRows.includes(m.id)} onCheckedChange={(c) => setSelectedRows(prev => c ? [...prev, m.id] : prev.filter(id => id !== m.id))} /></TableCell>
                                        <TableCell className="font-medium">{m.code}</TableCell><TableCell className="max-w-xs truncate">{m.description}</TableCell>
                                        <TableCell className="font-semibold">{formatDisplayStock(displayStock, m.unitOfMeasure)}</TableCell>
                                        <TableCell className="font-mono text-amber-600">{s ? formatDisplayStock(s.impegnato, s.unitOfMeasure) : '-'}</TableCell>
                                        <TableCell className={cn("font-bold", s && s.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>{s ? formatDisplayStock(s.disponibile, s.unitOfMeasure) : '-'}</TableCell>
                                        <TableCell>{m.unitOfMeasure.toUpperCase()}</TableCell>
                                        <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); form.reset({ ...m, id: m.id }); setIsEditDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Modifica</DropdownMenuItem><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); batchForm.reset({ materialId: m.id, date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_MANUALE', netQuantity: 0 }); setIsBatchFormDialogOpen(true); }}><PackagePlus className="mr-2 h-4 w-4" /> Carica Lotto</DropdownMenuItem><DropdownMenuItem onSelect={() => handleOpenHistoryDialog(m)}><History className="mr-2 h-4 w-4" /> Storico</DropdownMenuItem><DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsScrapsDialogOpen(true); }}><TestTube className="mr-2 h-4 w-4" /> Scarti</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setMaterialToDelete(m)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Elimina</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                                    </TableRow>
                                  )
                                })
                            ) : (<TableRow><TableCell colSpan={8} className="text-center h-24">{searchTerm.length < 2 ? "Digita 2+ caratteri per cercare." : "Nessun materiale trovato."}</TableCell></TableRow>)}
                            </TableBody>
                        </Table>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="commitments">
                <CommitmentManagementClientPage initialCommitments={initialCommitments} initialArticles={initialArticles} />
            </TabsContent>
        </Tabs>
      
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{selectedMaterial ? "Modifica" : "Nuova"} Mat. Prima</DialogTitle></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4 py-4"><FormField control={form.control} name="code" render={({ field }) => ( <FormItem> <FormLabel>Codice *</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} /><FormField control={form.control} name="description" render={({ field }) => ( <FormItem> <FormLabel>Descrizione *</FormLabel> <FormControl><Textarea {...field} /></FormControl> <FormMessage /> </FormItem> )} /><div className="grid grid-cols-2 gap-4"><FormField control={form.control} name="type" render={({ field }) => ( <FormItem> <FormLabel>Tipo *</FormLabel> <Select onValueChange={field.onChange} value={field.value}> <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl> <SelectContent> <SelectItem value="BOB">BOB</SelectItem> <SelectItem value="TUBI">TUBI</SelectItem> <SelectItem value="PF3V0">PF3V0</SelectItem> <SelectItem value="GUAINA">GUAINA</SelectItem> <SelectItem value="BARRA">BARRA</SelectItem> </SelectContent> </Select> </FormItem> )} /><FormField control={form.control} name="unitOfMeasure" render={({ field }) => ( <FormItem> <FormLabel>UOM</FormLabel> <Select onValueChange={field.onChange} value={field.value}> <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl> <SelectContent> <SelectItem value="n">N</SelectItem> <SelectItem value="mt">MT</SelectItem> <SelectItem value="kg">KG</SelectItem> </SelectContent> </Select> </FormItem> )} /></div><div className="grid grid-cols-2 gap-4">{watchedUOM === 'kg' ? ( <FormField control={form.control} name="rapportoKgMt" render={({ field }) => ( <FormItem> <FormLabel>Kg/mt</FormLabel> <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /> ) : ( <FormField control={form.control} name="conversionFactor" render={({ field }) => ( <FormItem> <FormLabel>Fattore (kg)</FormLabel> <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /> )}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button><Button type="submit" disabled={isPending}>Salva</Button></DialogFooter></form></Form></DialogContent></Dialog>

        <Dialog open={isBatchFormDialogOpen} onOpenChange={setIsBatchFormDialogOpen}><DialogContent><DialogHeader><DialogTitle>Carico Manuale Lotto</DialogTitle></DialogHeader><Form {...batchForm}><form onSubmit={batchForm.handleSubmit(onBatchSubmit)} className="space-y-4 py-4"><FormField control={batchForm.control} name="lotto" render={({ field }) => ( <FormItem> <FormLabel>Lotto</FormLabel> <FormControl><Input {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /><FormField control={batchForm.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> </FormItem> )} /><FormField control={batchForm.control} name="netQuantity" render={({ field }) => ( <FormItem> <FormLabel>Quantità ({selectedMaterial?.unitOfMeasure.toUpperCase()})</FormLabel> <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl> </FormItem> )} /><DialogFooter><Button type="button" variant="outline" onClick={() => setIsBatchFormDialogOpen(false)}>Annulla</Button><Button type="submit" disabled={isPending}>Conferma</Button></DialogFooter></form></Form></DialogContent></Dialog>

        <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>Storico: {selectedMaterial?.code}</DialogTitle></DialogHeader><ScrollArea className="max-h-[60vh]"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrizione</TableHead><TableHead className="text-right">Quantità</TableHead></TableRow></TableHeader><TableBody>{materialMovements.length > 0 ? materialMovements.map((m, idx) => (<TableRow key={idx}><TableCell>{format(parseISO(m.date), 'dd/MM/yyyy HH:mm')}</TableCell><TableCell><UiBadge variant={m.type === 'Carico' ? 'default' : 'destructive'}>{m.type}</UiBadge></TableCell><TableCell>{m.description}</TableCell><TableCell className="text-right font-mono">{m.quantity} {m.unit}</TableCell></TableRow>)) : <TableRow><TableCell colSpan={4} className="text-center">Nessun movimento registrato.</TableCell></TableRow>}</TableBody></Table></ScrollArea></DialogContent></Dialog>

        <AlertDialog open={!!materialToDelete} onOpenChange={() => setMaterialToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminare permanentemente?</AlertDialogTitle><AlertDialogDescription>Questa azione è irreversibile.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive" disabled={isPending}>Elimina</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
        <ScrapsDialog isOpen={isScrapsDialogOpen} onOpenChange={setIsScrapsDialogOpen} material={selectedMaterial} />
      </div>
  );
}