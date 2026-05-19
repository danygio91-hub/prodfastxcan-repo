
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  ListChecks, Upload, Loader2, Trash2, Briefcase, PlayCircle, Search, XCircle,
  FileDown, PlusCircle, ArrowUpDown, Calendar as CalendarIcon,
  CheckCircle2, AlertTriangle, Info, RefreshCw, Save, Combine,
  Pencil, Edit3, BellRing
} from 'lucide-react';
import { type JobOrder, type WorkCycle, type Article, type Department, type RawMaterial, type PurchaseOrder, type ManualCommitment } from '@/types';
import { format, parseISO, isBefore } from 'date-fns';
import { it } from 'date-fns/locale';
import { useToast } from "@/hooks/use-toast";
import {
  processAndValidateImport, commitImportedJobOrders, deleteSelectedJobOrders, createODL,
  createMultipleODLs, cancelODL, updateJobOrderCycle, saveManualJobOrder, markJobAsPrinted,
  updateJobOrderDeliveryDate, updateJobOrderPrepDate, updateJobOrderOdlNumber,
  forceRecalculateEstimates, healGhostJobOrders
} from './actions';
import { emergencyRestoreStagingArea } from '../data-healing/actions';
import { getArticles } from '../article-management/actions';
import { useRouter } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn, formatDisplayStock, isJobReadyForProduction } from '@/lib/utils';
import { getDerivedJobStatus } from '@/lib/job-status';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { calculateMRPTimelines, MRPTimelineEntry, aggregateMRPRequirements } from '@/lib/mrp-utils';
import { GlobalSettings } from '@/lib/settings-types';

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { getODLConfig } from '@/app/admin/settings/odl-actions';
import { getGlobalSettings } from '@/lib/settings-actions';
import { Calendar } from '@/components/ui/calendar';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MRPSemaphore } from '@/components/mrp/MRPSemaphore';
import { SmartJobModal } from '@/components/mrp/SmartJobModal';
import { EditStandardJobModal } from '@/components/mrp/EditStandardJobModal';

const manualCreateSchema = z.object({
  cliente: z.string().min(1, "Il cliente è obbligatorio."),
  ordinePF: z.string().min(1, "L'Ordine PF è obbligatorio."),
  articleCode: z.string().min(1, "L'articolo è obbligatorio."),
  qta: z.coerce.number().positive("La quantità deve essere positiva."),
  dataConsegnaFinale: z.string().min(1, "La data di consegna è obbligatoria."),
  dataFinePreparazione: z.string().optional(),
  department: z.string().min(1, "Il reparto è obbligatorio."),
  workCycleId: z.string().min(1, "Il ciclo di lavoro è obbligatorio."),
  numeroODLInterno: z.string().optional(),
}).refine(data => {
  if (data.dataFinePreparazione && data.dataConsegnaFinale) {
    return data.dataFinePreparazione <= data.dataConsegnaFinale;
  }
  return true;
}, {
  message: "La data fine preparazione non può essere successiva alla consegna finale.",
  path: ["dataFinePreparazione"]
});
type ManualCreateValues = z.infer<typeof manualCreateSchema>;

type SortConfig = {
  key: keyof JobOrder | 'reparto_codice';
  direction: 'asc' | 'desc';
} | null;

const SortHeader = ({ label, sortKey, sortConfig, onSort }: { label: string, sortKey: any, sortConfig: SortConfig, onSort: (key: any) => void }) => (
  <TableHead className="cursor-pointer hover:text-primary transition-colors select-none" onClick={() => onSort(sortKey)}>
    <div className="flex items-center gap-1">{label}<ArrowUpDown className={cn("h-3 w-3", sortConfig?.key === sortKey ? "text-primary" : "text-muted-foreground opacity-50")} /></div>
  </TableHead>
);

const JobTableRows = ({
  data, departments, workCycles, articles, rawMaterials, mrpTimelines,
  selectedRows, onToggleRow, onUpdateCycle, onUpdateDate, onUpdatePrepDate, onUpdateOdlNumber, onDownloadPdf, onAction, onEdit, isDownloadingPdf, isProcessingBatch, globalSettings, allowLink, activeSessions
}: {
  data: JobOrder[];
  departments: Department[];
  workCycles: WorkCycle[];
  articles: Article[];
  rawMaterials: RawMaterial[];
  mrpTimelines: Map<string, any[]>;
  selectedRows: string[];
  onToggleRow: (id: string, checked: boolean) => void;
  onUpdateCycle: (id: string, cycleId: string) => void;
  onUpdateDate: (id: string, date: Date | undefined) => void;
  onUpdatePrepDate: (id: string, date: Date | undefined) => void;
  onUpdateOdlNumber: (id: string, newOdl: string) => Promise<void>;
  onDownloadPdf: (job: JobOrder) => void;
  onAction: (id: string, type: 'start' | 'cancel') => void;
  onEdit: (job: JobOrder) => void;
  isDownloadingPdf: string | null;
  isProcessingBatch?: boolean;
  globalSettings: GlobalSettings | null;
  allowLink: boolean;
  activeSessions?: any[];
}) => {
  return (
    <>
      {data.map(j => {
        const deptCode = departments.find(d => d.name === j.department || d.code === j.department)?.code || j.department || 'N/D';
        const derivedStatus = getDerivedJobStatus(j);
        const isPlanned = derivedStatus === 'DA_INIZIARE';
        const displayDateText = j.dataConsegnaFinale ? format(parseISO(j.dataConsegnaFinale), "dd/MM/yyyy") : "Scegli...";
        const effectivePrepDate = j.dataFinePreparazione;
        const displayPrepDateText = effectivePrepDate ? format(parseISO(effectivePrepDate), "dd/MM/yyyy") : "Scegli...";
        const isInProductionGrouping = ['DA_INIZIARE', 'IN_PREPARAZIONE', 'PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK'].includes(derivedStatus);
        const isReadyBody = isInProductionGrouping && isJobReadyForProduction(j);


        const article = articles.find(a => a.code.toUpperCase() === j.details.toUpperCase());
        const hasSecondaryCycle = article && (article.secondaryWorkCycleId && article.secondaryWorkCycleId !== 'manual');

        return (
          <TableRow key={j.id}>
            <TableCell padding="checkbox"><Checkbox checked={selectedRows.includes(j.id)} onCheckedChange={c => onToggleRow(j.id, !!c)} /></TableCell>
            <TableCell className="font-bold">
              {allowLink ? (
                <Link href={`/admin/production-console?search=${encodeURIComponent(j.ordinePF)}`} className="text-primary hover:underline" prefetch={false}>
                  {j.ordinePF}
                </Link>
              ) : (
                j.ordinePF
              )}
            </TableCell>
            <TableCell>{j.details}</TableCell>
            <TableCell>{j.qta}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase font-bold">{deptCode}</Badge>
                {isInProductionGrouping && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        {isReadyBody ? (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            <span className="text-[9px] font-bold">PRONTO</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="text-[9px] font-bold">PREP</span>
                          </div>
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        {isReadyBody ? 'Fase di preparazione completata o non necessaria.' : 'Fase di preparazione in corso o mancante.'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </TableCell>

            <TableCell>
              {isPlanned ? (
                <div className="flex items-center gap-2">
                  <Select onValueChange={cid => onUpdateCycle(j.id, cid)} value={j.workCycleId}>
                    <SelectTrigger className={cn("w-[180px] h-8 text-xs", hasSecondaryCycle && "border-amber-500")}>
                      <SelectValue placeholder="Seleziona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workCycles.map(c => {
                        const isSecondary = c.id === article?.secondaryWorkCycleId;
                        return (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            <div className="flex items-center gap-2">
                              {c.name}
                              {isSecondary && <Badge variant="outline" className="text-[8px] h-4 bg-amber-500/10">SEC</Badge>}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {hasSecondaryCycle && (
                    <TooltipProvider><Tooltip><TooltipTrigger><Info className="h-4 w-4 text-amber-500" /></TooltipTrigger><TooltipContent>Disponibile ciclo secondario alternativo.</TooltipContent></Tooltip></TooltipProvider>
                  )}
                </div>
              ) : <div className="w-[180px] h-8 flex items-center px-2 border rounded-md bg-muted/30 text-xs italic">{workCycles.find(c => c.id === j.workCycleId)?.name || '-'}</div>}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {isPlanned ? (
                 <Input 
                    defaultValue={j.numeroODLInterno || ''}
                    onBlur={(e) => {
                       if (e.target.value !== (j.numeroODLInterno || '')) {
                           onUpdateOdlNumber(j.id, e.target.value);
                       }
                    }}
                    onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                          e.currentTarget.blur();
                       }
                    }}
                    className="h-8 text-xs w-[120px]"
                    placeholder="Es. 185/PF"
                 />
              ) : (
                 j.numeroODLInterno || '-'
              )}
            </TableCell>
            <TableCell>
              <MaskedDatePicker 
                value={effectivePrepDate ? parseISO(effectivePrepDate) : null} 
                onChange={(date) => onUpdatePrepDate(j.id, date || undefined)} 
                className="w-[140px]"
              />
            </TableCell>
            <TableCell>
              <MaskedDatePicker 
                value={j.dataConsegnaFinale ? parseISO(j.dataConsegnaFinale) : null} 
                onChange={(date) => onUpdateDate(j.id, date || undefined)} 
                className="w-[140px]"
              />
            </TableCell>
            <TableCell className="text-center">
              <MRPSemaphore job={j} mrpTimelines={mrpTimelines} activeSessions={activeSessions} size="lg" />
            </TableCell>
            <TableCell className="text-right space-x-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className={cn("h-8 w-8", !isPlanned && "opacity-30 cursor-not-allowed")} 
                      onClick={() => isPlanned && onEdit(j)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  {!isPlanned && (
                    <TooltipContent>
                      Modifica bloccata: Commessa in produzione. Riportala in 'Pianificate' per sbloccarla.
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>

              <Button variant="ghost" size="icon" className={cn("h-8 w-8", j.isPrinted ? "text-green-500" : "text-muted-foreground")} onClick={() => onDownloadPdf(j)} disabled={isDownloadingPdf !== null || isProcessingBatch}>{isDownloadingPdf === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}</Button>
              {isPlanned ? <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => onAction(j.id, 'start')}><PlayCircle className="mr-1 h-3 w-3" /> Avvia</Button> : <Button variant="destructive" size="sm" className="h-8 px-2 text-xs" onClick={() => onAction(j.id, 'cancel')}><XCircle className="mr-1 h-3 w-3" /> Annulla</Button>}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
};

export default function DataManagementClientPage({
  initialPlanned, initialProduction, initialCompleted, initialCycles, initialArticles, initialDepartments, initialMaterials, initialPurchaseOrders, initialManualCommitments, initialActiveSessions = []
}: {
  initialPlanned: JobOrder[];
  initialProduction: JobOrder[];
  initialCompleted: JobOrder[];
  initialCycles: WorkCycle[];
  initialArticles: Article[];
  initialDepartments: Department[];
  initialMaterials: RawMaterial[];
  initialPurchaseOrders: PurchaseOrder[];
  initialManualCommitments: ManualCommitment[];
  initialActiveSessions?: any[];
}) {
  const router = useRouter();
  const [plannedJobOrders, setPlannedJobOrders] = useState<JobOrder[]>(initialPlanned);
  const [productionJobOrders, setProductionJobOrders] = useState<JobOrder[]>(initialProduction);
  const [completedJobOrders, setCompletedJobOrders] = useState<JobOrder[]>(initialCompleted);

  const [workCycles, setWorkCycles] = useState<WorkCycle[]>(initialCycles);
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [departments, setDepartments] = useState<Department[]>(initialDepartments);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>(initialMaterials);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [manualCommitments, setManualCommitments] = useState<ManualCommitment[]>(initialManualCommitments);
  const [activeSessions, setActiveSessions] = useState<any[]>(initialActiveSessions);

  const [isRefreshingMRP, setIsRefreshingMRP] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<{
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    blockedJobs: Array<{ row: any; reason: string }>;
  } | null>(null);

  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);
  const [isArticlePopoverOpen, setIsArticlePopoverOpen] = useState(false);
  const [articleSuggestions, setArticleSuggestions] = useState<Article[]>([]);
  const [isSearchingArticles, setIsSearchingArticles] = useState(false);
  const [isSmartJobModalOpen, setIsSmartJobModalOpen] = useState(false);
  const [isEditStandardModalOpen, setIsEditStandardModalOpen] = useState(false);
  const [jobToEdit, setJobToEdit] = useState<JobOrder | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [odlConfig, setOdlConfig] = useState<any>(undefined);
  const [qrRule, setQrRule] = useState<string>("{ordinePF}@{details}@{qta}");
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    Promise.all([getODLConfig(), getGlobalSettings()]).then(([config, settings]) => {
      if (config) setOdlConfig(config);
      if (settings) {
          setGlobalSettings(settings);
          if (settings.jobOrderQrCodeRule) setQrRule(settings.jobOrderQrCodeRule);
      }
    });
  }, []);

  const handleSearchArticle = (term: string) => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (term.length < 2) {
          setArticleSuggestions([]);
          setIsSearchingArticles(false);
          return;
      }
      setIsSearchingArticles(true);
      searchTimeoutRef.current = setTimeout(async () => {
          try {
             const res = await getArticles(term);
             setArticleSuggestions(res);
          } catch(e) {} finally {
             setIsSearchingArticles(false);
          }
      }, 400);
  };

  const [plannedSearchTerm, setPlannedSearchTerm] = useState('');
  const [productionSearchTerm, setProductionSearchTerm] = useState('');
  const [completedSearchTerm, setCompletedSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);


  const [isDownloadingPdf, setIsDownloadingPdf] = useState<string | null>(null);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [pdfData, setPdfData] = useState<{ job: JobOrder, article: Article | null, materials: RawMaterial[], printDate: Date } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const manualForm = useForm<ManualCreateValues>({
    resolver: zodResolver(manualCreateSchema),
    defaultValues: { qta: 1, department: '' }
  });

  useEffect(() => {
    setPlannedJobOrders(initialPlanned);
    setProductionJobOrders(initialProduction);
    setCompletedJobOrders(initialCompleted);
    setWorkCycles(initialCycles);
    setArticles(initialArticles);
    setDepartments(initialDepartments);
    setRawMaterials(initialMaterials);
    setPurchaseOrders(initialPurchaseOrders);
    setManualCommitments(initialManualCommitments);
    setActiveSessions(initialActiveSessions);
  }, [initialPlanned, initialProduction, initialCompleted, initialCycles, initialArticles, initialDepartments, initialMaterials, initialPurchaseOrders, initialManualCommitments, initialActiveSessions]);


  const allJobsUnfiltered = useMemo(() => {
    return [...plannedJobOrders, ...productionJobOrders, ...completedJobOrders];
  }, [plannedJobOrders, productionJobOrders, completedJobOrders]);

  const { sSotPlanned, sSotProduction, sSotCompleted } = useMemo(() => {
    const planned: JobOrder[] = [];
    const prod: JobOrder[] = [];
    const comp: JobOrder[] = [];
    
    allJobsUnfiltered.forEach(j => {
      const status = getDerivedJobStatus(j);
      if (status === 'CHIUSO') {
        comp.push(j);
      } else if (['planned', 'IN_ATTESA', 'In Pianificazione', 'IN_PIANIFICAZIONE'].includes(j.status as any)) {
        planned.push(j);
      } else {
        prod.push(j);
      }
    });
    
    return { sSotPlanned: planned, sSotProduction: prod, sSotCompleted: comp };
  }, [allJobsUnfiltered]);

  const mrpTimelines = useMemo(() => {
    return calculateMRPTimelines(
      [...sSotPlanned, ...sSotProduction],
      rawMaterials,
      purchaseOrders,
      manualCommitments,
      articles,
      globalSettings,
      activeSessions
    );
  }, [sSotPlanned, sSotProduction, rawMaterials, purchaseOrders, manualCommitments, articles, globalSettings]);

  const criticalMaterialsTimeline = useMemo(() => {
    const criticals = new Map<string, { entry: MRPTimelineEntry, job: JobOrder | undefined }[]>();
    
    mrpTimelines.forEach((entries, matCode) => {
      if (entries.some(e => e.status === 'RED' || e.status === 'LATE' || e.status === 'LOW_STOCK')) {
        const mappedEntries = entries.map(entry => {
          const job = allJobsUnfiltered.find(j => j.id === entry.jobId);
          return { entry, job };
        }).sort((a, b) => {
           const dateA = a.job?.dataFinePreparazione || a.job?.dataConsegnaFinale || '9999-12-31';
           const dateB = b.job?.dataFinePreparazione || b.job?.dataConsegnaFinale || '9999-12-31';
           return dateA.localeCompare(dateB);
        });
        criticals.set(matCode, mappedEntries);
      }
    });
    
    return criticals;
  }, [mrpTimelines, allJobsUnfiltered]);

  const filteredDepartmentsForManualCreate = useMemo(() => {
    return departments.filter(d => 
      d.macroAreas.includes('PRODUZIONE') || d.code === 'MAG'
    );
  }, [departments]);

  const handleSort = (key: keyof JobOrder | 'reparto_codice') => {
    setSortConfig(current => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const processData = useCallback((data: JobOrder[], search: string) => {
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
        } else if (sortConfig.key === 'dataFinePreparazione') {
          aVal = a.dataFinePreparazione || a.dataConsegnaFinale || '9999-12-31';
          bVal = b.dataFinePreparazione || b.dataConsegnaFinale || '9999-12-31';
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
  }, [sortConfig, departments]);

  const filteredPlanned = useMemo(() => processData(sSotPlanned, plannedSearchTerm), [sSotPlanned, plannedSearchTerm, processData]);
  const filteredProduction = useMemo(() => processData(sSotProduction, productionSearchTerm), [sSotProduction, productionSearchTerm, processData]);
  const filteredCompleted = useMemo(() => processData(sSotCompleted, completedSearchTerm), [sSotCompleted, completedSearchTerm, processData]);


  const handleRefreshMRP = () => {
    setIsRefreshingMRP(true);
    router.refresh();
    toast({ title: "MRP Aggiornato", description: "I dati di disponibilità sono stati rinfrescati." });
    setTimeout(() => setIsRefreshingMRP(false), 1500);
  };

  const generateSinglePdf = async (job: JobOrder) => {
    setIsDownloadingPdf(job.id);
    try {
      const article = articles.find(a => a.code.toUpperCase() === job.details.toUpperCase()) || null;
      setPdfData({ job, article, materials: rawMaterials, printDate: new Date() });
      await new Promise(r => setTimeout(r, 1000));
      const container = document.getElementById('odl-pdf-pages');
      if (!container) throw new Error("Template non trovato.");
      const pageElements = container.querySelectorAll('.odl-page');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      for (let i = 0; i < pageElements.length; i++) {
        const page = pageElements[i] as HTMLElement;
        const canvas = await html2canvas(page, { scale: 3, useCORS: true, logging: false, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png', 1.0);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
      }
      pdf.save(`ODL_${job.ordinePF.replace(/\//g, '_')}.pdf`);
      await markJobAsPrinted(job.id);
    } catch (error) { 
      toast({ variant: "destructive", title: `Errore Download ${job.ordinePF}` }); 
    } finally { 
      setPdfData(null); 
    }
  };

  const handleDownloadPdf = async (job: JobOrder) => {
    if (isDownloadingPdf || isProcessingBatch) return;
    await generateSinglePdf(job);
    setIsDownloadingPdf(null);
    router.refresh();
    toast({ title: "PDF Scaricato" });
  };

  const handleBatchDownloadPdf = async () => {
    if (isDownloadingPdf || isProcessingBatch || selectedRows.length === 0) return;
    setIsProcessingBatch(true);
    
    const jobsToDownload = allJobsUnfiltered.filter(j => selectedRows.includes(j.id));
    
    for (const job of jobsToDownload) {
      await generateSinglePdf(job);
    }
    
    setIsDownloadingPdf(null);
    setIsProcessingBatch(false);
    setSelectedRows([]);
    router.refresh();
    toast({ title: "Download Massivo Completato", description: `Scaricati ${jobsToDownload.length} ODL.` });
  };

  const handleToggleRow = (id: string, checked: boolean) => {
    setSelectedRows(prev => checked ? [...prev, id] : prev.filter(rowId => rowId !== id));
  };

  const handleUpdateCycleLocal = async (jobId: string, cycleId: string) => {
    const res = await updateJobOrderCycle(jobId, cycleId);
    toast({ title: res.message });
    router.refresh();
  };

  const handleUpdateDateLocal = async (jobId: string, date: Date | undefined) => {
    if (date) {
      const job = [...plannedJobOrders, ...productionJobOrders, ...completedJobOrders].find(j => j.id === jobId);
      const newDateStr = format(date, 'yyyy-MM-dd');
      
      // STOP Loop: update only if changed
      if (job && job.dataConsegnaFinale === newDateStr) return;

      await updateJobOrderDeliveryDate(jobId, newDateStr);
      toast({ title: "Data consegna aggiornata" });
      router.refresh();
    }
  };

  const handleUpdatePrepDateLocal = async (jobId: string, date: Date | undefined) => {
    if (date) {
      const job = [...plannedJobOrders, ...productionJobOrders, ...completedJobOrders].find(j => j.id === jobId);
      const newPrepStr = format(date, 'yyyy-MM-dd');

      // STOP Loop: update only if changed
      if (job && job.dataFinePreparazione === newPrepStr) return;

      if (job && job.dataConsegnaFinale && newPrepStr > job.dataConsegnaFinale) {
         toast({ variant: "destructive", title: "Validazione fallita", description: "La data preparazione non può superare la consegna." });
         return;
      }
      await updateJobOrderPrepDate(jobId, newPrepStr);
      toast({ title: "Data preparazione aggiornata" });
      router.refresh();
    }
  };

  const handleActionLocal = async (id: string, type: 'start' | 'cancel') => {
    const res = type === 'start' ? await createODL(id) : await cancelODL(id);
    toast({ title: res.message });
    router.refresh();
  };

  const handleUpdateOdlLocal = async (jobId: string, newOdl: string) => {
    const res = await updateJobOrderOdlNumber(jobId, newOdl);
    toast({ title: res.message, variant: res.success ? 'default' : 'destructive' });
    if (res.success) router.refresh();
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Ordine PF': '123/PF.1-1',
        'Codice': 'CODICE_ARTICOLO',
        'Qta': 100,
        'Cliente': 'CLIENTE_ROSSI',
        'Ordine Nr Est': 'EST-001',
        'N° ODL': '0001-24',
        'Data Fine Prep': '2024-12-24',
        'Data Consegna Finale': '2024-12-31',
        'Reparto': 'CP',
        'Ciclo': 'STANDARD'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Commesse");
    XLSX.writeFile(wb, "Template_Import_Commesse.xlsx");
    toast({ title: "Template Scaricato", description: "Utilizza questo file come base per l'importazione." });
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
            <ListChecks className="h-8 w-8 text-primary" />
            Gestione Dati Commesse
          </h1>
          <p className="text-muted-foreground">Analisi MRP e pianificazione produzione.</p>
        </div>
        <div className="flex gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="relative group hover:bg-red-50 hover:border-red-200">
                <BellRing className="h-4 w-4 mr-2 text-muted-foreground group-hover:text-red-500" />
                Allarmi MRP
                {criticalMaterialsTimeline.size > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10 shadow-sm animate-in zoom-in">
                    {criticalMaterialsTimeline.size}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  Allertatore Intelligente MRP
                </SheetTitle>
                <SheetDescription>
                  Report temporizzato delle mancanze di materiale per le commesse a schermo. (In-Memory Aggregation)
                </SheetDescription>
              </SheetHeader>
              
              <div className="mt-6">
                {criticalMaterialsTimeline.size === 0 ? (
                  <div className="text-center p-6 text-muted-foreground bg-green-50 rounded-lg border border-green-100">
                    <CheckCircle2 className="h-8 w-8 mx-auto text-green-500 mb-2" />
                    Nessun materiale critico per le commesse visualizzate.
                  </div>
                ) : (
                  <Accordion type="single" collapsible className="w-full">
                    {Array.from(criticalMaterialsTimeline.entries()).map(([matCode, entries], idx) => {
                      const shortageEntry = entries.find(e => e.entry.status === 'RED') || entries.find(e => e.entry.status === 'LATE') || entries.find(e => e.entry.status === 'LOW_STOCK');
                      const materialName = rawMaterials.find(m => m.code.toUpperCase() === matCode)?.description || '';
                      return (
                        <AccordionItem key={matCode} value={matCode}>
                          <AccordionTrigger className="hover:no-underline px-2 hover:bg-muted/50 rounded-md transition-colors">
                            <div className="flex flex-col items-start text-left w-full">
                                <div className="flex items-center justify-between w-full pr-4">
                                    <span className="font-bold text-sm">{matCode}</span>
                                    <Badge variant={shortageEntry?.entry.status === 'RED' ? 'destructive' : 'secondary'} className={shortageEntry?.entry.status === 'LATE' ? 'bg-amber-500 hover:bg-amber-600 text-white' : shortageEntry?.entry.status === 'LOW_STOCK' ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}>
                                      {shortageEntry?.entry.status === 'RED' ? 'MANCANTE' : shortageEntry?.entry.status === 'LATE' ? 'IN RITARDO' : 'SOTTO SCORTA'}
                                    </Badge>
                                </div>
                                <span className="text-xs text-muted-foreground font-normal">{materialName}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-2 pt-2 pb-4">
                            <div className="space-y-3">
                              {entries.map((item, i) => {
                                const jobDate = item.job?.dataFinePreparazione || item.job?.dataConsegnaFinale;
                                const isNegative = item.entry.projectedBalance < 0;
                                const isLowStock = item.entry.status === 'LOW_STOCK';
                                return (
                                  <div key={i} className={cn("p-2 rounded-md border text-sm", isNegative ? "border-red-200 bg-red-50/30" : isLowStock ? "border-orange-200 bg-orange-50/30" : "border-border bg-muted/20")}>
                                    <div className="flex justify-between items-center mb-1">
                                      <span className="font-semibold text-xs">{jobDate ? format(parseISO(jobDate), "dd/MM/yyyy") : 'N/D'}</span>
                                      <span className="text-xs font-mono">{item.job?.ordinePF || item.job?.id || 'N/D'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                      <span className="text-muted-foreground">Fabbisogno: {item.entry.requiredQty.toFixed(2)}</span>
                                      <span className={cn("font-bold", isNegative ? "text-red-600" : isLowStock ? "text-orange-600" : "text-emerald-600")}>
                                        Stock Proiettato: {item.entry.projectedBalance.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              if (!confirm("Sei sicuro di voler ripristinare le commesse non avviate in Sala d'Attesa?")) return;
              const res = await emergencyRestoreStagingArea();
              if (res.success) {
                toast({ title: "Successo", description: res.message });
                router.refresh();
              } else {
                toast({ title: "Errore", description: res.message, variant: "destructive" });
              }
            }}
            className="text-red-500 hover:text-red-700 border-red-200 hover:border-red-500"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Ripristina Filtri
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              if (!confirm("Avviare il ricalcolo forzato delle stime per tutte le commesse pianificate?")) return;
              setIsRefreshingMRP(true);
              const res = await forceRecalculateEstimates();
              setIsRefreshingMRP(false);
              if (res.success) {
                toast({ title: "Ricalcolo Completato", description: res.message });
                router.refresh();
              } else {
                toast({ title: "Errore", description: res.message, variant: "destructive" });
              }
            }}
            className="text-amber-600 hover:text-amber-700 border-amber-200 hover:border-amber-500"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Forza Ricalcolo Stime
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              if (!confirm("Riparare eventuali commesse orfane (ghost) nel database delle commesse?")) return;
              setIsRefreshingMRP(true);
              const res = await healGhostJobOrders();
              setIsRefreshingMRP(false);
              if (res.success) {
                toast({ title: "Sanificazione Completata", description: res.message });
                router.refresh();
              } else {
                toast({ title: "Errore", description: res.message, variant: "destructive" });
              }
            }}
            className="text-indigo-600 hover:text-indigo-700 border-indigo-200 hover:border-indigo-500"
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Riparazione Database
          </Button>
          <input type="file" ref={fileInputRef} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return; setIsImporting(true);
            try {
              const buffer = await file.arrayBuffer();
              const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
              const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: true });
              const result = await processAndValidateImport(json);
              if (result.success) {
                setImportReport(result);
              } else {
                toast({
                  variant: "destructive",
                  title: "Analisi Fallita",
                  description: result.message
                });
              }
            } catch (e) { 
              console.error("Import error:", e);
              toast({ 
                variant: "destructive", 
                title: "Errore Import", 
                description: e instanceof Error ? e.message : "Errore sconosciuto durante l'elaborazione del file." 
              }); 
            }
            finally { setIsImporting(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
          }} accept=".xlsx, .xls" className="hidden" />
          
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <FileDown className="mr-2 h-4 w-4" />
            Scarica Template
          </Button>

          <Button variant="outline" onClick={handleRefreshMRP} disabled={isRefreshingMRP}>
            {isRefreshingMRP ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Aggiorna MRP
          </Button>
          {globalSettings?.smartCodeSettings?.enabled && (
            <>
              <Button 
                onClick={() => setIsSmartJobModalOpen(true)}
                className="bg-primary hover:bg-primary/80 text-white gap-2"
              >
                <Combine className="h-4 w-4" />
                + Commessa Rapida
              </Button>
              <Button 
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 border-primary/20 text-primary hover:bg-primary/5"
              >
                <Upload className="h-4 w-4" />
                Import Rapide
              </Button>
            </>
          )}
          <Button 
            onClick={handleBatchDownloadPdf} 
            disabled={selectedRows.length === 0 || isProcessingBatch || isDownloadingPdf !== null} 
            variant="outline" 
            className="border-green-200 text-green-700 hover:bg-green-50"
          >
            {isProcessingBatch ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Scarica ODL Selezionati
          </Button>
          <Button onClick={() => setIsManualCreateOpen(true)} variant="outline"><PlusCircle className="mr-2 h-4 w-4" /> Nuova Commessa</Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isImporting}>{isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Importa Excel</Button>
        </div>
      </header>

      {pdfData && <div style={{ position: 'fixed', top: '200%', left: 0, zIndex: -1 }}><ODLPrintTemplate job={pdfData.job} article={pdfData.article} materials={pdfData.materials} printDate={pdfData.printDate} config={odlConfig} qrRule={qrRule} globalSettings={globalSettings} /></div>}

      <Tabs defaultValue="planned">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="planned"><ListChecks className="mr-2 h-4 w-4" />Pianificate ({sSotPlanned.length})</TabsTrigger>
          <TabsTrigger value="production"><Briefcase className="mr-2 h-4 w-4" />In Produzione ({sSotProduction.length})</TabsTrigger>
          <TabsTrigger value="completed"><CheckCircle2 className="mr-2 h-4 w-4" />Conclusi ({sSotCompleted.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="planned">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca..." className="pl-9" value={plannedSearchTerm} onChange={e => setPlannedSearchTerm(e.target.value)} />
              </div>
              {selectedRows.length > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={async () => { const r = await createMultipleODLs(selectedRows); toast({ title: r.message }); router.refresh(); setSelectedRows([]); }}><PlayCircle className="mr-2 h-4 w-4" /> Avvia ({selectedRows.length})</Button>
                  <Button size="sm" variant="destructive" onClick={async () => { const r = await deleteSelectedJobOrders(selectedRows); toast({ title: r.message }); router.refresh(); setSelectedRows([]); }}><Trash2 className="mr-2 h-4 w-4" /> Elimina</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead padding="checkbox"><Checkbox checked={selectedRows.length === filteredPlanned.length && filteredPlanned.length > 0} onCheckedChange={c => setSelectedRows(c ? filteredPlanned.map(j => j.id) : [])} /></TableHead>
                    <SortHeader label="Ordine PF" sortKey="ordinePF" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Articolo</TableHead>
                    <TableHead>Qta</TableHead>
                    <SortHeader label="Reparto" sortKey="reparto_codice" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Ciclo</TableHead>
                    <TableHead>N° ODL</TableHead>
                    <SortHeader label="Fine Prep." sortKey="dataFinePreparazione" sortConfig={sortConfig} onSort={handleSort} />
                    <SortHeader label="Consegna Finale" sortKey="dataConsegnaFinale" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <JobTableRows
                    data={filteredPlanned}
                    departments={departments}
                    workCycles={workCycles}
                    articles={articles}
                    rawMaterials={rawMaterials}
                    mrpTimelines={mrpTimelines}
                    selectedRows={selectedRows}
                    onToggleRow={handleToggleRow}
                    onUpdateCycle={handleUpdateCycleLocal}
                    onUpdateDate={handleUpdateDateLocal}
                    onUpdatePrepDate={handleUpdatePrepDateLocal}
                    onUpdateOdlNumber={handleUpdateOdlLocal}
                    onDownloadPdf={handleDownloadPdf}
                    onAction={handleActionLocal}
                    onEdit={(job) => {
                      setJobToEdit(job);
                      setIsEditStandardModalOpen(true);
                    }}
                    isDownloadingPdf={isDownloadingPdf}
                    isProcessingBatch={isProcessingBatch}
                    globalSettings={globalSettings}
                    allowLink={false}
                    activeSessions={activeSessions}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="production">
          <Card>
            <CardHeader>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca..." className="pl-9" value={productionSearchTerm} onChange={e => setProductionSearchTerm(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead padding="checkbox"><Checkbox checked={selectedRows.length === filteredProduction.length && filteredProduction.length > 0} onCheckedChange={c => setSelectedRows(c ? filteredProduction.map(j => j.id) : [])} /></TableHead>
                    <SortHeader label="Ordine PF" sortKey="ordinePF" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Articolo</TableHead>
                    <TableHead>Qta</TableHead>
                    <SortHeader label="Reparto" sortKey="reparto_codice" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Ciclo</TableHead>
                    <TableHead>N° ODL</TableHead>
                    <SortHeader label="Fine Prep." sortKey="dataFinePreparazione" sortConfig={sortConfig} onSort={handleSort} />
                    <SortHeader label="Consegna Finale" sortKey="dataConsegnaFinale" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <JobTableRows
                    data={filteredProduction}
                    departments={departments}
                    workCycles={workCycles}
                    articles={articles}
                    rawMaterials={rawMaterials}
                    mrpTimelines={mrpTimelines}
                    selectedRows={selectedRows}
                    onToggleRow={handleToggleRow}
                    onUpdateCycle={handleUpdateCycleLocal}
                    onUpdateDate={handleUpdateDateLocal}
                    onUpdatePrepDate={handleUpdatePrepDateLocal}
                    onUpdateOdlNumber={handleUpdateOdlLocal}
                    onDownloadPdf={handleDownloadPdf}
                    onAction={handleActionLocal}
                    onEdit={(job) => {
                      setJobToEdit(job);
                      setIsEditStandardModalOpen(true);
                    }}
                    isDownloadingPdf={isDownloadingPdf}
                    isProcessingBatch={isProcessingBatch}
                    globalSettings={globalSettings}
                    allowLink={true}
                    activeSessions={activeSessions}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="completed">
          <Card>
            <CardHeader>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Cerca conclusi..." className="pl-9" value={completedSearchTerm} onChange={e => setCompletedSearchTerm(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead padding="checkbox"><Checkbox checked={selectedRows.length === filteredCompleted.length && filteredCompleted.length > 0} onCheckedChange={c => setSelectedRows(c ? filteredCompleted.map(j => j.id) : [])} /></TableHead>
                    <SortHeader label="Ordine PF" sortKey="ordinePF" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Articolo</TableHead>
                    <TableHead>Qta</TableHead>
                    <SortHeader label="Reparto" sortKey="reparto_codice" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead>Ciclo</TableHead>
                    <TableHead>N° ODL</TableHead>
                    <SortHeader label="Fine Prep." sortKey="dataFinePreparazione" sortConfig={sortConfig} onSort={handleSort} />
                    <SortHeader label="Consegna Finale" sortKey="dataConsegnaFinale" sortConfig={sortConfig} onSort={handleSort} />
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <JobTableRows
                    data={filteredCompleted}
                    departments={departments}
                    workCycles={workCycles}
                    articles={articles}
                    rawMaterials={rawMaterials}
                    mrpTimelines={mrpTimelines}
                    selectedRows={selectedRows}
                    onToggleRow={handleToggleRow}
                    onUpdateCycle={handleUpdateCycleLocal}
                    onUpdateDate={handleUpdateDateLocal}
                    onUpdatePrepDate={handleUpdatePrepDateLocal}
                    onUpdateOdlNumber={handleUpdateOdlLocal}
                    onDownloadPdf={handleDownloadPdf}
                    onAction={handleActionLocal}
                    onEdit={(job) => {
                      setJobToEdit(job);
                      setIsEditStandardModalOpen(true);
                    }}
                    isDownloadingPdf={isDownloadingPdf}
                    isProcessingBatch={isProcessingBatch}
                    globalSettings={globalSettings}
                    allowLink={true}
                    activeSessions={activeSessions}
                  />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      <Dialog open={isManualCreateOpen} onOpenChange={setIsManualCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nuova Commessa Manuale</DialogTitle></DialogHeader>
          <Form {...manualForm}><form onSubmit={manualForm.handleSubmit(async (v) => { const r = await saveManualJobOrder(v); if (r.success) { toast({ title: r.message }); setIsManualCreateOpen(false); manualForm.reset(); router.refresh(); } else toast({ variant: "destructive", title: r.message }); })} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={manualForm.control} name="cliente" render={({ field }) => (<FormItem><FormLabel>Cliente</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
              <FormField control={manualForm.control} name="ordinePF" render={({ field }) => (<FormItem><FormLabel>Ordine PF</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>)} />
            </div>
            <FormField control={manualForm.control} name="articleCode" render={({ field }) => (
              <FormItem className="flex flex-col"><FormLabel>Articolo</FormLabel><Popover open={isArticlePopoverOpen} onOpenChange={setIsArticlePopoverOpen}><PopoverTrigger asChild><FormControl><Button variant="outline" className="w-full justify-between font-bold text-blue-400 border-blue-500/20">{field.value || "Seleziona..."}<ArrowUpDown className="ml-2 h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command><CommandInput placeholder="Cerca minimo 2 char..." onValueChange={handleSearchArticle} /><CommandList><CommandEmpty>{isSearchingArticles ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2" /> : "Nessun articolo."}</CommandEmpty><CommandGroup>{articleSuggestions.map(a => (
                <CommandItem key={a.id} value={a.code} onSelect={() => { 
                  manualForm.setValue("articleCode", a.code); 
                  if (a.workCycleId) {
                      manualForm.setValue("workCycleId", a.workCycleId);
                  }
                  if (!manualForm.getValues("department")) {
                      const defaultDept = filteredDepartmentsForManualCreate.find(d => d.macroAreas?.includes('PRODUZIONE')) || filteredDepartmentsForManualCreate[0];
                      if (defaultDept) {
                          manualForm.setValue("department", defaultDept.code || defaultDept.id);
                      }
                  }
                  setIsArticlePopoverOpen(false); 
                }}>{a.code}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent></Popover></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-6">
              <FormField 
                control={manualForm.control} 
                name="dataFinePreparazione" 
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-amber-500 font-black uppercase text-[10px] tracking-widest">Fine Prep. (Magazzino)</FormLabel>
                    <FormControl>
                      <MaskedDatePicker 
                        value={field.value ? parseISO(field.value) : null} 
                        onChange={(date) => field.onChange(date ? format(date, 'yyyy-MM-dd') : '')} 
                        className="border-amber-500/30 focus:border-amber-500 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.05)]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} 
              />
              <FormField 
                control={manualForm.control} 
                name="dataConsegnaFinale" 
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-emerald-500 font-black uppercase text-[10px] tracking-widest">Consegna Finale (Cliente)</FormLabel>
                    <FormControl>
                      <MaskedDatePicker 
                        value={field.value ? parseISO(field.value) : null} 
                        onChange={(date) => field.onChange(date ? format(date, 'yyyy-MM-dd') : '')} 
                        className="border-emerald-500/30 focus:border-emerald-500 bg-emerald-500/5 shadow-[0_0_10px_rgba(16,185,129,0.05)]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} 
              />
            </div>
            <div className="grid grid-cols-2 gap-6">
              <FormField control={manualForm.control} name="qta" render={({ field }) => (<FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>)} />
              <FormField control={manualForm.control} name="department" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reparto</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {filteredDepartmentsForManualCreate.map(d => (
                        <SelectItem key={d.id} value={d.code}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <FormField control={manualForm.control} name="workCycleId" render={({ field }) => (
              <FormItem>
                <FormLabel>Ciclo</FormLabel>
                <Select onValueChange={(val) => {
                  field.onChange(val);
                  if (!manualForm.getValues("department")) {
                      const defaultDept = filteredDepartmentsForManualCreate.find(d => d.macroAreas?.includes('PRODUZIONE')) || filteredDepartmentsForManualCreate[0];
                      if (defaultDept) {
                          manualForm.setValue("department", defaultDept.code || defaultDept.id);
                      }
                  }
                }} value={field.value || ""}>
                  <FormControl>
                    <SelectTrigger className="border-blue-500/20 bg-blue-500/5"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {workCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <DialogFooter><Button type="submit">Salva</Button></DialogFooter>
          </form></Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importReport} onOpenChange={o => !o && setImportReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>Analisi Importazione</DialogTitle></DialogHeader>
          <Tabs defaultValue="valid" className="flex-1 flex flex-col mt-4 overflow-hidden">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="valid" className="text-green-600 font-bold">PRONTE ({importReport?.newJobs.length || 0})</TabsTrigger>
              <TabsTrigger value="blocked" className="text-destructive font-bold">BLOCCATE ({importReport?.blockedJobs.length || 0})</TabsTrigger>
            </TabsList>
            <TabsContent value="valid" className="flex-1 border rounded-md mt-2 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ordine PF</TableHead>
                      <TableHead>Articolo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importReport?.newJobs.map((j, i) => (
                      <TableRow key={i}>
                        <TableCell>{j.ordinePF}</TableCell>
                        <TableCell>{j.details}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="blocked" className="flex-1 border rounded-md mt-2 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Riga Excel</TableHead>
                      <TableHead>Motivo Blocco</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importReport?.blockedJobs.map((b, i) => (
                      <TableRow key={i} className="bg-destructive/5">
                        <TableCell className="font-mono text-xs">{b.row['Ordine PF'] || b.row['ordinePF'] || 'N/D'}</TableCell>
                        <TableCell className="text-destructive text-sm">{b.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>
          </Tabs>
          <DialogFooter className="mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setImportReport(null)}>Annulla tutto</Button>
            <Button onClick={() => { if (!importReport) return; commitImportedJobOrders({ newJobs: importReport.newJobs, jobsToUpdate: [] }).then(r => { toast({ title: r.message }); setImportReport(null); router.refresh(); }); }} disabled={!importReport?.newJobs.length}>
              Carica Commesse Valide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SmartJobModal 
        isOpen={isSmartJobModalOpen} 
        onClose={() => {
          setIsSmartJobModalOpen(false);
          setJobToEdit(null);
        }} 
        settings={globalSettings} 
        initialJob={jobToEdit}
      />
      <EditStandardJobModal
        isOpen={isEditStandardModalOpen}
        onClose={() => {
          setIsEditStandardModalOpen(false);
          setJobToEdit(null);
        }}
        job={jobToEdit}
        workCycles={workCycles}
        departments={departments}
      />
    </div>
  );
}
