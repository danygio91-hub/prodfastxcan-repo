"use client";

import React, { useState, useMemo, useRef } from 'react';
import { JobOrder, Article } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    Package, Ship, CheckCircle2, ChevronRight, 
    ChevronLeft, Scale, Printer, Loader2, Info, AlertTriangle, Boxes,
    Building2, ListTodo, Box
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { confirmPackingAndShip, getArticlesByCodes } from './actions';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [articles, setArticles] = useState<Record<string, Article>>({});
    const [packingData, setPackingData] = useState<Record<string, ClienteGroup>>({});
    
    // PDF Ref
    const pdfRef = useRef<HTMLDivElement>(null);

    // Step 1: Selection
    const toggleJob = (id: string) => {
        setSelectedJobIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

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
            fetchedArticles.forEach(a => { articlesMap[a.code.toUpperCase()] = a; });
            setArticles(articlesMap);

            // Grouping Logic
            const groups: Record<string, ClienteGroup> = {};
            
            selectedJobs.forEach(job => {
                const cliente = job.cliente || "Cliente Sconosciuto";
                const orderNum = job.numeroODL || "Ordine N/D";
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
                        description: artCode, // Placeholder
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
                row.actualWeightKg = Number(row.theoreticalWeightKg.toFixed(2)); // Default to theoretical
            });

            setPackingData(groups);
            setStep(2);
        } catch (error) {
            toast({ title: "Errore", description: "Impossibile caricare i dati degli articoli.", variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    };

    // Update Weight Logic
    const updateRow = (cliente: string, order: string, artCode: string, fields: Partial<PackingRow>) => {
        setPackingData(prev => {
            const newGroups = { ...prev };
            const row = newGroups[cliente].orders[order].articles[artCode];
            Object.assign(row, fields);
            
            // Recalculate theoretical if colli or qty changed (qty shouldn't change here but for safety)
            row.theoreticalWeightKg = (row.totalQty * row.unitWeightKg) + (row.numberOfPackages * row.packagingTareWeightKg);
            
            return newGroups;
        });
    };

    const handleConfirmShipment = async () => {
        setIsProcessing(true);
        const flatData: { jobId: string, actualWeightKg: number, numberOfPackages: number }[] = [];
        
        Object.values(packingData).forEach(c => {
            Object.values(c.orders).forEach(o => {
                Object.values(o.articles).forEach(row => {
                    // Distribuiamo il peso reale proporzionalmente alle commesse (o semplicemente lo salviamo su tutte)
                    // Il requisito dice "salvare il peso reale confermato". 
                    // Se più commesse sono raggruppate, salviamo il peso totale e il numero colli su ciascuna?
                    // Probabilmente è meglio salvare il peso reale raggruppato.
                    row.jobIds.forEach(id => {
                        flatData.push({ 
                            jobId: id, 
                            actualWeightKg: row.actualWeightKg, 
                            numberOfPackages: row.numberOfPackages 
                        });
                    });
                });
            });
        });

        const result = await confirmPackingAndShip(flatData);
        if (result.success) {
            setStep(3);
            toast({ title: "Successo", description: result.message });
        } else {
            toast({ title: "Errore", description: result.message, variant: "destructive" });
        }
        setIsProcessing(false);
    };

    const downloadPDF = async () => {
        if (!pdfRef.current) return;
        setIsProcessing(true);
        try {
            const canvas = await html2canvas(pdfRef.current, { scale: 2 });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`PackingList_${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            toast({ title: "Errore", description: "Generazione PDF fallita.", variant: "destructive" });
        }
        setIsProcessing(false);
    };

    return (
        <div className="container mx-auto p-4 max-w-5xl space-y-6 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Packing List & Spedizioni</h1>
                    <p className="text-muted-foreground">Gestione "Ultimo Miglio" e spedizione materiali ai clienti.</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant={step === 1 ? "default" : "outline"} className="px-3 py-1">1. Selezione</Badge>
                    <Badge variant={step === 2 ? "default" : "outline"} className="px-3 py-1">2. Imballo</Badge>
                    <Badge variant={step === 3 ? "default" : "outline"} className="px-3 py-1">3. Inviato</Badge>
                </div>
            </div>

            {step === 1 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Box className="h-5 w-5 text-primary" />
                            Commesse Pronte per Spedizione
                        </CardTitle>
                        <CardDescription>Seleziona le commesse completate che vuoi inserire nella Packing List.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-[500px] border rounded-md">
                            <div className="p-0">
                                {initialJobs.length === 0 ? (
                                    <div className="p-8 text-center text-muted-foreground">
                                        Nessuna commessa completata trovata.
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted sticky top-0 z-10">
                                            <tr>
                                                <th className="p-3 text-left w-10"></th>
                                                <th className="p-3 text-left">Commessa</th>
                                                <th className="p-3 text-left">Cliente</th>
                                                <th className="p-3 text-left">Articolo</th>
                                                <th className="p-3 text-right">Q.tà</th>
                                                <th className="p-3 text-left">Data Fine</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {initialJobs.map(job => (
                                                <tr key={job.id} className="hover:bg-accent/50 cursor-pointer" onClick={() => toggleJob(job.id)}>
                                                    <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <Checkbox 
                                                            checked={selectedJobIds.includes(job.id)}
                                                            onCheckedChange={() => toggleJob(job.id)}
                                                        />
                                                    </td>
                                                    <td className="p-3 font-bold">{job.ordinePF}</td>
                                                    <td className="p-3">{job.cliente}</td>
                                                    <td className="p-3 font-mono">{job.details}</td>
                                                    <td className="p-3 text-right">{job.qta}</td>
                                                    <td className="p-3 text-muted-foreground text-xs">
                                                        {job.overallEndTime ? new Date(job.overallEndTime).toLocaleDateString() : 'N/D'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                    <CardFooter className="flex justify-between border-t p-4">
                        <p className="text-sm font-medium">{selectedJobIds.length} commesse selezionate</p>
                        <Button onClick={handleNextToPacking} disabled={selectedJobIds.length === 0 || isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ChevronRight className="mr-2 h-4 w-4"/>}
                            Genera Packing List
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {step === 2 && (
                <div className="space-y-6">
                    <div className="flex items-center gap-4">
                        <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="mr-2 h-4 w-4"/> Indietro</Button>
                        <h2 className="text-xl font-bold">Raggruppamento e Verifica Pesi</h2>
                    </div>

                    {Object.values(packingData).map(clienteGroup => (
                        <Card key={clienteGroup.cliente} className="border-l-4 border-l-primary">
                            <CardHeader className="bg-muted/30">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-primary" />
                                    Cliente: {clienteGroup.cliente}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {Object.values(clienteGroup.orders).map(order => (
                                    <div key={order.numeroODL} className="border-b last:border-0">
                                        <div className="bg-accent/20 px-4 py-2 font-semibold text-sm flex items-center gap-2 border-b">
                                            <ListTodo className="h-4 w-4" /> Ordine Cliente: {order.numeroODL}
                                        </div>
                                        <div className="p-4 space-y-6">
                                            {Object.values(order.articles).map(row => (
                                                <div key={row.articleCode} className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-background border p-4 rounded-xl shadow-sm relative overflow-hidden">
                                                    
                                                    {/* Badge Decorativo Tipo Imballo */}
                                                    <div className="absolute top-0 right-0">
                                                        <Badge variant="secondary" className="rounded-none rounded-bl-lg text-[10px] uppercase font-bold">
                                                            {row.packagingType}
                                                        </Badge>
                                                    </div>

                                                    {/* Info Articolo */}
                                                    <div className="md:col-span-4 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Package className="h-5 w-5 text-blue-500" />
                                                            <span className="text-lg font-bold font-mono">{row.articleCode}</span>
                                                        </div>
                                                        <div className="text-sm text-muted-foreground p-3 bg-muted rounded-lg border-2 border-dashed border-blue-200/50 italic">
                                                            <div className="font-bold text-blue-600 text-[10px] uppercase mb-1">📦 Istruzioni Imballo:</div>
                                                            {row.packingInstructions}
                                                        </div>
                                                        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 p-2 rounded text-xs font-bold">
                                                            <Info className="h-3 w-3" />
                                                            {row.totalQty} pezzi totali
                                                            <Separator orientation="vertical" className="h-4 mx-1" />
                                                            {row.jobIds.length} Commesse
                                                        </div>
                                                    </div>

                                                    {/* Configurazione Colli e Pesi */}
                                                    <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                                                        {/* Numero Colli */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Num. Colli</Label>
                                                            <div className="flex items-center gap-2">
                                                                <Boxes className="h-4 w-4 text-muted-foreground" />
                                                                <Input 
                                                                    type="number" 
                                                                    min={1} 
                                                                    value={row.numberOfPackages}
                                                                    onChange={(e) => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { numberOfPackages: parseInt(e.target.value) || 1 })}
                                                                    className="h-10 text-center font-bold"
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* Peso Teorico */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Peso Teorico (Kg)</Label>
                                                            <div className="h-10 flex items-center gap-2 px-3 bg-muted rounded-md font-mono font-bold text-muted-foreground border">
                                                                <Scale className="h-4 w-4" />
                                                                {row.theoreticalWeightKg.toFixed(2)}
                                                            </div>
                                                            {row.unitWeightKg === 0 && (
                                                                <p className="text-[10px] text-destructive flex items-center gap-1">
                                                                    <AlertTriangle className="h-3 w-3" /> Dati peso mancanti!
                                                                </p>
                                                            )}
                                                        </div>

                                                        {/* Peso Reale */}
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold uppercase tracking-wider text-blue-600">Peso Reale Totale (Kg)</Label>
                                                            <div className="flex items-center gap-2">
                                                                <Scale className="h-4 w-4 text-blue-600" />
                                                                <Input 
                                                                    type="number" 
                                                                    step="0.01"
                                                                    value={row.actualWeightKg}
                                                                    onChange={(e) => updateRow(clienteGroup.cliente, order.numeroODL, row.articleCode, { actualWeightKg: parseFloat(e.target.value) || 0 })}
                                                                    className="h-10 border-blue-500 font-bold text-blue-700 bg-blue-50/50"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}

                    <div className="flex justify-end p-4 bg-muted/20 border rounded-lg sticky bottom-4 z-20 backdrop-blur-md">
                        <Button size="lg" onClick={handleConfirmShipment} disabled={isProcessing} className="bg-green-600 hover:bg-green-700 h-14 px-10 text-xl shadow-lg ring-2 ring-green-500/20">
                            {isProcessing ? <Loader2 className="mr-2 h-6 w-6 animate-spin"/> : <Ship className="mr-2 h-6 w-6"/>}
                            Conferma Spedizione e Chiudi
                        </Button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="flex flex-col items-center justify-center space-y-8 py-20">
                    <div className="h-32 w-32 rounded-full bg-green-100 flex items-center justify-center text-green-600 border-4 border-green-500 animate-bounce">
                        <CheckCircle2 className="h-20 w-20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-4xl font-extrabold">Spedizione Confermata!</h2>
                        <p className="text-xl text-muted-foreground">Le commesse sono state rimosse dal WIP e segnate come spedite.</p>
                    </div>

                    <div className="flex gap-4">
                        <Button size="lg" variant="outline" onClick={() => window.location.reload()}>
                            Nuova Spedizione
                        </Button>
                        <Button size="lg" onClick={downloadPDF} disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
                            Scarica PDF Packing List
                        </Button>
                    </div>

                    {/* Hidden PDF Template */}
                    <div className="hidden">
                        <div ref={pdfRef} style={{ width: '210mm', padding: '15mm', backgroundColor: 'white', color: 'black', fontFamily: 'sans-serif' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid black', paddingBottom: '5mm', marginBottom: '10mm' }}>
                                <div style={{ fontSize: '24pt', fontWeight: 'bold' }}>PACKING LIST</div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold' }}>DATA: {new Date().toLocaleDateString('it-IT')}</div>
                                    <div>PRODFAST XCAN MES</div>
                                </div>
                            </div>
                            
                            {Object.values(packingData).map(cliente => (
                                <div key={cliente.cliente} style={{ marginBottom: '8mm' }}>
                                    <div style={{ backgroundColor: '#f3f4f6', padding: '3mm', fontWeight: 'bold', fontSize: '14pt', border: '1px solid #ccc', marginBottom: '4mm' }}>
                                        CLIENTE: {cliente.cliente}
                                    </div>
                                    {Object.values(cliente.orders).map(order => (
                                        <div key={order.numeroODL} style={{ marginLeft: '5mm', marginBottom: '6mm' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '11pt', borderBottom: '1px solid #eee', marginBottom: '2mm', color: '#4b5563' }}>
                                                ORDINE CLIENTE: {order.numeroODL}
                                            </div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
                                                        <th style={{ padding: '2mm' }}>Articolo</th>
                                                        <th style={{ padding: '2mm' }}>Quantità</th>
                                                        <th style={{ padding: '2mm' }}>Imballo</th>
                                                        <th style={{ padding: '2mm' }}>Colli</th>
                                                        <th style={{ padding: '2mm', textAlign: 'right' }}>Peso Totale (Kg)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {Object.values(order.articles).map(row => (
                                                        <tr key={row.articleCode} style={{ borderBottom: '1px solid #eee' }}>
                                                            <td style={{ padding: '2mm', fontWeight: 'bold' }}>{row.articleCode}</td>
                                                            <td style={{ padding: '2mm' }}>{row.totalQty} pezzi</td>
                                                            <td style={{ padding: '2mm' }}>{row.packagingType}</td>
                                                            <td style={{ padding: '2mm' }}>{row.numberOfPackages}</td>
                                                            <td style={{ padding: '2mm', textAlign: 'right', fontWeight: 'bold' }}>{row.actualWeightKg.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}
                                </div>
                            ))}

                            <div style={{ marginTop: '20mm', borderTop: '2px solid black', paddingTop: '5mm', textAlign: 'center', fontSize: '8pt', color: '#666' }}>
                                Documento generato automaticamente dal sistema MES. Controllo qualità ed integrità colli effettuato in fase di imballaggio.
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
