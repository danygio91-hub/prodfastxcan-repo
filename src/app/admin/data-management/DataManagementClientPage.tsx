
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ListChecks, Upload, Loader2, Download, Trash2, Briefcase, PlayCircle, Search, XCircle, FileDown, PlusCircle, Check, ChevronsUpDown, Factory, ArrowUpDown, Calendar as CalendarIcon } from 'lucide-react';
import { type JobOrder, type WorkCycle, type Article, type Department, type RawMaterial } from '@/lib/mock-data';
import { format, parseISO, isValid } from 'date-fns';
import { useToast } from "@/hooks/use-toast";
import { processAndValidateImport, commitImportedJobOrders, deleteSelectedJobOrders, createODL, createMultipleODLs, cancelODL, updateJobOrderCycle, getPlannedJobOrders, getProductionJobOrders, getWorkCycles, getArticles, getDepartments, saveManualJobOrder, markJobAsPrinted, updateJobOrderDeliveryDate } from './actions';
import { getRawMaterials } from '@/app/admin/raw-material-management/actions';
import { useRouter } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { Calendar } from '@/components/ui/calendar';

const manualCreateSchema = z.object({
    cliente: z.string().min(1, "Il cliente è obbligatorio."),
    ordinePF: z.string().min(1, "L'Ordine PF è obbligatorio."),
    articleCode: z.string().min(1, "L'articolo è obbligatorio."),
    qta: z.coerce.number().positive("La quantità deve essere positiva."),
    dataConsegnaFinale: z.string().min(1, "La data di consegna è obbligatoria."),
    department: z.string().min(1, "Il reparto è obbligatorio."),
    workCycleId: z.string().min(1, "Il ciclo di lavoro è obbligatorio."),
    numeroODLInterno: z.string().optional(),
});
type ManualCreateValues = z.infer<typeof manualCreateSchema>;

type SortConfig = {
  key: keyof JobOrder | 'reparto_codice';
  direction: 'asc' | 'desc';
} | null;

export default function DataManagementClientPage() {
  const [plannedJobOrders, setPlannedJobOrders] = useState<JobOrder[]>([]);
  const [productionJobOrders, setProductionJobOrders] = useState<JobOrder[]>([]);
  const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<{
      newJobs: JobOrder[];
      jobsToUpdate: JobOrder[];
      blockedJobs: Array<{ row: any; reason: string }>;
  } | null>(null);
  
  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);
  const [isArticlePopoverOpen, setIsArticlePopoverOpen] = useState(false);
  
  const [plannedSearchTerm, setPlannedSearchTerm] = useState('');
  const [productionSearchTerm, setProductionSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const [isDownloadingPdf, setIsDownloadingPdf] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<{ job: JobOrder, article: Article | null, materials: RawMaterial[], printDate: Date } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  const manualForm = useForm<ManualCreateValues>({ 
    resolver: zodResolver(manualCreateSchema),
    defaultValues: { qta: 1, department: '' }
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [planned, production, cycles, artList, depts, materials] = await Promise.all([
        getPlannedJobOrders(), 
        getProductionJobOrders(), 
        getWorkCycles(),
        getArticles(),
        getDepartments(),
        getRawMaterials()
      ]);
      setPlannedJobOrders(planned);
      setProductionJobOrders(production);
      setWorkCycles(cycles);
      setArticles(artList);
      setDepartments(depts);
      setRawMaterials(materials);
    } catch (error) {
      toast({ variant: "destructive", title: "Errore nel Caricamento", description: "Impossibile caricare i dati." });
    } finally { setIsLoading(false); }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (key: keyof JobOrder | 'reparto_codice') => {
    setSortConfig(current => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const processData = (data: JobOrder[], search: string) => {
    let filtered = data;
    if (search) {
      const l = search.toLowerCase();
      filtered = data.filter(j => 
          j.ordinePF.toLowerCase().includes(l) || 
          j.details.toLowerCase().includes(l) || 
          (j.numeroODLInterno || '').toLowerCase().includes(l)
      );
    }

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        let aVal: any;
        let bVal: any;

        if (sortConfig.key === 'reparto_codice') {
          aVal = departments.find(d => d.name === a.department || d.code === a.department)?.code || a.department;
          bVal = departments.find(d => d.name === b.department || d.code === b.department)?.code || b.department;
        } else {
          aVal = a[sortConfig.key as keyof JobOrder];
          bVal = b[sortConfig.key as keyof JobOrder];
        }

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const result = aVal < bVal ? -1 : 1;
        return sortConfig.direction === 'asc' ? result : -result;
      });
    }

    return filtered;
  };

  const filteredPlanned = useMemo(() => processData(plannedJobOrders, plannedSearchTerm), [plannedJobOrders, plannedSearchTerm, sortConfig, departments]);
  const filteredProduction = useMemo(() => processData(productionJobOrders, productionSearchTerm), [productionJobOrders, productionSearchTerm, sortConfig, departments]);

  const handleDownloadPdf = async (job: JobOrder) => {
    setIsDownloadingPdf(job.id);
    try {
        const article = articles.find(a => a.code.toUpperCase() === job.details.toUpperCase()) || null;
        setPdfData({ job, article, materials: rawMaterials, printDate: new Date() });

        await new Promise(r => setTimeout(r, 1000));

        const container = document.getElementById('odl-pdf-pages');
        if (!container) throw new Error("Template non trovato.");

        const pageElements = container.querySelectorAll('.odl-page');
        if (pageElements.length === 0) throw new Error("Nessuna pagina generata.");

        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4',
            compress: true
        });

        for (let i = 0; i < pageElements.length; i++) {
            const page = pageElements[i] as HTMLElement;
            const canvas = await html2canvas(page, { 
                scale: 3, 
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff'
            });
            
            const imgData = canvas.toDataURL('image/png', 1.0);
            if (i > 0) pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
        }

        pdf.save(`ODL_${job.ordinePF.replace(/\//g, '_')}.pdf`);
        await markJobAsPrinted(job.id);
        fetchData();
        toast({ title: "PDF Scaricato" });
    } catch (error) {
        console.error("PDF Error:", error);
        toast({ variant: "destructive", title: "Errore Download" });
    } finally {
        setIsDownloadingPdf(null);
        setPdfData(null);
    }
  };

  const handleUpdateDeliveryDate = async (jobId: string, newDate: string) => {
      const res = await updateJobOrderDeliveryDate(jobId, newDate);
      if (res.success) {
          toast({ title: "Data aggiornata" });
          fetchData();
      } else {
          toast({ variant: "destructive", title: "Errore", description: res.message });
      }
  };

  const handleManualSubmit = async (values: ManualCreateValues) => {
    const result = await saveManualJobOrder(values);
    if (result.success) {
        toast({ title: "Successo", description: result.message });
        setIsManualCreateOpen(false);
        manualForm.reset();
        fetchData();
    } else {
        toast({ variant: "destructive", title: "Errore", description: result.message });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: true });
      
      const mapped = json.map((row: any) => {
          const r: any = {};
          const map: any = { 'cliente': 'cliente', 'ordine pf': 'ordinePF', 'ordine nr est': 'numeroODL', 'n° odl': 'numeroODLInternoImport', 'codice': 'details', 'qta': 'qta', 'data consegna': 'dataConsegnaFinale', 'reparto': 'department', 'ciclo': 'workCycleName' };
          Object.keys(row).forEach(k => { if(map[k.trim().toLowerCase()]) r[map[k.trim().toLowerCase()]] = row[k]; });
          if (r.dataConsegnaFinale && typeof r.dataConsegnaFinale === 'number') {
              const epoch = new Date(Date.UTC(1899, 11, 30));
              r.dataConsegnaFinale = format(new Date(epoch.getTime() + r.dataConsegnaFinale * 86400 * 1000), 'yyyy-MM-dd');
          }
          return r;
      }).filter(r => r.ordinePF);

      const result = await processAndValidateImport(mapped);
      setImportReport(result);
    } catch (e) {
      toast({ variant: "destructive", title: "Errore Importazione" });
    } finally { setIsImporting(false); if(fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleConfirmCommit = async (confirm: boolean) => {
      if (!confirm || !importReport) { setImportReport(null); return; }
      const res = await commitImportedJobOrders({ newJobs: importReport.newJobs, jobsToUpdate: importReport.jobsToUpdate });
      toast({ title: res.message });
      setImportReport(null);
      fetchData();
  };

  const SortHeader = ({ label, sortKey }: { label: string, sortKey: keyof JobOrder | 'reparto_codice' }) => (
    <TableHead 
      className="cursor-pointer hover:text-primary transition-colors select-none"
      onClick={() => handleSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", sortConfig?.key === sortKey ? "text-primary" : "text-muted-foreground opacity-50")} />
      </div>
    </TableHead>
  );

  const JobTableRows = ({ data }: { data: JobOrder[] }) => (
    <>
      {data.map(j => {
        const deptCode = departments.find(d => d.name === j.department || d.code === j.department)?.code || j.department || 'N/D';
        const isPlanned = j.status === 'planned';
        
        let displayDateText = "Scegli...";
        let isDateValid = false;
        
        if (j.dataConsegnaFinale) {
            try {
                const parsed = parseISO(j.dataConsegnaFinale);
                if (isValid(parsed)) {
                    displayDateText = format(parsed, "dd/MM/yyyy");
                    isDateValid = true;
                }
            } catch (e) {}
        }

        return (
          <TableRow key={j.id}>
            <TableCell padding="checkbox">
              <Checkbox 
                checked={selectedRows.includes(j.id)} 
                onCheckedChange={c => setSelectedRows(prev => c ? [...prev, j.id] : prev.filter(id => id !== j.id))} 
              />
            </TableCell>
            <TableCell className="font-bold">{j.ordinePF}</TableCell>
            <TableCell>{j.details}</TableCell>
            <TableCell>{j.qta}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px] uppercase font-bold">{deptCode}</Badge></TableCell>
            <TableCell>
              {isPlanned ? (
                <Select onValueChange={cid => updateJobOrderCycle(j.id, cid).then(res => { toast({ title: res.message }); fetchData(); })} value={j.workCycleId}>
                  <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>{workCycles.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <div className="w-[180px] h-8 flex items-center px-2 border rounded-md bg-muted/30 text-xs text-muted-foreground italic">
                  {workCycles.find(c => c.id === j.workCycleId)?.name || '-'}
                </div>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">{j.numeroODLInterno || '-'}</TableCell>
            <TableCell>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-[130px] h-8 justify-start text-left font-normal text-xs",
                      !isDateValid && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3 w-3" />
                    <span>{displayDateText}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={isDateValid ? parseISO(j.dataConsegnaFinale) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        handleUpdateDeliveryDate(j.id, format(date, 'yyyy-MM-dd'));
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </TableCell>
            <TableCell className="text-right space-x-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className={cn("h-8 w-8", j.isPrinted ? "text-green-500 hover:text-green-600" : "text-muted-foreground")} 
                onClick={() => handleDownloadPdf(j)}
                disabled={isDownloadingPdf === j.id}
                title="Scarica PDF ODL"
              >
                {isDownloadingPdf === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              </Button>
              {j.status === 'planned' ? (
                <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => createODL(j.id).then(r => { toast({ title: r.message }); if(r.success) fetchData(); })}><PlayCircle className="mr-1 h-3 w-3" /> Avvia</Button>
              ) : (
                <Button variant="destructive" size="sm" className="h-8 px-2 text-xs" onClick={async () => { const r = await cancelODL(j.id); toast({ title: r.message }); fetchData(); }}><XCircle className="mr-1 h-3 w-3" /> Annulla</Button>
              )}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3"><ListChecks className="h-8 w-8 text-primary" />Gestione Dati Commesse</h1>
          <p className="text-muted-foreground">Importa da Excel e gestisci le commesse.</p>
        </div>
        <div className="flex gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={() => setIsManualCreateOpen(true)} variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Nuova Commessa</Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isImporting}>{isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4"/>} Importa Excel</Button>
        </div>
      </header>

      {pdfData && (
        <div style={{ position: 'fixed', top: '200%', left: 0, zIndex: -1 }}>
            <ODLPrintTemplate job={pdfData.job} article={pdfData.article} materials={pdfData.materials} printDate={pdfData.printDate} />
        </div>
      )}

      <Tabs defaultValue="planned">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="planned"><ListChecks className="mr-2 h-4 w-4" />Pianificate ({plannedJobOrders.length})</TabsTrigger>
          <TabsTrigger value="production"><Briefcase className="mr-2 h-4 w-4" />In Produzione ({productionJobOrders.length})</TabsTrigger>
        </TabsList>
        
        <TabsContent value="planned">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Cerca commessa..." className="pl-9" value={plannedSearchTerm} onChange={e => setPlannedSearchTerm(e.target.value)} />
              </div>
              {selectedRows.length > 0 && (
                <div className="flex gap-2 animate-in fade-in slide-in-from-right-2">
                  <Button size="sm" variant="outline" onClick={async () => { const r = await createMultipleODLs(selectedRows); toast({ title: "Risultato Avvio", description: r.message, variant: r.success ? 'default' : 'destructive' }); fetchData(); setSelectedRows([]); }}><PlayCircle className="mr-2 h-4 w-4"/> Avvia ODL ({selectedRows.length})</Button>
                  <Button size="sm" variant="destructive" onClick={async () => { const r = await deleteSelectedJobOrders(selectedRows); toast({ title: r.message }); fetchData(); setSelectedRows([]); }}><Trash2 className="mr-2 h-4 w-4"/> Elimina ({selectedRows.length})</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead padding="checkbox"><Checkbox checked={selectedRows.length === filteredPlanned.length && filteredPlanned.length > 0} onCheckedChange={c => setSelectedRows(c ? filteredPlanned.map(j => j.id) : [])} /></TableHead>
                    <SortHeader label="Ordine PF" sortKey="ordinePF" />
                    <SortHeader label="Articolo" sortKey="details" />
                    <SortHeader label="Qta" sortKey="qta" />
                    <SortHeader label="Reparto" sortKey="reparto_codice" />
                    <TableHead>Ciclo</TableHead>
                    <SortHeader label="N° ODL" sortKey="numeroODLInterno" />
                    <TableHead>Consegna</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <JobTableRows data={filteredPlanned} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="production">
           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Cerca in produzione..." className="pl-9" value={productionSearchTerm} onChange={e => setProductionSearchTerm(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead padding="checkbox"><Checkbox checked={selectedRows.length === filteredProduction.length && filteredProduction.length > 0} onCheckedChange={c => setSelectedRows(c ? filteredProduction.map(j => j.id) : [])} /></TableHead>
                    <SortHeader label="Ordine PF" sortKey="ordinePF" />
                    <SortHeader label="Articolo" sortKey="details" />
                    <SortHeader label="Qta" sortKey="qta" />
                    <SortHeader label="Reparto" sortKey="reparto_codice" />
                    <TableHead>Ciclo</TableHead>
                    <SortHeader label="N° ODL" sortKey="numeroODLInterno" />
                    <TableHead>Consegna</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <JobTableRows data={filteredProduction} />
                </TableBody>
              </Table>
           </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isManualCreateOpen} onOpenChange={setIsManualCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Nuova Commessa Manuale</DialogTitle>
                <DialogDescription>Compila i campi per pianificare una nuova commessa.</DialogDescription>
            </DialogHeader>
            <Form {...manualForm}>
                <form onSubmit={manualForm.handleSubmit(handleManualSubmit)} className="flex-1 overflow-y-auto space-y-4 py-4 pr-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField control={manualForm.control} name="cliente" render={({ field }) => ( <FormItem><FormLabel>Cliente</FormLabel><FormControl><Input placeholder="Es. Mario Rossi" {...field} /></FormControl><FormMessage /></FormItem> )} />
                        <FormField control={manualForm.control} name="ordinePF" render={({ field }) => ( <FormItem><FormLabel>Ordine PF</FormLabel><FormControl><Input placeholder="Es. 1234/25" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField control={manualForm.control} name="articleCode" render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Codice Articolo</FormLabel>
                                <Popover open={isArticlePopoverOpen} onOpenChange={setIsArticlePopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")}>
                                                {field.value ? articles.find(a => a.code === field.value)?.code : "Seleziona articolo..."}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                        <Command>
                                            <CommandInput placeholder="Cerca articolo..." />
                                            <CommandList>
                                                <CommandEmpty>Nessun articolo trovato.</CommandEmpty>
                                                <CommandGroup>
                                                    {articles.map((article) => (
                                                        <CommandItem
                                                            key={article.id}
                                                            value={article.code}
                                                            onSelect={() => { manualForm.setValue("articleCode", article.code); setIsArticlePopoverOpen(false); }}
                                                        >
                                                            <Check className={cn("mr-2 h-4 w-4", article.code === field.value ? "opacity-100" : "opacity-0")} />
                                                            {article.code}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={manualForm.control} name="qta" render={({ field }) => ( <FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField control={manualForm.control} name="dataConsegnaFinale" render={({ field }) => ( <FormItem><FormLabel>Data Consegna</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem> )} />
                        <FormField control={manualForm.control} name="numeroODLInterno" render={({ field }) => ( <FormItem><FormLabel>N° ODL (Opzionale)</FormLabel><FormControl><Input placeholder="Es. 0001" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField control={manualForm.control} name="department" render={({ field }) => (
                            <FormItem><FormLabel>Reparto</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Seleziona reparto..." /></SelectTrigger></FormControl>
                                    <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}</SelectContent>
                                </Select><FormMessage /></FormItem>
                        )} />
                        <FormField control={manualForm.control} name="workCycleId" render={({ field }) => (
                            <FormItem><FormLabel>Ciclo di Lavoro</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Seleziona ciclo..." /></SelectTrigger></FormControl>
                                    <SelectContent>{workCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                                </Select><FormMessage /></FormItem>
                        )} />
                    </div>
                    <DialogFooter className="mt-6">
                        <Button variant="outline" type="button" onClick={() => setIsManualCreateOpen(false)}>Annulla</Button>
                        <Button type="submit">Salva Commessa</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importReport} onOpenChange={o => !o && setImportReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>Analisi Importazione</DialogTitle></DialogHeader>
          <Tabs defaultValue="valid" className="flex-1 overflow-hidden mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="valid" className="text-green-600">PRONTE ({importReport ? (importReport.newJobs.length + importReport.jobsToUpdate.length) : 0})</TabsTrigger>
              <TabsTrigger value="blocked" className="text-destructive">BLOCCATE ({importReport?.blockedJobs.length || 0})</TabsTrigger>
            </TabsList>
            <TabsContent value="valid" className="h-[400px] border rounded-md mt-2"><ScrollArea className="h-full p-4">
                <Table><TableHeader><TableRow><TableHead>Ordine PF</TableHead><TableHead>Articolo</TableHead><TableHead>Stato</TableHead></TableRow></TableHeader>
                <TableBody>
                  {importReport?.newJobs.map((j, i) => <TableRow key={i}><TableCell>{j.ordinePF}</TableCell><TableCell>{j.details}</TableCell><TableCell><Badge>Nuova</Badge></TableCell></TableRow>)}
                  {importReport?.jobsToUpdate.map((j, i) => <TableRow key={i}><TableCell>{j.ordinePF}</TableCell><TableCell>{j.details}</TableCell><TableCell><Badge variant="outline">Duplicata</Badge></TableCell></TableRow>)}
                </TableBody></Table>
            </ScrollArea></TabsContent>
            <TabsContent value="blocked" className="h-[400px] border rounded-md mt-2"><ScrollArea className="h-full p-4">
                <Table><TableHeader><TableRow><TableHead>Riga Excel</TableHead><TableHead>Motivo Blocco</TableHead></TableRow></TableHeader>
                <TableBody>
                  {importReport?.blockedJobs.map((b, i) => <TableRow key={i} className="bg-destructive/5"><TableCell className="font-mono">{b.row.ordinePF || 'N/D'}</TableCell><TableCell className="text-destructive">{b.reason}</TableCell></TableRow>)}
                </TableBody></Table>
            </ScrollArea></TabsContent>
          </Tabs>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setImportReport(null)}>Annulla tutto</Button>
            <Button onClick={() => handleConfirmCommit(true)} disabled={!importReport?.newJobs.length && !importReport?.jobsToUpdate.length}>Carica Valide</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
