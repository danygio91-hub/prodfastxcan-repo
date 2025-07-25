
"use client";

import React from 'react';
import * as XLSX from 'xlsx';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Timer, Package, Download } from 'lucide-react';
import type { ProductionTimeAnalysisReport } from '../reports/actions';

interface ProductionTimeAnalysisClientPageProps {
  report: ProductionTimeAnalysisReport[];
}

export default function ProductionTimeAnalysisClientPage({ report }: ProductionTimeAnalysisClientPageProps) {

  const handleExport = (articleReport: ProductionTimeAnalysisReport) => {
    const dataToExport = articleReport.jobs.map(job => ({
        'Codice Articolo': articleReport.articleCode,
        'Commessa': job.id,
        'Cliente': job.cliente,
        'Quantità': job.qta,
        'Tempo Totale (min)': job.totalTimeMinutes.toFixed(2),
        'Minuti/Pezzo': job.minutesPerPiece.toFixed(4),
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Analisi ${articleReport.articleCode}`);
    XLSX.writeFile(wb, `analisi_tempi_${articleReport.articleCode}.xlsx`);
  };
    
  return (
      <div className="space-y-6">
        <AdminNavMenu />

        <header className="space-y-2">
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Timer className="h-8 w-8 text-primary" />
              Analisi Tempi di Produzione per Articolo
          </h1>
          <p className="text-muted-foreground">
            Riepilogo dei tempi medi di lavorazione raggruppati per codice articolo.
          </p>
        </header>

        <Card>
            <CardHeader>
                <CardTitle>Report Articoli</CardTitle>
                <CardDescription>
                    Espandi ogni articolo per visualizzare il dettaglio delle commesse e dei relativi tempi di produzione.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {report.length > 0 ? (
                <Accordion type="single" collapsible className="w-full">
                    {report.map((item) => (
                        <AccordionItem value={item.articleCode} key={item.articleCode}>
                            <AccordionTrigger>
                                <div className="flex justify-between items-center w-full pr-4">
                                    <div className="flex items-center gap-3">
                                        <Package className="h-5 w-5 text-primary" />
                                        <span className="font-semibold text-lg">{item.articleCode}</span>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm text-muted-foreground">Tempo Medio/Pz</div>
                                        <div className="font-bold text-lg text-primary">{item.averageMinutesPerPiece.toFixed(4)} min</div>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="p-4 bg-muted/50 rounded-lg">
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="text-sm text-muted-foreground">Dettaglio di {item.totalJobs} commesse per un totale di {item.totalQuantity} pezzi.</p>
                                        <Button variant="outline" size="sm" onClick={() => handleExport(item)}>
                                            <Download className="mr-2 h-4 w-4" />
                                            Esporta Dettaglio
                                        </Button>
                                    </div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Commessa</TableHead>
                                                <TableHead>Cliente</TableHead>
                                                <TableHead>Q.tà</TableHead>
                                                <TableHead>Tempo Totale</TableHead>
                                                <TableHead>Minuti/Pezzo</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {item.jobs.map(job => (
                                                <TableRow key={job.id}>
                                                    <TableCell className="font-mono">{job.id}</TableCell>
                                                    <TableCell>{job.cliente}</TableCell>
                                                    <TableCell>{job.qta}</TableCell>
                                                    <TableCell>{job.totalTimeMinutes.toFixed(2)} min</TableCell>
                                                    <TableCell className="font-semibold">{job.minutesPerPiece.toFixed(4)} min</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Package className="h-16 w-16 text-muted-foreground mb-4" />
                        <p className="text-lg font-semibold text-muted-foreground">Nessun dato disponibile.</p>
                        <p className="text-sm text-muted-foreground">
                            Non ci sono ancora commesse completate da analizzare.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
      </div>
  );
}
