
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
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
import { ShieldAlert, Loader2, Warehouse, AlertCircle, PackageCheck, Undo2, Trash2 } from 'lucide-react';
import { approveNonConformity, confirmReturn, deleteNonConformityReports } from './actions';
import type { NonConformityReport } from '@/lib/mock-data';

interface NonConformityClientPageProps {
  initialReports: NonConformityReport[];
}

export default function NonConformityClientPage({ initialReports }: NonConformityClientPageProps) {
    const [incomingReports, setIncomingReports] = useState<NonConformityReport[]>(initialReports);
    const [isPending, startTransition] = useTransition();
    const [selectedRows, setSelectedRows] = useState<string[]>([]);
    const { toast } = useToast();
    const router = useRouter();

    const refreshData = () => {
      router.refresh();
    };

    useEffect(() => {
        setIncomingReports(initialReports);
    }, [initialReports]);

    const handleApprove = (reportId: string) => {
        startTransition(async () => {
            const result = await approveNonConformity(reportId);
            toast({
                title: result.success ? "Operazione Completata" : "Errore",
                description: result.message,
                variant: result.success ? "default" : "destructive",
            });
            if (result.success) {
                refreshData();
            }
        });
    };

    const handleConfirmReturn = (reportId: string) => {
        startTransition(async () => {
            const result = await confirmReturn(reportId);
             toast({
                title: result.success ? "Operazione Completata" : "Errore",
                description: result.message,
                variant: result.success ? "default" : "destructive",
            });
            if (result.success) {
                refreshData();
            }
        });
    };
    
    const handleDeleteSelected = () => {
        startTransition(async () => {
            const result = await deleteNonConformityReports(selectedRows);
            toast({
                title: result.success ? "Operazione Completata" : "Errore",
                description: result.message,
                variant: result.success ? "default" : "destructive",
            });
            if (result.success) {
                setSelectedRows([]);
                refreshData();
            }
        });
    }

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
        setSelectedRows(checked === true ? incomingReports.map(r => r.id) : []);
    };
    
    const handleSelectRow = (id: string) => {
        setSelectedRows(prev => prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]);
    };

    const renderIncomingReports = () => (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <CardTitle>Segnalazioni da Carico Merce</CardTitle>
                        <CardDescription>Elenco delle non conformità segnalate. Gestisci ogni segnalazione per procedere.</CardDescription>
                    </div>
                     {selectedRows.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isPending}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Elimina Selezionate ({selectedRows.length})
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei sicuro di voler eliminare?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Stai per eliminare {selectedRows.length} segnalazioni. Questa operazione è irreversibile.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction>
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
                                        checked={selectedRows.length > 0 ? (selectedRows.length === incomingReports.length ? true : 'indeterminate') : false}
                                        onCheckedChange={handleSelectAll}
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
                                    <TableRow key={report.id} data-state={selectedRows.includes(report.id) && "selected"}>
                                         <TableCell padding="checkbox">
                                            <Checkbox
                                                checked={selectedRows.includes(report.id)}
                                                onCheckedChange={() => handleSelectRow(report.id)}
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
                <CardTitle>Segnalazioni da Produzione</CardTitle>
                <CardDescription>Elenco dei problemi segnalati durante le fasi di lavorazione delle commesse.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed rounded-lg">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold">Funzionalità in Sviluppo</h3>
                    <p className="text-sm text-muted-foreground">Questa sezione è in fase di implementazione.</p>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="space-y-6">
            <AdminNavMenu />

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
