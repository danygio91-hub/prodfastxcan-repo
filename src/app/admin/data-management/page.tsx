
"use client";

import React from 'react';
import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ListChecks, Package } from 'lucide-react';
import { mockJobOrders, type JobOrder } from '@/lib/mock-data';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';

export default function AdminDataManagementCommessePage() {
  const jobOrders: JobOrder[] = mockJobOrders;

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <Link href="/admin/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Torna alla Dashboard Admin
            </Button>
          </Link>

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <ListChecks className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline mb-1">Gestione Dati: Elenco Commesse</CardTitle>
                  <CardDescription>Visualizza le commesse di produzione esistenti.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {jobOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ordine PF</TableHead>
                      <TableHead>N° ODL</TableHead>
                      <TableHead>Reparto</TableHead>
                      <TableHead className="min-w-[250px]">Descrizione Lavorazione</TableHead>
                      <TableHead>Data Consegna</TableHead>
                      <TableHead>Postazione Lavoro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobOrders.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">{job.ordinePF}</TableCell>
                        <TableCell>{job.numeroODL}</TableCell>
                        <TableCell>{job.department}</TableCell>
                        <TableCell>{job.details}</TableCell>
                        <TableCell>
                          {format(new Date(job.dataConsegnaFinale), "dd MMM yyyy", { locale: it })}
                        </TableCell>
                        <TableCell>{job.postazioneLavoro}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-lg font-semibold text-muted-foreground">Nessuna commessa trovata.</p>
                  <p className="text-sm text-muted-foreground">
                    Non ci sono commesse attualmente nel sistema.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
