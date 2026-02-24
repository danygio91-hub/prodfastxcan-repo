"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { 
  Package, 
  Search, 
  Edit, 
  History, 
  Trash2, 
  Loader2, 
  ChevronRight, 
  LinkIcon 
} from 'lucide-react';
import { type GroupedBatches, type EnrichedBatch, getMaterialWithdrawalsForMaterial, getAllGroupedBatches } from './actions';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import BatchFormDialog from './BatchFormDialog';
import { 
  Dialog, 
  DialogClose, 
  DialogTitle, 
  DialogHeader, 
  DialogDescription, 
  DialogFooter, 
  DialogContent 
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { deleteSingleWithdrawalAndRestoreStock, deleteBatchFromRawMaterial } from '../raw-material-management/actions';
import { formatDisplayStock } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string; 
  description: string;
  quantity: number; 
  unit: string;
  id: string; 
};

interface BatchManagementClientPageProps {
  initialGroupedBatches: GroupedBatches[];
}

export default function BatchManagementClientPage({ initialGroupedBatches }: BatchManagementClientPageProps) {
  const [groupedBatches, setGroupedBatches] = useState<GroupedBatches[]>(initialGroupedBatches);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [editingBatchInfo, setEditingBatchInfo] = useState<{material: GroupedBatches, batch: EnrichedBatch | null} | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<{materialId: string, batchId: string} | null>(null);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [historyDialogData, setHistoryDialogData] = useState<{ material: GroupedBatches, lotto: string | null } | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [withdrawalToDelete, setWithdrawalToDelete] = useState<string | null>(null);

  const { toast } = useToast();

  const handleOpenHistoryDialog = useCallback(async (material: GroupedBatches, lotto: string | null, isRefresh: boolean = false) => {
    if (!isRefresh) {
      setHistoryDialogData({ material, lotto });
      setMaterialMovements([]);
      setIsHistoryDialogOpen(true);
    }
    
    try {
      const withdrawals = await getMaterialWithdrawalsForMaterial(material.materialId, lotto);
      const currentMaterialStateResponse = await getAllGroupedBatches(material.materialCode);
      const currentMaterialState = currentMaterialStateResponse.find(g => g.materialId === material.materialId) || material;
      const lotInfo = currentMaterialState.lots.find(l => l.lotto === lotto);
      const lotBatches = lotInfo ? lotInfo.batches : [];
      
      const combinedMovements: Movement[] = [
        ...lotBatches.map((b): Movement => ({ 
          type: 'Carico', 
          date: b.date, 
          description: b.inventoryRecordId ? `Inventario - Lotto: ${b.lotto || 'INV'}` : `Carico Manuale - Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`, 
          quantity: b.netQuantity, 
          unit: material.unitOfMeasure.toUpperCase(), 
          id: b.id 
        })),
        ...withdrawals.map((w): Movement => {
              const quantity = w.consumedUnits || w.consumedWeight;
              const unit = w.consumedUnits ? material.unitOfMeasure.toUpperCase() : 'KG';
              return { 
                type: 'Scarico', 
                date: w.withdrawalDate.toISOString(), 
                description: `Commesse: ${w.jobOrderPFs.join(', ')}`, 
                quantity: -(quantity || 0), 
                unit: unit, 
                id: w.id 
              };
          }),
      ];
      combinedMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setMaterialMovements(combinedMovements);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Errore caricamento storico' });
    }
  }, [toast]);

  const refreshData = useCallback(async () => {
     if (searchTerm.length >= 2) {
        setIsDataLoading(true);
        const results = await getAllGroupedBatches(searchTerm);
        setGroupedBatches(results);
        setIsDataLoading(false);
      } else {
        setGroupedBatches([]);
      }
     if (isHistoryDialogOpen && historyDialogData) {
      await handleOpenHistoryDialog(historyDialogData.material, historyDialogData.lotto, true);
    }
  }, [searchTerm, isHistoryDialogOpen, historyDialogData, handleOpenHistoryDialog]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.length >= 2) {
        setIsDataLoading(true);
        getAllGroupedBatches(searchTerm).then(results => {
          setGroupedBatches(results);
          setIsDataLoading(false);
        });
      } else {
        setGroupedBatches([]);
      }
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const handleDeleteBatch = async () => {
    if (!batchToDelete) return;
    const { materialId, batchId } = batchToDelete;
    const result = await deleteBatchFromRawMaterial(materialId, batchId);
    toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) refreshData();
    setBatchToDelete(null);
  };
  
  const handleDeleteWithdrawal = async () => {
    if (!withdrawalToDelete) return;
    const result = await deleteSingleWithdrawalAndRestoreStock(withdrawalToDelete);
    toast({ title: result.success ? "Successo" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) refreshData();
    setWithdrawalToDelete(null);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          Gestione Lotti Materie Prime
        </h1>
        <p className="text-muted-foreground">Visualizza e gestisci i lotti caricati a magazzino.</p>
      </header>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div><CardTitle>Anagrafica Lotti</CardTitle><CardDescription>Ricerca per codice materiale.</CardDescription></div>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Cerca materiale (min 2 caratteri)..." 
                className="pl-9 w-full sm:w-64" 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full space-y-4">
             {isDataLoading ? (
               <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
                 <Loader2 className="h-5 w-5 animate-spin" />
                 <span>Caricamento lotti...</span>
               </div>
             ) : groupedBatches.length > 0 ? (
              groupedBatches.map((group) => (
                <AccordionItem value={group.materialId} key={group.materialId} className="border rounded-lg bg-card shadow-sm">
                  <AccordionTrigger className="p-4 hover:no-underline">
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/raw-material-management?code=${encodeURIComponent(group.materialCode)}`} className="font-semibold text-lg hover:text-primary hover:underline">
                          {group.materialCode}
                        </Link>
                        <LinkIcon className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="secondary">{group.lots.length} Lotti</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{group.materialDescription}</p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-bold text-xl">{formatDisplayStock(group.currentStockUnits, group.unitOfMeasure)} <span className="text-sm font-normal text-muted-foreground">{group.unitOfMeasure.toUpperCase()}</span></p>
                      <p className="text-xs text-muted-foreground">({formatDisplayStock(group.currentWeightKg, 'kg')} KG)</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0 border-t">
                    <div className="space-y-2 p-4 bg-muted/50">
                      {group.lots.map((lotInfo) => (
                        <Collapsible key={lotInfo.lotto} className="border rounded-md bg-card shadow-sm">
                            <CollapsibleTrigger className="p-3 flex justify-between items-center w-full group hover:bg-accent/50">
                              <div className="flex items-center gap-4">
                                <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                                <div className="text-left">
                                  <p className="font-semibold font-mono">{lotInfo.lotto}</p>
                                  <p className="text-xs text-muted-foreground">Primo carico: {lotInfo.firstLoadDate ? format(parseISO(lotInfo.firstLoadDate), 'dd/MM/yyyy') : 'N/D'}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className={cn("font-bold", lotInfo.available < 0 && "text-destructive")}>{formatDisplayStock(lotInfo.available, group.unitOfMeasure)} {group.unitOfMeasure.toUpperCase()}</p>
                                <p className="text-xs text-muted-foreground">Carico: {formatDisplayStock(lotInfo.totalLoaded, group.unitOfMeasure)} | Scarico: {formatDisplayStock(lotInfo.totalWithdrawn, group.unitOfMeasure)}</p>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="border-t p-2">
                                <div className="flex justify-end p-2">
                                  <Button variant="outline" size="sm" onClick={() => handleOpenHistoryDialog(group, lotInfo.lotto)}>
                                    <History className="mr-2 h-4 w-4" />Storico Lotto
                                  </Button>
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Data Carico</TableHead>
                                      <TableHead>Origine/DDT</TableHead>
                                      <TableHead>Quantità</TableHead>
                                      <TableHead className="text-right">Azioni</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {lotInfo.batches.map(batch => (
                                      <TableRow key={batch.id}>
                                        <TableCell>{format(parseISO(batch.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                        <TableCell className="text-xs truncate max-w-[150px]">{batch.ddt}</TableCell>
                                        <TableCell className="font-mono">{formatDisplayStock(batch.netQuantity, group.unitOfMeasure)}</TableCell>
                                        <TableCell className="text-right space-x-2">
                                          <Button variant="outline" size="icon" onClick={() => setEditingBatchInfo({material: group, batch: batch})}>
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setBatchToDelete({ materialId: group.materialId, batchId: batch.id })}>
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
                ))
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                {searchTerm.length < 2 ? "Digita almeno 2 caratteri per cercare." : "Nessun lotto trovato."}
              </div>
            )}
          </Accordion>
        </CardContent>
      </Card>

      {editingBatchInfo && (
        <BatchFormDialog 
          isOpen={!!editingBatchInfo} 
          onClose={(refresh) => { setEditingBatchInfo(null); if(refresh) refreshData(); }} 
          material={editingBatchInfo.material} 
          batch={editingBatchInfo.batch} 
        />
      )}

      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => !open && setBatchToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo carico?</AlertDialogTitle>
            <AlertDialogDescription>L'azione è irreversibile e ridurrà lo stock attuale.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBatchToDelete(null)}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBatch} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Storico: {historyDialogData?.material.materialCode} {historyDialogData?.lotto && <span className="text-primary ml-2">{historyDialogData.lotto}</span>}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead className="text-right">Quantità</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialMovements.length > 0 ? (
                  materialMovements.map(mov => (
                    <TableRow key={mov.id}>
                      <TableCell>{format(parseISO(mov.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                      <TableCell><Badge variant={mov.type === 'Carico' ? 'default' : 'destructive'}>{mov.type}</Badge></TableCell>
                      <TableCell className="text-xs truncate max-w-xs">{mov.description}</TableCell>
                      <TableCell className={cn("text-right font-mono font-bold", mov.type === 'Carico' ? 'text-green-600' : 'text-destructive')}>
                        {formatDisplayStock(mov.quantity, mov.unit.toLowerCase() as any)} {mov.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive" 
                          onClick={() => {
                            if(mov.type === 'Carico') {
                              setBatchToDelete({ materialId: historyDialogData!.material.materialId, batchId: mov.id });
                            } else {
                              setWithdrawalToDelete(mov.id);
                            }
                            setIsHistoryDialogOpen(false);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={5} className="h-24 text-center">Caricamento movimenti...</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Chiudi</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!withdrawalToDelete} onOpenChange={(open) => !open && setWithdrawalToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare scarico e ripristinare stock?</AlertDialogTitle>
            <AlertDialogDescription>L'operazione è definitiva.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setWithdrawalToDelete(null)}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteWithdrawal} className="bg-destructive">Sì, elimina e ripristina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
