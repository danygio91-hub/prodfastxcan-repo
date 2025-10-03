

"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';

import { type WorkGroup } from '@/lib/mock-data';
import { dissolveWorkGroup } from './actions';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { Combine, Trash2, Loader2, Unlink, Search, Link as LinkIcon } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { useRouter } from 'next/navigation';

function WorkGroupManagementContent() {
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupIdFromUrl = searchParams.get('groupId');
  
  useEffect(() => {
    if (groupIdFromUrl) {
      setSearchTerm(groupIdFromUrl);
    }
  }, [groupIdFromUrl]);

  useEffect(() => {
    setIsLoading(true);
    const groupsRef = collection(db, 'workGroups');
    const q = query(groupsRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedGroups: WorkGroup[] = snapshot.docs.map(doc => {
            const data = doc.data();
            if (data.createdAt && typeof data.createdAt.toDate === 'function') {
                data.createdAt = data.createdAt.toDate().toISOString();
            }
            return { id: doc.id, ...data } as WorkGroup;
        });
        setGroups(JSON.parse(JSON.stringify(fetchedGroups)));
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching realtime groups:", error);
        toast({
            variant: "destructive",
            title: "Errore di Sincronizzazione",
            description: "Impossibile caricare i gruppi in tempo reale."
        });
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const filteredGroups = useMemo(() => {
    return searchTerm
      ? groups.filter(g => 
          g.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          g.jobOrderPFs?.some(pf => pf.toLowerCase().includes(searchTerm.toLowerCase()))
        )
      : groups;
  }, [groups, searchTerm]);

  const activeGroups = useMemo(() => filteredGroups.filter(g => g.status !== 'completed'), [filteredGroups]);
  const completedGroups = useMemo(() => filteredGroups.filter(g => g.status === 'completed'), [filteredGroups]);

  const handleDissolve = async (groupId: string) => {
    setIsPending(true);
    const result = await dissolveWorkGroup(groupId);
    toast({
        title: result.success ? "Successo" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    // Real-time listener will update the state, no need for manual fetch
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
  
  const renderGroupTable = (groupList: WorkGroup[]) => (
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
            {isLoading ? renderLoading() : groupList.length > 0 ? (
              groupList.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-mono text-xs flex items-center gap-2">
                     <Link href={`/admin/production-console?groupId=${group.id}`} title="Vedi commesse nella console">
                         <LinkIcon className="h-4 w-4 text-primary hover:text-primary/80"/>
                     </Link>
                    {group.id}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {(group.jobOrderPFs || []).map(pf => <Badge key={pf} variant="secondary">{pf}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="font-bold">{group.totalQuantity}</TableCell>
                  <TableCell><Badge variant={group.status === 'completed' ? 'default' : 'outline'}>{group.status}</Badge></TableCell>
                  <TableCell className="text-right">
                      {group.status !== 'completed' && (
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
                      )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24">
                  {searchTerm ? "Nessun gruppo trovato per la ricerca." : "Nessun gruppo in questa categoria."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
  );

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <header>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Combine className="h-8 w-8 text-primary" />
              Gestione Gruppi di Commesse
            </h1>
            <p className="text-muted-foreground mt-2">
              Visualizza e annulla i gruppi di commesse concatenate in produzione.
            </p>
          </header>

          <Card>
            <CardHeader>
               <div className="flex justify-between items-center flex-wrap gap-4">
                  <CardTitle>Elenco Gruppi</CardTitle>
                  <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cerca per ID gruppo o commessa..."
                      className="pl-9 w-full sm:w-80"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="active">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="active">In Corso ({activeGroups.length})</TabsTrigger>
                  <TabsTrigger value="completed">Completati ({completedGroups.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="active" className="pt-4">
                  {renderGroupTable(activeGroups)}
                </TabsContent>
                <TabsContent value="completed" className="pt-4">
                  {renderGroupTable(completedGroups)}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}

export default function WorkGroupManagementPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <WorkGroupManagementContent />
        </Suspense>
    )
}

    