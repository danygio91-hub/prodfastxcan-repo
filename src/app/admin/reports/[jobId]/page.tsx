import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getJobDetailReport } from '../actions';
import { notFound } from 'next/navigation';
import { BarChart3, ArrowLeft, Package, User, Clock, Calendar, CheckCircle2, Circle, Hourglass, ShieldAlert, XCircle } from 'lucide-react';
import type { JobPhase } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function getPhaseIcon(status: JobPhase['status'], qualityResult?: JobPhase['qualityResult']) {
  if (status === 'completed') {
    if (qualityResult === 'passed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (qualityResult === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  }
  switch (status) {
    case 'pending': return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'in-progress': return <Hourglass className="h-4 w-4 text-yellow-500 animate-spin" />;
    case 'paused': return <Hourglass className="h-4 w-4 text-orange-500" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

export default async function JobReportDetailPage({ params }: { params: { jobId: string } }) {
  const report = await getJobDetailReport(params.jobId);

  if (!report) {
    notFound();
  }

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />

          <Button asChild variant="outline" className="w-fit">
            <Link href="/admin/reports">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Torna ai Report
            </Link>
          </Button>

          <header>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              Dettaglio Commessa: {report.id}
            </h1>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Riepilogo Commessa</CardTitle>
              {report.isProblemReported && (
                <CardDescription className="text-destructive font-semibold flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" /> Problema Segnalato
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
                <div className="flex items-center gap-3">
                    <Package className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Articolo</p>
                        <p className="font-semibold">{report.details}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <User className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Cliente</p>
                        <p className="font-semibold">{report.cliente}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Tempo Totale Lavorazione</p>
                        <p className="font-semibold">{report.totalTimeElapsed}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Calendar className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Data Consegna Prevista</p>
                        <p className="font-semibold">{report.dataConsegnaFinale || 'N/D'}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cn(report.status === 'completed' ? 'border-green-500 text-green-500' : 'border-yellow-500 text-yellow-500')}>Stato</Badge>
                    <div>
                        <p className="text-muted-foreground">Stato Globale</p>
                        <p className="font-semibold">{report.status === 'completed' ? 'Completata' : 'In Lavorazione'}</p>
                    </div>
                </div>
            </CardContent>
          </Card>
          
          <Card>
             <CardHeader>
                <CardTitle>Dettaglio Fasi</CardTitle>
                <CardDescription>Analisi dei tempi e degli operatori per ogni fase di lavorazione.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fase</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead>Esito</TableHead>
                          <TableHead>Tempo Impiegato</TableHead>
                          <TableHead>Operatori</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.phases.length > 0 ? report.phases.sort((a,b) => a.sequence - b.sequence).map((phase) => (
                          <TableRow key={phase.id}>
                            <TableCell className="font-medium">{phase.name}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    {getPhaseIcon(phase.status, phase.qualityResult)}
                                    <span>{phase.status.charAt(0).toUpperCase() + phase.status.slice(1)}</span>
                                </div>
                            </TableCell>
                            <TableCell>
                                {phase.qualityResult === 'passed' && <Badge className="bg-green-600 hover:bg-green-700">Superato</Badge>}
                                {phase.qualityResult === 'failed' && <Badge variant="destructive">Fallito</Badge>}
                            </TableCell>
                            <TableCell>{phase.timeElapsed}</TableCell>
                            <TableCell>{phase.operators}</TableCell>
                          </TableRow>
                        )) : (
                             <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">Nessuna fase definita per questa commessa.</TableCell>
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
