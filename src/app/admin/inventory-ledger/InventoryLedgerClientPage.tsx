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
import { Checkbox } from '@/components/ui/checkbox';
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
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { cn, formatDisplayStock } from '@/lib/utils';
import {
  approveLedgerInventoryRecord,
  approveMultipleLedgerInventoryRecords,
  getInventoryLedgerData,
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

export default function InventoryLedgerClientPage({
  initialData,
}: InventoryLedgerClientPageProps) {
  const { user, operator } = useAuth();
  const { toast } = useToast();

  const [data, setData] = useState<InventoryLedgerPageData>(initialData);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  // Selections for Tab 2 (Pending Records) and Tab 3 (Unscanned Lots)
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [selectedUnscannedKeys, setSelectedUnscannedKeys] = useState<string[]>([]);

  // Confirmation modal for write-off of unscanned lots
  const [lotsPendingWriteOff, setLotsPendingWriteOff] = useState<
    Array<{ materialId: string; materialCode: string; lotto: string; theoreticalUnits: number; uom: string }>
  >([]);

  const adminUid = user?.uid || operator?.id || '';

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fresh = await getInventoryLedgerData();
      setData(fresh);
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
  }, [toast]);

  useEffect(() => {
    const handler = () => refreshData();
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [refreshData]);

  const normQuery = searchTerm.trim().toLowerCase();

  // Filtered items for Tab 1: Tutti i Lotti Attivi (Stato Spunta)
  const filteredActiveLots = useMemo(() => {
    if (!normQuery) return data.allActiveLots;
    return data.allActiveLots.filter(
      (item) =>
        item.materialCode.toLowerCase().includes(normQuery) ||
        item.materialDescription.toLowerCase().includes(normQuery) ||
        item.lotto.toLowerCase().includes(normQuery)
    );
  }, [data.allActiveLots, normQuery]);

  // Filtered items for Tab 2: Rilevazioni da Approvare (Confronto Delta)
  const filteredRecords = useMemo(() => {
    return data.records.filter((rec) => {
      if (statusFilter !== 'all' && rec.status !== statusFilter) return false;
      if (!normQuery) return true;
      return (
        rec.materialCode.toLowerCase().includes(normQuery) ||
        (rec.materialDescription || '').toLowerCase().includes(normQuery) ||
        rec.lotto.toLowerCase().includes(normQuery) ||
        (rec.operatorName || '').toLowerCase().includes(normQuery)
      );
    });
  }, [data.records, statusFilter, normQuery]);

  const pendingRecordsInView = useMemo(
    () => filteredRecords.filter((r) => r.status === 'pending'),
    [filteredRecords]
  );

  // Filtered items for Tab 3: Lotti Non Battuti (Caccia ai Fantasmi)
  const filteredUnscannedLots = useMemo(() => {
    if (!normQuery) return data.unscannedLots;
    return data.unscannedLots.filter(
      (item) =>
        item.materialCode.toLowerCase().includes(normQuery) ||
        item.materialDescription.toLowerCase().includes(normQuery) ||
        item.lotto.toLowerCase().includes(normQuery)
    );
  }, [data.unscannedLots, normQuery]);

  // Summary KPIs
  const kpiStats = useMemo(() => {
    const totalLots = data.allActiveLots.length;
    const scannedCount = data.allActiveLots.filter((l) => l.scanStatus !== 'UNSCANNED').length;
    const unscannedCount = data.unscannedLots.length;
    const pendingApprovals = data.records.filter((r) => r.status === 'pending').length;
    return { totalLots, scannedCount, unscannedCount, pendingApprovals };
  }, [data]);

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
      if (res.success) await refreshData();
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
      if (res.success) await refreshData();
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
      if (res.success) await refreshData();
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
      if (res.success) await refreshData();
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
      const res = await writeOffUnscannedLots(payload, adminUid);
      toast({
        title: res.success ? 'Lotti Non Presenti Scaricati (Portati a 0)' : 'Errore Scarico',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
      setLotsPendingWriteOff([]);
      if (res.success) await refreshData();
    } finally {
      setIsMutating(false);
    }
  };

  const renderDeltaBadge = (delta: number, uom: string) => {
    if (Math.abs(delta) <= 0.0001) {
      return (
        <Badge
          variant="outline"
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 font-mono"
        >
          0 ({uom.toUpperCase()}) — Allineato
        </Badge>
      );
    }
    if (delta > 0) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-mono font-bold">
          +{formatDisplayStock(delta, uom as any)} (Integrazione +)
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30 hover:bg-red-500/20 font-mono font-bold">
        {formatDisplayStock(delta, uom as any)} (Ammanco / Prelievo -)
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
            onClick={refreshData}
            disabled={isRefreshing || isMutating}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
            Aggiorna SSoT
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Totale Lotti Attivi
              </p>
              <p className="text-2xl font-bold">{kpiStats.totalLots}</p>
            </div>
            <Package className="h-8 w-8 text-primary/60" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Lotti Battuti / Scansionati
              </p>
              <p className="text-2xl font-bold text-emerald-600">{kpiStats.scannedCount}</p>
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
                Lotti Non Battuti (Fantasmi)
              </p>
              <p className="text-2xl font-bold text-red-600">{kpiStats.unscannedCount}</p>
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
              <CardTitle>Stato Spunta Universale Lotti Attivi</CardTitle>
              <CardDescription>
                Elenco completo dei lotti con giacenza teorica SSoT &gt; 0 (o con rilevazioni associate) e relativo stato di scansione.
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
                      <TableHead>UdM</TableHead>
                      <TableHead className="text-right">Giacenza Teorica SSoT</TableHead>
                      <TableHead className="text-right">Peso Teorico (KG)</TableHead>
                      <TableHead className="text-center">Stato Spunta</TableHead>
                      <TableHead className="text-right">Ultima Rilevazione</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActiveLots.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
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
                            <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                              {item.materialDescription}
                            </TableCell>
                            <TableCell className="font-mono font-semibold">
                              {item.lotto}
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
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                                >
                                  NON SCANSIONATO (Da Verificare)
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
                  <CardTitle>Rilevazioni Operatori — Confronto Delta SSoT</CardTitle>
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
                      Tutte
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
                      <TableHead>Data / Operatore</TableHead>
                      <TableHead>Codice Materiale</TableHead>
                      <TableHead>Lotto</TableHead>
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
                          Nessuna rilevazione presente per il filtro selezionato.
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
                                {rec.recordedAt
                                  ? format(new Date(rec.recordedAt), 'dd/MM/yyyy HH:mm', {
                                      locale: it,
                                    })
                                  : '---'}
                              </div>
                              <div className="text-muted-foreground">{rec.operatorName}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-bold font-mono">{rec.materialCode}</div>
                              <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {rec.materialDescription}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono font-bold">{rec.lotto}</TableCell>
                            <TableCell className="uppercase font-bold text-xs">
                              {rec.uom}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatDisplayStock(rec.liveTheoreticalUnits, rec.uom)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-bold font-mono text-primary">
                                {formatDisplayStock(rec.countedUnits, rec.uom)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Netto: {rec.netWeight.toFixed(2)} kg | Tara:{' '}
                                {(rec.tareWeight || 0).toFixed(2)} kg
                              </div>
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
                    Lotti Non Battuti (Caccia ai Fantasmi)
                  </CardTitle>
                  <CardDescription>
                    Lotti che risultano avere giacenza &gt; 0 nel software ma che NON sono stati scansionati dagli operatori durante l&apos;inventario.
                  </CardDescription>
                </div>

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
                      <TableHead>UdM</TableHead>
                      <TableHead className="text-right">Giacenza Teorica a Sistema</TableHead>
                      <TableHead className="text-right">Peso Teorico (KG)</TableHead>
                      <TableHead className="text-right">Azione Rapida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnscannedLots.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                          Ottimo! Tutti i lotti attivi con giacenza &gt; 0 sono stati scansionati.
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
                            <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                              {lot.materialDescription}
                            </TableCell>
                            <TableCell className="font-mono font-bold text-red-600 dark:text-red-400">
                              {lot.lotto}
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

