"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
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
  BellOff,
  Bell,
  HelpCircle,
  Loader2,
  Zap,
  CornerDownLeft,
  CalendarDays,
  Layers,
  Calendar,
  Clock,
  Truck,
  Download,
  AlertCircle,
  PackageCheck,
  Pencil,
  RotateCcw,
  Undo2,
  Lock,
  Trash2,
  Calculator,
  Circle,
  PauseCircle,
  EyeOff,
  Hourglass,
  Activity,
  Target,
  Split
} from 'lucide-react';
import { format, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear, addWeeks, subWeeks } from 'date-fns';
import { it } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';
import { parseRobustDate, cn } from '@/lib/utils';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article, WorkCycle, JobPhase, WorkPhaseTemplate, MaterialWithdrawal } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import {
  calculateMRPTimelines,
  type MRPTimelineEntry,
  classifyGlobalMRPAlarms,
  isBOMItemPhaseCompleted,
  buildJobComponentWithdrawalIndex,
  getJobComponentWithdrawnQty,
} from '@/lib/mrp-utils';
import { isJobEligibleForArticleSync, computeArticleCycleSyncForJob } from '@/lib/article-cycle-sync';
import { syncJobBOMItems, calculateBOMRequirement } from '@/lib/inventory-utils';
import { getCleanOdlValue, getJobCleanOdl } from '@/lib/odl-numerator';
import { evaluateJobStartEligibility } from '@/lib/job-status';
import { quickArticleCache } from '@/lib/quick-article-cache';
import {
  withNetworkRetry,
  withSilentNetworkRetry,
  handleFirestoreListenerError,
  emitNetworkStatus,
  PROGRAMMAZIONE_SWR_CONFIG,
} from '@/lib/network-resilience';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';
import { SmartJobModal } from '@/components/mrp/SmartJobModal';
import { SmartPasteModal } from '@/components/mrp/SmartPasteModal';
import { ExcelImportModal } from '@/components/mrp/ExcelImportModal';
import { ManualMultiAddModal } from '@/components/mrp/ManualMultiAddModal';
import { EditStandardJobModal } from '@/components/mrp/EditStandardJobModal';
import { ContoLavoroModal } from '@/components/mrp/ContoLavoroModal';
import { QuickArticleEditDrawer } from '@/components/mrp/QuickArticleEditDrawer';
import { SplitJobDialog } from '@/components/mrp/SplitJobDialog';
import { ConfirmOdlDialog } from '@/components/mrp/ConfirmOdlDialog';
import { EditJobNoteDialog } from '@/components/mrp/EditJobNoteDialog';
import {
  getJobOrders,
  getActiveJobOrders,
  fetchCompletedJobOrdersAction,
  getMrpSyncMeta,
  getTargetedMRPData,
  forceRecalculateMRPAction,
  toggleJobPrinted,
  markJobAsPrinted,
  markJobAsPrintedAndInProduction,
  startJobProduction,
  getNextOdlNumber,
  updateJobExecutionStatus,
  updateJobOdlNumber,
  checkUniqueODL,
  updateJobStatus,
  updateJobNote,
  updateJobDeliveryDate,
  updateJobAssignedWeek,
  bulkUpdateJobDeliveryDate,
  bulkShipJobs,
  bulkStartProductionAndPrint,
  bulkStartProduction,
  bulkMarkJobsAsPrinted,
  getCapacityBuckets,
  saveCapacityBucket,
  propagateCapacityForward,
  exportPlanningReportAction,
  deleteJobOrder,
  bulkDeleteJobOrders,
  muteMaterialOnJob,
  unmuteMaterialOnJob,
  toggleExternalizedMaterial,
  updateExternalizedMaterials,
  getOdlPrintData,
  type DayCapacityConfigData
} from './actions';
import {
  AGGREGATE_PRODUCTION_DEPTS,
  aggregateCompanyCapacity,
  filterJobsForCapacityMetrics,
  getJobDepartmentGroup,
  isCapacityPeriodAtOrAfter,
  type MacroDepartmentCode,
} from '@/lib/capacity-utils';
export { getJobDepartmentGroup, type MacroDepartmentCode };
import { collection, onSnapshot, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getJobDisplayStatus, getDerivedJobStatus, rollbackLastCompletedPhase, type JobDisplayStatus } from '@/lib/job-status';
import {
  DEFAULT_MRP_SYNC_META,
  normalizeMrpSyncMeta,
  evaluateMrpSyncDiff,
  acknowledgeLocalMrpSyncMeta,
  collectGlobalMrpCodes,
  upsertPurchaseOrdersIntoCache,
  hasFullStockHydration,
  type MrpSyncMeta,
  type MrpSyncDomain,
} from '@/lib/mrp-sync-utils';
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
  initialPhaseTemplates?: WorkPhaseTemplate[];
  initialGlobalSettings?: GlobalSettings | null;
  initialOdlConfig?: ODLConfig;
  initialCapacities?: Record<string, DayCapacityConfigData>;
  initialMaterialSessions?: any[];
  initialNextOdl?: string;
  initialMrpSyncMeta?: MrpSyncMeta;
}

// 5 Macro-Gruppi Reparti (CP, CG, BF + MAG)
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
  { code: 'MAG', label: 'MAGAZZINO (MAG)', badge: 'MAG' },
];

export type JobStatusOption = JobDisplayStatus;
export type StatusFilterOption = 'ALL' | 'Pianificata' | 'In Produzione' | 'Completato Prod.' | 'Spedita';

export function normalizeJobStatus(jobOrStatus: JobOrder | string | undefined): JobStatusOption {
  if (!jobOrStatus) return 'Pianificata';
  if (typeof jobOrStatus === 'object') {
    return getJobDisplayStatus(jobOrStatus);
  }
  const s = String(jobOrStatus).toUpperCase().trim();
  if (s.includes('SPEDIT') || s === 'SHIPPED') return 'Spedito';
  if (s.includes('FINE') || s.includes('COMPLET') || s === 'CLOSED' || s === 'CHIUSO') return 'Completato Prod.';
  if (s.includes('PROD') || s.includes('LAVORAZ') || s.includes('ATTIV') || s.includes('ACTIVE') || s.includes('IN_PROGRESS') || s === 'DA_INIZIARE') return 'In Produzione';
  return 'Pianificata';
}

export function isJobFinished(jobOrStatus: JobOrder | string | undefined): boolean {
  if (!jobOrStatus) return false;
  if (typeof jobOrStatus === 'object') {
    const norm = getJobDisplayStatus(jobOrStatus);
    return norm === 'Completato Prod.' || norm === 'Spedito';
  }
  const norm = normalizeJobStatus(jobOrStatus);
  return norm === 'Completato Prod.' || norm === 'Spedito';
}

import {
  calculateJobHours,
  getTimeReliabilityStatus,
  getTimeReliabilityMeta,
  type TimeReliabilityStatus,
  type TimeReliabilityMeta
} from '@/lib/time-reliability';

import {
  STATUS_WEIGHTS,
  getJobStatusPriority,
  defaultJobStatusComparator,
} from '@/lib/job-sorting';

export {
  calculateJobHours,
  getTimeReliabilityStatus,
  getTimeReliabilityMeta,
  type TimeReliabilityStatus,
  type TimeReliabilityMeta,
  STATUS_WEIGHTS,
  getJobStatusPriority,
  defaultJobStatusComparator,
};

export interface WeekOption {
  value: string;
  weekNumber: number;
  year: number;
  label: string;
  shortLabel: string;
  date: Date;
}

/**
 * FASE 48: Generatore Dinamico delle Opzioni Settimana (Standard ISO 8601)
 * Analizza TUTTE le commesse caricate (jobs), estrae il minimo e massimo delle date (consegna / fine prep. / assegnata),
 * e genera ininterrottamente tutte le settimane dell'intervallo garantendo:
 * - Baseline minima (almeno da -4 a +12 settimane rispetto alla data corrente) per pianificazione rapida
 * - Copertura dinamica continua per qualsiasi commessa distante nel futuro (es. Marzo anno successivo)
 * - Inclusione dell'anno (es. "Sett. 1 / 2027") se l'elenco scavalca l'anno corrente o tocca più anni
 */
export function generateAvailableWeeksFromJobs(jobs: JobOrder[] = []): WeekOption[] {
  const now = new Date();
  const currentIsoWeek = getISOWeek(now);
  const currentIsoYear = getISOWeekYear(now);
  const currentMonday = startOfISOWeek(now);
  currentMonday.setHours(12, 0, 0, 0);

  // Baseline minima per navigazione immediata attorno ad oggi
  let minDate = addWeeks(currentMonday, -4);
  let maxDate = addWeeks(currentMonday, 12);

  // Analizza TUTTE le commesse caricate
  for (const job of jobs) {
    const candidates = [
      job.assignedDate,
      job.dataConsegnaFinale,
      job.dataFinePreparazione,
    ];

    for (const cand of candidates) {
      if (!cand || typeof cand !== 'string' || !cand.trim()) continue;
      const d = parseRobustDate(cand);
      if (d && !isNaN(d.getTime())) {
        const y = d.getFullYear();
        if (y >= 2020 && y <= 2040) {
          if (d.getTime() < minDate.getTime()) minDate = d;
          if (d.getTime() > maxDate.getTime()) maxDate = d;
        }
      }
    }

    // Se la commessa ha un targetWeek esplicito nel formato YYYY-Www
    if (job.targetWeek && typeof job.targetWeek === 'string') {
      const match = job.targetWeek.match(/^(\d{4})-W(\d{1,2})$/i);
      if (match) {
        const y = parseInt(match[1], 10);
        const w = parseInt(match[2], 10);
        if (y >= 2020 && y <= 2040 && w >= 1 && w <= 53) {
          const jan4 = new Date(y, 0, 4, 12, 0, 0);
          const mondayW1 = startOfISOWeek(jan4);
          const mondayTarget = addWeeks(mondayW1, w - 1);
          if (mondayTarget.getTime() < minDate.getTime()) minDate = mondayTarget;
          if (mondayTarget.getTime() > maxDate.getTime()) maxDate = mondayTarget;
        }
      }
    }
  }

  // Aggiungi un buffer di 2 settimane dopo la data massima per consentire slittamenti futuri
  maxDate = addWeeks(maxDate, 2);

  const startMonday = startOfISOWeek(minDate);
  startMonday.setHours(12, 0, 0, 0);

  const endMonday = startOfISOWeek(maxDate);
  endMonday.setHours(12, 0, 0, 0);

  const minYear = getISOWeekYear(startMonday);
  const maxYear = getISOWeekYear(endMonday);
  const hasMultipleYears = minYear !== maxYear || minYear !== currentIsoYear || maxYear !== currentIsoYear;

  const options: WeekOption[] = [];
  let cursor = new Date(startMonday);
  const maxIterations = 260; // Failsafe (fino a 5 anni di settimane continue)
  let iterations = 0;

  while (cursor.getTime() <= endMonday.getTime() && iterations < maxIterations) {
    iterations++;
    const w = getISOWeek(cursor);
    const y = getISOWeekYear(cursor);
    const start = startOfISOWeek(cursor);
    const end = endOfISOWeek(cursor);
    const isCurrent = w === currentIsoWeek && y === currentIsoYear;

    const startDay = format(start, 'dd');
    const startMonth = format(start, 'MMM', { locale: it }).slice(0, 3);
    const endDay = format(end, 'dd');
    const endMonth = format(end, 'MMM', { locale: it }).slice(0, 3);

    const capitalizedStartMonth = startMonth.charAt(0).toUpperCase() + startMonth.slice(1);
    const capitalizedEndMonth = endMonth.charAt(0).toUpperCase() + endMonth.slice(1);

    const rangeLabel = `${startDay} ${capitalizedStartMonth} - ${endDay} ${capitalizedEndMonth}`;
    const yearSuffix = (hasMultipleYears || y !== currentIsoYear) ? ` / ${y}` : '';

    options.push({
      value: `${y}-W${w}`,
      weekNumber: w,
      year: y,
      label: `Sett. ${w}${yearSuffix} ${isCurrent ? '(Corrente)' : ''} • ${rangeLabel}`,
      shortLabel: `Sett. ${w}${yearSuffix} (${rangeLabel})`,
      date: new Date(cursor),
    });

    cursor = addWeeks(cursor, 1);
  }

  return options;
}

/**
 * FASE 48: Risoluzione Settimana e Anno Commessa (con Assegnazione Automatica / Fallback di Default)
 * 1. Rispetta la disassegnazione esplicita manuale ('unassigned' / 'Non ass.')
 * 2. Rispetta l'assegnazione manuale/forzata (assignedDate, targetWeek, isoWeek+weekYear)
 * 3. Fallback di Default: auto-seleziona la settimana da dataConsegnaFinale o dataFinePreparazione
 */
export function getJobWeekAndYear(job: JobOrder): { week: number; year: number } | null {
  // 1. Disassegnazione esplicita manuale
  if (job.targetWeek === 'unassigned' || job.targetWeek === 'Non ass.' || job.targetWeek === 'none') {
    return null;
  }

  // 2. Data assegnata esplicitamente a mano
  if (job.assignedDate && job.assignedDate.trim()) {
    const d = parseRobustDate(job.assignedDate);
    if (d && !isNaN(d.getTime())) {
      return {
        week: getISOWeek(d),
        year: getISOWeekYear(d),
      };
    }
  }

  // 3. Campi isoWeek e weekYear espliciti
  if (
    typeof job.isoWeek === 'number' &&
    typeof job.weekYear === 'number' &&
    job.isoWeek > 0 &&
    job.weekYear > 0
  ) {
    return {
      week: job.isoWeek,
      year: job.weekYear,
    };
  }

  // 4. TargetWeek esplicito (formato YYYY-Www)
  if (job.targetWeek && typeof job.targetWeek === 'string') {
    const fullMatch = job.targetWeek.match(/^(\d{4})-W(\d{1,2})$/i);
    if (fullMatch) {
      return {
        year: parseInt(fullMatch[1], 10),
        week: parseInt(fullMatch[2], 10),
      };
    }
  }

  // 5. Fallback di default: Data Consegna Finale o Data Fine Preparazione
  const fallbackDateStr =
    (job.dataConsegnaFinale && job.dataConsegnaFinale.trim()) ||
    (job.dataFinePreparazione && job.dataFinePreparazione.trim());

  if (!fallbackDateStr) return null;

  const dFallback = parseRobustDate(fallbackDateStr);
  if (!dFallback || isNaN(dFallback.getTime())) return null;

  return {
    week: getISOWeek(dFallback),
    year: getISOWeekYear(dFallback),
  };
}

/**
 * FASE 16 & FASE 57: Roll-over (Time-shifting) per commesse attive in ritardo e ancoraggio commesse completate.
 * - Se la commessa è attiva (non completata/spedita) ed ha data antecedente alla settimana in corso,
 *   viene forzata e visualizzata nel secchiello della Settimana Corrente.
 * - Se la commessa è completata/spedita ma è stata chiusa in una settimana successiva rispetto alla data prevista
 *   (es. commessa rollata al presente e completata nella settimana corrente o successiva),
 *   rimane ancorata alla settimana effettiva di completamento senza saltare indietro nel passato.
 */
export function getJobEffectiveWeek(job: JobOrder, now: Date = new Date()): { week: number; year: number; isRolledOver: boolean } | null {
  const weekInfo = getJobWeekAndYear(job);
  if (!weekInfo) return null;

  const currentIsoWeek = getISOWeek(now);
  const currentIsoYear = getISOWeekYear(now);

  const isActive = !isJobFinished(job);
  const isPastWeek = weekInfo.year < currentIsoYear || (weekInfo.year === currentIsoYear && weekInfo.week < currentIsoWeek);

  if (isActive && isPastWeek) {
    return {
      week: currentIsoWeek,
      year: currentIsoYear,
      isRolledOver: true,
    };
  }

  // FASE 57: Se la commessa è conclusa/spedita, verifichiamo la data effettiva di completamento
  // per mantenerla ancorata alla settimana di esecuzione se successiva a quella originariamente pianificata
  if (!isActive && isPastWeek) {
    const completionRaw = job.overallEndTime || (job as any).lastStatusChange || job.updatedAt;
    if (completionRaw) {
      const dCompletion = parseRobustDate(completionRaw);
      if (dCompletion && !isNaN(dCompletion.getTime())) {
        const compWeek = getISOWeek(dCompletion);
        const compYear = getISOWeekYear(dCompletion);
        const isCompLater = compYear > weekInfo.year || (compYear === weekInfo.year && compWeek > weekInfo.week);
        if (isCompLater) {
          return {
            week: compWeek,
            year: compYear,
            isRolledOver: true,
          };
        }
      }
    }
  }

  return {
    ...weekInfo,
    isRolledOver: false,
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

type SortField = 'ordinePF' | 'cliente' | 'dataConsegna' | 'statoCommessa';

export function formatDateForDisplay(isoOrStr?: string): string {
  if (!isoOrStr) return '';
  const d = parseRobustDate(isoOrStr);
  if (!d) return isoOrStr;
  return format(d, 'dd/MM/yyyy');
}

export type JobMRPSummary = {
  state: 'RED' | 'SUPPLIER_LATE' | 'EXPEDITE_NEEDED' | 'LATE' | 'ORDERED' | 'GREEN' | 'NO_BOM' | 'LOADING' | 'COMPLETED' | 'SESSION_OPEN' | 'READY';
  label: string;
  badgeClass: string;
  dotClass: string;
  details: string[];
};

// =========================================================================
// OTTIMIZZAZIONE PERFORMANCE: ISOLAMENTO STATO LOCALE E SALVATAGGIO DIFFERITO
// =========================================================================

interface InlineDeliveryDateCellProps {
  job: JobOrder;
  onSaveDeliveryDate: (job: JobOrder, isoFormatted: string, parsedDate?: Date) => Promise<void> | void;
}

const InlineDeliveryDateCell = React.memo(function InlineDeliveryDateCell({
  job,
  onSaveDeliveryDate,
}: InlineDeliveryDateCellProps) {
  const { toast } = useToast();
  const initialDisplay = formatDateForDisplay(job.dataConsegnaFinale);
  const [localText, setLocalText] = useState<string>(initialDisplay);
  const isSubmittingRef = useRef(false);

  // Sincronizza lo stato locale se la data della commessa cambia dall'esterno (es. modale di modifica, azione massiva o fetch)
  useEffect(() => {
    setLocalText(formatDateForDisplay(job.dataConsegnaFinale));
  }, [job.dataConsegnaFinale]);

  // FASE 16: Guardrail & Allarmi Data Consegna
  const isDeliveryDateMissing = !job.dataConsegnaFinale || !job.dataConsegnaFinale.trim();

  let isDeliveryDateExpired = false;
  if (!isDeliveryDateMissing) {
    const d = parseRobustDate(job.dataConsegnaFinale);
    if (d && !isNaN(d.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dMid = new Date(d);
      dMid.setHours(0, 0, 0, 0);
      // Data nel passato E non completata/spedita
      isDeliveryDateExpired = dMid < today && !isJobFinished(job);
    }
  }

  const handleCommit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const trimmed = localText.trim();
      const originalFormatted = formatDateForDisplay(job.dataConsegnaFinale);

      // Se il valore locale all'onBlur è identico al valore originale della commessa, non fare assolutamente nulla (evita chiamate a vuoto)
      if (trimmed === originalFormatted) {
        return;
      }

      // Se il campo è stato completamente svuotato
      if (!trimmed) {
        if (!job.dataConsegnaFinale) {
          setLocalText('');
          return;
        }
        await onSaveDeliveryDate(job, '');
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
        setLocalText(originalFormatted);
        return;
      }

      const isoFormatted = format(parsed, 'yyyy-MM-dd');
      if (isoFormatted === job.dataConsegnaFinale) {
        // Data equivalente, uniforma solo la visualizzazione locale
        setLocalText(format(parsed, 'dd/MM/yyyy'));
        return;
      }

      // Aggiorna subito la visualizzazione locale al formato pulito dd/MM/yyyy
      setLocalText(format(parsed, 'dd/MM/yyyy'));

      // Chiamata differita (onBlur o Invio) al genitore per operazioni pesanti e salvataggio DB
      await onSaveDeliveryDate(job, isoFormatted, parsed);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="relative flex items-center">
      {isDeliveryDateMissing && (
        <span
          className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-red-500"
          title="Data mancante: obbligatoria per avviare la commessa!"
        >
          <AlertCircle className="h-3.5 w-3.5 animate-pulse text-red-500" />
        </span>
      )}
      {isDeliveryDateExpired && !isDeliveryDateMissing && (
        <span
          className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-red-500"
          title="Attenzione: Commessa scaduta/in ritardo!"
        >
          <AlertTriangle className="h-3 w-3 text-red-500" />
        </span>
      )}
      <input
        type="text"
        value={localText}
        placeholder={isDeliveryDateMissing ? "Manca Data!" : "GG/MM/AAAA"}
        onChange={(e) => {
          // Isolamento dello stato locale: NESSUNA propagazione al genitore durante la digitazione
          setLocalText(e.target.value);
        }}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setLocalText(formatDateForDisplay(job.dataConsegnaFinale));
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-6 text-[11px] font-mono font-semibold text-center px-1 py-0 w-full rounded border transition-colors",
          "hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary",
          isDeliveryDateMissing && "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400 placeholder:text-red-500 font-bold pl-5",
          isDeliveryDateExpired && "border-red-500 bg-red-50/20 dark:bg-red-950/20 text-red-600 dark:text-red-400 font-bold pl-5",
          !isDeliveryDateMissing && !isDeliveryDateExpired && (
            !job.dataConsegnaFinale
              ? "border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground"
              : "border-border bg-background text-foreground"
          )
        )}
        title={
          isDeliveryDateMissing
            ? "Data Mancante! È severamente vietato avviare senza Data Consegna."
            : isDeliveryDateExpired
              ? "Data Scaduta nel passato! Commessa in ritardo."
              : "Clicca per modificare la data (GG/MM/AAAA) e premi Invio"
        }
      />
    </div>
  );
});

interface InlineOdlCellProps {
  job: JobOrder;
  onSaveOdl: (job: JobOrder, newOdl: string) => Promise<boolean | void> | void;
}

export { getCleanOdlValue, getJobCleanOdl };

const InlineOdlCell = React.memo(function InlineOdlCell({
  job,
  onSaveOdl,
}: InlineOdlCellProps) {
  const currentOdl = getJobCleanOdl(job);
  const [localVal, setLocalVal] = useState<string>(currentOdl);
  const [isError, setIsError] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    setLocalVal(getJobCleanOdl(job));
    setIsError(false);
  }, [job]);

  const handleCommit = async () => {
    if (isSubmittingRef.current) return;
    const trimmed = localVal.trim();
    const cleanToSave = getCleanOdlValue(trimmed);
    const currentClean = getJobCleanOdl(job);
    if (cleanToSave === currentClean) {
      setLocalVal(currentClean);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const success = await onSaveOdl(job, cleanToSave);
      if (success === false) {
        setIsError(true);
        setLocalVal(currentClean);
        setTimeout(() => setIsError(false), 2500);
      }
    } catch {
      setIsError(true);
      setLocalVal(currentClean);
      setTimeout(() => setIsError(false), 2500);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <input
      type="text"
      value={localVal}
      placeholder="N/D"
      disabled={isSubmitting}
      onChange={(e) => {
        if (isError) setIsError(false);
        setLocalVal(e.target.value);
      }}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setLocalVal(getJobCleanOdl(job));
          setIsError(false);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-6 text-[11px] font-mono font-bold text-center px-1 py-0 w-full rounded border transition-colors",
        "placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal placeholder:opacity-80",
        "hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary",
        isError && "border-red-500 bg-red-500/10 text-red-500 ring-1 ring-red-500",
        !isError && !localVal && "border-dashed border-muted-foreground/30 bg-muted/10 text-muted-foreground",
        !isError && localVal && "border-border bg-background text-foreground",
        isSubmitting && "opacity-60 cursor-wait"
      )}
    />
  );
});

// =========================================================================
// FASE 68: TORRE DI CONTROLLO AVANZAMENTO FASI (POPOVER & PROGRESS BAR)
// =========================================================================

function formatPhaseSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s > 0 ? `${s}s` : ''}`.trim();
  return `${s}s`;
}

function calculatePhaseActualTime(phase: JobPhase): { seconds: number; isActive: boolean; formatted: string } {
  if (!phase.workPeriods || !Array.isArray(phase.workPeriods)) {
    return { seconds: 0, isActive: false, formatted: '0s' };
  }
  let totalMs = 0;
  let isActive = false;
  phase.workPeriods.forEach((wp) => {
    if (!wp) return;
    if (wp.start) {
      const startMs = new Date(wp.start).getTime();
      if (!isNaN(startMs)) {
        if (wp.end) {
          const endMs = new Date(wp.end).getTime();
          if (!isNaN(endMs) && endMs > startMs) {
            totalMs += endMs - startMs;
          }
        } else {
          isActive = true;
          const currentMs = Date.now();
          if (currentMs > startMs) {
            totalMs += currentMs - startMs;
          }
        }
      }
    }
  });
  const seconds = Math.floor(totalMs / 1000);
  return { seconds, isActive, formatted: formatPhaseSeconds(seconds) };
}

function calculatePhaseTargetMinutes(phase: JobPhase, jobQta?: number, article?: Article): number | null {
  if (phase.expectedMinutesPerPiece && jobQta && jobQta > 0) {
    return Math.round(phase.expectedMinutesPerPiece * jobQta);
  }
  if (article && (article as any).phaseTimes && typeof (article as any).phaseTimes === 'object') {
    const rawVal = (article as any).phaseTimes[phase.name] ?? (article as any).phaseTimes[phase.id];
    if (typeof rawVal === 'number' && jobQta && jobQta > 0) {
      return Math.round(rawVal * jobQta);
    }
  }
  return null;
}

function getPhaseStatusConfig(status?: JobPhase['status']) {
  const normStatus = (status || 'pending').toLowerCase().replace('_', '-');
  switch (normStatus) {
    case 'completed':
      return {
        label: 'Completato',
        badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold',
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        icon: CheckCircle2,
      };
    case 'in-progress':
      return {
        label: 'In Corso',
        badgeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 font-semibold animate-pulse',
        dotClass: 'bg-blue-500 animate-ping',
        textClass: 'text-blue-600 dark:text-blue-400 font-medium',
        icon: Hourglass,
      };
    case 'paused':
      return {
        label: 'In Pausa',
        badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold',
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-600 dark:text-amber-400 font-medium',
        icon: PauseCircle,
      };
    case 'skipped':
      return {
        label: 'Saltato',
        badgeClass: 'bg-muted/80 text-muted-foreground border-border/60',
        dotClass: 'bg-muted-foreground',
        textClass: 'line-through text-muted-foreground',
        icon: EyeOff,
      };
    case 'pending':
    default:
      return {
        label: 'Da Iniziare',
        badgeClass: 'bg-muted/60 text-muted-foreground border-border/40',
        dotClass: 'bg-muted-foreground/60',
        textClass: 'text-foreground/80',
        icon: Circle,
      };
  }
}

interface JobPhasesProgressCellProps {
  job: JobOrder;
  article?: Article;
}

const JobPhasesProgressCell = React.memo(function JobPhasesProgressCell({
  job,
  article,
}: JobPhasesProgressCellProps) {
  const phases = job.phases || [];

  if (phases.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground/40 text-[11px] font-mono select-none">
        <span title="Nessuna fase operativa configurata">-</span>
      </div>
    );
  }

  const sortedPhases = useMemo(() => {
    return [...phases].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }, [phases]);

  const total = sortedPhases.length;
  const completed = sortedPhases.filter((p) => p.status === 'completed').length;
  const skipped = sortedPhases.filter((p) => p.status === 'skipped').length;
  const inProgress = sortedPhases.filter(
    (p) => p.status === 'in-progress' || (p.status as any) === 'in_progress'
  ).length;
  const paused = sortedPhases.filter((p) => p.status === 'paused').length;
  const pct = Math.round(((completed + skipped) / total) * 100);
  const isAllDone = completed + skipped === total && total > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center justify-center w-full px-1.5 py-1 rounded hover:bg-muted/40 transition-colors cursor-pointer group text-left outline-none focus-visible:ring-1 focus-visible:ring-primary"
          title="Clicca per aprire la Torre di Controllo Avanzamento Fasi"
        >
          {/* Header Indicatore Cella */}
          <div className="flex items-center justify-between w-full text-[10px] font-mono leading-none mb-1 gap-1">
            <span className="flex items-center gap-1 font-semibold text-foreground/90">
              {inProgress > 0 && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
              )}
              {paused > 0 && inProgress === 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
              )}
              {isAllDone && (
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
              )}
              <span>{completed}/{total}</span>
            </span>
            <span
              className={cn(
                "font-bold text-[10px]",
                isAllDone
                  ? "text-emerald-600 dark:text-emerald-400"
                  : inProgress > 0
                    ? "text-blue-600 dark:text-blue-400"
                    : paused > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
              )}
            >
              {pct}%
            </span>
          </div>

          {/* Micro Progress Bar */}
          <div className="w-full bg-muted/80 rounded-full h-1.5 overflow-hidden border border-border/40">
            <div
              className={cn(
                "h-full transition-all duration-300 rounded-full",
                isAllDone
                  ? "bg-emerald-500"
                  : inProgress > 0
                    ? "bg-blue-500 animate-pulse"
                    : paused > 0
                      ? "bg-amber-500"
                      : pct > 0
                        ? "bg-primary/80"
                        : "bg-muted-foreground/30"
              )}
              style={{ width: `${Math.max(pct, pct > 0 ? 5 : 0)}%` }}
            />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="center"
        side="top"
        sideOffset={6}
        className="w-84 p-3 bg-popover/95 backdrop-blur-md border border-border shadow-xl rounded-lg z-50 text-xs"
      >
        {/* Header Popover */}
        <div className="border-b pb-2 mb-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-sm text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              <span>Avanzamento Fasi</span>
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold border font-mono",
                isAllDone
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                  : inProgress > 0
                    ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 animate-pulse"
                    : paused > 0
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                      : "bg-muted/70 text-muted-foreground border-border"
              )}
            >
              {completed}/{total} completate ({pct}%)
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-mono font-medium text-foreground/90 truncate max-w-[180px]">
              ODL: {job.ordinePF || job.numeroODLInterno || job.id}
            </span>
            {job.qta ? <span>Q.tà: {job.qta} pz</span> : null}
          </div>

          {/* Progress Bar Espansa */}
          <div className="w-full bg-muted/80 rounded-full h-2 overflow-hidden border border-border/50">
            <div
              className={cn(
                "h-full transition-all duration-300 rounded-full",
                isAllDone
                  ? "bg-emerald-500"
                  : inProgress > 0
                    ? "bg-blue-500 animate-pulse"
                    : paused > 0
                      ? "bg-amber-500"
                      : "bg-primary/80"
              )}
              style={{ width: `${Math.max(pct, pct > 0 ? 5 : 0)}%` }}
            />
          </div>
        </div>

        {/* Timeline / Elenco Fasi */}
        <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5 divide-y divide-border/40">
          {sortedPhases.map((phase, idx) => {
            const cfg = getPhaseStatusConfig(phase.status);
            const StatusIcon = cfg.icon;
            const actual = calculatePhaseActualTime(phase);
            const targetMin = calculatePhaseTargetMinutes(phase, job.qta, article);

            return (
              <div
                key={phase.id || idx}
                className={cn(
                  "pt-1.5 first:pt-0 p-1.5 rounded transition-colors",
                  phase.status === 'in-progress' && "bg-blue-500/10 border border-blue-500/30",
                  phase.status === 'paused' && "bg-amber-500/10 border border-amber-500/25"
                )}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <StatusIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        phase.status === 'in-progress' && "text-blue-500 animate-spin",
                        phase.status === 'completed' && "text-emerald-500",
                        phase.status === 'paused' && "text-amber-500",
                        phase.status === 'skipped' && "text-muted-foreground",
                        phase.status === 'pending' && "text-muted-foreground/60"
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold truncate",
                        cfg.textClass
                      )}
                      title={phase.name}
                    >
                      {phase.name}
                    </span>
                    {phase.type && (
                      <span className="text-[9px] font-mono uppercase px-1 py-0 rounded bg-muted/60 text-muted-foreground shrink-0">
                        {phase.type === 'preparation' ? 'Prep' : 'Prod'}
                      </span>
                    )}
                  </div>

                  <span
                    className={cn(
                      "text-[9px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 font-mono",
                      cfg.badgeClass
                    )}
                  >
                    {cfg.label}
                  </span>
                </div>

                {/* Dettaglio Tempi (Effettivo vs Target) */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono pl-5">
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5 text-muted-foreground/70" />
                    <span>
                      Eff: <strong className={actual.seconds > 0 ? "text-foreground" : "text-muted-foreground"}>{actual.formatted}</strong>
                      {actual.isActive && <span className="text-blue-500 font-bold ml-0.5">●</span>}
                    </span>
                  </span>

                  {targetMin !== null ? (
                    <span className="flex items-center gap-1">
                      <Target className="h-2.5 w-2.5 text-muted-foreground/70" />
                      <span>Tgt: <strong>{targetMin}m</strong></span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">-</span>
                  )}
                </div>

                {/* Motivo Pausa se presente */}
                {phase.status === 'paused' && phase.pauseReason && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-5 pt-0.5 italic">
                    Pausa: {phase.pauseReason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
});

// =========================================================================
// MEMOIZATION RIGA TABELLA (React.memo)
// =========================================================================

interface JobTableRowProps {
  job: JobOrder;
  isSelected: boolean;
  isDownloadingPdf: boolean;
  weekOptions: WeekOption[];
  getJobMRPStatus: (job: JobOrder) => JobMRPSummary;
  onToggleSelect: (jobId: string, checked: boolean) => void;
  onSaveDeliveryDate: (job: JobOrder, isoFormatted: string, parsedDate?: Date) => Promise<void> | void;
  onSaveOdl: (job: JobOrder, newOdl: string) => Promise<boolean | void> | void;
  onAssignJobWeek: (job: JobOrder, newWeekVal: string) => void;
  onStatusChange: (job: JobOrder, newStatus: JobStatusOption) => void;
  onTogglePrintODL: (job: JobOrder) => void;
  onStartProduction: (job: JobOrder) => void;
  onRollbackJob: (job: JobOrder) => void;
  onOpenEditModal: (job: JobOrder) => void;
  onOpenSplitModal: (job: JobOrder) => void;
  onDeleteJob: (job: JobOrder) => void;
  onOpenContoLavoroModal: (job: JobOrder) => void;
  onOpenArticleQuickEdit: (articleCode: string) => void;
  onOpenNoteModal: (job: JobOrder) => void;
  article?: Article;
}

const JobTableRow = React.memo(function JobTableRow({
  job,
  isSelected,
  isDownloadingPdf,
  weekOptions,
  getJobMRPStatus,
  onToggleSelect,
  onSaveDeliveryDate,
  onSaveOdl,
  onAssignJobWeek,
  onStatusChange,
  onTogglePrintODL,
  onStartProduction,
  onRollbackJob,
  onOpenEditModal,
  onOpenSplitModal,
  onDeleteJob,
  onOpenContoLavoroModal,
  onOpenArticleQuickEdit,
  onOpenNoteModal,
  article,
}: JobTableRowProps) {
  const hours = calculateJobHours(job, article);
  const timeReliability = getTimeReliabilityStatus(job, article);
  const reliabilityMeta = getTimeReliabilityMeta(timeReliability);
  const weekInfo = getJobWeekAndYear(job);
  const matchedOpt = useMemo(() => {
    if (!weekInfo) return null;
    return weekOptions.find((o) =>
      (o.year === weekInfo.year && o.weekNumber === weekInfo.week) ||
      o.value === `${weekInfo.year}-W${weekInfo.week}` ||
      o.value === `${weekInfo.year}-W${String(weekInfo.week).padStart(2, '0')}` ||
      (job.targetWeek && (o.value === job.targetWeek || `${o.year}-W${o.weekNumber}` === job.targetWeek))
    );
  }, [weekOptions, weekInfo, job.targetWeek]);
  const currentJobWeekVal = matchedOpt ? matchedOpt.value : (weekInfo ? `${weekInfo.year}-W${weekInfo.week}` : 'Non ass.');
  const mrp = getJobMRPStatus(job);
  const deptGroup = getJobDepartmentGroup(job);
  const currentStatus = normalizeJobStatus(job);
  const isPrinted = Boolean((job as any).odlPrinted || job.isPrinted);
  const isDeliveryDateMissing = !job.dataConsegnaFinale || !job.dataConsegnaFinale.trim();
  const hasWorkCycle =
    (Array.isArray(job.phases) && job.phases.length > 0) ||
    Boolean(job.workCycleId && job.workCycleId.trim()) ||
    Boolean(article?.workCycleId && article.workCycleId.trim());
  const isStartBlocked = isDeliveryDateMissing || !hasWorkCycle;
  const effectiveWeekInfo = getJobEffectiveWeek(job);
  const hasExternalized = Boolean(job.externalizedMaterials && job.externalizedMaterials.length > 0);
  const isFinished = currentStatus === 'Completato Prod.' || currentStatus === 'Spedito';

  return (
    <tr
      className={cn(
        "divide-x divide-border hover:bg-muted/30 transition-colors group",
        isFinished && "opacity-60 bg-muted/10 hover:opacity-85 text-muted-foreground",
        isSelected && "bg-blue-500/10 hover:bg-blue-500/15"
      )}
    >
      {/* 0. CHECKBOX RIGA */}
      <td className="py-1.5 px-2 text-center align-middle">
        <div className="flex items-center justify-center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelect(job.id, Boolean(checked))}
            aria-label={`Seleziona commessa ${job.ordinePF}`}
            className="h-3.5 w-3.5 translate-y-[1px]"
          />
        </div>
      </td>

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
        {deptGroup === 'MAG' && (
          <span className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30 font-bold font-mono text-[10px] px-1 py-0.5 rounded-xs">
            MAG
          </span>
        )}
        {deptGroup === 'OTHER' && (
          <span className="bg-slate-500/15 text-slate-700 dark:text-slate-400 border border-slate-500/30 font-bold font-mono text-[9px] px-1 py-0.5 rounded-xs truncate max-w-[45px] inline-block">
            {job.department || 'N/D'}
          </span>
        )}
      </td>

      {/* 2. ORDINE (Link a Console Produzione + Tasto Destro per Nota Rapida con Highlight e Tooltip - FASE 93) */}
      <td
        className="py-1.5 px-2.5 align-middle"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenNoteModal(job);
        }}
      >
        {(() => {
          const jobNote = (job.note || '').trim();
          const hasJobNote = jobNote.length > 0;

          if (!hasJobNote) {
            return (
              <Link
                href={`/admin/production-console?search=${encodeURIComponent(job.ordinePF || '')}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenNoteModal(job);
                }}
                className="font-mono font-bold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer tracking-tight transition-colors inline-block"
                title={`Apri console di produzione per commessa ${job.ordinePF} (Tasto destro per inserire nota rapida)`}
                prefetch={false}
              >
                {job.ordinePF || 'N/A'}
              </Link>
            );
          }

          return (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Link
                  href={`/admin/production-console?search=${encodeURIComponent(job.ordinePF || '')}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenNoteModal(job);
                  }}
                  className="font-mono font-extrabold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 px-1.5 py-0.5 rounded shadow-2xs hover:underline cursor-pointer tracking-tight transition-colors inline-flex items-center gap-1"
                  prefetch={false}
                >
                  <span>{job.ordinePF || 'N/A'}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs bg-amber-950 text-amber-100 border border-amber-500/50 text-xs whitespace-pre-wrap break-words shadow-xl z-50"
              >
                <div className="font-bold text-amber-400 text-[10px] uppercase tracking-wider mb-0.5">
                  Nota Commessa {job.ordinePF}
                </div>
                <div>{jobNote}</div>
              </TooltipContent>
            </Tooltip>
          );
        })()}
      </td>

      {/* 3. CLIENTE */}
      <td className="py-1.5 px-2.5 align-middle">
        <span className="text-[11px] text-foreground font-medium truncate block max-w-[130px]" title={job.cliente}>
          {job.cliente || 'Non specificato'}
        </span>
      </td>

      {/* 4. ARTICOLO (Quick-Edit Drawer - no redirect) */}
      <td className="py-1.5 px-3 align-middle">
        {((job as any).articolo || job.details) ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenArticleQuickEdit(((job as any).articolo || job.details || '').trim());
            }}
            className="font-semibold text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors truncate block max-w-[250px] text-left"
            title={`Modifica rapida tempi e distinta per ${((job as any).articolo || job.details)}`}
          >
            {((job as any).articolo || job.details)}
          </button>
        ) : (
          <span className="font-semibold text-muted-foreground truncate block max-w-[250px]">
            Articolo non indicato
          </span>
        )}
      </td>

      {/* 5. Q.TÀ */}
      <td className="py-1.5 px-2 text-right align-middle font-mono font-bold text-foreground">
        {(job.qta || 0).toLocaleString('it-IT')}
      </td>

      {/* 6. ORE PREV. (FASE 69: Color-Coding Affidabilità Tempi) */}
      <td className="py-1.5 px-2 text-right align-middle font-mono text-[11px]">
        {timeReliability === 'MISSING' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn("inline-flex items-center justify-end gap-1 font-bold cursor-help", reliabilityMeta.colorClass)}
                title={reliabilityMeta.title}
              >
                <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 animate-pulse" />
                <span>0.0 h</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {reliabilityMeta.tooltipText}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn("font-semibold cursor-help transition-colors", reliabilityMeta.colorClass)}
                title={reliabilityMeta.title}
              >
                {hours.toFixed(1)} h
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {reliabilityMeta.tooltipText}
            </TooltipContent>
          </Tooltip>
        )}
      </td>

      {/* 7. DATA CONS. (Isolamento Stato Locale & Salvataggio Differito) */}
      <td className="py-1 px-1.5 text-center align-middle">
        <InlineDeliveryDateCell job={job} onSaveDeliveryDate={onSaveDeliveryDate} />
      </td>

      {/* 8. N° ODL (Isolamento Stato Locale) */}
      <td className="py-1 px-1.5 text-center align-middle">
        <InlineOdlCell job={job} onSaveOdl={onSaveOdl} />
      </td>

      {/* 9. STATO MRP */}
      <td className="py-1.5 px-1.5 text-center align-middle">
        <div className="flex flex-col items-center justify-center gap-1">
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

          {/* FASE 45: Badge C.to Lavoro se presenti materiali esternalizzati */}
          {hasExternalized && (
            <Badge
              variant="outline"
              onClick={() => onOpenContoLavoroModal(job)}
              className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[9px] font-bold py-0 px-1.5 gap-1 inline-flex items-center cursor-pointer hover:bg-purple-500/25 transition-colors"
              title={`C.to Lavoro: ${job.externalizedMaterials!.join(', ')} esternalizzati. Clicca per gestire.`}
            >
              <Truck className="h-2.5 w-2.5 text-purple-600 dark:text-purple-400" />
              <span>C.to Lavoro ({job.externalizedMaterials!.length})</span>
            </Badge>
          )}
        </div>
      </td>

      {/* 10. SETTIMANA ASSEGNATA */}
      <td className="py-1 px-1.5 text-center align-middle">
        <div className="flex flex-col items-center gap-0.5">
          <Select
            value={currentJobWeekVal}
            onValueChange={(newWeekVal) => {
              onAssignJobWeek(job, newWeekVal);
            }}
          >
            <SelectTrigger className="h-6 text-[11px] font-mono py-0 px-1.5 w-full justify-between">
              <SelectValue placeholder="Settimana" />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
                  {opt.shortLabel}
                </SelectItem>
              ))}
              {!matchedOpt && weekInfo && (
                <SelectItem value={currentJobWeekVal} className="text-xs font-mono">
                  Sett. {weekInfo.week} / {weekInfo.year}
                </SelectItem>
              )}
              <SelectItem value="Non ass." className="text-xs font-mono">Non assegnata</SelectItem>
            </SelectContent>
          </Select>
          {effectiveWeekInfo?.isRolledOver && (
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 whitespace-nowrap"
              title={`Roll-over: commessa in ritardo (scaduta in W${weekInfo?.week}) spostata alla Settimana Corrente W${effectiveWeekInfo.week}`}
            >
              Roll-over W{effectiveWeekInfo.week}
            </Badge>
          )}
        </div>
      </td>

      {/* 11. STATO COMMESSA */}
      <td className="py-1 px-1.5 text-center align-middle">
        <Select
          value={currentStatus}
          onValueChange={(val: JobStatusOption) => onStatusChange(job, val)}
        >
          <SelectTrigger className={cn(
            "h-6 text-[11px] font-semibold py-0 px-1.5 w-full justify-between rounded border cursor-pointer opacity-100",
            isDeliveryDateMissing && currentStatus === 'Pianificata' && "border-dashed border-red-500/50 bg-red-50/10 text-red-600 dark:text-red-400",
            currentStatus === 'Pianificata' && !isDeliveryDateMissing && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
            currentStatus === 'In Produzione' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold",
            currentStatus === 'Completato Prod.' && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/50 font-bold shadow-2xs",
            currentStatus === 'Spedito' && "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/50 font-bold shadow-2xs"
          )}
            title={isDeliveryDateMissing && currentStatus === 'Pianificata' ? "Inserire Data di Consegna per sbloccare l'avanzamento" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Pianificata" className="text-xs font-medium text-blue-600 cursor-pointer">
              Pianificata
            </SelectItem>
            <SelectItem value="In Produzione" disabled={isDeliveryDateMissing} className="text-xs font-bold text-amber-600 cursor-pointer">
              In Produzione
            </SelectItem>
            <SelectItem value="Completato Prod." disabled={isDeliveryDateMissing} className="text-xs font-bold text-emerald-600 cursor-pointer">
              Completato Prod.
            </SelectItem>
            <SelectItem value="Spedito" disabled={isDeliveryDateMissing} className="text-xs font-medium text-purple-600 cursor-pointer">
              Spedito
            </SelectItem>
          </SelectContent>
        </Select>
      </td>

      {/* 11-bis. AVANZAMENTO FASI */}
      <td className="py-1 px-1.5 text-center align-middle w-[115px]">
        <JobPhasesProgressCell job={job} article={article} />
      </td>

      {/* 12. AZIONI */}
      <td className="py-1 px-1.5 text-center align-middle">
        <div className="flex items-center justify-center gap-1">
          {/* Stampa ODL */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isDeliveryDateMissing || isDownloadingPdf}
                  onClick={() => onTogglePrintODL(job)}
                  className={cn(
                    "h-7 w-7 transition-colors",
                    isDeliveryDateMissing && "opacity-30 cursor-not-allowed",
                    !isDeliveryDateMissing && isPrinted
                      ? "text-green-500 hover:text-green-600 bg-green-500/10 hover:bg-green-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {isDownloadingPdf ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <Printer className="h-3.5 w-3.5" />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isDeliveryDateMissing
                ? "Inserire Data di Consegna per avviare"
                : isDownloadingPdf
                  ? "Generazione PDF ODL in corso..."
                  : isPrinted
                    ? "ODL stampato (clicca per ristampare il PDF)"
                    : "Stampa ODL (richiede N° ODL)"}
            </TooltipContent>
          </Tooltip>

          {/* FASE 19 / FASE 72: Pulsante di Azione Dinamico (Avvia Play / Ripristina Undo) */}
          {currentStatus === 'Pianificata' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onStartProduction(job)}
                    disabled={isStartBlocked}
                    className={cn(
                      "h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 cursor-pointer",
                      isStartBlocked && "opacity-30 cursor-not-allowed"
                    )}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isDeliveryDateMissing && !hasWorkCycle
                  ? "Inserire Data di Consegna e ciclo di lavorazione per avviare"
                  : isDeliveryDateMissing
                    ? "Inserire Data di Consegna per avviare"
                    : !hasWorkCycle
                      ? "Nessun ciclo di lavorazione presente"
                      : "Avvia ODL in Produzione"}
              </TooltipContent>
            </Tooltip>
          )}

          {(currentStatus === 'In Produzione' || currentStatus === 'Completato Prod.') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRollbackJob(job)}
                  className="h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/15 cursor-pointer transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Ripristina a Pianificata (Annulla avvio ODL)
              </TooltipContent>
            </Tooltip>
          )}

          {currentStatus === 'Spedito' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled
                    className="h-7 w-7 text-muted-foreground opacity-30 cursor-not-allowed"
                  >
                    <Lock className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Commessa Spedita (non modificabile)
              </TooltipContent>
            </Tooltip>
          )}

          {/* Modifica Commessa (FASE 17: Modale Modifica Completa) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenEditModal(job)}
                className="h-7 w-7 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Modifica dettagli commessa
            </TooltipContent>
          </Tooltip>

          {/* FASE 83: Split Commessa (Produzione Parziale - solo commesse non concluse) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isFinished || (job.qta || 0) <= 1}
                  onClick={() => onOpenSplitModal(job)}
                  className={cn(
                    "h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/15 cursor-pointer transition-colors",
                    (isFinished || (job.qta || 0) <= 1) && "opacity-30 cursor-not-allowed"
                  )}
                >
                  <Split className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isFinished
                ? "Commessa conclusa (non divisibile)"
                : (job.qta || 0) <= 1
                  ? "Quantità non divisibile"
                  : "Split Commessa (dividi produzione parziale)"}
            </TooltipContent>
          </Tooltip>

          {/* FASE 28: Elimina Commessa Singola (solo stato Pianificata) */}
          {currentStatus === 'Pianificata' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeleteJob(job)}
                  className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-500/15 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Elimina commessa pianificata
              </TooltipContent>
            </Tooltip>
          )}

          {/* FASE 45: Gestione C.to Lavoro (Terzista) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenContoLavoroModal(job)}
                className={cn(
                  "h-7 w-7 cursor-pointer transition-colors",
                  hasExternalized
                    ? "text-purple-600 dark:text-purple-400 bg-purple-500/15 hover:bg-purple-500/25"
                    : "text-muted-foreground hover:text-purple-600 hover:bg-purple-500/10"
                )}
              >
                <Truck className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {hasExternalized
                ? `C.to Lavoro (${job.externalizedMaterials!.length} materiali esternalizzati)`
                : "Gestione C.to Lavoro (esternalizzazione materiali)"}
            </TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
});

export default function ProgrammazioneClientPage({
  initialJobs,
  initialDepartments,
  initialArticles = [],
  initialWorkCycles = [],
  initialPhaseTemplates = [],
  initialGlobalSettings = null,
  initialOdlConfig,
  initialCapacities = {},
  initialMaterialSessions = [],
  initialNextOdl = '',
  initialMrpSyncMeta = DEFAULT_MRP_SYNC_META,
}: ProgrammazioneClientPageProps) {
  const { toast } = useToast();
  const router = useRouter();

  // Dati Commesse
  const [jobs, setJobs] = useState<JobOrder[]>(initialJobs || []);
  const [nextOdlPreview, setNextOdlPreview] = useState<string>(initialNextOdl || '');
  const [departments] = useState<Department[]>(initialDepartments || []);
  const [articles, setArticles] = useState<Article[]>(initialArticles || []);
  const [workCycles] = useState<WorkCycle[]>(initialWorkCycles || []);
  const [phaseTemplates] = useState<WorkPhaseTemplate[]>(initialPhaseTemplates || []);
  const [globalSettings] = useState<GlobalSettings | null>(initialGlobalSettings);
  const [activeSessions, setActiveSessions] = useState<any[]>(initialMaterialSessions || []);

  // FASE 56: Mappa O(1) Articoli per codice e ID per calcoli istantanei ore e lookup
  const articleMap = useMemo(() => {
    const map = new Map<string, Article>();
    articles.forEach((a) => {
      if (a.code) map.set(a.code.trim().toUpperCase(), a);
      if (a.id) map.set(a.id.trim().toUpperCase(), a);
    });
    return map;
  }, [articles]);

  const [odlConfig] = useState<ODLConfig>(initialOdlConfig || DEFAULT_ODL_CONFIG);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Array<{
    job: JobOrder;
    article: Article | null;
    materials: RawMaterial[];
    printDate: Date;
    contoLavoroMap?: Record<string, string[]>;
    materialsByCode?: Record<string, RawMaterial>;
    articlesByCode?: Record<string, Article>;
  }> | null>(null);

  const qrRule = globalSettings?.jobOrderQrCodeRule || (globalSettings as any)?.qrCodeRule || "{ordinePF}@{details}@{qta}";

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecalculatingMrp, setIsRecalculatingMrp] = useState(false);

  // Modali Inserimento
  const [isSmartJobOpen, setIsSmartJobOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);

  // FASE 27: Esportazione Report Excel (Programmazione Settimanale)
  const [isExportingReport, setIsExportingReport] = useState(false);

  // FASE 100-BIS: Version Token MRP (`settings/mrp_sync_meta`) - 1 sola lettura al rientro/focus con cooldown 8.5s
  const MRP_VERSION_CHECK_COOLDOWN_MS = 8500;
  const lastSyncedMetaRef = useRef<MrpSyncMeta>(normalizeMrpSyncMeta(initialMrpSyncMeta));
  const lastVersionCheckAtRef = useRef<number>(0);
  const isCheckingSyncVersionRef = useRef<boolean>(false);
  const mrpFetchFailedRef = useRef<boolean>(false);
  const [mrpFetchRetryNonce, setMrpFetchRetryNonce] = useState(0);
  const refreshStockAndPoSilentlyRef = useRef<((remoteMeta?: MrpSyncMeta) => Promise<void>) | null>(null);

  const acknowledgeLocalMutation = useCallback(
    (domains: MrpSyncDomain | MrpSyncDomain[] = 'jobsBom', source?: string, delta: number = 1) => {
      lastSyncedMetaRef.current = acknowledgeLocalMrpSyncMeta(
        lastSyncedMetaRef.current,
        domains,
        source,
        delta
      );
    },
    []
  );

  // FASE 17: Modale di Modifica Completa (Edit Job)
  const [isEditStandardModalOpen, setIsEditStandardModalOpen] = useState(false);
  const [jobToEdit, setJobToEdit] = useState<JobOrder | null>(null);

  const handleOpenEditModal = useCallback((job: JobOrder) => {
    setJobToEdit(job);
    setIsEditStandardModalOpen(true);
  }, []);

  const handleJobUpdated = useCallback((updatedJob: JobOrder) => {
    const oldId = jobToEdit?.id;
    optimisticPatchesRef.current.set(updatedJob.id, {
      patch: updatedJob,
      expiresAt: Date.now() + 20000,
    });
    setJobs((prev) =>
      prev.map((j) => (j.id === oldId || j.id === updatedJob.id ? { ...j, ...updatedJob } : j))
    );
    acknowledgeLocalMutation('jobsBom', 'local:handleJobUpdated');
  }, [jobToEdit, acknowledgeLocalMutation]);

  // FASE 83: Modale di Split Commessa (Produzione Parziale)
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [jobToSplit, setJobToSplit] = useState<JobOrder | null>(null);

  const handleOpenSplitModal = useCallback((job: JobOrder) => {
    if (isJobFinished(job)) {
      toast({
        variant: "destructive",
        title: "Azione non consentita",
        description: "Impossibile dividere una commessa già conclusa.",
      });
      return;
    }
    setJobToSplit(job);
    setIsSplitModalOpen(true);
  }, [toast]);

  // FASE 54: Quick-Edit Anagrafica Articolo in sovrimpressione (No Redirect)
  const [quickEditArticleCode, setQuickEditArticleCode] = useState<string | null>(null);
  const [isQuickEditDrawerOpen, setIsQuickEditDrawerOpen] = useState(false);

  const handleOpenArticleQuickEdit = useCallback((articleCode: string) => {
    if (!articleCode) return;
    setQuickEditArticleCode(articleCode.trim());
    setIsQuickEditDrawerOpen(true);
  }, []);

  // FASE 85: Scudo anti-effetto elastico (Optimistic Patch Shield) e mutateJobs stile SWR
  const optimisticPatchesRef = useRef<Map<string, { patch: Partial<JobOrder>; expiresAt: number }>>(new Map());

  const applyOptimisticShield = useCallback((incomingJobs: JobOrder[]): JobOrder[] => {
    const nowMs = Date.now();
    for (const [id, entry] of optimisticPatchesRef.current.entries()) {
      if (entry.expiresAt <= nowMs) {
        optimisticPatchesRef.current.delete(id);
      }
    }
    if (optimisticPatchesRef.current.size === 0) return incomingJobs;
    return incomingJobs.map((j) => {
      const shielded = optimisticPatchesRef.current.get(j.id);
      if (!shielded) return j;
      return { ...j, ...shielded.patch };
    });
  }, []);

  // FASE 87 & FASE 91: Configurazione SWR resiliente per Programmazione (keepPreviousData: true, revalidateOnFocus: false)
  const swrRetryConfig = PROGRAMMAZIONE_SWR_CONFIG;
  const isRefreshingJobsRef = useRef(false);
  const lastJobsRefreshAtRef = useRef(0);

  const refreshJobsFromServer = useCallback(async (force: boolean = false) => {
    const nowMs = Date.now();
    const dedupeMs = swrRetryConfig.dedupingInterval ?? 10000;
    if (isRefreshingJobsRef.current) return;
    if (!force && nowMs - lastJobsRefreshAtRef.current < dedupeMs) return;

    isRefreshingJobsRef.current = true;
    try {
      const { ok, data } = await withSilentNetworkRetry(
        'refreshJobsFromServer',
        () =>
          Promise.all([
            getActiveJobOrders(),
            getNextOdlNumber().catch(() => ''),
          ]),
        null as [JobOrder[], string] | null,
        swrRetryConfig
      );
      if (ok && data) {
        const [freshJobs, freshNextOdl] = data;
        if (Array.isArray(freshJobs)) {
          setJobs(applyOptimisticShield(freshJobs));
          lastJobsRefreshAtRef.current = Date.now();
        }
        if (freshNextOdl) {
          setNextOdlPreview(freshNextOdl);
        }
      }
      // Se !ok, keepPreviousData: true -> i dati precedenti in stato rimangono intatti senza eccezioni
    } catch (err) {
      console.warn("Errore sincronizzazione commesse silenziato (keepPreviousData: true):", err);
    } finally {
      isRefreshingJobsRef.current = false;
    }
  }, [applyOptimisticShield, swrRetryConfig]);

  const mutateJobs = useCallback(
    (
      updater: (currentJobs: JobOrder[]) => JobOrder[],
      options: { revalidate?: boolean; patchedJobId?: string; patch?: Partial<JobOrder>; clearPatchId?: string } = {
        revalidate: false,
      }
    ) => {
      if (options.clearPatchId) {
        optimisticPatchesRef.current.delete(options.clearPatchId);
      }
      if (options.patchedJobId && options.patch) {
        const existing = optimisticPatchesRef.current.get(options.patchedJobId)?.patch || {};
        optimisticPatchesRef.current.set(options.patchedJobId, {
          patch: { ...existing, ...options.patch },
          expiresAt: Date.now() + 20000,
        });
      }
      setJobs((currentJobs) => updater(currentJobs));
      if (options.revalidate) {
        void refreshJobsFromServer();
      }
    },
    [refreshJobsFromServer]
  );

  // FASE 93: Gestione Note Rapide Commesse con Optimistic UI (mutateJobs)
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false);
  const [jobForNote, setJobForNote] = useState<JobOrder | null>(null);

  const handleOpenNoteModal = useCallback((job: JobOrder) => {
    setJobForNote(job);
    setIsNoteDialogOpen(true);
  }, []);

  const handleSaveJobNote = useCallback(
    async (targetJob: JobOrder, newNote: string) => {
      const cleanNote = (newNote || '').trim();
      const previousNote = targetJob.note || '';

      // 1. Optimistic UI istantanea tramite mutateJobs (senza attendere refetch globale)
      mutateJobs(
        (prev) =>
          prev.map((j) => (j.id === targetJob.id ? { ...j, note: cleanNote } : j)),
        { revalidate: false, patchedJobId: targetJob.id, patch: { note: cleanNote } }
      );

      setIsNoteDialogOpen(false);
      setJobForNote(null);

      try {
        const res = await updateJobNote(targetJob.id, cleanNote);
        if (!res.success) {
          // Rollback in caso di errore server
          mutateJobs(
            (prev) =>
              prev.map((j) => (j.id === targetJob.id ? { ...j, note: previousNote } : j)),
            { revalidate: false, patchedJobId: targetJob.id, patch: { note: previousNote } }
          );
          toast({
            variant: 'destructive',
            title: 'Errore Salvataggio Nota',
            description: res.message,
          });
          return;
        }

        acknowledgeLocalMutation('jobsBom', 'local:updateJobNote');
        toast({
          title: cleanNote ? 'Nota Salvata' : 'Nota Rimossa',
          description: cleanNote
            ? `Nota aggiornata per la commessa ${targetJob.ordinePF || targetJob.id}.`
            : `Nota rimossa dalla commessa ${targetJob.ordinePF || targetJob.id}.`,
        });
      } catch (err: any) {
        mutateJobs(
          (prev) =>
            prev.map((j) => (j.id === targetJob.id ? { ...j, note: previousNote } : j)),
          { revalidate: false, patchedJobId: targetJob.id, patch: { note: previousNote } }
        );
        toast({
          variant: 'destructive',
          title: 'Errore Salvataggio Nota',
          description: err?.message || 'Impossibile salvare la nota commessa.',
        });
      }
    },
    [mutateJobs, toast]
  );

  useEffect(() => {
    let isCancelled = false;
    if (!nextOdlPreview) {
      withSilentNetworkRetry(
        'getNextOdlNumber',
        () => getNextOdlNumber(),
        '',
        { ...swrRetryConfig, errorRetryCount: 2 }
      ).then(({ ok, data }) => {
        if (!isCancelled && ok && data) setNextOdlPreview(data);
      });
    }
    return () => {
      isCancelled = true;
    };
  }, [nextOdlPreview, swrRetryConfig]);

  // FASE 84: Modale Conferma / Sovrascrittura N° ODL in Avvio Commessa
  const [isConfirmOdlModalOpen, setIsConfirmOdlModalOpen] = useState(false);
  const [jobToConfirmOdl, setJobToConfirmOdl] = useState<JobOrder | null>(null);

  const handleJobSplitSuccess = useCallback((updatedOriginalJob: JobOrder, childJob: JobOrder) => {
    optimisticPatchesRef.current.set(updatedOriginalJob.id, {
      patch: updatedOriginalJob,
      expiresAt: Date.now() + 20000,
    });
    optimisticPatchesRef.current.set(childJob.id, {
      patch: childJob,
      expiresAt: Date.now() + 20000,
    });
    mutateJobs((prev) => {
      const next: JobOrder[] = [];
      let insertedChild = false;
      for (const j of prev) {
        if (j.id === updatedOriginalJob.id) {
          next.push({ ...j, ...updatedOriginalJob });
          next.push(childJob);
          insertedChild = true;
        } else if (j.id !== childJob.id) {
          next.push(j);
        }
      }
      if (!insertedChild) {
        return [childJob, ...next];
      }
      return next;
    }, { revalidate: false });
    acknowledgeLocalMutation('jobsBom', 'local:splitJobOrder');
    setMrpCacheVersion((v) => v + 1);
  }, [mutateJobs, acknowledgeLocalMutation]);

  const handleArticleUpdated = useCallback((updatedArticle: Article) => {
    // 1. Aggiorna cache locale degli articoli e SWR cache rapida
    setArticles((prev) => {
      const exists = prev.some((a) => a.id === updatedArticle.id || a.code === updatedArticle.code);
      if (exists) {
        return prev.map((a) => (a.id === updatedArticle.id || a.code === updatedArticle.code ? { ...a, ...updatedArticle } : a));
      }
      return [updatedArticle, ...prev];
    });
    const normArtCode = (updatedArticle.code || updatedArticle.id || '').trim().toUpperCase();
    if (normArtCode) {
      articlesCacheRef.current.set(normArtCode, updatedArticle);
      quickArticleCache.updateArticle(updatedArticle, {
        workCycles,
        phaseTemplates,
        globalSettings,
      });
    }

    // 2. FASE 90 & FASE 95: Optimistic Mutate SWR-style su tutte le commesse non concluse associate all'articolo
    const targetCode = (updatedArticle.code || '').trim().toUpperCase();
    const targetId = (updatedArticle.id || '').trim().toUpperCase();
    const cachedRawMaterials = Array.from(materialsCacheRef.current.values());

    mutateJobs(
      (prevJobs) =>
        prevJobs.map((j) => {
          const jobArtCandidates = [
            (j as any).articleCode,
            j.details,
            (j as any).articolo,
            (j as any).articleId,
          ]
            .map((v) => String(v || '').trim().toUpperCase())
            .filter(Boolean);

          const isMatchingArticle = jobArtCandidates.some(
            (candidate) => (targetCode && candidate === targetCode) || (targetId && candidate === targetId)
          );
          if (!isMatchingArticle) return j;

          // FASE 95: Esclude solo le commesse concluse
          if (!isJobEligibleForArticleSync(j)) {
            return j;
          }

          const syncResult = computeArticleCycleSyncForJob({
            job: j,
            article: updatedArticle,
            workCycles,
            phaseTemplates,
          });

          let nextBOM = j.billOfMaterials;
          if (Array.isArray(updatedArticle.billOfMaterials) && globalSettings) {
            const syncedBOMRaw = syncJobBOMItems(
              j.qta,
              j.billOfMaterials || [],
              updatedArticle.billOfMaterials,
              cachedRawMaterials,
              globalSettings
            );
            nextBOM = syncedBOMRaw.map((item) => ({
              ...item,
              lunghezzaTaglioMm: item.lunghezzaTaglioMm ?? null,
              fabbisognoTotale: item.fabbisognoTotale ?? 0,
              pesoStimato: item.pesoStimato ?? 0,
              note: item.note ?? '',
            }));
          }

          const patch: Partial<JobOrder> = {
            billOfMaterials: nextBOM,
            phases: syncResult.phases,
            workCycleId: syncResult.workCycleId,
            expectedMinutesDefault: syncResult.expectedMinutesDefault,
            orePreviste: syncResult.orePreviste,
            ...( { expectedHours: syncResult.expectedHours } as any ),
          };

          const existingShield = optimisticPatchesRef.current.get(j.id)?.patch || {};
          optimisticPatchesRef.current.set(j.id, {
            patch: { ...existingShield, ...patch },
            expiresAt: Date.now() + 20000,
          });

          return {
            ...j,
            ...patch,
          };
        }),
      { revalidate: false }
    );

    acknowledgeLocalMutation('jobsBom', 'local:handleArticleUpdated');
    setMrpCacheVersion((v) => v + 1);
  }, [workCycles, phaseTemplates, globalSettings, mutateJobs, acknowledgeLocalMutation]);

  // FASE 45: Modale di Gestione Conto Lavoro (C.to Lavoro)
  const [isContoLavoroModalOpen, setIsContoLavoroModalOpen] = useState(false);
  const [contoLavoroJob, setContoLavoroJob] = useState<JobOrder | null>(null);

  const handleOpenContoLavoroModal = useCallback((job: JobOrder) => {
    setContoLavoroJob(job);
    setIsContoLavoroModalOpen(true);
  }, []);

  // FASE 53 & FASE 85: Salvataggio in blocco (Batch Save) dei materiali C.to Lavoro con Optimistic Mutate
  const handleSaveContoLavoro = useCallback(async (jobId: string, updatedMaterials: string[]): Promise<boolean> => {
    if (!jobId) return false;
    const cleanList = Array.from(new Set(updatedMaterials.map((c) => (c || '').trim().toUpperCase()).filter(Boolean)));
    const prevJob = jobs.find((j) => j.id === jobId);

    // Optimistic Update su lista jobs (revalidate: false)
    mutateJobs(
      (prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j;
          return { ...j, externalizedMaterials: cleanList };
        }),
      { revalidate: false, patchedJobId: jobId, patch: { externalizedMaterials: cleanList } }
    );

    // Optimistic Update sul job attivo nel modale
    setContoLavoroJob((prev) => {
      if (!prev || prev.id !== jobId) return prev;
      return { ...prev, externalizedMaterials: cleanList };
    });

    const res = await updateExternalizedMaterials(jobId, cleanList);
    if (res.success) {
      acknowledgeLocalMutation('jobsBom', 'local:updateExternalizedMaterials');
      toast({
        title: "C.to Lavoro Aggiornato",
        description: res.message,
      });
      return true;
    } else {
      if (prevJob) {
        mutateJobs(
          (prev) => prev.map((j) => (j.id === jobId ? prevJob : j)),
          { revalidate: false, clearPatchId: jobId }
        );
      }
      toast({
        variant: "destructive",
        title: "Errore C.to Lavoro",
        description: res.message,
      });
      return false;
    }
  }, [jobs, toast, mutateJobs]);


  // FASE 44: Gestione Silenziamento e Riattivazione Allarmi MRP per Singola Commessa
  const handleMuteMaterial = useCallback(async (jobId: string, materialCode: string) => {
    if (!jobId || !materialCode) return;
    const cleanCode = materialCode.trim().toUpperCase();

    // Optimistic Update locale per far sparire immediatamente la riga a schermo
    setJobs(prevJobs => prevJobs.map(j => {
      if (j.id === jobId) {
        const currentMuted = j.mutedMaterials || [];
        if (!currentMuted.includes(cleanCode)) {
          return {
            ...j,
            mutedMaterials: [...currentMuted, cleanCode]
          };
        }
      }
      return j;
    }));

    try {
      const res = await muteMaterialOnJob(jobId, cleanCode);
      if (res.success) {
        acknowledgeLocalMutation('jobsBom', 'local:muteMaterialOnJob');
        toast({
          title: "Allarme silenziato",
          description: `Allarme per ${cleanCode} silenziato su questa commessa.`
        });
      } else {
        // Rollback
        setJobs(prevJobs => prevJobs.map(j => {
          if (j.id === jobId) {
            return {
              ...j,
              mutedMaterials: (j.mutedMaterials || []).filter(m => m !== cleanCode)
            };
          }
          return j;
        }));
        toast({
          variant: "destructive",
          title: "Errore",
          description: res.message || "Impossibile silenziare l'allarme."
        });
      }
    } catch (err: any) {
      // Rollback
      setJobs(prevJobs => prevJobs.map(j => {
        if (j.id === jobId) {
          return {
            ...j,
            mutedMaterials: (j.mutedMaterials || []).filter(m => m !== cleanCode)
          };
        }
        return j;
      }));
      toast({
        variant: "destructive",
        title: "Errore",
        description: err?.message || "Errore imprevisto durante il silenziamento."
      });
    }
  }, [toast, acknowledgeLocalMutation]);

  const handleUnmuteMaterial = useCallback(async (jobId: string, materialCode: string) => {
    if (!jobId || !materialCode) return;
    const cleanCode = materialCode.trim().toUpperCase();

    // Optimistic Update locale per ripristinare immediatamente l'allarme
    setJobs(prevJobs => prevJobs.map(j => {
      if (j.id === jobId) {
        return {
          ...j,
          mutedMaterials: (j.mutedMaterials || []).filter(m => m !== cleanCode)
        };
      }
      return j;
    }));

    try {
      const res = await unmuteMaterialOnJob(jobId, cleanCode);
      if (res.success) {
        acknowledgeLocalMutation('jobsBom', 'local:unmuteMaterialOnJob');
        toast({
          title: "Allarme riattivato",
          description: `Allarme per ${cleanCode} ripristinato per questa commessa.`
        });
      } else {
        // Rollback
        setJobs(prevJobs => prevJobs.map(j => {
          if (j.id === jobId) {
            const currentMuted = j.mutedMaterials || [];
            if (!currentMuted.includes(cleanCode)) {
              return {
                ...j,
                mutedMaterials: [...currentMuted, cleanCode]
              };
            }
          }
          return j;
        }));
        toast({
          variant: "destructive",
          title: "Errore",
          description: res.message || "Impossibile riattivare l'allarme."
        });
      }
    } catch (err: any) {
      // Rollback
      setJobs(prevJobs => prevJobs.map(j => {
        if (j.id === jobId) {
          const currentMuted = j.mutedMaterials || [];
          if (!currentMuted.includes(cleanCode)) {
            return {
              ...j,
              mutedMaterials: [...currentMuted, cleanCode]
            };
          }
        }
        return j;
      }));
      toast({
        variant: "destructive",
        title: "Errore",
        description: err?.message || "Errore imprevisto durante la riattivazione."
      });
    }
  }, [toast, acknowledgeLocalMutation]);

  // FASE 16: Selezione Multipla (Checkbox) e Azioni Massive (Bulk Actions)
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isBulkPrinting, setIsBulkPrinting] = useState(false);
  const [isBulkDateOpen, setIsBulkDateOpen] = useState(false);
  const [bulkDateInput, setBulkDateInput] = useState('');

  // =========================================================================
  // FASE 14 & FASE 91: LIVE DATA FEED ANAGRAFICA ARTICOLI (Real-Time Listener)
  // =========================================================================
  useEffect(() => {
    let unsub: (() => void) | null = null;
    try {
      // Sincronizzazione in tempo reale con Firestore per recepire nuovi articoli all'istante
      unsub = onSnapshot(
        collection(db, "articles"),
        (snapshot) => {
          try {
            emitNetworkStatus({ reconnecting: false });
            const liveArticles = snapshot.docs.map((docSnap) => {
              const data = docSnap.data();
              const code = (data.code || docSnap.id || '').trim();
              return {
                ...data,
                id: docSnap.id,
                code: code,
              } as Article;
            });
            setArticles(liveArticles);

            // Mantieni allineata anche la cache locale articoli per il motore MRP
            liveArticles.forEach((art) => {
              if (art.code) {
                articlesCacheRef.current.set(art.code.toUpperCase().trim(), art);
              }
            });
          } catch (snapErr) {
            handleFirestoreListenerError('articles:parse', snapErr);
          }
        },
        (error) => {
          // FASE 91: Calo connessione / Connection closed silenziato verso React
          handleFirestoreListenerError('articles', error);
        }
      );
    } catch (subErr) {
      handleFirestoreListenerError('articles:subscribe', subErr);
    }

    return () => {
      try {
        unsub?.();
      } catch {
        // Ignora errori in fase di cleanup listener
      }
    };
  }, []);

  // =========================================================================
  // FASE 67 & FASE 91: LIVE DATA FEED SESSIONI ATTIVE MATERIALI (Real-Time Listener)
  // =========================================================================
  useEffect(() => {
    let unsub: (() => void) | null = null;
    try {
      const q = query(
        collection(db, "materialSessions"),
        where("status", "==", "open")
      );
      unsub = onSnapshot(
        q,
        (snapshot) => {
          try {
            emitNetworkStatus({ reconnecting: false });
            const liveSessions = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }));
            setActiveSessions(liveSessions);
          } catch (snapErr) {
            handleFirestoreListenerError('materialSessions:parse', snapErr);
          }
        },
        (error) => {
          // FASE 91: Calo connessione / Connection closed silenziato verso React
          handleFirestoreListenerError('materialSessions', error);
        }
      );
    } catch (subErr) {
      handleFirestoreListenerError('materialSessions:subscribe', subErr);
    }

    return () => {
      try {
        unsub?.();
      } catch {
        // Ignora errori in fase di cleanup listener
      }
    };
  }, []);

  // =========================================================================
  // FASE 13: MACRO-SWITCH VISTE E LAZY LOADING
  // =========================================================================
  const [viewMode, setViewMode] = useState<'settimana' | 'globale'>('settimana');
  const [globalTab, setGlobalTab] = useState<'PIANIFICATE' | 'AVVIATE' | 'CONCLUSE'>('PIANIFICATE');
  const [hasFetchedConcluse, setHasFetchedConcluse] = useState(false);
  const [isLoadingConcluse, setIsLoadingConcluse] = useState(false);

  // Lazy Loading On-Demand per le Commesse Concluse
  const handleSelectGlobalTab = async (tab: 'PIANIFICATE' | 'AVVIATE' | 'CONCLUSE') => {
    setGlobalTab(tab);
    if (tab === 'CONCLUSE' && !hasFetchedConcluse) {
      setIsLoadingConcluse(true);
      try {
        const concluseJobs = await fetchCompletedJobOrdersAction();
        setJobs((prev) => {
          const existingIds = new Set(prev.map(j => j.id));
          const newUnique = concluseJobs.filter(j => !existingIds.has(j.id));
          return [...prev, ...newUnique];
        });
        setHasFetchedConcluse(true);
        toast({
          title: "Commesse Concluse Caricate",
          description: `Scaricati ${concluseJobs.length} record storici da Firestore.`,
        });
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Errore Caricamento Storico",
          description: e?.message || "Impossibile scaricare le commesse concluse.",
        });
      } finally {
        setIsLoadingConcluse(false);
      }
    }
  };

  // Filtro Reparto (4 Macro-Gruppi)
  const [selectedDept, setSelectedDept] = useState<MacroDepartmentCode>('ALL');

  // Filtro Settimana
  const [currentDateReference, setCurrentDateReference] = useState<Date>(new Date());
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  // Filtro Ricerca
  const [searchQuery, setSearchQuery] = useState('');

  // FASE 34: Filtro Stato Commessa (Default: 'ALL' / Tutti gli stati)
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('ALL');

  // Ordinamento Colonne (Default: null -> FASE 71 Ordinamento Gerarchico Automatico Stato Commessa)
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Capacità Giornaliera per Secchiello (con Persistenza Firestore)
  const [capacitiesByBucket, setCapacitiesByBucket] = useState<Record<string, DayCapacityConfig>>(initialCapacities || {});

  const selectedWeekNumber = useMemo(() => {
    return getISOWeek(currentDateReference);
  }, [currentDateReference]);

  const selectedYear = useMemo(() => {
    return getISOWeekYear(currentDateReference);
  }, [currentDateReference]);

  const reportCurrentIsoWeek = selectedWeekNumber;
  const reportNextIsoWeek = useMemo(() => {
    const nextDate = addWeeks(currentDateReference, 1);
    return getISOWeek(nextDate);
  }, [currentDateReference]);

  const handleExportReport = async (scope: 'current' | 'next' | 'both', dept: 'ALL' | 'CP' | 'CG' | 'BF') => {
    setIsExportingReport(true);
    try {
      toast({
        title: "Generazione Report Excel",
        description: "Estrazione commesse e formattazione foglio di lavoro in corso...",
      });

      const res = await exportPlanningReportAction({
        scope,
        dept,
        referenceDateIso: currentDateReference.toISOString(),
        clientJobs: jobs,
      });

      if (!res.success) {
        toast({
          title: "Errore Esportazione",
          description: res.message || "Impossibile generare il report Excel.",
          variant: "destructive",
        });
        return;
      }

      if (!res.base64 || (res.totalJobs ?? 0) === 0) {
        toast({
          title: "Nessun Dato",
          description: "Non ci sono commesse pianificate o in produzione per i criteri selezionati.",
          variant: "default",
        });
        return;
      }

      // Download file Excel da base64
      const byteCharacters = atob(res.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.filename || 'Report_Planning.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);

      toast({
        title: "Report Scaricato",
        description: `Generato con successo "${res.filename}" (${res.totalJobs} commesse).`,
      });
    } catch (error) {
      console.error("Errore export report Excel:", error);
      toast({
        title: "Errore Esportazione",
        description: "Si è verificato un errore durante la generazione del report Excel.",
        variant: "destructive",
      });
    } finally {
      setIsExportingReport(false);
    }
  };

  // Caricamento asincrono capacità al cambio settimana (FASE 91: silenziatore errori rete + keepPreviousData)
  useEffect(() => {
    let isMounted = true;
    withSilentNetworkRetry(
      'getCapacityBuckets',
      () => getCapacityBuckets(selectedYear, selectedWeekNumber),
      {} as Record<string, DayCapacityConfigData>,
      swrRetryConfig
    ).then(({ ok, data }) => {
      if (isMounted && ok && data && Object.keys(data).length > 0) {
        setCapacitiesByBucket((prev) => ({ ...prev, ...data }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [selectedYear, selectedWeekNumber, swrRetryConfig]);

  const bucketKey = useMemo(() => {
    return `${selectedDept}_${selectedYear}_W${selectedWeekNumber}`;
  }, [selectedDept, selectedYear, selectedWeekNumber]);

  // FASE 18 & FASE 92: Aggregazione Capacità Aziendale per Tab "TUTTI" (Esclusivamente CP + CG + BF, ignora MAG)
  const ACTIVE_PRODUCTION_DEPTS = AGGREGATE_PRODUCTION_DEPTS;
  const [isPropagatingCapacity, setIsPropagatingCapacity] = useState(false);

  const aggregatedCapacity = useMemo(() => {
    return aggregateCompanyCapacity(capacitiesByBucket, selectedYear, selectedWeekNumber);
  }, [capacitiesByBucket, selectedYear, selectedWeekNumber]);

  const currentCapacity = useMemo(() => {
    if (selectedDept === 'ALL') {
      return aggregatedCapacity;
    }
    return capacitiesByBucket[bucketKey] || DEFAULT_CAPACITY;
  }, [selectedDept, aggregatedCapacity, capacitiesByBucket, bucketKey]);

  const handleCapacityChange = (field: keyof DayCapacityConfig, value: number) => {
    if (selectedDept === 'ALL') return; // Read-only per tab TUTTI
    const safeValue = Math.max(0, isNaN(value) ? 0 : value);
    const newConfig: DayCapacityConfig = {
      ...(capacitiesByBucket[bucketKey] || DEFAULT_CAPACITY),
      [field]: safeValue,
    };
    setCapacitiesByBucket((prev) => ({
      ...prev,
      [bucketKey]: newConfig,
    }));
    // Salvataggio persistente su Firestore (Fire and forget con log)
    saveCapacityBucket(selectedDept, selectedYear, selectedWeekNumber, newConfig).catch((err) => {
      console.error("Errore salvataggio capacità su Firestore:", err);
    });
  };

  // FASE 92: Propagazione "Da qui in avanti" degli addetti giornalieri sulla baseline e sulle settimane future
  const handlePropagateCapacityForward = async () => {
    if (selectedDept === 'ALL' || isPropagatingCapacity) return;

    const workersPayload = {
      L: Math.max(0, Number(currentCapacity.L) || 0),
      M: Math.max(0, Number(currentCapacity.M) || 0),
      Me: Math.max(0, Number(currentCapacity.Me) || 0),
      G: Math.max(0, Number(currentCapacity.G) || 0),
      V: Math.max(0, Number(currentCapacity.V) || 0),
    };

    const confirmed = window.confirm(
      `Applicare gli addetti giornalieri (${workersPayload.L}-${workersPayload.M}-${workersPayload.Me}-${workersPayload.G}-${workersPayload.V}) al reparto "${selectedDept}" dalla Settimana ${selectedWeekNumber}/${selectedYear} in avanti?\n\nVerrà aggiornata la baseline del reparto e tutte le settimane future già presenti, preservando le settimane passate.`
    );
    if (!confirmed) return;

    setIsPropagatingCapacity(true);
    try {
      const res = await propagateCapacityForward(
        selectedDept,
        selectedYear,
        selectedWeekNumber,
        workersPayload
      );

      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Errore Propagazione",
          description: res.message,
        });
        return;
      }

      // Aggiorna ottimisticamente in memoria tutte le settimane >= (selectedYear, selectedWeekNumber) del reparto
      setCapacitiesByBucket((prev) => {
        const next: Record<string, DayCapacityConfig> = { ...prev };
        next[bucketKey] = {
          ...(next[bucketKey] || DEFAULT_CAPACITY),
          ...workersPayload,
        };
        Object.keys(next).forEach((k) => {
          const match = /^([A-Z]+)_(\d+)_W(\d+)$/.exec(k);
          if (!match) return;
          const [, kDept, kYearStr, kWeekStr] = match;
          const kYear = Number(kYearStr);
          const kWeek = Number(kWeekStr);
          if (kDept === selectedDept && isCapacityPeriodAtOrAfter(kYear, kWeek, selectedYear, selectedWeekNumber)) {
            next[k] = {
              ...next[k],
              ...workersPayload,
            };
          }
        });
        return next;
      });

      toast({
        title: "Addetti Propagati",
        description: res.message,
      });
    } catch (err: any) {
      console.error("Errore propagazione addetti:", err);
      toast({
        variant: "destructive",
        title: "Errore Propagazione",
        description: err?.message || "Impossibile propagare gli addetti alle settimane successive.",
      });
    } finally {
      setIsPropagatingCapacity(false);
    }
  };

  const availableHours = useMemo(() => {
    const { L, M, Me, G, V, overtime } = currentCapacity;
    const totalDailyWorkers = L + M + Me + G + V;
    const baseHours = totalDailyWorkers * 7.6;
    const total = baseHours + (Number(overtime) || 0);
    return Math.round(total * 10) / 10;
  }, [currentCapacity]);

  const weekInterval = useMemo(() => {
    const start = startOfISOWeek(currentDateReference);
    const end = endOfISOWeek(currentDateReference);
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
    const now = new Date();
    const currentMonday = startOfISOWeek(now);
    currentMonday.setHours(12, 0, 0, 0);
    setCurrentDateReference(currentMonday);
    setShowAllWeeks(false);
  };

  // Refresh Commesse, Articoli e controllo Version Token MRP (Lazy-Aware)
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [updatedJobs, freshArticlesSnap, remoteSyncMeta] = await Promise.all([
        hasFetchedConcluse ? getJobOrders() : getActiveJobOrders(),
        getDocs(collection(db, "articles")),
        getMrpSyncMeta().catch(() => null),
      ]);
      setJobs(applyOptimisticShield(updatedJobs));
      const freshArticles = freshArticlesSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          ...data,
          id: docSnap.id,
          code: (data.code || docSnap.id || '').trim(),
        } as Article;
      });
      setArticles(freshArticles);
      freshArticles.forEach((art) => {
        if (art.code) {
          articlesCacheRef.current.set(art.code.toUpperCase().trim(), art);
        }
      });

      // FASE 100-BIS: Se il Version Token MRP è avanzato (o un fetch precedente era fallito), riallinea anche l'MRP
      const syncDiff = evaluateMrpSyncDiff(lastSyncedMetaRef.current, remoteSyncMeta);
      if (syncDiff.needsRefresh || mrpFetchFailedRef.current) {
        await refreshStockAndPoSilentlyRef.current?.(remoteSyncMeta || undefined);
      } else if (remoteSyncMeta) {
        lastSyncedMetaRef.current = normalizeMrpSyncMeta(remoteSyncMeta);
      }

      toast({
        title: "Dati aggiornati",
        description: `Caricate ${updatedJobs.length} commesse e ${freshArticles.length} articoli dal database.`,
      });
    } catch (error) {
      console.error("Errore refresh:", error);
      toast({
        title: "Errore di caricamento",
        description: "Impossibile aggiornare i dati delle commesse e degli articoli.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // FASE 37, FASE 91 & FASE 100-BIS: Ricalcolo Completo MRP con retry silenzioso e mantenimento dati precedenti (keepPreviousData: true)
  const isRecalculatingMrpRef = useRef(false);
  const handleRecalculateMRP = useCallback(async (options?: { silentBackground?: boolean }) => {
    const isSilent = options?.silentBackground === true;
    if (isRecalculatingMrpRef.current) return;
    isRecalculatingMrpRef.current = true;
    if (!isSilent) setIsRecalculatingMrp(true);
    try {
      const result = await withNetworkRetry(
        () => forceRecalculateMRPAction(),
        swrRetryConfig
      );
      if (!result.success) {
        if (isSilent) {
          console.warn("[Programmazione] Ricalcolo MRP background non completato (keepPreviousData: true):", result.message);
          return;
        }
        throw new Error(result.message);
      }

      if (result.jobs && result.jobs.length > 0) {
        setJobs(applyOptimisticShield(result.jobs));
      }

      // Svuota e ripopola la cache delle materie prime con lo stock aggiornato da Firestore
      materialsCacheRef.current.clear();
      result.rawMaterials.forEach((m) => {
        if (m.code && hasFullStockHydration(m)) {
          materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
        }
      });

      // FASE 100-BIS: Ripopola la cache degli ordini fornitore deduplicata per po.id
      upsertPurchaseOrdersIntoCache(poCacheRef.current, result.purchaseOrders, { replaceAll: true });

      // FASE 97-TER: Svuota e ripopola la cache degli scarichi materiali attivi (status !== 'cancelled')
      withdrawalsCacheRef.current.clear();
      (result.materialWithdrawals || []).forEach((w) => {
        if (w && w.id && String(w.status || '').toLowerCase() !== 'cancelled') {
          withdrawalsCacheRef.current.set(w.id, w);
        }
      });

      // Aggiorna gli articoli
      if (result.articles && result.articles.length > 0) {
        setArticles(result.articles);
        result.articles.forEach((art) => {
          if (art.code) {
            articlesCacheRef.current.set(art.code.trim().toUpperCase(), art);
          }
        });
      }

      // FASE 100-BIS: Sincronizza anche activeSessions aperte in officina/magazzino
      if (Array.isArray(result.activeSessions)) {
        setActiveSessions(result.activeSessions);
      }

      if (result.globalSettings) {
        globalSettingsRef.current = result.globalSettings;
      }

      if (result.syncMeta) {
        lastSyncedMetaRef.current = normalizeMrpSyncMeta(result.syncMeta);
      }
      mrpFetchFailedRef.current = false;

      // Incrementa versione per forzare ricalcolo reattivo di mrpTimelines e semafori
      setMrpCacheVersion((v) => v + 1);

      if (!isSilent) {
        toast({
          title: "MRP Ricalcolato",
          description: result.message,
        });
      }
    } catch (error: any) {
      if (isSilent) {
        console.warn("[Programmazione] Errore rete silenziato su sync background MRP (keepPreviousData: true):", error);
      } else {
        console.warn("Errore ricalcolo MRP:", error);
        toast({
          title: "Errore Ricalcolo MRP",
          description: error?.message || "Impossibile ricalcolare l'MRP.",
          variant: "destructive",
        });
      }
    } finally {
      isRecalculatingMrpRef.current = false;
      if (!isSilent) setIsRecalculatingMrp(false);
    }
  }, [toast, swrRetryConfig, applyOptimisticShield]);

  // Sincronizzazione props in caso di soft reload (protetta da applyOptimisticShield contro l'effetto elastico FASE 85)
  useEffect(() => {
    if (initialJobs) {
      setJobs(applyOptimisticShield(initialJobs));
    }
  }, [initialJobs, applyOptimisticShield]);

  useEffect(() => {
    if (initialArticles && initialArticles.length > 0) {
      setArticles(initialArticles);
      initialArticles.forEach((art) => {
        if (art.code) {
          articlesCacheRef.current.set(art.code.toUpperCase().trim(), art);
        }
      });
      setMrpCacheVersion((v) => v + 1);
    }
  }, [initialArticles]);

  // FASE 100-BIS: Sincronizzazione activeSessions su aggiornamento props SSR
  useEffect(() => {
    if (Array.isArray(initialMaterialSessions)) {
      setActiveSessions(initialMaterialSessions);
    }
  }, [initialMaterialSessions]);

  // Ascolta l'evento di Soft Reload globale dalla Top Nav / NetworkResilienceBanner
  useEffect(() => {
    const handleGlobalRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<{ silentBackground?: boolean }>)?.detail;
      void handleRecalculateMRP({ silentBackground: detail?.silentBackground ?? false });
    };
    window.addEventListener('app:refresh', handleGlobalRefresh);
    return () => {
      window.removeEventListener('app:refresh', handleGlobalRefresh);
    };
  }, [handleRecalculateMRP]);

  // Ordinamento Colonne
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        // Terzo click: ripristina ordinamento gerarchico predefinito (FASE 71)
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filtraggio Commesse Lato Client (Supporto Vista Settimana e Vista Globale)
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // 1. Filtro Macro-Reparto (ALL, CP, CG, BF)
      if (selectedDept !== 'ALL') {
        const group = getJobDepartmentGroup(job);
        if (group !== selectedDept) return false;
      }

      // 2. Filtro Ricerca Rapida
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

      // 3. FASE 34 & FASE 57: Filtro Stato Commessa (Default: 'ALL' / Tutti gli stati)
      if (statusFilter !== 'ALL') {
        const jobStatus: string = normalizeJobStatus(job);
        const matchesSpedita = statusFilter === 'Spedita' && (jobStatus === 'Spedito' || jobStatus === 'Spedita');
        const matchesCompletato = statusFilter === 'Completato Prod.' && (jobStatus === 'Completato Prod.' || jobStatus === 'Completata' || jobStatus === 'completed');
        if (!matchesSpedita && !matchesCompletato && jobStatus !== statusFilter) {
          return false;
        }
      }

      // 4. Bivio: Vista per Settimana vs Vista Globale
      // In modalità 'settimana', tutte le commesse (incluse quelle completate/chiuse) appartenenti
      // alla settimana selezionata rimangono visibili nella DataGrid e conteggiate nel Secchiello.
      if (viewMode === 'settimana') {
        if (!showAllWeeks) {
          // FASE 16 & FASE 57: Roll-over al presente per commesse attive in ritardo e ancoraggio commesse completate
          const effectiveWeek = getJobEffectiveWeek(job);
          if (!effectiveWeek) return false;
          if (effectiveWeek.week !== selectedWeekNumber || effectiveWeek.year !== selectedYear) {
            return false;
          }
        }
      } else {
        // Vista Globale: 3 macro-tab SSoT
        const status = normalizeJobStatus(job);
        if (globalTab === 'PIANIFICATE') {
          return status === 'Pianificata';
        } else if (globalTab === 'AVVIATE') {
          return status === 'In Produzione' || status === 'Completato Prod.';
        } else if (globalTab === 'CONCLUSE') {
          return status === 'Spedito' || ['closed', 'chiuso'].includes((job.status || '').toLowerCase().trim());
        }
      }

      return true;
    });
  }, [jobs, selectedDept, viewMode, globalTab, showAllWeeks, selectedWeekNumber, selectedYear, searchQuery, statusFilter]);

  // Ordinamento Risultati (FASE 71: Ordinamento Gerarchico Automatico Stato Commessa)
  const sortedAndFilteredJobs = useMemo(() => {
    const list = [...filteredJobs];
    if (!sortField) {
      list.sort(defaultJobStatusComparator);
      return list;
    }

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
      } else if (sortField === 'statoCommessa') {
        const pA = getJobStatusPriority(a);
        const pB = getJobStatusPriority(b);
        res = pA - pB;
      }

      if (res === 0) {
        // A parità di ordinamento primario manuale, fallback su ordinamento secondario naturale
        return defaultJobStatusComparator(a, b);
      }

      return sortDirection === 'asc' ? res : -res;
    });

    return list;
  }, [filteredJobs, sortField, sortDirection]);

  // Metriche Secchiello (FASE 92: Nel filtro TUTTI esclude MAG dal carico e saturazione globale)
  const bucketMetrics = useMemo(() => {
    const metricsJobs = filterJobsForCapacityMetrics(sortedAndFilteredJobs, selectedDept);
    const totalJobs = metricsJobs.length;
    const totalPieces = metricsJobs.reduce((acc, j) => acc + (j.qta || 0), 0);
    const loadedHours = metricsJobs.reduce((acc, j) => {
      const artKey = ((j as any).articolo || j.details || '').trim().toUpperCase();
      return acc + calculateJobHours(j, articleMap.get(artKey));
    }, 0);
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
  }, [sortedAndFilteredJobs, selectedDept, availableHours, articleMap]);

  // Conteggi per macro-reparti (Sensibili alla vista corrente)
  const deptCounts = useMemo(() => {
    const counts: Record<MacroDepartmentCode, number> = { ALL: 0, CP: 0, CG: 0, BF: 0, MAG: 0 };
    jobs.forEach((job) => {
      if (viewMode === 'settimana') {
        if (!showAllWeeks) {
          // FASE 16: Roll-over al presente per commesse attive in ritardo
          const effectiveWeek = getJobEffectiveWeek(job);
          if (!effectiveWeek || effectiveWeek.week !== selectedWeekNumber || effectiveWeek.year !== selectedYear) {
            return;
          }
        }
      } else {
        const st = normalizeJobStatus(job);
        if (globalTab === 'PIANIFICATE' && st !== 'Pianificata') return;
        if (globalTab === 'AVVIATE' && st !== 'In Produzione' && st !== 'Completato Prod.') return;
        if (globalTab === 'CONCLUSE' && st !== 'Spedito' && !['closed', 'chiuso'].includes((job.status || '').toLowerCase().trim())) return;
      }
      counts.ALL++;
      const group = getJobDepartmentGroup(job);
      if (group === 'CP') counts.CP++;
      else if (group === 'CG') counts.CG++;
      else if (group === 'BF') counts.BF++;
      else if (group === 'MAG') counts.MAG++;
    });
    return counts;
  }, [jobs, viewMode, globalTab, showAllWeeks, selectedWeekNumber, selectedYear]);

  // Conteggio commesse per i 3 macro-tab della Vista Globale (SSoT)
  const globalTabCounts = useMemo(() => {
    let pianificate = 0;
    let avviate = 0;
    let concluse = 0;

    jobs.forEach((job) => {
      if (selectedDept !== 'ALL') {
        const group = getJobDepartmentGroup(job);
        if (group !== selectedDept) return;
      }
      const st = normalizeJobStatus(job);
      if (st === 'Pianificata') {
        pianificate++;
      } else if (st === 'In Produzione' || st === 'Completato Prod.') {
        avviate++;
      } else if (st === 'Spedito' || ['closed', 'chiuso'].includes((job.status || '').toLowerCase().trim())) {
        concluse++;
      }
    });

    return { pianificate, avviate, concluse };
  }, [jobs, selectedDept]);

  // =========================================================================
  // TARGETED MRP IN BACKGROUND - SCOPE GLOBALE (COMMESSE PIANIFICATE + IN PRODUZIONE)
  // =========================================================================
  const materialsCacheRef = useRef<Map<string, RawMaterial>>(new Map());
  // FASE 100-BIS (Fix #1): Cache isolata per metadati stampa ODL (.select() parziale senza stock)
  // NON scrivere mai proiezioni parziali di getOdlPrintData dentro materialsCacheRef!
  const odlPrintMaterialsCacheRef = useRef<Map<string, RawMaterial>>(new Map());
  const poCacheRef = useRef<Map<string, PurchaseOrder[]>>(new Map());
  const withdrawalsCacheRef = useRef<Map<string, MaterialWithdrawal>>(new Map());
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
    return jobs.filter((j) => !isJobFinished(j));
  }, [jobs]);

  // FASE 100-BIS (Fix #2): Fabbisogni materiali e articoli con risoluzione BOM da articleMap/articlesCacheRef
  // anche per commesse prive di job.billOfMaterials inline.
  const { globalMaterialCodes, globalArticleCodes } = useMemo(
    () => collectGlobalMrpCodes(activeGlobalJobs, articleMap, articlesCacheRef.current, isJobFinished),
    [activeGlobalJobs, articleMap]
  );

  const globalMaterialCodesRef = useRef<string[]>(globalMaterialCodes);
  const globalArticleCodesRef = useRef<string[]>(globalArticleCodes);
  globalMaterialCodesRef.current = globalMaterialCodes;
  globalArticleCodesRef.current = globalArticleCodes;

  // FASE 100-BIS: Refresh granulare silenzioso (solo Stock, PO, Prelievi e Sessioni Aperte) senza flicker.
  // Svuota e sostituisce le cache SOLO dopo l'arrivo della risposta (keepPreviousData: true).
  const isRefreshingStockPoRef = useRef(false);
  const refreshStockAndPoSilently = useCallback(
    async (remoteMeta?: MrpSyncMeta) => {
      if (isRefreshingStockPoRef.current || isRecalculatingMrpRef.current) return;
      const matCodes = globalMaterialCodesRef.current;
      const artCodes = globalArticleCodesRef.current;
      if (matCodes.length === 0 && artCodes.length === 0) {
        if (remoteMeta) {
          lastSyncedMetaRef.current = normalizeMrpSyncMeta(remoteMeta);
        }
        return;
      }

      isRefreshingStockPoRef.current = true;
      try {
        const { ok, data } = await withSilentNetworkRetry(
          'getTargetedMRPData:versionSync',
          () => getTargetedMRPData(matCodes, artCodes, { includeOpenSessions: true }),
          {
            rawMaterials: [],
            purchaseOrders: [],
            articles: [],
            globalSettings: null,
            materialWithdrawals: [],
            activeSessions: undefined,
            syncMeta: { ...DEFAULT_MRP_SYNC_META },
          },
          swrRetryConfig
        );

        if (!ok) {
          mrpFetchFailedRef.current = true;
          return;
        }

        // Swap atomico in memoria post-fetch: zero schermate vuote o flicker "In Verifica"
        materialsCacheRef.current.clear();
        data.rawMaterials.forEach((m) => {
          if (m.code && hasFullStockHydration(m)) {
            materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
          }
        });

        upsertPurchaseOrdersIntoCache(poCacheRef.current, data.purchaseOrders, { replaceAll: true });

        withdrawalsCacheRef.current.clear();
        (data.materialWithdrawals || []).forEach((w) => {
          if (w && w.id && String(w.status || '').toLowerCase() !== 'cancelled') {
            withdrawalsCacheRef.current.set(w.id, w);
          }
        });

        data.articles.forEach((a) => {
          if (a.code) articlesCacheRef.current.set(a.code.trim().toUpperCase(), a);
        });

        if (data.globalSettings) {
          globalSettingsRef.current = data.globalSettings;
        }

        if (Array.isArray(data.activeSessions)) {
          setActiveSessions(data.activeSessions);
        }

        const effectiveMeta =
          data.syncMeta && data.syncMeta.version >= (remoteMeta?.version ?? 0)
            ? data.syncMeta
            : remoteMeta || data.syncMeta;
        if (effectiveMeta) {
          lastSyncedMetaRef.current = normalizeMrpSyncMeta(effectiveMeta);
        }
        mrpFetchFailedRef.current = false;
        setMrpCacheVersion((v) => v + 1);
      } finally {
        isRefreshingStockPoRef.current = false;
      }
    },
    [swrRetryConfig]
  );
  refreshStockAndPoSilentlyRef.current = refreshStockAndPoSilently;

  // FASE 100-BIS: Verifica intelligente Version Token (`settings/mrp_sync_meta`) -> 1 sola lettura Firestore!
  const checkAndSyncMrpVersion = useCallback(
    async (options?: { force?: boolean; silentBackground?: boolean }) => {
      const nowMs = Date.now();
      if (!options?.force && nowMs - lastVersionCheckAtRef.current < MRP_VERSION_CHECK_COOLDOWN_MS) {
        return;
      }
      if (isCheckingSyncVersionRef.current || isRecalculatingMrpRef.current || isRefreshingStockPoRef.current) {
        return;
      }

      isCheckingSyncVersionRef.current = true;
      lastVersionCheckAtRef.current = nowMs;
      try {
        const { ok, data: remoteMeta } = await withSilentNetworkRetry(
          'getMrpSyncMeta',
          () => getMrpSyncMeta(),
          null as MrpSyncMeta | null,
          { ...swrRetryConfig, errorRetryCount: 1 }
        );

        if (!ok || !remoteMeta) {
          return;
        }

        const diff = evaluateMrpSyncDiff(lastSyncedMetaRef.current, remoteMeta);
        if (!diff.needsRefresh) {
          // Versione invariata -> 0 query MRP. Riprova solo se un fetch precedente era fallito in rete.
          if (mrpFetchFailedRef.current) {
            setMrpFetchRetryNonce((n) => n + 1);
          }
          return;
        }

        if (diff.scope === 'stock_po') {
          await refreshStockAndPoSilently(remoteMeta);
        } else {
          await handleRecalculateMRP({ silentBackground: options?.silentBackground ?? true });
        }
      } finally {
        isCheckingSyncVersionRef.current = false;
      }
    },
    [swrRetryConfig, refreshStockAndPoSilently, handleRecalculateMRP]
  );

  // FASE 100-BIS: Controllo leggero (1 read, cooldown 8.5s) al rientro su finestra/tab
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkAndSyncMrpVersion({ silentBackground: true });
      }
    };
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkAndSyncMrpVersion({ silentBackground: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkAndSyncMrpVersion]);

  // FASE 100-BIS: Se in navigazione soft arrivano nuove props SSR con Version Token avanzato, riallinea l'MRP
  useEffect(() => {
    if (!initialMrpSyncMeta) return;
    const diff = evaluateMrpSyncDiff(lastSyncedMetaRef.current, initialMrpSyncMeta);
    if (diff.needsRefresh) {
      if (diff.scope === 'stock_po') {
        void refreshStockAndPoSilently(initialMrpSyncMeta);
      } else {
        lastSyncedMetaRef.current = normalizeMrpSyncMeta(initialMrpSyncMeta);
        void refreshStockAndPoSilently(initialMrpSyncMeta);
      }
    }
  }, [initialMrpSyncMeta, refreshStockAndPoSilently]);

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

    withSilentNetworkRetry(
      'getTargetedMRPData',
      () => getTargetedMRPData(missingMaterials, missingArticles),
      {
        rawMaterials: [],
        purchaseOrders: [],
        articles: [],
        globalSettings: null,
        materialWithdrawals: [],
        syncMeta: { ...DEFAULT_MRP_SYNC_META },
      },
      swrRetryConfig
    )
      .then(({ ok, data }) => {
        if (isCancelled) return;
        if (!ok) {
          // FASE 100-BIS: Segna il fallimento così i codici mancanti verranno ritentati al giro successivo
          mrpFetchFailedRef.current = true;
          return;
        }

        data.rawMaterials.forEach((m) => {
          if (m.code && hasFullStockHydration(m)) {
            materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
          }
        });

        // FASE 100-BIS: Deduplicazione PO per po.id
        upsertPurchaseOrdersIntoCache(poCacheRef.current, data.purchaseOrders);

        (data.materialWithdrawals || []).forEach((w) => {
          if (w && w.id && String(w.status || '').toLowerCase() !== 'cancelled') {
            withdrawalsCacheRef.current.set(w.id, w);
          }
        });

        data.articles.forEach((a) => {
          if (a.code) articlesCacheRef.current.set(a.code.trim().toUpperCase(), a);
        });

        if (data.globalSettings) {
          globalSettingsRef.current = data.globalSettings;
        }

        if (data.syncMeta && data.syncMeta.version > lastSyncedMetaRef.current.version) {
          lastSyncedMetaRef.current = normalizeMrpSyncMeta(data.syncMeta);
        }
        mrpFetchFailedRef.current = false;

        setMrpCacheVersion((v) => v + 1);
      })
      .finally(() => {
        if (!isCancelled) setIsMrpLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [globalMaterialCodes, globalArticleCodes, mrpFetchRetryNonce, swrRetryConfig]);

  // FASE 97-TER: Pre-indicizzazione O(1) in memoria di tutti i materialWithdrawals attivi per coppia (Commessa, Componente)
  const withdrawalIndex = useMemo(() => {
    const cachedWithdrawals = Array.from(withdrawalsCacheRef.current.values());
    const cachedMaterials = Array.from(materialsCacheRef.current.values());
    return buildJobComponentWithdrawalIndex(cachedWithdrawals, cachedMaterials);
  }, [mrpCacheVersion]);

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
      activeSessions,
      withdrawalIndex
    );
  }, [activeGlobalJobs, mrpCacheVersion, activeSessions, withdrawalIndex]);

  // SSoT: Classificazione centralizzata universale allarmi MRP per Programmazione Commesse
  const classifiedMRPAlarms = useMemo(() => {
    const cachedMaterials = Array.from(materialsCacheRef.current.values());
    const allCachedPOs = Array.from(poCacheRef.current.values()).flat();

    return classifyGlobalMRPAlarms({
      mrpTimelines,
      allJobs: activeGlobalJobs,
      rawMaterials: cachedMaterials,
      purchaseOrders: allCachedPOs,
    });
  }, [mrpTimelines, activeGlobalJobs, mrpCacheVersion]);

  // Backward compatibility alias per criticalMaterialsTimeline (solo veri allarmi)
  const criticalMaterialsTimeline = useMemo(() => {
    const criticals = new Map<string, { entry: MRPTimelineEntry; job: JobOrder | undefined }[]>();
    classifiedMRPAlarms.alarmMaterials.forEach((item) => {
      criticals.set(item.matCode, item.entriesWithVisual.map(e => ({ entry: e.entry, job: e.job })));
    });
    return criticals;
  }, [classifiedMRPAlarms]);

  // Stato Semaforo Singola Commessa con Gestione Visiva Corretta "In Verifica" e Short-circuit per Completate
  const getJobMRPStatus = useCallback((job: JobOrder): JobMRPSummary => {
    // 0. SHORT-CIRCUIT A MONTE: Se la commessa è completata o spedita, bypassa completamente il calcolo MRP
    if (isJobFinished(job)) {
      const isShipped = normalizeJobStatus(job) === 'Spedito';
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

    const extMaterials: string[] = (job.externalizedMaterials || []).map((m) => (m || '').toUpperCase().trim());
    const isExternalized = (code: string) => extMaterials.includes((code || '').toUpperCase().trim());

    // FASE 94 & FASE 97-TER: Precedenza assoluta allo stato della fase produttiva associata al componente
    // e agli scarichi diretti a magazzino (manuali/storici) registrati in materialWithdrawals.
    const withdrawnItems: typeof bom = [];
    const pendingItems: typeof bom = [];
    const externalizedItems: typeof bom = [];
    const phaseCompletedPhaseByCode = new Map<string, string>();
    const directWithdrawnByCode = new Set<string>();
    const remainingWithdrawnByCode = new Map<string, number>();

    bom.forEach((item) => {
      const compCode = (item.component || '').trim().toUpperCase();
      if (isExternalized(compCode)) {
        externalizedItems.push(item);
        return;
      }

      const rawMat = materialsCacheRef.current.get(compCode);
      const phaseCheck = isBOMItemPhaseCompleted(job, item, rawMat, phaseTemplates);
      const isSatisfied = item.status === 'withdrawn' || item.withdrawn === true || phaseCheck.completed;

      if (isSatisfied) {
        withdrawnItems.push(item);
        if (phaseCheck.completed && phaseCheck.phaseName) {
          phaseCompletedPhaseByCode.set(compCode, phaseCheck.phaseName);
        }
        return;
      }

      // FASE 97-TER: Controllo saturazione tramite scarichi storici / manuali a magazzino (lookup O(1))
      if (compCode) {
        if (!remainingWithdrawnByCode.has(compCode)) {
          remainingWithdrawnByCode.set(
            compCode,
            getJobComponentWithdrawnQty(job, compCode, withdrawalIndex)
          );
        }
        const remWithdrawn = remainingWithdrawnByCode.get(compCode) || 0;
        if (remWithdrawn > 0.0001) {
          const currentSettings = globalSettingsRef.current || globalSettings;
          const config = (currentSettings?.rawMaterialTypes || []).find((t) => t.id === rawMat?.type) || {
            defaultUnit: rawMat?.unitOfMeasure || item.unit || 'n',
          };
          const req = calculateBOMRequirement(job.qta, item, rawMat as any, config as any);
          const reqQty =
            item.fabbisognoTotale !== undefined && item.fabbisognoTotale !== null && Number(item.fabbisognoTotale) > 0
              ? Number(item.fabbisognoTotale)
              : req.totalInBaseUnits;

          if (reqQty > 0 && remWithdrawn >= reqQty - 0.001) {
            // Saturazione 100%: componente interamente coperto da scarico diretto a magazzino
            remainingWithdrawnByCode.set(compCode, Math.max(0, remWithdrawn - reqQty));
            directWithdrawnByCode.add(compCode);
            withdrawnItems.push(item);
            return;
          } else if (reqQty > 0) {
            // Saturazione parziale: la quota residua resta in pendingItems (già decurtata in calculateMRPTimelines)
            remainingWithdrawnByCode.set(compCode, 0);
          }
        }
      }

      pendingItems.push(item);
    });

    const formatWithdrawnDetail = (i: (typeof bom)[number]) => {
      const compCode = (i.component || '').trim().toUpperCase();
      const completedPhaseName = phaseCompletedPhaseByCode.get(compCode);
      if (completedPhaseName) {
        return `✅ ${i.component} - Prelevato (Fase "${completedPhaseName}" completata)`;
      }
      if (directWithdrawnByCode.has(compCode)) {
        return `✅ ${i.component} - Prelevato (tramite scarico diretto a magazzino)`;
      }
      return `✅ ${i.component} - Prelevato`;
    };

    // Tutti i componenti già prelevati, assolti da fase completata o esternalizzati in C.to Lavoro
    if (pendingItems.length === 0) {
      const isAllExternalized = externalizedItems.length > 0 && withdrawnItems.length === 0;
      return {
        state: 'GREEN',
        label: isAllExternalized ? 'C.to Lavoro' : 'Pronto',
        badgeClass: isAllExternalized
          ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 font-semibold'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold',
        dotClass: isAllExternalized ? 'bg-purple-500' : 'bg-emerald-500',
        details: [
          ...withdrawnItems.map(formatWithdrawnDetail),
          ...externalizedItems.map((i) => `🚚 ${i.component} - Inviato a terzista (C.to Lavoro)`),
        ],
      };
    }

    // Raccogli entry MRP solo per i componenti effettivamente ancora pendenti
    const entries: { component: string; entry?: MRPTimelineEntry }[] = [];
    let hasMissingData = false;
    const pendingCodesSet = new Set<string>();

    pendingItems.forEach((item) => {
      const matCode = (item.component || '').trim().toUpperCase();
      pendingCodesSet.add(matCode);
      const timeline = mrpTimelines.get(matCode) || [];
      const entry = timeline.find((e) => e.jobId === job.id);
      if (entry) {
        entries.push({ component: matCode, entry });
      } else {
        hasMissingData = true;
      }
    });

    // FASE 67 & FASE 94: SHORT-CIRCUIT AVANZAMENTO PREPARAZIONE E SESSIONI ATTIVE
    // Controlla sessioni aperte SOLO per i componenti la cui fase non è ancora completata (pendingCodesSet).
    const derivedStatus = getDerivedJobStatus(job);
    const PREP_FINISHED_STATUSES = ['PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'CHIUSO'];
    const isPrepFinished = PREP_FINISHED_STATUSES.includes(derivedStatus) ||
      ['PRONTO', 'PRONTO PROD', 'IN PROD', 'FINE PROD'].includes((job.status || '').toUpperCase().trim());

    if (isPrepFinished) {
      const hasJobActiveSession = activeSessions.some((s) => {
        if (s.status !== 'open') return false;
        const sessMatCode = (s.materialCode || '').trim().toUpperCase();
        if (sessMatCode && !pendingCodesSet.has(sessMatCode)) {
          return false;
        }
        const ids = s.linkedJobOrderIds || [];
        const pfs = s.linkedJobOrderPFs || [];
        return (
          ids.includes(job.id) ||
          (job.ordinePF && (ids.includes(job.ordinePF) || pfs.includes(job.ordinePF))) ||
          (job.numeroODLInterno && ids.includes(job.numeroODLInterno))
        );
      });

      if (hasJobActiveSession) {
        return {
          state: 'SESSION_OPEN',
          label: 'Sessione in Macchina',
          badgeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-semibold animate-pulse',
          dotClass: 'bg-blue-500 animate-ping',
          details: [
            '⏳ Materiale in lavorazione, in attesa di pesata finale.',
            ...withdrawnItems.map(formatWithdrawnDetail),
            ...pendingItems.map((i) => `🧵 ${i.component} - In lavorazione in sessione attiva`),
          ],
        };
      }

      return {
        state: 'READY',
        label: 'Pronto',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold',
        dotClass: 'bg-emerald-500',
        details: [
          '✅ Preparazione completata / Materiale già prelevato.',
          ...withdrawnItems.map(formatWithdrawnDetail),
          ...pendingItems.map((i) => `⚡ ${i.component} - Assolto in preparazione`),
        ],
      };
    }

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

    // MAPPATURA RIGOROSA DEGLI STATI MRP (HIERARCHY):
    // 1. MANCANTE (Red): Stock Proiettato < 0 E nessun PO a copertura. Azione: comprare.
    // 2. RITARDO FORNITORE (Supplier Late): Coperto da PO con data < oggi scaduto non consegnato. Azione: sollecitare fornitore.
    // 3. DA ANTICIPARE (Expedite Needed): Coperto da PO futuro ma successivo a consegna commessa. Azione: anticipare fornitura o riprogrammare.
    // 4. ORDINATO / IN ARRIVO (Indigo): Coperto da PO in arrivo entro la data consegna.
    // 5. PRONTO (Green): Coperto da stock fisico o prelevato.
    let hasRed = false;
    let hasSupplierLate = false;
    let hasExpediteNeeded = false;
    let hasLate = false;
    let hasOrderedInTime = false;

    const details: string[] = [
      ...withdrawnItems.map(formatWithdrawnDetail),
      ...externalizedItems.map((i) => `🚚 ${i.component} - Inviato a terzista (C.to Lavoro)`),
      ...entries.map((e) => {
        if (!e.entry) return `📦 ${e.component}: Verifica disponibilità`;
        const matCode = (e.component || '').trim().toUpperCase();
        const pos = poCacheRef.current.get(matCode) || [];
        const hasAnyPO = pos.length > 0 || (e.entry.totalPO || 0) > 0;
        const isUncovered = e.entry.projectedBalance < -0.001;

        let statusText: string;
        if (e.entry.status === 'RED') {
          hasRed = true;
          statusText = '🔴 MANCANTE (Stock fisico e ordini fornitore insufficienti)';
        } else if (e.entry.status === 'SUPPLIER_LATE') {
          hasSupplierLate = true;
          statusText = '🔴 RITARDO FORNITORE (Ordine scaduto non ancora consegnato)';
        } else if (e.entry.status === 'EXPEDITE_NEEDED') {
          hasExpediteNeeded = true;
          statusText = '🟠 ARRIVO LUNGO / DA ANTICIPARE (Ordine in arrivo dopo la consegna commessa)';
        } else if (e.entry.status === 'LATE') {
          hasLate = true;
          statusText = '🟠 RITARDO MATERIALE (Fornitore in ritardo o consegna successiva)';
        } else if (e.entry.status === 'ORDERED' || e.entry.status === 'AMBER') {
          hasOrderedInTime = true;
          statusText = '💜 IN ARRIVO (Coperto da ordine fornitore in tempo)';
        } else if (e.entry.status === 'LOW_STOCK') {
          statusText = '⚠️ SOTTOSCORTA (Disponibile da stock, ma sotto scorta)';
        } else {
          statusText = '🟢 DISPONIBILE (Stock fisico)';
        }

        const dList = e.entry.details || [];
        const dDetail = dList.length > 0 ? ` (${dList.filter(d => !d.startsWith(' [DBG:') && !d.startsWith('Fabbisogno:')).join('; ')})` : '';
        const balDetail = ` [Saldo al bisogno: ${e.entry.projectedBalance.toFixed(2)}]`;
        return `📦 ${e.component}: ${statusText}${dDetail}${balDetail}`;
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

    if (hasSupplierLate) {
      return {
        state: 'SUPPLIER_LATE',
        label: 'RITARDO FORN.',
        badgeClass: 'bg-red-600/15 text-red-600 dark:text-red-400 border-red-600/30 font-bold',
        dotClass: 'bg-red-600 animate-pulse',
        details,
      };
    }

    if (hasExpediteNeeded) {
      return {
        state: 'EXPEDITE_NEEDED',
        label: 'DA ANTICIPARE',
        badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold',
        dotClass: 'bg-amber-500',
        details,
      };
    }

    if (hasLate) {
      return {
        state: 'LATE',
        label: 'In Ritardo',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-semibold',
        dotClass: 'bg-amber-500',
        details,
      };
    }

    if (hasOrderedInTime) {
      return {
        state: 'ORDERED',
        label: 'In Arrivo',
        badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 font-semibold',
        dotClass: 'bg-indigo-500',
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
  }, [mrpTimelines, isMrpLoading, activeSessions, phaseTemplates, withdrawalIndex, globalSettings]);

  // =========================================================================
  // 1. INLINE EDITING: DATA CONSEGNA (GG/MM/AAAA) - SALVATAGGIO DIFFERITO (FASE 85 OPTIMISTIC MUTATE)
  // =========================================================================
  const handleSaveDeliveryDate = useCallback(async (job: JobOrder, isoFormatted: string, parsedDate?: Date) => {
    const prevJob = { ...job };

    if (!isoFormatted) {
      // Data azzerata (Optimistic Update)
      const emptyPatch: Partial<JobOrder> = {
        dataConsegnaFinale: '',
        assignedDate: undefined,
        isoWeek: null,
        weekYear: null,
        targetWeek: null,
      };
      mutateJobs(
        (currentJobs) => currentJobs.map((j) => (j.id === job.id ? { ...j, ...emptyPatch } : j)),
        { revalidate: false, patchedJobId: job.id, patch: emptyPatch }
      );
      try {
        const res = await updateJobDeliveryDate(job.id, '');
        if (res.success) {
          mutateJobs(
            (currentJobs) =>
              currentJobs.map((j) =>
                j.id === job.id ? { ...j, ...emptyPatch, ...(res.updatedFields || {}) } : j
              ),
            { revalidate: false, patchedJobId: job.id, patch: { ...emptyPatch, ...(res.updatedFields || {}) } }
          );
          acknowledgeLocalMutation('jobsBom', 'local:updateJobDeliveryDate');
          toast({
            title: "Data Consegna Rimossa",
            description: `Commessa ${job.ordinePF}: data di consegna azzerata.`,
          });
        } else {
          mutateJobs(
            (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
            { revalidate: false, clearPatchId: job.id }
          );
          toast({
            variant: "destructive",
            title: "Errore Data",
            description: res.message || "Impossibile rimuovere la data.",
          });
        }
      } catch (e: any) {
        mutateJobs(
          (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
          { revalidate: false, clearPatchId: job.id }
        );
        toast({
          variant: "destructive",
          title: "Errore Data",
          description: e?.message || "Impossibile rimuovere la data.",
        });
      }
      return;
    }

    const parsed = parsedDate || parseRobustDate(isoFormatted);
    if (!parsed || isNaN(parsed.getTime())) return;

    const newWeek = getISOWeek(parsed);
    const newYear = getISOWeekYear(parsed);
    const newTargetWeek = `${newYear}-W${String(newWeek).padStart(2, '0')}`;

    const optimisticPatch: Partial<JobOrder> = {
      dataConsegnaFinale: isoFormatted,
      assignedDate: undefined,
      isoWeek: newWeek,
      weekYear: newYear,
      targetWeek: newTargetWeek,
    };

    // 1. Aggiornamento Ottimistico immediato (revalidate: false)
    mutateJobs(
      (currentJobs) =>
        currentJobs.map((j) => (j.id === job.id ? { ...j, ...optimisticPatch } : j)),
      { revalidate: false, patchedJobId: job.id, patch: optimisticPatch }
    );

    try {
      const res = await updateJobDeliveryDate(job.id, isoFormatted);
      if (res.success) {
        const confirmedPatch: Partial<JobOrder> = {
          ...optimisticPatch,
          ...(res.updatedFields || {}),
          dataConsegnaFinale: isoFormatted,
        };
        mutateJobs(
          (currentJobs) =>
            currentJobs.map((j) => (j.id === job.id ? { ...j, ...confirmedPatch } : j)),
          { revalidate: false, patchedJobId: job.id, patch: confirmedPatch }
        );
        acknowledgeLocalMutation('jobsBom', 'local:updateJobDeliveryDate');
        toast({
          title: "Data Consegna Salvata",
          description: `Commessa ${job.ordinePF}: consegna aggiornata al ${format(parsed, 'dd/MM/yyyy')}.`,
        });
      } else {
        mutateJobs(
          (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
          { revalidate: false, clearPatchId: job.id }
        );
        toast({
          variant: "destructive",
          title: "Errore Data",
          description: res.message || "Impossibile salvare la nuova data.",
        });
      }
    } catch (e: any) {
      mutateJobs(
        (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
        { revalidate: false, clearPatchId: job.id }
      );
      toast({
        variant: "destructive",
        title: "Errore Data",
        description: e?.message || "Impossibile salvare la nuova data.",
      });
    }
  }, [toast, mutateJobs]);

  // Aggiornamento N° ODL (on blur / Enter differito con validazione unicità anti-doppione e Optimistic Mutate FASE 85)
  const handleSaveOdl = useCallback(async (job: JobOrder, draftVal: string): Promise<boolean> => {
    const currentClean = getJobCleanOdl(job);
    const cleanDraft = getCleanOdlValue(draftVal);
    if (cleanDraft === currentClean) return true;

    // Se l'utente imposta un valore ODL, convalida l'unicità
    if (cleanDraft) {
      // 1. Controllo rapido in memoria locale sulle commesse caricate
      const localConflict = jobs.find(
        (j) => j.id !== job.id && getJobCleanOdl(j).toLowerCase() === cleanDraft.toLowerCase()
      );
      if (localConflict) {
        toast({
          variant: "destructive",
          title: "Errore N° ODL",
          description: `Errore: Il numero ODL '${cleanDraft}' è già assegnato a un'altra commessa (${localConflict.ordinePF || localConflict.id}).`,
        });
        return false;
      }

      // 2. Controllo Firestore globale escludendo la commessa corrente
      try {
        const checkRes = await checkUniqueODL(cleanDraft, job.id);
        if (!checkRes.isUnique) {
          toast({
            variant: "destructive",
            title: "Errore N° ODL",
            description: checkRes.message || `Errore: Il numero ODL '${cleanDraft}' è già assegnato a un'altra commessa.`,
          });
          return false;
        }
      } catch (err: any) {
        toast({
          variant: "destructive",
          title: "Errore Verifica N° ODL",
          description: err?.message || "Impossibile verificare l'univocità del N° ODL.",
        });
        return false;
      }
    }

    const odlPatch: Partial<JobOrder> = {
      numeroODLInterno: cleanDraft || null,
      numeroODL: cleanDraft || null,
    };

    // 1. Optimistic Update immediato (revalidate: false)
    mutateJobs(
      (currentJobs) =>
        currentJobs.map((j) => (j.id === job.id ? { ...j, ...odlPatch } : j)),
      { revalidate: false, patchedJobId: job.id, patch: odlPatch }
    );

    try {
      const res = await updateJobOdlNumber(job.id, cleanDraft);
      if (res.success) {
        if (res.nextOdl) {
          setNextOdlPreview(res.nextOdl);
        }
        mutateJobs(
          (currentJobs) =>
            currentJobs.map((j) => (j.id === job.id ? { ...j, ...odlPatch } : j)),
          { revalidate: false, patchedJobId: job.id, patch: odlPatch }
        );
        acknowledgeLocalMutation('jobsBom', 'local:updateJobOdlNumber');
        toast({
          title: "N° ODL Aggiornato",
          description: cleanDraft
            ? `Commessa ${job.ordinePF}: impostato ODL "${cleanDraft}".`
            : `Commessa ${job.ordinePF}: ODL rimosso.`,
        });
        return true;
      } else {
        // Ripristino ottimistico in caso di rifiuto server
        mutateJobs(
          (currentJobs) =>
            currentJobs.map((j) =>
              j.id === job.id
                ? { ...j, numeroODLInterno: currentClean || null, numeroODL: currentClean || null }
                : j
            ),
          { revalidate: false, clearPatchId: job.id }
        );
        toast({
          variant: "destructive",
          title: "Errore N° ODL",
          description: res.message || "Impossibile salvare il N° ODL.",
        });
        return false;
      }
    } catch (e: any) {
      mutateJobs(
        (currentJobs) =>
          currentJobs.map((j) =>
            j.id === job.id
              ? { ...j, numeroODLInterno: currentClean || null, numeroODL: currentClean || null }
              : j
          ),
        { revalidate: false, clearPatchId: job.id }
      );
      toast({
        variant: "destructive",
        title: "Errore N° ODL",
        description: e?.message || "Impossibile salvare il N° ODL.",
      });
      return false;
    }
  }, [jobs, toast, mutateJobs]);

  // Modifica Stato Commessa (4 stati SSoT rigorosi + Optimistic Mutate FASE 85)
  const handleStatusChange = useCallback(async (job: JobOrder, newStatus: JobStatusOption, isConfirmed?: boolean) => {
    // FASE 16: Guardrail Data Consegna Obbligatoria
    if ((!job.dataConsegnaFinale || !job.dataConsegnaFinale.trim()) && newStatus !== 'Pianificata') {
      toast({
        variant: "destructive",
        title: "Data di Consegna Mancante",
        description: "Inserire Data di Consegna per avviare o modificare lo stato.",
      });
      return;
    }

    const prevJob = { ...job };
    const currentStatus = normalizeJobStatus(job);
    if (currentStatus === newStatus) return;

    // FASE 19: Alert di conferma al rollback (se non già confermato tramite tasto Undo)
    if (newStatus === 'Pianificata' && !isConfirmed && (currentStatus === 'In Produzione' || currentStatus === 'Completato Prod.' || currentStatus === 'Spedito')) {
      const confirmReset = window.confirm(
        `Vuoi davvero annullare l'avvio e riportare la commessa ${job.ordinePF || job.id} in 'Pianificata'?\n\nLe fasi torneranno in attesa e i timer di produzione verranno azzerati.`
      );
      if (!confirmReset) return;
    }

    let optimisticStatusPatch: Partial<JobOrder> = {};
    if (newStatus === 'Pianificata') {
      optimisticStatusPatch = {
        status: 'IN_PIANIFICAZIONE',
        forcedCompletion: false,
        packingListId: undefined,
        overallStartTime: undefined as any,
        overallEndTime: undefined as any,
        odlCreationDate: undefined as any,
        isProblemReported: false,
        phases: (job.phases || []).map((p) => ({
          ...p,
          status: 'pending' as const,
          workPeriods: [],
          materialConsumptions: [],
          qualityResult: null,
          materialReady: p.isIndependent || p.type === 'preparation',
        })),
      };
    } else if (newStatus === 'In Produzione') {
      if (currentStatus === 'Completato Prod.' || currentStatus === 'Spedito') {
        const { updatedPhases } = rollbackLastCompletedPhase(job.phases || []);
        optimisticStatusPatch = {
          status: 'IN_PRODUZIONE',
          phases: updatedPhases,
          forcedCompletion: false,
          overallEndTime: undefined as any,
          packingListId: undefined,
        };
      } else {
        optimisticStatusPatch = {
          status: 'DA_INIZIARE',
          forcedCompletion: false,
          overallEndTime: undefined as any,
          packingListId: undefined,
        };
      }
    } else if (newStatus === 'Completato Prod.') {
      optimisticStatusPatch = {
        status: 'completed',
        forcedCompletion: true,
        overallEndTime: new Date().toISOString() as any,
        phases: (job.phases || []).map((p) => ({
          ...p,
          status: 'completed' as const,
          forced: true,
        })),
      };
    } else if (newStatus === 'Spedito') {
      optimisticStatusPatch = {
        status: 'SPEDITA',
        forcedCompletion: true,
        overallEndTime: new Date().toISOString() as any,
        phases: (job.phases || []).map((p) => ({
          ...p,
          status: 'completed' as const,
          forced: true,
        })),
      };
    }

    // 1. Aggiornamento ottimistico immediato (revalidate: false)
    mutateJobs(
      (currentJobs) =>
        currentJobs.map((j) => (j.id === job.id ? { ...j, ...optimisticStatusPatch } : j)),
      { revalidate: false, patchedJobId: job.id, patch: optimisticStatusPatch }
    );

    try {
      const res = await updateJobExecutionStatus(job.id, newStatus);
      if (!res.success) {
        mutateJobs(
          (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
          { revalidate: false, clearPatchId: job.id }
        );
        toast({
          variant: "destructive",
          title: "Operazione Non Riuscita",
          description: res.message,
        });
        return;
      }

      if (res.nextOdl) {
        setNextOdlPreview(res.nextOdl);
      }

      const confirmedStatusPatch: Partial<JobOrder> = {
        ...optimisticStatusPatch,
        ...(res.updatedStatus ? { status: res.updatedStatus as any } : {}),
        ...(res.updatedPhases ? { phases: res.updatedPhases } : {}),
        ...(res.odlNumber ? { numeroODL: res.odlNumber, numeroODLInterno: res.odlNumber } : {}),
      };

      // 2. Iniezione diretta in cache del risultato confermato senza revalidate/router.refresh conflittuale
      mutateJobs(
        (currentJobs) =>
          currentJobs.map((j) => (j.id === job.id ? { ...j, ...confirmedStatusPatch } : j)),
        { revalidate: false, patchedJobId: job.id, patch: confirmedStatusPatch }
      );
      acknowledgeLocalMutation('jobsBom', 'local:updateJobExecutionStatus');

      toast({
        title: newStatus === 'Pianificata' ? "Commessa Ripristinata" : "Stato Commessa Modificato",
        description: res.message,
      });
    } catch (e: any) {
      mutateJobs(
        (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
        { revalidate: false, clearPatchId: job.id }
      );
      toast({
        variant: "destructive",
        title: "Errore Aggiornamento Stato",
        description: e?.message || "Impossibile aggiornare lo stato.",
      });
    }
  }, [toast, mutateJobs]);

  // FASE 19: Handler dedicato per Rollback rapido da pulsante Undo/RotateCcw
  const handleRollbackJob = useCallback(async (job: JobOrder) => {
    const confirmReset = window.confirm(
      `Vuoi davvero annullare l'avvio e riportare la commessa ${job.ordinePF || job.id} in 'Pianificata'?\n\nLe fasi torneranno in attesa e i timer di produzione verranno azzerati.`
    );
    if (!confirmReset) return;
    await handleStatusChange(job, 'Pianificata', true);
  }, [handleStatusChange]);

  // FASE 28: Handler dedicato per eliminazione singola commessa (solo stato Pianificata)
  const handleDeleteJob = useCallback(async (job: JobOrder) => {
    const status = normalizeJobStatus(job);
    if (status !== 'Pianificata') {
      toast({
        variant: "destructive",
        title: "Azione non consentita",
        description: "Solo le commesse in stato 'Pianificata' possono essere eliminate. Esegui prima il rollback.",
      });
      return;
    }

    const confirmDelete = window.confirm(
      `Sei sicuro di voler eliminare la commessa ${job.ordinePF ? `"${job.ordinePF}"` : ''}? L'azione è irreversibile.`
    );
    if (!confirmDelete) return;

    // Optimistic UI: rimuovi subito la commessa
    const previousJobs = [...jobs];
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    setSelectedJobIds((prev) => prev.filter((id) => id !== job.id));

    try {
      const res = await deleteJobOrder(job.id);
      if (!res.success) {
        setJobs(previousJobs);
        toast({
          variant: "destructive",
          title: "Errore durante l'eliminazione",
          description: res.message || "Impossibile eliminare la commessa su Firestore.",
        });
      } else {
        acknowledgeLocalMutation('jobsBom', 'local:deleteJobOrder');
        toast({
          title: "Commessa eliminata",
          description: `La commessa ${job.ordinePF || ''} è stata eliminata definitivamente.`,
        });
      }
    } catch (error: any) {
      setJobs(previousJobs);
      console.error("Errore handleDeleteJob:", error);
      toast({
        variant: "destructive",
        title: "Errore imprevisto",
        description: error?.message || "Si è verificato un errore durante l'eliminazione.",
      });
    }
  }, [jobs, toast]);

  // 4. Workflow Avvio Produzione: richiama createODL transazionale (con intercetto FASE 84 & anti-duplicato FASE 84-BIS)
  const executeStartProduction = useCallback(async (job: JobOrder, chosenOdl?: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await startJobProduction(job.id, chosenOdl);
      if (!res.success) {
        const errText = res.error || res.message || "Impossibile avviare la commessa.";
        toast({
          variant: "destructive",
          title: "Impossibile Avviare Commessa",
          description: errText,
        });
        return { ok: false, error: errText };
      }

      if (res.nextOdl) {
        setNextOdlPreview(res.nextOdl);
      } else {
        getNextOdlNumber()
          .then((freshOdl) => {
            if (freshOdl) setNextOdlPreview(freshOdl);
          })
          .catch(() => {});
      }

      toast({
        title: "Commessa Avviata in Produzione",
        description: res.message,
      });

      const finalOdl = res.job?.numeroODL || res.job?.numeroODLInterno || chosenOdl || job.numeroODL || job.numeroODLInterno;
      const startPatch: Partial<JobOrder> = {
        status: (res.job?.status as any) || 'DA_INIZIARE',
        numeroODL: finalOdl,
        numeroODLInterno: finalOdl,
        odlCreationDate: res.job?.odlCreationDate || new Date().toISOString(),
      };

      mutateJobs(
        (currentJobs) =>
          currentJobs.map((j) => (j.id === job.id ? { ...j, ...startPatch } : j)),
        { revalidate: false, patchedJobId: job.id, patch: startPatch }
      );
      acknowledgeLocalMutation('jobsBom', 'local:startJobProduction');
      return { ok: true };
    } catch (e: any) {
      const errText = e?.message || "Errore sconosciuto";
      toast({
        variant: "destructive",
        title: "Errore durante l'avvio",
        description: errText,
      });
      return { ok: false, error: errText };
    }
  }, [toast, mutateJobs, acknowledgeLocalMutation]);

  const handleStartProduction = useCallback(async (job: JobOrder) => {
    const artKey = ((job as any).articolo || job.details || '').trim().toUpperCase();
    const relatedArticle = artKey ? articleMap.get(artKey) : undefined;
    const eligibility = evaluateJobStartEligibility(job, {
      hasArticleWorkCycle: Boolean(relatedArticle?.workCycleId && relatedArticle.workCycleId.trim()),
    });

    if (!eligibility.eligible) {
      if (eligibility.skipCategory === 'no_date') {
        toast({
          variant: "destructive",
          title: "Data di Consegna Mancante",
          description: "Inserire Data di Consegna per avviare.",
        });
      } else if (eligibility.skipCategory === 'no_cycle') {
        toast({
          variant: "destructive",
          title: "Ciclo di Lavorazione Mancante",
          description: "Nessun ciclo di lavorazione presente.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Impossibile Avviare Commessa",
          description: `La commessa ${job.ordinePF || job.id} non può essere avviata (${eligibility.reason}).`,
        });
      }
      return;
    }

    // FASE 84 & FASE 98-BIS: Usa lo stesso identico helper della colonna N° ODL in tabella.
    // Se l'ODL è già assegnato (es. 2309-26), avvia mantenendo l'ODL esistente senza incrementare il numeratore;
    // solo se è vuoto/N/D apre ConfirmOdlDialog con la proposta dal numeratore.
    const existingOdl = getJobCleanOdl(job);
    if (existingOdl) {
      await executeStartProduction(job, existingOdl);
    } else {
      setJobToConfirmOdl(job);
      setIsConfirmOdlModalOpen(true);
    }
  }, [articleMap, toast, executeStartProduction]);

  // =========================================================================
  // FASE 16: GESTIONE SELEZIONE MULTIPLA E AZIONI MASSIVE (BULK ACTIONS)
  // =========================================================================
  const allVisibleIds = useMemo(() => {
    return sortedAndFilteredJobs.map((j) => j.id);
  }, [sortedAndFilteredJobs]);

  const isAllSelected = useMemo(() => {
    return allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedJobIds.includes(id));
  }, [allVisibleIds, selectedJobIds]);

  const isSomeSelected = useMemo(() => {
    return allVisibleIds.some((id) => selectedJobIds.includes(id)) && !isAllSelected;
  }, [allVisibleIds, selectedJobIds, isAllSelected]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedJobIds((prev) => Array.from(new Set([...prev, ...allVisibleIds])));
    } else {
      setSelectedJobIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
    }
  };

  const handleToggleSelect = useCallback((jobId: string, checked: boolean) => {
    if (checked) {
      setSelectedJobIds((prev) => [...prev, jobId]);
    } else {
      setSelectedJobIds((prev) => prev.filter((id) => id !== jobId));
    }
  }, []);

  // FASE 88: Bulk Pre-fetcher Parallelo e Costruzione Dizionari O(1) in memoria per Stampa ODL
  // Elimina completamente le query N+1 / waterfall nel ciclo di stampa massiva
  const prepareBulkJobsForPrint = useCallback(async (targetJobs: JobOrder[]) => {
    const jobIds = targetJobs.map((j) => j.id).filter(Boolean);

    // 1. Estrai array unico di tutti gli articleCode dalle commesse selezionate
    const allArticleCodesSet = new Set<string>();
    const allMaterialCodesSet = new Set<string>();

    targetJobs.forEach((j) => {
      const artCode = ((j as any).articolo || j.details || (j as any).articleCode || '').trim().toUpperCase();
      if (artCode) {
        allArticleCodesSet.add(artCode);
        const cachedArt = articleMap.get(artCode) || articlesCacheRef.current.get(artCode);
        if (cachedArt?.billOfMaterials) {
          cachedArt.billOfMaterials.forEach((b) => {
            if (b?.component) allMaterialCodesSet.add(b.component.trim().toUpperCase());
          });
        }
      }
      (j.billOfMaterials || []).forEach((b) => {
        if (b?.component) allMaterialCodesSet.add(b.component.trim().toUpperCase());
      });
    });

    const missingArticleCodes = Array.from(allArticleCodesSet).filter(
      (code) => !articleMap.has(code) && !articlesCacheRef.current.has(code)
    );
    const missingMaterialCodes = Array.from(allMaterialCodesSet).filter(
      (code) => !materialsCacheRef.current.has(code) && !odlPrintMaterialsCacheRef.current.has(code)
    );

    // 2. Singola chiamata Bulk Pre-fetch parallela su Server Action (zero query N+1 nel loop)
    let serverBulkData: Awaited<ReturnType<typeof getOdlPrintData>> = {
      jobsById: {},
      articlesByCode: {},
      materialsByCode: {},
      contoLavoroMap: {},
    };

    try {
      // FASE 96 & FASE 100-BIS: Invia SOLO gli articoli e i materiali effettivamente mancanti dalle cache in memoria
      serverBulkData = await getOdlPrintData(
        jobIds,
        missingArticleCodes,
        missingMaterialCodes
      );

      // Idrata la cache articoli e la cache ISOLATA per la stampa ODL (MAI materialsCacheRef: getOdlPrintData omette le giacenze SSoT!)
      Object.values(serverBulkData.articlesByCode).forEach((art) => {
        if (art?.code) articlesCacheRef.current.set(art.code.trim().toUpperCase(), art);
        if (art?.id) articlesCacheRef.current.set(art.id.trim().toUpperCase(), art);
      });
      Object.values(serverBulkData.materialsByCode).forEach((mat) => {
        if (mat?.code) odlPrintMaterialsCacheRef.current.set(mat.code.trim().toUpperCase(), mat);
      });
    } catch (e) {
      console.warn("Avviso bulk pre-fetch stampa ODL (uso fallback cache in memoria):", e);
    }

    // 3. Costruisci Dizionari O(1) completi unendo cache locale + risposta bulk server (deduplicati in memoria)
    const articlesByCode: Record<string, Article> = { ...serverBulkData.articlesByCode };
    allArticleCodesSet.forEach((code) => {
      if (!articlesByCode[code]) {
        const localArt = articleMap.get(code) || articlesCacheRef.current.get(code);
        if (localArt) {
          articlesByCode[code] = localArt;
          if (localArt.code) articlesByCode[localArt.code.trim().toUpperCase()] = localArt;
          if (localArt.id) articlesByCode[localArt.id.trim().toUpperCase()] = localArt;
        }
      }
    });

    // Raccogli tutti i codici componente anche dalle BOM degli articoli risolti
    Object.values(articlesByCode).forEach((art) => {
      (art?.billOfMaterials || []).forEach((b) => {
        if (b?.component) allMaterialCodesSet.add(b.component.trim().toUpperCase());
      });
    });

    const materialsByCode: Record<string, RawMaterial> = { ...serverBulkData.materialsByCode };
    allMaterialCodesSet.forEach((code) => {
      if (!materialsByCode[code]) {
        const cachedMat = materialsCacheRef.current.get(code) || odlPrintMaterialsCacheRef.current.get(code);
        if (cachedMat) {
          materialsByCode[code] = cachedMat;
        }
      }
    });

    const contoLavoroMap: Record<string, string[]> = { ...serverBulkData.contoLavoroMap };
    targetJobs.forEach((localJob) => {
      const freshServerJob = serverBulkData.jobsById[localJob.id];
      const extSource =
        freshServerJob?.externalizedMaterials ??
        localJob.externalizedMaterials ??
        [];
      const normalizedExt = Array.from(
        new Set(extSource.map((m) => (m || '').trim().toUpperCase()).filter(Boolean))
      );
      // Se l'utente ha appena aggiornato ottimisticamente il Conto Lavoro in UI, preserva l'optimistic shield
      const shielded = optimisticPatchesRef.current.get(localJob.id)?.patch?.externalizedMaterials;
      const finalExt = shielded
        ? Array.from(new Set(shielded.map((m) => (m || '').trim().toUpperCase()).filter(Boolean)))
        : normalizedExt;

      contoLavoroMap[localJob.id] = finalExt;
      if (localJob.ordinePF) {
        contoLavoroMap[localJob.ordinePF] = finalExt;
      }
    });

    // 4. Risoluzione sincrona in memoria O(1) per ogni commessa selezionata
    return targetJobs.map((localJob) => {
      const serverJob = serverBulkData.jobsById[localJob.id];
      const mergedJob: JobOrder = serverJob
        ? {
            ...serverJob,
            ...localJob,
            externalizedMaterials: contoLavoroMap[localJob.id] || localJob.externalizedMaterials || [],
            billOfMaterials:
              localJob.billOfMaterials && localJob.billOfMaterials.length > 0
                ? localJob.billOfMaterials
                : serverJob.billOfMaterials || [],
          }
        : {
            ...localJob,
            externalizedMaterials: contoLavoroMap[localJob.id] || localJob.externalizedMaterials || [],
          };

      const articleCode = ((mergedJob as any).articolo || mergedJob.details || (mergedJob as any).articleCode || '')
        .trim()
        .toUpperCase();
      const article = (articleCode ? articlesByCode[articleCode] : null) || null;

      let bomItems = mergedJob.billOfMaterials || [];
      if ((!bomItems || bomItems.length === 0) && article?.billOfMaterials) {
        bomItems = article.billOfMaterials.map((item) => ({
          ...item,
          status: 'pending' as const,
          isFromTemplate: true,
        }));
      }

      // FASE 96: Passa solo i materiali pertinenti alla BOM della commessa invece dell'intera cache globale
      const jobMaterials: RawMaterial[] = [];
      const seenJobMatCodes = new Set<string>();
      bomItems.forEach((b) => {
        const compCode = (b?.component || '').trim().toUpperCase();
        if (compCode && !seenJobMatCodes.has(compCode)) {
          seenJobMatCodes.add(compCode);
          const mat = materialsByCode[compCode];
          if (mat) jobMaterials.push(mat);
        }
      });

      let jobPhases = mergedJob.phases || [];
      if ((!jobPhases || jobPhases.length === 0) && (mergedJob.workCycleId || article?.workCycleId)) {
        const cycleId = mergedJob.workCycleId || article?.workCycleId;
        const cycle = workCycles.find((c) => c.id === cycleId);
        if (cycle && (cycle as any).phases) {
          jobPhases = (cycle as any).phases;
        }
      }

      const currentOdl = getJobCleanOdl(mergedJob);
      const enrichedJob: JobOrder = {
        ...mergedJob,
        numeroODL: currentOdl,
        numeroODLInterno: currentOdl,
        billOfMaterials: bomItems,
        phases: jobPhases,
        externalizedMaterials: contoLavoroMap[mergedJob.id] || [],
      };

      return {
        enrichedJob,
        article,
        materials: jobMaterials,
        contoLavoroMap,
        materialsByCode,
        articlesByCode,
        currentOdl,
      };
    });
  }, [articleMap, workCycles]);

  // FASE 96: Helper non bloccante per attendere il paint DOM e il decode asincrono delle immagini nel container ODL
  const waitForOdlDomAndImagesReady = useCallback(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    const container = document.getElementById('odl-pdf-pages');
    if (!container) return null;

    const images = Array.from(container.querySelectorAll('img'));
    if (images.length > 0) {
      await Promise.race([
        Promise.all(
          images.map((img) => {
            if (img.complete) return Promise.resolve();
            if (typeof img.decode === 'function') {
              return img.decode().catch(() => {});
            }
            return new Promise<void>((res) => {
              img.addEventListener('load', () => res(), { once: true });
              img.addEventListener('error', () => res(), { once: true });
            });
          })
        ),
        new Promise<void>((res) => setTimeout(res, 600)),
      ]);
    }
    return container;
  }, []);

  // FASE 33 & FASE 88: Helper per singola commessa basato sul motore Bulk O(1)
  const prepareJobForPrint = useCallback(async (job: JobOrder) => {
    const [singlePrepared] = await prepareBulkJobsForPrint([job]);
    return singlePrepared;
  }, [prepareBulkJobsForPrint]);

  // 1. FASE 33, FASE 88 & FASE 96: Stampa Massiva ODL con Batch Mount Singolo, Pre-fetching Parallelo e Lookup O(1)
  const handleBulkPrintODL = async () => {
    if (selectedJobIds.length === 0) return;

    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    if (selectedJobs.length === 0) return;

    // Validazione N° ODL obbligatorio su TUTTE le commesse selezionate
    const missingOdlJobs = selectedJobs.filter((j) => !getJobCleanOdl(j));
    if (missingOdlJobs.length > 0) {
      toast({
        variant: "destructive",
        title: "Attenzione: N° ODL Mancante",
        description: `Attenzione: inserire il N° ODL per tutte le commesse selezionate prima di stampare (${missingOdlJobs.map(j => j.ordinePF || j.id).join(', ')}).`,
      });
      return;
    }

    setIsBulkProcessing(true);
    setIsBulkPrinting(true);

    try {
      toast({
        title: "Generazione PDF ODL in corso",
        description: `Pre-caricamento massivo parallelo per ${selectedJobs.length} commesse...`,
      });

      // FASE 88 & FASE 96: Esegui un UNICO Bulk Pre-fetch parallelo deduplicato PRIMA del rendering PDF
      const preparedJobsBatch = await prepareBulkJobsForPrint(selectedJobs);
      const printTimestamp = new Date();

      // FASE 96: Monta TUTTI i template ODL in un UNICO aggiornamento di stato React (1 solo re-render invece di N!)
      setPdfData(
        preparedJobsBatch.map((item) => ({
          job: item.enrichedJob,
          article: item.article,
          materials: item.materials,
          contoLavoroMap: item.contoLavoroMap,
          materialsByCode: item.materialsByCode,
          articlesByCode: item.articlesByCode,
          printDate: printTimestamp,
        }))
      );

      const container = await waitForOdlDomAndImagesReady();
      if (!container) {
        throw new Error("Template di stampa ODL non trovato nel DOM.");
      }

      const pageElements = container.querySelectorAll('.odl-page');
      if (pageElements.length === 0) {
        throw new Error("Nessuna pagina ODL generata per le commesse selezionate.");
      }

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      let totalPagesAdded = 0;

      for (let pIdx = 0; pIdx < pageElements.length; pIdx++) {
        // Cede il controllo al browser tra una pagina e l'altra per non congelare il main thread
        if (pIdx > 0) {
          await new Promise<void>((r) => setTimeout(r, 0));
        }
        const page = pageElements[pIdx] as HTMLElement;
        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          imageTimeout: 2500,
          logging: false,
          backgroundColor: '#ffffff'
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (totalPagesAdded > 0) {
          pdf.addPage();
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
        totalPagesAdded++;
      }

      if (totalPagesAdded > 0) {
        if (selectedJobs.length === 1) {
          const cleanOdl = getJobCleanOdl(selectedJobs[0]).replace(/\//g, '_');
          const cleanPf = (selectedJobs[0].ordinePF || '').replace(/\//g, '_');
          pdf.save(`ODL_${cleanOdl}_${cleanPf}.pdf`);
        } else {
          pdf.save(`ODL_Stampa_Massiva_${selectedJobs.length}_Commesse.pdf`);
        }
      }

      // Aggiorna stato locale di stampa (isPrinted: true, odlPrinted: true) SENZA cambiare status
      const printedIds = selectedJobs.map((j) => j.id);
      const printedSet = new Set(printedIds);

      setJobs((prev) =>
        prev.map((j) => {
          if (printedSet.has(j.id)) {
            return {
              ...j,
              isPrinted: true,
              odlPrinted: true,
            };
          }
          return j;
        })
      );

      toast({
        title: "Stampa ODL Completata",
        description: `${selectedJobs.length} ODL generati in PDF e contrassegnati come stampati.`,
      });

      // Persisti flag isPrinted su Firestore
      await bulkMarkJobsAsPrinted(printedIds);
    } catch (error: any) {
      console.error("Errore generazione ODL PDF massivo:", error);
      toast({
        variant: "destructive",
        title: "Errore Stampa Massiva ODL",
        description: error?.message || "Impossibile generare o scaricare il file PDF.",
      });
    } finally {
      setPdfData(null);
      setIsBulkPrinting(false);
      setIsBulkProcessing(false);
    }
  };

  // 2. FASE 33, FASE 81 & FASE 84-BIS: Avvio Massivo in Produzione (con refresh immediato badge Prossimo ODL)
  const handleBulkStartProduction = async () => {
    if (selectedJobIds.length === 0) return;

    setIsBulkProcessing(true);
    setIsBulkPrinting(false);
    try {
      const res = await bulkStartProduction(selectedJobIds).then(async (bulkRes) => {
        if (bulkRes.nextOdl) {
          setNextOdlPreview(bulkRes.nextOdl);
        } else {
          await getNextOdlNumber()
            .then((freshOdl) => {
              if (freshOdl) setNextOdlPreview(freshOdl);
            })
            .catch(() => {});
        }
        return bulkRes;
      });
      const detailError = res.error || res.message;

      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Errore Avvio Massivo",
          description: detailError || "Impossibile completare l'avvio massivo in produzione.",
        });
        return;
      }

      const startedIdsSet = new Set((res.startedJobs || []).map((s) => s.id));
      const startedMap = new Map((res.startedJobs || []).map((s) => [s.id, s]));

      setJobs((prev) =>
        prev.map((j) => {
          if (startedIdsSet.has(j.id)) {
            const startedInfo = startedMap.get(j.id);
            const assignedOdl = startedInfo?.numeroODLInterno || getJobCleanOdl(j) || j.numeroODLInterno || j.numeroODL;
            return {
              ...j,
              status: 'DA_INIZIARE',
              numeroODL: assignedOdl,
              numeroODLInterno: assignedOdl,
            };
          }
          return j;
        })
      );

      // Deseleziona le commesse avviate con successo
      setSelectedJobIds((prev) => prev.filter((id) => !startedIdsSet.has(id)));
      acknowledgeLocalMutation('jobsBom', 'local:bulkStartProduction', res.startedJobs.length);

      const hasSkipped = (res.skippedNoCycle && res.skippedNoCycle.length > 0) || 
                         (res.skippedNoDate && res.skippedNoDate.length > 0) ||
                         (res.skippedOther && res.skippedOther.length > 0);

      toast({
        title: hasSkipped ? "Avvio Parziale Completato" : "Avvio Produzione Completato",
        description: res.message,
      });

      if (res.skippedNoCycle && res.skippedNoCycle.length > 0) {
        toast({
          variant: "destructive",
          title: "Ciclo di Lavorazione Mancante",
          description: `${res.skippedNoCycle.length} ${res.skippedNoCycle.length === 1 ? 'commessa non avviata' : 'commesse non avviate'} (nessun ciclo configurato): ${res.skippedNoCycle.join(', ')}.`,
        });
      }

      if (res.skippedNoDate && res.skippedNoDate.length > 0) {
        toast({
          variant: "destructive",
          title: "Data di Consegna Mancante",
          description: `${res.skippedNoDate.length} ${res.skippedNoDate.length === 1 ? 'commessa esclusa' : 'commesse escluse'} (priva di data di consegna): ${res.skippedNoDate.join(', ')}.`,
        });
      }

      if (res.skippedOther && res.skippedOther.length > 0) {
        toast({
          variant: "destructive",
          title: "Commesse Escluse dall'Avvio",
          description: res.skippedOther.map((o) => o.reason).join('; '),
        });
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Operazione Massiva",
        description: e?.message || "Impossibile completare l'avvio massivo in produzione.",
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Backward compatibility alias
  const handleBulkStartAndPrint = handleBulkStartProduction;

  // 2. Bulk Change Delivery Date
  const handleBulkChangeDeliveryDate = async () => {
    if (selectedJobIds.length === 0) return;
    if (!bulkDateInput.trim()) {
      toast({
        variant: "destructive",
        title: "Data Richiesta",
        description: "Inserire una data valida (es. GG/MM/AAAA).",
      });
      return;
    }

    const parsedDate = parseRobustDate(bulkDateInput.trim());
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      toast({
        variant: "destructive",
        title: "Data Non Valida",
        description: "Formato data non riconosciuto. Usa il formato GG/MM/AAAA.",
      });
      return;
    }

    const isoFormatted = format(parsedDate, 'yyyy-MM-dd');
    const newWeek = getISOWeek(parsedDate);
    const newYear = getISOWeekYear(parsedDate);
    const newTargetWeek = `${newYear}-W${String(newWeek).padStart(2, '0')}`;

    setIsBulkProcessing(true);
    try {
      const res = await bulkUpdateJobDeliveryDate(selectedJobIds, isoFormatted);
      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Errore Modifica Date",
          description: res.message,
        });
        return;
      }

      const selectedSet = new Set(selectedJobIds);
      setJobs((prev) =>
        prev.map((j) => {
          if (selectedSet.has(j.id)) {
            return {
              ...j,
              dataConsegnaFinale: isoFormatted,
              assignedDate: undefined,
              isoWeek: newWeek,
              weekYear: newYear,
              targetWeek: newTargetWeek,
            };
          }
          return j;
        })
      );

      acknowledgeLocalMutation('jobsBom', 'local:bulkUpdateJobDeliveryDate');
      toast({
        title: "Data Consegna Aggiornata",
        description: `Data impostata al ${format(parsedDate, 'dd/MM/yyyy')} su ${res.updatedCount} commesse.`,
      });

      setBulkDateInput('');
      setIsBulkDateOpen(false);
      setSelectedJobIds([]);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Aggiornamento Massivo Data",
        description: e?.message || "Impossibile aggiornare le date.",
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // 3. Bulk Ship Jobs
  const handleBulkShip = async () => {
    if (selectedJobIds.length === 0) return;

    if (!window.confirm(`Sei sicuro di voler contrassegnare come SPEDITE ${selectedJobIds.length} commesse selezionate?`)) {
      return;
    }

    setIsBulkProcessing(true);
    try {
      const res = await bulkShipJobs(selectedJobIds);
      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Errore Spedizione Massiva",
          description: res.message,
        });
        return;
      }

      const selectedSet = new Set(selectedJobIds);
      setJobs((prev) =>
        prev.map((j) => {
          if (selectedSet.has(j.id)) {
            return {
              ...j,
              status: 'SPEDITA',
              forcedCompletion: true,
            };
          }
          return j;
        })
      );

      acknowledgeLocalMutation('jobsBom', 'local:bulkShipJobs');
      toast({
        title: "Spedizione Massiva Completata",
        description: res.message,
      });

      setSelectedJobIds([]);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Spedizione",
        description: e?.message || "Impossibile completare la spedizione massiva.",
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // FASE 28: Bulk Delete Jobs (solo stato Pianificata)
  const handleBulkDelete = async () => {
    if (selectedJobIds.length === 0) return;

    // Filtra commesse selezionate che sono effettivamente in stato 'Pianificata'
    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    const plannedJobs = selectedJobs.filter((j) => normalizeJobStatus(j) === 'Pianificata');
    const nonPlannedCount = selectedJobs.length - plannedJobs.length;

    if (plannedJobs.length === 0) {
      toast({
        variant: "destructive",
        title: "Nessuna commessa eliminabile",
        description: "Nessuna delle commesse selezionate è in stato 'Pianificata'. Solo le commesse pianificate possono essere eliminate.",
      });
      return;
    }

    let confirmMsg = `Sei sicuro di voler eliminare definitivamente le ${plannedJobs.length} commesse pianificate selezionate? L'azione è irreversibile.`;
    if (nonPlannedCount > 0) {
      confirmMsg += `\n\nNota: ${nonPlannedCount} commesse selezionate NON verranno eliminate perché già avviate, completate o spedite.`;
    }

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setIsBulkProcessing(true);

    const plannedIds = plannedJobs.map((j) => j.id);
    const previousJobs = [...jobs];

    // Optimistic UI: rimuovi subito le commesse pianificate eliminate
    setJobs((prev) => prev.filter((j) => !plannedIds.includes(j.id)));
    setSelectedJobIds((prev) => prev.filter((id) => !plannedIds.includes(id)));

    try {
      const res = await bulkDeleteJobOrders(plannedIds);
      if (!res.success) {
        setJobs(previousJobs);
        toast({
          variant: "destructive",
          title: "Errore eliminazione massiva",
          description: res.message || "Impossibile eliminare le commesse selezionate.",
        });
      } else {
        acknowledgeLocalMutation('jobsBom', 'local:bulkDeleteJobOrders');
        toast({
          title: "Eliminazione completata",
          description: res.message,
        });
      }
    } catch (error: any) {
      setJobs(previousJobs);
      console.error("Errore handleBulkDelete:", error);
      toast({
        variant: "destructive",
        title: "Errore imprevisto",
        description: error?.message || "Si è verificato un errore durante l'eliminazione massiva.",
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // =========================================================================
  // STAMPA ODL (FASE 9: Generatore PDF fisico + Aggiornamento Stato)
  // =========================================================================
  const handleTogglePrintODL = useCallback(async (job: JobOrder) => {
    // FASE 16: Guardrail Data Consegna Obbligatoria
    if (!job.dataConsegnaFinale || !job.dataConsegnaFinale.trim()) {
      toast({
        variant: "destructive",
        title: "Data di Consegna Mancante",
        description: "Inserire Data di Consegna per avviare.",
      });
      return;
    }

    // Risolvi il N° ODL dal valore salvato della commessa (esclude N/D o vuoto)
    const currentOdl = getJobCleanOdl(job);

    if (!currentOdl) {
      toast({
        variant: "destructive",
        title: "N° ODL Mancante",
        description: "Inserire N° ODL prima di stampare.",
      });
      return;
    }

    if (isDownloadingPdf) return;

    setIsDownloadingPdf(job.id);

    try {
      const {
        enrichedJob,
        article,
        materials,
        contoLavoroMap,
        materialsByCode,
        articlesByCode,
      } = await prepareJobForPrint(job);

      // =========================================================================
      // PASSO 1 (Azione Fisica): Monta il template e forza download PDF
      // =========================================================================
      setPdfData([
        {
          job: enrichedJob,
          article,
          materials,
          contoLavoroMap,
          materialsByCode,
          articlesByCode,
          printDate: new Date(),
        },
      ]);

      const container = await waitForOdlDomAndImagesReady();
      if (!container) {
        throw new Error("Template di stampa ODL non trovato nel DOM.");
      }

      const pageElements = container.querySelectorAll('.odl-page');
      if (pageElements.length === 0) {
        throw new Error("Nessuna pagina ODL generata.");
      }

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      for (let i = 0; i < pageElements.length; i++) {
        if (i > 0) {
          await new Promise<void>((r) => setTimeout(r, 0));
        }
        const page = pageElements[i] as HTMLElement;
        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          imageTimeout: 2500,
          logging: false,
          backgroundColor: '#ffffff'
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
      }

      const cleanOdl = currentOdl.replace(/\//g, '_');
      const cleanPf = (job.ordinePF || '').replace(/\//g, '_');
      pdf.save(`ODL_${cleanOdl}_${cleanPf}.pdf`);

      // =========================================================================
      // PASSO 2 (Azione Logica): Aggiorna stato locale e Server Actions
      // =========================================================================
      setJobs((prevJobs) =>
        prevJobs.map((j) =>
          j.id === job.id
            ? {
              ...j,
              numeroODL: currentOdl,
              numeroODLInterno: currentOdl,
              isPrinted: true,
              odlPrinted: true,
            }
            : j
        )
      );

      toast({
        title: "ODL Stampato con Successo",
        description: `Commessa ${job.ordinePF}: PDF scaricato. Icona verde di stampa attiva.`,
      });

      // Esegui la Server Action SSoT per persistere il flag isPrinted su Firestore
      await markJobAsPrinted(job.id);
    } catch (error: any) {
      console.error("Errore generazione ODL PDF:", error);
      toast({
        variant: "destructive",
        title: `Errore Download ODL ${job.ordinePF}`,
        description: error?.message || "Impossibile generare o scaricare il file PDF.",
      });
    } finally {
      setPdfData(null);
      setIsDownloadingPdf(null);
    }
  }, [prepareJobForPrint, waitForOdlDomAndImagesReady, toast, isDownloadingPdf]);

  // Settimane per il dropdown rapido (Standard ISO 8601 - Generate dinamicamente da tutte le commesse)
  const weekOptions = useMemo(() => {
    return generateAvailableWeeksFromJobs(jobs);
  }, [jobs]);

  // Riassegnazione manuale settimana per una commessa (con Optimistic Mutate FASE 85)
  const handleAssignJobWeek = useCallback(async (job: JobOrder, newWeekVal: string) => {
    const prevJob = { ...job };

    if (newWeekVal === 'Non ass.') {
      const unassignPatch: Partial<JobOrder> = {
        targetWeek: 'unassigned',
        assignedDate: undefined,
        isoWeek: null,
        weekYear: null,
      };
      mutateJobs(
        (currentJobs) => currentJobs.map((j) => (j.id === job.id ? { ...j, ...unassignPatch } : j)),
        { revalidate: false, patchedJobId: job.id, patch: unassignPatch }
      );
      try {
        const res = await updateJobAssignedWeek(job.id, null, null, null, 'unassigned');
        if (res.success) {
          acknowledgeLocalMutation('jobsBom', 'local:updateJobAssignedWeek');
          toast({
            title: "Settimana Rimossa",
            description: `Commessa ${job.ordinePF} non assegnata a nessun secchiello.`,
          });
        } else {
          mutateJobs(
            (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
            { revalidate: false, clearPatchId: job.id }
          );
        }
      } catch {
        mutateJobs(
          (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
          { revalidate: false, clearPatchId: job.id }
        );
      }
      return;
    }

    const opt = weekOptions.find((o) =>
      o.value === newWeekVal ||
      `W${o.weekNumber}` === newWeekVal ||
      `${o.year}-W${String(o.weekNumber).padStart(2, '0')}` === newWeekVal
    );
    if (!opt) return;

    // Lunedì della settimana alle 12:00
    const mondayIso = format(startOfISOWeek(opt.date), 'yyyy-MM-dd');
    const targetWeekStr = `${opt.year}-W${String(opt.weekNumber).padStart(2, '0')}`;

    const assignPatch: Partial<JobOrder> = {
      assignedDate: mondayIso,
      isoWeek: opt.weekNumber,
      weekYear: opt.year,
      targetWeek: targetWeekStr,
    };

    mutateJobs(
      (currentJobs) => currentJobs.map((j) => (j.id === job.id ? { ...j, ...assignPatch } : j)),
      { revalidate: false, patchedJobId: job.id, patch: assignPatch }
    );

    toast({
      title: "Spostamento Commessa",
      description: `Commessa ${job.ordinePF} riassegnata a ${opt.shortLabel}.`,
    });

    try {
      const res = await updateJobAssignedWeek(
        job.id,
        mondayIso,
        opt.weekNumber,
        opt.year,
        targetWeekStr
      );
      if (res.success) {
        acknowledgeLocalMutation('jobsBom', 'local:updateJobAssignedWeek');
      } else {
        mutateJobs(
          (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
          { revalidate: false, clearPatchId: job.id }
        );
      }
    } catch (e) {
      mutateJobs(
        (currentJobs) => currentJobs.map((j) => (j.id === job.id ? prevJob : j)),
        { revalidate: false, clearPatchId: job.id }
      );
      console.error("Errore salvataggio riassegnazione settimana:", e);
    }
  }, [weekOptions, toast, mutateJobs, acknowledgeLocalMutation]);

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
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] px-2 py-0.5 font-mono font-bold"
                  title="Prossimo numero ODL standard proposto dal numeratore automatico"
                >
                  Prossimo ODL: {nextOdlPreview || '---'}
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
                  {classifiedMRPAlarms.alarmCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full shadow-xs animate-in zoom-in">
                      {classifiedMRPAlarms.alarmCount}
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
                    Mancanze materiali e ritardi di fornitura per le {activeGlobalJobs.length} commesse attive aziendali (Pianificate e In Produzione).
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-4 space-y-4">
                  {classifiedMRPAlarms.alarmCount === 0 ? (
                    <div className="text-center p-6 text-muted-foreground bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                      <p className="font-semibold text-emerald-600">Nessuna criticità materiali urgente!</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Tutte le commesse attive risultano coperte da giacenza o ordini fornitore nei tempi previsti.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {classifiedMRPAlarms.groupedAlarms.map(({ category, worstCategoryStatus, materials }) => (
                        <div key={category} className="space-y-2">
                          {/* Intestazione Categoria/Famiglia Merceologica con ordinamento visivo (Mancanti in cima, poi Ritardi) */}
                          <div className="flex items-center gap-2 mb-2 mt-2">
                            <div className="h-px bg-border flex-1"></div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">{category}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] py-0 px-1 font-bold",
                                  worstCategoryStatus === 'RED'
                                    ? "border-red-400 text-red-600 bg-red-50/50 dark:bg-red-950/20"
                                    : worstCategoryStatus === 'SUPPLIER_LATE'
                                      ? "border-red-500 text-red-600 bg-red-50/50 dark:bg-red-950/20"
                                      : "border-amber-400 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20"
                                )}
                              >
                                {worstCategoryStatus === 'RED'
                                  ? '🔴 MANCANTI'
                                  : worstCategoryStatus === 'SUPPLIER_LATE'
                                    ? '🔴 RITARDO FORNITORE'
                                    : '🟠 DA ANTICIPARE'}
                              </Badge>
                            </div>
                            <div className="h-px bg-border flex-1"></div>
                          </div>

                          {/* Accordion Materiali della Categoria */}
                          <Accordion type="single" collapsible className="w-full space-y-2">
                            {materials.map((mat) => {
                              const worstLabel =
                                mat.worstStatus === 'RED' ? 'MANCANTE' :
                                  mat.worstStatus === 'SUPPLIER_LATE' ? 'RITARDO FORN.' :
                                    mat.worstStatus === 'EXPEDITE_NEEDED' ? 'DA ANTICIPARE' :
                                      mat.worstStatus === 'LATE' ? 'IN RITARDO' : 'ORDINATO';

                              const worstBadgeClass =
                                mat.worstStatus === 'RED' || mat.worstStatus === 'SUPPLIER_LATE'
                                  ? 'bg-red-600 text-white font-bold'
                                  : 'bg-amber-500 text-white font-bold';

                              return (
                                <AccordionItem key={mat.matCode} value={mat.matCode} className="border rounded-md px-2">
                                  <AccordionTrigger className="hover:no-underline py-2">
                                    <div className="flex items-center justify-between w-full pr-3 text-left">
                                      <div className="flex flex-col items-start gap-0.5">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono font-bold text-xs">{mat.matCode}</span>
                                          <Badge className={`text-[9px] py-0 px-1.5 font-bold ${worstBadgeClass}`}>
                                            {worstLabel}
                                          </Badge>
                                        </div>
                                        {/* FASE 46: Sostituzione Descrizione con Data Critica (First Needed Date) */}
                                        {mat.criticalDateFormatted ? (
                                          <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={cn(
                                              "text-[10.5px] font-mono flex items-center gap-1",
                                              mat.isCriticalDateUrgent
                                                ? "text-red-600 dark:text-red-400 font-bold"
                                                : "text-muted-foreground font-medium"
                                            )}>
                                              <span>Richiesto per il: <strong className={cn(mat.isCriticalDateUrgent && "underline underline-offset-2")}>{mat.criticalDateFormatted}</strong></span>
                                            </span>
                                            {mat.isCriticalDateUrgent && (
                                              <span className="text-[9px] uppercase tracking-wider bg-red-600 text-white dark:bg-red-500/20 dark:text-red-300 px-1 py-0.2 rounded-xs font-extrabold animate-pulse">
                                                URGENTE
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-[10px] text-muted-foreground font-normal mt-0.5">
                                            Data non specificata
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] font-mono flex items-center gap-1.5">
                                        {mat.countRed > 0 && (
                                          <span className="text-red-500 font-bold">{mat.countRed} mancanti</span>
                                        )}
                                        {mat.countSupplierLate > 0 && (
                                          <span className="text-red-600 dark:text-red-400 font-bold">{mat.countSupplierLate} ritardo forn.</span>
                                        )}
                                        {mat.countExpediteNeeded > 0 && (
                                          <span className="text-amber-500 font-bold">{mat.countExpediteNeeded} da anticipare</span>
                                        )}
                                        {mat.countLate > 0 && mat.countSupplierLate === 0 && mat.countExpediteNeeded === 0 && (
                                          <span className="text-amber-500 font-bold">{mat.countLate} in ritardo</span>
                                        )}
                                        <span className="text-muted-foreground">su {mat.entriesWithVisual.length}</span>
                                      </div>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="pt-1 pb-2 space-y-2 text-xs">
                                    {mat.entriesWithVisual.map(({ entry, job, visualStatus }, idx) => (
                                      <div
                                        key={idx}
                                        className={cn(
                                          "p-2.5 rounded-md border text-[11px] space-y-1.5 transition-colors",
                                          visualStatus === 'RED' || visualStatus === 'SUPPLIER_LATE'
                                            ? "border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/20"
                                            : visualStatus === 'EXPEDITE_NEEDED' || visualStatus === 'LATE'
                                              ? "border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20"
                                              : visualStatus === 'ORDERED'
                                                ? "border-indigo-200 bg-indigo-50/30 dark:border-indigo-900/40 dark:bg-indigo-950/15"
                                                : "border-border bg-muted/20 text-muted-foreground"
                                        )}
                                      >
                                        <div className="flex items-center justify-between font-mono">
                                          <div className="flex items-center gap-1.5">
                                            <span className={cn(
                                              "font-bold",
                                              visualStatus === 'RED' || visualStatus === 'SUPPLIER_LATE' ? "text-red-700 dark:text-red-300" :
                                                visualStatus === 'EXPEDITE_NEEDED' || visualStatus === 'LATE' ? "text-amber-700 dark:text-amber-300" :
                                                  visualStatus === 'ORDERED' ? "text-indigo-700 dark:text-indigo-300" :
                                                    "text-foreground"
                                            )}>
                                              {job?.ordinePF || entry.jobId}
                                            </span>
                                            {job && (
                                              <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold">
                                                {getJobDepartmentGroup(job)}
                                              </Badge>
                                            )}
                                          </div>
                                          <span className="text-muted-foreground truncate max-w-[150px]">{job?.cliente}</span>
                                        </div>

                                        <div className="flex items-center justify-between text-[10px]">
                                          <span>
                                            Data Cons: <strong className="text-foreground">{job?.dataConsegnaFinale ? formatDateForDisplay(job.dataConsegnaFinale) : 'N/D'}</strong>
                                          </span>
                                          <div className="flex items-center gap-1.5">
                                            <span className={cn(
                                              "font-bold uppercase text-[9px] px-1.5 py-0.2 rounded-xs",
                                              visualStatus === 'RED' || visualStatus === 'SUPPLIER_LATE'
                                                ? "bg-red-500/20 text-red-700 dark:text-red-300"
                                                : visualStatus === 'EXPEDITE_NEEDED' || visualStatus === 'LATE'
                                                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                                  : visualStatus === 'ORDERED'
                                                    ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400"
                                                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                            )}>
                                              {visualStatus === 'RED'
                                                ? '🔴 Mancante'
                                                : visualStatus === 'SUPPLIER_LATE'
                                                  ? '🔴 Ritardo Forn.'
                                                  : visualStatus === 'EXPEDITE_NEEDED'
                                                    ? '🟠 Da Anticipare'
                                                    : visualStatus === 'LATE'
                                                      ? '🟠 In Ritardo'
                                                      : visualStatus === 'ORDERED'
                                                        ? '💜 Ordinato'
                                                        : '🟢 Coperto'
                                              }
                                            </span>

                                            {/* FASE 44: Bottone Silenzia Allarme per singola commessa */}
                                            {job && (
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleMuteMaterial(job.id, mat.matCode);
                                                    }}
                                                    className="h-5 w-5 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-500/15 dark:hover:text-red-400 rounded-sm"
                                                  >
                                                    <BellOff className="h-3 w-3" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="text-xs">
                                                  Silenzia per questa commessa
                                                </TooltipContent>
                                              </Tooltip>
                                            )}
                                          </div>
                                        </div>

                                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40 font-mono">
                                          <span className="text-muted-foreground text-[10.5px]">
                                            Fabbisogno: <strong className="text-foreground">{entry.requiredQty.toFixed(2)}</strong>
                                          </span>
                                          <span className={cn(
                                            "font-bold text-[11px]",
                                            visualStatus === 'RED' || visualStatus === 'SUPPLIER_LATE'
                                              ? "text-red-600 dark:text-red-400"
                                              : visualStatus === 'EXPEDITE_NEEDED' || visualStatus === 'LATE'
                                                ? "text-amber-600 dark:text-amber-400"
                                                : visualStatus === 'ORDERED'
                                                  ? "text-indigo-600 dark:text-indigo-400"
                                                  : "text-emerald-600 dark:text-emerald-400"
                                          )}>
                                            Stock Proiettato: {entry.projectedBalance.toFixed(2)}
                                          </span>
                                        </div>

                                        {entry.details.length > 0 && (
                                          <div className="text-[9.5px] text-muted-foreground/80 leading-tight">
                                            {entry.details.filter(d => !d.startsWith(' [DBG:') && !d.startsWith('Fabbisogno:')).join(' • ')}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </AccordionContent>
                                </AccordionItem>
                              );
                            })}
                          </Accordion>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sezione Separata "Sotto Controllo" (Materiali coperte da PO nei tempi corretti) */}
                  {classifiedMRPAlarms.underControlCount > 0 && (
                    <div className="mt-8 pt-4 border-t border-dashed">
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="sotto-controllo-prog" className="border-indigo-200/60 dark:border-indigo-900/50 bg-indigo-50/20 dark:bg-indigo-950/20 rounded-lg px-2.5 border">
                          <AccordionTrigger className="hover:no-underline py-2.5">
                            <div className="flex items-center justify-between w-full pr-2 text-left">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                                  💜 Sotto Controllo (In Arrivo nei Tempi)
                                </span>
                                <Badge className="bg-indigo-500 text-white text-[10px] font-bold py-0 px-1.5">
                                  {classifiedMRPAlarms.underControlCount}
                                </Badge>
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                Coperte da ordini fornitore
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2 pb-4">
                            <p className="text-xs text-muted-foreground mb-3">
                              Questi materiali non costituiscono allarme: tutti i fabbisogni sono coperti da ordini fornitore con data di consegna allineata al piano di produzione.
                            </p>
                            <div className="space-y-4">
                              {classifiedMRPAlarms.groupedUnderControl.map(({ category, materials }) => (
                                <div key={category}>
                                  <div className="text-[11px] font-bold text-muted-foreground uppercase mb-1.5 tracking-wider">{category}</div>
                                  <div className="space-y-1.5">
                                    {materials.map(mat => (
                                      <div key={mat.matCode} className="p-2 rounded border border-indigo-100 dark:border-indigo-900/40 bg-card text-xs flex justify-between items-center">
                                        <div>
                                          <span className="font-bold text-indigo-900 dark:text-indigo-200 mr-2">{mat.matCode}</span>
                                          {mat.criticalDateFormatted ? (
                                            <span className="text-muted-foreground text-[11px] font-mono">
                                              In arrivo per il: <strong>{mat.criticalDateFormatted}</strong>
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground text-[11px]">{mat.materialName}</span>
                                          )}
                                        </div>
                                        <Badge className="bg-indigo-500 text-white text-[9px] py-0 px-1.5 font-bold">
                                          ORDINATO ({mat.entriesWithVisual.length})
                                        </Badge>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}

                  {/* FASE 44: Sezione Accordion "Allarmi Silenziati (Gestiti offline)" */}
                  {classifiedMRPAlarms.mutedCount > 0 && (
                    <div className="mt-6 pt-4 border-t border-dashed">
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="allarmi-silenziati-prog" className="border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/30 rounded-lg px-2.5 border">
                          <AccordionTrigger className="hover:no-underline py-2.5">
                            <div className="flex items-center justify-between w-full pr-2 text-left">
                              <div className="flex items-center gap-2">
                                <BellOff className="h-4 w-4 text-slate-500" />
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                  Allarmi Silenziati (Gestiti offline)
                                </span>
                                <Badge variant="secondary" className="text-[10px] font-bold py-0 px-1.5">
                                  {classifiedMRPAlarms.mutedCount}
                                </Badge>
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                Allarmi esclusi manualmente
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2 pb-4">
                            <p className="text-[11px] text-muted-foreground mb-3">
                              Questi fabbisogni sono stati silenziati specificamente per la singola commessa indicata (es. prelievo manuale già effettuato). Non incidono sul conteggio allarmi globale.
                            </p>
                            <div className="space-y-2">
                              {classifiedMRPAlarms.mutedAlarms.map((item, idx) => (
                                <div
                                  key={`${item.jobId}-${item.matCode}-${idx}`}
                                  className="p-2.5 rounded-md border border-slate-200 dark:border-slate-700/60 bg-card text-xs flex justify-between items-center gap-3"
                                >
                                  <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 font-mono">
                                      <span className="font-bold text-foreground truncate max-w-[150px]">
                                        {item.job?.ordinePF || item.jobId}
                                      </span>
                                      {item.job && (
                                        <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold">
                                          {getJobDepartmentGroup(item.job)}
                                        </Badge>
                                      )}
                                      <span className="text-muted-foreground text-[10px] truncate max-w-[120px]">
                                        {item.job?.cliente}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 font-mono text-[11px]">
                                      <span className="font-bold text-blue-600 dark:text-blue-400">
                                        {item.matCode}
                                      </span>
                                      {item.materialName && (
                                        <span className="text-muted-foreground text-[10px] truncate max-w-[180px]">
                                          {item.materialName}
                                        </span>
                                      )}
                                    </div>
                                    {item.jobDate && (
                                      <div className="text-[10px] text-muted-foreground">
                                        Data Cons: <strong className="text-foreground">{formatDateForDisplay(item.jobDate)}</strong>
                                        {item.requiredQty > 0 && (
                                          <span className="ml-2">Fabbisogno: {item.requiredQty.toFixed(2)}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleUnmuteMaterial(item.jobId, item.matCode)}
                                    className="h-7 text-xs gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 shrink-0"
                                  >
                                    <Bell className="h-3.5 w-3.5" />
                                    <span>Riattiva</span>
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
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

            {/* 2. Smart Paste Commesse (Import Excel da testo) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSmartPasteOpen(true)}
              className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Smart Paste</span>
            </Button>

            {/* 3. Importa Excel (File nativo .xlsx / .xls con validazione completa) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExcelImportOpen(true)}
              className="h-8 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Importa Excel</span>
            </Button>

            {/* 4. Nuova Commessa Manuale */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsManualCreateOpen(true)}
              className="h-8 text-xs gap-1.5"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>+ Manuale</span>
            </Button>

            {/* 5. Scarica Report Excel (Dropdown Settimane e Reparti) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExportingReport}
                  className="h-8 text-xs gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/30 shadow-xs"
                >
                  {isExportingReport ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  )}
                  <span>Scarica Report</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-blue-600 dark:text-blue-400 uppercase tracking-tighter font-black text-xs">
                  Scarica Report Excel
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* SETTIMANA CORRENTE */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer">
                    <Calendar className="mr-2 h-4 w-4 text-blue-500" />
                    <span>Settimana Corrente (W{reportCurrentIsoWeek})</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem
                        className="cursor-pointer font-bold focus:bg-blue-600 focus:text-white"
                        onClick={() => handleExportReport('current', 'ALL')}
                      >
                        TUTTI I REPARTI (Combinato)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-orange-600 focus:text-white"
                        onClick={() => handleExportReport('current', 'CP')}
                      >
                        CONNESSIONI PICCOLE (CP)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-emerald-600 focus:text-white"
                        onClick={() => handleExportReport('current', 'CG')}
                      >
                        CONNESSIONI GRANDI (CG)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-sky-600 focus:text-white"
                        onClick={() => handleExportReport('current', 'BF')}
                      >
                        REPARTO BARRE (BF)
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                {/* SETTIMANA PROSSIMA */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer">
                    <Calendar className="mr-2 h-4 w-4 text-indigo-400 opacity-80" />
                    <span>Settimana Prossima (W{reportNextIsoWeek})</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem
                        className="cursor-pointer font-bold focus:bg-blue-600 focus:text-white"
                        onClick={() => handleExportReport('next', 'ALL')}
                      >
                        TUTTI I REPARTI (Combinato)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-orange-600 focus:text-white"
                        onClick={() => handleExportReport('next', 'CP')}
                      >
                        CONNESSIONI PICCOLE (CP)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-emerald-600 focus:text-white"
                        onClick={() => handleExportReport('next', 'CG')}
                      >
                        CONNESSIONI GRANDI (CG)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer focus:bg-sky-600 focus:text-white"
                        onClick={() => handleExportReport('next', 'BF')}
                      >
                        REPARTO BARRE (BF)
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                {/* DUE SETTIMANE COMBINATE */}
                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase py-1 px-2 font-black tracking-widest">
                  Due Settimane Combinate
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="cursor-pointer font-bold focus:bg-blue-600 focus:text-white"
                  onClick={() => handleExportReport('both', 'ALL')}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-blue-500" />
                  TUTTI I REPARTI (Totale)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-orange-600 focus:text-white"
                  onClick={() => handleExportReport('both', 'CP')}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-orange-500" />
                  CONNESSIONI PICCOLE (CP)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-emerald-600 focus:text-white"
                  onClick={() => handleExportReport('both', 'CG')}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-500" />
                  CONNESSIONI GRANDI (CG)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-sky-600 focus:text-white"
                  onClick={() => handleExportReport('both', 'BF')}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-sky-500" />
                  REPARTO BARRE (BF)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Ricalcola MRP (FASE 37) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRecalculateMRP()}
              disabled={isRecalculatingMrp || isRefreshing}
              className="h-8 text-xs gap-1.5 px-3 border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/10 text-amber-500 dark:text-amber-400 font-semibold transition-all shadow-sm"
              title="Forza rilettura completa stock, ordini fornitore e ricalcola semafori MRP"
            >
              {isRecalculatingMrp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              ) : (
                <Calculator className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span>{isRecalculatingMrp ? 'Ricalcolo...' : 'Ricalcola MRP'}</span>
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
                className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-semibold tracking-wider transition-all whitespace-nowrap ${isActive
                    ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <span>{dept.label}</span>
                <span className={`text-[10px] px-1.5 py-0 rounded-full font-mono font-bold ${isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'
                  }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* =========================================================================
            1. MACRO-SWITCH DI VISUALIZZAZIONE: VISTA PER SETTIMANA vs VISTA GLOBALE
        ========================================================================== */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/40 p-1.5 rounded-lg border shadow-2xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode('settimana')}
              className={cn(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer",
                viewMode === 'settimana'
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-background/80 text-muted-foreground border-border hover:bg-background hover:text-foreground"
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Vista per Settimana</span>
              {!showAllWeeks && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0 rounded-full font-mono font-bold",
                  viewMode === 'settimana' ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  Sett. {selectedWeekNumber}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setViewMode('globale')}
              className={cn(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer",
                viewMode === 'globale'
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-background/80 text-muted-foreground border-border hover:bg-background hover:text-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Vista Globale</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0 rounded-full font-mono font-bold",
                viewMode === 'globale' ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {globalTabCounts.pianificate + globalTabCounts.avviate + (hasFetchedConcluse ? globalTabCounts.concluse : 0)}
              </span>
            </button>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-center gap-2 px-1">
            {viewMode === 'settimana' ? (
              <span>Visualizzazione a secchielli di carico settimanale con bilancio ore</span>
            ) : (
              <span>Panoramica complessiva aziendale per stato (Pianificate, Avviate, Concluse)</span>
            )}
          </div>
        </div>

        {/* =========================================================================
            2 & 3. VISTA GLOBALE (3 SUB-TAB SSoT + LAZY LOADING) vs VISTA PER SETTIMANA
        ========================================================================== */}
        {viewMode === 'globale' ? (
          <div className="space-y-2">
            {/* 3 Sotto-Tab SSoT: PIANIFICATE, AVVIATE, CONCLUSE + RICERCA */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-card border rounded-md px-3 py-1.5 shadow-2xs">
              <div className="flex items-center gap-2 flex-wrap">
                {/* TAB 1: PIANIFICATE */}
                <button
                  type="button"
                  onClick={() => handleSelectGlobalTab('PIANIFICATE')}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer",
                    globalTab === 'PIANIFICATE'
                      ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                      : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                  )}
                  title="Mostra solo le commesse con stato Pianificata"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>PIANIFICATE</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0 rounded-full font-mono font-bold",
                    globalTab === 'PIANIFICATE' ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {globalTabCounts.pianificate}
                  </span>
                </button>

                {/* TAB 2: AVVIATE (In Produzione + Completato Prod.) */}
                <button
                  type="button"
                  onClick={() => handleSelectGlobalTab('AVVIATE')}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer",
                    globalTab === 'AVVIATE'
                      ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                      : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                  )}
                  title="Mostra le commesse In Produzione e Completato Prod. (attive fisicamente in azienda)"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>AVVIATE</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0 rounded-full font-mono font-bold",
                    globalTab === 'AVVIATE' ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {globalTabCounts.avviate}
                  </span>
                </button>

                {/* TAB 3: CONCLUSE (Spedito / Chiuso) - Lazy Loading */}
                <button
                  type="button"
                  onClick={() => handleSelectGlobalTab('CONCLUSE')}
                  disabled={isLoadingConcluse}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer",
                    globalTab === 'CONCLUSE'
                      ? "bg-slate-700 text-white border-slate-700 shadow-xs"
                      : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                  )}
                  title="Mostra le commesse Spedite o concluse definitivamente (Lazy Loading da Firestore)"
                >
                  {isLoadingConcluse ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  ) : (
                    <Truck className="h-3.5 w-3.5" />
                  )}
                  <span>CONCLUSE</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0 rounded-full font-mono font-bold",
                    globalTab === 'CONCLUSE' ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {!hasFetchedConcluse ? (isLoadingConcluse ? 'Caricamento...' : 'Scarica') : globalTabCounts.concluse}
                  </span>
                </button>
              </div>

              {/* Ricerca Rapida e Filtro Stato */}
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Select value={statusFilter} onValueChange={(val: StatusFilterOption) => setStatusFilter(val)}>
                  <SelectTrigger className="h-7 text-xs w-[145px] shrink-0 bg-background" title="Filtra le commesse per stato">
                    <SelectValue placeholder="Filtra per Stato" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL" className="text-xs">Tutti gli stati</SelectItem>
                    <SelectItem value="Pianificata" className="text-xs text-blue-600 dark:text-blue-400 font-medium">Pianificata</SelectItem>
                    <SelectItem value="In Produzione" className="text-xs text-amber-600 dark:text-amber-400 font-medium">In Produzione</SelectItem>
                    <SelectItem value="Completato Prod." className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Completato Prod.</SelectItem>
                    <SelectItem value="Spedita" className="text-xs text-purple-600 dark:text-purple-400 font-medium">Spedita</SelectItem>
                  </SelectContent>
                </Select>

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
            </div>

            {/* Header Riassuntivo Vista Globale */}
            {globalTab === 'CONCLUSE' && !hasFetchedConcluse ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3.5 text-center flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                <div className="text-left space-y-0.5">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs">
                    <Truck className="h-4 w-4" />
                    <span>Storico Commesse Concluse (Lazy Loading Attivo)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Per ottimizzare le letture su Firestore, lo storico delle commesse completate e spedite viene scaricato solo su richiesta.
                  </p>
                </div>
                <Button
                  onClick={() => handleSelectGlobalTab('CONCLUSE')}
                  disabled={isLoadingConcluse}
                  size="sm"
                  className="gap-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold shrink-0 shadow-xs cursor-pointer"
                >
                  {isLoadingConcluse ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Scaricamento da Firestore...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      <span>Scarica Storico Concluse</span>
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="bg-card border rounded-md px-3 py-2 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Badge variant="outline" className={cn(
                    "text-xs px-2 py-0.5 font-bold",
                    globalTab === 'PIANIFICATE' ? "border-blue-500/40 text-blue-600 bg-blue-500/10" :
                      globalTab === 'AVVIATE' ? "border-amber-500/40 text-amber-600 bg-amber-500/10" :
                        "border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/10"
                  )}>
                    {globalTab === 'PIANIFICATE' && 'Commesse Pianificate'}
                    {globalTab === 'AVVIATE' && 'Commesse Avviate in Produzione'}
                    {globalTab === 'CONCLUSE' && 'Commesse Concluse / Spedite'}
                  </Badge>
                  <span className="text-xs text-muted-foreground hidden lg:inline">
                    {globalTab === 'PIANIFICATE' && 'Commesse confermate in attesa di emissione e stampa ODL.'}
                    {globalTab === 'AVVIATE' && 'Commesse attive fisicamente in azienda (In Lavorazione o Completate a bordo macchina).'}
                    {globalTab === 'CONCLUSE' && 'Commesse consegnate, spedite al cliente o archiviate a storico.'}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground text-[10px] uppercase font-sans font-semibold block leading-none">
                      Commesse
                    </span>
                    <span className="font-bold text-sm text-foreground mt-0.5 block">
                      {bucketMetrics.totalJobs}
                    </span>
                  </div>
                  <div className="border-l pl-4">
                    <span className="text-muted-foreground text-[10px] uppercase font-sans font-semibold block leading-none">
                      Pezzi Totali
                    </span>
                    <span className="font-bold text-sm text-foreground mt-0.5 block">
                      {bucketMetrics.totalPieces.toLocaleString('it-IT')}
                    </span>
                  </div>
                  <div className="border-l pl-4">
                    <span className="text-muted-foreground text-[10px] uppercase font-sans font-semibold block leading-none">
                      Ore Previste
                    </span>
                    <span className="font-bold text-sm text-foreground mt-0.5 block">
                      {bucketMetrics.loadedHours.toFixed(1)} h
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* WEEK SELECTOR + RICERCA RAPIDA */}
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
                    {!weekOptions.some((o) => o.value === `${selectedYear}-W${selectedWeekNumber}`) && (
                      <SelectItem value={`${selectedYear}-W${selectedWeekNumber}`} className="text-xs">
                        Sett. {selectedWeekNumber} / {selectedYear}
                      </SelectItem>
                    )}
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

              <div className="flex items-center gap-2 w-full md:w-auto">
                <Select value={statusFilter} onValueChange={(val: StatusFilterOption) => setStatusFilter(val)}>
                  <SelectTrigger className="h-7 text-xs w-[145px] shrink-0 bg-background" title="Filtra le commesse per stato">
                    <SelectValue placeholder="Filtra per Stato" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL" className="text-xs">Tutti gli stati</SelectItem>
                    <SelectItem value="Pianificata" className="text-xs text-blue-600 dark:text-blue-400 font-medium">Pianificata</SelectItem>
                    <SelectItem value="In Produzione" className="text-xs text-amber-600 dark:text-amber-400 font-medium">In Produzione</SelectItem>
                    <SelectItem value="Completato Prod." className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Completato Prod.</SelectItem>
                    <SelectItem value="Spedita" className="text-xs text-purple-600 dark:text-purple-400 font-medium">Spedita</SelectItem>
                  </SelectContent>
                </Select>

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
            </div>

            {/* KPI CAPACITÀ (BOX CON BORDO DINAMICO E VISIBILITÀ) */}
            <div className="bg-card border rounded-md px-3 py-2 shadow-2xs flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <CalendarCheck className="h-3.5 w-3.5 text-blue-500" />
                  Addetti:
                </span>

                {selectedDept === 'ALL' && (
                  <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/30 font-semibold px-1.5 py-0">
                    Aggregato Aziendale (CP + CG + BF)
                  </Badge>
                )}

                {/* Giorni L, M, M, G, V */}
                {(['L', 'M', 'Me', 'G', 'V'] as const).map((day) => (
                  <div
                    key={day}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded border",
                      selectedDept === 'ALL' ? "bg-muted/70 opacity-90 border-dashed" : "bg-muted/40"
                    )}
                    title={selectedDept === 'ALL' ? `Somma addetti ${day === 'Me' ? 'Mercoledì' : day} dei reparti produttivi CP + CG + BF (Read-Only, MAG escluso). Seleziona CP, CG, BF o MAG per modificare.` : undefined}
                  >
                    <span className="font-bold text-[10px] text-muted-foreground">{day === 'Me' ? 'M' : day}:</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={selectedDept === 'ALL'}
                      value={currentCapacity[day]}
                      onChange={(e) => handleCapacityChange(day, parseInt(e.target.value))}
                      className={cn(
                        "w-14 min-w-[3.5rem] h-6 text-center font-mono font-bold border rounded text-xs px-1 focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                        selectedDept === 'ALL'
                          ? "bg-muted text-muted-foreground cursor-not-allowed border-transparent"
                          : "bg-background focus:ring-1 focus:ring-primary"
                      )}
                    />
                  </div>
                ))}

                <div
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 rounded border ml-1",
                    selectedDept === 'ALL' ? "bg-muted/70 opacity-90 border-dashed" : "bg-muted/40"
                  )}
                  title={selectedDept === 'ALL' ? "Somma straordinari dei reparti produttivi CP + CG + BF (Read-Only, MAG escluso)." : undefined}
                >
                  <span className="font-bold text-[10px] text-muted-foreground">+ Straord:</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    disabled={selectedDept === 'ALL'}
                    value={currentCapacity.overtime}
                    onChange={(e) => handleCapacityChange('overtime', parseFloat(e.target.value))}
                    className={cn(
                      "w-14 min-w-[3.5rem] h-6 text-center font-mono font-bold border rounded text-xs px-1 focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                      selectedDept === 'ALL'
                        ? "bg-muted text-muted-foreground cursor-not-allowed border-transparent"
                        : "bg-background focus:ring-1 focus:ring-primary"
                    )}
                  />
                  <span className="text-[10px] text-muted-foreground font-mono">h</span>
                </div>

                {selectedDept !== 'ALL' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPropagatingCapacity}
                        onClick={() => void handlePropagateCapacityForward()}
                        className="h-7 px-2.5 text-[11px] font-semibold gap-1.5 border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/60 transition-colors shrink-0 cursor-pointer"
                      >
                        {isPropagatingCapacity ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ChevronsRight className="h-3.5 w-3.5" />
                        )}
                        <span>Applica alle settimane successive</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      Imposta questi addetti giornalieri come nuova baseline di reparto ({selectedDept}) dalla Settimana {selectedWeekNumber}/{selectedYear} in poi, preservando lo storico passato.
                    </TooltipContent>
                  </Tooltip>
                )}
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
          </div>
        )}

        {/* =========================================================================
            DATAGRID (STILE EXCEL): RIGA VUOTA RAPIDA + SEPARAZIONE COLONNE + INLINE EDIT
        ========================================================================== */}
        <div className="border rounded-md bg-card shadow-xs overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 border-b flex items-center justify-between text-xs text-muted-foreground font-medium">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {viewMode === 'settimana'
                  ? (showAllWeeks ? 'Tutte le Settimane' : `Commesse Nel Secchiello (Sett. ${selectedWeekNumber})`)
                  : `Vista Globale • ${globalTab}`}
              </span>
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
                  {/* 0. CHECKBOX (SELEZIONA TUTTO) */}
                  <th className="py-2 px-2 text-center w-[38px] bg-muted/80">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
                        aria-label="Seleziona tutte le commesse"
                        className="h-3.5 w-3.5 translate-y-[1px]"
                      />
                    </div>
                  </th>

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

                  {/* 6. ORE PREV. (Separata - FASE 69: Color-Coding Affidabilità Tempi) */}
                  <th
                    className="py-2 px-2 text-right w-[75px] select-none"
                    title="Ore Previste (Verde: Calcolo esatto da ciclo fasi | Azzurro: Stima manuale o parziale | Rosso: Mancante)"
                  >
                    Ore Prev.
                  </th>

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

                  {/* 11. STATO COMMESSA (FASE 71: Ordinamento Gerarchico) */}
                  <th
                    onClick={() => handleSort('statoCommessa')}
                    className="py-2 px-2 text-center w-[145px] bg-muted/80 cursor-pointer select-none hover:bg-muted/90 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Stato Commessa</span>
                      {sortField === 'statoCommessa' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
                      )}
                    </div>
                  </th>

                  {/* 11-bis. AVANZAMENTO FASI */}
                  <th className="py-2 px-2 text-center w-[115px] bg-muted/80">Avanzamento</th>

                  {/* 12. AZIONI */}
                  <th className="py-2 px-2 text-center w-[135px] bg-muted/80">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-normal">
                {/* =========================================================================
                    RIGHE COMMESSE EFFETTIVE
                ========================================================================== */}
                {sortedAndFilteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Layers className="h-7 w-7 text-muted-foreground/40" />
                        <p className="text-sm font-medium">
                          {viewMode === 'globale' && globalTab === 'CONCLUSE' && !hasFetchedConcluse
                            ? 'Lo storico delle commesse concluse non è ancora stato scaricato da Firestore.'
                            : viewMode === 'globale'
                              ? `Nessuna commessa trovata per la sezione ${globalTab}.`
                              : 'Nessuna commessa trovata nel secchiello corrente.'}
                        </p>
                        {viewMode === 'globale' && globalTab === 'CONCLUSE' && !hasFetchedConcluse ? (
                          <Button
                            onClick={() => handleSelectGlobalTab('CONCLUSE')}
                            disabled={isLoadingConcluse}
                            size="sm"
                            className="gap-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold mt-1 shadow-xs cursor-pointer"
                          >
                            {isLoadingConcluse ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            <span>Scarica Storico Concluse da Firestore</span>
                          </Button>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground max-w-sm">
                              Puoi inserire una nuova commessa compilando la riga in alto o reimpostando i filtri.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedDept('ALL');
                                if (viewMode === 'settimana') {
                                  setShowAllWeeks(true);
                                }
                                setSearchQuery('');
                                setStatusFilter('ALL');
                              }}
                              className="mt-1 text-xs h-7 cursor-pointer"
                            >
                              Azzera tutti i filtri
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedAndFilteredJobs.map((job) => {
                    const artKey = ((job as any).articolo || job.details || '').trim().toUpperCase();
                    return (
                      <JobTableRow
                        key={job.id}
                        job={job}
                        article={articleMap.get(artKey)}
                        isSelected={selectedJobIds.includes(job.id)}
                        isDownloadingPdf={isDownloadingPdf === job.id}
                        weekOptions={weekOptions}
                        getJobMRPStatus={getJobMRPStatus}
                        onToggleSelect={handleToggleSelect}
                        onSaveDeliveryDate={handleSaveDeliveryDate}
                        onSaveOdl={handleSaveOdl}
                        onAssignJobWeek={handleAssignJobWeek}
                        onStatusChange={handleStatusChange}
                        onTogglePrintODL={handleTogglePrintODL}
                        onStartProduction={handleStartProduction}
                        onRollbackJob={handleRollbackJob}
                        onOpenEditModal={handleOpenEditModal}
                        onOpenSplitModal={handleOpenSplitModal}
                        onDeleteJob={handleDeleteJob}
                        onOpenContoLavoroModal={handleOpenContoLavoroModal}
                        onOpenArticleQuickEdit={handleOpenArticleQuickEdit}
                        onOpenNoteModal={handleOpenNoteModal}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* =========================================================================
            FASE 16: BARRA DELLE AZIONI RAPIDE (FLOATING BULK ACTIONS BAR)
        ========================================================================== */}
        {selectedJobIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md text-white border border-slate-700/80 shadow-2xl rounded-2xl px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-200">
            <div className="flex items-center gap-2 pr-3 border-r border-slate-700">
              <Badge className="bg-primary hover:bg-primary text-white font-mono font-bold text-xs px-2 py-0.5">
                {selectedJobIds.length}
              </Badge>
              <span className="text-xs font-semibold text-slate-200 hidden sm:inline">
                {selectedJobIds.length === 1 ? 'selezionata' : 'selezionate'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedJobIds([])}
                className="text-[11px] text-slate-400 hover:text-white underline ml-1 cursor-pointer"
                title="Deseleziona tutte"
              >
                Annulla
              </button>
            </div>

            {/* 1. Stampa ODL (Solo Stampa) */}
            <Button
              size="sm"
              disabled={isBulkProcessing}
              onClick={handleBulkPrintODL}
              className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md cursor-pointer shrink-0"
              title="Genera e scarica i PDF ODL per le commesse selezionate (richiede N° ODL compilato)"
            >
              {isBulkProcessing && isBulkPrinting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              <span>Stampa ODL</span>
            </Button>

            {/* 2. Avvia Produzione (Solo Avvio Produzione) */}
            <Button
              size="sm"
              disabled={isBulkProcessing}
              onClick={handleBulkStartProduction}
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md cursor-pointer shrink-0"
              title="Avvia in produzione le commesse selezionate (richiede Data di Consegna e Ciclo di Lavorazione)"
            >
              {isBulkProcessing && !isBulkPrinting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>Avvia</span>
            </Button>

            {/* 2. Cambia Data Consegna */}
            <Popover open={isBulkDateOpen} onOpenChange={setIsBulkDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBulkProcessing}
                  className="h-8 gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-600 font-medium text-xs cursor-pointer shrink-0"
                  title="Applica la stessa data di consegna a tutte le commesse selezionate"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                  <span>Cambia Data Cons.</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3 bg-slate-900 border-slate-700 text-white shadow-xl" align="center" side="top">
                <div className="space-y-1">
                  <h4 className="font-bold text-xs text-white">Aggiorna Data Consegna Massiva</h4>
                  <p className="text-[11px] text-slate-400">
                    Imposta la stessa data su tutte le {selectedJobIds.length} commesse selezionate.
                  </p>
                </div>
                <div className="space-y-2">
                  <Input
                    type="text"
                    placeholder="GG/MM/AAAA"
                    value={bulkDateInput}
                    onChange={(e) => setBulkDateInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBulkChangeDeliveryDate()}
                    className="h-8 text-xs bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 font-mono"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsBulkDateOpen(false)}
                      className="h-7 text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                      Annulla
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleBulkChangeDeliveryDate}
                      disabled={isBulkProcessing || !bulkDateInput.trim()}
                      className="h-7 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      {isBulkProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Applica"}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* 3. Spedisci */}
            <Button
              size="sm"
              disabled={isBulkProcessing}
              onClick={handleBulkShip}
              className="h-8 gap-1.5 bg-purple-700 hover:bg-purple-600 text-white font-bold text-xs shadow-md cursor-pointer shrink-0"
              title="Contrassegna tutte le commesse selezionate come Spedite"
            >
              {isBulkProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Truck className="h-3.5 w-3.5" />
              )}
              <span>Spedisci</span>
            </Button>

            {/* 4. FASE 28: Elimina Selezionate (solo commesse Pianificate) */}
            <Button
              size="sm"
              variant="destructive"
              disabled={isBulkProcessing}
              onClick={handleBulkDelete}
              className="h-8 gap-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md cursor-pointer shrink-0"
              title="Elimina definitivamente le commesse selezionate in stato Pianificata"
            >
              {isBulkProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              <span>Elimina Selezionate</span>
            </Button>
          </div>
        )}

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

        {/* 2. SmartPasteModal (Import da Excel via testo) */}
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

        {/* 2.1. ExcelImportModal (Import da file Excel .xlsx/.xls con Analisi e Validazione SSoT) */}
        <ExcelImportModal
          isOpen={isExcelImportOpen}
          onClose={() => setIsExcelImportOpen(false)}
          departments={departments}
          onJobsCreated={(newJobs) => {
            setJobs((prev) => [...newJobs, ...prev]);
            toast({
              title: "Commesse Caricate da Excel",
              description: `${newJobs.length} commesse inserite con successo con stato Pianificata.`,
            });
          }}
        />

        {/* 3. Inserimento Manuale Multiplo Commesse (FASE 26: Stile Foglio di Calcolo) */}
        <ManualMultiAddModal
          isOpen={isManualCreateOpen}
          onClose={() => setIsManualCreateOpen(false)}
          articles={articles}
          departments={departments}
          defaultDepartment={selectedDept !== 'ALL' ? selectedDept : 'CP'}
          onJobsCreated={(newJobs) => {
            setJobs((prev) => {
              const existingIds = new Set(prev.map((j) => j.id));
              const uniqueNew = newJobs.filter((j) => !existingIds.has(j.id));
              return [...uniqueNew, ...prev];
            });

            // Se l'utente è nella vista settimanale, naviga alla data di consegna della nuova commessa
            if (viewMode === 'settimana' && newJobs.length > 0 && newJobs[0].dataConsegnaFinale) {
              const d = parseRobustDate(newJobs[0].dataConsegnaFinale);
              if (d) setCurrentDateReference(d);
            } else if (viewMode === 'globale') {
              setGlobalTab('PIANIFICATE');
            }

            // Ricalcolo immediato MRP per le nuove righe
            handleRecalculateMRP();

            toast({
              title: "Commesse Inserite",
              description: `${newJobs.length} commesse create con successo con stato Pianificata.`,
            });
          }}
        />

        {/* =========================================================================
            4. TEMPLATE PDF NASCOSTO PER STAMPA ODL (FASE 9 & FASE 96 BATCH RENDER)
        ========================================================================== */}
        {pdfData && pdfData.length > 0 && (
          <div id="odl-pdf-pages" style={{ position: 'fixed', top: '200%', left: 0, zIndex: -1, width: '297mm' }}>
            {pdfData.map((item, idx) => (
              <ODLPrintTemplate
                key={item.job.id || idx}
                job={item.job}
                article={item.article}
                materials={item.materials}
                printDate={item.printDate}
                config={odlConfig}
                qrRule={qrRule}
                globalSettings={globalSettingsRef.current || globalSettings}
                departments={departments}
                contoLavoroMap={item.contoLavoroMap}
                materialsByCode={item.materialsByCode}
                articlesByCode={item.articlesByCode}
                omitRootId={true}
              />
            ))}
          </div>
        )}

        {/* =========================================================================
            5. MODALE MODIFICA COMMESSA COMPLETA (FASE 17)
        ========================================================================== */}
        <EditStandardJobModal
          isOpen={isEditStandardModalOpen}
          onClose={() => {
            setIsEditStandardModalOpen(false);
            setJobToEdit(null);
          }}
          job={jobToEdit}
          workCycles={workCycles}
          departments={departments}
          articles={articles}
          onJobUpdated={handleJobUpdated}
        />

        {/* =========================================================================
            6. MODALE GESTIONE CONTO LAVORO (FASE 45)
        ========================================================================== */}
        <ContoLavoroModal
          isOpen={isContoLavoroModalOpen}
          onClose={() => {
            setIsContoLavoroModalOpen(false);
            setContoLavoroJob(null);
          }}
          job={contoLavoroJob}
          articles={articles}
          rawMaterials={Array.from(materialsCacheRef.current.values())}
          onSave={handleSaveContoLavoro}
        />

        {/* =========================================================================
            7. QUICK-EDIT ANAGRAFICA ARTICOLO DA DATAGRID (FASE 54 & FASE 90)
        ========================================================================== */}
        <QuickArticleEditDrawer
          key={quickEditArticleCode ? `quick-article-${quickEditArticleCode.trim().toUpperCase()}` : 'quick-article-closed'}
          isOpen={isQuickEditDrawerOpen}
          onClose={() => {
            setIsQuickEditDrawerOpen(false);
            setQuickEditArticleCode(null);
          }}
          articleCode={quickEditArticleCode}
          articles={articles}
          departments={departments}
          phaseTemplates={phaseTemplates}
          workCycles={workCycles}
          globalSettings={globalSettings}
          onArticleUpdated={handleArticleUpdated}
        />

        {/* =========================================================================
            8. MODALE SPLIT COMMESSA (FASE 83)
        ========================================================================== */}
        <SplitJobDialog
          isOpen={isSplitModalOpen}
          onClose={() => {
            setIsSplitModalOpen(false);
            setJobToSplit(null);
          }}
          job={jobToSplit}
          article={
            jobToSplit
              ? articleMap.get(((jobToSplit as any).articolo || jobToSplit.details || '').trim().toUpperCase())
              : undefined
          }
          existingOrdiniPF={jobs.map((j) => j.ordinePF).filter(Boolean)}
          onSplitSuccess={handleJobSplitSuccess}
        />

        {/* =========================================================================
            9. MODALE CONFERMA / SOVRASCRITTURA N° ODL IN AVVIO (FASE 84)
        ========================================================================== */}
        <ConfirmOdlDialog
          isOpen={isConfirmOdlModalOpen}
          onClose={() => {
            setIsConfirmOdlModalOpen(false);
            setJobToConfirmOdl(null);
          }}
          job={jobToConfirmOdl}
          initialProposedOdl={nextOdlPreview}
          onConfirmStart={async (targetJob, chosenOdl) => {
            return await executeStartProduction(targetJob, chosenOdl);
          }}
        />

        {/* =========================================================================
            10. MODALE NOTA RAPIDA COMMESSA DA TASTO DESTRO (FASE 93)
        ========================================================================== */}
        <EditJobNoteDialog
          isOpen={isNoteDialogOpen}
          onClose={() => {
            setIsNoteDialogOpen(false);
            setJobForNote(null);
          }}
          job={jobForNote}
          onSave={handleSaveJobNote}
        />
      </div>
    </TooltipProvider>
  );
}
