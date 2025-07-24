
"use client";

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { DateRange } from "react-day-picker"
import { format, subDays } from "date-fns"
import { it } from 'date-fns/locale';

import AdminNavMenu from '@/components/admin/AdminNavMenu';
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
import { BarChart3, Users, Briefcase, ChevronRight, Download, Calendar as CalendarIcon, Boxes, Loader2, Trash2, Search } from 'lucide-react';
import { getMaterialWithdrawals, deleteSelectedWithdrawals, deleteAllWithdrawals } from './actions';
import { cn } from '@/lib/utils';
import type { OverallStatus } from '@/lib/types';
import type { MaterialWithdrawal } from '@/lib/mock-data';
import type { getJobsReport, getOperatorsReport } from './actions';
import { useRouter } from 'next/navigation';

type JobsReport = Awaited<ReturnType<typeof getJobsReport>>;
type OperatorsReport = Awaited<ReturnType<typeof getOperatorsReport>>;

interface ReportsClientPageProps {
  initialJobsReport: JobsReport;
  initialOperatorsReport: OperatorsReport;
  initialWithdrawalsReport: MaterialWithdrawal[];
}

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
  initialOperatorsReport,
  initialWithdrawalsReport,
}: ReportsClientPageProps) {
  const [jobsReport, setJobsReport] = useState<JobsReport>(initialJobsReport);
  const [operatorsReport, setOperatorsReport] = useState<OperatorsReport>(initialOperatorsReport);
  const [withdrawalsReport, setWithdrawalsReport] = useState<MaterialWithdrawal[]>(initialWithdrawalsReport);
  
  const [isPendingWithdrawals, startTransitionWithdrawals] = useTransition();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const [selectedWithdrawals, setSelectedWithdrawals] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();


  const fetchWithdrawals = React.useCallback(async () => {
    startTransitionWithdrawals(async () => {
      const data = await getMaterialWithdrawals({ from: date?.from, to: date?.to });
      setWithdrawalsReport(data);
    });
  }, [date]);
  
  // This useEffect is now just for date changes for withdrawals
  useEffect(() => {
    fetchWithdrawals();
  }, [date, fetchWithdrawals]);
  
  const filteredWithdrawals = useMemo(() => {
    if (!searchTerm) {
        return withdrawalsReport;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return withdrawalsReport.filter(w =>
        w.jobOrderPFs.join(', ').toLowerCase().includes(lowercasedFilter) ||
        w.materialCode.toLowerCase().includes(lowercasedFilter) ||
        (w.operatorName || '').toLowerCase().includes(lowercasedFilter)
    );
  }, [withdrawalsReport, searchTerm]);


  const handleSelectAllWithdrawals = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedWithdrawals(filteredWithdrawals.map(w => w.id));
    } else {
      setSelectedWithdrawals([]);
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
      router.refresh();
      setSelectedWithdrawals([]);
    }
    setIsDeleting(false);
  };
  
  const handleDeleteAll = async () => {
    setIsDeleting(true);
    await deleteAllWithdrawals();
    router.refresh();
    setSelectedWithdrawals([]);
    setIsDeleting(false);
  };

  const handleExportJobs = () => {
    const dataToExport = jobsReport.map(job => ({
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
      'Ore Oggi': op.timeToday,
      'Ore Settimana': op.timeWeek,
      'Ore Mese': op.timeMonth,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Operatori");
    XLSX.writeFile(wb, "report_operatori.xlsx");
  };

  const handleExportWithdrawals = () => {
    const dataToExport = filteredWithdrawals.map(w => ({
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
  
  const renderLoadingRow = (colspan: number) => (
    <TableRow>
      <TableCell colSpan={colspan} className="h-24 text-center">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Caricamento report...</span>
        </div>
      </TableCell>
    </TableRow>
  )

  return (
      <div className="space-y-6">
        <AdminNavMenu />

        <header className="space-y-2">
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              Reportistica Avanzata
          </h1>
          <p className="text-muted-foreground">
            Analizza le performance di produzione per commesse, operatori e prelievi di materiale.
          </p>
        </header>

        <Tabs defaultValue="commesse">
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
                  <div className="flex justify-between items-center">
                      <div>
                          <CardTitle>Riepilogo Lavorazioni per Commessa</CardTitle>
                          <CardDescription>Elenco delle commesse in lavorazione o completate.</CardDescription>
                      </div>
                      <Button onClick={handleExportJobs} variant="outline" size="sm" disabled={jobsReport.length === 0}>
                          <Download className="mr-2 h-4 w-4" />
                          Esporta Excel
                      </Button>
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
                       {jobsReport.length > 0 ? jobsReport.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-medium">{job.id}</TableCell>
                          <TableCell>{job.details}</TableCell>
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
                          <TableCell colSpan={6} className="text-center h-24">Nessuna commessa in produzione o completata.</TableCell>
                        </TableRow>
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
                  <div>
                      <CardTitle>Riepilogo Ore per Operatore</CardTitle>
                      <CardDescription>Sommario delle ore di lavoro registrate dagli operatori.</CardDescription>
                  </div>
                    <Button onClick={handleExportOperators} variant="outline" size="sm" disabled={operatorsReport.length === 0}>
                      <Download className="mr-2 h-4 w-4" />
                      Esporta Excel
                  </Button>
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
                          <TableHead>Ore Oggi</TableHead>
                          <TableHead>Ore Settimana</TableHead>
                          <TableHead>Ore Mese</TableHead>
                          <TableHead className="text-right">Dettagli</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                         {operatorsReport.length > 0 ? operatorsReport.map((op) => (
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
                                  <Link href={`/admin/reports/operator/${op.id}`}>
                                      Vedi Dettagli
                                      <ChevronRight className="ml-2 h-4 w-4" />
                                  </Link>
                                  </Button>
                              </TableCell>
                          </TableRow>
                          )) : (
                          <TableRow>
                              <TableCell colSpan={7} className="text-center h-24">Nessun operatore trovato.</TableCell>
                          </TableRow>
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
                          <div>
                              <CardTitle>Report Prelievi da Magazzino</CardTitle>
                              <CardDescription>Elenco degli scarichi di materiale per commessa.</CardDescription>
                          </div>
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
                                        !date && "text-muted-foreground"
                                    )}
                                    >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date?.from ? (
                                        date.to ? (
                                        <>
                                            {format(date.from, "LLL dd, y")} -{" "}
                                            {format(date.to, "LLL dd, y")}
                                        </>
                                        ) : (
                                        format(date.from, "LLL dd, y")
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
                                    defaultMonth={date?.from}
                                    selected={date}
                                    onSelect={setDate}
                                    numberOfMonths={2}
                                    locale={it}
                                    />
                                </PopoverContent>
                            </Popover>
                            <Button onClick={handleExportWithdrawals} variant="outline" size="sm" disabled={isPendingWithdrawals || isDeleting || filteredWithdrawals.length === 0}>
                                <Download className="mr-2 h-4 w-4" />
                                Esporta Excel
                            </Button>
                            {selectedWithdrawals.length > 0 && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" disabled={isDeleting}>
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Elimina ({selectedWithdrawals.length})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Stai per eliminare {selectedWithdrawals.length} report di prelievo. Questa azione è irreversibile.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleDeleteSelected}>Continua</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={isPendingWithdrawals || isDeleting || withdrawalsReport.length === 0}>
                                        Svuota Elenco
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Questa azione è irreversibile. Verranno eliminati tutti i report di prelievo dal sistema.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleDeleteAll}>Sì, elimina tutto</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                          </div>
                      </div>
                  </CardHeader>
                  <CardContent>
                      <div className="overflow-x-auto">
                          <Table>
                              <TableHeader>
                                  <TableRow>
                                       <TableHead padding="checkbox">
                                          <Checkbox
                                            checked={selectedWithdrawals.length > 0 ? (selectedWithdrawals.length === filteredWithdrawals.length ? true : 'indeterminate') : false}
                                            onCheckedChange={handleSelectAllWithdrawals}
                                            aria-label="Seleziona tutti"
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
                                  {isPendingWithdrawals ? renderLoadingRow(6) : 
                                   filteredWithdrawals.length > 0 ? (
                                      filteredWithdrawals.map((w) => (
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
                                      ))
                                  ) : (
                                      <TableRow>
                                          <TableCell colSpan={6} className="h-24 text-center">Nessun prelievo trovato per i filtri selezionati.</TableCell>
                                      </TableRow>
                                  )}
                              </TableBody>
                          </Table>
                      </div>
                  </CardContent>
                </Card>
          </TabsContent>

        </Tabs>
      </div>
  );
}
