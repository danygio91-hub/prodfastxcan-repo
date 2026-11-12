"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Check,
  X,
  RotateCcw,
  Search,
  RefreshCw,
  Loader2,
  ClipboardCheck,
  AlertTriangle,
  Ghost,
  ShieldCheck,
  CheckCheck,
  Trash2,
  Package,
  Calendar,
  PlusCircle,
  Lock,
  FolderOpen,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { cn, formatDisplayStock } from '@/lib/utils';
import {
  VIRTUAL_SESSION_2025_ID,
  evaluateLotsForInventorySession,
} from '@/lib/inventory-ledger-logic';
import type { InventoryCountingSession } from '@/types';
import {
  approveLedgerInventoryRecord,
  approveMultipleLedgerInventoryRecords,
  closeInventoryCountingSession,
  deleteInventoryCountingSession,
  getInventoryLedgerData,
  openInventoryCountingSession,
  rejectLedgerInventoryRecord,
  revertLedgerInventoryRecord,
  writeOffUnscannedLots,
  type EnrichedLedgerInventoryRecord,
  type InventoryLedgerPageData,
  type LedgerLotCheckoffItem,
} from './actions';

interface InventoryLedgerClientPageProps {
  initialData: InventoryLedgerPageData;
}

function formatSafeDate(val: unknown): string {
  if (!val) return '---';
  try {
    const d = val instanceof Date ? val : new Date(val as string | number);
    if (Number.isNaN(d.getTime())) return '---';
    return format(d, 'dd/MM/yyyy HH:mm', { locale: it });
  } catch {
    return '---';
  }
}

function formatLotLoadDateShort(isoDate?: string, year?: number): string {
  if (isoDate) {
    try {
      const d = new Date(isoDate);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1975) {
        // Check if it was a synthetic Jan 1 fallback from inferred year
        if (
          isoDate.endsWith('-01-01T00:00:00.000Z') &&
          year &&
          d.getUTCFullYear() === year
        ) {
          return `Anno ${year}`;
        }
        return format(d, 'dd/MM/yyyy', { locale: it });
      }
    } catch {
      // Fallback below
    }
  }
  if (year) return `Anno ${year}`;
  return '---';
}

export default function InventoryLedgerClientPage({
  initialData,
}: InventoryLedgerClientPageProps) {
  const { user, operator } = useAuth();
  const { toast } = useToast();

  const [data, setData] = useState<InventoryLedgerPageData>(initialData);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    initialData?.defaultSessionId || VIRTUAL_SESSION_2025_ID
  );
  const [includePreviousPending, setIncludePreviousPending] = useState<boolean>(false);
  const [ghostSubFilter, setGhostSubFilter] = useState<
    'all' | 'pre_existing' | 'post_opened'
  >('all');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  // Dialog state for "+ Apri Nuova Sessione Inventario"
  const [isOpenSessionModalOpen, setIsOpenSessionModalOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState(
    `Inventario ${new Date().getFullYear()} - Sessione 1`
  );
  const [newSessionYear, setNewSessionYear] = useState<number>(new Date().getFullYear());
  const [newSessionNotes, setNewSessionNotes] = useState('');

  // Selections for Tab 2 (Pending Records) and Tab 3 (Unscanned Lots)
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [selectedUnscannedKeys, setSelectedUnscannedKeys] = useState<string[]>([]);

  // Confirmation modal for write-off of unscanned lots
  const [lotsPendingWriteOff, setLotsPendingWriteOff] = useState<
    Array<{ materialId: string; materialCode: string; lotto: string; theoreticalUnits: number; uom: string }>
  >([]);

  const adminUid = user?.uid || operator?.id || '';

  const sessionsList = useMemo<InventoryCountingSession[]>(() => {
    const raw = Array.isArray(data?.sessions) ? data.sessions : [];
    if (raw.length > 0) return raw;
    return [
      {
        id: VIRTUAL_SESSION_2025_ID,
        name: 'Storico Inventario 2025',
        year: 2025,
        status: 'closed',
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-12-31T23:59:59.999Z',
        isVirtual: true,
        recordCount: 0,
      },
    ];
  }, [data?.sessions]);

  const selectedSession = useMemo<InventoryCountingSession>(() => {
    return (
      sessionsList.find((s) => s.id === selectedSessionId) ||
      sessionsList.find((s) => s.id === data?.defaultSessionId) ||
      sessionsList[0]
    );
  }, [sessionsList, selectedSessionId, data?.defaultSessionId]);

  const hasOpenRealSession = useMemo(
    () => sessionsList.some((s) => !s.isVirtual && s.status === 'open'),
    [sessionsList]
  );

  // Dynamic evaluation of lots & records for the currently selected session
  const sessionEvaluated = useMemo(() => {
    const baseLots = Array.isArray(data?.baseLots) ? data.baseLots : [];
    const records = Array.isArray(data?.records) ? data.records : [];
    return evaluateLotsForInventorySession({
      baseLots,
      records,
      session: selectedSession,
      includePreviousPending,
    });
  }, [data?.baseLots, data?.records, selectedSession, includePreviousPending]);

  const refreshData = useCallback(
    async (preferredSessionId?: string) => {
      setIsRefreshing(true);
      try {
        const fresh = await getInventoryLedgerData();
        setData(fresh);
        if (preferredSessionId) {
          setSelectedSessionId(preferredSessionId);
        } else if (
          !fresh.sessions.some((s) => s.id === selectedSessionId) &&
          fresh.defaultSessionId
        ) {
          setSelectedSessionId(fresh.defaultSessionId);
        }
        setSelectedRecordIds([]);
        setSelectedUnscannedKeys([]);
      } catch {
        toast({
          variant: 'destructive',
          title: 'Errore Aggiornamento',
          description: 'Impossibile ricaricare i dati del Registro Inventario SSoT.',
        });
      } finally {
        setIsRefreshing(false);
      }
    },
    [toast, selectedSessionId]
  );

  useEffect(() => {
    const handler = () => refreshData();
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [refreshData]);

  const normQuery = searchTerm.trim().toLowerCase();

  // Filtered items for Tab 1: Tutti i Lotti Attivi (Stato Spunta per la sessione selezionata)
  const filteredActiveLots = useMemo<LedgerLotCheckoffItem[]>(() => {
    const list = sessionEvaluated.allActiveLots;
    if (!normQuery) return list;
    return list.filter(
      (item) =>
        String(item.materialCode ?? '').toLowerCase().includes(normQuery) ||
        String(item.materialDescription ?? '').toLowerCase().includes(normQuery) ||
        String(item.lotto ?? '').toLowerCase().includes(normQuery)
    );
  }, [sessionEvaluated.allActiveLots, normQuery]);

  // Filtered items for Tab 2: Rilevazioni Operatori della sessione selezionata (Confronto Delta)
  const filteredRecords = useMemo(() => {
    const list = sessionEvaluated.recordsForTab2;
    return list.filter((rec) => {
      if (statusFilter !== 'all' && rec.status !== statusFilter) return false;
      if (!normQuery) return true;
      return (
        String(rec.materialCode ?? '').toLowerCase().includes(normQuery) ||
        String(rec.materialDescription ?? '').toLowerCase().includes(normQuery) ||
        String(rec.lotto ?? '').toLowerCase().includes(normQuery) ||
        String(rec.operatorName ?? '').toLowerCase().includes(normQuery)
      );
    });
  }, [sessionEvaluated.recordsForTab2, statusFilter, normQuery]);

  const pendingRecordsInView = useMemo(
    () => filteredRecords.filter((r) => r.status === 'pending'),
    [filteredRecords]
  );

  // Filtered items for Tab 3: Lotti Non Battuti (Caccia ai Fantasmi nella sessione selezionata)
  const filteredUnscannedLots = useMemo<LedgerLotCheckoffItem[]>(() => {
    let list = sessionEvaluated.unscannedLots;
    if (ghostSubFilter === 'pre_existing') {
      list = list.filter((item) => item.lotTemporalStatus === 'PRE_EXISTING');
    } else if (ghostSubFilter === 'post_opened') {
      list = list.filter((item) => item.lotTemporalStatus === 'POST_SESSION_OPENED');
    }
    if (!normQuery) return list;
    return list.filter(
      (item) =>
        String(item.materialCode ?? '').toLowerCase().includes(normQuery) ||
        String(item.materialDescription ?? '').toLowerCase().includes(normQuery) ||
        String(item.lotto ?? '').toLowerCase().includes(normQuery)
    );
  }, [sessionEvaluated.unscannedLots, ghostSubFilter, normQuery]);

  // Summary KPIs for the currently selected session
  const kpiStats = useMemo(() => {
    const activeLots = sessionEvaluated.allActiveLots;
    const unscanned = sessionEvaluated.unscannedLots;
    const records = sessionEvaluated.recordsForTab2;
    const totalLots = activeLots.length;
    const scannedCount = activeLots.filter(
      (l) => l.scanStatus === 'SCANNED_APPROVED' || l.scanStatus === 'SCANNED_PENDING'
    ).length;
    const postInventoryCount = activeLots.filter(
      (l) => l.scanStatus === 'POST_INVENTORY'
    ).length;
    const unscannedCount = unscanned.length;
    const pendingApprovals = records.filter((r) => r.status === 'pending').length;
    return {
      totalLots,
      scannedCount,
      postInventoryCount,
      unscannedCount,
      pendingApprovals,
    };
  }, [sessionEvaluated]);

  const handleOpenNewSession = async () => {
    if (!adminUid) return;
    setIsMutating(true);
    try {
      const res = await openInventoryCountingSession(
        {
          name: newSessionName,
          year: Number(newSessionYear) || new Date().getFullYear(),
          notes: newSessionNotes,
        },
        adminUid
      );
      toast({
        title: res.success ? 'Sessione Inventario Aperta' : 'Impossibile Aprire Sessione',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success && res.session) {
        setIsOpenSessionModalOpen(false);
        await refreshData(res.session.id);
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleCloseCurrentSession = async () => {
    if (!adminUid || !selectedSession || selectedSession.isVirtual) return;
    setIsMutating(true);
    try {
      const res = await closeInventoryCountingSession(selectedSession.id, adminUid);
      toast({
        title: res.success ? 'Sessione Chiusa' : 'Errore',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData(selectedSession.id);
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteCurrentSession = async () => {
    if (!adminUid || !selectedSession || selectedSession.isVirtual) return;
    setIsMutating(true);
    try {
      const res = await deleteInventoryCountingSession(selectedSession.id, adminUid);
      toast({
        title: res.success ? 'Sessione Eliminata' : 'Impossibile Eliminare Sessione',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData();
    } finally {
      setIsMutating(false);
    }
  };

  const handleApproveSingle = async (recordId: string) => {
    if (!adminUid) return;
    setIsMutating(true);
    try {
      const res = await approveLedgerInventoryRecord(recordId, adminUid);
      toast({
        title: res.success ? 'Riconciliazione SSoT Completata' : 'Errore',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData(selectedSessionId);
    } finally {
      setIsMutating(false);
    }
  };

  const handleApproveBatch = async () => {
    if (!adminUid || selectedRecordIds.length === 0) return;
    setIsMutating(true);
    try {
      const res = await approveMultipleLedgerInventoryRecords(selectedRecordIds, adminUid);
      toast({
        title: res.success ? 'Approvazione Multipla SSoT' : 'Errore',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData(selectedSessionId);
    } finally {
      setIsMutating(false);
    }
  };

  const handleRevertRecord = async (recordId: string) => {
    if (!adminUid) return;
    setIsMutating(true);
    try {
      const res = await revertLedgerInventoryRecord(recordId, adminUid);
      toast({
        title: res.success ? 'Storno SSoT Eseguito' : 'Errore Storno',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData(selectedSessionId);
    } finally {
      setIsMutating(false);
    }
  };

  const handleRejectRecord = async (recordId: string) => {
    if (!adminUid) return;
    setIsMutating(true);
    try {
      const res = await rejectLedgerInventoryRecord(recordId, adminUid);
      toast({
        title: res.success ? 'Rilevazione Rifiutata' : 'Errore',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      if (res.success) await refreshData(selectedSessionId);
    } finally {
      setIsMutating(false);
    }
  };

  const confirmWriteOffLots = async () => {
    if (!adminUid || lotsPendingWriteOff.length === 0) return;
    setIsMutating(true);
    try {
      const payload = lotsPendingWriteOff.map((l) => ({
        materialId: l.materialId,
        lotto: l.lotto,
      }));
      const res = await writeOffUnscannedLots(payload, adminUid, {
        sessionId: selectedSession?.isVirtual ? null : selectedSession?.id,
        sessionName: selectedSession?.isVirtual ? null : selectedSession?.name,
      });
      toast({
        title: res.success ? 'Lotti Non Presenti Scaricati (Portati a 0)' : 'Errore Scarico',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      setLotsPendingWriteOff([]);
      if (res.success) await refreshData(selectedSessionId);
    } finally {
      setIsMutating(false);
    }
  };

  const renderDeltaBadge = (delta: number, uom: string) => {
    const safeUom = String(uom || 'kg');
    const safeDelta = Number.isFinite(Number(delta)) ? Number(delta) : 0;
    if (Math.abs(safeDelta) <= 0.0001) {
      return (
        <Badge
          variant="outline"
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 font-mono"
        >
          0 ({safeUom.toUpperCase()}) — Allineato
        </Badge>
      );
    }
    if (safeDelta > 0) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-mono font-bold">
          +{formatDisplayStock(safeDelta, safeUom as any)} (Integrazione +)
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30 hover:bg-red-500/20 font-mono font-bold">
        {formatDisplayStock(safeDelta, safeUom as any)} (Ammanco / Prelievo -)
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & KPI Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" />
            Registro Inventario SSoT (Spunta Lotti & Riconciliazione)
          </h1>
          <p className="text-muted-foreground text-sm">
            Riconciliazione deterministica per Delta matematico ($\Delta = Q_{"{rilevata}"} - Q_{"{teorica}"}$) append-only compatibile con il Ledger SSoT.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtra per codice, lotto, operatore..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => refreshData(selectedSessionId)}
            disabled={isRefreshing || isMutating}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
            Aggiorna SSoT
          </Button>
        </div>
      </div>

      {/* BARRA DI CONTROLLO SESSIONE / CAMPAGNA DI INVENTARIO (FASE 77) */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
              <div className="flex items-center gap-2 shrink-0">
                <FolderOpen className="h-5 w-5 text-primary" />
                <span className="font-semibold text-sm">Sessione / Campagna:</span>
              </div>

              <div className="w-full sm:w-[360px]">
                <Select
                  value={selectedSession?.id || VIRTUAL_SESSION_2025_ID}
                  onValueChange={(val) => {
                    setSelectedSessionId(val);
                    setSelectedRecordIds([]);
                    setSelectedUnscannedKeys([]);
                  }}
                >
                  <SelectTrigger className="bg-background font-medium">
                    <SelectValue placeholder="Seleziona sessione inventario" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessionsList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <span>{s.name}</span>
                          <Badge
                            variant={s.status === 'open' ? 'default' : 'secondary'}
                            className={cn(
                              'text-[10px] px-1.5 py-0',
                              s.status === 'open' && !s.isVirtual && 'bg-emerald-600 text-white'
                            )}
                          >
                            {s.isVirtual && s.year === 2025
                              ? 'STORICO 2025'
                              : s.status === 'open'
                                ? 'APERTA'
                                : 'CHIUSA'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            ({s.recordCount || 0} rilev.)
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2 pl-1">
                <Checkbox
                  id="include-prev-pending"
                  checked={includePreviousPending}
                  onCheckedChange={(checked) => setIncludePreviousPending(Boolean(checked))}
                />
                <Label
                  htmlFor="include-prev-pending"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Mostra anche pendenti da sessioni precedenti
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const year = new Date().getFullYear();
                  const realCountThisYear = sessionsList.filter(
                    (s) => !s.isVirtual && s.year === year
                  ).length;
                  setNewSessionYear(year);
                  setNewSessionName(`Inventario ${year} - Sessione ${realCountThisYear + 1}`);
                  setNewSessionNotes('');
                  setIsOpenSessionModalOpen(true);
                }}
                disabled={isMutating || hasOpenRealSession}
                title={
                  hasOpenRealSession
                    ? 'Chiudi prima la sessione attualmente aperta per aprirne una nuova'
                    : 'Apri una nuova campagna di inventario (Zero Danni sulle giacenze)'
                }
              >
                <PlusCircle className="mr-1.5 h-4 w-4" />
                + Apri Nuova Sessione Inventario
              </Button>

              {!selectedSession?.isVirtual && selectedSession?.status === 'open' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCloseCurrentSession}
                  disabled={isMutating}
                  className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  <Lock className="mr-1.5 h-4 w-4" />
                  Chiudi Sessione
                </Button>
              )}

              {!selectedSession?.isVirtual && (selectedSession?.recordCount || 0) === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteCurrentSession}
                  disabled={isMutating}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Elimina Sessione (0 rilev.)
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground border-t border-primary/10 pt-2">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                <strong>Stato Sessione:</strong>{' '}
                {selectedSession?.status === 'open' ? (
                  <span className="text-emerald-600 font-semibold">APERTA</span>
                ) : (
                  <span className="font-semibold">CHIUSA / STORICA</span>
                )}
              </span>
              <span>
                <strong>Apertura:</strong> {formatSafeDate(selectedSession?.openedAt)}
              </span>
              {selectedSession?.closedAt && (
                <span>
                  <strong>Chiusura:</strong> {formatSafeDate(selectedSession?.closedAt)}
                </span>
              )}
              {selectedSession?.notes && (
                <span className="italic">&ldquo;{selectedSession.notes}&rdquo;</span>
              )}
            </div>
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              Regola Zero Danni: aprire/chiudere sessioni filtra solo la vista e non altera mai le giacenze SSoT.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Totale Lotti Attivi
              </p>
              <p className="text-2xl font-bold">{kpiStats.totalLots}</p>
              {kpiStats.postInventoryCount > 0 && (
                <p className="text-[11px] text-sky-600 dark:text-sky-400 font-medium">
                  di cui {kpiStats.postInventoryCount} caricati dopo la sessione
                </p>
              )}
            </div>
            <Package className="h-8 w-8 text-primary/60" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Battuti nella Sessione
              </p>
              <p className="text-2xl font-bold text-emerald-600">{kpiStats.scannedCount}</p>
              <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                {selectedSession?.name}
              </p>
            </div>
            <ClipboardCheck className="h-8 w-8 text-emerald-500/70" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Rilevazioni da Approvare
              </p>
              <p className="text-2xl font-bold text-amber-600">{kpiStats.pendingApprovals}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-amber-500/70" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Non Battuti nella Sessione
              </p>
              <p className="text-2xl font-bold text-red-600">{kpiStats.unscannedCount}</p>
              {selectedSession?.status === 'closed' && (
                <p className="text-[11px] text-muted-foreground">
                  Esclusi i lotti caricati dopo il {selectedSession.year}
                </p>
              )}
            </div>
            <Ghost className="h-8 w-8 text-red-500/70" />
          </CardContent>
        </Card>
      </div>

      {/* 3 Tab Principali */}
      <Tabs defaultValue="pending_approvals" className="space-y-4">
        <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 h-auto gap-1 p-1">
          <TabsTrigger value="all_lots" className="py-2.5 font-semibold">
            1. Tutti i Lotti Attivi ({filteredActiveLots.length})
          </TabsTrigger>
          <TabsTrigger value="pending_approvals" className="py-2.5 font-semibold">
            2. Rilevazioni da Approvare ({kpiStats.pendingApprovals})
          </TabsTrigger>
          <TabsTrigger value="unscanned_lots" className="py-2.5 font-semibold">
            3. Lotti Non Battuti — Caccia ai Fantasmi ({filteredUnscannedLots.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: TUTTI I LOTTI ATTIVI (STATO SPUNTA) */}
        <TabsContent value="all_lots">
          <Card>
            <CardHeader>
              <CardTitle>
                Stato Spunta Lotti Attivi — {selectedSession?.name}
              </CardTitle>
              <CardDescription>
                Confronto tra i lotti attivi a magazzino e le rilevazioni effettuate nella sessione selezionata. I lotti caricati dopo la chiusura di una sessione storica sono evidenziati separatamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codice Materiale</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Lotto</TableHead>
                      <TableHead>Data Carico Lotto</TableHead>
                      <TableHead>UdM</TableHead>
                      <TableHead className="text-right">Giacenza Teorica SSoT</TableHead>
                      <TableHead className="text-right">Peso Teorico (KG)</TableHead>
                      <TableHead className="text-center">Stato Spunta Sessione</TableHead>
                      <TableHead className="text-right">Ultima Rilevazione (Sessione)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActiveLots.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                          Nessun lotto attivo trovato.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredActiveLots.map((item) => {
                        const lotKey = `${item.materialId}::${item.normLotto}`;
                        return (
                          <TableRow key={lotKey}>
                            <TableCell className="font-bold font-mono">
                              {item.materialCode}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                              {item.materialDescription}
                            </TableCell>
                            <TableCell className="font-mono font-semibold">
                              {item.lotto}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1.5 font-mono">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span>
                                  {formatLotLoadDateShort(item.lotLoadDate, item.lotLoadYear)}
                                </span>
                                {item.lotLoadYear && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {item.lotLoadYear}
                                  </Badge>
                                )}
                              </div>
                              {item.ddt && (
                                <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                  DDT: {item.ddt}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="uppercase text-xs font-bold">
                              {item.uom}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatDisplayStock(item.theoreticalUnits, item.uom)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {formatDisplayStock(item.theoreticalWeightKg, 'kg')}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.scanStatus === 'SCANNED_APPROVED' ? (
                                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                  BATTUTO / SCANSIONATO (Approvato)
                                </Badge>
                              ) : item.scanStatus === 'SCANNED_PENDING' ? (
                                <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
                                  BATTUTO / SCANSIONATO (In Attesa)
                                </Badge>
                              ) : item.scanStatus === 'POST_INVENTORY' ? (
                                <Badge
                                  variant="outline"
                                  className="border-sky-500/50 text-sky-700 dark:text-sky-300 bg-sky-500/10"
                                >
                                  Caricato dopo l&apos;inventario ({item.lotLoadYear || 2026})
                                </Badge>
                              ) : item.lotTemporalStatus === 'POST_SESSION_OPENED' ? (
                                <Badge
                                  variant="outline"
                                  className="border-indigo-500/50 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10"
                                >
                                  Nuovo Arrivo DDT (Da Battere)
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                                >
                                  NON SCANSIONATO (Da Battere)
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {item.latestRecord ? (
                                <div>
                                  <span className="font-bold">
                                    {formatDisplayStock(
                                      item.latestRecord.countedUnits,
                                      item.latestRecord.uom
                                    )}
                                  </span>{' '}
                                  <span className="text-muted-foreground">
                                    da {item.latestRecord.operatorName}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">---</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: RILEVAZIONI DA APPROVARE (CONFRONTO DELTA) */}
        <TabsContent value="pending_approvals">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>
                    Rilevazioni Operatori ({selectedSession?.name}) — Confronto Delta SSoT
                  </CardTitle>
                  <CardDescription>
                    Verifica la differenza tra Giacenza Teorica Live e Rilevato Operatore prima di consolidare nel Ledger.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-lg border p-1 bg-muted/40">
                    <Button
                      size="sm"
                      variant={statusFilter === 'pending' ? 'default' : 'ghost'}
                      onClick={() => setStatusFilter('pending')}
                      className="h-8 text-xs"
                    >
                      Da Approvare ({kpiStats.pendingApprovals})
                    </Button>
                    <Button
                      size="sm"
                      variant={statusFilter === 'approved' ? 'default' : 'ghost'}
                      onClick={() => setStatusFilter('approved')}
                      className="h-8 text-xs"
                    >
                      Approvate
                    </Button>
                    <Button
                      size="sm"
                      variant={statusFilter === 'all' ? 'default' : 'ghost'}
                      onClick={() => setStatusFilter('all')}
                      className="h-8 text-xs"
                    >
                      Tutte ({sessionEvaluated.recordsForTab2.length})
                    </Button>
                  </div>

                  {selectedRecordIds.length > 0 && (
                    <Button
                      size="sm"
                      onClick={handleApproveBatch}
                      disabled={isMutating}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {isMutating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCheck className="mr-2 h-4 w-4" />
                      )}
                      Approva Selezionate ({selectedRecordIds.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            pendingRecordsInView.length > 0 &&
                            selectedRecordIds.length === pendingRecordsInView.length
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRecordIds(pendingRecordsInView.map((r) => r.id));
                            } else {
                              setSelectedRecordIds([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Data Rilevazione / Operatore</TableHead>
                      <TableHead>Codice Materiale</TableHead>
                      <TableHead>Lotto & Data Carico</TableHead>
                      <TableHead>UdM</TableHead>
                      <TableHead className="text-right">Giacenza Teorica</TableHead>
                      <TableHead className="text-right">
                        Rilevato Operatore (Netto + Tara)
                      </TableHead>
                      <TableHead className="text-center">Delta (+ / -)</TableHead>
                      <TableHead className="text-center">Stato</TableHead>
                      <TableHead className="text-right">Azioni SSoT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="text-center py-10 text-muted-foreground"
                        >
                          Nessuna rilevazione presente in &ldquo;{selectedSession?.name}&rdquo; per il filtro selezionato.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRecords.map((rec) => {
                        const isPending = rec.status === 'pending';
                        const isApproved = rec.status === 'approved';
                        const delta = rec.liveDeltaUnits;
                        const rowHighlight =
                          Math.abs(delta) <= 0.0001
                            ? 'bg-blue-500/5'
                            : delta > 0
                              ? 'bg-emerald-500/5'
                              : 'bg-red-500/5';

                        return (
                          <TableRow key={rec.id} className={rowHighlight}>
                            <TableCell>
                              <Checkbox
                                disabled={!isPending}
                                checked={selectedRecordIds.includes(rec.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedRecordIds((prev) =>
                                    checked
                                      ? [...prev, rec.id]
                                      : prev.filter((id) => id !== rec.id)
                                  );
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium">
                                {formatSafeDate(rec.recordedAt)}
                              </div>
                              <div className="text-muted-foreground">{rec.operatorName || '---'}</div>
                              {rec.sessionName && (
                                <div className="text-[10px] text-primary font-medium mt-0.5">
                                  {rec.sessionName}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-bold font-mono">{rec.materialCode || 'N/D'}</div>
                              <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {rec.materialDescription}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-mono font-bold">{rec.lotto || 'SENZA_LOTTO'}</div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Carico: {formatLotLoadDateShort(rec.lotLoadDate, rec.lotLoadYear)}
                              </div>
                            </TableCell>
                            <TableCell className="uppercase font-bold text-xs">
                              {rec.uom || 'kg'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatDisplayStock(
                                Number(rec.liveTheoreticalUnits || 0),
                                (rec.uom || 'kg') as any
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-bold font-mono text-primary">
                                {formatDisplayStock(
                                  Number(rec.countedUnits || 0),
                                  (rec.uom || 'kg') as any
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Netto: {Number(rec.netWeight || 0).toFixed(2)} kg | Tara:{' '}
                                {Number(rec.tareWeight || 0).toFixed(2)} kg
                              </div>
                              {rec.isAnomaly && (
                                <div className="mt-1 flex justify-end">
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] gap-1"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    {rec.anomalyReason || 'Anomalia dato storico'}
                                  </Badge>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {renderDeltaBadge(delta, rec.uom)}
                            </TableCell>
                            <TableCell className="text-center">
                              {isPending && (
                                <Badge variant="secondary">In Attesa</Badge>
                              )}
                              {isApproved && (
                                <Badge className="bg-emerald-600 text-white">Approvato</Badge>
                              )}
                              {rec.status === 'rejected' && (
                                <Badge variant="destructive">Rifiutato</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {isPending && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => handleApproveSingle(rec.id)}
                                      disabled={isMutating}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                                    >
                                      <Check className="mr-1 h-3.5 w-3.5" />
                                      Approva
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleRejectRecord(rec.id)}
                                      disabled={isMutating}
                                      className="text-destructive hover:text-destructive h-8"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                {isApproved && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRevertRecord(rec.id)}
                                    disabled={isMutating}
                                    className="h-8 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                                  >
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                    Storna SSoT
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: LOTTI NON BATTUTI (CACCIA AI FANTASMI) */}
        <TabsContent value="unscanned_lots">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <Ghost className="h-5 w-5" />
                    Lotti Non Battuti nella Sessione ({selectedSession?.name})
                  </CardTitle>
                  <CardDescription>
                    Lotti con giacenza &gt; 0 non scansionati nella sessione selezionata. I lotti caricati dopo la chiusura di una sessione storica (es. lotti 2026 rispetto all&apos;inventario 2025) sono automaticamente esclusi.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedSession?.status === 'open' && !selectedSession?.isVirtual && (
                    <div className="flex rounded-lg border p-1 bg-muted/40">
                      <Button
                        size="sm"
                        variant={ghostSubFilter === 'all' ? 'default' : 'ghost'}
                        onClick={() => setGhostSubFilter('all')}
                        className="h-8 text-xs"
                      >
                        Tutti ({sessionEvaluated.unscannedLots.length})
                      </Button>
                      <Button
                        size="sm"
                        variant={ghostSubFilter === 'pre_existing' ? 'default' : 'ghost'}
                        onClick={() => setGhostSubFilter('pre_existing')}
                        className="h-8 text-xs"
                      >
                        Pre-esistenti all&apos;apertura
                      </Button>
                      <Button
                        size="sm"
                        variant={ghostSubFilter === 'post_opened' ? 'default' : 'ghost'}
                        onClick={() => setGhostSubFilter('post_opened')}
                        className="h-8 text-xs"
                      >
                        Nuovi Arrivi DDT
                      </Button>
                    </div>
                  )}

                  {selectedUnscannedKeys.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isMutating}
                      onClick={() => {
                        const chosen = filteredUnscannedLots
                          .filter((l) =>
                            selectedUnscannedKeys.includes(
                              `${l.materialId}::${l.normLotto}`
                            )
                          )
                          .map((l) => ({
                            materialId: l.materialId,
                            materialCode: l.materialCode,
                            lotto: l.lotto,
                            theoreticalUnits: l.theoreticalUnits,
                            uom: l.uom,
                          }));
                        setLotsPendingWriteOff(chosen);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Scarica Lotti Non Presenti Selezionati ({selectedUnscannedKeys.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            filteredUnscannedLots.length > 0 &&
                            selectedUnscannedKeys.length === filteredUnscannedLots.length
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedUnscannedKeys(
                                filteredUnscannedLots.map(
                                  (l) => `${l.materialId}::${l.normLotto}`
                                )
                              );
                            } else {
                              setSelectedUnscannedKeys([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Codice Materiale</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Lotto Non Battuto</TableHead>
                      <TableHead>Data Carico Lotto</TableHead>
                      <TableHead>Origine Temporale</TableHead>
                      <TableHead>UdM</TableHead>
                      <TableHead className="text-right">Giacenza Teorica a Sistema</TableHead>
                      <TableHead className="text-right">Peso Teorico (KG)</TableHead>
                      <TableHead className="text-right">Azione Rapida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnscannedLots.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                          Ottimo! Nessun lotto non battuto per la sessione e il filtro selezionati.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUnscannedLots.map((lot) => {
                        const key = `${lot.materialId}::${lot.normLotto}`;
                        return (
                          <TableRow key={key}>
                            <TableCell>
                              <Checkbox
                                checked={selectedUnscannedKeys.includes(key)}
                                onCheckedChange={(checked) => {
                                  setSelectedUnscannedKeys((prev) =>
                                    checked
                                      ? [...prev, key]
                                      : prev.filter((k) => k !== key)
                                  );
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-bold font-mono">
                              {lot.materialCode}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                              {lot.materialDescription}
                            </TableCell>
                            <TableCell className="font-mono font-bold text-red-600 dark:text-red-400">
                              {lot.lotto}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span>
                                  {formatLotLoadDateShort(lot.lotLoadDate, lot.lotLoadYear)}
                                </span>
                                {lot.lotLoadYear && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {lot.lotLoadYear}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {lot.lotTemporalStatus === 'POST_SESSION_OPENED' ? (
                                <Badge
                                  variant="outline"
                                  className="border-indigo-500/50 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 text-[11px]"
                                >
                                  Nuovo Arrivo DDT (Post-Apertura)
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-500/10 text-[11px]"
                                >
                                  Pre-esistente (Da Battere / Fantasma)
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="uppercase text-xs font-bold">
                              {lot.uom}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold">
                              {formatDisplayStock(lot.theoreticalUnits, lot.uom)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {formatDisplayStock(lot.theoreticalWeightKg, 'kg')}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isMutating}
                                onClick={() =>
                                  setLotsPendingWriteOff([
                                    {
                                      materialId: lot.materialId,
                                      materialCode: lot.materialCode,
                                      lotto: lot.lotto,
                                      theoreticalUnits: lot.theoreticalUnits,
                                      uom: lot.uom,
                                    },
                                  ])
                                }
                              >
                                Scarica Lotto Non Presente (Porta a 0)
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog "+ Apri Nuova Sessione Inventario" (Zero Danni) */}
      <Dialog open={isOpenSessionModalOpen} onOpenChange={setIsOpenSessionModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apri Nuova Sessione / Campagna di Inventario</DialogTitle>
            <DialogDescription>
              Crea una nuova sessione di conteggio per separare le nuove rilevazioni dallo storico precedente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              <strong>Garanzia Zero Danni SSoT:</strong> L&apos;apertura di una nuova sessione non modifica, non azzera e non tocca alcuna giacenza o lotto a magazzino. Tutti i lotti attivi partiranno semplicemente nello stato &ldquo;Da Battere&rdquo; per questa nuova campagna. Se aperta per errore, potrai eliminarla con un clic.
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-name">Nome Sessione / Campagna</Label>
              <Input
                id="session-name"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="Es. Inventario 2026 - Sessione 1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-year">Anno di Riferimento</Label>
              <Input
                id="session-year"
                type="number"
                value={newSessionYear}
                onChange={(e) => setNewSessionYear(Number(e.target.value) || new Date().getFullYear())}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-notes">Note (Opzionale)</Label>
              <Input
                id="session-notes"
                value={newSessionNotes}
                onChange={(e) => setNewSessionNotes(e.target.value)}
                placeholder="Es. Inventario generale materie prime"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpenSessionModalOpen(false)}
              disabled={isMutating}
            >
              Annulla
            </Button>
            <Button
              onClick={handleOpenNewSession}
              disabled={isMutating || !newSessionName.trim()}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apri Sessione Inventario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog di Conferma Scarico Lotti Non Battuti */}
      <AlertDialog
        open={lotsPendingWriteOff.length > 0}
        onOpenChange={(open) => {
          if (!open) setLotsPendingWriteOff([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Conferma Scarico Lotti Non Presenti (Porta a 0)
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Stai per azzerare nel Ledger SSoT{' '}
                  <span className="font-bold">{lotsPendingWriteOff.length}</span>{' '}
                  {lotsPendingWriteOff.length === 1 ? 'lotto non battuto' : 'lotti non battuti'}.
                  Verrà generato un record tracciato con $Q_{"{rilevata}"} = 0$ e un movimento di scarico{' '}
                  <code>RETTIFICA_INVENTARIO</code> in <code>materialWithdrawals</code> (reversibile tramite Storno).
                </p>
                <div className="max-h-40 overflow-y-auto rounded border p-2 bg-muted/40 space-y-1 font-mono text-xs">
                  {lotsPendingWriteOff.map((l, i) => (
                    <div key={i} className="flex justify-between">
                      <span>
                        {l.materialCode} — Lotto {l.lotto}
                      </span>
                      <span className="text-red-600 font-bold">
                        -{l.theoreticalUnits} {l.uom.toUpperCase()} &rarr; 0
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmWriteOffLots}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isMutating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Conferma e Porta a 0
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

