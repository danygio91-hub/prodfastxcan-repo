
"use client";

import React, { useState, useEffect } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Loader2 } from 'lucide-react';
// import { getNonConformityReports } from './actions'; // Action to be created
// import { NonConformityReport } from '@/lib/mock-data';

// Mock data until backend is implemented
const mockReports = [
    { id: 'nc-1', materialCode: 'BOB-123', lotto: 'LOT-A', reason: 'Codifica Errata', notes: 'Il codice sull\'etichetta non corrisponde a quello sul DDT.', operatorName: 'Paola', reportDate: new Date(), status: 'pending' },
    { id: 'nc-2', materialCode: 'TUBI-XYZ', lotto: 'LOT-B', reason: 'Dimensioni Errate', notes: '', operatorName: 'Paola', reportDate: new Date(Date.now() - 86400000), status: 'reviewed' },
];


export default function NonConformityReportsPage() {
    // const [reports, setReports] = useState<NonConformityReport[]>([]);
    const [reports, setReports] = useState(mockReports); // Using mock data
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // In the future, this will fetch real data
        // getNonConformityReports().then(data => {
        //     setReports(data);
        //     setIsLoading(false);
        // });
        setIsLoading(false); // For now, just stop loading
    }, []);

    return (
        <AdminAuthGuard>
            <AppShell>
                <div className="space-y-6">
                    <AdminNavMenu />

                    <header>
                        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                            <ShieldAlert className="h-8 w-8 text-destructive" />
                            Gestione Non Conformità
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Revisiona le segnalazioni di non conformità ricevute dal magazzino e prendi azioni correttive.
                        </p>
                    </header>

                    <Card>
                        <CardHeader>
                            <CardTitle>Segnalazioni Ricevute</CardTitle>
                            <CardDescription>Elenco delle non conformità segnalate dagli operatori in fase di carico merce.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Data</TableHead>
                                            <TableHead>Stato</TableHead>
                                            <TableHead>Materiale</TableHead>
                                            <TableHead>Lotto</TableHead>
                                            <TableHead>Motivo</TableHead>
                                            <TableHead>Operatore</TableHead>
                                            <TableHead>Azioni</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-24 text-center">
                                                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                                                </TableCell>
                                            </TableRow>
                                        ) : reports.length > 0 ? (
                                            reports.map((report) => (
                                                <TableRow key={report.id}>
                                                    <TableCell>{report.reportDate.toLocaleDateString('it-IT')}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={report.status === 'pending' ? 'destructive' : 'secondary'}>
                                                            {report.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="font-medium">{report.materialCode}</TableCell>
                                                    <TableCell>{report.lotto}</TableCell>
                                                    <TableCell>{report.reason}</TableCell>
                                                    <TableCell>{report.operatorName}</TableCell>
                                                    <TableCell>
                                                        {/* Actions buttons will be added here */}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-24 text-center">
                                                    Nessuna segnalazione di non conformità trovata.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </AppShell>
        </AdminAuthGuard>
    );
}

