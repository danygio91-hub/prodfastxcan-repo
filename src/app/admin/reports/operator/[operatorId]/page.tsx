

"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { getOperatorDetailReport } from '../../actions';
import { ArrowLeft, User, Clock, Calendar as CalendarIcon, Briefcase, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

type OperatorDetailReport = Awaited<ReturnType<typeof getOperatorDetailReport>>;

export default function OperatorReportDetailPage({ params }: { params: { operatorId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateFromParams = searchParams.get('date');

  const [report, setReport] = useState<OperatorDetailReport>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    dateFromParams ? new Date(dateFromParams) : new Date()
  );

  useEffect(() => {
    const fetchReport = async () => {
      setIsLoading(true);
      const newReport = await getOperatorDetailReport(params.operatorId, selectedDate?.toISOString());
      setReport(newReport);
      setIsLoading(false);
      
      // Update URL without reloading page
      const newUrl = `${window.location.pathname}?date=${selectedDate?.toISOString()}`;
      window.history.replaceState({ ...window.history.state, as: newUrl, url: newUrl }, '', newUrl);
    };

    if (params.operatorId && selectedDate) {
      fetchReport();
    }
  }, [params.operatorId, selectedDate]);
  
  if (isLoading || !report) {
    return (
      <AdminAuthGuard>
        <AppShell>
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        </AppShell>
      </AdminAuthGuard>
    )
  }

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">

          <Button asChild variant="outline" className="w-fit">
            <Link href="/admin/reports">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Torna ai Report
            </Link>
          </Button>

          <header>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <User className="h-8 w-8 text-primary" />
              Dettaglio Operatore: {report.operator.nome}
            </h1>
            <p className="text-muted-foreground">Report dettagliato delle attività e delle ore di lavoro.</p>
          </header>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Riepilogo Ore</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                    <Button variant={"outline"}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "PPP", { locale: it }) : <span>Scegli una data</span>}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} initialFocus />
                </PopoverContent>
              </Popover>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
                <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <Clock className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Giorno)</p>
                        <p className="font-semibold text-lg">{report.timeToday}</p>
                         <p className="text-xs text-muted-foreground">{report.dateLabels.today}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <CalendarIcon className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Settimana)</p>
                        <p className="font-semibold text-lg">{report.timeWeek}</p>
                        <p className="text-xs text-muted-foreground">{report.dateLabels.week}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <CalendarIcon className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Mese)</p>
                        <p className="font-semibold text-lg">{report.timeMonth}</p>
                        <p className="text-xs text-muted-foreground">{report.dateLabels.month}</p>
                    </div>
                </div>
            </CardContent>
          </Card>
          
          <Card>
             <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <Briefcase className="h-6 w-6 text-primary"/>
                    Commesse Lavorate nel Periodo
                </CardTitle>
                <CardDescription>Elenco delle commesse a cui l'operatore ha contribuito nel periodo selezionato.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Commessa (PF)</TableHead>
                          <TableHead>Articolo</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Fase Lavorata</TableHead>
                          <TableHead>Tempo Impiegato</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.jobsWorkedOn.length > 0 ? report.jobsWorkedOn.flatMap(job => 
                          job.phases.map((phase, index) => (
                            <TableRow key={`${job.id}-${phase.date}-${phase.name}`}>
                              {index === 0 ? (
                                <>
                                  <TableCell rowSpan={job.phases.length} className="font-medium align-top border-b">{job.id}</TableCell>
                                  <TableCell rowSpan={job.phases.length} className="align-top border-b">{job.details}</TableCell>
                                  <TableCell rowSpan={job.phases.length} className="align-top border-b">{job.cliente}</TableCell>
                                </>
                              ) : null}
                              <TableCell>{format(parseISO(phase.date), 'dd/MM/yyyy')}</TableCell>
                              <TableCell>{phase.name}</TableCell>
                              <TableCell>{phase.time}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">Nessuna attività registrata per questo operatore nel periodo selezionato.</TableCell>
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
