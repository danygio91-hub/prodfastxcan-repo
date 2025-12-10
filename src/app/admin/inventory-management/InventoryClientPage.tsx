
"use client";

import React, { useState, useMemo, useEffect } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Warehouse, Download, Check, X, Pencil, Loader2, Package, Undo2, Trash2, LinkIcon } from 'lucide-react';
import { type InventoryRecord } from '@/lib/mock-data';
import { approveInventoryRecord, rejectInventoryRecord, revertInventoryRecordStatus, deleteInventoryRecords } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import InventoryRecordSheet from './InventoryRecordSheet';
import { Checkbox } from '@/components/ui/checkbox';


interface InventoryClientPageProps {
  initialRecords: InventoryRecord[];
}

export default function InventoryClientPage({ initialRecords }: InventoryClientPageProps) {
  const [records, setRecords] = useState(initialRecords);
  const [selectedRecord, setSelectedRecord] = useState<InventoryRecord | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPending, setIsPending] = useState<string | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    setRecords(initialRecords);
    setSelectedRecords([]);
  }, [initialRecords]);

  const groupedRecords = useMemo(() => {
    return records.reduce((acc, record) => {
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
  }, [records]);

  const sortedDates = useMemo(() => Object.keys(groupedRecords).sort((a, b) => {
    const [dayA, monthA, yearA] = a.split('.').map(Number);
    const [dayB, monthB, yearB] = b.split('.').map(Number);
    return new Date(yearB, monthB - 1, dayB).getTime() - new Date(yearA, monthA - 1, dayA).getTime();
  }), [groupedRecords]);
  
  const refreshData = () => {
    router.refresh();
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
    const dataToExport = Object.values(dailyRecords).flat().map(r => ({
      'Codice': r.materialCode,
      'Lotto': r.lotto,
      'Quantità (N)': r.inputUnit === 'n' ? r.inputQuantity : 0,
      'Quantità (MT)': r.inputUnit === 'mt' ? r.inputQuantity : 0,
      'Peso Inserito (KG)': r.inputUnit === 'kg' ? r.inputQuantity : 0,
      'Peso Lordo (kg)': r.grossWeight.toFixed(3),
      'Peso Tara (kg)': r.tareWeight.toFixed(3),
      'Peso Netto (kg)': r.netWeight.toFixed(3),
      'Operatore': r.operatorName,
      'Data Registrazione': format(parseISO(r.recordedAt as unknown as string), 'dd/MM/yyyy HH:mm'),
      'Stato': r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Inventario ${date}`);
    XLSX.writeFile(wb, `inventario_${date.replace(/\./g, '-')}.xlsx`);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRecords(records.map(r => r.id));
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
              <div className="flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <CardTitle>Registrazioni da Processare</CardTitle>
                    <CardDescription>
                        Elenco delle registrazioni di inventario raggruppate per data.
                    </CardDescription>
                  </div>
                  {selectedRecords.length > 0 && (
                     <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isPending === 'delete-selected'}>
                          {isPending === 'delete-selected' ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4" />}
                          Elimina Selezionate ({selectedRecords.length})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sei sicuro di voler eliminare?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Stai per eliminare {selectedRecords.length} registrazioni. Se sono state approvate, lo stock verrà stornato. Questa operazione è irreversibile.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">Sì, elimina</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
              </div>
            </CardHeader>
            <CardContent>
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
                            <div className="flex justify-end mb-4">
                              <Button variant="outline" size="sm" onClick={() => handleExport(date, dailyRecordsByMaterial)}>
                                <Download className="mr-2 h-4 w-4" />
                                Scarica Inventario del Giorno
                              </Button>
                            </div>
                            <div className="space-y-6">
                              {Object.entries(dailyRecordsByMaterial).sort(([codeA], [codeB]) => codeA.localeCompare(codeB)).map(([materialCode, recordsForMaterial]) => (
                                <div key={materialCode} className="border-l-4 border-primary/50 pl-4">
                                  <Link
                                    href={`/admin/raw-material-management?code=${encodeURIComponent(materialCode)}`}
                                    className="font-semibold text-md mb-2 flex items-center gap-2 hover:text-primary hover:underline"
                                  >
                                     <Package className="h-5 w-5 text-muted-foreground"/>
                                     {materialCode}
                                     <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                  </Link>
                                  <div className="overflow-x-auto border rounded-lg">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                           <TableHead padding="checkbox">
                                            <Checkbox
                                              checked={recordsForMaterial.every(r => selectedRecords.includes(r.id))}
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
                                          <TableHead>Peso Inserito (KG)</TableHead>
                                          <TableHead>Peso Lordo</TableHead>
                                          <TableHead>Tara</TableHead>
                                          <TableHead>Peso Netto</TableHead>
                                          <TableHead>Operatore</TableHead>
                                          <TableHead>Stato</TableHead>
                                          <TableHead className="text-right">Azioni</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {recordsForMaterial.map(record => (
                                          <TableRow key={record.id} data-state={selectedRecords.includes(record.id) ? 'selected' : ''}>
                                             <TableCell padding="checkbox">
                                              <Checkbox
                                                checked={selectedRecords.includes(record.id)}
                                                onCheckedChange={() => handleSelectRecord(record.id)}
                                              />
                                            </TableCell>
                                            <TableCell>{record.lotto}</TableCell>
                                            <TableCell className="font-mono font-semibold">{record.inputUnit === 'n' ? record.inputQuantity : '0'}</TableCell>
                                            <TableCell className="font-mono font-semibold">{record.inputUnit === 'mt' ? record.inputQuantity : '0'}</TableCell>
                                            <TableCell className="font-mono font-semibold">{record.inputUnit === 'kg' ? record.inputQuantity : '0.00'}</TableCell>
                                            <TableCell className="font-mono">{record.grossWeight.toFixed(3)} kg</TableCell>
                                            <TableCell className="font-mono">{record.tareWeight.toFixed(3)} kg</TableCell>
                                            <TableCell className="font-mono font-semibold">{record.netWeight.toFixed(3)} kg</TableCell>
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
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg">
                    <p className="text-lg font-semibold text-muted-foreground">Nessuna registrazione di inventario trovata.</p>
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
