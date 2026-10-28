"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  Search, 
  Printer, 
  Play, 
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarCheck,
  PlusCircle,
  Upload,
  Combine,
  BellRing,
  HelpCircle,
  Loader2,
  Zap,
  CornerDownLeft,
  CalendarDays,
  Layers
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, getWeek, getYear, addWeeks, subWeeks, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from '@/hooks/use-toast';
import { parseRobustDate, cn } from '@/lib/utils';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article, WorkCycle } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import { calculateMRPTimelines, type MRPTimelineEntry } from '@/lib/mrp-utils';
import { SmartJobModal } from '@/components/mrp/SmartJobModal';
import { SmartPasteModal } from '@/components/mrp/SmartPasteModal';
import { ManualJobModal } from '@/components/mrp/ManualJobModal';
import { 
  getJobOrders, 
  getTargetedMRPData, 
  toggleJobPrinted, 
  updateJobOdlNumber, 
  updateJobStatus,
  updateJobDeliveryDate,
  saveQuickJobOrder
} from './actions';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface ProgrammazioneClientPageProps {
  initialJobs: JobOrder[];
  initialDepartments: Department[];
  initialArticles?: Article[];
  initialWorkCycles?: WorkCycle[];
  initialGlobalSettings?: GlobalSettings | null;
}

// 4 Macro-Gruppi Reparti Essenziali
export type MacroDepartmentCode = 'ALL' | 'CP' | 'CG' | 'BF';

interface MacroDepartment {
  code: MacroDepartmentCode;
  label: string;
  badge: string;
}

const MACRO_DEPARTMENTS: MacroDepartment[] = [
  { code: 'ALL', label: 'TUTTI', badge: 'ALL' },
  { code: 'CP', label: 'CONNESSIONI PICCOLE (CP)', badge: 'CP' },
  { code: 'CG', label: 'CONNESSIONI GRANDI (CG)', badge: 'CG' },
  { code: 'BF', label: 'REPARTO BARRE (BF)', badge: 'BF' },
];

export function getJobDepartmentGroup(job: JobOrder): 'CP' | 'CG' | 'BF' | 'OTHER' {
  const d = (job.department || '').toUpperCase().trim();
  if (d === 'CP' || d.includes('PICCOL') || d.includes('CONNESSIONI PICCOLE')) return 'CP';
  if (d === 'CG' || d.includes('GRAND') || d.includes('CONNESSIONI GRANDI')) return 'CG';
  if (d === 'BF' || d.includes('BARRE') || d.includes('REPARTO BARRE')) return 'BF';

  if (job.phases && job.phases.length > 0) {
    for (const p of job.phases) {
      const pDepts = (p.departmentCodes || []).map(c => c.toUpperCase());
      const pName = (p.name || '').toUpperCase();
      if (pDepts.includes('CP') || pName.includes('PICCOL')) return 'CP';
      if (pDepts.includes('CG') || pName.includes('GRAND')) return 'CG';
      if (pDepts.includes('BF') || pName.includes('BARRE')) return 'BF';
    }
  }

  return 'OTHER';
}

export type JobStatusOption = 'Pianificata' | 'In Produzione' | 'Completato Prod.' | 'Spedito';

export function normalizeJobStatus(status: string | undefined): JobStatusOption {
  if (!status) return 'Pianificata';
  const s = status.toUpperCase().trim();
  if (s.includes('SPEDIT') || s === 'SHIPPED') return 'Spedito';
  if (s.includes('FINE') || s.includes('COMPLET') || s === 'CLOSED' || s === 'CHIUSO') return 'Completato Prod.';
  if (s.includes('PROD') || s.includes('LAVORAZ') || s.includes('ATTIV') || s.includes('ACTIVE') || s.includes('IN_PROGRESS')) return 'In Produzione';
  return 'Pianificata';
}

export function isJobFinished(status: string | undefined): boolean {
  const norm = normalizeJobStatus(status);
  return norm === 'Completato Prod.' || norm === 'Spedito';
}

function calculateJobHours(job: JobOrder): number {
  if (job.phases && job.phases.length > 0) {
    const totalMinutes = job.phases.reduce((acc, p) => {
      const perPiece = p.expectedMinutesPerPiece || 0;
      return acc + (perPiece * (job.qta || 0));
    }, 0);
    if (totalMinutes > 0) {
      return Math.round((totalMinutes / 60) * 10) / 10;
    }
  }
  if (job.expectedMinutesDefault && job.expectedMinutesDefault > 0) {
    return Math.round(((job.expectedMinutesDefault * (job.qta || 0)) / 60) * 10) / 10;
  }
  return Math.round((((job.qta || 0) * 10) / 60) * 10) / 10;
}

function getJobWeekAndYear(job: JobOrder): { week: number; year: number } | null {
  const targetDateStr = job.assignedDate || job.dataConsegnaFinale;
  if (!targetDateStr) return null;
  const d = parseRobustDate(targetDateStr);
  if (!d) return null;
  return {
    week: getWeek(d, { weekStartsOn: 1 }),
    year: getYear(d),
  };
}

interface DayCapacityConfig {
  L: number;
  M: number;
  Me: number;
  G: number;
  V: number;
  overtime: number;
}

const DEFAULT_CAPACITY: DayCapacityConfig = {
  L: 4,
  M: 4,
  Me: 4,
  G: 4,
  V: 4,
  overtime: 0,
};

type SortField = 'ordinePF' | 'cliente' | 'dataConsegna';

export default function ProgrammazioneClientPage({
  initialJobs,
  initialDepartments,
  initialArticles = [],
  initialWorkCycles = [],
  initialGlobalSettings = null,
}: ProgrammazioneClientPageProps) {
  const { toast } = useToast();

  // Dati Commesse
  const [jobs, setJobs] = useState<JobOrder[]>(initialJobs || []);
  const [departments] = useState<Department[]>(initialDepartments || []);
  const [articles] = useState<Article[]>(initialArticles || []);
  const [workCycles] = useState<WorkCycle[]>(initialWorkCycles || []);
  const [globalSettings] = useState<GlobalSettings | null>(initialGlobalSettings);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modali Inserimento
  const [isSmartJobOpen, setIsSmartJobOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);

  // Draft locale per i N° ODL (input rapido)
  const [odlDrafts, setOdlDrafts] = useState<Record<string, string>>({});
  // Draft locale per Data Consegna (inline edit)
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});

  // 2. Riga Vuota Rapida (Top DataGrid)
  const [quickRow, setQuickRow] = useState({
    ordinePF: '',
    cliente: '',
    articleCode: '',
    qta: '',
    dataConsegnaFinale: '',
    numeroODLInterno: '',
    department: 'CP',
  });
  const [isSubmittingQuickRow, setIsSubmittingQuickRow] = useState(false);
  const [isQuickArticleOpen, setIsQuickArticleOpen] = useState(false);
  const [quickArticleSearch, setQuickArticleSearch] = useState('');
  const quickRowFirstInputRef = useRef<HTMLInputElement>(null);

  // Filtro Reparto (4 Macro-Gruppi)
  const [selectedDept, setSelectedDept] = useState<MacroDepartmentCode>('ALL');

  // Filtro Settimana
  const [currentDateReference, setCurrentDateReference] = useState<Date>(new Date());
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  // Filtro Ricerca
  const [searchQuery, setSearchQuery] = useState('');

  // Ordinamento Colonne
  const [sortField, setSortField] = useState<SortField | null>('ordinePF');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Capacità Giornaliera per Secchiello
  const [capacitiesByBucket, setCapacitiesByBucket] = useState<Record<string, DayCapacityConfig>>({});

  const selectedWeekNumber = useMemo(() => {
    return getWeek(currentDateReference, { weekStartsOn: 1 });
  }, [currentDateReference]);

  const selectedYear = useMemo(() => {
    return getYear(currentDateReference);
  }, [currentDateReference]);

  const bucketKey = useMemo(() => {
    return `${selectedDept}_${selectedYear}_W${selectedWeekNumber}`;
  }, [selectedDept, selectedYear, selectedWeekNumber]);

  const currentCapacity = useMemo(() => {
    return capacitiesByBucket[bucketKey] || DEFAULT_CAPACITY;
  }, [capacitiesByBucket, bucketKey]);

  const handleCapacityChange = (field: keyof DayCapacityConfig, value: number) => {
    const safeValue = Math.max(0, isNaN(value) ? 0 : value);
    setCapacitiesByBucket((prev) => ({
      ...prev,
      [bucketKey]: {
        ...(prev[bucketKey] || DEFAULT_CAPACITY),
        [field]: safeValue,
      },
    }));
  };

  const availableHours = useMemo(() => {
    const { L, M, Me, G, V, overtime } = currentCapacity;
    const totalDailyWorkers = L + M + Me + G + V;
    const baseHours = totalDailyWorkers * 7.6;
    const total = baseHours + (Number(overtime) || 0);
    return Math.round(total * 10) / 10;
  }, [currentCapacity]);

  const weekInterval = useMemo(() => {
    const start = startOfWeek(currentDateReference, { weekStartsOn: 1 });
    const end = endOfWeek(currentDateReference, { weekStartsOn: 1 });
    return {
      start,
      end,
      label: `${format(start, 'dd MMM', { locale: it })} - ${format(end, 'dd MMM yyyy', { locale: it })}`,
    };
  }, [currentDateReference]);

  // Navigazione Settimane
  const handlePrevWeek = () => {
    setCurrentDateReference((prev) => subWeeks(prev, 1));
    setShowAllWeeks(false);
  };

  const handleNextWeek = () => {
    setCurrentDateReference((prev) => addWeeks(prev, 1));
    setShowAllWeeks(false);
  };

  const handleCurrentWeek = () => {
    setCurrentDateReference(new Date());
    setShowAllWeeks(false);
  };

  // Refresh Commesse
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const updatedJobs = await getJobOrders();
      setJobs(updatedJobs);
      toast({
        title: "Dati aggiornati",
        description: `Caricate ${updatedJobs.length} commesse dal database.`,
      });
    } catch (error) {
      console.error("Errore refresh:", error);
      toast({
        title: "Errore di caricamento",
        description: "Impossibile aggiornare i dati delle commesse.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Ordinamento Colonne
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filtraggio Commesse Lato Client
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (selectedDept !== 'ALL') {
        const group = getJobDepartmentGroup(job);
        if (group !== selectedDept) return false;
      }

      if (!showAllWeeks) {
        const weekInfo = getJobWeekAndYear(job);
        if (!weekInfo) return false;
        if (weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear) {
          return false;
        }
      }

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchPf = (job.ordinePF || '').toLowerCase().includes(q);
        const matchCliente = (job.cliente || '').toLowerCase().includes(q);
        const matchArticle = (job.details || '').toLowerCase().includes(q);
        const matchOdl = (job.numeroODLInterno || job.numeroODL || '').toLowerCase().includes(q);
        if (!matchPf && !matchCliente && !matchArticle && !matchOdl) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, selectedDept, showAllWeeks, selectedWeekNumber, selectedYear, searchQuery]);

  // Ordinamento Risultati
  const sortedAndFilteredJobs = useMemo(() => {
    const list = [...filteredJobs];
    if (!sortField) return list;

    list.sort((a, b) => {
      let res = 0;
      if (sortField === 'ordinePF') {
        const pfA = String(a.ordinePF || '');
        const pfB = String(b.ordinePF || '');
        res = pfA.localeCompare(pfB, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'cliente') {
        const clA = String(a.cliente || '');
        const clB = String(b.cliente || '');
        res = clA.localeCompare(clB, undefined, { sensitivity: 'base' });
      } else if (sortField === 'dataConsegna') {
        const dateA = a.dataConsegnaFinale ? parseRobustDate(a.dataConsegnaFinale)?.getTime() || 0 : 0;
        const dateB = b.dataConsegnaFinale ? parseRobustDate(b.dataConsegnaFinale)?.getTime() || 0 : 0;
        res = dateA - dateB;
      }
      return sortDirection === 'asc' ? res : -res;
    });

    return list;
  }, [filteredJobs, sortField, sortDirection]);

  // Metriche Secchiello
  const bucketMetrics = useMemo(() => {
    const totalJobs = sortedAndFilteredJobs.length;
    const totalPieces = sortedAndFilteredJobs.reduce((acc, j) => acc + (j.qta || 0), 0);
    const loadedHours = sortedAndFilteredJobs.reduce((acc, j) => acc + calculateJobHours(j), 0);
    const roundedLoadedHours = Math.round(loadedHours * 10) / 10;
    const saturationPercent = availableHours > 0 
      ? Math.round((roundedLoadedHours / availableHours) * 100) 
      : 0;
    const balanceHours = Math.round((availableHours - roundedLoadedHours) * 10) / 10;

    return {
      totalJobs,
      totalPieces,
      loadedHours: roundedLoadedHours,
      saturationPercent,
      balanceHours,
    };
  }, [sortedAndFilteredJobs, availableHours]);

  // Conteggi per macro-reparti
  const deptCounts = useMemo(() => {
    const counts: Record<MacroDepartmentCode, number> = { ALL: 0, CP: 0, CG: 0, BF: 0 };
    jobs.forEach((job) => {
      if (!showAllWeeks) {
        const weekInfo = getJobWeekAndYear(job);
        if (!weekInfo || weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear) {
          return;
        }
      }
      counts.ALL++;
      const group = getJobDepartmentGroup(job);
      if (group === 'CP') counts.CP++;
      else if (group === 'CG') counts.CG++;
      else if (group === 'BF') counts.BF++;
    });
    return counts;
  }, [jobs, showAllWeeks, selectedWeekNumber, selectedYear]);

  // Filtro Articoli per Autocomplete Riga Rapida
  const matchingQuickArticles = useMemo(() => {
    const term = (quickArticleSearch || quickRow.articleCode || '').trim().toUpperCase();
    if (!term) return articles.slice(0, 30);
    return articles
      .filter((a) => a.code.toUpperCase().includes(term) || (a.description && a.description.toUpperCase().includes(term)))
      .slice(0, 30);
  }, [articles, quickArticleSearch, quickRow.articleCode]);

  // =========================================================================
  // TARGETED MRP IN BACKGROUND - SCOPE GLOBALE (COMMESSE PIANIFICATE + IN PRODUZIONE)
  // =========================================================================
  const materialsCacheRef = useRef<Map<string, RawMaterial>>(new Map());
  const poCacheRef = useRef<Map<string, PurchaseOrder[]>>(new Map());
  const articlesCacheRef = useRef<Map<string, Article>>(new Map());
  const globalSettingsRef = useRef<GlobalSettings | null>(globalSettings);

  const [mrpCacheVersion, setMrpCacheVersion] = useState(0);
  const [isMrpLoading, setIsMrpLoading] = useState(false);

  // Inizializza articoli passati da server
  useEffect(() => {
    if (articles.length > 0) {
      articles.forEach(a => {
        if (a.code) articlesCacheRef.current.set(a.code.trim().toUpperCase(), a);
      });
    }
  }, [articles]);

  // Commesse Globali Attive (Pianificata o In Produzione) - Short-circuit per escludere completati/spediti
  const activeGlobalJobs = useMemo(() => {
    return jobs.filter((j) => !isJobFinished(j.status));
  }, [jobs]);

  // Fabbisogni materiali e articoli sull'intero backlog attivo aziendale (Short-circuit rigoroso)
  const { globalMaterialCodes, globalArticleCodes } = useMemo(() => {
    const matSet = new Set<string>();
    const artSet = new Set<string>();

    activeGlobalJobs.forEach((job) => {
      if (isJobFinished(job.status)) return;
      const bom = job.billOfMaterials || [];
      if (bom.length > 0) {
        bom.forEach((item) => {
          if (item.component) matSet.add(item.component.trim().toUpperCase());
        });
      } else if (job.details) {
        artSet.add(job.details.trim().toUpperCase());
      }
    });

    return {
      globalMaterialCodes: Array.from(matSet),
      globalArticleCodes: Array.from(artSet),
    };
  }, [activeGlobalJobs]);

  useEffect(() => {
    let isCancelled = false;

    const missingMaterials = globalMaterialCodes.filter(
      (code) => !materialsCacheRef.current.has(code)
    );
    const missingArticles = globalArticleCodes.filter(
      (code) => !articlesCacheRef.current.has(code)
    );

    if (missingMaterials.length === 0 && missingArticles.length === 0) {
      return;
    }

    setIsMrpLoading(true);

    getTargetedMRPData(missingMaterials, missingArticles)
      .then((data) => {
        if (isCancelled) return;

        data.rawMaterials.forEach((m) => {
          if (m.code) materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
        });

        data.purchaseOrders.forEach((po) => {
          const code = (po.materialCode || '').trim().toUpperCase();
          if (code) {
            const list = poCacheRef.current.get(code) || [];
            list.push(po);
            poCacheRef.current.set(code, list);
          }
        });

        data.articles.forEach((a) => {
          if (a.code) articlesCacheRef.current.set(a.code.trim().toUpperCase(), a);
        });

        if (data.globalSettings) {
          globalSettingsRef.current = data.globalSettings;
        }

        setMrpCacheVersion((v) => v + 1);
      })
      .catch((err) => {
        console.error("Errore caricamento MRP mirato:", err);
      })
      .finally(() => {
        if (!isCancelled) setIsMrpLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [globalMaterialCodes, globalArticleCodes]);

  const mrpTimelines = useMemo(() => {
    if (activeGlobalJobs.length === 0) {
      return new Map<string, MRPTimelineEntry[]>();
    }

    const enrichedJobs: JobOrder[] = activeGlobalJobs.map((job) => {
      if ((!job.billOfMaterials || job.billOfMaterials.length === 0) && job.details) {
        const article = articlesCacheRef.current.get(job.details.trim().toUpperCase());
        if (article && article.billOfMaterials && article.billOfMaterials.length > 0) {
          return {
            ...job,
            billOfMaterials: article.billOfMaterials.map((ab) => ({
              component: ab.component,
              quantity: ab.quantity,
              unit: ab.unit,
              status: 'pending',
              isFromTemplate: true,
            })),
          };
        }
      }
      return job;
    });

    const cachedMaterials = Array.from(materialsCacheRef.current.values());
    const allCachedPOs = Array.from(poCacheRef.current.values()).flat();
    const cachedArticles = Array.from(articlesCacheRef.current.values());

    return calculateMRPTimelines(
      enrichedJobs,
      cachedMaterials,
      allCachedPOs,
      [],
      cachedArticles,
      globalSettingsRef.current,
      []
    );
  }, [activeGlobalJobs, mrpCacheVersion]);

  // Calcolo Mappa Allarmi Critici per Allertatore Intelligente MRP su Scope Globale
  const criticalMaterialsTimeline = useMemo(() => {
    const criticals = new Map<string, { entry: MRPTimelineEntry; job: JobOrder | undefined }[]>();
    
    mrpTimelines.forEach((entries, matCode) => {
      const problematic = entries.filter(e => 
        e.status === 'RED' || e.status === 'LATE' || e.status === 'LOW_STOCK' || e.status === 'ORDERED'
      );

      if (problematic.length > 0) {
        const mapped = problematic.map(entry => {
          const job = activeGlobalJobs.find(j => j.id === entry.jobId);
          return { entry, job };
        });
        criticals.set(matCode, mapped);
      }
    });

    return criticals;
  }, [mrpTimelines, activeGlobalJobs]);

  // Stato Semaforo Singola Commessa con Gestione Visiva Corretta "In Verifica" e Short-circuit per Completate
  const getJobMRPStatus = useCallback((job: JobOrder): {
    state: 'RED' | 'LATE' | 'GREEN' | 'NO_BOM' | 'LOADING' | 'COMPLETED';
    label: string;
    badgeClass: string;
    dotClass: string;
    details: string[];
  } => {
    // 0. SHORT-CIRCUIT A MONTE: Se la commessa è completata o spedita, bypassa completamente il calcolo MRP
    if (isJobFinished(job.status)) {
      const isShipped = normalizeJobStatus(job.status) === 'Spedito';
      return {
        state: 'COMPLETED',
        label: isShipped ? 'Spedito' : 'Completato',
        badgeClass: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700/60 font-medium',
        dotClass: 'bg-slate-400 dark:bg-slate-500',
        details: [
          isShipped 
            ? '⚪ Commessa Spedita: Nessun fabbisogno o impegno magazzino attivo.'
            : '⚪ Produzione Completata: Nessun fabbisogno o impegno magazzino attivo.'
        ],
      };
    }

    let bom = job.billOfMaterials || [];
    if (bom.length === 0 && job.details) {
      const art = articlesCacheRef.current.get(job.details.trim().toUpperCase());
      if (art && art.billOfMaterials) {
        bom = art.billOfMaterials.map((ab) => ({
          component: ab.component,
          quantity: ab.quantity,
          unit: ab.unit,
          status: 'pending',
          isFromTemplate: true,
        }));
      }
    }

    if (bom.length === 0) {
      return {
        state: 'NO_BOM',
        label: 'No BOM',
        badgeClass: 'bg-muted/70 text-muted-foreground border-border',
        dotClass: 'bg-muted-foreground/50',
        details: ['Nessuna distinta base configurata per questo articolo.'],
      };
    }

    const pendingItems = bom.filter((i) => i.status !== 'withdrawn');
    const withdrawnItems = bom.filter((i) => i.status === 'withdrawn');

    // Tutti i componenti già prelevati
    if (pendingItems.length === 0) {
      return {
        state: 'GREEN',
        label: 'Prelevato',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        dotClass: 'bg-emerald-500',
        details: withdrawnItems.map((i) => `✅ ${i.component} - Materiale già prelevato`),
      };
    }

    // Raccogli entry MRP
    const entries: { component: string; entry?: MRPTimelineEntry }[] = [];
    let hasMissingData = false;

    pendingItems.forEach((item) => {
      const matCode = (item.component || '').trim().toUpperCase();
      const timeline = mrpTimelines.get(matCode) || [];
      const entry = timeline.find((e) => e.jobId === job.id);
      if (entry) {
        entries.push({ component: matCode, entry });
      } else {
        hasMissingData = true;
      }
    });

    // STATO "IN VERIFICA": Gestione visiva con loader pulsante se dati non ancora caricati
    if (entries.length === 0 && (hasMissingData || isMrpLoading)) {
      return {
        state: 'LOADING',
        label: 'In Verifica',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse font-semibold',
        dotClass: 'bg-amber-500 animate-ping',
        details: ['Verifica disponibilità magazzino e ordini aperti in corso...'],
      };
    }

    const hasRed = entries.some((e) => e.entry?.status === 'RED');
    const hasLateOrPendingSupply = entries.some((e) => 
      e.entry && ['LATE', 'ORDERED', 'AMBER', 'LOW_STOCK'].includes(e.entry.status)
    );

    const details: string[] = [
      ...withdrawnItems.map((i) => `✅ ${i.component} - Prelevato`),
      ...entries.map((e) => {
        const dList = e.entry?.details || [];
        const statusText = e.entry?.status === 'RED' 
          ? '🔴 MANCANTE' 
          : e.entry?.status === 'LATE' 
            ? '🟠 IN RITARDO' 
            : e.entry?.status === 'ORDERED' || e.entry?.status === 'AMBER'
              ? '🟠 IN ARRIVO'
              : '🟢 DISPONIBILE';
        const dDetail = dList.length > 0 ? ` (${dList.join('; ')})` : '';
        return `📦 ${e.component}: ${statusText}${dDetail}`;
      }),
    ];

    if (hasRed) {
      return {
        state: 'RED',
        label: 'Mancante',
        badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-bold',
        dotClass: 'bg-red-500',
        details,
      };
    }

    if (hasLateOrPendingSupply) {
      return {
        state: 'LATE',
        label: 'In Arrivo',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-semibold',
        dotClass: 'bg-amber-500',
        details,
      };
    }

    return {
      state: 'GREEN',
      label: 'Pronto',
      badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold',
      dotClass: 'bg-emerald-500',
      details,
    };
  }, [mrpTimelines, isMrpLoading]);

  // =========================================================================
  // 1. INLINE EDITING: DATA CONSEGNA (GG/MM/AAAA)
  // =========================================================================
  const formatDateForDisplay = (isoOrStr: string | undefined): string => {
    if (!isoOrStr) return '';
    const d = parseRobustDate(isoOrStr);
    if (!d) return isoOrStr;
    return format(d, 'dd/MM/yyyy');
  };

  const handleDeliveryDateBlur = async (job: JobOrder) => {
    const rawVal = dateDrafts[job.id];
    if (rawVal === undefined) return; // Non modificato

    const trimmed = rawVal.trim();
    if (!trimmed) {
      // Data azzerata
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, dataConsegnaFinale: '' } : j));
      await updateJobDeliveryDate(job.id, '');
      return;
    }

    // Parsing flessibile GG/MM/AAAA o YYYY-MM-DD
    const parsed = parseRobustDate(trimmed);
    if (!parsed || isNaN(parsed.getTime())) {
      toast({
        variant: "destructive",
        title: "Formato Data Errato",
        description: `Inserisci la data in formato GG/MM/AAAA (es. 25/11/2026).`,
      });
      // Revert al valore originale
      setDateDrafts(prev => {
        const copy = { ...prev };
        delete copy[job.id];
        return copy;
      });
      return;
    }

    const isoFormatted = format(parsed, 'yyyy-MM-dd');
    if (isoFormatted === job.dataConsegnaFinale) return;

    // Aggiornamento Ottimistico
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, dataConsegnaFinale: isoFormatted } : j));
    
    // Pulisci draft
    setDateDrafts(prev => {
      const copy = { ...prev };
      delete copy[job.id];
      return copy;
    });

    try {
      const res = await updateJobDeliveryDate(job.id, isoFormatted);
      if (res.success) {
        toast({
          title: "Data Consegna Salvata",
          description: `Commessa ${job.ordinePF}: consegna aggiornata al ${format(parsed, 'dd/MM/yyyy')}.`,
        });
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Data",
        description: e.message || "Impossibile salvare la nuova data.",
      });
    }
  };

  // =========================================================================
  // 2. RIGA VUOTA RAPIDA (INSERIMENTO INLINE STILE EXCEL)
  // =========================================================================
  const handleSaveQuickRow = async () => {
    const { ordinePF, cliente, articleCode, qta, dataConsegnaFinale, numeroODLInterno, department } = quickRow;

    if (!ordinePF.trim() || !cliente.trim() || !articleCode.trim() || !qta) {
      toast({
        variant: "destructive",
        title: "Campi Obbligatori Mancanti",
        description: "Inserisci almeno Ordine, Cliente, Articolo e Quantità.",
      });
      return;
    }

    let parsedDate = '';
    if (dataConsegnaFinale.trim()) {
      const d = parseRobustDate(dataConsegnaFinale.trim());
      if (d && !isNaN(d.getTime())) {
        parsedDate = format(d, 'yyyy-MM-dd');
      }
    }

    setIsSubmittingQuickRow(true);

    try {
      const res = await saveQuickJobOrder({
        ordinePF: ordinePF.trim(),
        cliente: cliente.trim(),
        articleCode: articleCode.trim(),
        qta: parseInt(qta) || 1,
        dataConsegnaFinale: parsedDate,
        numeroODLInterno: numeroODLInterno.trim() || undefined,
        department: selectedDept !== 'ALL' ? selectedDept : (department || 'CP'),
      });

      if (res.success && res.job) {
        // Inserimento immediato nella tabella (Optimistic UI)
        setJobs(prev => [res.job!, ...prev]);

        // Verifica se la commessa appartiene alla settimana attualmente visibile a schermo
        const weekInfo = getJobWeekAndYear(res.job!);
        if (weekInfo && (weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear)) {
          toast({
            title: "Commessa Creata!",
            description: `Ordine ${ordinePF} inserito per Settimana ${weekInfo.week}/${weekInfo.year}. Non appare nel secchiello corrente (Settimana ${selectedWeekNumber}).`,
          });
        } else {
          toast({
            title: "Commessa Creata!",
            description: `Ordine ${ordinePF} inserito con successo nel secchiello.`,
          });
        }

        // Reset riga rapida
        setQuickRow({
          ordinePF: '',
          cliente: '',
          articleCode: '',
          qta: '',
          dataConsegnaFinale: '',
          numeroODLInterno: '',
          department: selectedDept !== 'ALL' ? selectedDept : 'CP',
        });
        setQuickArticleSearch('');

        // Riporta il focus sul primo campo per inserimenti multipli rapidi
        quickRowFirstInputRef.current?.focus();
      } else {
        throw new Error(res.message);
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Creazione",
        description: e.message || "Impossibile inserire la commessa rapida.",
      });
    } finally {
      setIsSubmittingQuickRow(false);
    }
  };

  // Aggiornamento N° ODL (on blur)
  const handleOdlBlur = async (job: JobOrder) => {
    const currentVal = (job.numeroODLInterno || job.numeroODL || '').trim();
    const draftVal = (odlDrafts[job.id] ?? currentVal).trim();

    if (draftVal === currentVal) return;

    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? { ...j, numeroODLInterno: draftVal, numeroODL: draftVal }
          : j
      )
    );

    try {
      const res = await updateJobOdlNumber(job.id, draftVal);
      if (res.success) {
        toast({
          title: "N° ODL Aggiornato",
          description: `Commessa ${job.ordinePF}: impostato ODL "${draftVal}".`,
        });
      }
    } catch (e: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, numeroODLInterno: currentVal, numeroODL: currentVal }
            : j
        )
      );
      toast({
        variant: "destructive",
        title: "Errore N° ODL",
        description: "Impossibile salvare il N° ODL.",
      });
    }
  };

  // Modifica Stato Commessa
  const handleStatusChange = async (job: JobOrder, newStatus: JobStatusOption) => {
    const prevStatus = job.status;

    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: newStatus } : j))
    );

    toast({
      title: "Stato Commessa Modificato",
      description: `Commessa ${job.ordinePF} -> ${newStatus}.`,
    });

    try {
      await updateJobStatus(job.id, newStatus);
    } catch (e) {
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: prevStatus } : j))
      );
    }
  };

  // 4. Workflow Avvio Produzione: aggiorna a "In Produzione"
  const handleStartProduction = (job: JobOrder) => {
    handleStatusChange(job, 'In Produzione');
  };

  // Stampa ODL con Vincolo N° ODL e Automazione
  const handleTogglePrintODL = async (job: JobOrder) => {
    const currentOdl = (job.numeroODLInterno || job.numeroODL || '').trim();

    if (!currentOdl) {
      toast({
        variant: "destructive",
        title: "N° ODL Mancante",
        description: "Inserire N° ODL prima di stampare.",
      });
      return;
    }

    const isCurrentlyPrinted = Boolean((job as any).odlPrinted || job.isPrinted);
    const nextPrinted = !isCurrentlyPrinted;
    const currentNormalized = normalizeJobStatus(job.status);
    const nextStatus: JobStatusOption = nextPrinted && currentNormalized === 'Pianificata' 
      ? 'In Produzione' 
      : normalizeJobStatus(job.status);

    setJobs((prevJobs) =>
      prevJobs.map((j) =>
        j.id === job.id
          ? {
              ...j,
              isPrinted: nextPrinted,
              odlPrinted: nextPrinted,
              status: nextStatus,
            }
          : j
      )
    );

    toast({
      title: nextPrinted ? "ODL Stampato con Successo" : "Marcatura Stampa Rimossa",
      description: nextPrinted
        ? `Commessa ${job.ordinePF}: ODL "${currentOdl}" stampato. Stato impostato su "${nextStatus}".`
        : `Commessa ${job.ordinePF}: marcatura stampa annullata.`,
    });

    try {
      await toggleJobPrinted(
        job.id, 
        isCurrentlyPrinted, 
        nextPrinted && currentNormalized === 'Pianificata'
      );
    } catch (e) {
      console.error("Errore salvataggio stampa/stato:", e);
    }
  };

  // Settimane per il dropdown rapido
  const weekOptions = useMemo(() => {
    const now = new Date();
    const options: { value: string; label: string; date: Date }[] = [];
    for (let i = -3; i <= 8; i++) {
      const refDate = addWeeks(now, i);
      const w = getWeek(refDate, { weekStartsOn: 1 });
      const y = getYear(refDate);
      const start = startOfWeek(refDate, { weekStartsOn: 1 });
      const end = endOfWeek(refDate, { weekStartsOn: 1 });
      const isCurrent = i === 0;
      options.push({
        value: `${y}-W${w}`,
        label: `Sett. ${w} ${isCurrent ? '(Corrente)' : ''} • ${format(start, 'dd/MM')} - ${format(end, 'dd/MM')}`,
        date: refDate,
      });
    }
    return options;
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3 pb-8">
        {/* =========================================================================
            HEADER & HUB INSERIMENTO (COMMAND PANEL) + ALLERTATORE MRP
        ========================================================================== */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 border-b pb-2.5">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-headline tracking-tight">
                  Programmazione Commesse
                </h1>
                <Badge variant="outline" className="border-blue-500/40 text-blue-500 text-[10px] px-1.5 py-0 font-medium">
                  Master Panel
                </Badge>
                {isMrpLoading && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500 animate-pulse font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Targeted MRP...
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2 & 3. HUB INSERIMENTO + ALLERTATORE MRP */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 3. Allertatore Intelligente MRP (Sheet Drawer) */}
            <Sheet>
              <SheetTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="relative h-8 text-xs gap-1.5 border-red-500/30 hover:bg-red-500/10 text-red-600 dark:text-red-400"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  <span>Allarmi MRP</span>
                  {criticalMaterialsTimeline.size > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full shadow-xs animate-in zoom-in">
                      {criticalMaterialsTimeline.size}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[420px] sm:w-[580px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="h-5 w-5" />
                    Allertatore Intelligente MRP (Globale)
                  </SheetTitle>
                  <SheetDescription>
                    Mancanze materiali per tutte le {activeGlobalJobs.length} commesse attive aziendali (Pianificate e In Produzione).
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-4 space-y-3">
                  {criticalMaterialsTimeline.size === 0 ? (
                    <div className="text-center p-6 text-muted-foreground bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                      <p className="font-semibold text-emerald-600">Nessuna criticità materiali!</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Tutte le commesse attive risultano coperte da giacenza o ordini fornitori.
                      </p>
                    </div>
                  ) : (
                    <Accordion type="single" collapsible className="w-full space-y-2">
                      {Array.from(criticalMaterialsTimeline.entries()).map(([matCode, entries]) => (
                        <AccordionItem key={matCode} value={matCode} className="border rounded-md px-2">
                          <AccordionTrigger className="hover:no-underline py-2">
                            <div className="flex items-center justify-between w-full pr-3 text-left">
                              <span className="font-mono font-bold text-xs">{matCode}</span>
                              <Badge variant="destructive" className="text-[10px] py-0">
                                {entries.length} commesse
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pt-1 pb-2 space-y-1.5 text-xs">
                            {entries.map(({ entry, job }, idx) => (
                              <div key={idx} className="bg-muted/40 p-2 rounded border text-[11px] space-y-1">
                                <div className="flex items-center justify-between font-mono">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold">{job?.ordinePF || entry.jobId}</span>
                                    {job && (
                                      <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold">
                                        {getJobDepartmentGroup(job)}
                                      </Badge>
                                    )}
                                  </div>
                                  <span className="text-muted-foreground truncate max-w-[150px]">{job?.cliente}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>Data Cons: <strong className="text-foreground">{job?.dataConsegnaFinale || 'N/D'}</strong></span>
                                  <span className="font-bold uppercase text-[9px]">{job?.status || 'Pianificata'}</span>
                                </div>
                                <div className="text-muted-foreground text-[10.5px]">
                                  {entry.details.join(' • ')}
                                </div>
                              </div>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {/* 2. Nuova Commessa Rapida (SmartJobModal) */}
            <Button
              size="sm"
              onClick={() => setIsSmartJobOpen(true)}
              className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>+ Commessa Rapida</span>
            </Button>

            {/* 2. Smart Paste Commesse (Import Excel) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSmartPasteOpen(true)}
              className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Smart Paste</span>
            </Button>

            {/* 2. Nuova Commessa Manuale */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsManualCreateOpen(true)}
              className="h-8 text-xs gap-1.5"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>+ Manuale</span>
            </Button>

            {/* Aggiorna */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 text-xs gap-1 px-2.5"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? '...' : 'Aggiorna'}</span>
            </Button>
          </div>
        </div>

        {/* =========================================================================
            TOP BAR: TAB REPARTI (4 MACRO-GRUPPI)
        ========================================================================== */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 border-b no-scrollbar">
          {MACRO_DEPARTMENTS.map((dept) => {
            const isActive = selectedDept === dept.code;
            const count = deptCounts[dept.code];
            return (
              <button
                key={dept.code}
                onClick={() => setSelectedDept(dept.code)}
                className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-semibold tracking-wider transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>{dept.label}</span>
                <span className={`text-[10px] px-1.5 py-0 rounded-full font-mono font-bold ${
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* =========================================================================
            WEEK SELECTOR + RICERCA RAPIDA
        ========================================================================== */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-card border rounded-md px-3 py-1.5 shadow-2xs">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border rounded-md bg-background shadow-2xs">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevWeek}
                disabled={showAllWeeks}
                className="h-7 w-7 rounded-r-none"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="px-2.5 text-xs font-bold tracking-tight text-center min-w-[155px]">
                {showAllWeeks ? (
                  <span className="text-amber-600 font-semibold">Tutte le Settimane</span>
                ) : (
                  <div>
                    <span className="text-foreground">Settimana {selectedWeekNumber} / {selectedYear}</span>
                    <span className="block text-[10px] font-normal text-muted-foreground leading-tight">
                      {weekInterval.label}
                    </span>
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNextWeek}
                disabled={showAllWeeks}
                className="h-7 w-7 rounded-l-none"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              variant={!showAllWeeks ? "secondary" : "ghost"}
              size="sm"
              onClick={handleCurrentWeek}
              className="h-7 text-xs px-2"
            >
              Questa Settimana
            </Button>

            <Select
              value={`${selectedYear}-W${selectedWeekNumber}`}
              onValueChange={(val) => {
                const opt = weekOptions.find((o) => o.value === val);
                if (opt) {
                  setCurrentDateReference(opt.date);
                  setShowAllWeeks(false);
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[175px]">
                <SelectValue placeholder="Salta a..." />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={showAllWeeks ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAllWeeks(!showAllWeeks)}
              className="h-7 text-xs px-2"
            >
              {showAllWeeks ? "Usa Secchiello" : "Tutte le Settimane"}
            </Button>
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cerca PF, cliente, articolo, ODL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>
        </div>

        {/* =========================================================================
            KPI CAPACITÀ (BOX CON BORDO DINAMICO E VISIBILITÀ)
        ========================================================================== */}
        <div className="bg-card border rounded-md px-3 py-2 shadow-2xs flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 text-blue-500" />
              Addetti:
            </span>

            {/* Giorni L, M, M, G, V */}
            {(['L', 'M', 'Me', 'G', 'V'] as const).map((day) => (
              <div key={day} className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
                <span className="font-bold text-[10px] text-muted-foreground">{day === 'Me' ? 'M' : day}:</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={currentCapacity[day]}
                  onChange={(e) => handleCapacityChange(day, parseInt(e.target.value))}
                  className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}

            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border ml-1">
              <span className="font-bold text-[10px] text-muted-foreground">+ Straord:</span>
              <input
                type="number"
                min={0}
                max={100}
                value={currentCapacity.overtime}
                onChange={(e) => handleCapacityChange('overtime', parseFloat(e.target.value))}
                className="w-10 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
              <span className="text-[10px] text-muted-foreground font-mono">h</span>
            </div>
          </div>

          <div 
            className={cn(
              "rounded-md px-3.5 py-1.5 shadow-md flex items-center divide-x transition-all duration-300",
              "bg-slate-900 text-white divide-slate-700/80 border-2",
              bucketMetrics.saturationPercent > 100 
                ? "border-red-500 shadow-red-500/20" 
                : bucketMetrics.saturationPercent > 85 
                  ? "border-amber-500 shadow-amber-500/20" 
                  : "border-emerald-500 shadow-emerald-500/20"
            )}
          >
            <div className="pr-3 text-left">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-none">
                Disponibili
              </div>
              <div className="text-sm font-mono font-black text-white mt-0.5">
                {availableHours.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">h</span>
              </div>
            </div>

            <div className="px-3 text-left">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-none flex items-center justify-between gap-1">
                <span>Caricate</span>
                <span className="text-[9px] text-slate-400 font-normal">({bucketMetrics.totalJobs} com.)</span>
              </div>
              <div className="text-sm font-mono font-black text-white mt-0.5">
                {bucketMetrics.loadedHours.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">h</span>
              </div>
            </div>

            <div className="px-3 text-left">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-none">
                Saturazione
              </div>
              <div className={cn(
                "text-sm font-mono font-black mt-0.5",
                bucketMetrics.saturationPercent > 100 ? "text-red-400" : bucketMetrics.saturationPercent > 85 ? "text-amber-400" : "text-emerald-400"
              )}>
                {bucketMetrics.saturationPercent}%
              </div>
            </div>

            <div className="pl-3 text-left">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-none">
                Bilancio
              </div>
              <div className={cn(
                "text-sm font-mono font-black mt-0.5",
                bucketMetrics.balanceHours < 0 ? "text-red-400" : "text-emerald-400"
              )}>
                {bucketMetrics.balanceHours >= 0 ? `+${bucketMetrics.balanceHours.toFixed(1)} h` : `${bucketMetrics.balanceHours.toFixed(1)} h`}
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            DATAGRID (STILE EXCEL): RIGA VUOTA RAPIDA + SEPARAZIONE COLONNE + INLINE EDIT
        ========================================================================== */}
        <div className="border rounded-md bg-card shadow-xs overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 border-b flex items-center justify-between text-xs text-muted-foreground font-medium">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Commesse Nel Secchiello</span>
              <span>•</span>
              <span>
                Visualizzate <strong>{sortedAndFilteredJobs.length}</strong> su <strong>{jobs.length}</strong> totali
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"></span> Pronto
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 inline-block"></span> In Arrivo
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500 inline-block"></span> Mancante
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-muted/70 sticky top-0 z-10 border-b shadow-2xs backdrop-blur-xs">
                <tr className="divide-x divide-border font-semibold text-foreground">
                  {/* 1. REPARTO */}
                  <th className="py-2 px-2 text-center w-[55px]">Rep.</th>

                  {/* 2. ORDINE */}
                  <th 
                    onClick={() => handleSort('ordinePF')}
                    className="py-2 px-2.5 text-left w-[105px] cursor-pointer select-none hover:bg-muted/90 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span>Ordine</span>
                      {sortField === 'ordinePF' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
                      )}
                    </div>
                  </th>

                  {/* 3. CLIENTE */}
                  <th 
                    onClick={() => handleSort('cliente')}
                    className="py-2 px-2.5 text-left w-[135px] cursor-pointer select-none hover:bg-muted/90 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span>Cliente</span>
                      {sortField === 'cliente' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
                      )}
                    </div>
                  </th>

                  {/* 4. ARTICOLO */}
                  <th className="py-2 px-3 text-left min-w-[190px]">Articolo</th>

                  {/* 5. Q.TÀ (Separata) */}
                  <th className="py-2 px-2 text-right w-[75px]">Q.tà</th>

                  {/* 6. ORE PREV. (Separata) */}
                  <th className="py-2 px-2 text-right w-[75px]">Ore Prev.</th>

                  {/* 7. DATA CONS. (Ordinabile e Inline Editable) */}
                  <th 
                    onClick={() => handleSort('dataConsegna')}
                    className="py-2 px-2 text-center w-[110px] cursor-pointer select-none hover:bg-muted/90 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Data Cons.</span>
                      {sortField === 'dataConsegna' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
                      )}
                    </div>
                  </th>

                  {/* 8. N° ODL */}
                  <th className="py-2 px-2 text-center w-[115px] bg-muted/80">N° ODL</th>

                  {/* 9. STATO MRP */}
                  <th className="py-2 px-2 text-center w-[115px] bg-muted/80">Stato MRP</th>

                  {/* 10. SETTIMANA */}
                  <th className="py-2 px-2 text-center w-[125px] bg-muted/80">Settimana</th>

                  {/* 11. STATO COMMESSA */}
                  <th className="py-2 px-2 text-center w-[145px] bg-muted/80">Stato Commessa</th>

                  {/* 12. AZIONI */}
                  <th className="py-2 px-2 text-center w-[85px] bg-muted/80">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-normal">
                {/* =========================================================================
                    2. RIGA VUOTA RAPIDA PERMANENTEMENTE VISIBILE IN CIMA ALLA DATAGRID
                ========================================================================== */}
                <tr className="divide-x divide-border bg-blue-500/5 hover:bg-blue-500/10 transition-colors border-b-2 border-primary/30">
                  {/* Reparto */}
                  <td className="py-1 px-1 text-center align-middle">
                    <Select
                      value={quickRow.department}
                      onValueChange={(val) => setQuickRow(prev => ({ ...prev, department: val }))}
                    >
                      <SelectTrigger className="h-6 text-[10px] font-bold px-1 py-0 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CP" className="text-xs font-bold text-amber-600">CP</SelectItem>
                        <SelectItem value="CG" className="text-xs font-bold text-emerald-600">CG</SelectItem>
                        <SelectItem value="BF" className="text-xs font-bold text-sky-600">BF</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>

                  {/* Ordine PF */}
                  <td className="py-1 px-1.5 align-middle">
                    <input
                      ref={quickRowFirstInputRef}
                      type="text"
                      placeholder="Ordine PF..."
                      value={quickRow.ordinePF}
                      onChange={(e) => setQuickRow(prev => ({ ...prev, ordinePF: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickRow()}
                      className="w-full h-6 px-1.5 font-mono font-bold text-[11px] bg-background border rounded focus:ring-1 focus:ring-primary"
                    />
                  </td>

                  {/* Cliente */}
                  <td className="py-1 px-1.5 align-middle">
                    <input
                      type="text"
                      placeholder="Cliente..."
                      value={quickRow.cliente}
                      onChange={(e) => setQuickRow(prev => ({ ...prev, cliente: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickRow()}
                      className="w-full h-6 px-1.5 text-[11px] bg-background border rounded focus:ring-1 focus:ring-primary"
                    />
                  </td>

                  {/* Articolo (Autocomplete / Combobox collegato ad Anagrafica Articoli) */}
                  <td className="py-1 px-1.5 align-middle">
                    <Popover open={isQuickArticleOpen} onOpenChange={setIsQuickArticleOpen}>
                      <PopoverTrigger asChild>
                        <div className="relative flex items-center w-full">
                          <input
                            type="text"
                            placeholder="Seleziona Articolo..."
                            value={quickRow.articleCode}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              setQuickRow(prev => ({ ...prev, articleCode: val }));
                              setQuickArticleSearch(val);
                              setIsQuickArticleOpen(true);
                            }}
                            onClick={() => setIsQuickArticleOpen(true)}
                            onFocus={() => setIsQuickArticleOpen(true)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isQuickArticleOpen) {
                                handleSaveQuickRow();
                              }
                            }}
                            className="w-full h-6 px-1.5 pr-5 font-mono font-bold text-[11px] bg-background border rounded focus:ring-1 focus:ring-primary uppercase tracking-tight"
                          />
                          <ArrowUpDown className="h-3 w-3 absolute right-1.5 text-muted-foreground opacity-50 pointer-events-none" />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-[340px] p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Cerca per codice o descrizione..."
                            value={quickArticleSearch}
                            onValueChange={setQuickArticleSearch}
                          />
                          <CommandList className="max-h-[220px]">
                            <CommandEmpty>Nessun articolo trovato.</CommandEmpty>
                            <CommandGroup heading="Anagrafica Articoli">
                              {matchingQuickArticles.map((a) => (
                                <CommandItem
                                  key={a.id}
                                  value={a.code}
                                  onSelect={() => {
                                    const artDept = (a as any).department;
                                    setQuickRow(prev => ({
                                      ...prev,
                                      articleCode: a.code,
                                      department: (artDept === 'CP' || artDept === 'CG' || artDept === 'BF') ? artDept : prev.department,
                                    }));
                                    setIsQuickArticleOpen(false);
                                  }}
                                  className="cursor-pointer text-xs flex items-center justify-between py-1.5"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-mono font-bold text-primary">{a.code}</span>
                                    {a.description && (
                                      <span className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                                        {a.description}
                                      </span>
                                    )}
                                  </div>
                                  {(a as any).department && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                                      {(a as any).department}
                                    </Badge>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </td>

                  {/* Q.tà */}
                  <td className="py-1 px-1 text-right align-middle">
                    <input
                      type="number"
                      placeholder="Q.tà"
                      min={1}
                      value={quickRow.qta}
                      onChange={(e) => setQuickRow(prev => ({ ...prev, qta: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickRow()}
                      className="w-full h-6 px-1 text-right font-mono font-bold text-[11px] bg-background border rounded focus:ring-1 focus:ring-primary"
                    />
                  </td>

                  {/* Ore Prev. (Calcolato o placeholder) */}
                  <td className="py-1 px-2 text-right align-middle font-mono text-[11px] text-muted-foreground">
                    {quickRow.qta ? `${(parseInt(quickRow.qta) * 0.15).toFixed(1)}h` : '---'}
                  </td>

                  {/* Data Cons. */}
                  <td className="py-1 px-1.5 text-center align-middle">
                    <input
                      type="text"
                      placeholder="GG/MM/AAAA"
                      value={quickRow.dataConsegnaFinale}
                      onChange={(e) => setQuickRow(prev => ({ ...prev, dataConsegnaFinale: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickRow()}
                      className="w-full h-6 px-1 text-center font-mono text-[10px] bg-background border rounded focus:ring-1 focus:ring-primary"
                    />
                  </td>

                  {/* N° ODL */}
                  <td className="py-1 px-1.5 text-center align-middle">
                    <input
                      type="text"
                      placeholder="N° ODL..."
                      value={quickRow.numeroODLInterno}
                      onChange={(e) => setQuickRow(prev => ({ ...prev, numeroODLInterno: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickRow()}
                      className="w-full h-6 px-1 text-center font-mono text-[10px] bg-background border rounded focus:ring-1 focus:ring-primary"
                    />
                  </td>

                  {/* Stato MRP */}
                  <td className="py-1 px-1 text-center align-middle">
                    <Badge variant="outline" className="text-[9px] py-0 border-blue-500/30 text-blue-500 bg-blue-500/10">
                      + Nuova
                    </Badge>
                  </td>

                  {/* Settimana */}
                  <td className="py-1 px-1 text-center align-middle font-mono text-[10px] text-muted-foreground">
                    W{selectedWeekNumber}
                  </td>

                  {/* Stato Commessa */}
                  <td className="py-1 px-1 text-center align-middle font-medium text-[10px] text-blue-600">
                    Pianificata
                  </td>

                  {/* Azione Salva Riga Rapida */}
                  <td className="py-1 px-1 text-center align-middle">
                    <Button
                      size="sm"
                      onClick={handleSaveQuickRow}
                      disabled={isSubmittingQuickRow || !quickRow.ordinePF.trim() || !quickRow.articleCode.trim()}
                      className="h-6 px-2 text-[10px] font-bold gap-1 bg-primary text-primary-foreground shadow-2xs"
                      title="Premi Invio o clicca per inserire"
                    >
                      {isSubmittingQuickRow ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <CornerDownLeft className="h-3 w-3" />
                          <span>Invio</span>
                        </>
                      )}
                    </Button>
                  </td>
                </tr>

                {/* =========================================================================
                    RIGHE COMMESSE EFFETTIVE
                ========================================================================== */}
                {sortedAndFilteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Layers className="h-7 w-7 text-muted-foreground/40" />
                        <p className="text-sm font-medium">Nessuna commessa trovata nel secchiello corrente.</p>
                        <p className="text-xs text-muted-foreground max-w-sm">
                          Puoi inserire una nuova commessa compilando la riga in alto o reimpostando i filtri.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedDept('ALL');
                            setShowAllWeeks(true);
                            setSearchQuery('');
                          }}
                          className="mt-1 text-xs h-7"
                        >
                          Azzera tutti i filtri
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedAndFilteredJobs.map((job) => {
                    const hours = calculateJobHours(job);
                    const weekInfo = getJobWeekAndYear(job);
                    const currentJobWeekStr = weekInfo ? `W${weekInfo.week}` : 'Non ass.';
                    const mrp = getJobMRPStatus(job);
                    const deptGroup = getJobDepartmentGroup(job);
                    const currentStatus = normalizeJobStatus(job.status);

                    const isPrinted = Boolean((job as any).odlPrinted || job.isPrinted);
                    const currentOdlValue = odlDrafts[job.id] !== undefined 
                      ? odlDrafts[job.id] 
                      : (job.numeroODLInterno || job.numeroODL || '');

                    const currentDeliveryDateDisplay = dateDrafts[job.id] !== undefined 
                      ? dateDrafts[job.id] 
                      : formatDateForDisplay(job.dataConsegnaFinale);

                    return (
                      <tr
                        key={job.id}
                        className="divide-x divide-border hover:bg-muted/30 transition-colors group"
                      >
                        {/* 1. REPARTO (Solo il badge dedicato) */}
                        <td className="py-1.5 px-1.5 text-center align-middle">
                          {deptGroup === 'CP' && (
                            <span className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-bold font-mono text-[10px] px-1 py-0.5 rounded-xs">
                              CP
                            </span>
                          )}
                          {deptGroup === 'CG' && (
                            <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-bold font-mono text-[10px] px-1 py-0.5 rounded-xs">
                              CG
                            </span>
                          )}
                          {deptGroup === 'BF' && (
                            <span className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30 font-bold font-mono text-[10px] px-1 py-0.5 rounded-xs">
                              BF
                            </span>
                          )}
                          {deptGroup === 'OTHER' && (
                            <span className="bg-slate-500/15 text-slate-700 dark:text-slate-400 border border-slate-500/30 font-bold font-mono text-[9px] px-1 py-0.5 rounded-xs truncate max-w-[45px] inline-block">
                              {job.department || 'N/D'}
                            </span>
                          )}
                        </td>

                        {/* 2. ORDINE */}
                        <td className="py-1.5 px-2.5 align-middle">
                          <span className="font-mono font-bold text-foreground tracking-tight">
                            {job.ordinePF || 'N/A'}
                          </span>
                        </td>

                        {/* 3. CLIENTE */}
                        <td className="py-1.5 px-2.5 align-middle">
                          <span className="text-[11px] text-foreground font-medium truncate block max-w-[130px]" title={job.cliente}>
                            {job.cliente || 'Non specificato'}
                          </span>
                        </td>

                        {/* 4. ARTICOLO (Badge rimosso) */}
                        <td className="py-1.5 px-3 align-middle">
                          <span className="font-semibold text-foreground truncate block max-w-[250px]" title={job.details}>
                            {job.details || 'Articolo non indicato'}
                          </span>
                        </td>

                        {/* 5. Q.TÀ (Separata) */}
                        <td className="py-1.5 px-2 text-right align-middle font-mono font-bold text-foreground">
                          {(job.qta || 0).toLocaleString('it-IT')}
                        </td>

                        {/* 6. ORE PREV. (Separata) */}
                        <td className="py-1.5 px-2 text-right align-middle font-mono text-[11px] text-muted-foreground font-medium">
                          {hours.toFixed(1)} h
                        </td>

                        {/* 7. DATA CONS. (Inline Editable GG/MM/AAAA) */}
                        <td className="py-1 px-1.5 text-center align-middle">
                          <input
                            type="text"
                            value={currentDeliveryDateDisplay}
                            placeholder="GG/MM/AAAA"
                            onChange={(e) => {
                              const val = e.target.value;
                              setDateDrafts(prev => ({ ...prev, [job.id]: val }));
                            }}
                            onBlur={() => handleDeliveryDateBlur(job)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            className={cn(
                              "h-6 text-[11px] font-mono font-semibold text-center px-1 py-0 w-full rounded border transition-colors",
                              "hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary",
                              !job.dataConsegnaFinale 
                                ? "border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground" 
                                : "border-border bg-background text-foreground"
                            )}
                            title="Clicca per modificare la data (GG/MM/AAAA) e premi Invio"
                          />
                        </td>

                        {/* 8. N° ODL (Input Rapido) */}
                        <td className="py-1 px-1.5 text-center align-middle">
                          <Input
                            type="text"
                            value={currentOdlValue}
                            placeholder="Es. 185/PF"
                            onChange={(e) => {
                              const val = e.target.value;
                              setOdlDrafts((prev) => ({ ...prev, [job.id]: val }));
                            }}
                            onBlur={() => handleOdlBlur(job)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            className={cn(
                              "h-6 text-[11px] font-mono font-bold text-center px-1 py-0 w-full rounded border",
                              !currentOdlValue 
                                ? "border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground" 
                                : "border-border bg-background text-foreground"
                            )}
                          />
                        </td>

                        {/* 9. STATO MRP */}
                        <td className="py-1.5 px-1.5 text-center align-middle">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border cursor-help ${mrp.badgeClass}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${mrp.dotClass}`}></span>
                                <span>{mrp.label}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[340px] text-xs p-2.5">
                              <div className="font-bold border-b pb-1 mb-1 text-[11px] flex items-center justify-between">
                                <span>Fabbisogni MRP • {job.ordinePF}</span>
                                <span className="font-normal text-muted-foreground text-[10px]">{mrp.label}</span>
                              </div>
                              <ul className="space-y-1 text-[10px]">
                                {mrp.details.map((d, idx) => (
                                  <li key={idx} className="leading-tight">
                                    {d}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        </td>

                        {/* 10. SETTIMANA ASSEGNATA */}
                        <td className="py-1 px-1.5 text-center align-middle">
                          <Select
                            defaultValue={currentJobWeekStr}
                            onValueChange={(newWeek) => {
                              toast({
                                title: "Spostamento Commessa",
                                description: `Commessa ${job.ordinePF} riassegnata a ${newWeek}.`,
                              });
                            }}
                          >
                            <SelectTrigger className="h-6 text-[11px] font-mono py-0 px-1.5 w-full justify-between">
                              <SelectValue placeholder="Settimana" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="W42" className="text-xs font-mono">Sett. 42 (13-19 Ott)</SelectItem>
                              <SelectItem value="W43" className="text-xs font-mono">Sett. 43 (20-26 Ott)</SelectItem>
                              <SelectItem value="W44" className="text-xs font-mono">Sett. 44 (27 Ott - 02 Nov)</SelectItem>
                              <SelectItem value="W45" className="text-xs font-mono">Sett. 45 (03-09 Nov)</SelectItem>
                              <SelectItem value="W46" className="text-xs font-mono">Sett. 46 (10-16 Nov)</SelectItem>
                              <SelectItem value="W47" className="text-xs font-mono">Sett. 47 (17-23 Nov)</SelectItem>
                              <SelectItem value="Non ass." className="text-xs font-mono">Non assegnata</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>

                        {/* 11. STATO COMMESSA */}
                        <td className="py-1 px-1.5 text-center align-middle">
                          <Select
                            value={currentStatus}
                            onValueChange={(val: JobStatusOption) => handleStatusChange(job, val)}
                          >
                            <SelectTrigger className={cn(
                              "h-6 text-[11px] font-semibold py-0 px-1.5 w-full justify-between rounded border",
                              currentStatus === 'Pianificata' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
                              currentStatus === 'In Produzione' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold",
                              currentStatus === 'Completato Prod.' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-bold",
                              currentStatus === 'Spedito' && "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                            )}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Pianificata" className="text-xs font-medium text-blue-600">
                                Pianificata
                              </SelectItem>
                              <SelectItem value="In Produzione" className="text-xs font-bold text-amber-600">
                                In Produzione
                              </SelectItem>
                              <SelectItem value="Completato Prod." className="text-xs font-bold text-emerald-600">
                                Completato Prod.
                              </SelectItem>
                              <SelectItem value="Spedito" className="text-xs font-medium text-purple-600">
                                Spedito
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </td>

                        {/* 12. AZIONI (Stampa con vincolo ODL + Avvia) */}
                        <td className="py-1 px-1.5 text-center align-middle">
                          <div className="flex items-center justify-center gap-1">
                            {/* Stampa ODL */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleTogglePrintODL(job)}
                                  className={cn(
                                    "h-7 w-7 transition-colors",
                                    isPrinted 
                                      ? "text-green-500 hover:text-green-600 bg-green-500/10 hover:bg-green-500/20" 
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                  )}
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isPrinted 
                                  ? "ODL stampato (clicca per ristampare o deselezionare)" 
                                  : "Stampa ODL (richiede N° ODL)"}
                              </TooltipContent>
                            </Tooltip>

                            {/* Avvia in Produzione (Aggiorna a In Produzione) */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleStartProduction(job)}
                                  disabled={currentStatus === 'In Produzione' || currentStatus === 'Completato Prod.'}
                                  className={cn(
                                    "h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10",
                                    (currentStatus === 'In Produzione' || currentStatus === 'Completato Prod.') && "opacity-40 cursor-not-allowed"
                                  )}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {currentStatus === 'In Produzione' ? "Già in Produzione" : "Avvia in Produzione"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* =========================================================================
            MODALI HUB INSERIMENTO
        ========================================================================== */}
        {/* 1. SmartJobModal (Nuova Commessa Rapida) */}
        {globalSettings && (
          <SmartJobModal
            isOpen={isSmartJobOpen}
            onClose={() => setIsSmartJobOpen(false)}
            settings={globalSettings}
            onJobSaved={(newJob) => {
              setJobs((prev) => {
                const exists = prev.some((j) => j.id === newJob.id);
                if (exists) return prev.map((j) => (j.id === newJob.id ? { ...j, ...newJob } : j));
                return [newJob, ...prev];
              });
              const weekInfo = getJobWeekAndYear(newJob);
              if (weekInfo && (weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear)) {
                toast({
                  title: "Commessa Creata",
                  description: `Ordine ${newJob.ordinePF} inserito per Settimana ${weekInfo.week}/${weekInfo.year}.`,
                });
              }
            }}
          />
        )}

        {/* 2. SmartPasteModal (Import da Excel) */}
        <SmartPasteModal
          isOpen={isSmartPasteOpen}
          onClose={() => setIsSmartPasteOpen(false)}
          articles={articles}
          departments={departments}
          onJobsCreated={(newJobs) => {
            setJobs((prev) => [...newJobs, ...prev]);
            toast({
              title: "Commesse Importate",
              description: `${newJobs.length} commesse inserite con successo.`,
            });
          }}
        />

        {/* 3. Nuova Commessa Manuale (Componente Originale Gestione Dati Commesse) */}
        <ManualJobModal
          isOpen={isManualCreateOpen}
          onClose={() => setIsManualCreateOpen(false)}
          workCycles={workCycles}
          departments={departments}
          onJobCreated={(newJob) => {
            setJobs((prev) => [newJob, ...prev]);
            const weekInfo = getJobWeekAndYear(newJob);
            if (weekInfo && (weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear)) {
              toast({
                title: "Commessa Creata",
                description: `Ordine ${newJob.ordinePF} inserito per Settimana ${weekInfo.week}/${weekInfo.year}. Non appare nel secchiello corrente (Settimana ${selectedWeekNumber}).`,
              });
            } else {
              toast({
                title: "Commessa Creata",
                description: `Ordine ${newJob.ordinePF} inserito con successo nel secchiello.`,
              });
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}
