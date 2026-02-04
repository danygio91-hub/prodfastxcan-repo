
"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import * as XLSX from 'xlsx';

import { type ManualCommitment, type Article, type RawMaterial, type RawMaterialBatch } from '@/lib/mock-data';
import { saveManualCommitment, deleteManualCommitment, importManualCommitments, revertManualCommitmentFulfillment, declareCommitmentFulfillment, type LotSelectionPayload, getMaterialsByCodes } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Check, ChevronsUpDown, FileCheck2, Loader2, PlusCircle, Trash2, CheckCircle2, Circle, Upload, Download, Undo2, TestTube, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { formatDisplayStock } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';


interface CommitmentManagementClientPageProps {
  initialCommitments: ManualCommitment[];
  initialArticles: Article[];
}

const commitmentFormSchema = z.object({
  id: z.string().optional(),
  jobOrderCode: z.string().min(1, "Il codice commessa è obbligatorio."),
  articleCode: z.string().min(1, "Selezionare un articolo."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  deliveryDate: z.date({ required_error: "La data di consegna è obbligatoria." }),
});
type CommitmentFormValues = z.infer<typeof commitmentFormSchema>;

const declarationSchema = z.object({
  goodPieces: z.coerce.number().min(0, "La quantità non può essere negativa."),
  scrapPieces: z.coerce.number().min(0, "La quantità non può essere negativa.").default(0),
});
type DeclarationFormValues = z.infer<typeof declarationSchema>;


// Declaration Dialog Component
function DeclarationDialog({ 
    isOpen, 
    onOpenChange, 
    commitment, 
    article,
    onDeclare,
}: { 
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    commitment: ManualCommitment;
    article: Article | undefined;
    onDeclare: (values: DeclarationFormValues, lotSelections: LotSelectionPayload[]) => void;
}) {
    const { toast } = useToast();
    const form = useForm<DeclarationFormValues>({
        resolver: zodResolver(declarationSchema),
        defaultValues: {
            goodPieces: commitment.quantity,
            scrapPieces: 0,
        },
    });
    
    const watchedValues = form.watch();
    
    const [selectedBatchIds, setSelectedBatchIds] = useState<Record<string, Set<string>>>({});
    const [componentMaterials, setComponentMaterials] = useState<RawMaterial[]>([]);
    const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSelectedBatchIds({});
            form.reset({
              goodPieces: commitment.quantity,
              scrapPieces: 0,
            });
            if (article?.billOfMaterials) {
                 const fetchComponentMaterials = async () => {
                    setIsLoadingMaterials(true);
                    const componentCodes = article.billOfMaterials.map(item => item.component);
                    if (componentCodes.length > 0) {
                        const materials = await getMaterialsByCodes(componentCodes);
                        setComponentMaterials(materials);
                    } else {
                        setComponentMaterials([]);
                    }
                    setIsLoadingMaterials(false);
                };
                fetchComponentMaterials();
            }
        }
    }, [isOpen, article, commitment.quantity, form]);
    
    const bomWithConsumption = useMemo(() => {
        if (!article?.billOfMaterials) return [];
        const totalPieces = (Number(watchedValues.goodPieces) || 0) + (Number(watchedValues.scrapPieces) || 0);
        return article.billOfMaterials.map(item => {
            const material = componentMaterials.find(m => m.code === item.component);
            let totalRequired = 0;
            let displayUnit: 'n' | 'mt' | 'kg' = item.unit;
            if (item.lunghezzaTaglioMm && item.lunghezzaTaglioMm > 0 && material?.unitOfMeasure === 'mt') {
                totalRequired = (totalPieces * item.quantity * item.lunghezzaTaglioMm) / 1000;
                displayUnit = 'mt';
            } else {
                totalRequired = totalPieces * item.quantity;
            }
            return { ...item, totalRequired, displayUnit };
        });
    }, [article, watchedValues, componentMaterials]);
    
    const handleLotSelection = useCallback((componentCode: string, batchId: string, isChecked: boolean) => {
        setSelectedBatchIds(prev => {
            const newSelection = { ...prev };
            if (!newSelection[componentCode]) {
                newSelection[componentCode] = new Set();
            }
            
            const newSet = new Set(newSelection[componentCode]);
            if (isChecked) {
                newSet.add(batchId);
            } else {
                newSet.delete(batchId);
            }
            newSelection[componentCode] = newSet;

            return newSelection;
        });
    }, []);

    const lotSelections = useMemo(() => {
        const newLotSelections: Record<string, { batchId: string; lotto: string; consumed: number }[]> = {};
        for (const component of bomWithConsumption) {
            const componentCode = component.component;
            const material = componentMaterials.find(m => m.code === componentCode);
            const ids = selectedBatchIds[componentCode];

            if (!material || !ids || ids.size === 0) {
                newLotSelections[componentCode] = [];
                continue;
            }

            const fifoSelectedBatches = (material.batches || [])
                .filter(b => ids.has(b.id))
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            let remainingRequirement = component.totalRequired;
            const selectionsForComponent: { batchId: string; lotto: string; consumed: number }[] = [];

            for (const batch of fifoSelectedBatches) {
                const consumedFromThisBatch = Math.min(remainingRequirement, batch.netQuantity);
                selectionsForComponent.push({
                    batchId: batch.id,
                    lotto: batch.lotto || 'N/D',
                    consumed: consumedFromThisBatch > 0 ? consumedFromThisBatch : 0,
                });
                remainingRequirement -= consumedFromThisBatch;
                if (remainingRequirement <= 0.001) {
                    remainingRequirement = 0;
                }
            }
            newLotSelections[componentCode] = selectionsForComponent;
        }
        return newLotSelections;
    }, [selectedBatchIds, bomWithConsumption, componentMaterials]);
    
    const consumptionStatus = useMemo(() => {
        const status: Record<string, { required: number, fulfilled: number }> = {};
        bomWithConsumption.forEach(item => {
            const fulfilled = (lotSelections[item.component] || []).reduce((sum, sel) => sum + sel.consumed, 0);
            status[item.component] = { required: item.totalRequired, fulfilled };
        });
        return status;
    }, [bomWithConsumption, lotSelections]);
    
    const isPlanComplete = useMemo(() => {
        if (bomWithConsumption.length === 0) return true;
        return bomWithConsumption.every(item => {
            const status = consumptionStatus[item.component];
            return !status || status.fulfilled >= status.required - 0.001;
        });
    }, [bomWithConsumption, consumptionStatus]);
    
    const handleDeclareSubmit = (values: DeclarationFormValues) => {
        if (!isPlanComplete) {
            toast({ variant: "destructive", title: "Selezione Lotti Incompleta", description: "Selezionare abbastanza lotti per soddisfare il fabbisogno di tutti i componenti." });
            return;
        }
        const selectionsPayload: LotSelectionPayload[] = Object.entries(lotSelections).flatMap(([componentCode, selections]) => {
             const materialId = componentMaterials.find(m => m.code === componentCode)?.id;
             if (!materialId) return [];
             return selections.map(selection => ({
                materialId: materialId,
                componentCode,
                batchId: selection.batchId,
                lotto: selection.lotto,
                consumed: selection.consumed
             }));
        });
        onDeclare(values, selectionsPayload);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Dichiarazione di Produzione</DialogTitle>
                    <DialogDescription>
                        Conferma la quantità prodotta, eventuali scarti e seleziona i lotti da cui scaricare il materiale per la commessa <span className="font-bold">{commitment.jobOrderCode}</span>.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleDeclareSubmit)} className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-4 pt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="goodPieces" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Pezzi Prodotti</FormLabel>
                                        <FormControl><Input type="number" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="scrapPieces" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="flex items-center gap-2"><TestTube className="h-4 w-4 text-destructive"/> Pezzi di Scarto</FormLabel>
                                        <FormControl><Input type="number" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                        </div>
                        <ScrollArea className="flex-1 px-4 py-4">
                        {isLoadingMaterials ? (
                             <div className="space-y-4">
                                <Skeleton className="h-24 w-full" />
                                <Skeleton className="h-24 w-full" />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <Label>Selezione Lotti per Scarico</Label>
                                {bomWithConsumption.map(item => {
                                    const material = componentMaterials.find(m => m.code === item.component);
                                    const availableBatches = (material?.batches || []).filter(b => b.netQuantity > 0).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                                    const status = consumptionStatus[item.component];
                                    const componentIsSelected = (selectedBatchIds[item.component] || new Set()).size > 0;

                                    return (
                                        <div key={item.component} className="p-4 border rounded-lg">
                                            <div className="flex justify-between items-center">
                                                <h4 className="font-semibold">{item.component}</h4>
                                                <div className="text-right">
                                                    <p className="text-sm">Fabbisogno: {formatDisplayStock(status.required, item.displayUnit)} {item.displayUnit}</p>
                                                    <p className={cn("text-sm", status.fulfilled < status.required ? 'text-destructive' : 'text-green-600')}>Selezionato: {formatDisplayStock(status.fulfilled, item.displayUnit)} {item.displayUnit}</p>
                                                </div>
                                            </div>
                                            <div className="max-h-48 overflow-y-auto mt-2">
                                              <Table>
                                                  <TableHeader>
                                                      <TableRow>
                                                          <TableHead className="w-[50px]"></TableHead>
                                                          <TableHead>Lotto</TableHead>
                                                          <TableHead>Disponibile</TableHead>
                                                          <TableHead>Da Usare</TableHead>
                                                      </TableRow>
                                                  </TableHeader>
                                                  <TableBody>
                                                      {availableBatches.length > 0 ? availableBatches.map(batch => (
                                                          <TableRow key={batch.id}>
                                                              <TableCell>
                                                                  <Checkbox
                                                                      checked={(selectedBatchIds[item.component] || new Set()).has(batch.id)}
                                                                      onCheckedChange={(checked) => handleLotSelection(item.component, batch, !!checked)}
                                                                  />
                                                              </TableCell>
                                                              <TableCell>{batch.lotto || "N/D"}</TableCell>
                                                              <TableCell>{formatDisplayStock(batch.netQuantity, item.displayUnit)} {item.displayUnit}</TableCell>
                                                              <TableCell className="font-semibold text-primary">
                                                              {formatDisplayStock((lotSelections[item.component] || []).find(s => s.batchId === batch.id)?.consumed || 0, item.displayUnit)} {item.displayUnit}
                                                              </TableCell>
                                                          </TableRow>
                                                      )) : (
                                                          <TableRow><TableCell colSpan={4} className="text-center h-16">Nessun lotto con stock disponibile.</TableCell></TableRow>
                                                      )}
                                                  </TableBody>
                                              </Table>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        </ScrollArea>
                        <DialogFooter className="p-4 border-t sticky bottom-0 bg-background">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
                            <Button type="submit" disabled={form.formState.isSubmitting || !isPlanComplete || isLoadingMaterials}>
                                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                Dichiara e Scarica Stock
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export default function CommitmentManagementClientPage({
  initialCommitments,
  initialArticles,
}: CommitmentManagementClientPageProps) {
  const [commitments, setCommitments] = useState(initialCommitments);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [declarationTarget, setDeclarationTarget] = useState<ManualCommitment | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const [dateString, setDateString] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const form = useForm<CommitmentFormValues>({
    resolver: zodResolver(commitmentFormSchema),
  });
  
  useEffect(() => {
    setCommitments(initialCommitments);
  }, [initialCommitments]);
  
  useEffect(() => {
    if (isFormOpen) {
        const deliveryDate = form.getValues('deliveryDate');
        if (deliveryDate && isValid(deliveryDate)) {
            setDateString(format(deliveryDate, 'dd/MM/yyyy'));
        } else {
            setDateString('');
        }
    }
  }, [isFormOpen, form]);

  const onSubmit = async (values: CommitmentFormValues) => {
    if (!user) return;
    setIsPending(true);
    const result = await saveManualCommitment(values, user.uid);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      router.refresh(); 
      setIsFormOpen(false);
      form.reset();
    }
    setIsPending(false);
  };
  
  const handleDelete = async (commitmentId: string) => {
    setIsPending(true);
    const result = await deleteManualCommitment(commitmentId);
     toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      router.refresh();
    }
    setIsPending(false);
  };

  const handleDeclare = async (values: DeclarationFormValues, lotSelections: LotSelectionPayload[]) => {
    if (!user || !declarationTarget) return;
    setIsPending(true);

    const result = await declareCommitmentFulfillment(
      declarationTarget.id,
      values.goodPieces,
      values.scrapPieces,
      lotSelections,
      user.uid
    );
    
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
      duration: 9000
    });

    if (result.success) {
      router.refresh();
      setDeclarationTarget(null);
    }
    setIsPending(false);
  };
  
  const handleRevertFulfillment = async (commitmentId: string) => {
    if (!user) return;
    setIsPending(true);
    const result = await revertManualCommitmentFulfillment(commitmentId, user.uid);
    toast({
        title: result.success ? "Operazione Annullata" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
        router.refresh();
    }
    setIsPending(false);
  };
  
  const handleDownloadTemplate = () => {
    const templateData = [
      { 
        "Commessa": "COMM-001/24",
        "Codice Articolo": "ART-001",
        "Quantita": 100,
        "Data Consegna": "25/07/2024",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Impegni Manuali");
    XLSX.writeFile(wb, "template_impegni_manuali.xlsx");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsImporting(true);
    toast({ title: 'Importazione in corso...', description: 'Lettura e validazione del file Excel in corso.' });

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet);
        
        if (json.length === 0) {
            toast({ variant: 'destructive', title: "File Vuoto", description: "Il file non contiene righe da importare." });
            setIsImporting(false);
            return;
        }

        const result = await importManualCommitments(json, user.uid);
        
        toast({
            title: result.success ? "Importazione Completata" : "Errore di Importazione",
            description: result.message,
            variant: result.success ? "default" : "destructive",
            duration: 9000,
        });
        
        if (result.success) {
            router.refresh();
        }

    } catch (error) {
        toast({
            variant: "destructive",
            title: "Errore Importazione",
            description: error instanceof Error ? error.message : "Impossibile leggere o processare il file.",
        });
    } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
              <CardTitle className="font-headline">Impegni Manuali su Commessa</CardTitle>
              <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
                  <Button onClick={handleDownloadTemplate} variant="outline" size="sm">
                      <Download className="mr-2 h-4 w-4" />
                      Scarica Template
                  </Button>
                  <Button onClick={handleImportClick} variant="outline" size="sm" disabled={isImporting}>
                      {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
                      Carica da File
                  </Button>
                  <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                      <DialogTrigger asChild>
                          <Button><PlusCircle className="mr-2 h-4 w-4" /> Aggiungi Impegno</Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-xl">
                          <DialogHeader>
                              <DialogTitle>Aggiungi Nuovo Impegno Manuale</DialogTitle>
                              <DialogDescription>
                                  Inserisci i dettagli per creare un nuovo impegno di materiale su una commessa.
                              </DialogDescription>
                          </DialogHeader>
                          <Form {...form}>
                              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                                  <FormField control={form.control} name="jobOrderCode" render={({ field }) => ( <FormItem> <FormLabel>Commessa di Riferimento</FormLabel> <FormControl><Input placeholder="Es. Comm-1234/24" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                  <FormField control={form.control} name="articleCode" render={({ field }) => (
                                      <FormItem className="flex flex-col">
                                      <FormLabel>Codice Articolo</FormLabel>
                                      <Popover><PopoverTrigger asChild><FormControl>
                                          <Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")}>
                                              {field.value ? initialArticles.find(a => a.code === field.value)?.code : "Seleziona articolo..."}
                                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                          </Button>
                                      </FormControl></PopoverTrigger>
                                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command>
                                          <CommandInput placeholder="Cerca articolo..." />
                                          <CommandEmpty>Nessun articolo trovato.</CommandEmpty>
                                          <CommandGroup>
                                              {initialArticles.map((article) => (
                                              <CommandItem value={article.code} key={article.id} onSelect={() => { form.setValue("articleCode", article.code); }}>
                                                  <Check className={cn("mr-2 h-4 w-4", article.code === field.value ? "opacity-100" : "opacity-0")} />
                                                  {article.code}
                                              </CommandItem>
                                              ))}
                                          </CommandGroup>
                                      </Command></PopoverContent></Popover>
                                      <FormMessage />
                                      </FormItem>
                                  )} />
                                  <FormField control={form.control} name="quantity" render={({ field }) => ( <FormItem> <FormLabel>Quantità da Produrre</FormLabel> <FormControl><Input type="number" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                  <FormField
                                    control={form.control}
                                    name="deliveryDate"
                                    render={({ field }) => (
                                      <FormItem className="flex flex-col">
                                        <FormLabel>Data Consegna Prevista</FormLabel>
                                        <Popover>
                                          <div className="relative flex items-center">
                                            <FormControl>
                                              <Input
                                                placeholder="gg/mm/aaaa"
                                                value={dateString}
                                                onChange={(e) => {
                                                  const value = e.target.value;
                                                  setDateString(value);
                                                  const parsedDate = parse(value, 'dd/MM/yyyy', new Date());
                                                  if (isValid(parsedDate)) {
                                                    field.onChange(parsedDate);
                                                  } else {
                                                    field.onChange(undefined);
                                                  }
                                                }}
                                              />
                                            </FormControl>
                                            <PopoverTrigger asChild>
                                              <Button
                                                variant={"ghost"}
                                                className="absolute right-1 h-8 w-8 p-0"
                                                aria-label="Apri calendario"
                                              >
                                                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                                              </Button>
                                            </PopoverTrigger>
                                          </div>
                                          <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                              mode="single"
                                              selected={field.value}
                                              onSelect={(date) => {
                                                field.onChange(date);
                                                if (date && isValid(date)) {
                                                  setDateString(format(date, 'dd/MM/yyyy'));
                                                } else {
                                                  setDateString('');
                                                }
                                              }}
                                              initialFocus
                                            />
                                          </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                   <DialogFooter>
                                      <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>Annulla</Button></DialogClose>
                                      <Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null} Salva Impegno</Button>
                                  </DialogFooter>
                              </form>
                          </Form>
                      </DialogContent>
                  </Dialog>
              </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
              <Table>
                  <TableHeader><TableRow>
                      <TableHead>Stato</TableHead><TableHead>Commessa</TableHead><TableHead>Articolo</TableHead>
                      <TableHead>Quantità</TableHead><TableHead>Data Consegna</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                      {commitments.length > 0 ? commitments.map(c => (
                          <TableRow key={c.id}>
                              <TableCell>
                                  <Badge variant={c.status === 'fulfilled' ? 'default' : 'secondary'}>
                                  {c.status === 'fulfilled' ? <CheckCircle2 className="mr-2 h-4 w-4"/> : <Circle className="mr-2 h-4 w-4" />}
                                  {c.status === 'fulfilled' ? 'Evaso' : 'In Attesa'}
                                  </Badge>
                              </TableCell>
                              <TableCell>{c.jobOrderCode}</TableCell><TableCell>{c.articleCode}</TableCell>
                              <TableCell>{c.quantity}</TableCell>
                              <TableCell>{format(parseISO(c.deliveryDate as any), "dd/MM/yyyy")}</TableCell>
                              <TableCell className="text-right space-x-2">
                                  {c.status === 'pending' ? (
                                    <Button size="sm" disabled={isPending} onClick={() => setDeclarationTarget(c)}>
                                        <FileCheck2 className="mr-2 h-4 w-4"/>Dichiara
                                    </Button>
                                  ) : (
                                      <AlertDialog>
                                          <AlertDialogTrigger asChild><Button size="sm" variant="secondary" disabled={isPending}><Undo2 className="mr-2 h-4 w-4"/>Annulla Evasione</Button></AlertDialogTrigger>
                                          <AlertDialogContent>
                                              <AlertDialogHeader><AlertDialogTitle>Annullare l'evasione?</AlertDialogTitle><AlertDialogDescription>Questa azione riporterà l'impegno allo stato 'In Attesa' e ripristinerà lo stock dei materiali precedentemente scaricati (inclusi gli scarti). Sei sicuro?</AlertDialogDescription></AlertDialogHeader>
                                              <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => handleRevertFulfillment(c.id)}>Sì, Annulla Evasione</AlertDialogAction></AlertDialogFooter>
                                          </AlertDialogContent>
                                      </AlertDialog>
                                  )}
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild><Button size="icon" variant="destructive" disabled={isPending}><Trash2 className="h-4 w-4"/></Button></AlertDialogTrigger>
                                       <AlertDialogContent>
                                          <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Questa azione eliminerà l'impegno. Se è stato evaso, lo stock NON verrà ripristinato. Per ripristinare lo stock, usa "Annulla Evasione".</AlertDialogDescription></AlertDialogHeader>
                                          <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(c.id)}>Sì, Elimina</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                              </TableCell>
                          </TableRow>
                      )) : (
                          <TableRow><TableCell colSpan={6} className="h-24 text-center">Nessun impegno manuale trovato.</TableCell></TableRow>
                      )}
                  </TableBody>
              </Table>
          </div>
        </CardContent>
      </Card>

       {declarationTarget && (
        <DeclarationDialog
            isOpen={!!declarationTarget}
            onOpenChange={(open) => !open && setDeclarationTarget(null)}
            commitment={declarationTarget}
            article={initialArticles.find(a => a.code === declarationTarget.articleCode)}
            onDeclare={handleDeclare}
        />
       )}
    </>
  );
}
