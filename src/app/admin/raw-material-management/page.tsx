
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

import { type RawMaterial, type RawMaterialBatch } from '@/lib/mock-data';
import { getRawMaterials, saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials, addBatchToRawMaterial } from './actions';

import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Boxes, PlusCircle, Edit, Trash2, Upload, Download, Loader2, MoreVertical, History, PackagePlus } from 'lucide-react';

const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.enum(['BOB', 'TUBI']),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  sezione: z.string().optional(),
  filo_el: z.string().optional(),
  larghezza: z.string().optional(),
  tipologia: z.string().optional(),
});

type RawMaterialFormValues = z.infer<typeof rawMaterialFormSchema>;

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantityPcs: z.coerce.number().min(0, "La quantità non può essere negativa."),
  weightKg: z.coerce.number().min(0, "Il peso non può essere negativo."),
});

type BatchFormValues = z.infer<typeof batchFormSchema>;

export default function AdminRawMaterialManagementPage() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddBatchDialogOpen, setIsAddBatchDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<RawMaterialFormValues>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "" },
  });

  const batchForm = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: { materialId: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', quantityPcs: 0, weightKg: 0 },
  });

  const fetchMaterials = useCallback(async () => {
    const data = await getRawMaterials();
    setMaterials(data);
  }, []);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

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
      });
    } else {
      form.reset({ id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "" });
    }
    setIsEditDialogOpen(true);
  };

  const handleOpenAddBatchDialog = (material: RawMaterial) => {
    setSelectedMaterial(material);
    batchForm.reset({ materialId: material.id, date: format(new Date(), 'yyyy-MM-dd'), ddt: '', quantityPcs: 0, weightKg: 0 });
    setIsAddBatchDialogOpen(true);
  };

  const handleOpenHistoryDialog = (material: RawMaterial) => {
    setSelectedMaterial(material);
    setIsHistoryDialogOpen(true);
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
      fetchMaterials();
      setIsEditDialogOpen(false);
    }
  };

  const onAddBatchSubmit = async (values: BatchFormValues) => {
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
        formData.append(key, String(value));
    });
    const result = await addBatchToRawMaterial(formData);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
     if (result.success) {
      fetchMaterials();
      setIsAddBatchDialogOpen(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteRawMaterial(id);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) fetchMaterials();
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
          'code': 'code', 'type': 'type', 'description': 'description',
          'sezione': 'sezione', 'filo_el': 'filo_el', 'larghezza': 'larghezza', 'tipologia': 'tipologia',
          'stock_pcs': 'stock_pcs', 'weight_kg': 'weight_kg',
        };
        
        const mappedJson = filteredData.map((row: any) => {
            const normalizedRow: { [key: string]: any } = {};
            for (const key in row) {
                const normalizedKey = key.trim().toLowerCase();
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
            fetchMaterials();
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
        'Stock (Pz)': m.currentStockPcs,
        'Peso (Kg)': m.currentWeightKg,
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


  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />
          <div className="flex justify-between items-center flex-wrap gap-4">
            <header>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Boxes className="h-8 w-8 text-primary" />
                Gestione Materie Prime
                </h1>
                <p className="text-muted-foreground mt-2">
                Aggiungi, modifica o importa in blocco le materie prime.
                </p>
            </header>
            <div className="flex items-center gap-2">
               <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
               <Button onClick={handleExport} variant="outline" disabled={materials.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Esporta Elenco
              </Button>
               <Button asChild variant="outline">
                <a href="/template_import_materie_prime.xlsx" download>
                  <Download className="mr-2 h-4 w-4" />
                  Scarica Template
                </a>
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
              <CardTitle>Elenco Materie Prime</CardTitle>
              <CardDescription>Queste sono le materie prime disponibili a magazzino, con stock totale calcolato dai lotti ricevuti.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codice</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Stock (Pz)</TableHead>
                      <TableHead>Peso (Kg)</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materials.length > 0 ? (
                      materials.map((material) => (
                        <TableRow key={material.id}>
                          <TableCell className="font-medium">{material.code}</TableCell>
                          <TableCell>{material.type}</TableCell>
                          <TableCell>{material.description}</TableCell>
                          <TableCell>{material.currentStockPcs}</TableCell>
                          <TableCell>{material.currentWeightKg.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreVertical className="h-4 w-4" />
                                    <span className="sr-only">Apri menu</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => handleOpenEditDialog(material)}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    <span>Modifica Dettagli</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => handleOpenAddBatchDialog(material)}>
                                    <PackagePlus className="mr-2 h-4 w-4" />
                                    <span>Aggiungi Lotto</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => handleOpenHistoryDialog(material)}>
                                    <History className="mr-2 h-4 w-4" />
                                    <span>Vedi Storico</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          <span>Elimina</span>
                                      </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                     <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Questa azione non può essere annullata. La materia prima e tutto il suo storico verranno eliminati.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDelete(material.id)}>Continua</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </DropdownMenuContent>
                              </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center h-24">Nessuna materia prima trovata.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

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
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => ( <FormItem> <FormLabel>Descrizione *</FormLabel> <FormControl><Textarea placeholder="Descrizione dettagliata del materiale" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
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

        {/* Add Batch Dialog */}
        <Dialog open={isAddBatchDialogOpen} onOpenChange={setIsAddBatchDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Aggiungi Lotto per: {selectedMaterial?.code}</DialogTitle>
                    <DialogDescription>
                        Registra un nuovo lotto di merce in entrata per questa materia prima.
                    </DialogDescription>
                </DialogHeader>
                <Form {...batchForm}>
                    <form onSubmit={batchForm.handleSubmit(onAddBatchSubmit)} className="space-y-4 py-4">
                        <FormField control={batchForm.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data Ricezione</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        <FormField control={batchForm.control} name="ddt" render={({ field }) => ( <FormItem> <FormLabel>Documento di Trasporto (DDT)</FormLabel> <FormControl><Input placeholder="Numero DDT" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        <div className="grid grid-cols-2 gap-4">
                            <FormField control={batchForm.control} name="quantityPcs" render={({ field }) => ( <FormItem> <FormLabel>Quantità (Pz)</FormLabel> <FormControl><Input type="number" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                            <FormField control={batchForm.control} name="weightKg" render={({ field }) => ( <FormItem> <FormLabel>Peso (Kg)</FormLabel> <FormControl><Input type="number" step="0.01" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsAddBatchDialogOpen(false)}>Annulla</Button>
                            <Button type="submit">Aggiungi Lotto</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>

         {/* View History Dialog */}
        <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Storico Lotti per: {selectedMaterial?.code}</DialogTitle>
                    <DialogDescription>
                        Elenco di tutti i lotti di merce ricevuti per questa materia prima.
                    </DialogDescription>
                </DialogHeader>
                 <ScrollArea className="max-h-[60vh]">
                     <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>DDT</TableHead>
                          <TableHead>Quantità (Pz)</TableHead>
                          <TableHead>Peso (Kg)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedMaterial?.batches && selectedMaterial.batches.length > 0 ? (
                           selectedMaterial.batches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(batch => (
                            <TableRow key={batch.id}>
                                <TableCell>{format(parseISO(batch.date), 'dd/MM/yyyy', { locale: it })}</TableCell>
                                <TableCell>{batch.ddt}</TableCell>
                                <TableCell>{batch.quantityPcs}</TableCell>
                                <TableCell>{batch.weightKg.toFixed(2)}</TableCell>
                            </TableRow>
                           ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center">Nessuno storico lotti per questo materiale.</TableCell>
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

      </AppShell>
    </AdminAuthGuard>
  );
}
