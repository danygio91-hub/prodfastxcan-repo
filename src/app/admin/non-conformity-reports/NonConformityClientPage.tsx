
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { ShieldAlert, Loader2, Warehouse, AlertCircle, PackageCheck, Undo2, Trash2, ShieldCheck, ShieldX } from 'lucide-react';
import { approveNonConformity, confirmReturn, deleteIncomingNonConformityReports, deleteProductionProblemReports } from './actions';
import type { NonConformityReport, ProductionProblemReport } from '@/lib/mock-data';

interface NonConformityClientPageProps {
  initialIncomingReports: NonConformityReport[];
  initialProductionReports: ProductionProblemReport[];
}

export default function NonConformityClientPage({ initialIncomingReports, initialProductionReports }: NonConformityClientPageProps) {
    const [incomingReports, setIncomingReports] = useState<NonConformityReport[]>(initialIncomingReports);
    const [productionReports, setProductionReports] = useState<ProductionProblemReport[]>(initialProductionReports);
    const [isPending, setIsPending] = useState(false);
    const [selectedIncomingRows, setSelectedIncomingRows] = useState<string[]>([]);
    const [selectedProductionRows, setSelectedProductionRows] = useState<string[]>([]);

    const { toast } = useToast();
    const router = useRouter();

    const refreshData = () => {
      router.refresh();
    };

    useEffect(() => {
        setIncomingReports(initialIncomingReports);
        setProductionReports(initialProductionReports);
    }, [initialIncomingReports, initialProductionReports]);

    const handleApprove = async (reportId: string) => {
        setIsPending(true);
        const result = await approveNonConformity(reportId);
        toast({
            title: result.success ? "Operazione Completata" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            refreshData();
        }
        setIsPending(false);
    };

    const handleConfirmReturn = async (reportId: string) => {
        setIsPending(true);
        const result = await confirmReturn(reportId);
         toast({
            title: result.success ? "Operazione Completata" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            refreshData();
        }
        setIsPending(false);
    };
    
    const handleDeleteIncomingSelected = async () => {
        setIsPending(true);
        const result = await deleteIncomingNonConformityReports(selectedIncomingRows);
        toast({
            title: result.success ? "Operazione Completata" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            setSelectedIncomingRows([]);
            refreshData();
        }
        setIsPending(false);
    }
    
    const handleDeleteProductionSelected = async () => {
        setIsPending(true);
        const result = await deleteProductionProblemReports(selectedProductionRows);
        toast({
            title: result.success ? "Operazione Completata" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
            setSelectedProductionRows([]);
            refreshData();
        }
        setIsPending(false);
    }

    const handleSelectAllIncoming = (checked: boolean | 'indeterminate') => {
        setSelectedIncomingRows(checked === true ? incomingReports.map(r => r.id) : []);
    };
    
    const handleSelectIncomingRow = (id: string) => {
        setSelectedIncomingRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
    };
    
     const handleSelectAllProduction = (checked: boolean | 'indeterminate') => {
        setSelectedProductionRows(checked === true ? productionReports.map(r => r.id) : []);
    };
    
    const handleSelectProductionRow = (id: string) => {
        setSelectedProductionRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
    };

    const renderIncomingReports = () => (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <CardTitle>Segnalazioni da Carico Merce</CardTitle>
                        <CardDescription>Elenco delle non conformità segnalate. Gestisci ogni segnalazione per procedere.</CardDescription>
                    </div>
                     {selectedIncomingRows.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isPending}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Elimina Selezionate ({selectedIncomingRows.length})
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei sicuro di voler eliminare?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Stai per eliminare {selectedIncomingRows.length} segnalazioni. Questa operazione è irreversibile.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeleteIncomingSelected} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead padding="checkbox">
                                    <Checkbox
                                        checked={selectedIncomingRows.length > 0 ? (selectedIncomingRows.length === incomingReports.length ? true : 'indeterminate') : false}
                                        onCheckedChange={handleSelectAllIncoming}
                                        aria-label="Seleziona tutte"
                                    />
                                </TableHead>
                                <TableHead>Data</TableHead>
                                <TableHead>Stato</TableHead>
                                <TableHead>Materiale</TableHead>
                                <TableHead>Lotto</TableHead>
                                <TableHead>Q.tà</TableHead>
                                <TableHead>Motivo</TableHead>
                                <TableHead>Operatore</TableHead>
                                <TableHead className="text-right">Azioni</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {incomingReports.length > 0 ? (
                                incomingReports.map((report) => (
                                    <TableRow key={report.id} data-state={selectedIncomingRows.includes(report.id) && "selected"}>
                                         <TableCell padding="checkbox">
                                            <Checkbox
                                                checked={selectedIncomingRows.includes(report.id)}
                                                onCheckedChange={() => handleSelectIncomingRow(report.id)}
                                                aria-label={`Seleziona report ${report.id}`}
                                            />
                                        </TableCell>
                                        <TableCell>{format(new Date(report.reportDate), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                        <TableCell>
                                            <Badge variant={report.status === 'pending' ? 'destructive' : (report.status === 'approved' ? 'default' : 'secondary')}>
                                                {report.status === 'pending' ? 'In Attesa' : (report.status === 'approved' ? 'Approvato' : 'Reso Confermato')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-medium">{report.materialCode}</TableCell>
                                        <TableCell>{report.lotto}</TableCell>
                                        <TableCell>{report.quantity}</TableCell>
                                        <TableCell>{report.reason}{report.notes && <span className="text-muted-foreground italic"> - {report.notes}</span>}</TableCell>
                                        <TableCell>{report.operatorName}</TableCell>
                                        <TableCell className="text-right space-x-2">
                                            {report.status === 'pending' && (
                                                <>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700 dark:hover:bg-green-900/50" disabled={isPending}>
                                                                <PackageCheck className="mr-2 h-4 w-4" /> Approva Carico
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Approvare il carico di {report.quantity} unità per il lotto {report.lotto}? Il materiale verrà aggiunto allo stock.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleApprove(report.id)} className="bg-green-600 hover:bg-green-700">Sì, approva</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive" disabled={isPending}>
                                                                <Undo2 className="mr-2 h-4 w-4" /> Conferma Reso
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                             <AlertDialogHeader>
                                                                <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Confermare il reso per il lotto {report.lotto}? Il materiale non verrà caricato a magazzino.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleConfirmReturn(report.id)} className="bg-destructive hover:bg-destructive/90">Sì, conferma reso</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-24 text-center">
                                        Nessuna segnalazione di non conformità in ingresso trovata.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );

     const renderOutgoingReports = () => (
         <Card>
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <CardTitle>Segnalazioni da Produzione</CardTitle>
                        <CardDescription>Elenco dei problemi segnalati durante le fasi di lavorazione delle commesse.</CardDescription>
                    </div>
                     {selectedProductionRows.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isPending}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Elimina Selezionate ({selectedProductionRows.length})
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei sicuro di voler eliminare?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Stai per eliminare {selectedProductionRows.length} segnalazioni. Questa operazione è irreversibile.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeleteProductionSelected} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead padding="checkbox">
                                    <Checkbox
                                        checked={selectedProductionRows.length > 0 ? (selectedProductionRows.length === productionReports.length ? true : 'indeterminate') : false}
                                        onCheckedChange={handleSelectAllProduction}
                                        aria-label="Seleziona tutte"
                                    />
                                </TableHead>
                                <TableHead>Data</TableHead>
                                <TableHead>Stato</TableHead>
                                <TableHead>Commessa</TableHead>
                                <TableHead>Fase</TableHead>
                                <TableHead>Tipo Problema</TableHead>
                                <TableHead>Note</TableHead>
                                <TableHead>Operatore</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                             {productionReports.length > 0 ? (
                                productionReports.map((report) => (
                                    <TableRow key={report.id} data-state={selectedProductionRows.includes(report.id) && "selected"}>
                                         <TableCell padding="checkbox">
                                            <Checkbox
                                                checked={selectedProductionRows.includes(report.id)}
                                                onCheckedChange={() => handleSelectProductionRow(report.id)}
                                                aria-label={`Seleziona report ${report.id}`}
                                            />
                                        </TableCell>
                                        <TableCell>{format(new Date(report.reportDate), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                        <TableCell>
                                            <Badge variant={report.status === 'open' ? 'destructive' : 'default'}>
                                                {report.status === 'open' ? <ShieldX className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                                                {report.status === 'open' ? 'Da Risolvere' : 'Risolto'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-medium">{report.jobOrderPF}</TableCell>
                                        <TableCell>{report.phaseName}</TableCell>
                                        <TableCell>{report.problemType.replace(/_/g, ' ')}</TableCell>
                                        <TableCell className="text-muted-foreground italic">{report.notes || 'N/D'}</TableCell>
                                        <TableCell>{report.operatorName}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-24 text-center">
                                        Nessuna segnalazione di non conformità dalla produzione.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <ShieldAlert className="h-8 w-8 text-destructive" />
                    Gestione Non Conformità
                </h1>
                <p className="text-muted-foreground mt-2">
                    Revisiona le segnalazioni e prendi azioni correttive.
                </p>
            </header>

            <Tabs defaultValue="incoming">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="incoming">
                        <Warehouse className="mr-2 h-4 w-4" />
                        NC in Ingresso (Magazzino)
                    </TabsTrigger>
                    <TabsTrigger value="outgoing">
                        <AlertCircle className="mr-2 h-4 w-4" />
                        NC in Uscita (Produzione)
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="incoming">
                    {renderIncomingReports()}
                </TabsContent>
                <TabsContent value="outgoing">
                    {renderOutgoingReports()}
                </TabsContent>
            </Tabs>
        </div>
    );
}

    

    

    