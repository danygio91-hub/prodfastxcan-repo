
"use client";

import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, Loader2, List, Trash2, AlertTriangle, Send, ArrowLeft, FileUp, FileDown, XCircle } from 'lucide-react';
import { importCaricoFromFile, importScaricoFromFile } from './actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Packaging, RawMaterial } from '@/lib/mock-data';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Operation = 'carico' | 'scarico';

interface ParsedRow {
  [key: string]: string | number | undefined;
  __originalIndex?: number;
  'Unita'?: 'n' | 'mt' | 'kg';
  reason?: string;
}

interface MaterialImportClientPageProps {
  packagingItems: Packaging[];
  rawMaterials: RawMaterial[];
}

export default function MaterialImportClientPage({ packagingItems, rawMaterials }: MaterialImportClientPageProps) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const materialsMap = useMemo(() => new Map(rawMaterials.map(m => [m.code.toLowerCase(), m])), [rawMaterials]);

  const handleDownloadTemplate = () => {
    let templateData: any[];
    let fileName: string;
    let sheetName: string;

    if (operation === 'carico') {
      const packagingExamples = packagingItems.slice(0, 2).map(p => p.name);
      templateData = [
        { 
          "Codice Materiale": "CODICE-ESEMPIO-1", "Lotto": "LOTTO-A1", "DDT": "DDT-123",
          "Quantita Netta": 100.5, "Data": "2024-07-25", "Tara (Imballo)": packagingExamples[0] || "Nome Tara Esistente",
        },
        { 
          "Codice Materiale": "CODICE-ESEMPIO-2", "Lotto": "LOTTO-B2", "DDT": "DDT-124",
          "Quantita Netta": 50, "Data": 45497, "Tara (Imballo)": packagingExamples[1] || "",
        },
      ];
      fileName = "template_carico_magazzino.xlsx";
      sheetName = "Carico Magazzino";
    } else { // scarico
      templateData = [
        {
          "Codice Materiale": "CODICE-ESEMPIO-1", "Lotto": "LOTTO-A1", "Quantita da Scaricare": 10.5,
          "Unita": "kg", "Commessa Associata": "Comm-123/24", "Note": "Scarico per test",
        },
        {
          "Codice Materiale": "CODICE-ESEMPIO-2", "Lotto": "LOTTO-B2", "Quantita da Scaricare": 25,
          "Unita": "n", "Commessa Associata": "", "Note": "",
        },
      ];
      fileName = "template_scarico_magazzino.xlsx";
      sheetName = "Scarico Magazzino";
    }

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessing(true);
    toast({ title: 'Lettura file in corso...' });

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const headers = operation === 'carico'
          ? ["Codice Materiale", "Lotto", "DDT", "Quantita Netta", "Data", "Tara (Imballo)"]
          : ["Codice Materiale", "Lotto", "Quantita da Scaricare", "Unita", "Commessa Associata", "Note"];
          
        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { header: headers, range: 1 });
        
        const validData = json
            .map((row, index) => {
              const materialCode = row['Codice Materiale']?.toString().trim().toLowerCase();
              const material = materialCode ? materialsMap.get(materialCode) : undefined;

              if (operation === 'carico' && material) {
                row['Unita'] = material.unitOfMeasure;
              }

              return { ...row, __originalIndex: index };
            })
            .filter(row => row['Codice Materiale'] && (row['Quantita Netta'] || row['Quantita da Scaricare']));

        setParsedData(validData);
        toast({ title: 'File analizzato', description: `${validData.length} righe valide trovate.` });
      } catch (error) {
        toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile leggere o analizzare le file.' });
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
     if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!user || !operation) {
        toast({ variant: "destructive", title: "Errore", description: "Operazione o utente non validi."});
        return;
    }
    setIsProcessing(true);
    
    const action = operation === 'carico' ? importCaricoFromFile : importScaricoFromFile;
    const result = await action(parsedData, user.uid);

    if (result.success) {
        toast({
            title: 'Importazione Completata',
            description: result.message,
            variant: 'default',
        });
        clearData();
    } else {
        toast({
            title: 'Importazione Parziale/Fallita',
            description: result.message,
            variant: 'destructive',
            duration: 9000,
        });
        setParsedData(result.failedRows || []);
    }
    
    setIsProcessing(false);
  };
  
  const clearData = () => {
    setParsedData([]);
    setFileName('');
  }

  const renderHeaderAndTable = () => {
    const hasReasons = parsedData.some(r => r.reason);
    
    if (operation === 'carico') {
        return (
            <>
                <TableHeader className="sticky top-0 bg-muted"><TableRow>
                    <TableHead>Codice Materiale</TableHead><TableHead>Lotto</TableHead><TableHead>DDT</TableHead>
                    <TableHead>Quantità Netta</TableHead>
                    <TableHead>Unità</TableHead>
                    <TableHead>Data</TableHead>
                    {hasReasons && <TableHead className="text-destructive">Errore</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                    {parsedData.map((row, index) => (
                        <TableRow key={row.__originalIndex ?? index}>
                            <TableCell>{row["Codice Materiale"]}</TableCell><TableCell>{row["Lotto"]}</TableCell>
                            <TableCell>{row["DDT"]}</TableCell><TableCell>{row["Quantita Netta"]}</TableCell>
                             <TableCell>
                                <Badge variant={row['Unita'] ? 'secondary' : 'destructive'}>
                                  {String(row['Unita'] || '???').toUpperCase()}
                                </Badge>
                             </TableCell>
                            <TableCell>{typeof row["Data"] === 'number' ? new Date(Date.UTC(1899, 11, 30 + (row["Data"] as number))).toLocaleDateString('it-IT') : new Date(row["Data"] as string).toLocaleDateString('it-IT')}</TableCell>
                            {row.reason && <TableCell className="text-destructive text-xs font-semibold">{row.reason}</TableCell>}
                        </TableRow>
                    ))}
                </TableBody>
            </>
        );
    } else { // scarico
         return (
            <>
                <TableHeader className="sticky top-0 bg-muted"><TableRow>
                    <TableHead>Codice Materiale</TableHead><TableHead>Lotto</TableHead>
                    <TableHead>Q.tà da Scaricare</TableHead><TableHead>Unità</TableHead>
                    <TableHead>Commessa</TableHead>
                    {hasReasons && <TableHead className="text-destructive">Errore</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                    {parsedData.map((row, index) => (
                        <TableRow key={row.__originalIndex ?? index}>
                            <TableCell>{row["Codice Materiale"]}</TableCell><TableCell>{row["Lotto"]}</TableCell>
                            <TableCell>{row["Quantita da Scaricare"]}</TableCell><TableCell>{row["Unita"]}</TableCell>
                            <TableCell>{row["Commessa Associata"]}</TableCell>
                            {row.reason && <TableCell className="text-destructive text-xs font-semibold">{row.reason}</TableCell>}
                        </TableRow>
                    ))}
                </TableBody>
            </>
        );
    }
  };

  return (
    <div className="space-y-6">
        {!operation ? (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3"><Upload className="h-8 w-8 text-primary" />Carico/Scarico Merce da File</CardTitle>
                    <CardDescription>Seleziona l'operazione che vuoi eseguire.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
                    <Button onClick={() => setOperation('carico')} variant="outline" className="h-28 text-lg flex-col gap-2 border-green-500/50 hover:bg-green-500/10 hover:text-green-700 dark:hover:text-green-400">
                        <FileUp className="h-8 w-8 text-green-500" />
                        Carico Merce
                    </Button>
                    <Button onClick={() => setOperation('scarico')} variant="outline" className="h-28 text-lg flex-col gap-2 border-red-500/50 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400">
                        <FileDown className="h-8 w-8 text-red-500" />
                        Scarico Merce
                    </Button>
                </CardContent>
            </Card>
        ) : (
        <>
          <Button variant="ghost" onClick={() => { setOperation(null); clearData(); }}>
            <ArrowLeft className="mr-2"/>
            Torna alla selezione
          </Button>
          <Card>
            <CardHeader>
              <CardTitle className="capitalize">{operation} Merce da File</CardTitle>
              <CardDescription>Scarica il template, compilalo e carica il file per avviare l'importazione.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4">
              <Button onClick={handleDownloadTemplate} variant="secondary">
                <Download className="mr-2" />
                Scarica Template
              </Button>
               <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
               <Button onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                <Upload className="mr-2" />
                Seleziona File Excel
              </Button>
              {fileName && <p className="text-sm text-muted-foreground">File selezionato: {fileName}</p>}
            </CardContent>
          </Card>

          {parsedData.length > 0 && (
            <Card className={cn(parsedData.some(r => r.reason) && "border-destructive")}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                {parsedData.some(r => r.reason) ? <XCircle className="text-destructive"/> : <List className="h-6 w-6"/>}
                                Anteprima Dati
                            </CardTitle>
                            <CardDescription>
                                {parsedData.some(r => r.reason) 
                                    ? "Alcune righe presentano errori. Correggi il file Excel o procedi ignorando le righe errate." 
                                    : "Controlla i dati letti dal file. Se sono corretti, procedi con l'importazione."
                                }
                            </CardDescription>
                        </div>
                        <Button variant="destructive" size="sm" onClick={clearData}>
                            <Trash2 className="mr-2"/>
                            Annulla e Svuota
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-96 border rounded-lg">
                        <Table>{renderHeaderAndTable()}</Table>
                    </ScrollArea>
                </CardContent>
                <CardFooter>
                     <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button className="w-full" disabled={isProcessing || parsedData.length === 0}>
                            {isProcessing ? <Loader2 className="mr-2 animate-spin"/> : <Send className="mr-2" />}
                            Conferma e Importa {parsedData.filter(r => !r.reason).length} righe valide
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle/> Sei assolutamente sicuro?</AlertDialogTitle>
                            <AlertDialogDescription>
                               Stai per eseguire un {operation} massivo per {parsedData.filter(r => !r.reason).length} righe. L'operazione aggiornerà lo stock dei materiali. Questa azione non può essere annullata facilmente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmImport} disabled={isProcessing}>
                                {isProcessing ? <Loader2 className="mr-2 animate-spin"/> : null}
                                Sì, importa
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                </CardFooter>
            </Card>
          )}
        </>
        )}
    </div>
  );
}
