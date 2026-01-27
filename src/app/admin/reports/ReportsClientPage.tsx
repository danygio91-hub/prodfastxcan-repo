

"use client";

import React, { useState, useEffect, useMemo, useTransition } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { DateRange } from "react-day-picker"
import { format, subDays } from "date-fns"
import { it } from 'date-fns/locale';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { BarChart3, Users, Briefcase, ChevronRight, Download, Calendar as CalendarIcon, Boxes, Loader2, Trash2, Search, Package, Copy } from 'lucide-react';
import { getMaterialWithdrawals, deleteSelectedWithdrawals, deleteAllWithdrawals, getOperatorsReport as fetchOperatorsReport, getJobsReport, type getOperatorsReport } from './actions';
import { cn } from '@/lib/utils';
import type { OverallStatus } from '@/lib/types';
import type { MaterialWithdrawal, RawMaterialType } from '@/lib/mock-data';
import { useRouter } from 'next/navigation';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from '@/hooks/use-toast';

type JobsReport = Awaited<ReturnType<typeof getJobsReport>>;
type OperatorsReport = Awaited<ReturnType<typeof getOperatorsReport>>;
type EnrichedMaterialWithdrawal = MaterialWithdrawal & { materialType?: RawMaterialType };

const allMaterialTypes: RawMaterialType[] = ['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA'];

function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge
      className={cn(
        "text-xs font-semibold",
        status === "In Lavorazione" && "bg-accent text-accent-foreground",
        status === "Completata" && "bg-primary text-primary-foreground",
        status === "Problema" && "bg-destructive text-destructive-foreground",
        status === "Sospesa" && "bg-yellow-500 text-yellow-50"
      )}
    >
      {status}
    </Badge>
  );
}

export default function ReportsClientPage({
  initialJobsReport,
}: {
  initialJobsReport: JobsReport;
}) {
  const [jobsReport, setJobsReport] = useState<JobsReport>(initialJobsReport);
  const [operatorsReport, setOperatorsReport] = useState<OperatorsReport>([]);
  const [withdrawalsReport, setWithdrawalsReport] = useState<EnrichedMaterialWithdrawal[]>([]);
  
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [operatorsLoaded, setOperatorsLoaded] = useState(false);
  const [withdrawalsLoaded, setWithdrawalsLoaded] = useState(false);

  const [isPendingJobs, setIsPendingJobs] = useState(false);
  const [isPendingWithdrawals, setIsPendingWithdrawals] = useState(false);
  const [isPendingOperators, setIsPendingOperators] = useState(false);

  const [operatorDate, setOperatorDate] = useState<Date | undefined>(new Date());
  const [withdrawalsDateRange, setWithdrawalsDateRange] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const [selectedWithdrawals, setSelectedWithdrawals] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [jobsSearchTerm, setJobsSearchTerm] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  const fetchJobs = React.useCallback(async () => {
    setIsPendingJobs(true);
    const data = await getJobsReport();
    setJobsReport(data);
    setJobsLoaded(true);
    setIsPendingJobs(false);
  }, []);

  const fetchWithdrawals = React.useCallback(async () => {
    setIsPendingWithdrawals(true);
    const data = await getMaterialWithdrawals({ from: withdrawalsDateRange?.from, to: withdrawalsDateRange?.to });
    setWithdrawalsReport(data);
    setWithdrawalsLoaded(true);
    setIsPendingWithdrawals(false);
  }, [withdrawalsDateRange]);
  
  const fetchOperators = React.useCallback(async () => {
    if (!operatorDate) return;
    setIsPendingOperators(true);

    const timezoneOffset = operatorDate.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(operatorDate.getTime() - timezoneOffset);
    
    const data = await fetchOperatorsReport(adjustedDate.toISOString());
    setOperatorsReport(data);
    setOperatorsLoaded(true);
    setIsPendingOperators(false);
  }, [operatorDate]);
  
  const filteredAndGroupedWithdrawals = useMemo(() => {
    const filtered = searchTerm
        ? withdrawalsReport.filter(w =>
            w.jobOrderPFs.join(', ').toLowerCase().includes(searchTerm.toLowerCase()) ||
            w.materialCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (w.operatorName || '').toLowerCase().includes(searchTerm.toLowerCase())
        )
        : withdrawalsReport;

    return filtered.reduce((acc, withdrawal) => {
        const type = withdrawal.materialType || 'Sconosciuto';
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(withdrawal);
        return acc;
    }, {} as Record<string, EnrichedMaterialWithdrawal[]>);
  }, [withdrawalsReport, searchTerm]);
  
  const filteredJobsReport = useMemo(() => {
    if (!jobsSearchTerm) {
      return jobsReport;
    }
    const lowercasedFilter = jobsSearchTerm.toLowerCase();
    return jobsReport.filter(job =>
      job.id.toLowerCase().includes(lowercasedFilter) ||
      job.details.toLowerCase().includes(lowercasedFilter)
    );
  }, [jobsReport, jobsSearchTerm]);


  const handleSelectAllForGroup = (group: EnrichedMaterialWithdrawal[], checked: boolean | 'indeterminate') => {
    const groupIds = group.map(w => w.id);
    if (checked) {
        setSelectedWithdrawals(prev => [...new Set([...prev, ...groupIds])]);
    } else {
        setSelectedWithdrawals(prev => prev.filter(id => !groupIds.includes(id)));
    }
  };

  const handleSelectWithdrawalRow = (id: string) => {
    setSelectedWithdrawals(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedWithdrawals.length === 0) return;
    setIsDeleting(true);
    const result = await deleteSelectedWithdrawals(selectedWithdrawals);
    if (result.success) {
      toast({ title: "Eliminazione Completata", description: result.message });
      setSelectedWithdrawals([]);
      fetchWithdrawals();
    } else {
       toast({ variant: "destructive", title: "Errore", description: result.message });
    }
    setIsDeleting(false);
  };
  
  const handleDeleteAll = async () => {
    setIsDeleting(true);
    const result = await deleteAllWithdrawals();
    toast({ title: "Operazione Completata", description: result.message });
    setSelectedWithdrawals([]);
    fetchWithdrawals();
    setIsDeleting(false);
  };

  const handleExportJobs = () => {
    const dataToExport = filteredJobsReport.map(job => ({
      'Commessa (PF)': job.id,
      'Articolo': job.details,
      'Cliente': job.cliente,
      'Stato': job.status,
      'Tempo Trascorso': job.timeElapsed,
      'Operatori': job.operators,
      'Data Consegna': job.deliveryDate,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Commesse");
    XLSX.writeFile(wb, "report_commesse.xlsx");
  };

  const handleExportOperators = () => {
     const dataToExport = operatorsReport.map(op => ({
      'Operatore': op.name,
      'Reparto': op.department,
      'Stato': op.status,
      'Ore Giorno': op.timeToday,
      'Ore Settimana': op.timeWeek,
      'Ore Mese': op.timeMonth,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Operatori");
    XLSX.writeFile(wb, "report_operatori.xlsx");
  };

  const handleExportWithdrawals = () => {
    const dataToExport = withdrawalsReport.map(w => ({
      'Tipo Materiale': w.materialType || 'Sconosciuto',
      'Commessa/e': w.jobOrderPFs.join(', '),
      'Materiale': w.materialCode,
      'Peso Consumato (Kg)': w.consumedWeight.toFixed(2),
      'Data Prelievo': format(new Date(w.withdrawalDate), 'dd/MM/yyyy HH:mm', { locale: it }),
      'Operatore': w.operatorName,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Prelievi");
    XLSX.writeFile(wb, "report_prelievi_magazzino.xlsx");
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
        title: "Copiato!",
        description: `"${text}" è stato copiato negli appunti.`,
    });
  }

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };
  
  const handleTabChange = (value: string) => {
    if (value === 'commesse' && !jobsLoaded) {
      fetchJobs();
    }
    if (value === 'operatori' && !operatorsLoaded) {
      fetchOperators();
    }
    if (value === 'prelievi' && !withdrawalsLoaded) {
      fetchWithdrawals();
    }
  };

  const renderLoadingRow = (colspan: number) => (
    <TableRow>
      <TableCell colSpan={colspan} className="h-24 text-center">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Caricamento report...</span>
        </div>
      </TableCell>
    </TableRow>
  );

  const withdrawalGroups = Object.keys(filteredAndGroupedWithdrawals);
  const reportMetadata = operatorsReport[0] || {};

  return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              Reportistica Avanzata
          </h1>
          <p className="text-muted-foreground mt-1">
            Analizza le performance di produzione per commesse, operatori e prelievi di materiale.
          </p>
        </header>

        <Tabs onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="commesse">
              <Briefcase className="mr-2 h-4 w-4"/>
              Report Commesse
            </TabsTrigger>
            <TabsTrigger value="operatori">
              <Users className="mr-2 h-4 w-4"/>
              Report Operatori
            </TabsTrigger>
              <TabsTrigger value="prelievi">
              <Boxes className="mr-2 h-4 w-4"/>
              Prelievi da Magazzino
            </TabsTrigger>
          </TabsList>

          <TabsContent value="commesse">
            <Card>
              <CardHeader>
                  <div className="flex justify-between items-center flex-wrap gap-4">
                      <CardTitle className="font-headline">Riepilogo Lavorazioni per Commessa</CardTitle>
                      <div className="flex items-center gap-2 flex-wrap">
                          <div className="relative w-full sm:w-auto">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                  placeholder="Cerca per commessa o articolo..."
                                  className="pl-9 w-full sm:w-64"
                                  value={jobsSearchTerm}
                                  onChange={(e) => setJobsSearchTerm(e.target.value)}
                              />
                          </div>
                          <Button onClick={handleExportJobs} variant="outline" size="sm" disabled={jobsReport.length === 0}>
                              <Download className="mr-2 h-4 w-4" />
                              Esporta Excel
                          </Button>
                      </div>
                  </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Commessa (PF)</TableHead>
                        <TableHead>Articolo</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Tempo Trascorso</TableHead>
                        <TableHead>Operatori</TableHead>
                        <TableHead>Dettagli</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isPendingJobs ? renderLoadingRow(6) : (
                            filteredJobsReport.length > 0 ? filteredJobsReport.map((job) => (
                                <TableRow key={job.id}>
                                <TableCell className="font-medium">{job.id}</TableCell>
                                <TableCell>
                                    <ContextMenu>
                                        <ContextMenuTrigger className="hover:text-primary hover:underline cursor-pointer">
                                        {job.details}
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                        <ContextMenuItem onSelect={() => handleNavigateToAnalysis(job.details)}>
                                            <BarChart3 className="mr-2 h-4 w-4"/>
                                            Analisi Tempi Articolo
                                        </ContextMenuItem>
                                        <ContextMenuItem onSelect={() => handleCopy(job.details)}>
                                            <Copy className="mr-2 h-4 w-4"/>
                                            Copia Codice Articolo
                                        </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                </TableCell>
                                <TableCell><StatusBadge status={job.status as OverallStatus} /></TableCell>
                                <TableCell>{job.timeElapsed}</TableCell>
                                <TableCell className="max-w-[200px] truncate">{job.operators}</TableCell>
                                <TableCell>
                                    <Button asChild variant="outline" size="sm">
                                    <Link href={`/admin/reports/${job.id}`}>
                                        Vedi Dettagli
                                        <ChevronRight className="ml-2 h-4 w-4" />
                                    </Link>
                                    </Button>
                                </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">{jobsLoaded ? "Nessuna commessa trovata." : "Seleziona una scheda per visualizzare il report."}</TableCell>
                                </TableRow>
                            )
                        )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operatori">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="font-headline">Riepilogo Ore per Operatore</CardTitle>
                    <div className="flex items-center gap-2">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={"outline"}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {operatorDate ? format(operatorDate, "PPP", { locale: it }) : <span>Scegli una data</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={operatorDate} onSelect={setOperatorDate} initialFocus />
                            </PopoverContent>
                        </Popover>
                         <Button onClick={fetchOperators} variant="secondary" size="sm" disabled={isPendingOperators}>
                              {isPendingOperators ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                              Cerca
                          </Button>
                        <Button onClick={handleExportOperators} variant="outline" size="sm" disabled={operatorsReport.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Esporta Excel
                        </Button>
                    </div>
                </div>
              </CardHeader>
              <CardContent>
                  <div className="overflow-x-auto">
                      <Table>
                      <TableHeader>
                          <TableRow>
                            <TableHead>Operatore</TableHead>
                            <TableHead>Reparto</TableHead>
                            <TableHead>Stato</TableHead>
                            <TableHead>
                                Ore Giorno
                                <div className="text-xs font-normal text-muted-foreground">{reportMetadata.todayDate || ''}</div>
                            </TableHead>
                            <TableHead>
                                Ore Settimana
                                <div className="text-xs font-normal text-muted-foreground">{reportMetadata.weekLabel || ''}</div>
                            </TableHead>
                            <TableHead>
                                Ore Mese
                                <div className="text-xs font-normal text-muted-foreground">{reportMetadata.monthLabel || ''}</div>
                            </TableHead>
                            <TableHead className="text-right">Dettagli</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                         {isPendingOperators ? renderLoadingRow(7) : (
                          operatorsLoaded && operatorsReport.length > 0 ? operatorsReport.map((op) => (
                          <TableRow key={op.id}>
                              <TableCell className="font-medium">{op.name}</TableCell>
                              <TableCell>{op.department}</TableCell>
                              <TableCell>
                                <Badge variant={op.status === 'attivo' ? 'default' : 'secondary'}>{op.status}</Badge>
                              </TableCell>
                              <TableCell>{op.timeToday}</TableCell>
                              <TableCell>{op.timeWeek}</TableCell>
                              <TableCell>{op.timeMonth}</TableCell>
                              <TableCell className="text-right">
                                  <Button asChild variant="outline" size="sm">
                                  <Link href={`/admin/reports/operator/${op.id}?date=${operatorDate?.toISOString() || ''}`}>
                                      Vedi Dettagli
                                      <ChevronRight className="ml-2 h-4 w-4" />
                                  </Link>
                                  </Button>
                              </TableCell>
                          </TableRow>
                          )) : (
                          <TableRow>
                              <TableCell colSpan={7} className="text-center h-24">{operatorsLoaded ? "Nessun dato per la data selezionata." : "Seleziona una data e premi Cerca per visualizzare il report."}</TableCell>
                          </TableRow>
                          )
                         )}
                      </TableBody>
                      </Table>
                  </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="prelievi">
                <Card>
                  <CardHeader>
                      <div className="flex justify-between items-center flex-wrap gap-4">
                          <CardTitle className="font-headline">Report Prelievi da Magazzino</CardTitle>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative w-full sm:w-auto">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Cerca per commessa, materiale..."
                                    className="pl-9 w-full sm:w-64"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                              <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                    id="date"
                                    variant={"outline"}
                                    className={cn(
                                        "w-full sm:w-[260px] justify-start text-left font-normal",
                                        !withdrawalsDateRange && "text-muted-foreground"
                                    )}
                                    >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {withdrawalsDateRange?.from ? (
                                        withdrawalsDateRange.to ? (
                                        <>
                                            {format(withdrawalsDateRange.from, "LLL dd, y")} -{" "}
                                            {format(withdrawalsDateRange.to, "LLL dd, y")}
                                        </>
                                        ) : (
                                        format(withdrawalsDateRange.from, "LLL dd, y")
                                        )
                                    ) : (
                                        <span>Scegli un range</span>
                                    )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={withdrawalsDateRange?.from}
                                    selected={withdrawalsDateRange}
                                    onSelect={setWithdrawalsDateRange}
                                    numberOfMonths={2}
                                    locale={it}
                                    />
                                </PopoverContent>
                            </Popover>
                            <Button onClick={fetchWithdrawals} variant="secondary" size="sm" disabled={isPendingWithdrawals}>
                                {isPendingWithdrawals ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                                Cerca
                            </Button>
                            <Button onClick={handleExportWithdrawals} variant="outline" size="sm" disabled={isPendingWithdrawals || isDeleting || withdrawalsReport.length === 0}>
                                <Download className="mr-2 h-4 w-4" />
                                Esporta
                            </Button>
                          </div>
                      </div>
                  </CardHeader>
                  <CardContent>
                       {isPendingWithdrawals ? (
                         <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                         </div>
                       ) : !withdrawalsLoaded ? (
                            <div className="text-center py-24 text-muted-foreground">
                                Seleziona un intervallo di date e premi Cerca per visualizzare i prelievi.
                            </div>
                       ) : (
                            <Tabs defaultValue={allMaterialTypes[0]} className="w-full">
                                <TabsList>
                                    {allMaterialTypes.map(type => (
                                        <TabsTrigger key={type} value={type}>
                                             <Package className="mr-2 h-4 w-4" />
                                            {type}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                                {allMaterialTypes.map(type => {
                                    const group = filteredAndGroupedWithdrawals[type] || [];
                                    const groupIds = group.map(w => w.id);
                                    const selectedInGroupCount = selectedWithdrawals.filter(id => groupIds.includes(id)).length;
                                    
                                    return (
                                     <TabsContent value={type} key={type}>
                                        {group.length > 0 ? (
                                            <div className="overflow-x-auto">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead padding="checkbox">
                                                                <Checkbox
                                                                checked={selectedInGroupCount > 0 ? (selectedInGroupCount === group.length ? true : 'indeterminate') : false}
                                                                onCheckedChange={(checked) => handleSelectAllForGroup(group, !!checked)}
                                                                aria-label={`Seleziona tutti i prelievi per ${type}`}
                                                                />
                                                            </TableHead>
                                                            <TableHead>Commessa/e</TableHead>
                                                            <TableHead>Materiale</TableHead>
                                                            <TableHead>Peso Consumato (Kg)</TableHead>
                                                            <TableHead>Data Prelievo</TableHead>
                                                            <TableHead>Operatore</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {group.map((w) => (
                                                            <TableRow key={w.id} data-state={selectedWithdrawals.includes(w.id) ? "selected" : undefined}>
                                                                <TableCell padding="checkbox">
                                                                    <Checkbox
                                                                    checked={selectedWithdrawals.includes(w.id)}
                                                                    onCheckedChange={() => handleSelectWithdrawalRow(w.id)}
                                                                    aria-label={`Seleziona prelievo ${w.id}`}
                                                                    />
                                                                </TableCell>
                                                                <TableCell className="font-medium">{w.jobOrderPFs.join(', ')}</TableCell>
                                                                <TableCell>{w.materialCode}</TableCell>
                                                                <TableCell>{w.consumedWeight.toFixed(2)}</TableCell>
                                                                <TableCell>{format(new Date(w.withdrawalDate), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                                                <TableCell>{w.operatorName}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        ) : (
                                            <div className="py-12 text-center text-muted-foreground">
                                                Nessun prelievo registrato per questa tipologia nel periodo selezionato.
                                            </div>
                                        )}
                                    </TabsContent>
                                    )
                                })}
                            </Tabs>
                       )}
                  </CardContent>
                </Card>
          </TabsContent>

        </Tabs>
      </div>
  );
}
