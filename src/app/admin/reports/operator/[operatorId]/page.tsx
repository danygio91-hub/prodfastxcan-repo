
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { getOperatorDetailReport } from '../../actions';
import { notFound } from 'next/navigation';
import { ArrowLeft, User, Clock, Calendar, Briefcase } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function OperatorReportDetailPage({ params }: { params: { operatorId: string } }) {
  const report = await getOperatorDetailReport(params.operatorId);

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
              <User className="h-8 w-8 text-primary" />
              Dettaglio Operatore: {report.operator.nome}
            </h1>
            <p className="text-muted-foreground">Report dettagliato delle attività e delle ore di lavoro.</p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Riepilogo Ore</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
                <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <Clock className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Oggi)</p>
                        <p className="font-semibold text-lg">{report.timeToday}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <Calendar className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Settimana)</p>
                        <p className="font-semibold text-lg">{report.timeWeek}</p>
                    </div>
                </div>
                 <div className="flex items-center gap-3 p-4 bg-background rounded-lg border">
                    <Calendar className="h-6 w-6 text-primary"/>
                    <div>
                        <p className="text-muted-foreground">Ore Lavorate (Mese)</p>
                        <p className="font-semibold text-lg">{report.timeMonth}</p>
                    </div>
                </div>
            </CardContent>
          </Card>
          
          <Card>
             <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <Briefcase className="h-6 w-6 text-primary"/>
                    Commesse Lavorate
                </CardTitle>
                <CardDescription>Elenco delle commesse a cui l'operatore ha contribuito.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Commessa (PF)</TableHead>
                          <TableHead>Articolo</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Fase Lavorata</TableHead>
                          <TableHead>Tempo Impiegato</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.jobsWorkedOn.length > 0 ? report.jobsWorkedOn.flatMap(job => 
                          job.phases.map((phase, index) => (
                            <TableRow key={`${job.id}-${phase.name}`}>
                              {index === 0 ? (
                                <>
                                  <TableCell rowSpan={job.phases.length} className="font-medium align-top border-b">{job.id}</TableCell>
                                  <TableCell rowSpan={job.phases.length} className="align-top border-b">{job.details}</TableCell>
                                  <TableCell rowSpan={job.phases.length} className="align-top border-b">{job.cliente}</TableCell>
                                </>
                              ) : null}
                              <TableCell>{phase.name}</TableCell>
                              <TableCell>{phase.time}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                             <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">Nessuna attività registrata per questo operatore.</TableCell>
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
