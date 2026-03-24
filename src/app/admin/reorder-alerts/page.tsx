
"use client";

import React, { useState, useEffect } from 'react';
import { getReorderAlerts, ReorderAlert } from '../raw-material-management/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Bell, Calendar, ArrowRight, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { format, parseISO, isBefore, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

export default function ReorderAlertsPage() {
    const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadAlerts();
    }, []);

    const loadAlerts = async () => {
        setIsLoading(true);
        try {
            const data = await getReorderAlerts();
            setAlerts(data);
        } catch (error) {
            console.error("Error loading alerts:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const getDeadlineStatus = (deadline: string) => {
        const date = parseISO(deadline);
        const now = new Date();
        if (isBefore(date, now)) return 'overdue';
        if (isBefore(date, addDays(now, 3))) return 'imminent';
        return 'ok';
    };

    return (
        <AdminAuthGuard>
            <AppShell>
                <div className="space-y-6">
                    <header className="flex justify-between items-center">
                        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                            <Bell className="h-8 w-8 text-primary" />
                            Alert Riordino Materie Prime
                        </h1>
                        <Button onClick={loadAlerts} disabled={isLoading} variant="outline" size="sm">
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                            Aggiorna
                        </Button>
                    </header>

                    <Card>
                        <CardHeader>
                            <CardTitle>Suggerimenti di Riordino</CardTitle>
                            <CardDescription>
                                Analisi basata sulla giacenza attuale, ODL pianificati e tempi di approvvigionamento.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                                    <Loader2 className="h-12 w-12 animate-spin mb-4 text-primary" />
                                    <p>Analisi scorte in corso...</p>
                                </div>
                            ) : alerts.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Materiale</TableHead>
                                                <TableHead className="text-right">Giacenza Attuale</TableHead>
                                                <TableHead className="text-right">Proiezione Sottoscorta</TableHead>
                                                <TableHead>Data Necessità</TableHead>
                                                <TableHead>Data Limite Ordine</TableHead>
                                                <TableHead className="text-right">Quantità Suggerita</TableHead>
                                                <TableHead className="text-right">Azioni</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {alerts.map((alert) => {
                                                const status = getDeadlineStatus(alert.deadlineDate);
                                                return (
                                                    <TableRow key={alert.materialId} className={cn(status === 'overdue' && "bg-destructive/5")}>
                                                        <TableCell>
                                                            <div className="flex flex-col">
                                                                <span className="font-bold">{alert.code}</span>
                                                                <span className="text-xs text-muted-foreground truncate max-w-[200px]">{alert.description}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {alert.currentStock.toFixed(2)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex flex-col items-end">
                                                                <span className="text-destructive font-bold">{alert.projectedStock.toFixed(2)}</span>
                                                                <span className="text-[10px] text-muted-foreground">Soglia: {alert.minStockLevel}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                                                {format(parseISO(alert.dateOfNeed), 'dd/MM/yyyy')}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-2">
                                                                    <Badge variant={status === 'overdue' ? 'destructive' : status === 'imminent' ? 'warning' : 'outline'}>
                                                                        {format(parseISO(alert.deadlineDate), 'dd/MM/yyyy')}
                                                                    </Badge>
                                                                </div>
                                                                {status === 'overdue' && <span className="text-[10px] text-destructive font-bold mt-1">SCADUTO</span>}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-primary">
                                                            {alert.suggestedQuantity.toFixed(2)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button asChild size="sm" variant="ghost">
                                                                <Link href={`/admin/purchase-orders?material=${alert.code}`}>
                                                                    Crea Ordine <ArrowRight className="ml-2 h-4 w-4" />
                                                                </Link>
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                                    <CheckCircle2 className="h-12 w-12 mb-4 text-green-500" />
                                    <p className="font-medium text-lg">Nessun alert di riordino</p>
                                    <p className="text-sm">Tutte le scorte sono sufficienti per la produzione pianificata.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-destructive/5 border-destructive/20">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                    Ordini Scaduti
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-destructive">
                                    {alerts.filter(a => getDeadlineStatus(a.deadlineDate) === 'overdue').length}
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-amber-500/5 border-amber-500/20">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    In Scadenza (3gg)
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-amber-500">
                                    {alerts.filter(a => getDeadlineStatus(a.deadlineDate) === 'imminent').length}
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-primary/5 border-primary/20">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Bell className="h-4 w-4 text-primary" />
                                    Totale Alert
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-primary">
                                    {alerts.length}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </AppShell>
        </AdminAuthGuard>
    );
}
