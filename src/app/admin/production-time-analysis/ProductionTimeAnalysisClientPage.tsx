

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams, useRouter } from 'next/navigation';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Timer, Package, Download, ChevronRight, Search, BarChart, Copy, ClipboardList, PackagePlus, Workflow, TestTube } from 'lucide-react';
import type { ProductionTimeAnalysisReport } from '../reports/actions';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from '@/lib/utils';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

interface ProductionTimeAnalysisClientPageProps {
  report: ProductionTimeAnalysisReport[];
}

const phaseTypeTitles: Record<string, { title: string, icon: React.ElementType }> = {
    preparation: { title: 'Fasi di Preparazione', icon: PackagePlus },
    production: { title: 'Fasi di Produzione', icon: Workflow },
    quality: { title: 'Controllo Qualità', icon: TestTube },
    packaging: { title: 'Packaging', icon: Package },
};


export default function ProductionTimeAnalysisClientPage({ report }: ProductionTimeAnalysisClientPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [openAccordion, setOpenAccordion] = useState<string | undefined>(undefined);
  const searchParams = useSearchParams();
  const articleCodeFromUrl = searchParams.get('articleCode');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (articleCodeFromUrl) {
      setSearchTerm(articleCodeFromUrl);
      setOpenAccordion(articleCodeFromUrl);
    }
  }, [articleCodeFromUrl]);

  const filteredReport = useMemo(() => {
    if (!searchTerm) {
      return report;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return report.filter(item =>
      item.articleCode.toLowerCase().includes(lowercasedFilter)
    );
  }, [report, searchTerm]);

  const handleExport = (articleReport: ProductionTimeAnalysisReport) => {
    const dataToExport: any[] = [];
    
    // Add average phase times first
    dataToExport.push({ 'Dettaglio': 'TEMPI MEDI PER FASE' });
    articleReport.averagePhaseTimes.forEach(phase => {
      dataToExport.push({
        'Dettaglio': phase.name,
        'Tempo Medio/Pezzo': phase.averageMinutesPerPiece.toFixed(4),
      });
    });
    dataToExport.push({}); // Add empty row for separation

    // Add job details
    dataToExport.push({ 'Dettaglio': 'DETTAGLIO PER COMMESSA' });
    articleReport.jobs.forEach(job => {
        // Main job row
        dataToExport.push({
            'Dettaglio': `Commessa: ${job.id}`,
            'Cliente': job.cliente,
            'Quantità': job.qta,
            'Calcolo Affidabile': job.isTimeCalculationReliable ? 'Sì' : 'No',
            'Fase': 'TOTALE COMMESSA',
            'Tempo Totale (min)': job.totalTimeMinutes.toFixed(2),
            'Tempo Medio/Pezzo': job.minutesPerPiece.toFixed(4),
        });
        // Phase rows
        job.phases.forEach(phase => {
             dataToExport.push({
                'Fase': phase.name,
                'Tempo Totale (min)': phase.totalTimeMinutes.toFixed(2),
                'Tempo Medio/Pezzo': phase.minutesPerPiece.toFixed(4),
            });
        })
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Analisi ${articleReport.articleCode}`);
    XLSX.writeFile(wb, `analisi_tempi_${articleReport.articleCode}.xlsx`);
  };
  
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
        title: "Copiato!",
        description: `Il codice "${text}" è stato copiato negli appunti.`,
    });
  }
  
  const handleNavigateToArticle = (articleCode: string) => {
    router.push(`/admin/article-management?code=${encodeURIComponent(articleCode)}`);
  };
    
  return (
      <div className="space-y-6">
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
                 <div className="flex justify-between items-center flex-wrap gap-4">
                    <div>
                        <CardTitle>Report Articoli</CardTitle>
                        <CardDescription>
                            Espandi ogni articolo per visualizzare il dettaglio delle commesse e dei relativi tempi di produzione.
                        </CardDescription>
                    </div>
                     <div className="relative w-full sm:w-auto">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Cerca per codice articolo..."
                            className="pl-9 w-full sm:w-64"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                 </div>
            </CardHeader>
            <CardContent>
                {report.length > 0 ? (
                <Accordion type="single" collapsible className="w-full" value={openAccordion} onValueChange={setOpenAccordion}>
                    {filteredReport.map((item) => {
                      const groupedPhases = item.averagePhaseTimes.reduce((acc, phase) => {
                        const type = phase.type || 'production';
                        if (!acc[type]) {
                          acc[type] = [];
                        }
                        acc[type].push(phase);
                        return acc;
                      }, {} as Record<string, typeof item.averagePhaseTimes>);

                      return (
                        <AccordionItem value={item.articleCode} key={item.articleCode}>
                          <AccordionTrigger>
                              <div className="flex justify-between items-center w-full pr-4">
                                  <div className="flex items-center gap-3">
                                      <Package className="h-5 w-5 text-primary" />
                                      <ContextMenu>
                                        <ContextMenuTrigger>
                                            <span className="font-semibold text-lg hover:text-primary hover:underline cursor-pointer">{item.articleCode}</span>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                            <ContextMenuItem onSelect={() => handleNavigateToArticle(item.articleCode)}>
                                                <ClipboardList className="mr-2 h-4 w-4" />
                                                Gestisci Distinta Base
                                            </ContextMenuItem>
                                            <ContextMenuItem onSelect={() => handleCopy(item.articleCode)}>
                                                <Copy className="mr-2 h-4 w-4" />
                                                Copia Codice Articolo
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                      </ContextMenu>
                                  </div>
                                  <div className="text-right">
                                       <TooltipProvider>
                                          <Tooltip>
                                              <TooltipTrigger>
                                                  <div className="text-sm text-muted-foreground">
                                                      Tempo Medio/Pz
                                                      <span className={cn(
                                                          "ml-1 font-semibold",
                                                          item.averageMinutesPerPiece > 0 ? "text-green-600 dark:text-green-500" : "text-amber-600 dark:text-amber-500"
                                                      )}>
                                                          ({item.averageMinutesPerPiece > 0 ? 'Affidabile' : 'Parziale'})
                                                      </span>
                                                  </div>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                  <p>Calcolato solo su commesse completate senza forzature.</p>
                                              </TooltipContent>
                                          </Tooltip>
                                      </TooltipProvider>
                                      <div className="font-bold text-lg text-primary">{item.averageMinutesPerPiece > 0 ? `${item.averageMinutesPerPiece.toFixed(4)} min` : 'N/D'}</div>
                                  </div>
                              </div>
                          </AccordionTrigger>
                            <AccordionContent>
                                <div className="p-4 bg-muted/50 rounded-lg space-y-6">
                                    <div className="space-y-4">
                                      <h4 className="font-semibold text-base mb-2 flex items-center gap-2"><BarChart className="h-5 w-5 text-primary" />Riepilogo Tempi Medi per Fase</h4>
                                      {Object.entries(groupedPhases).map(([type, phases]) => {
                                          const phaseInfo = phaseTypeTitles[type] || { title: type, icon: BarChart };
                                          const Icon = phaseInfo.icon;
                                          return (
                                              <div key={type}>
                                                  <div className="flex items-center gap-2 mb-2">
                                                      <Icon className="h-4 w-4 text-muted-foreground" />
                                                      <h5 className="font-semibold text-muted-foreground">{phaseInfo.title}</h5>
                                                  </div>
                                                  <div className="overflow-x-auto border rounded-lg">
                                                      <Table>
                                                          <TableHeader>
                                                              <TableRow>
                                                                  <TableHead>Fase di Lavorazione</TableHead>
                                                                  <TableHead className="text-right">Tempo Medio/Pezzo</TableHead>
                                                              </TableRow>
                                                          </TableHeader>
                                                          <TableBody>
                                                              {phases.map(phase => (
                                                                  <TableRow key={phase.name}>
                                                                      <TableCell>{phase.name}</TableCell>
                                                                      <TableCell className="text-right font-mono">{phase.averageMinutesPerPiece.toFixed(4)} min</TableCell>
                                                                  </TableRow>
                                                              ))}
                                                          </TableBody>
                                                      </Table>
                                                  </div>
                                                  <Separator className="my-4" />
                                              </div>
                                          )
                                      })}
                                       {item.averagePhaseTimes.length === 0 && (
                                         <p className="text-center text-sm text-muted-foreground py-4">Nessun dato aggregato disponibile per le fasi.</p>
                                      )}
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                          <h4 className="font-semibold text-base flex items-center gap-2">Dettaglio Commesse ({item.totalJobs})</h4>
                                          <Button variant="outline" size="sm" onClick={() => handleExport(item)}>
                                              <Download className="mr-2 h-4 w-4" />
                                              Esporta Dettaglio
                                          </Button>
                                        </div>
                                        <div className="space-y-4">
                                            {item.jobs.map(job => (
                                                <Collapsible key={job.id} className="border-t pt-4">
                                                    <CollapsibleTrigger asChild>
                                                        <div className="flex justify-between items-center w-full cursor-pointer hover:bg-background/50 p-2 rounded-md group">
                                                            <div className="flex-1">
                                                                <div className="font-mono text-base font-semibold">{job.id} <Badge variant="secondary" className="ml-2">Cliente: {job.cliente}</Badge></div>
                                                                <div className="text-sm text-muted-foreground">Q.tà: {job.qta}</div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className={cn("font-semibold", job.isTimeCalculationReliable ? "text-green-600 dark:text-green-500" : "text-amber-600 dark:text-amber-500")}>{job.minutesPerPiece.toFixed(4) } min/pz</div>
                                                                <div className="text-xs text-muted-foreground">Tot: {job.totalTimeMinutes.toFixed(2)} min</div>
                                                            </div>
                                                            <ChevronRight className="h-4 w-4 ml-2 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                                                        </div>
                                                    </CollapsibleTrigger>
                                                    <CollapsibleContent>
                                                        <div className="pl-6 pt-2">
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableRow>
                                                                        <TableHead>Fase (con tempo tracciato)</TableHead>
                                                                        <TableHead className="text-right">Tempo Totale Fase</TableHead>
                                                                        <TableHead className="text-right">Minuti/Pezzo</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {job.phases.map((phase, index) => (
                                                                        <TableRow key={index}>
                                                                            <TableCell>{phase.name}</TableCell>
                                                                            <TableCell className="text-right">{phase.totalTimeMinutes.toFixed(2)} min</TableCell>
                                                                            <TableCell className="text-right font-medium">{phase.minutesPerPiece.toFixed(4)} min</TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                    </CollapsibleContent>
                                                </Collapsible>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                     {filteredReport.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground">
                            Nessun articolo trovato per "{searchTerm}".
                        </div>
                    )}
                </Accordion>
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Package className="h-16 w-16 text-muted-foreground mb-4" />
                        <p className="text-lg font-semibold text-muted-foreground">Nessun dato disponibile.</p>
                        <p className="text-sm text-muted-foreground">
                            Non ci sono ancora commesse con tempi di lavorazione registrati.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
      </div>
  );
}
