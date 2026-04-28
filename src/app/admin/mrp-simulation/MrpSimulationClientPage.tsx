"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calculator, Save, Trash2, ArrowRightLeft, FileSpreadsheet, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
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
    const [selectedArticleCode, setSelectedArticleCode] = useState<string>('');
    const [quantity, setQuantity] = useState<number | ''>('');
    const [deliveryDate, setDeliveryDate] = useState<string>('');
    
    // Drafts State
    const [drafts, setDrafts] = useState<DraftJobOrder[]>(initialDrafts);
    const [isSaving, setIsSaving] = useState(false);
    
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

    const selectedArticle = useMemo(() => {
        return initialArticles.find(a => a.code === selectedArticleCode);
    }, [selectedArticleCode, initialArticles]);

    // Volatile MRP Calculation
    const simulatedBOM = useMemo(() => {
        if (!selectedArticle || !quantity || quantity <= 0 || !deliveryDate) return null;

        // Create a volatile job order
        const volatileJobId = 'VOLATILE-SIMULATION-JOB';
        const volatileJob: JobOrder = {
            id: volatileJobId,
            status: 'planned',
            cliente: 'SIMULAZIONE',
            qta: Number(quantity),
            department: 'N/D',
            details: selectedArticle.code,
            ordinePF: volatileJobId,
            numeroODL: 'SIM-001',
            dataConsegnaFinale: deliveryDate,
            dataFinePreparazione: deliveryDate,
            postazioneLavoro: 'N/D',
            phases: [],
            billOfMaterials: selectedArticle.billOfMaterials.map(b => ({ ...b, status: 'pending', isFromTemplate: true }))
        };

        // Combine with all other jobs
        // The user asked to IGNORE drafts from allJobs. They are already ignored since they are in a different collection.
        const jobsWithSimulation = [...allJobs, volatileJob];

        const timelines = calculateMRPTimelines(jobsWithSimulation, initialMaterials, purchaseOrders, manualCommitments, initialArticles, globalSettings);
        
        // Extract only the timeline entries belonging to our volatile job
        const componentEntries: { entry: MRPTimelineEntry; item: any }[] = [];
        
        selectedArticle.billOfMaterials.forEach(item => {
            const matCode = item.component.toUpperCase().trim();
            const matTimeline = timelines.get(matCode) || [];
            // Find the entry that corresponds to our volatile job
            const entryForSim = matTimeline.find(t => t.jobId === volatileJobId);
            
            if (entryForSim) {
                componentEntries.push({ entry: entryForSim, item });
            } else {
                // If not found in timeline, it might mean the material is not in rawMaterials or has no demand. 
                // We fallback to a generic missing state.
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

        return aggregateMRPRequirements(componentEntries);
    }, [selectedArticle, quantity, deliveryDate, allJobs, initialMaterials, purchaseOrders, manualCommitments, initialArticles, globalSettings]);

    const handleSaveDraft = async () => {
        if (!selectedArticleCode || !quantity || !deliveryDate) return;
        setIsSaving(true);
        try {
            const res = await saveDraft({
                articleCode: selectedArticleCode,
                quantity: Number(quantity),
                deliveryDate: deliveryDate
            });
            if (res.success) {
                toast({ title: 'Successo', description: res.message });
                // Reset form
                setSelectedArticleCode('');
                setQuantity('');
                setDeliveryDate('');
                // Refresh drafts
                const freshDrafts = await getDrafts();
                setDrafts(freshDrafts);
            } else {
                toast({ variant: 'destructive', title: 'Errore', description: res.message });
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile salvare la bozza.' });
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

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'RED': return <AlertTriangle className="h-5 w-5 text-destructive" />;
            case 'LATE': return <Clock className="h-5 w-5 text-orange-500" />;
            case 'AMBER': return <CheckCircle2 className="h-5 w-5 text-yellow-500" />;
            case 'GREEN': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
            default: return null;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'RED': return <Badge variant="destructive">Mancante</Badge>;
            case 'LATE': return <Badge variant="outline" className="border-orange-500 text-orange-600">In Ritardo</Badge>;
            case 'AMBER': return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Coperto (In Arrivo)</Badge>;
            case 'GREEN': return <Badge className="bg-green-500 hover:bg-green-600">Disponibile</Badge>;
            default: return <Badge variant="secondary">Sconosciuto</Badge>;
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
                    Verifica rapidamente la fattibilità di un articolo prima di inserirlo in produzione, e salvalo come bozza.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Pannello Simulazione (2/3 larghezza su lg) */}
                <Card className="lg:col-span-2 shadow-sm">
                    <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="flex items-center gap-2">
                            <FileSpreadsheet className="h-5 w-5" /> Inserimento Rapido
                        </CardTitle>
                        <CardDescription>Seleziona un articolo, indica quantità e data per simulare il fabbisogno materiali.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="article">Codice Articolo</Label>
                                <Select value={selectedArticleCode} onValueChange={setSelectedArticleCode}>
                                    <SelectTrigger id="article" className="font-mono">
                                        <SelectValue placeholder="Seleziona..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {validArticles.map(a => (
                                            <SelectItem key={a.code} value={a.code} className="font-mono">
                                                {a.code}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="quantity">Quantità</Label>
                                <Input 
                                    id="quantity" 
                                    type="number" 
                                    min="1" 
                                    placeholder="Es. 5000" 
                                    value={quantity} 
                                    onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="date">Data Consegna Prevista</Label>
                                <Input 
                                    id="date" 
                                    type="date" 
                                    value={deliveryDate} 
                                    onChange={(e) => setDeliveryDate(e.target.value)} 
                                />
                            </div>
                        </div>

                        {simulatedBOM && simulatedBOM.length > 0 && (
                            <div className="mt-8 border rounded-md overflow-hidden shadow-sm">
                                <div className="bg-accent/50 p-3 font-semibold text-sm border-b">
                                    Analisi di Fattibilità (Distinta Base)
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
                    <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Save className="h-5 w-5" /> Bozze Salvate ({drafts.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {drafts.length > 0 ? (
                            <div className="divide-y">
                                {drafts.map(draft => (
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
                                Nessuna bozza salvata al momento.
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
                            <Label htmlFor="customJobId">Numero Commessa / ODL (Opzionale)</Label>
                            <Input 
                                id="customJobId" 
                                placeholder="Es. 185/PF o lascia vuoto..." 
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
