"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import * as XLSX from 'xlsx';

import { type ManualCommitment, type Article, type RawMaterial } from '@/lib/mock-data';
import { saveManualCommitment, deleteManualCommitment, importManualCommitments, revertManualCommitmentFulfillment, declareCommitmentFulfillment } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Check, ChevronsUpDown, FileCheck2, Loader2, PlusCircle, Trash2, CheckCircle2, Circle, Upload, Download, Undo2, TestTube, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';


interface CommitmentManagementClientPageProps {
  initialCommitments: ManualCommitment[];
  initialArticles: Article[];
  allRawMaterials: RawMaterial[];
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
    allRawMaterials,
    onDeclare,
}: { 
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    commitment: ManualCommitment;
    article: Article | undefined;
    allRawMaterials: RawMaterial[];
    onDeclare: (values: DeclarationFormValues) => void;
}) {
    const form = useForm<DeclarationFormValues>({
        resolver: zodResolver(declarationSchema),
        defaultValues: {
            goodPieces: commitment.quantity,
            scrapPieces: 0,
        },
    });
    
    const watchedValues = form.watch();

    const bomWithConsumption = React.useMemo(() => {
        if (!article?.billOfMaterials) return [];
        
        const totalPieces = (watchedValues.goodPieces || 0) + (watchedValues.scrapPieces || 0);

        return article.billOfMaterials.map(item => {
            const material = allRawMaterials.find(m => m.code === item.component);
            let totalRequired = 0;
            let displayUnit = item.unit;
            
            if (item.lunghezzaTaglioMm && item.lunghezzaTaglioMm > 0) {
                totalRequired = (totalPieces * item.quantity * item.lunghezzaTaglioMm) / 1000;
                displayUnit = 'mt';
            } else {
                totalRequired = totalPieces * item.quantity;
            }

            return {
                ...item,
                totalRequired,
                displayUnit,
            };
        });
    }, [article, watchedValues, allRawMaterials]);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Dichiarazione di Produzione</DialogTitle>
                    <DialogDescription>
                        Conferma la quantità prodotta ed eventuali scarti per la commessa <span className="font-bold">{commitment.jobOrderCode}</span>.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onDeclare)} className="space-y-4 py-4">
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

                         <div className="space-y-2">
                            <Label>Consumo Materiali Stimato</Label>
                            <div className="p-2 border rounded-md max-h-40 overflow-y-auto">
                                {bomWithConsumption.length > 0 ? (
                                    bomWithConsumption.map(item => (
                                        <div key={item.component} className="flex justify-between items-center text-sm p-1">
                                            <span className="font-semibold">{item.component}:</span>
                                            <span className="font-mono">{item.totalRequired.toFixed(2)} {item.displayUnit}</span>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-muted-foreground text-center">Nessuna distinta base trovata per calcolare il consumo.</p>
                                )}
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
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

export default function CommitmentManagementClientPage({ initialCommitments, initialArticles, allRawMaterials }: CommitmentManagementClientPageProps) {
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

  const handleDeclare = async (values: DeclarationFormValues) => {
    if (!user || !declarationTarget) return;
    setIsPending(true);

    const result = await declareCommitmentFulfillment(
      declarationTarget.id,
      values.goodPieces,
      values.scrapPieces,
      user.uid
    );
    
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
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
            allRawMaterials={allRawMaterials}
            onDeclare={handleDeclare}
        />
       )}
    </>
  );
}
