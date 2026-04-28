"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calculator, Save, Trash2, ArrowRightLeft, FileSpreadsheet, AlertTriangle, CheckCircle2, Clock, Plus, Search } from 'lucide-react';
import { Article, RawMaterial, JobOrder, PurchaseOrder, ManualCommitment, DraftJobOrder } from '@/types';
import { GlobalSettings } from '@/lib/settings-types';
import { calculateMRPTimelines, aggregateMRPRequirements, MRPTimelineEntry } from '@/lib/mrp-utils';
import { saveDraft, getDrafts, deleteDraft, convertDraftToJobOrder } from './actions';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

interface MrpSimulationClientPageProps {
    initialArticles: Article[];
    initialMaterials: RawMaterial[];
    allJobs: JobOrder[];
    purchaseOrders: PurchaseOrder[];
    manualCommitments: ManualCommitment[];
    globalSettings: GlobalSettings | null;
    initialDrafts: DraftJobOrder[];
}

interface SimulationRow {
    id: string;
    articleCode: string;
    quantity: number | '';
    deliveryDate: string;
}

export default function MrpSimulationClientPage({
    initialArticles,
    initialMaterials,
    allJobs,
    purchaseOrders,
    manualCommitments,
    globalSettings,
    initialDrafts
}: MrpSimulationClientPageProps) {
    const { toast } = useToast();
    
    // Rapid Input State
    const [rows, setRows] = useState<SimulationRow[]>([{ id: crypto.randomUUID(), articleCode: '', quantity: '', deliveryDate: '' }]);
    
    // Drafts State
    const [drafts, setDrafts] = useState<DraftJobOrder[]>(initialDrafts);
    const [isSaving, setIsSaving] = useState(false);
    const [draftSearchTerm, setDraftSearchTerm] = useState('');
    
    // Conversion State
    const [draftToConvert, setDraftToConvert] = useState<DraftJobOrder | null>(null);
    const [customJobId, setCustomJobId] = useState<string>('');
    const [isConverting, setIsConverting] = useState(false);

    // Filter valid articles
    const validArticles = useMemo(() => {
        return initialArticles
            .filter(a => a.code && a.billOfMaterials && a.billOfMaterials.length > 0)
            .sort((a, b) => a.code.localeCompare(b.code));
    }, [initialArticles]);

    const addRow = () => {
        setRows([...rows, { id: crypto.randomUUID(), articleCode: '', quantity: '', deliveryDate: '' }]);
    };

    const removeRow = (id: string) => {
        setRows(rows.filter(r => r.id !== id));
    };

    const updateRow = (id: string, field: keyof SimulationRow, value: string | number) => {
        setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    // Volatile MRP Calculation
    const simulatedBOM = useMemo(() => {
        const validRows = rows.filter(r => r.articleCode && validArticles.some(a => a.code === r.articleCode) && r.quantity && Number(r.quantity) > 0 && r.deliveryDate);
        if (validRows.length === 0) return null;

        const volatileJobs: JobOrder[] = [];
        const componentEntries: { entry: MRPTimelineEntry; item: any }[] = [];

        validRows.forEach((row, index) => {
            const article = validArticles.find(a => a.code === row.articleCode);
            if (!article) return;

            const volatileJobId = `VOLATILE-SIMULATION-JOB-${index}`;
            volatileJobs.push({
                id: volatileJobId,
                status: 'planned',
                cliente: 'SIMULAZIONE',
                qta: Number(row.quantity),
                department: 'N/D',
                details: article.code,
                ordinePF: volatileJobId,
                numeroODL: `SIM-${index}`,
                dataConsegnaFinale: row.deliveryDate,
                dataFinePreparazione: row.deliveryDate,
                postazioneLavoro: 'N/D',
                phases: [],
                billOfMaterials: article.billOfMaterials.map(b => ({ ...b, status: 'pending', isFromTemplate: true }))
            });
        });

        const jobsWithSimulation = [...allJobs, ...volatileJobs];
        const timelines = calculateMRPTimelines(jobsWithSimulation, initialMaterials, purchaseOrders, manualCommitments, initialArticles, globalSettings);
        
        validRows.forEach((row, index) => {
             const article = validArticles.find(a => a.code === row.articleCode);
             if (!article) return;
             const volatileJobId = `VOLATILE-SIMULATION-JOB-${index}`;

             article.billOfMaterials.forEach(item => {
                const matCode = item.component.toUpperCase().trim();
                const matTimeline = timelines.get(matCode) || [];
                const entryForSim = matTimeline.find(t => t.jobId === volatileJobId);
                
                if (entryForSim) {
                    componentEntries.push({ entry: entryForSim, item });
                } else {
                    componentEntries.push({
                        entry: {
                            jobId: volatileJobId,
                            materialCode: matCode,
                            requiredQty: 0,
                            status: 'RED',
                            projectedBalance: 0,
                            details: ['Materiale non trovato in anagrafica.']
                        },
                        item
                    });
                }
            });
        });

        return aggregateMRPRequirements(componentEntries);
    }, [rows, validArticles, allJobs, initialMaterials, purchaseOrders, manualCommitments, initialArticles, globalSettings]);

    const handleSaveDraft = async () => {
        const validRows = rows.filter(r => r.articleCode && validArticles.some(a => a.code === r.articleCode) && r.quantity && Number(r.quantity) > 0 && r.deliveryDate);
        if (validRows.length === 0) return;
        
        setIsSaving(true);
        try {
            let successCount = 0;
            for (const row of validRows) {
                const res = await saveDraft({
                    articleCode: row.articleCode,
                    quantity: Number(row.quantity),
                    deliveryDate: row.deliveryDate
                });
                if (res.success) successCount++;
            }
            
            if (successCount > 0) {
                toast({ title: 'Successo', description: `Salvate ${successCount} bozze con successo.` });
                setRows([{ id: crypto.randomUUID(), articleCode: '', quantity: '', deliveryDate: '' }]);
                const freshDrafts = await getDrafts();
                setDrafts(freshDrafts);
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile salvare alcune bozze.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteDraft = async (id: string) => {
        const res = await deleteDraft(id);
        if (res.success) {
            toast({ title: 'Eliminata', description: res.message });
            setDrafts(drafts.filter(d => d.id !== id));
        } else {
            toast({ variant: 'destructive', title: 'Errore', description: res.message });
        }
    };

    const handleConvertSubmit = async () => {
        if (!draftToConvert) return;
        setIsConverting(true);
        try {
            const res = await convertDraftToJobOrder(draftToConvert.id, customJobId);
            if (res.success) {
                toast({ title: 'Commessa Generata', description: res.message });
                setDraftToConvert(null);
                setCustomJobId('');
                const freshDrafts = await getDrafts();
                setDrafts(freshDrafts);
            } else {
                toast({ variant: 'destructive', title: 'Errore', description: res.message });
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile convertire la bozza.' });
        } finally {
            setIsConverting(false);
        }
    };

    const filteredDrafts = useMemo(() => {
        if (!draftSearchTerm) return drafts;
        const lowerSearch = draftSearchTerm.toLowerCase();
        return drafts.filter(d => d.articleCode.toLowerCase().includes(lowerSearch));
    }, [drafts, draftSearchTerm]);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'RED': return <AlertTriangle className="h-5 w-5 text-destructive" />;
            case 'LATE': return <Clock className="h-5 w-5 text-orange-500" />;
            case 'AMBER': return <CheckCircle2 className="h-5 w-5 text-yellow-500" />;
            case 'GREEN': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
            default: return null;
        }
    };

    return (
        <div className="space-y-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Calculator className="h-8 w-8 text-primary" />
                    Simulatore MRP e Bozze
                </h1>
                <p className="text-muted-foreground">
                    Verifica rapidamente la fattibilità di uno o più articoli prima di inserirli in produzione, e salvali come bozze.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Pannello Simulazione (2/3 larghezza su lg) */}
                <Card className="lg:col-span-2 shadow-sm">
                    <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="flex items-center gap-2">
                            <FileSpreadsheet className="h-5 w-5" /> Inserimento Rapido Multi-Riga
                        </CardTitle>
                        <CardDescription>Inserisci i codici articolo, le quantità e le date per simulare il fabbisogno materiali globale.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        
                        <datalist id="articles-list">
                            {validArticles.map(a => (
                                <option key={a.code} value={a.code} />
                            ))}
                        </datalist>

                        <div className="space-y-3">
                            {rows.map((row, index) => {
                                const isValid = validArticles.some(a => a.code === row.articleCode);
                                return (
                                    <div key={row.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-accent/20 p-3 rounded-md border border-border/50">
                                        <div className="space-y-1 md:col-span-5 relative">
                                            {index === 0 && <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Codice Articolo</Label>}
                                            <div className="relative">
                                                <Input 
                                                    list="articles-list"
                                                    placeholder="Digita codice..." 
                                                    value={row.articleCode} 
                                                    onChange={(e) => updateRow(row.id, 'articleCode', e.target.value.toUpperCase())}
                                                    className={isValid ? 'border-green-500 ring-green-500 focus-visible:ring-green-500 font-mono pr-10' : 'font-mono'}
                                                />
                                                {isValid && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />}
                                            </div>
                                        </div>
                                        <div className="space-y-1 md:col-span-3">
                                            {index === 0 && <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quantità</Label>}
                                            <Input 
                                                type="number" 
                                                min="1" 
                                                placeholder="Es. 5000" 
                                                value={row.quantity} 
                                                onChange={(e) => updateRow(row.id, 'quantity', e.target.value ? Number(e.target.value) : '')} 
                                            />
                                        </div>
                                        <div className="space-y-1 md:col-span-3">
                                            {index === 0 && <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Consegna Prevista</Label>}
                                            <Input 
                                                type="date" 
                                                value={row.deliveryDate} 
                                                onChange={(e) => updateRow(row.id, 'deliveryDate', e.target.value)} 
                                            />
                                        </div>
                                        <div className="md:col-span-1 pb-1 flex justify-center">
                                            {rows.length > 1 ? (
                                                <Button variant="ghost" size="icon" onClick={() => removeRow(row.id)} className="text-destructive h-9 w-9" title="Rimuovi Riga">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            ) : (
                                                <div className="h-9 w-9"></div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <Button variant="outline" size="sm" onClick={addRow} className="gap-2 mt-2 w-full md:w-auto border-dashed">
                                <Plus className="h-4 w-4" /> Aggiungi Riga
                            </Button>
                        </div>

                        {simulatedBOM && simulatedBOM.length > 0 && (
                            <div className="mt-8 border rounded-md overflow-hidden shadow-sm">
                                <div className="bg-accent/50 p-3 font-semibold text-sm border-b">
                                    Analisi di Fattibilità Globale (Distinta Base Aggregata)
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10 text-center">Stato</TableHead>
                                            <TableHead>Materiale</TableHead>
                                            <TableHead className="w-1/2">Dettagli Fabbisogno</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {simulatedBOM.map((b, i) => (
                                            <TableRow key={`${b.entry.materialCode}-${i}`}>
                                                <TableCell className="text-center">
                                                    {getStatusIcon(b.entry.status)}
                                                </TableCell>
                                                <TableCell className="font-mono font-medium">
                                                    {b.entry.materialCode}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 text-sm">
                                                        {b.entry.details.map((detailLine, idx) => (
                                                            <span 
                                                                key={idx} 
                                                                className={
                                                                    idx === 0 ? "font-semibold" : 
                                                                    detailLine.includes('❌') ? "text-destructive font-semibold" : 
                                                                    detailLine.includes('🟠') ? "text-orange-600" : 
                                                                    detailLine.includes('🟡') ? "text-yellow-600" : 
                                                                    "text-muted-foreground"
                                                                }
                                                            >
                                                                {detailLine}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <Button 
                                onClick={handleSaveDraft} 
                                disabled={!simulatedBOM || isSaving}
                                className="gap-2"
                            >
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Salva come Bozza
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Pannello Bozze Salvate (1/3 larghezza su lg) */}
                <Card className="shadow-sm">
                    <CardHeader className="bg-muted/30 border-b flex flex-col gap-4">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Save className="h-5 w-5" /> Bozze Salvate ({drafts.length})
                        </CardTitle>
                        <div className="relative w-full">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Cerca codice articolo..." 
                                className="pl-8 h-9 text-sm" 
                                value={draftSearchTerm}
                                onChange={(e) => setDraftSearchTerm(e.target.value)}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredDrafts.length > 0 ? (
                            <div className="divide-y max-h-[600px] overflow-y-auto">
                                {filteredDrafts.map(draft => (
                                    <div key={draft.id} className="p-4 flex flex-col gap-3 hover:bg-accent/30 transition-colors">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="font-bold font-mono text-lg">{draft.articleCode}</p>
                                                <p className="text-sm text-muted-foreground">Qta: <span className="font-medium text-foreground">{draft.quantity}</span></p>
                                                <p className="text-sm text-muted-foreground">Consegna: <span className="font-medium text-foreground">{format(parseISO(draft.deliveryDate), 'dd/MM/yyyy', { locale: it })}</span></p>
                                            </div>
                                            <Badge variant="secondary" className="text-[10px]">BOZZA</Badge>
                                        </div>
                                        <div className="flex justify-end gap-2 mt-2">
                                            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDeleteDraft(draft.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                            <Button variant="default" size="sm" className="gap-1 h-8" onClick={() => setDraftToConvert(draft)}>
                                                <ArrowRightLeft className="h-3 w-3" /> Converti
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground">
                                {drafts.length === 0 ? 'Nessuna bozza salvata al momento.' : 'Nessuna bozza corrisponde alla ricerca.'}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Dialog di Conversione */}
            <Dialog open={!!draftToConvert} onOpenChange={(open) => !open && setDraftToConvert(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Converti Bozza in Commessa Reale</DialogTitle>
                        <DialogDescription>
                            Stai per convertire la bozza dell'articolo <strong>{draftToConvert?.articleCode}</strong> in una commessa. Inserisci il numero commessa desiderato oppure lascia vuoto per generare un ID automatico (formato SIM-YYYYMMDD-XXXX).
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="customJobId">Numero Commessa (Ordine PF)</Label>
                            <Input 
                                id="customJobId" 
                                placeholder="Es. 185/PF o lascia vuoto per autogenerare..." 
                                value={customJobId} 
                                onChange={(e) => setCustomJobId(e.target.value)} 
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Annulla</Button>
                        </DialogClose>
                        <Button onClick={handleConvertSubmit} disabled={isConverting} className="gap-2">
                            {isConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                            Converti Ora
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}
