
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Package, Search, Edit, History, AlertTriangle, Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { type GroupedBatches, type EnrichedBatch, getAllGroupedBatches, getMaterialWithdrawalsForMaterial } from './actions';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import BatchFormDialog from './BatchFormDialog';
import { deleteBatchFromRawMaterial } from '../raw-material-management/actions';
import { Dialog, DialogClose, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DialogContent } from '@radix-ui/react-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { deleteSingleWithdrawalAndRestoreStock } from '../raw-material-management/actions';

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string; // ISO String
  description: string;
  quantity: number; // Positive for income, negative for outcome
  unit: string;
  id: string; // Batch or Withdrawal ID
};

interface BatchManagementClientPageProps {
  initialGroupedBatches: GroupedBatches[];
}

export default function BatchManagementClientPage({ initialGroupedBatches }: BatchManagementClientPageProps) {
  const [groupedBatches, setGroupedBatches] = useState<GroupedBatches[]>(initialGroupedBatches);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingBatchInfo, setEditingBatchInfo] = useState<{material: GroupedBatches, batch: EnrichedBatch} | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<{materialId: string, batchId: string} | null>(null);
  
  // State for history dialog
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [historyMaterial, setHistoryMaterial] = useState<GroupedBatches | null>(null);
  const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);
  const [withdrawalToDelete, setWithdrawalToDelete] = useState<string | null>(null);


  const router = useRouter();
  const { toast } = useToast();

  const refreshData = async () => {
    const freshData = await getAllGroupedBatches();
    setGroupedBatches(freshData);
     if (isHistoryDialogOpen && historyMaterial) {
      // If history dialog is open, re-fetch its content
      await handleOpenHistoryDialog(historyMaterial, true);
    }
  };

  useEffect(() => {
    setGroupedBatches(initialGroupedBatches);
  }, [initialGroupedBatches]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) {
      return groupedBatches;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return groupedBatches.filter(group =>
      group.materialCode.toLowerCase().includes(lowercasedFilter) ||
      group.materialDescription.toLowerCase().includes(lowercasedFilter) ||
      group.batches.some(b => b.lotto?.toLowerCase().includes(lowercasedFilter))
    );
  }, [groupedBatches, searchTerm]);
  
  const handleBatchFormClose = (refresh?: boolean) => {
    setEditingBatchInfo(null);
    if(refresh) {
      refreshData();
    }
  }
  
  const handleDeleteBatch = async () => {
    if (!batchToDelete) return;
    const { materialId, batchId } = batchToDelete;
    const result = await deleteBatchFromRawMaterial(materialId, batchId);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setBatchToDelete(null);
  };
  
  const handleOpenHistoryDialog = async (material: GroupedBatches, isRefresh: boolean = false) => {
    if (!isRefresh) {
      setHistoryMaterial(material);
      setIsHistoryDialogOpen(true);
    }

    const withdrawals = await getMaterialWithdrawalsForMaterial(material.materialId);
    const updatedMaterial = groupedBatches.find(m => m.materialId === material.materialId) || material;
    const batches = updatedMaterial.batches || [];
    
    const combinedMovements: Movement[] = [
        ...batches.map((b): Movement => {
             if (b.inventoryRecordId) {
                // If from inventory, the quantity is the net weight in KG.
                return {
                    type: 'Carico' as const,
                    date: b.date,
                    description: `Inventario - Lotto: ${b.lotto || 'INV'}`,
                    quantity: b.grossWeight - b.tareWeight, // This is the net weight in KG
                    unit: 'KG',
                    id: b.id,
                };
            } else {
                 // For manual batches, netQuantity is in the correct primary unit.
                return {
                    type: 'Carico' as const,
                    date: b.date,
                    description: `Carico Manuale - Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
                    quantity: b.netQuantity,
                    unit: updatedMaterial.unitOfMeasure.toUpperCase(),
                    id: b.id,
                };
            }
        }),
        ...withdrawals.map((w): Movement => {
            const isWeightBased = (w.consumedUnits === null || w.consumedUnits === undefined);
            const quantity = isWeightBased ? w.consumedWeight : w.consumedUnits;
            const unit = isWeightBased ? 'KG' : material.unitOfMeasure.toUpperCase();
            return {
                type: 'Scarico' as const,
                date: w.withdrawalDate.toISOString(),
                description: `Commesse: ${w.jobOrderPFs.join(', ')}`,
                quantity: -(quantity || 0),
                unit: unit,
                id: w.id,
            };
        }),
    ];

    combinedMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setMaterialMovements(combinedMovements);
  };
  
  const handleDeleteWithdrawal = async () => {
    if (!withdrawalToDelete) return;
    const result = await deleteSingleWithdrawalAndRestoreStock(withdrawalToDelete);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setWithdrawalToDelete(null);
  };
  
   const formatHistoryQuantity = (quantity: number, unit: string) => {
      const lowerUnit = unit.toLowerCase();
      if (lowerUnit === 'n') return Math.round(quantity);
      if (lowerUnit === 'mt') return quantity.toFixed(1);
      return quantity.toFixed(3);
  }


  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          Gestione Lotti Materie Prime
        </h1>
        <p className="text-muted-foreground">
          Visualizza, cerca e gestisci tutti i lotti caricati a magazzino, raggruppati per materiale.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <CardTitle>Anagrafica Lotti</CardTitle>
              <CardDescription>
                Ricerca per codice o descrizione materiale per trovare rapidamente le informazioni.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca materiale..."
                className="pl-9 w-full sm:w-64"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full space-y-4">
             {filteredGroups.length > 0 ? (
              filteredGroups.map((group) => (
                <AccordionItem value={group.materialId} key={group.materialId} className="border rounded-lg bg-card shadow-sm">
                  <AccordionTrigger className="p-4 hover:no-underline">
                    <div className="flex-1 text-left">
                       <div className="flex items-center gap-2">
                           <h3 className="font-semibold text-lg">{group.materialCode}</h3>
                           <Badge variant="secondary">{group.batches.length} Lotti</Badge>
                       </div>
                      <p className="text-sm text-muted-foreground">{group.materialDescription}</p>
                    </div>
                     <div className="text-right ml-4">
                         <p className="font-bold text-xl">{group.unitOfMeasure === 'n' ? Math.floor(group.currentStockUnits) : group.currentStockUnits.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">{group.unitOfMeasure.toUpperCase()}</span></p>
                         <p className="text-xs text-muted-foreground">({group.currentWeightKg.toFixed(2)} KG)</p>
                     </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <div className="overflow-x-auto border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>N° Lotto</TableHead>
                            <TableHead>Data Carico</TableHead>
                            <TableHead>Origine/DDT</TableHead>
                            <TableHead>Quantità Caricata</TableHead>
                            <TableHead className="text-right">Azioni</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.batches.map(batch => (
                            <TableRow key={batch.id}>
                              <TableCell className="font-semibold font-mono">{batch.lotto || 'N/D'}</TableCell>
                              <TableCell>{format(parseISO(batch.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                              <TableCell>{batch.ddt}</TableCell>
                              <TableCell>{batch.netQuantity.toFixed(2)} {group.unitOfMeasure.toUpperCase()}</TableCell>
                              <TableCell className="text-right space-x-2">
                                <Button variant="outline" size="sm" onClick={() => handleOpenHistoryDialog(group)}>
                                    <History className="mr-2 h-4 w-4" />
                                    Storico
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => setEditingBatchInfo({material: group, batch: batch})}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-destructive">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                      <AlertDialogDescription>Stai per eliminare il lotto <span className="font-bold">{batch.lotto}</span>. L'azione è irreversibile e lo stock verrà ricalcolato.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => setBatchToDelete({ materialId: group.materialId, batchId: batch.id })}>
                                        Elimina Lotto
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))
            ) : (
              <div className="text-center py-10 text-muted-foreground">Nessun lotto trovato.</div>
            )}
          </Accordion>
        </CardContent>
      </Card>
      
      {editingBatchInfo && (
        <BatchFormDialog
          isOpen={!!editingBatchInfo}
          onClose={handleBatchFormClose}
          material={editingBatchInfo.material}
          batch={editingBatchInfo.batch}
        />
      )}

      {/* Delete Batch Confirmation Dialog */}
      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => !open && setBatchToDelete(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Sei sicuro di voler eliminare questo lotto?</AlertDialogTitle>
                <AlertDialogDescription>
                    Questa azione è irreversibile. Lo stock totale verrà ricalcolato.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setBatchToDelete(null)}>Annulla</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteBatch} className="bg-destructive hover:bg-destructive/90">Elimina</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
       {/* History Dialog */}
       <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Storico Movimenti per: {historyMaterial?.materialCode}</DialogTitle>
                    <DialogDescription>
                        Elenco di tutti i carichi e scarichi registrati per questo materiale.
                    </DialogDescription>
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
                                <TableCell>
                                    <Badge variant={mov.type === 'Carico' ? 'default' : 'destructive'} className={cn(mov.type === 'Carico' && 'bg-green-600 hover:bg-green-700')}>
                                      {mov.type === 'Carico' ? <ArrowUpCircle className="mr-2 h-4 w-4"/> : <ArrowDownCircle className="mr-2 h-4 w-4"/>}
                                      {mov.type}
                                    </Badge>
                                </TableCell>
                                <TableCell>{mov.description}</TableCell>
                                <TableCell className={cn("text-right font-mono", mov.type === 'Carico' ? 'text-green-500' : 'text-destructive')}>
                                  {formatHistoryQuantity(mov.quantity, mov.unit)} {mov.unit}
                                </TableCell>
                                <TableCell className="text-right">
                                  {mov.type === 'Carico' ? (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per eliminare il lotto caricato. L'azione è irreversibile e lo stock verrà ricalcolato.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel onClick={() => setBatchToDelete(null)}>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => {setBatchToDelete({ materialId: historyMaterial!.materialId, batchId: mov.id }); setIsHistoryDialogOpen(false);}}>Elimina Lotto</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  ) : (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Sei sicuro?</AlertDialogTitle><AlertDialogDescription>Stai per eliminare questo scarico. L'azione è irreversibile e la quantità verrà ripristinata a magazzino.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel onClick={() => setWithdrawalToDelete(null)}>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => {setWithdrawalToDelete(mov.id); setIsHistoryDialogOpen(false);}}>Elimina Scarico</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </TableCell>
                            </TableRow>
                            ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">Nessuno storico movimenti per questo materiale.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                </ScrollArea>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Chiudi</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Delete Withdrawal Confirmation Dialog */}
        <AlertDialog open={!!withdrawalToDelete} onOpenChange={(open) => !open && setWithdrawalToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sei sicuro di voler eliminare questo scarico?</AlertDialogTitle>
              <AlertDialogDescription>
                L'azione è irreversibile e lo stock del materiale verrà ripristinato.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setWithdrawalToDelete(null)}>Annulla</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteWithdrawal} className="bg-destructive hover:bg-destructive/90">Sì, elimina scarico</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

    </div>
  );
}
