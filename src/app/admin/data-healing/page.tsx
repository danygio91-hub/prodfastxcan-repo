'use client';

import { useState } from 'react';
import { auditCorruptedInventoryData, applyInventoryDataHealing, AuditAnomaly } from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck, Database, History, TrendingDown, Hammer, Info } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
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
    const [loading, setLoading] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [anomalies, setAnomalies] = useState<AuditAnomaly[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    
    // Healing Modal State
    const [isHealModalOpen, setIsHealModalOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    async function handleAudit() {
        setLoading(true);
        setError(null);
        try {
            const res = await auditCorruptedInventoryData();
            if (res.success) {
                setAnomalies(res.anomalies);
                setSummary(res.summary);
            } else {
                setError("Errore durante l'analisi del database.");
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
                toast({
                    title: "Sanatoria Completata",
                    description: res.message,
                    variant: "default",
                });
                // Re-run audit to show 0 results
                await handleAudit();
            } else {
                toast({
                    title: "Errore Sanatoria",
                    description: res.message,
                    variant: "destructive",
                });
            }
        } catch (e) {
            toast({
                title: "Errore di Sistema",
                description: "Impossibile comunicare con il server per la sanatoria.",
                variant: "destructive",
            });
        } finally {
            setExecuting(false);
            setConfirmText("");
        }
    }

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Centro Manutenzione e Integrità Dati</h1>
                    <p className="text-muted-foreground mt-1 text-lg">Monitoraggio salute del database e correzione anomalie UOM.</p>
                </div>
                <div className="flex gap-4">
                    <Button 
                        variant="outline"
                        size="lg" 
                        onClick={handleAudit} 
                        disabled={loading || executing}
                    >
                        {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
                        Analizza Database
                    </Button>

                    {anomalies.length > 0 && (
                        <Button 
                            size="lg" 
                            variant="destructive"
                            onClick={() => setIsHealModalOpen(true)}
                            disabled={loading || executing}
                            className="shadow-lg hover:bg-destructive/90 transition-all font-bold"
                        >
                            {executing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Hammer className="mr-2 h-5 w-5" />}
                            Esegui Correzione Massiva
                        </Button>
                    )}
                </div>
            </div>

            {/* Confirmation Dialog */}
            <Dialog open={isHealModalOpen} onOpenChange={setIsHealModalOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center text-red-600">
                            <AlertCircle className="mr-2 h-5 w-5" /> Conferma Correzione Massiva
                        </DialogTitle>
                        <DialogDescription className="py-4">
                            Questa operazione sovrascriverà i pesi di <strong>{anomalies.length}</strong> record storici. 
                            I pesi saranno ricalcolati in base alle quantità (Pezzi/Metri) e ai fattori di conversione.
                            <br/><br/>
                            <span className="font-bold text-red-600">L'azione è irreversibile.</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            Per procedere, digita <span className="font-mono font-bold text-foreground">CONFERMO</span> nel campo sottostante:
                        </p>
                        <Input 
                            placeholder="Digita qui..." 
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            className="uppercase font-bold"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsHealModalOpen(false)}>Annulla</Button>
                        <Button 
                            variant="destructive" 
                            disabled={confirmText !== "CONFERMO"}
                            onClick={handleExecuteHealing}
                        >
                            CORREGGI ORA
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card className="border-l-4 border-l-amber-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center">
                            <AlertCircle className="mr-2 h-4 w-4 text-amber-500" /> Anomalie Trovate
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{summary?.totalAnomalies || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Lotti/Record corrotti</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-red-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center">
                            <Database className="mr-2 h-4 w-4 text-red-500" /> Peso Inesistente
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{summary?.totalErroneousWeight.toFixed(2) || "0.00"} <span className="text-sm font-normal text-muted-foreground">KG</span></div>
                        <p className="text-xs text-muted-foreground mt-1">Valore attualmente a sistema</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center">
                            <TrendingDown className="mr-2 h-4 w-4 text-green-500" /> Peso Reale Atteso
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{summary?.totalCorrectedWeight.toFixed(2) || "0.00"} <span className="text-sm font-normal text-muted-foreground">KG</span></div>
                        <p className="text-xs text-muted-foreground mt-1">Dopo l'eventuale sanatoria</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-blue-500 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center">
                            <TrendingDown className="mr-2 h-4 w-4 text-blue-500" /> Correzione Totale
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">-{summary?.savedWeightKg.toFixed(2) || "0.00"} <span className="text-sm font-normal text-muted-foreground">KG</span></div>
                        <p className="text-xs text-muted-foreground mt-1">Eccesso di peso da stornare</p>
                    </CardContent>
                </Card>
            </div>

            {error && (
                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-1">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Errore Audit</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {!loading && anomalies.length === 0 && !error && (
                <div className="py-20 text-center space-y-4 border-2 border-dashed rounded-xl border-muted opacity-60">
                    <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                        <ShieldCheck className="h-8 w-8" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-xl">Nessuna analisi avviata</h3>
                        <p className="text-muted-foreground">Clicca sul pulsante in alto per scansionare il database alla ricerca di anomalie di peso.</p>
                    </div>
                </div>
            )}

            {anomalies.length > 0 && (
                <Card className="shadow-lg border-muted">
                    <CardHeader className="border-b bg-muted/30 px-6 py-4">
                        <div className="flex justify-between items-center">
                            <CardTitle className="flex items-center text-xl">
                                <History className="mr-2 h-5 w-5 text-primary" /> Dettaglio Anomalie Identificate
                            </CardTitle>
                            <div className="text-xs font-mono bg-primary/10 text-primary px-3 py-1 rounded-full border border-primary/20">
                                SCANSIONE COMPLETATA: SOLO LETTURA
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-[100px] font-bold">Tipo</TableHead>
                                    <TableHead className="font-bold">Materia Prima</TableHead>
                                    <TableHead className="font-bold">Lotto</TableHead>
                                    <TableHead className="text-right font-bold">Quantità (Base)</TableHead>
                                    <TableHead className="text-right font-bold">Peso Corrotto</TableHead>
                                    <TableHead className="text-right font-bold">Peso Corretto</TableHead>
                                    <TableHead className="text-right font-bold text-red-500 font-bold">Differenza (Δ)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {anomalies.map((a, idx) => (
                                    <TableRow key={a.id} className="hover:bg-muted/30 transition-colors">
                                        <TableCell>
                                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                                                a.type === 'BATCH' ? 'bg-blue-100 text-blue-700 border-blue-200' : 
                                                a.type === 'RECORD' ? 'bg-purple-100 text-purple-700 border-purple-200' : 
                                                'bg-orange-100 text-orange-700 border-orange-200'
                                            }`}>
                                                {a.type}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-semibold">{a.materialCode}</TableCell>
                                        <TableCell className="font-mono text-xs">{a.lotto}</TableCell>
                                        <TableCell className="text-right font-medium">{a.quantity} <span className="text-[10px] text-muted-foreground font-normal">{a.uom.toUpperCase()}</span></TableCell>
                                        <TableCell className="text-right text-red-600 font-medium">{a.currentWeight.toFixed(3)} KG</TableCell>
                                        <TableCell className="text-right text-green-600 font-medium">{a.expectedWeight.toFixed(3)} KG</TableCell>
                                        <TableCell className="text-right font-bold text-red-500">-{a.difference.toFixed(3)} KG</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {summary && summary.totalAnomalies > 0 && (
                <Alert className="bg-amber-50 border-amber-200 text-amber-900 shadow-sm p-6 rounded-xl border-2">
                    <div className="flex gap-4">
                        <AlertCircle className="h-8 w-8 text-amber-600 flex-shrink-0" />
                        <div className="space-y-2">
                            <AlertTitle className="text-xl font-bold">Azione di Sicurezza Suggerita</AlertTitle>
                            <AlertDescription className="text-amber-800 text-base leading-relaxed">
                                L'analisi ha confermato che <strong>{summary.totalAnomalies}</strong> record presentano il peso identico alla quantità in pezzi/metri. 
                                Questo ha generato un carico fittizio di <strong>{summary.savedWeightKg.toFixed(2)} KG</strong> in eccesso nel magazzino.
                                <br/><br/>
                                <strong className="text-amber-900 border-b border-amber-900">NESSUN DATO È STATO ANCORA MODIFICATO.</strong> Questa è solo una simulazione. 
                                Se la tabella sopra ti sembra corretta, ti fornirò nelle prossime fasi il tasto per applicare queste correzioni al database.
                            </AlertDescription>
                        </div>
                    </div>
                </Alert>
            )}
        </div>
    );
}
