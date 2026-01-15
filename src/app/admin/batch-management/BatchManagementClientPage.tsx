
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import Link from 'next/link';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Package, Search, Link as LinkIcon, Edit } from 'lucide-react';
import type { EnrichedBatch } from './actions';

interface BatchManagementClientPageProps {
  initialBatches: EnrichedBatch[];
}

export default function BatchManagementClientPage({ initialBatches }: BatchManagementClientPageProps) {
  const [batches, setBatches] = useState<EnrichedBatch[]>(initialBatches);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  useEffect(() => {
    setBatches(initialBatches);
  }, [initialBatches]);

  const filteredBatches = useMemo(() => {
    if (!searchTerm) {
      return batches;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return batches.filter(batch =>
      (batch.lotto?.toLowerCase() || '').includes(lowercasedFilter) ||
      batch.materialCode.toLowerCase().includes(lowercasedFilter)
    );
  }, [batches, searchTerm]);
  
  const handleNavigateToMaterial = (materialCode: string) => {
    router.push(`/admin/raw-material-management?code=${encodeURIComponent(materialCode)}`);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          Gestione Lotti Materie Prime
        </h1>
        <p className="text-muted-foreground">
          Visualizza, cerca e gestisci tutti i lotti caricati a magazzino.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <CardTitle>Elenco Completo Lotti</CardTitle>
              <CardDescription>
                Ricerca per lotto o codice materiale per trovare rapidamente le informazioni.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per lotto o materiale..."
                className="pl-9 w-full sm:w-64"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Lotto</TableHead>
                  <TableHead>Materia Prima</TableHead>
                  <TableHead>Data Carico</TableHead>
                  <TableHead>DDT</TableHead>
                  <TableHead>Quantità Netta</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBatches.length > 0 ? (
                  filteredBatches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-semibold font-mono">{batch.lotto || 'N/D'}</TableCell>
                      <TableCell>
                        <Button variant="link" className="p-0 h-auto" onClick={() => handleNavigateToMaterial(batch.materialCode)}>
                            {batch.materialCode}
                            <LinkIcon className="ml-2 h-3 w-3" />
                        </Button>
                      </TableCell>
                      <TableCell>{format(parseISO(batch.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                      <TableCell>{batch.ddt}</TableCell>
                      <TableCell>{batch.netQuantity.toFixed(2)} {batch.materialUnitOfMeasure.toUpperCase()}</TableCell>
                      <TableCell>
                         <Button variant="outline" size="sm" onClick={() => alert('Funzione di modifica in arrivo!')}>
                            <Edit className="mr-2 h-4 w-4" />
                            Modifica
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      Nessun lotto trovato.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
