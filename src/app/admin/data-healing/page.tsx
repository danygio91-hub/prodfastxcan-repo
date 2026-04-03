'use client';

import { useState } from 'react';
import { 
    auditCorruptedInventoryData, 
    applyInventoryDataHealing, 
    AuditAnomaly, 
    auditZombieSessions, 
    healZombieSessions, 
    ZombieAnomaly,
    auditBrokenBatches,
    healBrokenBatches,
    AuditBrokenLot,
    auditGroupBlockers,
    forceUnlockAndDissolveGroup,
    GroupBlocker,
    previewStockSync,
    resyncAllMaterialStock,
    StockSyncAnomaly,
    fixCorruptedBatchLoads
} from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck, Database, History, TrendingDown, Hammer, Info, Ghost, Skull, UserX, Zap, RotateCcw, Clock, Search, Layers, Unlink, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ArrowRight, 
  Lock, 
  Calendar, 
  FileText, 
  Check, 
  X, 
  Activity,
  AlertTriangle,
  Scale
} from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function AdministrationDataHealingPage() {
    const { operator } = useAuth();
    const { toast } = useToast();
    
    // Status State
    const [loading, setLoading] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Inventory Tab State
    const [anomalies, setAnomalies] = useState<AuditAnomaly[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [isHealModalOpen, setIsHealModalOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    // Zombie Hunter Tab State
    const [zombieAnomalies, setZombieAnomalies] = useState<ZombieAnomaly[]>([]);
    const [selectedZombieIds, setSelectedZombieIds] = useState<string[]>([]);
    const [zombieLoading, setZombieLoading] = useState(false);
    const [zombieExecuting, setZombieExecuting] = useState(false);
    const [isZombieModalOpen, setIsZombieModalOpen] = useState(false);
    const [zombieConfirmText, setZombieConfirmText] = useState("");
    
    // Broken Lot Recovery State
    const [brokenLots, setBrokenLots] = useState<AuditBrokenLot[]>([]);
    const [brokenLoading, setBrokenLoading] = useState(false);
    const [brokenExecuting, setBrokenExecuting] = useState(false);
    const [isBrokenModalOpen, setIsBrokenModalOpen] = useState(false);
    const [brokenConfirmText, setBrokenConfirmText] = useState("");

    // Workgroup Unblock State
    const [groupBlockers, setGroupBlockers] = useState<GroupBlocker[]>([]);
    const [groupLoading, setGroupLoading] = useState(false);
    const [groupExecuting, setGroupExecuting] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [groupConfirmText, setGroupConfirmText] = useState("");

    // Global Stock Resync Wizard State
    const [resyncLoading, setResyncLoading] = useState(false);
    const [resyncExecuting, setResyncExecuting] = useState(false);
    const [syncAnomalies, setSyncAnomalies] = useState<StockSyncAnomaly[]>([]);
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
    const [isResyncModalOpen, setIsResyncModalOpen] = useState(false);
    const [resyncConfirmText, setResyncConfirmText] = useState("");
    
    // Read-Only Erosion Fix State
    const [erosionExecuting, setErosionExecuting] = useState(false);
    const [isErosionModalOpen, setIsErosionModalOpen] = useState(false);
    const [erosionConfirmText, setErosionConfirmText] = useState("");

    // --- INVENTORY LOGIC ---
    async function handleAudit() {
        setLoading(true);
        setError(null);
        try {
            const res = await auditCorruptedInventoryData();
            if (res.success) {
                setAnomalies(res.anomalies);
                setSummary(res.summary);
            } else {
                setError("Errore durante l'analisi del database inventory.");
            }
        } catch (e) {
            setError("Errore di connessione al server.");
        } finally {
            setLoading(false);
        }
    }

    async function handleExecuteHealing() {
        if (!operator?.id) return;
        setExecuting(true);
        setIsHealModalOpen(false);
        try {
            const res = await applyInventoryDataHealing(operator.id);
            if (res.success) {
                toast({ title: "Sanatoria Completata", description: res.message });
                await handleAudit();
            } else {
                toast({ title: "Errore Sanatoria", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare la sanatoria.", variant: "destructive" });
        } finally {
            setExecuting(false);
            setConfirmText("");
        }
    }

    async function handleStockAudit() {
        setResyncLoading(true);
        setError(null);
        try {
            const res = await previewStockSync(operator?.id || "");
            if (res.success) {
                setSyncAnomalies(res.anomalies);
                // Auto-select those that REALLY need sync (diff > 0.001)
                const toSelect = res.anomalies
                    .filter(a => a.needsSync)
                    .map(a => a.materialId);
                setSelectedMaterialIds(toSelect);
                toast({ title: "Audit Completata", description: `Trovate ${res.anomalies.filter(a => a.needsSync).length} anomalie di stock.` });
            } else {
                setError("Errore durante l'audit del magazzino.");
            }
        } catch (e) {
            setError("Impossibile contattare il server per l'audit.");
        } finally {
            setResyncLoading(false);
        }
    }

    async function handleExecuteSelectiveResync() {
        if (!operator?.id || selectedMaterialIds.length === 0) return;
        setResyncExecuting(true);
        setIsResyncModalOpen(false);
        try {
            const res = await resyncAllMaterialStock(selectedMaterialIds, operator.id);
            if (res.success) {
                toast({ title: "Ricalcolo Completato", description: res.message });
                // Reset state after success
                setSyncAnomalies([]);
                setSelectedMaterialIds([]);
            } else {
                toast({ title: "Errore Ricalcolo", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare il ricalcolo selettivo.", variant: "destructive" });
        } finally {
            setResyncExecuting(false);
            setResyncConfirmText("");
        }
    }

    const toggleSelection = (id: string) => {
        setSelectedMaterialIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleAllDiscrepancies = () => {
        const discrepancyIds = syncAnomalies.filter(a => a.needsSync).map(a => a.materialId);
        if (discrepancyIds.every(id => selectedMaterialIds.includes(id))) {
            setSelectedMaterialIds(prev => prev.filter(id => !discrepancyIds.includes(id)));
        } else {
            setSelectedMaterialIds(prev => Array.from(new Set([...prev, ...discrepancyIds])));
        }
    };

    // --- ZOMBIE LOGIC ---
    async function handleZombieAudit() {
        setZombieLoading(true);
        setError(null);
        try {
            const res = await auditZombieSessions();
            if (res.success) {
                setZombieAnomalies(res.anomalies);
                setSelectedZombieIds(res.anomalies.map(a => a.id));
            } else {
                setError("Errore durante l'analisi delle sessioni zombie.");
            }
        } catch (e) {
            setError("Errore di connessione durante l'audit zombie.");
        } finally {
            setZombieLoading(false);
        }
    }

    async function handleExecuteZombieHealing() {
        if (!operator?.id || selectedZombieIds.length === 0) return;
        setZombieExecuting(true);
        setIsZombieModalOpen(false);
        try {
            const res = await healZombieSessions(selectedZombieIds, operator.id);
            if (res.success) {
                toast({ title: "Caccia Completata", description: res.message });
                await handleZombieAudit();
            } else {
                toast({ title: "Errore Healing", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare l'operazione zombie.", variant: "destructive" });
        } finally {
            setZombieExecuting(false);
            setZombieConfirmText("");
        }
    }

    const toggleZombieSelection = (id: string) => {
        setSelectedZombieIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleAllZombies = () => {
        if (selectedZombieIds.length === zombieAnomalies.length) {
            setSelectedZombieIds([]);
        } else {
            setSelectedZombieIds(zombieAnomalies.map(a => a.id));
        }
    };

    // --- BROKEN LOT RECOVERY LOGIC ---
    async function handleBrokenAudit() {
        setBrokenLoading(true);
        setError(null);
        try {
            const res = await auditBrokenBatches();
            if (res.success) {
                setBrokenLots(res.anomalies);
            } else {
                setError("Errore durante l'analisi dei lotti corrotti.");
            }
        } catch (e) {
            setError("Errore di connessione durante l'audit dei lotti.");
        } finally {
            setBrokenLoading(false);
        }
    }

    async function handleExecuteBrokenHealing() {
        if (!operator?.id) return;
        setBrokenExecuting(true);
        setIsBrokenModalOpen(false);
        try {
            const res = await healBrokenBatches(operator.id);
            if (res.success) {
                toast({ title: "Ripristino Completato", description: res.message });
                await handleBrokenAudit();
            } else {
                toast({ title: "Errore Ripristino", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare il ripristino.", variant: "destructive" });
        } finally {
            setBrokenExecuting(false);
            setBrokenConfirmText("");
        }
    }
    async function handleExecuteErosionHealing() {
        if (!operator?.id) return;
        setErosionExecuting(true);
        setIsErosionModalOpen(false);
        try {
            const res = await fixCorruptedBatchLoads(operator.id);
            if (res.success) {
                toast({ title: "Sanatoria Erosione Completata", description: res.message });
                // We might want to refresh something here, maybe the broken lots audit if open
            } else {
                toast({ title: "Errore Sanatoria", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare la sanatoria erosione.", variant: "destructive" });
        } finally {
            setErosionExecuting(false);
            setErosionConfirmText("");
        }
    }

    // --- GROUP UNBLOCK LOGIC ---
    async function handleGroupAudit() {
        setGroupLoading(true);
        setError(null);
        try {
            const res = await auditGroupBlockers();
            if (res.success) {
                setGroupBlockers(res.blockers);
            } else {
                setError("Errore durante l'audit dei gruppi.");
            }
        } catch (e) {
            setError("Errore di connessione durante l'audit gruppi.");
        } finally {
            setGroupLoading(false);
        }
    }

    async function handleExecuteGroupUnlock() {
        if (!operator?.id || !selectedGroupId) return;
        setGroupExecuting(true);
        setIsGroupModalOpen(false);
        try {
            const res = await forceUnlockAndDissolveGroup(selectedGroupId, operator.id);
            if (res.success) {
                toast({ title: "Sblocco Completato", description: res.message });
                await handleGroupAudit();
            } else {
                toast({ title: "Errore Sblocco", description: res.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Errore di Sistema", description: "Impossibile completare lo sblocco.", variant: "destructive" });
        } finally {
            setGroupExecuting(false);
            setGroupConfirmText("");
            setSelectedGroupId(null);
        }
    }

    return (
        <AdminAuthGuard>
            <AppShell>
                <div className="p-6 max-w-7xl mx-auto space-y-8">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <h1 className="text-3xl font-bold tracking-tight">Centro Manutenzione e Integrità Dati</h1>
                            <p className="text-muted-foreground text-lg italic">Strumenti di Audit & Healing per il database di produzione.</p>
                        </div>
                    </div>

                    <Tabs defaultValue="inventory" className="w-full">
                        <TabsList className="grid w-full grid-cols-4 max-w-4xl mb-8">
                            <TabsTrigger value="inventory" className="flex items-center gap-2">
                                <Database className="h-4 w-4" /> Integrità Magazzino
                            </TabsTrigger>
                            <TabsTrigger value="zombie" className="flex items-center gap-2">
                                <Ghost className="h-4 w-4" /> Cacciatore di Zombie
                            </TabsTrigger>
                            <TabsTrigger value="recovery" className="flex items-center gap-2">
                                <RotateCcw className="h-4 w-4 text-orange-500" /> Ripristino Lotti
                            </TabsTrigger>
                            <TabsTrigger value="groups" className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-blue-500" /> Sblocco Gruppi
                            </TabsTrigger>
                        </TabsList>

                        {/* --- TAB 1: INVENTORY --- */}
                        <TabsContent value="inventory" className="space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold flex items-center gap-2">
                                    <Database className="text-primary h-6 w-6" /> Correzione Anomalie UOM
                                </h2>
                                <div className="flex gap-4">
                                    <Button variant="outline" onClick={handleAudit} disabled={loading || executing || resyncExecuting || resyncLoading}>
                                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                        Analizza Pesi
                                    </Button>
                                    
                                    <Button variant="secondary" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleStockAudit} disabled={loading || executing || resyncExecuting || resyncLoading}>
                                        {resyncLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                        Analizza Discrepanze Stock (Audit)
                                    </Button>

                                    {syncAnomalies.length > 0 && (
                                        <Button 
                                            variant="default" 
                                            className="bg-green-600 hover:bg-green-700" 
                                            onClick={() => setIsResyncModalOpen(true)} 
                                            disabled={selectedMaterialIds.length === 0 || resyncExecuting}
                                        >
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Applica Correzioni ({selectedMaterialIds.length})
                                        </Button>
                                    )}

                                    {anomalies.length > 0 && (
                                        <Button variant="destructive" onClick={() => setIsHealModalOpen(true)} disabled={loading || executing || resyncExecuting || resyncLoading}>
                                            {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Hammer className="mr-2 h-4 w-4" />}
                                            Esegui Correzione Pesi
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <Dialog open={isHealModalOpen} onOpenChange={setIsHealModalOpen}>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle className="flex items-center text-red-600">
                                            <AlertCircle className="mr-2 h-5 w-5" /> Conferma Correzione Massiva
                                        </DialogTitle>
                                        <DialogDescription className="py-4">
                                            Questa operazione sovrascriverà i pesi di <strong>{anomalies.length}</strong> record storici.
                                            L'azione è irreversibile.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <p className="text-sm text-muted-foreground">Digitare <span className="font-mono font-bold">CONFERMO</span> per procedere:</p>
                                        <Input placeholder="Digita qui..." value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="uppercase font-bold" />
                                    </div>
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => setIsHealModalOpen(false)}>Annulla</Button>
                                        <Button variant="destructive" disabled={confirmText !== "CONFERMO"} onClick={handleExecuteHealing}>CORREGGI ORA</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                            {/* Modal for Global Resync Wizard */}
                            <Dialog open={isResyncModalOpen} onOpenChange={setIsResyncModalOpen}>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle className="flex items-center text-blue-600">
                                            <Database className="mr-2 h-5 w-5" /> Conferma Ricalcolo Selettivo
                                        </DialogTitle>
                                        <DialogDescription className="py-4">
                                            Stai per ricalcolare lo stock di <strong>{selectedMaterialIds.length}</strong> materiali selezionati. 
                                            Verrà applicata la somma reale delle giacenze dei lotti.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <Alert variant="default" className="bg-blue-50 border-blue-200 text-blue-900">
                                        <Info className="h-4 w-4" />
                                        <AlertTitle>Dettaglio Operazione</AlertTitle>
                                        <AlertDescription className="text-sm opacity-90">
                                            Il database verrà aggiornato con i valori calcolati in anteprima. 
                                            I log di sistema registreranno questa operazione come <strong>RICALCOLO SELETTIVO</strong>.
                                        </AlertDescription>
                                    </Alert>
                                    <div className="space-y-4 py-4">
                                        <p className="text-sm text-muted-foreground">Digitare <span className="font-mono font-bold">CONFERMO RICALCOLO</span>:</p>
                                        <Input placeholder="CONFERMO RICALCOLO" value={resyncConfirmText} onChange={(e) => setResyncConfirmText(e.target.value)} className="uppercase font-bold border-blue-300" />
                                    </div>
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => setIsResyncModalOpen(false)}>Annulla</Button>
                                        <Button variant="default" className="bg-blue-600 hover:bg-blue-700" disabled={resyncConfirmText !== "CONFERMO RICALCOLO"} onClick={handleExecuteSelectiveResync}>ESEGUI RICALCOLO</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                            {/* --- PLAN PREVIEW TABLE --- */}
                            {syncAnomalies.length > 0 && (
                                <Card className="shadow-lg animate-in slide-in-from-top duration-500 overflow-hidden border-blue-100">
                                    <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Activity className="h-5 w-5" />
                                            <h3 className="font-bold">Piano di Ricalcolo Suggerito</h3>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs">
                                            <div className="flex items-center gap-1">
                                                <Badge className="bg-white/20 text-white border-0">Audit: {syncAnomalies.length}</Badge>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Badge className="bg-green-400 text-green-950 border-0">Da Correggere: {syncAnomalies.filter(a => a.needsSync).length}</Badge>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="overflow-x-auto max-h-[500px]">
                                        <Table>
                                            <TableHeader className="bg-slate-50 sticky top-0 z-10">
                                                <TableRow>
                                                    <TableHead className="w-12">
                                                        <Checkbox 
                                                            checked={syncAnomalies.filter(a => a.needsSync).every(a => selectedMaterialIds.includes(a.materialId))}
                                                            onCheckedChange={toggleAllDiscrepancies}
                                                            className="border-slate-400"
                                                        />
                                                    </TableHead>
                                                    <TableHead className="font-bold">Codice Materia Prima</TableHead>
                                                    <TableHead className="text-center font-bold">UOM</TableHead>
                                                    <TableHead className="text-right font-bold">Stock Attuale (DB)</TableHead>
                                                    <TableHead className="text-right font-bold text-blue-700">Stock Calcolato (Lotti)</TableHead>
                                                    <TableHead className="text-right font-bold">Differenza (Δ)</TableHead>
                                                    <TableHead className="text-center font-bold">Stato</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {syncAnomalies.map((a) => (
                                                    <TableRow key={a.materialId} className={a.needsSync ? "bg-amber-50/30" : ""}>
                                                        <TableCell>
                                                            <Checkbox 
                                                                checked={selectedMaterialIds.includes(a.materialId)}
                                                                onCheckedChange={() => toggleSelection(a.materialId)}
                                                                className="border-slate-400"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-semibold">{a.code}</TableCell>
                                                        <TableCell className="text-center"><Badge variant="outline" className="font-mono">{a.unitOfMeasure}</Badge></TableCell>
                                                        <TableCell className="text-right font-mono">{a.currentStock.toFixed(3)}</TableCell>
                                                        <TableCell className="text-right font-mono text-blue-700 font-bold">{a.calculatedStock.toFixed(3)}</TableCell>
                                                        <TableCell className={`text-right font-mono font-bold ${a.difference > 0 ? 'text-green-600' : a.difference < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                                            {a.difference > 0 ? `+${a.difference.toFixed(3)}` : a.difference.toFixed(3)}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            {a.needsSync ? (
                                                                <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600 text-amber-950 flex items-center gap-1 w-fit mx-auto">
                                                                    <AlertTriangle className="h-3 w-3" /> Disallineato
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-green-600 border-green-200 flex items-center gap-1 w-fit mx-auto">
                                                                    <Check className="h-3 w-3" /> Allineato
                                                                </Badge>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                    
                                    <div className="bg-slate-50 p-4 border-t flex items-center justify-between">
                                        <div className="flex gap-6">
                                            <div className="flex items-center gap-2 text-sm">
                                                <Scale className="h-4 w-4 text-slate-500" />
                                                <span className="text-muted-foreground whitespace-nowrap">Peso Totale Correzione:</span>
                                                <span className={`font-bold ${
                                                    syncAnomalies.filter(a => selectedMaterialIds.includes(a.materialId))
                                                        .reduce((sum, a) => sum + a.difference, 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                    {syncAnomalies.filter(a => selectedMaterialIds.includes(a.materialId))
                                                        .reduce((sum, a) => sum + a.difference, 0)
                                                        .toFixed(3)} Unità
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground italic">
                                            * Mostrate solo le differenze rilevanti ({'>'} 0.001)
                                        </div>
                                    </div>
                                </Card>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <Card className="border-l-4 border-l-amber-500 shadow-sm">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Anomalie Trovate</CardTitle>
                                    </CardHeader>
                                    <CardContent><div className="text-3xl font-bold">{summary?.totalAnomalies || 0}</div></CardContent>
                                </Card>
                                <Card className="border-l-4 border-l-red-500 shadow-sm">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Peso Errato</CardTitle>
                                    </CardHeader>
                                    <CardContent><div className="text-3xl font-bold">{summary?.totalErroneousWeight?.toFixed(2) || "0.00"} KG</div></CardContent>
                                </Card>
                                <Card className="border-l-4 border-l-green-500 shadow-sm">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Peso Atteso</CardTitle>
                                    </CardHeader>
                                    <CardContent><div className="text-3xl font-bold">{summary?.totalCorrectedWeight?.toFixed(2) || "0.00"} KG</div></CardContent>
                                </Card>
                                <Card className="border-l-4 border-l-blue-500 shadow-sm">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Δ Correzione</CardTitle>
                                    </CardHeader>
                                    <CardContent><div className="text-3xl font-bold text-blue-600">-{summary?.savedWeightKg?.toFixed(2) || "0.00"} KG</div></CardContent>
                                </Card>
                            </div>

                            {anomalies.length > 0 && (
                                <Card className="shadow-lg">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow>
                                                <TableHead className="font-bold">Materia Prima</TableHead>
                                                <TableHead className="font-bold">Lotto</TableHead>
                                                <TableHead className="text-right font-bold">Peso Corrotto</TableHead>
                                                <TableHead className="text-right font-bold">Peso Corretto</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {anomalies.map((a) => (
                                                <TableRow key={a.id}>
                                                    <TableCell className="font-semibold">{a.materialCode}</TableCell>
                                                    <TableCell className="font-mono text-xs">{a.lotto}</TableCell>
                                                    <TableCell className="text-right text-red-600">{a.currentWeight.toFixed(3)} KG</TableCell>
                                                    <TableCell className="text-right text-green-600">{a.expectedWeight.toFixed(3)} KG</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </Card>
                            )}

                            {error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Errore</AlertTitle>
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            {!loading && anomalies.length === 0 && !error && (
                                <div className="py-20 text-center border-2 border-dashed rounded-xl opacity-60">
                                    <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">Nessuna anomalia di peso rilevata.</p>
                                </div>
                            )}
                        </TabsContent>

                        {/* --- TAB 2: ZOMBIE HUNTER --- */}
                        <TabsContent value="zombie" className="space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h2 className="text-2xl font-bold flex items-center gap-2">
                                        <Ghost className="text-red-500 h-6 w-6" /> Cacciatore di Sessioni Zombie
                                    </h2>
                                    <p className="text-sm text-muted-foreground">Scansione di fasi, prelievi e operatori rimasti bloccati.</p>
                                </div>
                                <div className="flex gap-4">
                                    <Button variant="outline" onClick={handleZombieAudit} disabled={zombieLoading || zombieExecuting}>
                                        {zombieLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                        Analizza Zombie
                                    </Button>
                                    {zombieAnomalies.length > 0 && (
                                        <Button variant="destructive" onClick={() => setIsZombieModalOpen(true)} disabled={zombieLoading || zombieExecuting || selectedZombieIds.length === 0}>
                                            {zombieExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Skull className="mr-2 h-4 w-4" />}
                                            Forza Chiusura Zombie ({selectedZombieIds.length})
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card className="border-l-4 border-l-red-500"><CardContent className="pt-6"><div className="text-xs uppercase text-muted-foreground mb-1">Fasi Appese</div><div className="text-3xl font-bold">{zombieAnomalies.filter(a => a.type === 'PHASE').length}</div></CardContent></Card>
                                <Card className="border-l-4 border-l-orange-500"><CardContent className="pt-6"><div className="text-xs uppercase text-muted-foreground mb-1">Prelievi Ghost</div><div className="text-3xl font-bold">{zombieAnomalies.filter(a => a.type === 'WITHDRAWAL').length}</div></CardContent></Card>
                                <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-6"><div className="text-xs uppercase text-muted-foreground mb-1">Operatori Occupati</div><div className="text-3xl font-bold">{zombieAnomalies.filter(a => a.type === 'OPERATOR').length}</div></CardContent></Card>
                            </div>

                            {zombieAnomalies.length > 0 ? (
                                <Card className="shadow-md">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow>
                                                <TableHead className="w-12">
                                                    <Checkbox 
                                                        checked={zombieAnomalies.length > 0 && selectedZombieIds.length === zombieAnomalies.length}
                                                        onCheckedChange={toggleAllZombies}
                                                        className="border-slate-400"
                                                    />
                                                </TableHead>
                                                <TableHead>Tipo</TableHead>
                                                <TableHead>Riferimento</TableHead>
                                                <TableHead>Operatore</TableHead>
                                                <TableHead>Dettaglio</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {zombieAnomalies.map((a) => (
                                                <TableRow key={a.id} className={selectedZombieIds.includes(a.id) ? "" : "opacity-50"}>
                                                    <TableCell>
                                                        <Checkbox 
                                                            checked={selectedZombieIds.includes(a.id)}
                                                            onCheckedChange={() => toggleZombieSelection(a.id)}
                                                            className="border-slate-400"
                                                        />
                                                    </TableCell>
                                                    <TableCell><Badge variant={a.type === 'PHASE' ? 'destructive' : a.type === 'WITHDRAWAL' ? 'secondary' : 'default'}>{a.type}</Badge></TableCell>
                                                    <TableCell className="font-medium">{a.reference}</TableCell>
                                                    <TableCell>{a.operatorName}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{a.details}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </Card>
                            ) : !zombieLoading && (
                                <div className="py-12 text-center border-2 border-dashed rounded-xl opacity-60">
                                    <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">Nessun zombie rilevato.</p>
                                </div>
                            )}

                            <Dialog open={isZombieModalOpen} onOpenChange={setIsZombieModalOpen}>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle className="text-red-600 flex items-center"><Skull className="mr-2" /> Conferma Chiusura Selettiva</DialogTitle>
                                        <DialogDescription className="py-4">Procedere con la chiusura forzata di {selectedZombieIds.length} sessioni zombie selezionate?</DialogDescription>
                                    </DialogHeader>
                                    <Input value={zombieConfirmText} onChange={e => setZombieConfirmText(e.target.value)} placeholder="CONFERMO" className="uppercase font-bold" />
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => setIsZombieModalOpen(false)}>Annulla</Button>
                                        <Button variant="destructive" disabled={zombieConfirmText !== "CONFERMO"} onClick={handleExecuteZombieHealing}>Esegui Healing</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </TabsContent>

                        {/* --- TAB 3: LOT RECOVERY --- */}
                        <TabsContent value="recovery" className="space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h2 className="text-2xl font-bold flex items-center gap-2 text-orange-600">
                                        <RotateCcw className="h-6 w-6" /> Ripristino Carico Iniziale (Bug Materiale Finito)
                                    </h2>
                                    <p className="text-sm text-muted-foreground">Recupera i lotti con carico a zero ma con scarichi storici presenti.</p>
                                </div>
                                <div className="flex gap-4">
                                    <Button variant="outline" onClick={handleBrokenAudit} disabled={brokenLoading || brokenExecuting}>
                                        {brokenLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                        Analizza Corruzione
                                    </Button>
                                    {brokenLots.length > 0 && (
                                        <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => setIsBrokenModalOpen(true)} disabled={brokenLoading || brokenExecuting}>
                                            {brokenExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                            Ripristina Sacralità Lotti
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {brokenLots.length > 0 ? (
                                <div className="space-y-4">
                                    <Alert className="border-orange-500 bg-orange-50">
                                        <Info className="h-4 w-4 text-orange-500" />
                                        <AlertTitle className="text-orange-800">Lotti da Ripristinare</AlertTitle>
                                        <AlertDescription className="text-orange-700">
                                            Sono stati trovati {brokenLots.length} lotti dove il carico iniziale è stato erroneamente sovrascritto a zero. 
                                            Il ripristino calcolerà il nuovo carico come somma di tutti gli scarichi effettuati.
                                        </AlertDescription>
                                    </Alert>

                                    <Card className="shadow-md">
                                        <Table>
                                            <TableHeader className="bg-muted/50">
                                                <TableRow>
                                                    <TableHead>Codice Materiale</TableHead>
                                                    <TableHead>Lotto Corrotto</TableHead>
                                                    <TableHead className="text-right">Carico Attuale</TableHead>
                                                    <TableHead className="text-right">Nuovo Carico (Aggregato)</TableHead>
                                                    <TableHead className="text-right">Scarichi Trovati</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {brokenLots.map((a) => (
                                                    <TableRow key={a.id}>
                                                        <TableCell className="font-bold">{a.materialCode}</TableCell>
                                                        <TableCell className="font-mono text-xs">{a.lotto}</TableCell>
                                                        <TableCell className="text-right text-red-500 font-bold">{a.currentNetQuantity.toFixed(2)}</TableCell>
                                                        <TableCell className="text-right text-green-600 font-bold">{a.expectedNetQuantity.toFixed(2)}</TableCell>
                                                        <TableCell className="text-right">{a.withdrawalCount}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </Card>
                                </div>
                            ) : !brokenLoading && (
                                <div className="py-12 text-center border-2 border-dashed rounded-xl opacity-60">
                                    <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">Nessuna corruzione da 'Materiale Finito' rilevata.</p>
                                </div>
                            )}

                            <Dialog open={isBrokenModalOpen} onOpenChange={setIsBrokenModalOpen}>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle className="text-orange-600 flex items-center"><RotateCcw className="mr-2" /> Ripristino Lotti</DialogTitle>
                                        <DialogDescription className="py-4">
                                            Questa azione ripristinerà il carico iniziale per {brokenLots.length} lotti. 
                                            È un'operazione di chirurgia sui dati.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-2">
                                        <p className="text-sm font-medium">Scrivere <span className="font-bold text-orange-600">RIPRISTINA</span> per confermare:</p>
                                        <Input value={brokenConfirmText} onChange={e => setBrokenConfirmText(e.target.value)} placeholder="RIPRISTINA" className="uppercase font-bold border-orange-300 focus-visible:ring-orange-500" />
                                    </div>
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => setIsBrokenModalOpen(false)}>Annulla</Button>
                                        <Button className="bg-orange-600 hover:bg-orange-700 text-white" disabled={brokenConfirmText !== "RIPRISTINA"} onClick={handleExecuteBrokenHealing}>ESEGUI RIPRISTINO</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                            {/* Section for Level 3 Healing: Erosion Fix */}
                            <Card className="border-t-4 border-t-purple-600 shadow-md mt-12">
                                <CardHeader>
                                    <CardTitle className="text-purple-700 flex items-center gap-2">
                                        <History className="h-5 w-5" /> Sanatoria Massiva Erosione Carichi (Violazione Read-Only)
                                    </CardTitle>
                                    <CardDescription>
                                        Questo strumento identifica AUTOMATICAMENTE tutti i lotti in cui il <span className="font-bold underline italic text-orange-700">netQuantity</span> è stato eroso dai prelievi (es. il caso 242 invece di 5000) 
                                        e lo ripristina al valore originale presente nel record di carico magazzino.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Alert variant="default" className="bg-purple-50 border-purple-200">
                                        <ShieldCheck className="h-4 w-4 text-purple-600" />
                                        <AlertTitle className="text-purple-800">Sicurezza Garantita</AlertTitle>
                                        <AlertDescription className="text-purple-700 text-xs">
                                            L'algoritmo non raddoppia i valori: se un lotto è già correttamente in Read-Only (es. 5000), verrà ignorato. 
                                            Verranno curati solo i lotti dove <span className="font-mono">Carico Originale - netQuantity {">"} 0</span>.
                                        </AlertDescription>
                                    </Alert>
                                    
                                    <div className="pt-4">
                                        <Button 
                                            className="bg-purple-600 hover:bg-purple-700 text-white w-full py-6 text-lg font-bold shadow-lg"
                                            onClick={() => setIsErosionModalOpen(true)}
                                            disabled={erosionExecuting}
                                        >
                                            {erosionExecuting ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : <Zap className="mr-2 h-6 w-6 text-yellow-300" />}
                                            AVVIA SANATORIA MASSIVA EROSIONE
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            <Dialog open={isErosionModalOpen} onOpenChange={setIsErosionModalOpen}>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle className="text-purple-600 flex items-center">
                                            <TriangleAlert className="mr-2 h-6 w-6" /> Sanatoria Massiva Erosione
                                        </DialogTitle>
                                        <DialogDescription className="py-4 font-medium text-slate-700">
                                            Attenzione: Questo script scansionerà l'intera anagrafica materiali e ripristinerà TUTTI i carichi lotti.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-2 border-t pt-4">
                                        <p className="text-sm">Scrivere <span className="font-bold text-purple-600">SANATORIA SACRA</span> per confermare l'esecuzione:</p>
                                        <Input 
                                            value={erosionConfirmText} 
                                            onChange={e => setErosionConfirmText(e.target.value)} 
                                            placeholder="SANATORIA SACRA" 
                                            className="uppercase font-extrabold border-purple-300 h-12 text-center text-lg" 
                                        />
                                    </div>
                                    <DialogFooter className="mt-4">
                                        <Button variant="ghost" onClick={() => setIsErosionModalOpen(false)}>Annulla</Button>
                                        <Button 
                                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold" 
                                            disabled={erosionConfirmText !== "SANATORIA SACRA"} 
                                            onClick={handleExecuteErosionHealing}
                                        >
                                            ESEGUI ORA
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </TabsContent>

                        {/* --- TAB 4: GROUP UNBLOCK --- */}
                        <TabsContent value="groups" className="space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h2 className="text-2xl font-bold flex items-center gap-2 text-blue-600">
                                        <Layers className="h-6 w-6" /> Gestione Gruppi Appesi (Force Unlock)
                                    </h2>
                                    <p className="text-sm text-muted-foreground">Identifica e forza lo scioglimento di gruppi bloccati da sessioni "fantasma".</p>
                                </div>
                                <Button variant="outline" onClick={handleGroupAudit} disabled={groupLoading || groupExecuting}>
                                    {groupLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                    Analizza Blocchi Gruppo
                                </Button>
                            </div>

                            {groupBlockers.length > 0 ? (
                                <div className="grid grid-cols-1 gap-6">
                                    {groupBlockers.map((gb) => (
                                        <Card key={gb.groupId} className="overflow-hidden border-blue-200">
                                            <CardHeader className="bg-blue-50/50 pb-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                            <Layers className="h-5 w-5" />
                                                        </div>
                                                        <div>
                                                            <CardTitle className="text-lg">Gruppo {gb.groupRef}</CardTitle>
                                                            <CardDescription className="font-mono text-xs">ID: {gb.groupId}</CardDescription>
                                                        </div>
                                                    </div>
                                                    <Button 
                                                        variant="destructive" 
                                                        size="sm" 
                                                        onClick={() => {
                                                            setSelectedGroupId(gb.groupId);
                                                            setGroupConfirmText("");
                                                            setIsGroupModalOpen(true);
                                                        }}
                                                        disabled={groupExecuting}
                                                    >
                                                        <Unlink className="h-4 w-4 mr-2" /> Forza Sblocco e Sciogli
                                                    </Button>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="pt-4">
                                                <div className="space-y-3">
                                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Elementi Bloccanti Rilevati:</p>
                                                    {gb.blockers.map((b, idx) => (
                                                        <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border bg-slate-50">
                                                            <TriangleAlert className={`h-5 w-5 mt-0.5 ${b.type === 'PHASE_OPEN' ? 'text-amber-500' : 'text-red-500'}`} />
                                                            <div>
                                                                <p className="text-sm font-semibold">
                                                                    {b.type === 'OPERATOR_JOB' && "Operatore Occupato (Lavoro)"}
                                                                    {b.type === 'OPERATOR_MATERIAL' && "Operatore Occupato (Materiale)"}
                                                                    {b.type === 'PHASE_OPEN' && "Fase Aperta (Documento)"}
                                                                </p>
                                                                <p className="text-sm text-balance">
                                                                    {b.operatorName && <span className="font-bold underline mr-1">{b.operatorName}:</span>}
                                                                    {b.details}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : !groupLoading && (
                                <div className="py-20 text-center border-2 border-dashed rounded-xl opacity-60">
                                    <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                                    <p className="text-muted-foreground">Nessun gruppo bloccato rilevato.</p>
                                </div>
                            )}

                            <Dialog open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen}>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle className="text-red-600 flex items-center gap-2">
                                            <Skull className="h-5 w-5" /> Azione Nucleare: Sblocco Gruppo
                                        </DialogTitle>
                                        <DialogDescription className="py-4">
                                            Questa azione espellerà forzatamente gli operatori dal gruppo, chiuderà le fasi nel documento e tenterà lo scioglimento. 
                                            <br /><strong>Usare solo se il gruppo è realmente "zombie".</strong>
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-2">
                                        <p className="text-sm font-medium">Scrivere <span className="font-bold text-red-600 uppercase">SBLOCCA</span> per confermare:</p>
                                        <Input 
                                            value={groupConfirmText} 
                                            onChange={e => setGroupConfirmText(e.target.value)} 
                                            placeholder="SBLOCCA" 
                                            className="uppercase font-bold border-red-300 focus-visible:ring-red-500" 
                                        />
                                    </div>
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => { setIsGroupModalOpen(false); setSelectedGroupId(null); }}>Annulla</Button>
                                        <Button 
                                            variant="destructive"
                                            disabled={groupConfirmText !== "SBLOCCA"} 
                                            onClick={handleExecuteGroupUnlock}
                                        >
                                            ESEGUI SBLOCCO FORZATO
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </TabsContent>
                    </Tabs>
                </div>
            </AppShell>
        </AdminAuthGuard>
    );
}
