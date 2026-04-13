"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { JobOrder, Article, PackingList, PackingListItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Package, Ship, CheckCircle2, ChevronRight, 
    ChevronLeft, Scale, Printer, Loader2, Info, AlertTriangle, Boxes,
    Building2, ListTodo, Box, History, Trash2, XCircle, Search
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createPackingList, getArticlesByCodes, getPackingLists, cancelPackingList } from './actions';
import { generatePackingListPDF } from '@/lib/packing-pdf-utils';
import { useAuth } from '@/components/auth/AuthProvider';
import { cn } from '@/lib/utils';

interface PackingRow {
    articleCode: string;
    description: string;
    totalQty: number;
    unitWeightKg: number;
    packagingTareWeightKg: number;
    packagingType: string;
    packingInstructions: string;
    numberOfPackages: number;
    actualWeightKg: number;
    theoreticalWeightKg: number;
    jobIds: string[];
}

interface OrderGroup {
    numeroODL: string;
    articles: Record<string, PackingRow>;
}

interface ClienteGroup {
    cliente: string;
    orders: Record<string, OrderGroup>;
}

interface PackingClientPageProps {
    initialJobs: JobOrder[];
}

export default function PackingClientPage({ initialJobs }: PackingClientPageProps) {
    const { toast } = useToast();
    const { operator } = useAuth();
    const [activeTab, setActiveTab] = useState<string>("create");
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [packingData, setPackingData] = useState<Record<string, ClienteGroup>>({});
    const [history, setHistory] = useState<PackingList[]>([]);
    const [lastCreatedPlId, setLastCreatedPlId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    // Fetch history when tab changes
    useEffect(() => {
        if (activeTab === "history") {
            loadHistory();
        }
    }, [activeTab]);

    const loadHistory = async () => {
        setIsProcessing(true);
        const lists = await getPackingLists();
        setHistory(lists);
        setIsProcessing(false);
        return lists;
    };

    // Step 1: Selection
    const toggleJob = (id: string) => {
        setSelectedJobIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const filteredJobs = useMemo(() => {
        if (!searchQuery) return initialJobs;
        const q = searchQuery.toLowerCase();
        return initialJobs.filter(j => 
            j.ordinePF.toLowerCase().includes(q) || 
            j.cliente?.toLowerCase().includes(q) || 
            j.details.toLowerCase().includes(q) ||
            j.numeroODL?.toLowerCase().includes(q)
        );
    }, [initialJobs, searchQuery]);

    const handleNextToPacking = async () => {
        if (selectedJobIds.length === 0) {
            toast({ title: "Attenzione", description: "Seleziona almeno una commessa.", variant: "destructive" });
            return;
        }

        setIsProcessing(true);
        const selectedJobs = initialJobs.filter(j => selectedJobIds.includes(j.id));
        const articleCodes = selectedJobs.map(j => j.details);
        
        try {
            const fetchedArticles = await getArticlesByCodes(articleCodes);
            const articlesMap: Record<string, Article> = {};
            fetchedArticles.forEach((a: any) => { articlesMap[a.code.toUpperCase()] = a; });

            // Grouping Logic
            const groups: Record<string, ClienteGroup> = {};
            
            selectedJobs.forEach(job => {
                const cliente = job.cliente || "Cliente Sconosciuto";
                const orderNum = job.ordinePF || "Ordine N/D";
                const artCode = job.details;
                const article = articlesMap[artCode.toUpperCase()];

                if (!groups[cliente]) {
                    groups[cliente] = { cliente, orders: {} };
                }
                if (!groups[cliente].orders[orderNum]) {
                    groups[cliente].orders[orderNum] = { numeroODL: orderNum, articles: {} };
                }

                if (!groups[cliente].orders[orderNum].articles[artCode]) {
                    groups[cliente].orders[orderNum].articles[artCode] = {
                        articleCode: artCode,
                        description: artCode, 
                        totalQty: 0,
                        unitWeightKg: article?.unitWeightKg || 0,
                        packagingTareWeightKg: article?.packagingTareWeightKg || 0,
                        packagingType: article?.packagingType || "N/D",
                        packingInstructions: article?.packingInstructions || "Nessuna istruzione",
                        numberOfPackages: 1,
                        actualWeightKg: 0,
                        theoreticalWeightKg: 0,
                        jobIds: []
                    };
                }

                const row = groups[cliente].orders[orderNum].articles[artCode];
                row.totalQty += job.qta;
                row.jobIds.push(job.id);
                row.theoreticalWeightKg = (row.totalQty * row.unitWeightKg) + (row.numberOfPackages * row.packagingTareWeightKg);
                row.actualWeightKg = Number(row.theoreticalWeightKg.toFixed(2));
            });

            setPackingData(groups);
            setStep(2);
        } catch (error) {
            console.error(error);
            toast({ title: "Errore", description: "Impossibile caricare i dati degli articoli.", variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    };

    const updateRow = (cliente: string, order: string, artCode: string, fields: Partial<PackingRow>) => {
        setPackingData(prev => {
            const newGroups = { ...prev };
            const row = newGroups[cliente].orders[order].articles[artCode];
            Object.assign(row, fields);
            row.theoreticalWeightKg = (row.totalQty * row.unitWeightKg) + (row.numberOfPackages * row.packagingTareWeightKg);
            return { ...newGroups };
        });
    };

    const handleConfirmShipment = async () => {
        if (!operator) return;
        setIsProcessing(true);
        
        const itemsToSave: { jobId: string, quantity: number, weight?: number, packages?: number }[] = [];
        
        Object.values(packingData).forEach(c => {
            Object.values(c.orders).forEach(o => {
                Object.values(o.articles).forEach(row => {
                    row.jobIds.forEach(id => {
                        itemsToSave.push({ 
                            jobId: id, 
                            quantity: row.totalQty / row.jobIds.length, // Approssimato se raggruppate
                            weight: row.actualWeightKg, 
                            packages: row.numberOfPackages 
                        });
                    });
                });
            });
        });

        const result = await createPackingList(operator.id, operator.nome, itemsToSave);
        
        if (result.success && result.packingListId) {
            setLastCreatedPlId(result.packingListId);
            setStep(3);
            toast({ title: "Successo", description: result.message });
        } else {
            toast({ title: "Errore", description: result.message, variant: "destructive" });
        }
        setIsProcessing(false);
    };

    const handleCancelPL = async (id: string) => {
        if (!confirm(`Sei sicuro di voler annullare la Packing List ${id}? Le commesse torneranno allo stato precedente.`)) return;
        
        setIsProcessing(true);
        const result = await cancelPackingList(id);
        if (result.success) {
            toast({ title: "Annullata", description: result.message });
            loadHistory();
        } else {
            toast({ title: "Errore", description: result.message, variant: "destructive" });
        }
        setIsProcessing(false);
    };

    const handleReprint = (pl: PackingList) => {
        generatePackingListPDF(pl);
        toast({ title: "PDF Generato", description: `Ristampa di ${pl.id} avviata.` });
    };

    return (
        <div className="container mx-auto p-2 sm:p-4 max-w-6xl space-y-6 pb-20">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight font-headline">Spedizioni & Packing List</h1>
                        <p className="text-muted-foreground">Gestione logistica finale e raggruppamento per cliente.</p>
                    </div>
                    <TabsList className="grid w-full sm:w-[400px] grid-cols-2">
                        <TabsTrigger value="create" className="flex items-center gap-2">
                            <Ship className="h-4 w-4" /> Nuovo
                        </TabsTrigger>
                        <TabsTrigger value="history" className="flex items-center gap-2">
                            <History className="h-4 w-4" /> Storico
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="create" className="space-y-6">
                    {step === 1 && (
                        <Card className="shadow-xl border-t-4 border-t-primary">
                            <CardHeader className="pb-4">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div className="space-y-1">
                                        <CardTitle className="flex items-center gap-2 text-2xl">
                                            <Box className="h-6 w-6 text-primary" />
                                            Commesse Pronte
                                        </CardTitle>
                                        <CardDescription>Seleziona gli ODL da includere nella spedizione odierna.</CardDescription>
                                    </div>
                                    <div className="relative w-full sm:w-64">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            type="search"
                                            placeholder="Cerca ODL, Cliente..."
                                            className="pl-9"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[500px] rounded-md border bg-muted/10">
                                    <div className="p-0">
                                        {filteredJobs.length === 0 ? (
                                            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-4">
                                                <Package className="h-12 w-12 opacity-20" />
                                                <p className="text-lg">Nessun ODL candidabile alla spedizione trovato.</p>
                                            </div>
                                        ) : (
                                            <table className="w-full text-sm">
                                                <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                                                    <tr className="border-b">
                                                        <th className="p-4 text-left w-12"></th>
                                                        <th className="p-4 text-left font-bold text-xs uppercase tracking-wider">Ordine PF</th>
                                                        <th className="p-4 text-left font-bold text-xs uppercase tracking-wider">Cliente</th>
                                                        <th className="p-4 text-left font-bold text-xs uppercase tracking-wider">Articolo</th>
                                                        <th className="p-4 text-right font-bold text-xs uppercase tracking-wider">Quantità</th>
                                                        <th className="p-4 text-left font-bold text-xs uppercase tracking-wider">Posizione</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y bg-card">
                                                    {filteredJobs.map(job => (
                                                        <tr 
                                                            key={job.id} 
                                                            className={cn(
                                                                "hover:bg-primary/5 cursor-pointer transition-colors",
                                                                selectedJobIds.includes(job.id) && "bg-primary/10"
                                                            )}
                                                            onClick={() => toggleJob(job.id)}
                                                        >
                                                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                                <Checkbox 
                                                                    checked={selectedJobIds.includes(job.id)}
                                                                    onCheckedChange={() => toggleJob(job.id)}
                                                                    className="h-5 w-5"
                                                                />
                                                            </td>
                                                            <td className="p-4 font-bold text-primary">{job.ordinePF}</td>
                                                            <td className="p-4 font-medium">{job.cliente}</td>
                                                            <td className="p-4 font-mono text-xs">{job.details}</td>
                                                            <td className="p-4 text-right font-bold text-base">{job.qta}</td>
                                                            <td className="p-4">
                                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                                                                    {job.status}
                                                                </Badge>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                            <CardFooter className="flex justify-between border-t p-6 bg-muted/5">
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl font-black text-primary">{selectedJobIds.length}</span>
                                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Selezionati</span>
                                </div>
                                <Button size="lg" onClick={handleNextToPacking} disabled={selectedJobIds.length === 0 || isProcessing} className="px-8 font-bold h-14 text-lg shadow-lg">
                                    {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <ChevronRight className="mr-2 h-5 w-5"/>}
                                    Configura Packing
                                </Button>
                            </CardFooter>
                        </Card>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-4">
                                <Button variant="ghost" onClick={() => setStep(1)} disabled={isProcessing}><ChevronLeft className="mr-2 h-4 w-4"/> Torna alla Selezione</Button>
                                <h2 className="text-2xl font-bold font-headline">Raggruppamento Spedizione</h2>
                            </div>

                            <div className="space-y-8">
                                {Object.values(packingData).map(clienteGroup => (
                                    <div key={clienteGroup.cliente} className="space-y-4">
                                        <div className="flex items-center gap-3 px-2">
                                            <Building2 className="h-6 w-6 text-primary" />
                                            <h3 className="text-xl font-black uppercase tracking-tight">{clienteGroup.cliente}</h3>
                                        </div>
                                        
                                        {Object.values(clienteGroup.orders).map(order => (
                                            <Card key={order.numeroODL} className="overflow-hidden border-2 border-primary/10 shadow-md">
                                                <div className="bg-primary/5 px-4 py-3 font-bold text-sm flex items-center justify-between border-b">
                                                    <div className="flex items-center gap-2">
                                                        <ListTodo className="h-4 w-4 text-primary" /> 
                                                        Ordine PF: <span className="text-primary">{order.numeroODL}</span>
                                                    </div>
                                                </div>
                                                <CardContent className="p-4 space-y-6">
                                                    {Object.values(order.articles).map(row => (
                                                        <div key={row.articleCode} className="grid grid-cols-1 lg:grid-cols-12 gap-8 bg-card border border-primary/5 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                                                            
                                                            {/* Article Column */}
                                                            <div className="lg:col-span-4 space-y-4">
                                                                <div className="flex flex-col gap-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <Package className="h-6 w-6 text-primary" />
                                                                        <span className="text-xl font-black font-mono tracking-tighter">{row.articleCode}</span>
                                                                    </div>
                                                                    <Badge variant="secondary" className="w-fit text-[10px] px-2 py-0 h-5 font-bold uppercase">{row.packagingType}</Badge>
                                                                </div>

                                                                <div className="p-4 bg-muted/30 rounded-xl border-l-4 border-l-blue-500 text-sm italic relative">
                                                                    <div className="text-[10px] font-bold text-blue-600 uppercase mb-1 flex items-center gap-1">
                                                                        <Info className="h-3 w-3" /> Istruzioni Imballo
                                                                    </div>
                                                                    {row.packingInstructions}
                                                                </div>

                                                                <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground p-1">
                                                                    <Boxes className="h-4 w-4" /> {row.totalQty} pz totali ({row.jobIds.length} commesse)
                                                                </div>
                                                            </div>

                                                            {/* Entry Column */}
                                                            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
                                                                <div className="space-y-3">
                                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Numero Colli</Label>
                                                                    <div className="flex items-center gap-2">
                                                                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { numberOfPackages: Math.max(1, row.numberOfPackages - 1) })}>-</Button>
                                                                        <Input 
                                                                            type="number" 
                                                                            min={1} 
                                                                            value={row.numberOfPackages}
                                                                            onChange={(e) => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { numberOfPackages: parseInt(e.target.value) || 1 })}
                                                                            className="h-12 text-center font-bold text-lg"
                                                                        />
                                                                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { numberOfPackages: row.numberOfPackages + 1 })}>+</Button>
                                                                    </div>
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Peso Teorico (Kg)</Label>
                                                                    <div className="h-12 flex items-center justify-center gap-2 px-3 bg-muted rounded-md font-mono font-bold text-xl text-muted-foreground border border-dashed">
                                                                        <Scale className="h-5 w-5 opacity-50" />
                                                                        {row.theoreticalWeightKg.toFixed(2)}
                                                                    </div>
                                                                    {row.unitWeightKg === 0 && (
                                                                        <p className="text-[9px] text-destructive font-bold flex items-center gap-1">
                                                                            <AlertTriangle className="h-3 w-3" /> DATI PESO MANCANTI
                                                                        </p>
                                                                    )}
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Peso Reale Totale (Kg)</Label>
                                                                    <div className="relative group">
                                                                        <Scale className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                                                                        <Input 
                                                                            type="number" 
                                                                            step="0.01"
                                                                            value={row.actualWeightKg}
                                                                            onChange={(e) => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { actualWeightKg: parseFloat(e.target.value) || 0 })}
                                                                            className="h-12 pl-10 border-2 border-primary ring-offset-primary font-black text-xl text-primary bg-primary/5 focus-visible:ring-primary"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end p-6 bg-card border-t rounded-b-2xl sticky bottom-4 z-20 shadow-2xl backdrop-blur-xl">
                                <Button size="lg" onClick={handleConfirmShipment} disabled={isProcessing} className="bg-green-600 hover:bg-green-700 h-16 px-12 text-2xl font-black shadow-xl transition-all hover:scale-105 active:scale-95 ring-4 ring-green-500/10">
                                    {isProcessing ? <Loader2 className="mr-2 h-8 w-8 animate-spin"/> : <Ship className="mr-2 h-8 w-8"/>}
                                    CHIUDI SPEDIZIONE E GENERA PL
                                </Button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="flex flex-col items-center justify-center space-y-10 py-20 text-center animate-in fade-in zoom-in duration-500">
                            <div className="relative">
                                <div className="absolute inset-0 bg-green-500 blur-3xl opacity-20 animate-pulse rounded-full" />
                                <div className="h-40 w-40 rounded-full bg-green-500 flex items-center justify-center text-white border-8 border-white shadow-2xl relative z-10">
                                    <CheckCircle2 className="h-24 w-24" />
                                </div>
                            </div>
                            
                            <div className="space-y-4 max-w-lg">
                                <h2 className="text-5xl font-black tracking-tighter uppercase font-headline">Spedizione Pronta!</h2>
                                <p className="text-xl text-muted-foreground font-medium">
                                    La Packing List <span className="text-primary font-bold">{lastCreatedPlId}</span> è stata registrata. 
                                    I materiali sono ora marcati come <span className="text-green-600 font-bold italic">SPEDITI</span>.
                                </p>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-4 pt-6">
                                <Button size="lg" variant="outline" onClick={() => window.location.reload()} className="h-14 px-8 border-2 font-bold text-lg">
                                    Nuova Operazione
                                </Button>
                                <Button size="lg" onClick={() => {
                                    // Trova la PL appena creata nel history o passala
                                    toast({ title: "In stampa...", description: "Generazione report in corso." });
                                    // Per semplicità ricarichiamo history e stampiamo l'ultima
                                    loadHistory().then(h => {
                                        const last = (h as PackingList[]).find(x => x.id === lastCreatedPlId);
                                        if (last) generatePackingListPDF(last);
                                    });
                                }} className="h-14 px-10 font-black text-xl bg-primary shadow-lg ring-4 ring-primary/20">
                                    <Printer className="mr-3 h-6 w-6"/> SCARICA PACKING LIST
                                </Button>
                            </div>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="history" className="space-y-6">
                    <Card className="shadow-lg">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="h-6 w-6 text-primary" />
                                Storico Spedizioni
                            </CardTitle>
                            <CardDescription>Visualizza le ultime packing list prodotte e gestisci eventuali rollback.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="p-4 text-left font-bold text-xs uppercase">ID Packing List</th>
                                            <th className="p-4 text-left font-bold text-xs uppercase">Data Creazione</th>
                                            <th className="p-4 text-left font-bold text-xs uppercase">Operatore</th>
                                            <th className="p-4 text-center font-bold text-xs uppercase">Articoli</th>
                                            <th className="p-4 text-center font-bold text-xs uppercase">Stato</th>
                                            <th className="p-4 text-right font-bold text-xs uppercase">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y relative min-h-[200px]">
                                        {isProcessing && history.length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="p-10 text-center text-muted-foreground">
                                                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" /> Caricamento storico...
                                                </td>
                                            </tr>
                                        )}
                                        {history.length === 0 && !isProcessing ? (
                                            <tr>
                                                <td colSpan={6} className="p-12 text-center text-muted-foreground italic">
                                                    Nessun documento in archivio.
                                                </td>
                                            </tr>
                                        ) : (
                                            history.map(pl => (
                                                <tr key={pl.id} className={cn(
                                                    "hover:bg-muted/30 transition-colors",
                                                    pl.status === 'cancelled' && "opacity-60 bg-red-50/10"
                                                )}>
                                                    <td className="p-4">
                                                        <span className="font-black text-primary font-mono">{pl.id}</span>
                                                    </td>
                                                    <td className="p-4 text-muted-foreground">
                                                        {pl.createdAt ? new Date(pl.createdAt.seconds * 1000).toLocaleString('it-IT') : 'N/D'}
                                                    </td>
                                                    <td className="p-4 font-medium">{pl.operatorName}</td>
                                                    <td className="p-4 text-center">
                                                        <Badge variant="secondary">{pl.items.length}</Badge>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {pl.status === 'active' ? (
                                                            <Badge className="bg-green-500 hover:bg-green-600">INVIATA</Badge>
                                                        ) : (
                                                            <Badge variant="destructive">ANNULLATA</Badge>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-right space-x-2">
                                                        {pl.status === 'active' && (
                                                            <>
                                                                <Button variant="outline" size="sm" onClick={() => handleReprint(pl)} className="h-9 w-9 p-0" title="Ristampa PDF">
                                                                    <Printer className="h-4 w-4" />
                                                                </Button>
                                                                <Button variant="ghost" size="sm" onClick={() => handleCancelPL(pl.id)} className="h-9 w-9 p-0 text-destructive hover:text-white hover:bg-destructive" title="Annulla e Ripristina ODL">
                                                                    <XCircle className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {pl.status === 'cancelled' && (
                                                            <span className="text-[10px] uppercase font-black text-destructive mr-2">Rollback Eseguito</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
