"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

import { type RawMaterial } from '@/lib/mock-data';
import { getRawMaterials, saveRawMaterial, deleteRawMaterial, commitImportedRawMaterials } from './actions';

import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { Boxes, PlusCircle, Edit, Trash2, Upload, Download, Loader2 } from 'lucide-react';

const rawMaterialFormSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3, 'Il codice deve avere almeno 3 caratteri.'),
  type: z.enum(['BOB', 'TUBI']),
  description: z.string().min(5, 'La descrizione è obbligatoria.'),
  sezione: z.string().optional(),
  filo_el: z.string().optional(),
  larghezza: z.string().optional(),
  tipologia: z.string().optional(),
  currentStockPcs: z.coerce.number().min(0, 'Lo stock non può essere negativo.').default(0),
  currentWeightKg: z.coerce.number().min(0, 'Il peso non può essere negativo.').default(0),
});

type RawMaterialFormValues = z.infer<typeof rawMaterialFormSchema>;

export default function AdminRawMaterialManagementPage() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<RawMaterialFormValues>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: { id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", currentStockPcs: 0, currentWeightKg: 0 },
  });

  const fetchMaterials = async () => {
    const data = await getRawMaterials();
    setMaterials(data);
  };

  useEffect(() => {
    fetchMaterials();
  }, []);

  const handleOpenDialog = (material: RawMaterial | null = null) => {
    setEditingMaterial(material);
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
        currentStockPcs: material.currentStockPcs,
        currentWeightKg: material.currentWeightKg,
      });
    } else {
      form.reset({ id: undefined, code: "", type: 'BOB', description: "", sezione: "", filo_el: "", larghezza: "", tipologia: "", currentStockPcs: 0, currentWeightKg: 0 });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
    form.reset();
  }

  const onSubmit = async (values: RawMaterialFormValues) => {
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
      await fetchMaterials();
      handleCloseDialog();
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteRawMaterial(id);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) await fetchMaterials();
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
          'code': 'code',
          'type': 'type',
          'description': 'description',
          'sezione': 'sezione',
          'filo_el': 'filo_el',
          'larghezza': 'larghezza',
          'tipologia': 'tipologia',
          'stock_pcs': 'currentStockPcs',
          'weight_kg': 'currentWeightKg',
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
              <Button onClick={() => handleOpenDialog()}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Aggiungi Manualmente
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Materie Prime</CardTitle>
              <CardDescription>Queste sono le materie prime disponibili a magazzino.</CardDescription>
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
                          <TableCell>{material.currentWeightKg}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleOpenDialog(material)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Questa azione non può essere annullata. La materia prima verrà eliminata.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(material.id)}>Continua</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
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

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{editingMaterial ? "Modifica Materia Prima" : "Aggiungi Nuova Materia Prima"}</DialogTitle>
              <DialogDescription>
                Compila i campi per {editingMaterial ? "modificare la materia prima." : "aggiungere una nuova materia prima."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-6">
                <FormField control={form.control} name="code" render={({ field }) => ( <FormItem> <FormLabel>Codice *</FormLabel> <FormControl><Input placeholder="Es. BOB-12345" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                <FormField control={form.control} name="type" render={({ field }) => ( <FormItem> <FormLabel>Tipo *</FormLabel> <Select onValueChange={field.onChange} value={field.value}> <FormControl> <SelectTrigger> <SelectValue placeholder="Seleziona un tipo" /> </SelectTrigger> </FormControl> <SelectContent> <SelectItem value="BOB">BOB</SelectItem> <SelectItem value="TUBI">TUBI</SelectItem> </SelectContent> </Select> <FormMessage /> </FormItem> )} />
                <FormField control={form.control} name="description" render={({ field }) => ( <FormItem> <FormLabel>Descrizione *</FormLabel> <FormControl><Textarea placeholder="Descrizione dettagliata del materiale" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                
                <h4 className="text-sm font-medium pt-2">Dettagli (opzionale)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="sezione" render={({ field }) => ( <FormItem> <FormLabel>Sezione</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="filo_el" render={({ field }) => ( <FormItem> <FormLabel>Filo El.</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="larghezza" render={({ field }) => ( <FormItem> <FormLabel>Larghezza</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                  <FormField control={form.control} name="tipologia" render={({ field }) => ( <FormItem> <FormLabel>Tipologia</FormLabel> <FormControl><Input {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                </div>
                
                <h4 className="text-sm font-medium pt-2">Giacenza</h4>
                 <div className="grid grid-cols-2 gap-4">
                   <FormField control={form.control} name="currentStockPcs" render={({ field }) => ( <FormItem> <FormLabel>Stock Iniziale (Pz)</FormLabel> <FormControl><Input type="number" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                   <FormField control={form.control} name="currentWeightKg" render={({ field }) => ( <FormItem> <FormLabel>Peso Iniziale (Kg)</FormLabel> <FormControl><Input type="number" step="0.01" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                 </div>

                <DialogFooter className="pt-4 sticky bottom-0 bg-background/95">
                  <Button type="button" variant="outline" onClick={handleCloseDialog}>Annulla</Button>
                  <Button type="submit">{editingMaterial ? "Salva Modifiche" : "Aggiungi Materia Prima"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminAuthGuard>
  );
}
