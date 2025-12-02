

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

import { type RawMaterial, type RawMaterialBatch, type MaterialWithdrawal, type RawMaterialType, type Packaging } from '@/lib/mock-data';
import { saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials, addBatchToRawMaterial, updateBatchInRawMaterial, deleteBatchFromRawMaterial, getMaterialWithdrawalsForMaterial, deleteSelectedRawMaterials } from './actions';
import { getPackagingItems } from '@/app/material-loading/actions';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Boxes, PlusCircle, Edit, Trash2, Upload, Download, Loader2, MoreVertical, History, PackagePlus, Search, Eye, ArrowUpCircle, ArrowDownCircle, TestTube, Archive, Weight } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  initialMaterials: RawMaterial[];
}

export default function RawMaterialManagementClientPage({ initialMaterials }: RawMaterialManagementClientPageProps) {
  const [materials, setMaterials] = useState<RawMaterial[]>(initialMaterials);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isBatchFormDialogOpen, setIsBatchFormDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isDetailViewOpen, setIsDetailViewOpen] = useState(false);
  
  const [materialToDelete, setMaterialToDelete] = useState<RawMaterial | null>(null);

  const [batchToDelete, setBatchToDelete] = useState<{materialId: string, batchId: string} | null>(null);

  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [editingBatch, setEditingBatch] = useState<RawMaterialBatch | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const form = useForm<RawMaterialFormValues>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", unitOfMeasure: 'n', conversionFactor: null },
  });

  const batchForm = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: { materialId: '', batchId: undefined, lotto: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', netQuantity: 0, packagingId: 'none' },
  });
  
  const watchedUnitOfMeasure = form.watch('unitOfMeasure');
  
  const filteredMaterials = useMemo(() => {
    if (!searchTerm) {
      return materials;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return materials.filter(material =>
      (material.code?.toLowerCase() || '').includes(lowercasedFilter) ||
      (material.description?.toLowerCase() || '').includes(lowercasedFilter)
    );
  }, [materials, searchTerm]);

  const refreshData = useCallback(() => {
    router.refresh();
  }, [router]);
  
  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
  }, []);

  useEffect(() => {
    setMaterials(initialMaterials);
    setSelectedRows([]);
  }, [initialMaterials]);


  // --- Dialog Handlers ---

  const handleOpenEditDialog = (material: RawMaterial | null = null) => {
    setSelectedMaterial(material);
    if (material) {
      form.reset({
        id: material.id,
        code: material.code,
        type: material.type,
        description: material.description,
        sezione: material.details.sezione,
        filo_el: material.details.filo_el,
        larghezza: material.details.larghezza,
        tipologia: material.details.tipologia,
        unitOfMeasure: material.unitOfMeasure || 'n',
        conversionFactor: material.conversionFactor || null,
      });
    } else {
      form.reset({ id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", unitOfMeasure: 'n', conversionFactor: null });
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


  const handleOpenHistoryDialog = async (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);

    const withdrawals = await getMaterialWithdrawalsForMaterial(material.id);
    const batches = material.batches || [];
    
    const combinedMovements: Movement[] = [
        ...batches.map(b => ({
            type: 'Carico' as const,
            date: b.date,
            description: `Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
            quantity: b.netQuantity || 0,
            unit: material.unitOfMeasure.toUpperCase(),
            id: b.id
        })),
        ...withdrawals.map(w => ({
            type: 'Scarico' as const,
            date: w.withdrawalDate.toISOString(),
            description: `Commesse: ${w.jobOrderPFs.join(', ')}`,
            quantity: -((w.consumedWeight) || 0),
            unit: 'KG',
            id: w.id
        }))
    ];

    combinedMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setMaterialMovements(combinedMovements);
};
  
  const handleOpenDetailViewDialog = (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsDetailViewOpen(true);
  };
  
  const handleLocalUpdate = useCallback((updatedMaterial: RawMaterial) => {
    setMaterials(prev => {
        const index = prev.findIndex(m => m.id === updatedMaterial.id);
        if (index > -1) {
            const newMaterials = [...prev];
            newMaterials[index] = updatedMaterial;
            return newMaterials;
        }
        return [...prev, updatedMaterial];
    });
    if (selectedMaterial?.id === updatedMaterial.id) {
        setSelectedMaterial(updatedMaterial);
    }
  }, [selectedMaterial]);


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
            'stock': 'stock',
            'peso (kg)': 'stock', // Use 'stock' as the target for Peso (Kg) as well
            'unita misura': 'unitOfMeasure',
            'fattore conversione': 'conversionFactor',
        };
        
        const mappedJson = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
                const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, ' ');
                const targetKey = headerMapping[normalizedKey];
                if (targetKey && row[key] !== null && row[key] !== undefined && row[key] !== '') {
                  // Prioritize 'stock' if both 'stock' and 'peso (kg)' map to it and are present.
                  if (targetKey === 'stock') {
                    if (normalizedKey === 'stock' || !normalizedRow['stock']) {
                       normalizedRow[targetKey] = row[key];
                    }
                  } else {
                    normalizedRow[targetKey] = row[key];
                  }
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
    const dataToExport = materials.map(m => ({
        'Codice': m.code,
        'Tipo': m.type,
        'Descrizione': m.description,
        'Stock': m.currentStockUnits,
        'Unita Misura': m.unitOfMeasure,
        'Fattore Conversione': m.conversionFactor,
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
      setSelectedRows(filteredMaterials.map(m => m.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };


  return (
      <div className="space-y-6">
        <div className="flex justify-between items-start flex-wrap gap-4">
          <header>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Boxes className="h-8 w-8 text-primary" />
              Gestione Materie Prime
              </h1>
              <p className="text-muted-foreground mt-1">
              Aggiungi, modifica o importa in blocco le materie prime.
              </p>
          </header>
          <div className="flex items-center gap-2 pt-2">
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
              <Button onClick={handleExport} variant="outline" disabled={materials.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Esporta Elenco
            </Button>
            <Button onClick={handleImportClick} variant="outline" disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importa da Excel
            </Button>
            <Button onClick={() => handleOpenEditDialog()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Aggiungi Materiale
            </Button>
          </div>
        </div>

        <Card>
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-4">
                    <div>
                    <CardTitle className="font-headline">Elenco Materie Prime</CardTitle>
                    <CardDescription>Queste sono le materie prime disponibili a magazzino.</CardDescription>
                    </div>
                     <div className="flex items-center gap-2">
                        {selectedRows.length > 0 && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive">
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
                        )}
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cerca per codice o descrizione..."
                                className="pl-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead padding="checkbox">
                          <Checkbox
                            checked={selectedRows.length > 0 ? (selectedRows.length === filteredMaterials.length ? true : 'indeterminate') : false}
                            onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                            aria-label="Seleziona tutte"
                            disabled={filteredMaterials.length === 0}
                          />
                        </TableHead>
                        <TableHead>Codice</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Descrizione</TableHead>
                        <TableHead>Stock Unità</TableHead>
                        <TableHead>Unità Misura</TableHead>
                        <TableHead>Stock (KG)</TableHead>
                        <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {filteredMaterials.length > 0 ? (
                        filteredMaterials.map((material) => (
                        <TableRow key={material.id} data-state={selectedRows.includes(material.id) ? "selected" : undefined}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedRows.includes(material.id)}
                                onCheckedChange={() => handleSelectRow(material.id)}
                                aria-label={`Seleziona materiale ${material.code}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{material.code}</TableCell>
                            <TableCell>{material.type}</TableCell>
                            <TableCell>{material.description}</TableCell>
                            <TableCell>{material.currentStockUnits}</TableCell>
                            <TableCell>{material.unitOfMeasure}</TableCell>
                            <TableCell>{(material.currentWeightKg ?? 0).toFixed(2)}</TableCell>
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
                                        <span>Vedi Dettaglio Stock</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleOpenEditDialog(material)}>
                                        <Edit className="mr-2 h-4 w-4" />
                                        <span>Modifica Dettagli</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleOpenBatchDialog(material)}>
                                        <PackagePlus className="mr-2 h-4 w-4" />
                                        <span>Aggiungi Lotto</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => handleOpenHistoryDialog(material)}>
                                        <History className="mr-2 h-4 w-4" />
                                        <span>Vedi Storico Movimenti</span>
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
                        ))
                    ) : (
                        <TableRow>
                        <TableCell colSpan={8} className="text-center h-24">
                            {materials.length === 0 ? "Nessuna materia prima trovata." : "Nessuna materia prima trovata per la tua ricerca."}
                        </TableCell>
                        </TableRow>
                    )}
                    </TableBody>
                </Table>
                </div>
            </CardContent>
            </Card>

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
                </div>
                
                {watchedUnitOfMeasure !== 'kg' && (
                  <FormField control={form.control} name="conversionFactor" render={({ field }) => ( <FormItem> <FormLabel>Fattore Conversione (es. kg/pz o kg/mt)</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 0.025" {...field} value={field.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )} />
                )}

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
                                  <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
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
                                  {(mov.quantity || 0).toFixed(2)} {mov.unit}
                                </TableCell>
                            </TableRow>
                            ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">Nessuno storico movimenti per questo materiale.</TableCell>
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
                                <p className="text-2xl font-bold">{selectedMaterial.currentStockUnits ?? 0}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background">
                                <Label>Stock Calcolato (KG)</Label>
                                <p className="text-2xl font-bold">{(selectedMaterial.currentWeightKg ?? 0).toFixed(2)}</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-background col-span-2">
                                <Label>Fattore Conversione</Label>
                                <p className="text-2xl font-bold">{selectedMaterial.conversionFactor ?? 'N/A'}</p>
                            </div>
                        </div>
                    </div>
                )}
                 <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDetailViewOpen(false)}>Chiudi</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>
  );
}


