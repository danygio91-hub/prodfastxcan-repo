

"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import Link from 'next/link';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Warehouse, Download, Check, X, Pencil, Loader2, Package, Undo2, Trash2, LinkIcon, Search, ChevronDown, ShieldCheck, ShieldX, RefreshCw } from 'lucide-react';
import { type InventoryRecord, type RawMaterial } from '@/types';
import { approveInventoryRecord, rejectInventoryRecord, revertInventoryRecordStatus, deleteInventoryRecords, approveMultipleInventoryRecords, rejectMultipleInventoryRecords, getMaterialById } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import InventoryRecordSheet from './InventoryRecordSheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDisplayStock } from '@/lib/utils';



interface InventoryClientPageProps {
  initialRecords: InventoryRecord[];
}

const statusOrder: Record<InventoryRecord['status'], number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
};

export default function InventoryClientPage({ initialRecords }: InventoryClientPageProps) {
  const [records, setRecords] = useState(initialRecords);
  const [selectedRecord, setSelectedRecord] = useState<InventoryRecord | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPending, setIsPending] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    setRecords(initialRecords);
    setSelectedRecords([]);
  }, [initialRecords]);


  const filteredRecordsBySearch = useMemo(() => {
    return searchTerm
      ? records.filter(record => 
          record.materialCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
          record.lotto.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (record.operatorName || '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      : records;
  }, [records, searchTerm]);

  const groupedRecords = useMemo(() => {
    return filteredRecordsBySearch.reduce((acc, record) => {
      const date = format(parseISO(record.recordedAt as unknown as string), 'dd.MM.yyyy');
      if (!acc[date]) {
        acc[date] = {};
      }
      const materialCode = record.materialCode;
       if (!acc[date][materialCode]) {
        acc[date][materialCode] = [];
      }
      acc[date][materialCode].push(record);
      return acc;
    }, {} as Record<string, Record<string, InventoryRecord[]>>);
  }, [filteredRecordsBySearch]);

  const sortedDates = useMemo(() => Object.keys(groupedRecords).sort((a, b) => {
    const [dayA, monthA, yearA] = a.split('.').map(Number);
    const [dayB, monthB, yearB] = b.split('.').map(Number);
    return new Date(yearB, monthB - 1, dayB).getTime() - new Date(yearA, monthA - 1, dayA).getTime();
  }), [groupedRecords]);
  
  const refreshData = () => {
    setIsRefreshing(true);
    router.refresh();
    // The useEffect listening to initialRecords will update the state.
    // We can set a timeout to turn off the loading indicator after a bit.
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleApprove = async (recordId: string) => {
    if (!user) return;
    setIsPending(recordId);
    const result = await approveInventoryRecord(recordId, user.uid);
    toast({
        title: result.success ? "Approvato!" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };
  
  const handleReject = async (recordId: string) => {
    if (!user) return;
    setIsPending(recordId);
    const result = await rejectInventoryRecord(recordId, user.uid);
    toast({
        title: result.success ? "Rifiutato" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
     if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };

  const handleRevertStatus = async (recordId: string) => {
    if (!user) return;
    setIsPending(recordId);
    const result = await revertInventoryRecordStatus(recordId, user.uid);
    toast({
        title: result.success ? "Annullato" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };

  const handleOpenSheet = (record: InventoryRecord) => {
    setSelectedRecord(record);
    setIsSheetOpen(true);
  };

  const handleExport = (date: string, dailyRecords: Record<string, InventoryRecord[]>) => {
    const dataToExport = Object.values(dailyRecords).flat().map(r => {
      const qtaN = r.materialUnitOfMeasure === 'n' ? (r.inputUnit === 'n' ? r.inputQuantity : r.netWeight / (r.conversionFactor || 1)) : 0;
      const qtaMT = (r.materialUnitOfMeasure === 'mt' || r.rapportoKgMt) ? (r.inputUnit === 'mt' ? r.inputQuantity : r.netWeight / (r.rapportoKgMt || 1)) : 0;
      
      return {
        'Codice': r.materialCode,
        'Lotto': r.lotto,
        'Quantità (N)': qtaN > 0 ? Number(qtaN.toFixed(2)) : 0,
        'Quantità (MT)': qtaMT > 0 ? Number(qtaMT.toFixed(2)) : 0,
        'Quantità (KG)': r.netWeight,
        'Peso Lordo (kg)': r.grossWeight,
        'Peso Tara (kg)': r.tareWeight,
        'Peso Netto (kg)': r.netWeight,
        'Operatore': r.operatorName,
        'Data Registrazione': format(parseISO(r.recordedAt as unknown as string), 'dd/MM/yyyy HH:mm'),
        'Stato': r.status,
      };
    });
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Inventario ${date}`);
    XLSX.writeFile(wb, `inventario_${date.replace(/\./g, '-')}.xlsx`);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRecords(filteredRecordsBySearch.map(r => r.id));
    } else {
      setSelectedRecords([]);
    }
  };

  const handleSelectRecord = (recordId: string) => {
    setSelectedRecords(prev => 
      prev.includes(recordId) 
        ? prev.filter(id => id !== recordId) 
        : [...prev, recordId]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedRecords.length === 0 || !user) return;
    setIsPending('delete-selected');
    const result = await deleteInventoryRecords(selectedRecords, user.uid);
    toast({
      title: result.success ? "Eliminazione Completata" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };

  const handleApproveSelected = async () => {
    if (selectedRecords.length === 0 || !user) return;
    setIsPending('approve-selected');
    const result = await approveMultipleInventoryRecords(selectedRecords, user.uid);
     toast({
      title: result.success ? "Operazione Completata" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };

  const handleRejectSelected = async () => {
     if (selectedRecords.length === 0 || !user) return;
    setIsPending('reject-selected');
    const result = await rejectMultipleInventoryRecords(selectedRecords, user.uid);
     toast({
      title: result.success ? "Operazione Completata" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      refreshData();
    }
    setIsPending(null);
  };


  return (
    <>
      <div className="space-y-8">
        <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                <Warehouse className="h-8 w-8 text-primary" />
                Gestione Inventari
            </h1>
            <p className="text-muted-foreground">
                Visualizza, approva o rifiuta le registrazioni di inventario effettuate dagli operatori.
            </p>
        </header>
        
        <Card>
            <CardHeader>
              <div className="flex justify-between items-center flex-wrap gap-4">
                  <div>
                    <CardTitle>Registrazioni da Processare</CardTitle>
                    <CardDescription>
                        Elenco delle registrazioni di inventario raggruppate per data.
                    </CardDescription>
                  </div>
                   <div className="flex items-center gap-2 flex-wrap">
                       <Button onClick={refreshData} variant="outline" size="sm" disabled={isRefreshing}>
                           {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
                           Aggiorna Dati
                       </Button>
                      {selectedRecords.length > 0 && (
                        <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm" disabled={isPending === 'delete-selected'}>
                                {isPending === 'delete-selected' ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                                Elimina ({selectedRecords.length})
                              </Button>
                            </AlertDialogTrigger>
                             <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Sei sicuro di voler eliminare?</AlertDialogTitle><AlertDialogDescription>Stai per eliminare {selectedRecords.length} registrazioni. Se sono state approvate, lo stock verrà stornato. Questa operazione è irreversibile.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                           <AlertDialog>
                            <AlertDialogTrigger asChild>
                               <Button size="sm" variant="outline" className="border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" disabled={isPending === 'reject-selected'}>
                                {isPending === 'reject-selected' ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldX className="mr-2 h-4 w-4" />}
                                Rifiuta ({selectedRecords.length})
                              </Button>
                            </AlertDialogTrigger>
                             <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Confermi di rifiutare?</AlertDialogTitle><AlertDialogDescription>Stai per rifiutare {selectedRecords.length} registrazioni. Verranno marcate come "rifiutate".</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleRejectSelected}>Sì, rifiuta</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                           <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={isPending === 'approve-selected'}>
                                {isPending === 'approve-selected' ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Approva ({selectedRecords.length})
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Confermi di approvare?</AlertDialogTitle><AlertDialogDescription>Stai per approvare {selectedRecords.length} registrazioni. Lo stock dei materiali verrà aggiornato. L'azione non è reversibile.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={handleApproveSelected} className="bg-green-600 hover:bg-green-700">Sì, approva</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                      <div className="relative w-full sm:w-64">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                              placeholder="Cerca per lotto, codice, operatore..."
                              className="pl-9"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                          />
                      </div>
                   </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4">
                  <Checkbox
                      id="select-all-records"
                      checked={filteredRecordsBySearch.length > 0 && selectedRecords.length === filteredRecordsBySearch.length}
                      onCheckedChange={handleSelectAll}
                  />
                  <label htmlFor="select-all-records" className="text-sm font-medium">Seleziona Tutto ({selectedRecords.length} / {filteredRecordsBySearch.length})</label>
              </div>
              {sortedDates.length > 0 ? (
                <Accordion type="multiple" className="w-full">
                  {sortedDates.map(date => {
                    const dailyRecordsByMaterial = groupedRecords[date];
                    const allDailyRecords = Object.values(dailyRecordsByMaterial).flat();
                    const pendingRecordsCount = allDailyRecords.filter(r => r.status === 'pending').length;
                    
                    return (
                      <AccordionItem value={date} key={date}>
                        <AccordionTrigger>
                          <div className="flex justify-between items-center w-full pr-4">
                            <span className="font-semibold text-lg">Inventario del {date}</span>
                            <Badge variant={pendingRecordsCount > 0 ? "destructive" : "default"}>
                              {pendingRecordsCount} in attesa
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="p-4 bg-muted/50 rounded-lg">
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id={`select-all-${date}`}
                                    checked={allDailyRecords.length > 0 && allDailyRecords.every(r => selectedRecords.includes(r.id))}
                                    onCheckedChange={(checked) => {
                                        const dailyIds = allDailyRecords.map(r => r.id);
                                        if (checked) {
                                            setSelectedRecords(prev => [...new Set([...prev, ...dailyIds])]);
                                        } else {
                                            setSelectedRecords(prev => prev.filter(id => !dailyIds.includes(id)));
                                        }
                                    }}
                                  />
                                  <label htmlFor={`select-all-${date}`} className="text-sm font-medium">Seleziona Tutto nel Giorno</label>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => handleExport(date, dailyRecordsByMaterial)}>
                                  <Download className="mr-2 h-4 w-4" />
                                  Scarica Inventario del Giorno
                                </Button>
                            </div>
                            <div className="space-y-6">
                              {Object.entries(dailyRecordsByMaterial).sort(([codeA, recordsA], [codeB, recordsB]) => {
                                const aHasPending = recordsA.some(r => r.status === 'pending');
                                const bHasPending = recordsB.some(r => r.status === 'pending');
                                if (aHasPending && !bHasPending) return -1;
                                if (!aHasPending && bHasPending) return 1;
                                return codeA.localeCompare(codeB);
                              }).map(([materialCode, recordsForMaterial]) => {
                                const sortedRecords = [...recordsForMaterial].sort((a,b) => statusOrder[a.status] - statusOrder[b.status]);
                                const materialSample = recordsForMaterial[0]; // Use a sample record to get material info
                                
                                return (
                                <Collapsible key={materialCode} defaultOpen={recordsForMaterial.some(r => r.status === 'pending')}>
                                  <CollapsibleTrigger className="w-full">
                                      <div className="font-semibold text-md mb-2 flex items-center justify-between gap-2 hover:bg-background p-2 rounded-md group">
                                          <div className="flex items-center gap-2">
                                            <Package className="h-5 w-5 text-muted-foreground"/>
                                            <Link href={`/admin/raw-material-management?code=${encodeURIComponent(materialCode)}`} className="hover:text-primary hover:underline">
                                                {materialCode}
                                            </Link>
                                            <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {recordsForMaterial.some(r => r.status === 'pending') && <Badge variant="destructive">In Attesa</Badge>}
                                            <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                                          </div>
                                      </div>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                      <div className="overflow-x-auto border rounded-lg">
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                               <TableHead padding="checkbox">
                                                <Checkbox
                                                  checked={recordsForMaterial.length > 0 && recordsForMaterial.every(r => selectedRecords.includes(r.id))}
                                                  onCheckedChange={(checked) => {
                                                    const recordIds = recordsForMaterial.map(r => r.id);
                                                    if (checked) {
                                                      setSelectedRecords(prev => [...new Set([...prev, ...recordIds])]);
                                                    } else {
                                                      setSelectedRecords(prev => prev.filter(id => !recordIds.includes(id)));
                                                    }
                                                  }}
                                                />
                                              </TableHead>
                                              <TableHead>Lotto</TableHead>
                                              <TableHead>Qtà (N)</TableHead>
                                              <TableHead>Qtà (MT)</TableHead>
                                              <TableHead>Qtà (KG)</TableHead>
                                              <TableHead>Peso Lordo</TableHead>
                                              <TableHead>Tara</TableHead>
                                              <TableHead>Peso Netto</TableHead>
                                              <TableHead>Operatore</TableHead>
                                              <TableHead>Stato</TableHead>
                                              <TableHead className="text-right">Azioni</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {sortedRecords.map(record => {
                                                if (!record.materialUnitOfMeasure) {
                                                  return (
                                                    <TableRow key={record.id}>
                                                      <TableCell colSpan={11}>
                                                        <div className="flex items-center gap-2">
                                                          <Skeleton className="h-4 w-4 rounded-full" />
                                                          <Skeleton className="h-4 w-24" />
                                                        </div>
                                                      </TableCell>
                                                    </TableRow>
                                                  );
                                                }

                                                let qtaN = '-';
                                                let qtaMT = '-';
                                                let qtaKG = formatDisplayStock(record.netWeight, 'kg');

                                                if (record.materialUnitOfMeasure === 'n') {
                                                    const val = record.inputUnit === 'n' ? record.inputQuantity : record.netWeight / (record.conversionFactor || 1);
                                                    qtaN = formatDisplayStock(val, 'n');
                                                } else if (record.materialUnitOfMeasure === 'mt') {
                                                    const val = record.inputUnit === 'mt' ? record.inputQuantity : record.netWeight / (record.rapportoKgMt || 1);
                                                    qtaMT = formatDisplayStock(val, 'mt');
                                                }
                                                
                                                // High Contrast Fix: if it's a BOB (kg) but has rapportKgMt, show MT too
                                                if (record.materialUnitOfMeasure === 'kg' && record.rapportoKgMt && record.rapportoKgMt > 0) {
                                                    qtaMT = formatDisplayStock(record.netWeight / record.rapportoKgMt, 'mt');
                                                }

                                                return (
                                                  <TableRow key={record.id} data-state={selectedRecords.includes(record.id) ? 'selected' : ''} className={cn(record.status === 'pending' && 'bg-yellow-500/10')}>
                                                    <TableCell padding="checkbox">
                                                        <Checkbox
                                                        checked={selectedRecords.includes(record.id)}
                                                        onCheckedChange={() => handleSelectRecord(record.id)}
                                                        />
                                                    </TableCell>
                                                    <TableCell>{record.lotto}</TableCell>
                                                    
                                                    <TableCell className="font-mono font-semibold">
                                                      {qtaN}
                                                    </TableCell>
                                                    <TableCell className="font-mono font-semibold text-orange-600">
                                                      {qtaMT}
                                                    </TableCell>
                                                    <TableCell className="font-mono font-semibold text-primary">
                                                      {qtaKG}
                                                    </TableCell>

                                                    <TableCell className="font-mono">{formatDisplayStock(record.grossWeight, 'kg')} kg</TableCell>
                                                    <TableCell className="font-mono">{formatDisplayStock(record.tareWeight, 'kg')} kg</TableCell>
                                                    <TableCell className="font-mono font-semibold">{formatDisplayStock(record.netWeight, 'kg')} kg</TableCell>
                                                    <TableCell>{record.operatorName}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={record.status === 'pending' ? 'destructive' : record.status === 'approved' ? 'default' : 'secondary'}>
                                                        {record.status === 'pending' ? 'In Attesa' : record.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right space-x-2">
                                                        {isPending === record.id ? (
                                                        <Loader2 className="h-5 w-5 animate-spin ml-auto" />
                                                        ) : (
                                                        <>
                                                            <Button variant="ghost" size="icon" onClick={() => handleOpenSheet(record)} disabled={record.status !== 'pending'}>
                                                            <Pencil className="h-4 w-4"/>
                                                            </Button>
                                                            {record.status === 'pending' ? (
                                                            <>
                                                                <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                                    <X className="h-5 w-5"/>
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader><AlertDialogTitle>Confermi di rifiutare?</AlertDialogTitle><AlertDialogDescription>La registrazione verrà marcata come "rifiutata" e non potrà essere modificata.</AlertDialogDescription></AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleReject(record.id)} className="bg-destructive hover:bg-destructive/90">Sì, rifiuta</AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                                </AlertDialog>

                                                                <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="text-green-500 hover:text-green-500">
                                                                    <Check className="h-5 w-5"/>
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader><AlertDialogTitle>Confermi di approvare?</AlertDialogTitle><AlertDialogDescription>Lo stock della materia prima verrà aggiornato con il peso netto di questa registrazione. L'azione non è reversibile.</AlertDialogDescription></AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleApprove(record.id)} className="bg-green-600 hover:bg-green-700">Sì, approva</AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                                </AlertDialog>
                                                            </>
                                                            ) : (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="text-amber-500 hover:text-amber-500">
                                                                    <Undo2 className="h-4 w-4"/>
                                                                </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Annullare l'operazione?</AlertDialogTitle>
                                                                    <AlertDialogDescription>Questa azione riporterà la registrazione allo stato "In Attesa". Se approvata, lo stock verrà stornato.</AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Chiudi</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleRevertStatus(record.id)}>Sì, annulla</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                            )}
                                                        </>
                                                        )}
                                                    </TableCell>
                                                  </TableRow>
                                            )})}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </CollapsibleContent>
                                </Collapsible>
                               )})}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg">
                    <p className="text-lg font-semibold text-muted-foreground">
                       {records.length === 0 ? "Nessuna registrazione di inventario trovata." : "Nessuna registrazione trovata per la tua ricerca."}
                    </p>
                </div>
              )}
            </CardContent>
        </Card>
      </div>

      {selectedRecord && (
         <InventoryRecordSheet 
            isOpen={isSheetOpen} 
            onOpenChange={setIsSheetOpen} 
            record={selectedRecord}
            onUpdateSuccess={refreshData}
          />
      )}
    </>
  );
}
