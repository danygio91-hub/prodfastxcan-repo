"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import * as XLSX from 'xlsx';

import { type RawMaterial, type RawMaterialBatch, type MaterialWithdrawal, type RawMaterialType, type Packaging, Department, type Article, ManualCommitment, type ScrapRecord } from '@/lib/mock-data';
import { saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials, addBatchToRawMaterial, updateBatchInRawMaterial, deleteBatchFromRawMaterial, getMaterialWithdrawalsForMaterial, deleteSelectedRawMaterials, deleteSingleWithdrawalAndRestoreStock, getScrapsForMaterial, searchMaterialsAndGetStatus, type MaterialStatus } from './actions';
import { getPackagingItems } from '@/app/inventory/actions';

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
import { Boxes, PlusCircle, Edit, Trash2, Upload, Download, Loader2, MoreVertical, History, PackagePlus, Search, Eye, ArrowUpCircle, ArrowDownCircle, TestTube, Archive, Weight, AlertTriangle, RefreshCw, BarChart3, Database, FileCheck2, ShoppingCart } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDisplayStock } from '@/lib/utils';
import CommitmentManagementClientPage from './CommitmentManagementClientPage';

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string; // ISO String
  description: string;
  quantity: number; // Positive for income, negative for outcome
  unit: string;
  id: string; // Batch or Withdrawal ID
};

const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.enum(['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA']),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  sezione: z.string().optional(),
  filo_el: z.string().optional(),
  larghezza: z.string().optional(),
  tipologia: z.string().optional(),
  unitOfMeasure: z.enum(['n', 'mt', 'kg']),
  conversionFactor: z.coerce.number().optional().nullable(),
  rapportoKgMt: z.coerce.number().optional().nullable(),
});


type RawMaterialFormValues = z.infer<typeof rawMaterialFormSchema>;

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  batchId: z.string().optional(),
  lotto: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  netQuantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
  packagingId: z.string().optional(),
});

type BatchFormValues = z.infer<typeof batchFormSchema>;

interface RawMaterialManagementClientPageProps {
  initialDepartments: Department[];
  initialArticles: Article[];
  initialCommitments: ManualCommitment[];
  initialRawMaterials: RawMaterial[];
  initialMaterialStatus: MaterialStatus[];
}

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
                    <DialogTitle>Storico Scarti per: {material?.code}</DialogTitle>
                    <DialogDescription>Elenco di tutti gli scarti registrati per questo materiale.</DialogDescription>
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
                                <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                            ) : scraps.length > 0 ? (
                                scraps.map(scrap => (
                                    <TableRow key={scrap.id}>
                                        <TableCell>{format(parseISO(scrap.declaredAt), 'dd/MM/yyyy HH:mm')}</TableCell>
                                        <TableCell>{scrap.jobOrderCode}</TableCell>
                                        <TableCell className="font-mono">{scrap.scrappedQuantity} pz</TableCell>
                                        <TableCell>{scrap.operatorName}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow><TableCell colSpan={4} className="text-center h-24">Nessuno scarto registrato per questo materiale.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function RawMaterialManagementClientPage({ 
  initialDepartments, 
  initialArticles, 
  initialCommitments, 
  initialRawMaterials,
  initialMaterialStatus
}: RawMaterialManagementClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');

  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>(initialRawMaterials);
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus[]>(initialMaterialStatus);
  const [isSearching, setIsSearching] = useState(false);
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isBatchFormDialogOpen, setIsBatchFormDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isDetailViewOpen, setIsDetailViewOpen] = useState(false);
  const [isScrapsDialogOpen, setIsScrapsDialogOpen] = useState(false);
  
  const [materialToDelete, setMaterialToDelete] = useState<RawMaterial | null>(null);

  const [batchToDelete, setBatchToDelete] = useState<{materialId: string, batchId: string} | null>(null);
  const [withdrawalToDelete, setWithdrawalToDelete] = useState<string | null>(null);


  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [editingBatch, setEditingBatch] = useState<RawMaterialBatch | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(codeFromUrl || '');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  

  const form = useForm<RawMaterialFormValues>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", unitOfMeasure: 'n', conversionFactor: null, rapportoKgMt: null },
  });

  const batchForm = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: { materialId: '', batchId: undefined, lotto: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', netQuantity: 0, packagingId: 'none' },
  });
  
  const watchedUnitOfMeasure = form.watch('unitOfMeasure');
  
  useEffect(() => {
    if (codeFromUrl) {
      setSearchTerm(codeFromUrl);
    }
  }, [codeFromUrl]);
  
  const refreshData = useCallback(() => {
    // This function will now trigger a search if a search term exists
    const currentSearchTerm = searchTerm;
    setSearchTerm(''); // Clear to reset state
    setTimeout(() => setSearchTerm(currentSearchTerm), 10); // Re-trigger search
  }, [searchTerm]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.length >= 2) {
        setIsSearching(true);
        searchMaterialsAndGetStatus(searchTerm).then(result => {
          setRawMaterials(result.materials);
          setMaterialStatus(result.status);
        }).catch(error => {
          toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile caricare i dati delle materie prime.' });
          console.error(error);
        }).finally(() => {
          setIsSearching(false);
        });
      } else {
        setRawMaterials([]);
        setMaterialStatus([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, toast]);


  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
  }, []);

  // --- Dialog Handlers ---

  const handleOpenEditDialog = (material: RawMaterial | null = null) => {
    setSelectedMaterial(material);
    if (material) {
      form.reset({
        id: material.id,
        code: material.code,
        type: material.type,
        description: material.description,
        sezione: material.details?.sezione,
        filo_el: material.details?.filo_el,
        larghezza: material.details?.larghezza,
        tipologia: material.details?.tipologia,
        unitOfMeasure: material.unitOfMeasure || 'n',
        conversionFactor: material.conversionFactor || null,
        rapportoKgMt: material.rapportoKgMt || null,
      });
    } else {
      form.reset({ id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", unitOfMeasure: 'n', conversionFactor: null, rapportoKgMt: null });
    }
    setIsEditDialogOpen(true);
  };
  
  const handleOpenBatchDialog = (material: RawMaterial, batch: RawMaterialBatch | null = null) => {
    setSelectedMaterial(material);
    setEditingBatch(batch);
    if (batch) {
      batchForm.reset({
        materialId: material.id,
        batchId: batch.id,
        lotto: batch.lotto || '',
        date: format(parseISO(batch.date), 'yyyy-MM-dd'),
        ddt: batch.ddt,
        netQuantity: batch.netQuantity,
        packagingId: batch.packagingId || 'none'
      });
    } else {
      batchForm.reset({ materialId: material.id, batchId: undefined, lotto: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', netQuantity: 0, packagingId: 'none' });
    }
    setIsBatchFormDialogOpen(true);
  };


 const handleOpenHistoryDialog = async (material: RawMaterial, isRefresh: boolean = false) => {
    if (!isRefresh) {
      setSelectedMaterial(material);
      setIsHistoryDialogOpen(true);
    }

    const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
    const updatedMaterial = rawMaterials.find(m => m.id === material.id) || material;
    const batches = updatedMaterial.batches || [];
    
    const combinedMovements: Movement[] = [
        ...batches.map((b): Movement => {
            if (b.inventoryRecordId) {
                // If from inventory, the quantity is the net weight in KG.
                return {
                    type: 'Carico' as const,
                    date: b.date,
                    description: `Inventario - Lotto: ${b.lotto || 'INV'}`,
                    quantity: b.grossWeight - b.tareWeight, // This is the net weight in KG
                    unit: 'KG',
                    id: b.id,
                };
            } else {
                 // For manual batches, netQuantity is in the correct primary unit.
                return {
                    type: 'Carico' as const,
                    date: b.date,
                    description: `Carico Manuale - Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
                    quantity: b.netQuantity,
                    unit: updatedMaterial.unitOfMeasure.toUpperCase(),
                    id: b.id,
                };
            }
        }),
        ...withdrawals.map((w): Movement => {
            // Withdrawals can consume units or weight. We display what was recorded.
            const isWeightBased = (w.consumedUnits === null || w.consumedUnits === undefined);
            const quantity = isWeightBased ? w.consumedWeight : w.consumedUnits;
            const unit = isWeightBased ? 'KG' : updatedMaterial.unitOfMeasure.toUpperCase();
            
            const descriptionParts: string[] = [];
            if (w.jobOrderPFs && w.jobOrderPFs.length > 0 && w.jobOrderPFs[0] !== 'SCARICO_MANUALE') {
                descriptionParts.push(`Commesse: ${w.jobOrderPFs.join(', ')}`);
            } else {
                descriptionParts.push('Scarico Manuale');
            }
            if (w.lotto) {
                descriptionParts.push(`Lotto: ${w.lotto}`);
            }

            return {
                type: 'Scarico' as const,
                date: w.withdrawalDate.toISOString(),
                description: descriptionParts.join(' - '),
                quantity: -(quantity || 0),
                unit: unit,
                id: w.id,
            };
        }),
    ];

    combinedMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setMaterialMovements(combinedMovements);
  };
  
  const handleOpenDetailViewDialog = (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsDetailViewOpen(true);
  };

  const handleOpenScrapsDialog = (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsScrapsDialogOpen(true);
  };


  // --- Form Submissions ---

  const onEditSubmit = async (values: RawMaterialFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) formData.append(key, String(value));
    });

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
  };

  const onBatchSubmit = async (values: BatchFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value) formData.append(key, String(value));
    });

    const result = editingBatch
      ? await updateBatchInRawMaterial(formData)
      : await addBatchToRawMaterial(formData);
      
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      refreshData();
      setIsBatchFormDialogOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!materialToDelete) return;
    const result = await deleteRawMaterial(materialToDelete.id);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setMaterialToDelete(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0) return;
    const result = await deleteSelectedRawMaterials(selectedRows);
     toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
  }

  const handleDeleteBatch = async () => {
    if (!batchToDelete) return;
    const { materialId, batchId } = batchToDelete;
    const result = await deleteBatchFromRawMaterial(materialId, batchId);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setBatchToDelete(null);
  };
  
  const handleDeleteWithdrawal = async () => {
    if (!withdrawalToDelete) return;
    const result = await deleteSingleWithdrawalAndRestoreStock(withdrawalToDelete);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setWithdrawalToDelete(null);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("FileReader non ha restituito dati.");
        
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("Nessun foglio di lavoro trovato nel file Excel.");
        
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { raw: true });

        const filteredData = json.filter((row: any) => row && Object.values(row).some(cell => cell !== null && cell !== ''));
        if (filteredData.length === 0) {
          toast({ variant: "destructive", title: "File Vuoto", description: "Il file Excel non contiene dati." });
          return;
        }

        const headerMapping: { [key: string]: string } = {
            'codice': 'code',
            'code': 'code',
            'tipo': 'type',
            'type': 'type',
            'descrizione': 'description',
            'description': 'description',
            'sezione': 'sezione',
            'filo': 'filo_el',
            'filo el.': 'filo_el',
            'filo_el': 'filo_el',
            'larghezza': 'larghezza',
            'tipologia': 'tipologia',
            'unita misura': 'unitOfMeasure',
            'fattore conversione': 'conversionFactor',
            'stock': 'stockInUnits',
            'peso (kg)': 'stockInKg',
        };
        
        const mappedJson = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
                const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, ' ');
                const targetKey = headerMapping[normalizedKey];
                if (targetKey && row[key] !== null && row[key] !== undefined && row[key] !== '') {
                    normalizedRow[targetKey] = row[key];
                }
            }
            return normalizedRow;
        });

        const result = await commitImportedRawMaterials(mappedJson);
        toast({
          title: result.success ? "Importazione Completata" : "Errore di Importazione",
          description: result.message,
          variant: result.success ? "default" : "destructive",
        });
        
        if(result.success) {
            refreshData();
        }
      } catch (error) {
          toast({ variant: "destructive", title: "Errore di Importazione", description: error instanceof Error ? error.message : "Si è verificato un errore sconosciuto." });
      } finally {
        setIsImporting(false);
        if (event.target) event.target.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const handleExport = () => {
    const dataToExport = rawMaterials.map(m => ({
        'Codice': m.code,
        'Tipo': m.type,
        'Descrizione': m.description,
        'Stock': m.currentStockUnits,
        'Unita Misura': m.unitOfMeasure,
        'Fattore Conversione': m.conversionFactor,
        'Fattore Rapporto KG/mt': m.rapportoKgMt,
        'Sezione': m.details.sezione,
        'Filo El.': m.details.filo_el,
        'Larghezza': m.details.larghezza,
        'Tipologia': m.details.tipologia,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Materie Prime");
    XLSX.writeFile(wb, "anagrafica_materie_prime.xlsx");
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedRows(rawMaterials.map(m => m.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={9} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento materiali...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Boxes className="h-8 w-8 text-primary" />
          Gestione Materie Prime
          </h1>
          <p className="text-muted-foreground mt-1">
          Gestisci l'anagrafica e la situazione delle materie prime a magazzino.
          </p>
        </header>

        <Tabs defaultValue="list">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">
                    <Search className="mr-2 h-4 w-4" /> Elenco e Situazione Materie Prime
                </TabsTrigger>
                 <TabsTrigger value="commitments">
                    <FileCheck2 className="mr-2 h-4 w-4" /> Impegni Manuali
                </TabsTrigger>
            </TabsList>
            <TabsContent value="list">
                 <Card>
                    <CardHeader>
                        <div className="flex justify-between items-start flex-wrap gap-4">
                            <div>
                                <CardTitle className="font-headline">Elenco e Situazione Materie Prime</CardTitle>
                                <CardDescription>Cerca per codice per visualizzare le materie prime.</CardDescription>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                                <div className="relative w-full sm:w-auto">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Cerca per codice o descrizione..."
                                        className="pl-9"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
                                <Button onClick={handleExport} variant="outline" size="sm" disabled={rawMaterials.length === 0}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Esporta
                                </Button>
                                <Button onClick={handleImportClick} variant="outline" size="sm" disabled={isImporting}>
                                    {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
                                    Importa
                                </Button>
                                <Button onClick={() => handleOpenEditDialog()} size="sm">
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Aggiungi Mat. Prima
                                </Button>
                            </div>
                        </div>
                        {selectedRows.length > 0 && (
                            <div className="flex items-center gap-2 pt-4">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm">
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Elimina ({selectedRows.length})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                        Questa azione è irreversibile. Verranno eliminate definitivamente {selectedRows.length} materie prime e il loro storico.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">Continua</AlertDialogAction>
                                    </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                            <TableRow>
                                <TableHead padding="checkbox">
                                <Checkbox
                                    checked={selectedRows.length > 0 ? (selectedRows.length === rawMaterials.length && rawMaterials.length > 0 ? true : 'indeterminate') : false}
                                    onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                                    aria-label="Seleziona tutte"
                                    disabled={rawMaterials.length === 0}
                                />
                                </TableHead>
                                <TableHead>Codice</TableHead>
                                <TableHead>Descrizione</TableHead>
                                <TableHead>Stock Attuale</TableHead>
                                <TableHead>Impegnato</TableHead>
                                <TableHead>Disponibile</TableHead>
                                <TableHead>Unità Misura</TableHead>
                                <TableHead>Stock (KG)</TableHead>
                                <TableHead className="text-right">Azioni</TableHead>
                            </TableRow>
                            </TableHeader>
                            <TableBody>
                            {isSearching ? renderLoading() : (rawMaterials.length > 0) ? (
                                rawMaterials.map((material) => {
                                  const status = materialStatus.find(s => s.id === material.id);
                                  return (
                                    <TableRow key={material.id} data-state={selectedRows.includes(material.id) ? "selected" : undefined}>
                                        <TableCell padding="checkbox">
                                        <Checkbox
                                            checked={selectedRows.includes(material.id)}
                                            onCheckedChange={() => handleSelectRow(material.id)}
                                            aria-label={`Seleziona materiale ${material.code}`}
                                        />
                                        </TableCell>
                                        <TableCell className="font-medium">{material.code}</TableCell>
                                        <TableCell>{material.description}</TableCell>
                                        <TableCell>{formatDisplayStock(material.currentStockUnits, material.unitOfMeasure)}</TableCell>
                                        <TableCell className="font-mono text-amber-600">{status ? formatDisplayStock(status.impegnato, status.unitOfMeasure) : '-'}</TableCell>
                                        <TableCell className={cn("font-bold", status && status.disponibile < 0 ? 'text-destructive' : 'text-green-600')}>{status ? formatDisplayStock(status.disponibile, status.unitOfMeasure) : '-'}</TableCell>
                                        <TableCell>{material.unitOfMeasure}</TableCell>
                                        <TableCell>{formatDisplayStock(material.currentWeightKg, 'kg')}</TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon">
                                                <MoreVertical className="h-4 w-4" />
                                                <span className="sr-only">Apri menu per {material.code}</span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onSelect={() => handleOpenDetailViewDialog(material)}>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    <span>Vedi Dettaglio</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleOpenEditDialog(material)}>
                                                    <Edit className="mr-2 h-4 w-4" />
                                                    <span>Modifica Anagrafica</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleOpenBatchDialog(material, null)}>
                                                    <PackagePlus className="mr-2 h-4 w-4" />
                                                    <span>Aggiungi Lotto</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleOpenHistoryDialog(material)}>
                                                    <History className="mr-2 h-4 w-4" />
                                                    <span>Storico Movimenti</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleOpenScrapsDialog(material)}>
                                                    <TestTube className="mr-2 h-4 w-4" />
                                                    <span>Visualizza Scarti</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem disabled>
                                                    <ShoppingCart className="mr-2 h-4 w-4" />
                                                    <span>Ordini a Fornitore</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={() => setMaterialToDelete(material)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    <span>Elimina</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                  )
                                })
                            ) : (
                                <TableRow>
                                <TableCell colSpan={9} className="text-center h-24">
                                    {searchTerm.length < 2 ? "Digita almeno 2 caratteri per avviare la ricerca." : "Nessuna materia prima trovata."}
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
                <CommitmentManagementClientPage 
                    initialCommitments={initialCommitments} 
                    initialArticles={initialArticles} 
                />
            </TabsContent>
        </Tabs>
      
        {/* Edit/Add Material Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{selectedMaterial ? "Modifica Materia Prima" : "Aggiungi Nuova Materia Prima"}</DialogTitle>
              <DialogDescription>
                {selectedMaterial ? "Modifica i dettagli descrittivi della materia prima." : "Aggiungi una nuova materia prima. Lo stock andrà aggiunto registrando un lotto."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-6">
                <FormField control={form.control} name="code" render={({ field }) => ( <FormItem> <FormLabel>Codice *</FormLabel> <FormControl><Input placeholder="Es. BOB-12345" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                <FormField control={form.control} name="description" render={({ field }) => ( <FormItem> <FormLabel>Descrizione *</FormLabel> <FormControl><Textarea placeholder="Descrizione dettagliata del materiale" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="type" render={({ field }) => ( 
                    <FormItem>
                      <FormLabel>Tipo *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona un tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="BOB">BOB</SelectItem>
                          <SelectItem value="TUBI">TUBI</SelectItem>
                          <SelectItem value="PF3V0">PF3V0</SelectItem>
                          <SelectItem value="GUAINA">GUAINA</SelectItem>
                          <SelectItem value="BARRA">BARRA</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                
                 <div className="grid grid-cols-2 gap-4">
                     <FormField control={form.control} name="unitOfMeasure" render={({ field }) => ( 
                        <FormItem>
                          <FormLabel>Unità di Misura</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Seleziona un'unità" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="n">Numero (n)</SelectItem>
                              <SelectItem value="mt">Metri (mt)</SelectItem>
                              <SelectItem value="kg">Chilogrammi (kg)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    {watchedUnitOfMeasure === 'kg' ? (
                       <FormField control={form.control} name="rapportoKgMt" render={({ field }) => ( <FormItem> <FormLabel>Rapporto KG/mt</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 0.012" {...field} value={field.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )} />
                    ) : (
                        <FormField control={form.control} name="conversionFactor" render={({ field }) => ( <FormItem> <FormLabel>Fattore di Conversione (kg)</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 0.025" {...field} value={field.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )} />
                    )}
                </div>
                
                <h4 className="text-sm font-medium pt-2">Dettagli (opzionale)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="sezione" render={({ field }) => ( <FormItem> <FormLabel>Sezione</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="filo_el" render={({ field }) => ( <FormItem> <FormLabel>Filo El.</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="larghezza" render={({ field }) => ( <FormItem> <FormLabel>Larghezza</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="tipologia" render={({ field }) => ( <FormItem> <FormLabel>Tipologia</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                </div>
                <DialogFooter className="pt-4 sticky bottom-0 bg-background/95">
                  <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annulla</Button>
                  <Button type="submit">{selectedMaterial ? "Salva Modifiche" : "Aggiungi Materia Prima"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        
        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!materialToDelete} onOpenChange={(open) => !open && setMaterialToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Questa azione non può essere annullata. La materia prima
                        <span className="font-bold"> {materialToDelete?.code} </span>
                        e tutto il suo storico verranno eliminati.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setMaterialToDelete(null)}>Annulla</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Continua</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>


        {/* Add/Edit Batch Dialog */}
        <Dialog open={isBatchFormDialogOpen} onOpenChange={setIsBatchFormDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{editingBatch ? 'Modifica Lotto' : 'Aggiungi Lotto'} per: {selectedMaterial?.code}</DialogTitle>
                    <DialogDescription>
                        {editingBatch ? 'Modifica i dettagli di questo lotto.' : 'Registra un nuovo lotto di merce in entrata.'}
                    </DialogDescription>
                </DialogHeader>
                <Form {...batchForm}>
                    <form onSubmit={batchForm.handleSubmit(onBatchSubmit)} className="space-y-4 py-4">
                        <FormField control={batchForm.control} name="lotto" render={({ field }) => ( <FormItem> <FormLabel>N° Lotto (Fornitore)</FormLabel> <FormControl><Input placeholder="Numero lotto opzionale" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        <FormField control={batchForm.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data Ricezione</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        <FormField control={batchForm.control} name="ddt" render={({ field }) => ( <FormItem> <FormLabel>Documento di Trasporto (DDT)</FormLabel> <FormControl><Input placeholder="Numero DDT" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        
                        {selectedMaterial?.unitOfMeasure === 'kg' ? (
                          <>
                            <FormField
                              control={batchForm.control}
                              name="packagingId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="flex items-center"><Archive className="mr-2 h-4 w-4" /> Imballo / Tara</FormLabel>
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Seleziona un imballo..." /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectItem value="none">Nessuna Tara</SelectItem>
                                      {packagingItems.map(item => (
                                        <SelectItem key={item.id} value={item.id}>{item.name} ({item.weightKg} kg)</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            
                            <FormField control={batchForm.control} name="netQuantity" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4"/>Peso Netto (KG)</FormLabel>
                                <FormControl><Input type="number" step="any" placeholder="Peso del materiale senza tara" {...field} value={field.value ?? ''} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />

                            <div className="space-y-1">
                              <Label className="text-muted-foreground">Peso Lordo Calcolato (KG)</Label>
                              <p className="p-2 bg-muted rounded-md font-mono">
                                {(
                                  (Number(batchForm.watch('netQuantity')) || 0) +
                                  (packagingItems.find(p => p.id === batchForm.watch('packagingId'))?.weightKg || 0)
                                ).toFixed(3)}
                              </p>
                            </div>
                          </>
                        ) : (
                           <FormField control={batchForm.control} name="netQuantity" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex items-center"><PackagePlus className="mr-2 h-4 w-4" />Quantità ({selectedMaterial?.unitOfMeasure.toUpperCase()})</FormLabel>
                                <FormControl><Input type="number" step="1" placeholder="Numero di pezzi o metri" {...field} value={field.value ?? ''} /></FormControl>
                                <FormMessage />
                            </FormItem>
                           )} />
                        )}
                        
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsBatchFormDialogOpen(false)}>Annulla</Button>
                            <Button type="submit">{editingBatch ? 'Salva Modifiche' : 'Aggiungi Lotto'}</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>

          {/* View History Dialog */}
        <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Storico Movimenti per: {selectedMaterial?.code}</DialogTitle>
                    <DialogDescription>
                        Elenco di tutti i carichi e scarichi registrati per questo materiale.
                    </DialogDescription>
                </DialogHeader>
                  <ScrollArea className="max-h-[60vh]">
                      <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Descrizione</TableHead>
                          <TableHead className="text-right">Quantità</TableHead>
                          <TableHead className="text-right">Azioni</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {materialMovements.length > 0 ? (
                            materialMovements.map(mov => (
                            <TableRow key={mov.id}>
                                <TableCell>{format(parseISO(mov.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                <TableCell>
                                    <UiBadge variant={mov.type === 'Carico' ? 'default' : 'destructive'} className={cn(mov.type === 'Carico' && 'bg-green-600 hover:bg-green-700')}>
                                      {mov.type === 'Carico' ? <ArrowUpCircle className="mr-2 h-4 w-4"/> : <ArrowDownCircle className="mr-2 h-4 w-4"/>}
                                      {mov.type}
                                    </UiBadge>
                                </TableCell>
                                <TableCell>{mov.description}</TableCell>
                                <TableCell className={cn("text-right font-mono", mov.type === 'Carico' ? 'text-green-500' : 'text-destructive')}>
                                  {formatDisplayStock(mov.quantity, mov.unit.toLowerCase() as 'n' | 'mt' | 'kg')} {mov.unit}
                                </TableCell>
                                <TableCell className="text-right">
                                  {mov.type === 'Carico' ? (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per eliminare il lotto caricato. L'azione è irreversibile e lo stock verrà ricalcolato.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel onClick={() => setBatchToDelete(null)}>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => setBatchToDelete({ materialId: selectedMaterial!.id, batchId: mov.id })}>Elimina Lotto</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  ) : (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per eliminare questo scarico. L'azione è irreversibile e la quantità verrà ripristinata a magazzino.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel onClick={() => setWithdrawalToDelete(null)}>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => setWithdrawalToDelete(mov.id)}>Elimina Scarico</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </TableCell>
                            </TableRow>
                            ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center h-24">Nessuno storico movimenti per questo materiale.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Chiudi</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Delete Batch Confirmation Dialog */}
        <AlertDialog open={!!batchToDelete} onOpenChange={(open) => !open && setBatchToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Sei sicuro di voler eliminare questo lotto?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Questa azione è irreversibile. Lo stock totale verrà ricalcolato.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setBatchToDelete(null)}>Annulla</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteBatch} className="bg-destructive hover:bg-destructive/90">Elimina</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        
        {/* Delete Withdrawal Confirmation Dialog */}
        <AlertDialog open={!!withdrawalToDelete} onOpenChange={(open) => !open && setWithdrawalToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sei sicuro di voler eliminare questo scarico?</AlertDialogTitle>
              <AlertDialogDescription>
                L'azione è irreversibile e lo stock del materiale verrà ripristinato.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setWithdrawalToDelete(null)}>Annulla</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteWithdrawal} className="bg-destructive hover:bg-destructive/90">Sì, elimina scarico</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>


         {/* Detail View Dialog */}
        <Dialog open={isDetailViewOpen} onOpenChange={setIsDetailViewOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Scheda Prodotto: {selectedMaterial?.code}</DialogTitle>
                    <DialogDescription>{selectedMaterial?.description}</DialogDescription>
                </DialogHeader>
                {selectedMaterial && (
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1"><Label>Tipo</Label><p className="p-2 bg-muted rounded-md">{selectedMaterial.type}</p></div>
                            <div className="space-y-1"><Label>Sezione</Label><p className="p-2 bg-muted rounded-md">{selectedMaterial.details.sezione || 'N/D'}</p></div>
                            <div className="space-y-1"><Label>Filo El.</Label><p className="p-2 bg-muted rounded-md">{selectedMaterial.details.filo_el || 'N/D'}</p></div>
                            <div className="space-y-1"><Label>Larghezza</Label><p className="p-2 bg-muted rounded-md">{selectedMaterial.details.larghezza || 'N/D'}</p></div>
                            <div className="p-2 bg-muted rounded-md col-span-2"><Label>Tipologia</Label><p>{selectedMaterial.details.tipologia || 'N/D'}</p></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4">
                            <div className="p-3 rounded-lg border bg-background">
                                <Label>Stock ({selectedMaterial.unitOfMeasure.toUpperCase()})</Label>
                                <p className="text-2xl font-bold">{formatDisplayStock(selectedMaterial.currentStockUnits, selectedMaterial.unitOfMeasure)}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background">
                                <Label>Stock Calcolato (KG)</Label>
                                <p className="text-2xl font-bold">{formatDisplayStock(selectedMaterial.currentWeightKg, 'kg')}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background">
                                <Label>Fattore Conversione (kg)</Label>
                                <p className="text-2xl font-bold">{selectedMaterial.conversionFactor ?? 'N/A'}</p>
                            </div>
                              <div className="p-3 rounded-lg border bg-background">
                                <Label>Rapporto KG/mt</Label>
                                <p className="text-2xl font-bold">{selectedMaterial.rapportoKgMt ?? 'N/A'}</p>
                            </div>
                        </div>
                    </div>
                )}
                 <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDetailViewOpen(false)}>Chiudi</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        
         <ScrapsDialog 
            isOpen={isScrapsDialogOpen}
            onOpenChange={setIsScrapsDialogOpen}
            material={selectedMaterial}
        />
      </div>
  );
}
