"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  Search, 
  Clock, 
  Layers, 
  Printer, 
  Play, 
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
  Package,
  Layers3,
  CalendarCheck
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, getWeek, getYear, addWeeks, subWeeks } from 'date-fns';
import { it } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import { useToast } from '@/hooks/use-toast';
import { parseRobustDate, cn } from '@/lib/utils';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import { calculateMRPTimelines, type MRPTimelineEntry } from '@/lib/mrp-utils';
import { getJobOrders, getTargetedMRPData, toggleJobPrinted } from './actions';

interface ProgrammazioneClientPageProps {
  initialJobs: JobOrder[];
  initialDepartments: Department[];
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

// Identifica il macro-reparto di una commessa
export function getJobDepartmentGroup(job: JobOrder): 'CP' | 'CG' | 'BF' | 'OTHER' {
  const d = (job.department || '').toUpperCase().trim();
  if (d === 'CP' || d.includes('PICCOL') || d.includes('CONNESSIONI PICCOLE')) return 'CP';
  if (d === 'CG' || d.includes('GRAND') || d.includes('CONNESSIONI GRANDI')) return 'CG';
  if (d === 'BF' || d.includes('BARRE') || d.includes('REPARTO BARRE')) return 'BF';

  // Controllo anche tra le fasi
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

// Calcola le ore stimate per una commessa
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
  // Stima di fallback standard (10 min per pezzo se non indicato diversamente)
  return Math.round((((job.qta || 0) * 10) / 60) * 10) / 10;
}

// Estrae la settimana (1-53) e l'anno da una commessa
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

// Configurazione capacità giornaliera per secchiello
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

export default function ProgrammazioneClientPage({
  initialJobs,
  initialDepartments,
}: ProgrammazioneClientPageProps) {
  const { toast } = useToast();

  // Dati Commesse
  const [jobs, setJobs] = useState<JobOrder[]>(initialJobs || []);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 1. Filtro Fisso 4 Macro-Gruppi Reparti
  const [selectedDept, setSelectedDept] = useState<MacroDepartmentCode>('ALL');

  // Filtro Settimana (Secchiello Temporale)
  const [currentDateReference, setCurrentDateReference] = useState<Date>(new Date());
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  // Filtro Ricerca Testuale
  const [searchQuery, setSearchQuery] = useState('');

  // 3. Ordinamento Intestazione
  const [sortField, setSortField] = useState<'ordinePF' | null>('ordinePF');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 2. Miniaturizzazione Header Capacità (Input Giornalieri + Straordinari)
  // Mappato per combinazione reparto-settimana per permettere futuri salvataggi DB
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

  // Formula "Ore Disponibili": (Somma addetti L,M,M,G,V * 7.6h) + Ore Straordinario
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

  // Ricaricamento Dati
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
      console.error("Errore durante il refresh:", error);
      toast({
        title: "Errore di caricamento",
        description: "Impossibile aggiornare i dati delle commesse.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle Ordinamento
  const handleSortToggle = () => {
    if (sortField === 'ordinePF') {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField('ordinePF');
      setSortDirection('asc');
    }
  };

  // 1. Filtraggio Commesse Lato Client
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // 1. Filtro Reparto (Macro-gruppi CP, CG, BF o TUTTI)
      if (selectedDept !== 'ALL') {
        const group = getJobDepartmentGroup(job);
        if (group !== selectedDept) {
          return false;
        }
      }

      // 2. Filtro Settimana
      if (!showAllWeeks) {
        const weekInfo = getJobWeekAndYear(job);
        if (!weekInfo) return false;
        if (weekInfo.week !== selectedWeekNumber || weekInfo.year !== selectedYear) {
          return false;
        }
      }

      // 3. Filtro Ricerca Testuale
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchPf = (job.ordinePF || '').toLowerCase().includes(q);
        const matchCliente = (job.cliente || '').toLowerCase().includes(q);
        const matchArticle = (job.details || '').toLowerCase().includes(q);
        if (!matchPf && !matchCliente && !matchArticle) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, selectedDept, showAllWeeks, selectedWeekNumber, selectedYear, searchQuery]);

  // Ordinamento dei risultati filtrati
  const sortedAndFilteredJobs = useMemo(() => {
    const list = [...filteredJobs];
    if (sortField === 'ordinePF') {
      list.sort((a, b) => {
        const pfA = String(a.ordinePF || '');
        const pfB = String(b.ordinePF || '');
        const res = pfA.localeCompare(pfB, undefined, { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? res : -res;
      });
    }
    return list;
  }, [filteredJobs, sortField, sortDirection]);

  // Conteggi e metriche del Secchiello corrente
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

  // Conteggio commesse per ciascun macro-reparto per la settimana attiva
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

  // =========================================================================
  // 4. INIEZIONE MRP MIRATA (TARGETED FETCHING & BACKGROUND CACHE)
  // =========================================================================
  const materialsCacheRef = useRef<Map<string, RawMaterial>>(new Map());
  const poCacheRef = useRef<Map<string, PurchaseOrder[]>>(new Map());
  const articlesCacheRef = useRef<Map<string, Article>>(new Map());
  const globalSettingsRef = useRef<GlobalSettings | null>(null);

  const [mrpCacheVersion, setMrpCacheVersion] = useState(0);
  const [isMrpLoading, setIsMrpLoading] = useState(false);

  // Estrai i codici materiali e articoli necessari ESCLUSIVAMENTE per le commesse VISIBILI
  const { visibleMaterialCodes, visibleArticleCodes } = useMemo(() => {
    const matSet = new Set<string>();
    const artSet = new Set<string>();

    sortedAndFilteredJobs.forEach((job) => {
      const bom = job.billOfMaterials || [];
      if (bom.length > 0) {
        bom.forEach((item) => {
          if (item.component) matSet.add(item.component.trim().toUpperCase());
        });
      } else if (job.details) {
        // Se la commessa non ha la BOM inserita direttamente, consideriamo l'articolo per recuperarla
        artSet.add(job.details.trim().toUpperCase());
      }
    });

    return {
      visibleMaterialCodes: Array.from(matSet),
      visibleArticleCodes: Array.from(artSet),
    };
  }, [sortedAndFilteredJobs]);

  // Background fetch per materiali mancanti nella cache locale
  useEffect(() => {
    let isCancelled = false;

    const missingMaterials = visibleMaterialCodes.filter(
      (code) => !materialsCacheRef.current.has(code)
    );
    const missingArticles = visibleArticleCodes.filter(
      (code) => !articlesCacheRef.current.has(code)
    );

    // Se tutti i dati necessari sono già in cache, non facciamo query di rete
    if (missingMaterials.length === 0 && missingArticles.length === 0) {
      return;
    }

    setIsMrpLoading(true);

    getTargetedMRPData(missingMaterials, missingArticles)
      .then((data) => {
        if (isCancelled) return;

        // Aggiorna la cache dei materiali
        data.rawMaterials.forEach((m) => {
          if (m.code) materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
        });

        // Aggiorna la cache dei POs raggruppati per materialCode
        data.purchaseOrders.forEach((po) => {
          const code = (po.materialCode || '').trim().toUpperCase();
          if (code) {
            const list = poCacheRef.current.get(code) || [];
            list.push(po);
            poCacheRef.current.set(code, list);
          }
        });

        // Aggiorna la cache degli articoli
        data.articles.forEach((a) => {
          if (a.code) articlesCacheRef.current.set(a.code.trim().toUpperCase(), a);
        });

        if (data.globalSettings) {
          globalSettingsRef.current = data.globalSettings;
        }

        // Segnala l'aggiornamento della cache per ricalcolare useMemo
        setMrpCacheVersion((v) => v + 1);
      })
      .catch((err) => {
        console.error("Errore nel caricamento mirato MRP:", err);
      })
      .finally(() => {
        if (!isCancelled) setIsMrpLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [visibleMaterialCodes, visibleArticleCodes]);

  // Calcolo delle Timeline MRP tramite `calculateMRPTimelines` di `mrp-utils.ts`
  const mrpTimelines = useMemo(() => {
    if (sortedAndFilteredJobs.length === 0) {
      return new Map<string, MRPTimelineEntry[]>();
    }

    // Prepariamo l'elenco commesse con BOM integrata da articoli se mancante
    const enrichedJobs: JobOrder[] = sortedAndFilteredJobs.map((job) => {
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
  }, [sortedAndFilteredJobs, mrpCacheVersion]);

  // Calcolo dello Stato Semaforo per singola commessa
  const getJobMRPStatus = useCallback((job: JobOrder): {
    state: 'RED' | 'LATE' | 'GREEN' | 'NO_BOM' | 'LOADING';
    label: string;
    badgeClass: string;
    dotClass: string;
    details: string[];
  } => {
    // 1. Verifica BOM
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
        label: 'No Distinta',
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

    // Raccogli le entry MRP dai materiali pendenti
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

    if (entries.length === 0 && (hasMissingData || isMrpLoading)) {
      return {
        state: 'LOADING',
        label: 'In Verifica...',
        badgeClass: 'bg-muted text-muted-foreground border-border animate-pulse',
        dotClass: 'bg-muted-foreground',
        details: ['Caricamento mirato giacenze e ordini in corso...'],
      };
    }

    // Regola richiesta: Basato sul materiale peggiore:
    // 🔴 Mancante (se almeno un materiale è RED)
    // 🟠 In Ritardo/Arrivo (se nessun Rosso ma almeno un LATE / AMBER / ORDERED)
    // 🟢 Pronto (tutti GREEN)
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

  // 3. Workflow ODL: Stampa con stato persistente e feedback ottimistico
  const handleTogglePrintODL = async (job: JobOrder) => {
    const isCurrentlyPrinted = Boolean((job as any).odlPrinted || job.isPrinted);
    const nextStatus = !isCurrentlyPrinted;

    // Aggiornamento Ottimistico Immediato
    setJobs((prevJobs) =>
      prevJobs.map((j) =>
        j.id === job.id ? { ...j, isPrinted: nextStatus, odlPrinted: nextStatus } : j
      )
    );

    toast({
      title: nextStatus ? "ODL Contrassegnato Stampato" : "ODL Ripristinato da Stampare",
      description: `Commessa ${job.ordinePF}: icona stampa aggiornata.`,
    });

    // Chiamata Server Action in background
    try {
      await toggleJobPrinted(job.id, isCurrentlyPrinted);
    } catch (e) {
      console.error("Errore salvataggio stato stampa:", e);
      // Revert in caso di errore
      setJobs((prevJobs) =>
        prevJobs.map((j) =>
          j.id === job.id ? { ...j, isPrinted: isCurrentlyPrinted, odlPrinted: isCurrentlyPrinted } : j
        )
      );
    }
  };

  const handleStartProduction = (job: JobOrder) => {
    toast({
      title: "Avvio Produzione (Fase Successiva)",
      description: `Commessa ${job.ordinePF} pronta per la transizione di stato.`,
    });
  };

  // Generatore opzioni per il dropdown rapido settimane
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
            HEADER PRINCIPALE COMPATTO
        ========================================================================== */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2.5">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
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
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Targeted MRP...
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 h-7 text-xs px-2.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Ricarica...' : 'Aggiorna'}</span>
            </Button>
          </div>
        </div>

        {/* =========================================================================
            1. TOP BAR: FILTRO FISSO AI SOLI 4 MACRO-REPARTI ESSENZIALI
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
          {/* Navigatore Settimana */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border rounded-md bg-background shadow-2xs">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevWeek}
                disabled={showAllWeeks}
                className="h-7 w-7 rounded-r-none"
                title="Settimana precedente"
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
                title="Settimana successiva"
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

            {/* Quick jump select */}
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

          {/* Ricerca Rapida */}
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cerca Ordine PF, cliente, articolo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>
        </div>

        {/* =========================================================================
            2. MINIATURIZZAZIONE HEADER CAPACITÀ (RIGA ULTRA-COMPATTA INLINE)
        ========================================================================== */}
        <div className="bg-card border rounded-md px-3 py-1.5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          {/* Input Addetti Giornalieri (L, M, M, G, V) + Straordinari */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 text-blue-500" />
              Addetti:
            </span>

            {/* L */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
              <span className="font-bold text-[10px] text-muted-foreground">L:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={currentCapacity.L}
                onChange={(e) => handleCapacityChange('L', parseInt(e.target.value))}
                className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Lunedì"
              />
            </div>

            {/* M */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
              <span className="font-bold text-[10px] text-muted-foreground">M:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={currentCapacity.M}
                onChange={(e) => handleCapacityChange('M', parseInt(e.target.value))}
                className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Martedì"
              />
            </div>

            {/* M (Mercoledì) */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
              <span className="font-bold text-[10px] text-muted-foreground">M:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={currentCapacity.Me}
                onChange={(e) => handleCapacityChange('Me', parseInt(e.target.value))}
                className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Mercoledì"
              />
            </div>

            {/* G */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
              <span className="font-bold text-[10px] text-muted-foreground">G:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={currentCapacity.G}
                onChange={(e) => handleCapacityChange('G', parseInt(e.target.value))}
                className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Giovedì"
              />
            </div>

            {/* V */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border">
              <span className="font-bold text-[10px] text-muted-foreground">V:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={currentCapacity.V}
                onChange={(e) => handleCapacityChange('V', parseInt(e.target.value))}
                className="w-8 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Venerdì"
              />
            </div>

            {/* + Straordinario (h) */}
            <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-0.5 rounded border ml-1">
              <span className="font-bold text-[10px] text-muted-foreground">+ Straord:</span>
              <input
                type="number"
                min={0}
                max={100}
                value={currentCapacity.overtime}
                onChange={(e) => handleCapacityChange('overtime', parseFloat(e.target.value))}
                className="w-10 h-5 text-center font-mono font-bold bg-background border rounded text-xs px-0.5 focus:outline-hidden focus:ring-1 focus:ring-primary"
                title="Ore di straordinario totali"
              />
              <span className="text-[10px] text-muted-foreground font-mono">h</span>
            </div>
          </div>

          {/* KPI Inline: Ore Disponibili, Ore Caricate, Saturazione, Bilancio */}
          <div className="flex items-center gap-4 flex-wrap text-xs">
            {/* Ore Disponibili */}
            <div className="flex items-baseline gap-1" title="(Somma addetti * 7.6h) + Straordinari">
              <span className="text-muted-foreground text-[11px]">Disp:</span>
              <span className="font-mono font-bold text-foreground">{availableHours.toFixed(1)}h</span>
            </div>

            {/* Ore Caricate */}
            <div className="flex items-baseline gap-1" title="Somma ore delle commesse visibili">
              <span className="text-muted-foreground text-[11px]">Caricate:</span>
              <span className="font-mono font-bold text-foreground">{bucketMetrics.loadedHours.toFixed(1)}h</span>
              <span className="text-[10px] text-muted-foreground">({bucketMetrics.totalJobs} com.)</span>
            </div>

            {/* Saturazione */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-[11px]">Saturaz:</span>
              <Badge
                variant="outline"
                className={`font-mono font-bold text-[10px] px-1.5 py-0 ${
                  bucketMetrics.saturationPercent > 100
                    ? 'border-red-500/50 text-red-600 bg-red-500/10'
                    : bucketMetrics.saturationPercent > 85
                      ? 'border-amber-500/50 text-amber-600 bg-amber-500/10'
                      : 'border-emerald-500/50 text-emerald-600 bg-emerald-500/10'
                }`}
              >
                {bucketMetrics.saturationPercent}%
              </Badge>
            </div>

            {/* Bilancio */}
            <div className="flex items-baseline gap-1">
              <span className="text-muted-foreground text-[11px]">Bilancio:</span>
              <span className={`font-mono font-bold text-[11px] ${
                bucketMetrics.balanceHours < 0 ? 'text-red-600' : 'text-emerald-600'
              }`}>
                {bucketMetrics.balanceHours >= 0 ? `+${bucketMetrics.balanceHours}h` : `${bucketMetrics.balanceHours}h`}
              </span>
            </div>
          </div>
        </div>

        {/* =========================================================================
            3 & 4. DATAGRID (STILE EXCEL): BADGE REPARTO, ORDINAMENTO, WORKFLOW ODL E MRP REALE
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
                  {/* Ordinamento Cliccabile su Ordine / Cliente */}
                  <th 
                    onClick={handleSortToggle}
                    className="py-2 px-3 text-left w-[210px] cursor-pointer select-none hover:bg-muted/90 transition-colors"
                    title="Clicca per ordinare per Ordine PF"
                  >
                    <div className="flex items-center justify-between">
                      <span>Ordine / Cliente</span>
                      {sortField === 'ordinePF' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                      )}
                    </div>
                  </th>

                  <th className="py-2 px-3 text-left min-w-[240px]">Articolo</th>
                  <th className="py-2 px-3 text-right w-[85px]">Quantità</th>
                  <th className="py-2 px-3 text-right w-[105px]">Ore Prev.</th>
                  <th className="py-2 px-3 text-center w-[115px]">Data Cons.</th>
                  
                  {/* Stato MRP Reale */}
                  <th className="py-2 px-3 text-center w-[130px] bg-muted/80">
                    Stato MRP
                  </th>

                  {/* Settimana Assegnata */}
                  <th className="py-2 px-3 text-center w-[160px] bg-muted/80">
                    Settimana
                  </th>

                  {/* Azioni Rapide */}
                  <th className="py-2 px-3 text-center w-[115px] bg-muted/80">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-normal">
                {sortedAndFilteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Layers className="h-7 w-7 text-muted-foreground/40" />
                        <p className="text-sm font-medium">Nessuna commessa trovata nel secchiello corrente.</p>
                        <p className="text-xs text-muted-foreground max-w-sm">
                          Nessun record per il reparto <strong>{selectedDept}</strong> nella <strong>Settimana {selectedWeekNumber}</strong>.
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

                    // Workflow ODL: Se stampato, icona verde brillante
                    const isPrinted = Boolean((job as any).odlPrinted || job.isPrinted);

                    return (
                      <tr
                        key={job.id}
                        className="divide-x divide-border hover:bg-muted/30 transition-colors group"
                      >
                        {/* 1. Ordine / Cliente */}
                        <td className="py-1.5 px-3 align-middle">
                          <div className="font-mono font-bold text-foreground tracking-tight">
                            {job.ordinePF || 'N/A'}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[195px]" title={job.cliente}>
                            {job.cliente || 'Cliente non specificato'}
                          </div>
                        </td>

                        {/* 2. Articolo con Label Reparto [CP], [CG], [BF] */}
                        <td className="py-1.5 px-3 align-middle">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Label Reparto inline */}
                            {deptGroup === 'CP' && (
                              <span className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-bold font-mono text-[10px] px-1 rounded-xs">
                                [CP]
                              </span>
                            )}
                            {deptGroup === 'CG' && (
                              <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-bold font-mono text-[10px] px-1 rounded-xs">
                                [CG]
                              </span>
                            )}
                            {deptGroup === 'BF' && (
                              <span className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30 font-bold font-mono text-[10px] px-1 rounded-xs">
                                [BF]
                              </span>
                            )}
                            {deptGroup === 'OTHER' && job.department && (
                              <span className="bg-slate-500/15 text-slate-700 dark:text-slate-400 border border-slate-500/30 font-bold font-mono text-[10px] px-1 rounded-xs">
                                [{job.department}]
                              </span>
                            )}

                            <span className="font-semibold text-foreground truncate max-w-[280px]" title={job.details}>
                              {job.details || 'Articolo non indicato'}
                            </span>
                          </div>
                        </td>

                        {/* 3. Quantità */}
                        <td className="py-1.5 px-3 text-right align-middle font-mono font-semibold text-foreground">
                          {(job.qta || 0).toLocaleString('it-IT')} <span className="text-[10px] text-muted-foreground font-normal">pz</span>
                        </td>

                        {/* 4. Ore Previste */}
                        <td className="py-1.5 px-3 text-right align-middle">
                          <span className="font-mono font-semibold text-foreground">
                            {hours.toFixed(1)}
                          </span>{' '}
                          <span className="text-[10px] text-muted-foreground">h</span>
                        </td>

                        {/* 5. Data Consegna */}
                        <td className="py-1.5 px-3 text-center align-middle font-mono text-[11px]">
                          {job.dataConsegnaFinale ? (
                            <span>{job.dataConsegnaFinale}</span>
                          ) : (
                            <span className="text-muted-foreground italic">Non def.</span>
                          )}
                        </td>

                        {/* 6. Stato MRP Reale (con Tooltip dettagli componenti) */}
                        <td className="py-1.5 px-2 text-center align-middle">
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

                        {/* 7. Settimana di Assegnazione (Dropdown) */}
                        <td className="py-1 px-2 text-center align-middle">
                          <Select
                            defaultValue={currentJobWeekStr}
                            onValueChange={(newWeek) => {
                              toast({
                                title: "Spostamento Commessa (Placeholder)",
                                description: `Commessa ${job.ordinePF} su ${newWeek}. Il salvataggio Optimistic UI sarà cablato nella Fase 3/4.`,
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

                        {/* 8. Azioni Rapide (Stampa ODL con Verde brillante se stampato + Avvia) */}
                        <td className="py-1 px-2 text-center align-middle">
                          <div className="flex items-center justify-center gap-1">
                            {/* Tasto Stampa ODL */}
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
                                  ? "ODL già stampato (clicca per ristampare o deselezionare)" 
                                  : "Stampa ODL"}
                              </TooltipContent>
                            </Tooltip>

                            {/* Tasto Avvia Produzione (Sempre visibile, non nasconde la stampa) */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleStartProduction(job)}
                                  className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Avvia in Produzione</TooltipContent>
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
      </div>
    </TooltipProvider>
  );
}
