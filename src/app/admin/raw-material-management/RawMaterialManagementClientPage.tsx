
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isPast } from 'date-fns';
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
  type CommitmentDetail 
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
import { Label } from '@/components/ui/label';
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
  Package, 
  Copy,
  Calendar,
  ClipboardList,
  Edit,
  Trash2,
  PackagePlus,
  TestTube,
  Send
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { 
  ContextMenu, 
  ContextMenuContent, 
  ContextMenuItem, 
  ContextMenuTrigger 
} from "@/components/ui/context-menu";
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
  initialDepartments 
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
        toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile caricare i dati del magazzino.' });
      } finally {
        setIsSearching(false);
      }
    } else {
      setRawMaterials([]);
      setMaterialStatus([]);
    }
  }, [searchTerm, toast]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      refreshData();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, refreshData]);

  const onEditSubmit = async (values: z.infer<typeof rawMaterialFormSchema>) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    setIsPending(true);
    const result = await saveRawMaterial(formData);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      refreshData();
      setIsEditDialogOpen(false);
    }
    setIsPending(false);
  };

  const handleOpenHistoryDialog = async (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);
    setMaterialMovements([]); 

    try {
      const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
      const combined: Movement[] = [
        ...(material.batches || []).map((b): Movement => ({
          type: 'Carico',
          date: b.date,
          description: b.inventoryRecordId ? `Inventario` : `Carico - Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
          quantity: Number(b.netQuantity) || 0,
          unit: material.unitOfMeasure.toUpperCase(),
          id: b.id
        })),
        ...withdrawals.map((w): Movement => ({
          type: 'Scarico',
          date: w.withdrawalDate.toISOString(),
          description: w.jobOrderPFs?.join(', ') || 'Scarico Manuale',
          quantity: -(w.consumedUnits || w.consumedWeight || 0),
          unit: w.consumedUnits ? material.unitOfMeasure.toUpperCase() : 'KG',
          id: w.id
        }))
      ];
      setMaterialMovements(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Errore nel caricamento dello storico.' });
    }
  };

  const handleOpenCommitmentDetails = async (materialCode: string) => {
    setActiveMaterialForDetails(materialCode);
    setIsLoadingCommitment(true);
    setIsCommitmentDialogOpen(true);
    try {
      const details = await getMaterialCommitmentDetails(materialCode);
      setCommitmentDetails(details);
    } catch (e) {
      toast({ variant: 'destructive', title: "Errore nel caricamento degli impegni." });
      setIsCommitmentDialogOpen(false);
    } finally {
      setIsLoadingCommitment(false);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!materialToDelete) return;
    setIsPending(true);
    const result = await deleteRawMaterial(materialToDelete.id);
    toast({
        title: result.success ? "Materiale Eliminato" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) refreshData();
    setMaterialToDelete(null);
    setIsPending(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiato!", description: `"${text}" copiato negli appunti.` });
  };

  const groupedBatchMaterial: GroupedBatches | null = useMemo(() => {
    if (!selectedMaterial) return null;
    return {
        materialId: selectedMaterial.id,
        materialCode: selectedMaterial.code,
        materialDescription: selectedMaterial.description,
        unitOfMeasure: selectedMaterial.unitOfMeasure,
        currentStockUnits: selectedMaterial.currentStockUnits,
        currentWeightKg: selectedMaterial.currentWeightKg,
        lots: [], 
    };
  }, [selectedMaterial]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Boxes className="h-8 w-8 text-primary" />
          Gestione Materie Prime
        </h1>
      </header>

      <Tabs defaultValue="list">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">Magazzino Live</TabsTrigger>
          <TabsTrigger value="commitments">Impegni Manuali</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start flex-wrap gap-4">
                <div className="space-y-1">
                  <CardTitle>Magazzino Live</CardTitle>
                  <CardDescription>Giacenze reali ricalcolate dai singoli movimenti storici.</CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Cerca materiale (min 2 car.)..." 
                      className="pl-9 w-full sm:w-64" 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                    />
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/purchase-orders">
                      <Truck className="mr-2 h-4 w-4" /> Ordini Fornitore
                    </Link>
                  </Button>
                  <Button onClick={() => { setSelectedMaterial(null); form.reset({ type: 'BOB', unitOfMeasure: 'n', conversionFactor: null, rapportoKgMt: null }); setIsEditDialogOpen(true); }} size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" /> Aggiungi Mat. Prima
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codice</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Stock Attuale</TableHead>
                      <TableHead>Impegnato</TableHead>
                      <TableHead>Disponibile</TableHead>
                      <TableHead>Ordinato</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isSearching ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-32">
                          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <span>Ricerca e ricalcolo stock in corso...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (rawMaterials.length > 0) ? (
                      rawMaterials.map((m) => {
                        const s = materialStatus.find(st => st.id === m.id);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="font-bold">
                              <ContextMenu>
                                <ContextMenuTrigger className="cursor-help hover:text-primary">
                                  {m.code}
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuItem onSelect={() => handleCopy(m.code)}>
                                    <Copy className="mr-2 h-4 w-4" /> Copia Codice
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            </TableCell>
                            <TableCell className="truncate max-w-[200px] text-xs text-muted-foreground" title={m.description}>
                              {m.description}
                            </TableCell>
                            <TableCell className="font-semibold text-nowrap">
                              {formatDisplayStock(s ? s.stock : m.currentStockUnits, m.unitOfMeasure)}
                              <span className="text-[10px] ml-1 opacity-70">{m.unitOfMeasure.toUpperCase()}</span>
                            </TableCell>
                            <TableCell>
                              <button 
                                onClick={() => handleOpenCommitmentDetails(m.code)} 
                                className="text-amber-600 hover:underline font-medium"
                              >
                                {s ? formatDisplayStock(s.impegnato, s.unitOfMeasure) : '-'}
                              </button>
                            </TableCell>
                            <TableCell className={cn("font-bold", s && s.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>
                              {s ? formatDisplayStock(s.disponibile, s.unitOfMeasure) : '-'}
                            </TableCell>
                            <TableCell>
                              <Link 
                                href={`/admin/purchase-orders?materialCode=${encodeURIComponent(m.code)}`} 
                                className="text-blue-600 hover:underline text-sm font-medium"
                              >
                                {s && s.ordinato > 0 ? formatDisplayStock(s.ordinato, s.unitOfMeasure) : '-'}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); form.reset({ ...m }); setIsEditDialogOpen(true); }}>
                                    <Edit className="mr-2 h-4 w-4" /> Modifica
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsBatchDialogOpen(true); }}>
                                    <PackagePlus className="mr-2 h-4 w-4" /> Carica Lotto
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => handleOpenHistoryDialog(m)}>
                                    <History className="mr-2 h-4 w-4" /> Storico Movimenti
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => { setSelectedMaterial(m); setIsScrapsDialogOpen(true); }}>
                                    <TestTube className="mr-2 h-4 w-4" /> Vedi Scarti
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setMaterialToDelete(m)} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" /> Elimina
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                          {searchTerm.length < 2 ? "Digita almeno 2 caratteri per cercare." : "Nessun materiale trovato."}
                        </TableCell>
                      </TableRow>
                    )}
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

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedMaterial ? 'Modifica Materia Prima' : 'Nuova Materia Prima'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Codice Materiale</FormLabel>
                  <FormControl><Input {...field} placeholder="Es. BOB-TRECCIA-01" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrizione</FormLabel>
                  <FormControl><Textarea {...field} placeholder="Specifiche tecniche..." /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona un tipo" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="BOB">BOB (Bobina)</SelectItem>
                        <SelectItem value="TUBI">TUBI</SelectItem>
                        <SelectItem value="PF3V0">PF3V0</SelectItem>
                        <SelectItem value="GUAINA">GUAINA</SelectItem>
                        <SelectItem value="BARRA">BARRA</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (
                  <FormItem>
                    <FormLabel>UOM</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona un'unità" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="n">N (Pezzi)</SelectItem>
                        <SelectItem value="mt">MT (Metri)</SelectItem>
                        <SelectItem value="kg">KG (Chili)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {watchedUOM === 'kg' ? (
                  <FormField control={form.control} name="rapportoKgMt" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rapporto Kg/mt</FormLabel>
                      <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                  )} />
                ) : (
                  <FormField control={form.control} name="conversionFactor" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fattore Conversione (Kg/U)</FormLabel>
                      <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                  )} />
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                  {selectedMaterial ? 'Salva Modifiche' : 'Crea Materiale'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {isBatchDialogOpen && groupedBatchMaterial && (
        <BatchFormDialog 
          isOpen={isBatchDialogOpen} 
          material={groupedBatchMaterial} 
          batch={null} 
          onClose={(refresh) => { setIsBatchDialogOpen(false); if(refresh) refreshData(); }} 
        />
      )}

      <AlertDialog open={!!materialToDelete} onOpenChange={(open) => !open && setMaterialToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione eliminerà permanentemente l'anagrafica di <strong>{materialToDelete?.code}</strong>. 
              Tutti i lotti e i movimenti associati andranno persi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMaterial} className="bg-destructive hover:bg-destructive/90" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sì, elimina tutto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Storico Movimenti: {selectedMaterial?.code}</DialogTitle>
            <DialogDescription>Elenco cronologico di carichi e scarichi.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrizione/Origine</TableHead>
                  <TableHead className="text-right">Quantità</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialMovements.length > 0 ? (
                  materialMovements.map((m, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{format(parseISO(m.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                      <TableCell>
                        <Badge variant={m.type === 'Carico' ? 'default' : 'destructive'}>
                          {m.type === 'Carico' ? <ArrowUpCircle className="mr-1 h-3 w-3" /> : <ArrowDownCircle className="mr-1 h-3 w-3" />}
                          {m.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-sm" title={m.description}>{m.description}</TableCell>
                      <TableCell className={cn("text-right font-mono font-bold", m.type === 'Carico' ? 'text-green-600' : 'text-destructive')}>
                        {m.quantity.toFixed(2)} {m.unit}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={4} className="text-center h-24">Nessun movimento trovato.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isCommitmentDialogOpen} onOpenChange={setIsCommitmentDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Dettaglio Impegnato: {activeMaterialForDetails}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commessa</TableHead>
                  <TableHead>Articolo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Quantità</TableHead>
                  <TableHead>Consegna Prevista</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingCommitment ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-32"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : commitmentDetails.length > 0 ? (
                  commitmentDetails.map((det, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono font-bold">{det.jobId}</TableCell>
                      <TableCell className="text-xs">{det.articleCode}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{det.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{det.quantity.toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className={cn("h-3 w-3", det.deliveryDate !== 'N/D' && isPast(new Date(det.deliveryDate)) ? "text-destructive" : "text-muted-foreground")} />
                          <span className={cn(det.deliveryDate !== 'N/D' && isPast(new Date(det.deliveryDate)) && "text-destructive font-bold")}>
                            {det.deliveryDate !== 'N/D' ? format(parseISO(det.deliveryDate), 'dd/MM/yyyy') : 'N/D'}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={5} className="text-center h-24">Nessun impegno trovato per questo materiale.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Chiudi</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScrapsDialog isOpen={isScrapsDialogOpen} onOpenChange={setIsScrapsDialogOpen} material={selectedMaterial} />
    </div>
  );
}
