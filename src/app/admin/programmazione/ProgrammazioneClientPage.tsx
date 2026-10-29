"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
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
  Lock
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
import { useToast } from '@/hooks/use-toast';
import { parseRobustDate, cn } from '@/lib/utils';
import type { JobOrder, Department, RawMaterial, PurchaseOrder, Article, WorkCycle } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import { calculateMRPTimelines, type MRPTimelineEntry, classifyGlobalMRPAlarms } from '@/lib/mrp-utils';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { ODLConfig, DEFAULT_ODL_CONFIG } from '@/lib/odl-config';
import { SmartJobModal } from '@/components/mrp/SmartJobModal';
import { SmartPasteModal } from '@/components/mrp/SmartPasteModal';
import { ManualJobModal } from '@/components/mrp/ManualJobModal';
import { EditStandardJobModal } from '@/components/mrp/EditStandardJobModal';
import { 
  getJobOrders, 
  getActiveJobOrders,
  fetchCompletedJobOrdersAction,
  getTargetedMRPData, 
  toggleJobPrinted, 
  markJobAsPrinted,
  markJobAsPrintedAndInProduction,
  startJobProduction,
  updateJobExecutionStatus,
  updateJobOdlNumber, 
  updateJobStatus,
  updateJobDeliveryDate,
  updateJobAssignedWeek,
  saveQuickJobOrder,
  bulkUpdateJobDeliveryDate,
  bulkShipJobs,
  bulkStartProductionAndPrint,
  getCapacityBuckets,
  saveCapacityBucket,
  type DayCapacityConfigData
} from './actions';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getJobDisplayStatus, type JobDisplayStatus } from '@/lib/job-status';
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
  initialOdlConfig?: ODLConfig;
  initialCapacities?: Record<string, DayCapacityConfigData>;
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

export type JobStatusOption = JobDisplayStatus;

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

export function getJobWeekAndYear(job: JobOrder): { week: number; year: number } | null {
  const targetDateStr = job.assignedDate || job.dataConsegnaFinale;
  if (!targetDateStr) return null;
  const d = parseRobustDate(targetDateStr);
  if (!d) return null;
  return {
    week: getISOWeek(d),
    year: getISOWeekYear(d),
  };
}

/**
 * FASE 16: Roll-over (Time-shifting) per commesse attive in ritardo
 * Se la commessa è attiva (non completata/spedita) ed ha data antecedente alla settimana in corso,
 * viene forzata e visualizzata nel secchiello della Settimana Corrente.
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

type SortField = 'ordinePF' | 'cliente' | 'dataConsegna';

export function formatDateForDisplay(isoOrStr?: string): string {
  if (!isoOrStr) return '';
  const d = parseRobustDate(isoOrStr);
  if (!d) return isoOrStr;
  return format(d, 'dd/MM/yyyy');
}

export type JobMRPSummary = {
  state: 'RED' | 'LATE' | 'GREEN' | 'NO_BOM' | 'LOADING' | 'COMPLETED';
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
  onSaveOdl: (job: JobOrder, newOdl: string) => Promise<void> | void;
}

const InlineOdlCell = React.memo(function InlineOdlCell({
  job,
  onSaveOdl,
}: InlineOdlCellProps) {
  const originalVal = (job.numeroODLInterno || job.numeroODL || '').trim();
  const [localVal, setLocalVal] = useState<string>(originalVal);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    setLocalVal((job.numeroODLInterno || job.numeroODL || '').trim());
  }, [job.numeroODLInterno, job.numeroODL]);

  const handleCommit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const trimmed = localVal.trim();
      const currentOriginal = (job.numeroODLInterno || job.numeroODL || '').trim();
      if (trimmed === currentOriginal) return;
      await onSaveOdl(job, trimmed);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <input
      type="text"
      value={localVal}
      placeholder="Es. 185/PF"
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setLocalVal((job.numeroODLInterno || job.numeroODL || '').trim());
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-6 text-[11px] font-mono font-bold text-center px-1 py-0 w-full rounded border transition-colors",
        "hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary",
        !localVal 
          ? "border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground" 
          : "border-border bg-background text-foreground"
      )}
    />
  );
});

// =========================================================================
// MEMOIZATION RIGA TABELLA (React.memo)
// =========================================================================

interface JobTableRowProps {
  job: JobOrder;
  isSelected: boolean;
  isDownloadingPdf: boolean;
  weekOptions: { value: string; label: string; shortLabel: string; weekNumber?: number; year?: number; date?: Date }[];
  getJobMRPStatus: (job: JobOrder) => JobMRPSummary;
  onToggleSelect: (jobId: string, checked: boolean) => void;
  onSaveDeliveryDate: (job: JobOrder, isoFormatted: string, parsedDate?: Date) => Promise<void> | void;
  onSaveOdl: (job: JobOrder, newOdl: string) => Promise<void> | void;
  onAssignJobWeek: (job: JobOrder, newWeekVal: string) => void;
  onStatusChange: (job: JobOrder, newStatus: JobStatusOption) => void;
  onTogglePrintODL: (job: JobOrder) => void;
  onStartProduction: (job: JobOrder) => void;
  onRollbackJob: (job: JobOrder) => void;
  onOpenEditModal: (job: JobOrder) => void;
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
}: JobTableRowProps) {
  const hours = calculateJobHours(job);
  const weekInfo = getJobWeekAndYear(job);
  const currentJobWeekVal = weekInfo ? `${weekInfo.year}-W${weekInfo.week}` : 'Non ass.';
  const mrp = getJobMRPStatus(job);
  const deptGroup = getJobDepartmentGroup(job);
  const currentStatus = normalizeJobStatus(job);
  const isPrinted = Boolean((job as any).odlPrinted || job.isPrinted);
  const isDeliveryDateMissing = !job.dataConsegnaFinale || !job.dataConsegnaFinale.trim();
  const effectiveWeekInfo = getJobEffectiveWeek(job);

  return (
    <tr
      className={cn(
        "divide-x divide-border hover:bg-muted/30 transition-colors group",
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
        {deptGroup === 'OTHER' && (
          <span className="bg-slate-500/15 text-slate-700 dark:text-slate-400 border border-slate-500/30 font-bold font-mono text-[9px] px-1 py-0.5 rounded-xs truncate max-w-[45px] inline-block">
            {job.department || 'N/D'}
          </span>
        )}
      </td>

      {/* 2. ORDINE (Link a Console Produzione) */}
      <td className="py-1.5 px-2.5 align-middle">
        <Link
          href={`/admin/production-console?search=${encodeURIComponent(job.ordinePF || '')}`}
          className="font-mono font-bold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer tracking-tight transition-colors inline-block"
          title={`Apri console di produzione per commessa ${job.ordinePF}`}
          prefetch={false}
        >
          {job.ordinePF || 'N/A'}
        </Link>
      </td>

      {/* 3. CLIENTE */}
      <td className="py-1.5 px-2.5 align-middle">
        <span className="text-[11px] text-foreground font-medium truncate block max-w-[130px]" title={job.cliente}>
          {job.cliente || 'Non specificato'}
        </span>
      </td>

      {/* 4. ARTICOLO */}
      <td className="py-1.5 px-3 align-middle">
        <span className="font-semibold text-foreground truncate block max-w-[250px]" title={job.details}>
          {job.details || 'Articolo non indicato'}
        </span>
      </td>

      {/* 5. Q.TÀ */}
      <td className="py-1.5 px-2 text-right align-middle font-mono font-bold text-foreground">
        {(job.qta || 0).toLocaleString('it-IT')}
      </td>

      {/* 6. ORE PREV. */}
      <td className="py-1.5 px-2 text-right align-middle font-mono text-[11px] text-muted-foreground font-medium">
        {hours.toFixed(1)} h
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
            "h-6 text-[11px] font-semibold py-0 px-1.5 w-full justify-between rounded border cursor-pointer",
            isDeliveryDateMissing && currentStatus === 'Pianificata' && "border-dashed border-red-500/50 bg-red-50/10 text-red-600 dark:text-red-400",
            currentStatus === 'Pianificata' && !isDeliveryDateMissing && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
            currentStatus === 'In Produzione' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold",
            currentStatus === 'Completato Prod.' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-bold",
            currentStatus === 'Spedito' && "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
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

          {/* FASE 19: Pulsante di Azione Dinamico (Avvia Play / Ripristina Undo) */}
          {currentStatus === 'Pianificata' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onStartProduction(job)}
                    disabled={isDeliveryDateMissing}
                    className={cn(
                      "h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 cursor-pointer",
                      isDeliveryDateMissing && "opacity-30 cursor-not-allowed"
                    )}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isDeliveryDateMissing
                  ? "Inserire Data di Consegna per avviare"
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
  initialGlobalSettings = null,
  initialOdlConfig,
  initialCapacities = {},
}: ProgrammazioneClientPageProps) {
  const { toast } = useToast();

  // Dati Commesse
  const [jobs, setJobs] = useState<JobOrder[]>(initialJobs || []);
  const [departments] = useState<Department[]>(initialDepartments || []);
  const [articles, setArticles] = useState<Article[]>(initialArticles || []);
  const [workCycles] = useState<WorkCycle[]>(initialWorkCycles || []);
  const [globalSettings] = useState<GlobalSettings | null>(initialGlobalSettings);

  const [odlConfig] = useState<ODLConfig>(initialOdlConfig || DEFAULT_ODL_CONFIG);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<{
    job: JobOrder;
    article: Article | null;
    materials: RawMaterial[];
    printDate: Date;
  } | null>(null);

  const qrRule = globalSettings?.jobOrderQrCodeRule || (globalSettings as any)?.qrCodeRule || "{ordinePF}@{details}@{qta}";

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modali Inserimento
  const [isSmartJobOpen, setIsSmartJobOpen] = useState(false);
  const [isSmartPasteOpen, setIsSmartPasteOpen] = useState(false);
  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);

  // FASE 17: Modale di Modifica Completa (Edit Job)
  const [isEditStandardModalOpen, setIsEditStandardModalOpen] = useState(false);
  const [jobToEdit, setJobToEdit] = useState<JobOrder | null>(null);

  const handleOpenEditModal = useCallback((job: JobOrder) => {
    setJobToEdit(job);
    setIsEditStandardModalOpen(true);
  }, []);

  const handleJobUpdated = (updatedJob: JobOrder) => {
    const oldId = jobToEdit?.id;
    setJobs((prev) =>
      prev.map((j) => (j.id === oldId || j.id === updatedJob.id ? { ...j, ...updatedJob } : j))
    );
    setIsEditStandardModalOpen(false);
    setJobToEdit(null);
  };

  // FASE 16: Selezione Multipla (Checkbox) e Azioni Massive (Bulk Actions)
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isBulkDateOpen, setIsBulkDateOpen] = useState(false);
  const [bulkDateInput, setBulkDateInput] = useState('');

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

  // =========================================================================
  // FASE 14: LIVE DATA FEED ANAGRAFICA ARTICOLI (Real-Time Listener)
  // =========================================================================
  useEffect(() => {
    // Sincronizzazione in tempo reale con Firestore per recepire nuovi articoli all'istante
    const unsub = onSnapshot(
      collection(db, "articles"),
      (snapshot) => {
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
      },
      (error) => {
        console.error("Errore listener real-time anagrafica articoli:", error);
      }
    );

    return () => unsub();
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

  // Ordinamento Colonne
  const [sortField, setSortField] = useState<SortField | null>('ordinePF');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Capacità Giornaliera per Secchiello (con Persistenza Firestore)
  const [capacitiesByBucket, setCapacitiesByBucket] = useState<Record<string, DayCapacityConfig>>(initialCapacities || {});

  const selectedWeekNumber = useMemo(() => {
    return getISOWeek(currentDateReference);
  }, [currentDateReference]);

  const selectedYear = useMemo(() => {
    return getISOWeekYear(currentDateReference);
  }, [currentDateReference]);

  // Caricamento asincrono capacità al cambio settimana
  useEffect(() => {
    let isMounted = true;
    getCapacityBuckets(selectedYear, selectedWeekNumber).then((data) => {
      if (isMounted && data && Object.keys(data).length > 0) {
        setCapacitiesByBucket((prev) => ({ ...prev, ...data }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [selectedYear, selectedWeekNumber]);

  const bucketKey = useMemo(() => {
    return `${selectedDept}_${selectedYear}_W${selectedWeekNumber}`;
  }, [selectedDept, selectedYear, selectedWeekNumber]);

  // FASE 18: Aggregazione Capacità Aziendale per Tab "TUTTI" (Somma CP + CG + BF)
  const ACTIVE_PRODUCTION_DEPTS: MacroDepartmentCode[] = ['CP', 'CG', 'BF'];

  const aggregatedCapacity = useMemo(() => {
    const totals: DayCapacityConfig = { L: 0, M: 0, Me: 0, G: 0, V: 0, overtime: 0 };
    ACTIVE_PRODUCTION_DEPTS.forEach((dept) => {
      const key = `${dept}_${selectedYear}_W${selectedWeekNumber}`;
      const cap = capacitiesByBucket[key] || DEFAULT_CAPACITY;
      totals.L += cap.L || 0;
      totals.M += cap.M || 0;
      totals.Me += cap.Me || 0;
      totals.G += cap.G || 0;
      totals.V += cap.V || 0;
      totals.overtime += cap.overtime || 0;
    });
    return totals;
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

  // Refresh Commesse e Articoli (Lazy-Aware)
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [updatedJobs, freshArticlesSnap] = await Promise.all([
        hasFetchedConcluse ? getJobOrders() : getActiveJobOrders(),
        getDocs(collection(db, "articles")),
      ]);
      setJobs(updatedJobs);
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

  // Ordinamento Colonne
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
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

      // 3. Bivio: Vista per Settimana vs Vista Globale
      if (viewMode === 'settimana') {
        if (!showAllWeeks) {
          // FASE 16: Roll-over al presente per commesse attive in ritardo
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
  }, [jobs, selectedDept, viewMode, globalTab, showAllWeeks, selectedWeekNumber, selectedYear, searchQuery]);

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

  // Conteggi per macro-reparti (Sensibili alla vista corrente)
  const deptCounts = useMemo(() => {
    const counts: Record<MacroDepartmentCode, number> = { ALL: 0, CP: 0, CG: 0, BF: 0 };
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
    return jobs.filter((j) => !isJobFinished(j));
  }, [jobs]);

  // Fabbisogni materiali e articoli sull'intero backlog attivo aziendale (Short-circuit rigoroso)
  const { globalMaterialCodes, globalArticleCodes } = useMemo(() => {
    const matSet = new Set<string>();
    const artSet = new Set<string>();

    activeGlobalJobs.forEach((job) => {
      if (isJobFinished(job)) return;
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
  const getJobMRPStatus = useCallback((job: JobOrder): {
    state: 'RED' | 'LATE' | 'GREEN' | 'NO_BOM' | 'LOADING' | 'COMPLETED';
    label: string;
    badgeClass: string;
    dotClass: string;
    details: string[];
  } => {
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

    // MAPPATURA RIGOROSA DEGLI STATI MRP (HIERARCHY):
    // 1. MANCANTE (Red): Stock Proiettato < 0 E nessun PO a copertura. Azione: comprare.
    // 2. IN RITARDO (Orange): Stock Proiettato < 0 MA coperto da PO con data successiva. Azione: sollecitare fornitore.
    // 3. ORDINATO / IN ARRIVO (Indigo): Coperto da PO in arrivo entro la data consegna.
    // 4. PRONTO (Green): Coperto da stock fisico o prelevato.
    let hasRed = false;
    let hasLate = false;
    let hasOrderedInTime = false;

    const details: string[] = [
      ...withdrawnItems.map((i) => `✅ ${i.component} - Prelevato`),
      ...entries.map((e) => {
        if (!e.entry) return `📦 ${e.component}: Verifica disponibilità`;
        const matCode = (e.component || '').trim().toUpperCase();
        const pos = poCacheRef.current.get(matCode) || [];
        const hasAnyPO = pos.length > 0 || (e.entry.totalPO || 0) > 0;
        const isUncovered = e.entry.projectedBalance < -0.001;

        let statusText: string;
        if (isUncovered) {
          if (hasAnyPO || e.entry.status === 'LATE') {
            hasLate = true;
            statusText = '🟠 IN RITARDO (Coperto da ordine fornitore, consegna successiva)';
          } else {
            hasRed = true;
            statusText = '🔴 MANCANTE (Nessun ordine fornitore a copertura)';
          }
        } else if (e.entry.status === 'ORDERED' || e.entry.status === 'AMBER') {
          hasOrderedInTime = true;
          statusText = '💜 IN ARRIVO (Coperto da ordine fornitore in tempo)';
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
        state: 'LATE',
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
  }, [mrpTimelines, isMrpLoading]);

  // =========================================================================
  // =========================================================================
  // 1. INLINE EDITING: DATA CONSEGNA (GG/MM/AAAA) - SALVATAGGIO DIFFERITO
  // =========================================================================
  const handleSaveDeliveryDate = useCallback(async (job: JobOrder, isoFormatted: string, parsedDate?: Date) => {
    if (!isoFormatted) {
      // Data azzerata
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, dataConsegnaFinale: '', assignedDate: undefined } : j))
      );
      try {
        await updateJobDeliveryDate(job.id, '');
        toast({
          title: "Data Consegna Rimossa",
          description: `Commessa ${job.ordinePF}: data di consegna azzerata.`,
        });
      } catch (e: any) {
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

    // Aggiornamento Ottimistico
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? {
              ...j,
              dataConsegnaFinale: isoFormatted,
              assignedDate: undefined,
              isoWeek: newWeek,
              weekYear: newYear,
              targetWeek: newTargetWeek,
            }
          : j
      )
    );

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
        description: e?.message || "Impossibile salvare la nuova data.",
      });
    }
  }, [toast]);

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

  // Aggiornamento N° ODL (on blur / Enter differito)
  const handleSaveOdl = useCallback(async (job: JobOrder, draftVal: string) => {
    const currentVal = (job.numeroODLInterno || job.numeroODL || '').trim();
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
        description: e?.message || "Impossibile salvare il N° ODL.",
      });
    }
  }, [toast]);

  // Modifica Stato Commessa (4 stati SSoT rigorosi)
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

    // Aggiornamento ottimistico locale
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === job.id) {
          const updated: JobOrder = { ...j };
          if (newStatus === 'Pianificata') {
            updated.status = 'IN_PIANIFICAZIONE';
            updated.forcedCompletion = false;
            updated.packingListId = undefined;
            updated.overallStartTime = undefined as any;
            updated.overallEndTime = undefined as any;
            updated.odlCreationDate = undefined as any;
            updated.isProblemReported = false;
            if (updated.phases && updated.phases.length > 0) {
              updated.phases = updated.phases.map((p) => ({
                ...p,
                status: 'pending' as const,
                workPeriods: [],
                materialConsumptions: [],
                qualityResult: null,
                materialReady: p.isIndependent || p.type === 'preparation',
              }));
            }
          } else if (newStatus === 'In Produzione') {
            updated.status = 'DA_INIZIARE';
            updated.forcedCompletion = false;
            updated.packingListId = undefined;
          } else if (newStatus === 'Completato Prod.') {
            updated.status = 'completed';
            updated.forcedCompletion = true;
          } else if (newStatus === 'Spedito') {
            updated.status = 'SPEDITA';
            updated.forcedCompletion = true;
          }
          return updated;
        }
        return j;
      })
    );

    try {
      const res = await updateJobExecutionStatus(job.id, newStatus);
      if (!res.success) {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? prevJob : j)));
        toast({
          variant: "destructive",
          title: "Operazione Non Riuscita",
          description: res.message,
        });
        return;
      }

      toast({
        title: newStatus === 'Pianificata' ? "Commessa Ripristinata" : "Stato Commessa Modificato",
        description: res.message,
      });

      if (res.odlNumber) {
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, numeroODLInterno: res.odlNumber } : j))
        );
      }
    } catch (e: any) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? prevJob : j)));
      toast({
        variant: "destructive",
        title: "Errore Aggiornamento Stato",
        description: e?.message || "Impossibile aggiornare lo stato.",
      });
    }
  }, [toast]);

  // FASE 19: Handler dedicato per Rollback rapido da pulsante Undo/RotateCcw
  const handleRollbackJob = useCallback(async (job: JobOrder) => {
    const confirmReset = window.confirm(
      `Vuoi davvero annullare l'avvio e riportare la commessa ${job.ordinePF || job.id} in 'Pianificata'?\n\nLe fasi torneranno in attesa e i timer di produzione verranno azzerati.`
    );
    if (!confirmReset) return;
    await handleStatusChange(job, 'Pianificata', true);
  }, [handleStatusChange]);

  // 4. Workflow Avvio Produzione: richiama createODL transazionale
  const handleStartProduction = useCallback(async (job: JobOrder) => {
    // FASE 16: Guardrail Data Consegna Obbligatoria
    if (!job.dataConsegnaFinale || !job.dataConsegnaFinale.trim()) {
      toast({
        variant: "destructive",
        title: "Data di Consegna Mancante",
        description: "Inserire Data di Consegna per avviare.",
      });
      return;
    }

    try {
      const res = await startJobProduction(job.id);
      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Impossibile Avviare Commessa",
          description: res.message,
        });
        return;
      }

      toast({
        title: "Commessa Avviata in Produzione",
        description: res.message,
      });

      setJobs((prev) =>
        prev.map((j) => {
          if (j.id === job.id) {
            return {
              ...j,
              status: 'DA_INIZIARE',
              numeroODLInterno: res.job?.numeroODLInterno || j.numeroODLInterno,
              odlCreationDate: res.job?.odlCreationDate || new Date().toISOString(),
            };
          }
          return j;
        })
      );
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore durante l'avvio",
        description: e?.message || "Errore sconosciuto",
      });
    }
  }, [toast]);

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

  // 1. Bulk Start Production and Print ODL
  const handleBulkStartAndPrint = async () => {
    if (selectedJobIds.length === 0) return;

    const selectedJobs = jobs.filter((j) => selectedJobIds.includes(j.id));
    const jobsWithDate = selectedJobs.filter((j) => j.dataConsegnaFinale && j.dataConsegnaFinale.trim().length > 0);
    const jobsWithoutDate = selectedJobs.filter((j) => !j.dataConsegnaFinale || !j.dataConsegnaFinale.trim());

    if (jobsWithDate.length === 0) {
      toast({
        variant: "destructive",
        title: "Impossibile Avviare",
        description: "Tutte le commesse selezionate sono prive di Data di Consegna. Inserire le date per avviare.",
      });
      return;
    }

    setIsBulkProcessing(true);
    try {
      const res = await bulkStartProductionAndPrint(jobsWithDate.map((j) => j.id));
      if (!res.success) {
        toast({
          variant: "destructive",
          title: "Errore Avvio Massivo",
          description: res.message,
        });
        return;
      }

      const startedIdsSet = new Set(res.startedJobs.map((s) => s.id));
      const startedMap = new Map(res.startedJobs.map((s) => [s.id, s]));

      setJobs((prev) =>
        prev.map((j) => {
          if (startedIdsSet.has(j.id)) {
            const startedInfo = startedMap.get(j.id);
            return {
              ...j,
              status: 'DA_INIZIARE',
              isPrinted: true,
              odlPrinted: true,
              numeroODLInterno: startedInfo?.numeroODLInterno || j.numeroODLInterno,
            };
          }
          return j;
        })
      );

      // Deseleziona le commesse avviate con successo
      setSelectedJobIds((prev) => prev.filter((id) => !startedIdsSet.has(id)));

      toast({
        title: "Avvio e Stampa Massiva Completati",
        description: res.message,
      });

      if (jobsWithoutDate.length > 0) {
        toast({
          variant: "destructive",
          title: "Commesse Escluse",
          description: `${jobsWithoutDate.length} commesse escluse perché prive di Data di Consegna: ${jobsWithoutDate.map(j => j.ordinePF || j.id).join(', ')}.`,
        });
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Errore Operazione Massiva",
        description: e?.message || "Impossibile completare l'avvio massivo.",
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

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

    // Risolvi il N° ODL dal valore salvato della commessa
    const currentOdl = (job.numeroODLInterno || job.numeroODL || '').trim();

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

      // 1. Recupero Articolo e arricchimento dati per il PDF
      const articleCode = (job.details || '').trim().toUpperCase();
      let article = articles.find((a) => a.code.toUpperCase() === articleCode) 
        || articlesCacheRef.current.get(articleCode) 
        || null;

      // Se non abbiamo ancora l'articolo completo in cache, tentiamo di caricarlo
      if (!article && articleCode) {
        try {
          const targeted = await getTargetedMRPData([], [articleCode]);
          if (targeted.articles.length > 0) {
            article = targeted.articles[0];
            articlesCacheRef.current.set(articleCode, article);
          }
        } catch (e) {
          console.warn("Impossibile caricare articolo per ODL:", e);
        }
      }

      // Costruisci la distinta base completa (BOM) se assente sulla commessa
      let bomItems = job.billOfMaterials || [];
      if ((!bomItems || bomItems.length === 0) && article?.billOfMaterials) {
        bomItems = article.billOfMaterials.map((item) => ({
          ...item,
          status: 'pending',
          isFromTemplate: true,
        }));
      }

      // Costruisci le fasi del ciclo se assenti sulla commessa
      let jobPhases = job.phases || [];
      if ((!jobPhases || jobPhases.length === 0) && (job.workCycleId || article?.workCycleId)) {
        const cycleId = job.workCycleId || article?.workCycleId;
        const cycle = workCycles.find((c) => c.id === cycleId);
        if (cycle && (cycle as any).phases) {
          jobPhases = (cycle as any).phases;
        }
      }

      // Verifica che tutti i materiali della distinta siano in materialsCacheRef
      const requiredMatCodes = bomItems
        .map((i) => (i.component || '').trim().toUpperCase())
        .filter(Boolean);
      const missingMatCodes = requiredMatCodes.filter((c) => !materialsCacheRef.current.has(c));

      if (missingMatCodes.length > 0) {
        try {
          const targeted = await getTargetedMRPData(missingMatCodes, articleCode ? [articleCode] : []);
          targeted.rawMaterials.forEach((m) => {
            if (m.code) materialsCacheRef.current.set(m.code.trim().toUpperCase(), m);
          });
        } catch (e) {
          console.warn("Impossibile scaricare anagrafica materiali mancanti per ODL:", e);
        }
      }

      const enrichedJob: JobOrder = {
        ...job,
        numeroODL: currentOdl,
        numeroODLInterno: currentOdl,
        billOfMaterials: bomItems,
        phases: jobPhases,
      };

      const materialsList = Array.from(materialsCacheRef.current.values());

      // =========================================================================
      // PASSO 1 (Azione Fisica): Monta il template e forza download PDF
      // =========================================================================
      setPdfData({
        job: enrichedJob,
        article,
        materials: materialsList,
        printDate: new Date(),
      });

      // Attesa rendering del template nascosto nel DOM (esattamente come in Gestione Dati Commesse)
      await new Promise((r) => setTimeout(r, 800));

      const container = document.getElementById('odl-pdf-pages');
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
  }, [articles, workCycles, toast, isDownloadingPdf]);

  // Settimane per il dropdown rapido (Standard ISO 8601)
  const weekOptions = useMemo(() => {
    const now = new Date();
    const currentMonday = startOfISOWeek(now);
    currentMonday.setHours(12, 0, 0, 0);

    const currentIsoWeek = getISOWeek(now);
    const currentIsoYear = getISOWeekYear(now);

    const options: { 
      value: string; 
      weekNumber: number; 
      year: number; 
      label: string; 
      shortLabel: string; 
      date: Date 
    }[] = [];

    for (let i = -4; i <= 12; i++) {
      const refDate = addWeeks(currentMonday, i);
      const w = getISOWeek(refDate);
      const y = getISOWeekYear(refDate);
      const start = startOfISOWeek(refDate);
      const end = endOfISOWeek(refDate);
      const isCurrent = w === currentIsoWeek && y === currentIsoYear;

      const startDay = format(start, 'dd');
      const startMonth = format(start, 'MMM', { locale: it }).slice(0, 3);
      const endDay = format(end, 'dd');
      const endMonth = format(end, 'MMM', { locale: it }).slice(0, 3);

      const capitalizedStartMonth = startMonth.charAt(0).toUpperCase() + startMonth.slice(1);
      const capitalizedEndMonth = endMonth.charAt(0).toUpperCase() + endMonth.slice(1);

      const rangeLabel = `${startDay} ${capitalizedStartMonth} - ${endDay} ${capitalizedEndMonth}`;

      options.push({
        value: `${y}-W${w}`,
        weekNumber: w,
        year: y,
        label: `Sett. ${w} ${isCurrent ? '(Corrente)' : ''} • ${rangeLabel}`,
        shortLabel: `Sett. ${w} (${rangeLabel})`,
        date: refDate,
      });
    }
    return options;
  }, []);

  // Riassegnazione manuale settimana per una commessa
  const handleAssignJobWeek = useCallback(async (job: JobOrder, newWeekVal: string) => {
    if (newWeekVal === 'Non ass.') {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, targetWeek: null, assignedDate: undefined, isoWeek: null, weekYear: null }
            : j
        )
      );
      toast({
        title: "Settimana Rimossa",
        description: `Commessa ${job.ordinePF} non assegnata a nessun secchiello.`,
      });
      await updateJobAssignedWeek(job.id, null, null, null, null);
      return;
    }

    const opt = weekOptions.find((o) => o.value === newWeekVal || `W${o.weekNumber}` === newWeekVal);
    if (!opt) return;

    // Lunedì della settimana alle 12:00
    const mondayIso = format(startOfISOWeek(opt.date), 'yyyy-MM-dd');
    const targetWeekStr = `${opt.year}-W${String(opt.weekNumber).padStart(2, '0')}`;

    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? {
              ...j,
              assignedDate: mondayIso,
              isoWeek: opt.weekNumber,
              weekYear: opt.year,
              targetWeek: targetWeekStr,
            }
          : j
      )
    );

    toast({
      title: "Spostamento Commessa",
      description: `Commessa ${job.ordinePF} riassegnata a Sett. ${opt.weekNumber} (${opt.shortLabel}).`,
    });

    try {
      await updateJobAssignedWeek(
        job.id, 
        mondayIso, 
        opt.weekNumber, 
        opt.year, 
        targetWeekStr
      );
    } catch (e) {
      console.error("Errore salvataggio riassegnazione settimana:", e);
    }
  }, [weekOptions, toast]);

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
                                    : "border-amber-400 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20"
                                )}
                              >
                                {worstCategoryStatus === 'RED' ? '🔴 MANCANTI' : '🟠 IN RITARDO'}
                              </Badge>
                            </div>
                            <div className="h-px bg-border flex-1"></div>
                          </div>

                          {/* Accordion Materiali della Categoria */}
                          <Accordion type="single" collapsible className="w-full space-y-2">
                            {materials.map((mat) => {
                              const worstLabel = mat.worstStatus === 'RED' ? 'MANCANTE' : 'IN RITARDO';
                              const worstBadgeClass = mat.worstStatus === 'RED' 
                                ? 'bg-red-600 text-white' 
                                : 'bg-amber-500 text-white';

                              return (
                                <AccordionItem key={mat.matCode} value={mat.matCode} className="border rounded-md px-2">
                                  <AccordionTrigger className="hover:no-underline py-2">
                                    <div className="flex items-center justify-between w-full pr-3 text-left">
                                      <div className="flex flex-col items-start">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono font-bold text-xs">{mat.matCode}</span>
                                          <Badge className={`text-[9px] py-0 px-1.5 font-bold ${worstBadgeClass}`}>
                                            {worstLabel}
                                          </Badge>
                                        </div>
                                        {mat.materialName && (
                                          <span className="text-[10px] text-muted-foreground font-normal truncate max-w-[240px]">
                                            {mat.materialName}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] font-mono flex items-center gap-1.5">
                                        {mat.countRed > 0 && (
                                          <span className="text-red-500 font-bold">{mat.countRed} mancanti</span>
                                        )}
                                        {mat.countLate > 0 && (
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
                                          visualStatus === 'RED'
                                            ? "border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/20"
                                            : visualStatus === 'LATE'
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
                                              visualStatus === 'RED' ? "text-red-700 dark:text-red-300" :
                                              visualStatus === 'LATE' ? "text-amber-700 dark:text-amber-300" :
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
                                          <span className={cn(
                                            "font-bold uppercase text-[9px] px-1.5 py-0.2 rounded-xs",
                                            visualStatus === 'RED'
                                              ? "bg-red-500/20 text-red-700 dark:text-red-300"
                                              : visualStatus === 'LATE'
                                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                                : visualStatus === 'ORDERED'
                                                  ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400"
                                                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                          )}>
                                            {visualStatus === 'RED' 
                                              ? '🔴 Mancante' 
                                              : visualStatus === 'LATE' 
                                                ? '🟠 In Ritardo' 
                                                : visualStatus === 'ORDERED' 
                                                  ? '💜 Ordinato' 
                                                  : '🟢 Coperto'
                                            }
                                          </span>
                                        </div>

                                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40 font-mono">
                                          <span className="text-muted-foreground text-[10.5px]">
                                            Fabbisogno: <strong className="text-foreground">{entry.requiredQty.toFixed(2)}</strong>
                                          </span>
                                          <span className={cn(
                                            "font-bold text-[11px]",
                                            visualStatus === 'RED'
                                              ? "text-red-600 dark:text-red-400"
                                              : visualStatus === 'LATE'
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
                                          <span className="text-muted-foreground text-[11px]">{mat.materialName}</span>
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

              {/* Ricerca Rapida */}
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
                    title={selectedDept === 'ALL' ? `Somma addetti ${day === 'Me' ? 'Mercoledì' : day} di tutti i reparti (Read-Only). Seleziona CP, CG o BF per modificare.` : undefined}
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
                  title={selectedDept === 'ALL' ? "Somma straordinari di tutti i reparti (Read-Only). Seleziona CP, CG o BF per modificare." : undefined}
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
                  <th className="py-2 px-2 text-center w-[115px] bg-muted/80">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-normal">
                {/* =========================================================================
                    2. RIGA VUOTA RAPIDA PERMANENTEMENTE VISIBILE IN CIMA ALLA DATAGRID
                ========================================================================== */}
                <tr className="divide-x divide-border bg-blue-500/5 hover:bg-blue-500/10 transition-colors border-b-2 border-primary/30">
                  {/* Cella Checkbox per Riga Rapida */}
                  <td className="py-1 px-1 text-center align-middle font-mono text-[10px] text-muted-foreground/40">
                    +
                  </td>

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
                    {viewMode === 'settimana' ? `W${selectedWeekNumber}` : 'Auto'}
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
                    <td colSpan={13} className="py-12 text-center text-muted-foreground">
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
                  sortedAndFilteredJobs.map((job) => (
                    <JobTableRow
                      key={job.id}
                      job={job}
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
                    />
                  ))
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

            {/* 1. Stampa ODL / Avvia Produzione */}
            <Button
              size="sm"
              disabled={isBulkProcessing}
              onClick={handleBulkStartAndPrint}
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md cursor-pointer shrink-0"
              title="Avvia in produzione e segna come stampate le commesse selezionate (esclude quelle prive di data)"
            >
              {isBulkProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <Printer className="h-3.5 w-3.5" />
                </>
              )}
              <span>Stampa ODL / Avvia</span>
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

        {/* =========================================================================
            4. TEMPLATE PDF NASCOSTO PER STAMPA ODL (FASE 9)
        ========================================================================== */}
        {pdfData && (
          <div style={{ position: 'fixed', top: '200%', left: 0, zIndex: -1 }}>
            <ODLPrintTemplate
              job={pdfData.job}
              article={pdfData.article}
              materials={pdfData.materials}
              printDate={pdfData.printDate}
              config={odlConfig}
              qrRule={qrRule}
              globalSettings={globalSettingsRef.current || globalSettings}
              departments={departments}
            />
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
      </div>
    </TooltipProvider>
  );
}
