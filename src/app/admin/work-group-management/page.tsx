"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';

import { type WorkGroup } from '@/lib/mock-data';
import { getWorkGroups, dissolveWorkGroup } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { Combine, Trash2, Loader2, Unlink } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { useRouter } from 'next/navigation';

export default function WorkGroupManagementPage() {
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const fetchGroups = async () => {
    setIsLoading(true);
    const data = await getWorkGroups();
    setGroups(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleDissolve = async (groupId: string) => {
    setIsPending(true);
    const result = await dissolveWorkGroup(groupId);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      await fetchGroups();
    }
    setIsPending(false);
  };
  
  const renderLoading = () => (
      <TableRow>
          <TableCell colSpan={5} className="h-24 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Caricamento gruppi...</span>
              </div>
          </TableCell>
      </TableRow>
  );

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <header>
              <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Combine className="h-8 w-8 text-primary" />
                Gestione Gruppi di Commesse
              </h1>
              <p className="text-muted-foreground mt-2">
                Visualizza e annulla i gruppi di commesse concatenate in produzione.
              </p>
            </header>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Elenco Gruppi Attivi</CardTitle>
              <CardDescription>
                Questi gruppi rappresentano più commesse lavorate simultaneamente. L'annullamento di un gruppo riporterà le commesse al loro stato individuale.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID Gruppo</TableHead>
                      <TableHead>Commesse nel Gruppo</TableHead>
                      <TableHead>Q.tà Totale</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? renderLoading() : groups.length > 0 ? (
                      groups.map((group) => (
                        <TableRow key={group.id}>
                          <TableCell className="font-mono text-xs">{group.id}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(group.jobOrderPFs || []).map(pf => <Badge key={pf} variant="secondary">{pf}</Badge>)}
                            </div>
                          </TableCell>
                          <TableCell className="font-bold">{group.totalQuantity}</TableCell>
                          <TableCell><Badge variant={group.status === 'completed' ? 'default' : 'outline'}>{group.status}</Badge></TableCell>
                          <TableCell className="text-right">
                             <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isPending}>
                                  <Unlink className="mr-2 h-4 w-4" />
                                  Annulla Gruppo
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sei sicuro di voler annullare questo gruppo?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Questa azione è irreversibile. Le commesse torneranno ad essere individuali. Eventuali avanzamenti registrati sul gruppo andranno persi.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Chiudi</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDissolve(group.id)}>Sì, annulla gruppo</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">Nessun gruppo di commesse attivo.</TableCell>
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
