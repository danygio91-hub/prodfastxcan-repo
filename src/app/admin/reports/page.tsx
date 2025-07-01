
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Users, Briefcase, ChevronRight } from 'lucide-react';
import { getJobsReport, getOperatorsReport } from './actions';
import { cn } from '@/lib/utils';
import type { OverallStatus } from '@/lib/types';


function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge
      className={cn(
        "text-xs font-semibold",
        status === "In Lavorazione" && "bg-accent text-accent-foreground",
        status === "Completata" && "bg-primary text-primary-foreground",
        status === "Problema" && "bg-destructive text-destructive-foreground"
      )}
    >
      {status}
    </Badge>
  );
}

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const jobsReport = await getJobsReport();
  const operatorsReport = await getOperatorsReport();

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <AdminNavMenu />

          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <BarChart3 className="h-8 w-8 text-primary" />
                Reportistica Avanzata
            </h1>
            <p className="text-muted-foreground">
              Analizza le performance di produzione per commesse e operatori.
            </p>
          </header>

          <Tabs defaultValue="commesse">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="commesse">
                <Briefcase className="mr-2 h-4 w-4"/>
                Report Commesse
              </TabsTrigger>
              <TabsTrigger value="operatori">
                <Users className="mr-2 h-4 w-4"/>
                Report Operatori
              </TabsTrigger>
            </TabsList>

            <TabsContent value="commesse">
              <Card>
                <CardHeader>
                  <CardTitle>Riepilogo Lavorazioni per Commessa</CardTitle>
                  <CardDescription>Elenco delle commesse in lavorazione o completate.</CardDescription>
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
                  <CardTitle>Riepilogo Ore per Operatore</CardTitle>
                  <CardDescription>Sommario delle ore di lavoro registrate dagli operatori.</CardDescription>
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
                            </TableRow>
                            )) : (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">Nessun operatore trovato.</TableCell>
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
      </AppShell>
    </AdminAuthGuard>
  );
}
