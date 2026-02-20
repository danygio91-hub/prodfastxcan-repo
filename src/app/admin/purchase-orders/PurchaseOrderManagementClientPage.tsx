
"use client";

import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Truck, PlusCircle, Search, Trash2, Download, Upload, Loader2, Calendar } from 'lucide-react';
import { getPurchaseOrders, deletePurchaseOrder, importPurchaseOrders } from './actions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { type PurchaseOrder } from '@/lib/mock-data';

export default function PurchaseOrderManagementClientPage({ 
  initialOrders 
}: { 
  initialOrders: PurchaseOrder[] 
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>(initialOrders);
  const [searchTerm, setSearchTerm] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const lower = searchTerm.toLowerCase();
    return orders.filter(o => 
      o.orderNumber.toLowerCase().includes(lower) ||
      o.supplierName.toLowerCase().includes(lower) ||
      o.materialCode.toLowerCase().includes(lower)
    );
  }, [orders, searchTerm]);

  const handleDownloadTemplate = () => {
    const templateData = [
      { 
        "N° Ordine": "ORD-2024-001",
        "Fornitore": "FORNITORE ALPHA",
        "Codice Materiale": "BOB-ROSSO-01",
        "Quantità": 500,
        "Unità": "mt",
        "Data Consegna": "30/08/2024"
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ordini Fornitore");
    XLSX.writeFile(wb, "template_ordini_fornitore.xlsx");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsImporting(true);
    toast({ title: 'Analisi file...', description: 'Lettura ordini in corso.' });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const json: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      
      const result = await importPurchaseOrders(json, user.uid);
      if (result.success) {
        toast({ title: "Importazione Riuscita", description: result.message });
        const updated = await getPurchaseOrders();
        setOrders(updated);
      } else {
        toast({ variant: 'destructive', title: "Errore", description: result.message });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: "Errore File", description: "Impossibile leggere il file Excel." });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const result = await deletePurchaseOrder(id, user.uid);
    if (result.success) {
      toast({ title: "Eliminato" });
      setOrders(prev => prev.filter(o => o.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
            <Truck className="h-8 w-8 text-primary" />
            Ordini Fornitore
          </h1>
          <p className="text-muted-foreground mt-1">Gestisci e monitora l'arrivo delle materie prime.</p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={handleDownloadTemplate} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> Template
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}>
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />} Carica Excel
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Riepilogo Ordini Pendenti</CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cerca ordine, fornitore..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Ordine</TableHead>
                  <TableHead>Fornitore</TableHead>
                  <TableHead>Materiale</TableHead>
                  <TableHead>Quantità</TableHead>
                  <TableHead>Data Consegna Prevista</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono font-semibold">{order.orderNumber}</TableCell>
                      <TableCell>{order.supplierName}</TableCell>
                      <TableCell>{order.materialCode}</TableCell>
                      <TableCell className="font-bold">{order.quantity} {order.unitOfMeasure.toUpperCase()}</TableCell>
                      <TableCell className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {order.expectedDeliveryDate ? format(parseISO(order.expectedDeliveryDate), 'dd/MM/yyyy') : 'N/D'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={order.status === 'pending' ? 'secondary' : 'default'}>
                          {order.status === 'pending' ? 'In attesa' : order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4"/></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                              <AlertDialogDescription>L'ordine verrà rimosso permanentemente.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annulla</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(order.id)} className="bg-destructive hover:bg-destructive/90">Elimina</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Nessun ordine fornitore trovato.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
