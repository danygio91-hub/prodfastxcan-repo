"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, parse, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import * as XLSX from 'xlsx';

import { type ManualCommitment, type Article } from '@/lib/mock-data';
import { saveManualCommitment, deleteManualCommitment, fulfillManualCommitment, importManualCommitments } from './actions';
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
import { CalendarIcon, Check, ChevronsUpDown, FileCheck2, Loader2, PlusCircle, Trash2, CheckCircle2, Circle, Upload, Download } from 'lucide-react';
import { cn } from '@/lib/utils';


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

export default function CommitmentManagementClientPage({ initialCommitments, initialArticles }: CommitmentManagementClientPageProps) {
  const [commitments, setCommitments] = useState(initialCommitments);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
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
    if (isDialogOpen) {
        const deliveryDate = form.getValues('deliveryDate');
        if (deliveryDate && isValid(deliveryDate)) {
            setDateString(format(deliveryDate, 'dd/MM/yyyy'));
        } else {
            setDateString('');
        }
    }
  }, [isDialogOpen, form]);

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
      setIsDialogOpen(false);
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

  const handleFulfill = async (commitmentId: string) => {
    if (!user) return;
    setIsPending(true);
    const result = await fulfillManualCommitment(commitmentId, user.uid);
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
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                                {c.status === 'pending' && (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild><Button size="sm" disabled={isPending}><FileCheck2 className="mr-2 h-4 w-4"/>Evadi Impegno</Button></AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Confermi l'evasione?</AlertDialogTitle><AlertDialogDescription>Questa azione scalerà i materiali necessari dallo stock a magazzino. L'operazione non è reversibile.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => handleFulfill(c.id)}>Sì, Evadi</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                )}
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><Button size="icon" variant="destructive" disabled={isPending}><Trash2 className="h-4 w-4"/></Button></AlertDialogTrigger>
                                     <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Questa azione eliminerà l'impegno. Se era in attesa, lo stock impegnato verrà liberato.</AlertDialogDescription></AlertDialogHeader>
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
  );
}
