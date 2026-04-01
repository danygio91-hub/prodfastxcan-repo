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
    AuditBrokenLot 
} from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck, Database, History, TrendingDown, Hammer, Info, Ghost, Skull, UserX, Zap, RotateCcw, Clock, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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

    // --- ZOMBIE LOGIC ---
    async function handleZombieAudit() {
        setZombieLoading(true);
        setError(null);
        try {
            const res = await auditZombieSessions();
            if (res.success) {
                setZombieAnomalies(res.anomalies);
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
        if (!operator?.id) return;
        setZombieExecuting(true);
        setIsZombieModalOpen(false);
        try {
            const res = await healZombieSessions(operator.id);
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
                        <TabsList className="grid w-full grid-cols-3 max-w-2xl mb-8">
                            <TabsTrigger value="inventory" className="flex items-center gap-2">
                                <Database className="h-4 w-4" /> Integrità Magazzino
                            </TabsTrigger>
                            <TabsTrigger value="zombie" className="flex items-center gap-2">
                                <Ghost className="h-4 w-4" /> Cacciatore di Zombie
                            </TabsTrigger>
                            <TabsTrigger value="recovery" className="flex items-center gap-2">
                                <RotateCcw className="h-4 w-4 text-orange-500" /> Ripristino Lotti
                            </TabsTrigger>
                        </TabsList>

                        {/* --- TAB 1: INVENTORY --- */}
                        <TabsContent value="inventory" className="space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold flex items-center gap-2">
                                    <Database className="text-primary h-6 w-6" /> Correzione Anomalie UOM
                                </h2>
                                <div className="flex gap-4">
                                    <Button variant="outline" onClick={handleAudit} disabled={loading || executing}>
                                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                        Analizza Pesi
                                    </Button>
                                    {anomalies.length > 0 && (
                                        <Button variant="destructive" onClick={() => setIsHealModalOpen(true)} disabled={loading || executing}>
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
                                        <Button variant="destructive" onClick={() => setIsZombieModalOpen(true)} disabled={zombieLoading || zombieExecuting}>
                                            {zombieExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Skull className="mr-2 h-4 w-4" />}
                                            Forza Chiusura Zombie
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
                                                <TableHead>Tipo</TableHead>
                                                <TableHead>Riferimento</TableHead>
                                                <TableHead>Operatore</TableHead>
                                                <TableHead>Dettaglio</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {zombieAnomalies.map((a) => (
                                                <TableRow key={a.id}>
                                                    <TableCell><Badge variant={a.type === 'PHASE' ? 'destructive' : 'secondary'}>{a.type}</Badge></TableCell>
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
                                        <DialogTitle className="text-red-600 flex items-center"><Skull className="mr-2" /> Conferma Chiusura Massiva</DialogTitle>
                                        <DialogDescription className="py-4">Procedere con la chiusura forzata di {zombieAnomalies.length} sessioni zombie?</DialogDescription>
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
                        </TabsContent>
                    </Tabs>
                </div>
            </AppShell>
        </AdminAuthGuard>
    );
}
