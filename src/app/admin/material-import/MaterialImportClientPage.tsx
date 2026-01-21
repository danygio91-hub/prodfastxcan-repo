"use client";

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, Loader2, List, Trash2, AlertTriangle, Send } from 'lucide-react';
import { importStockFromFile } from './actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Packaging } from '@/lib/mock-data';

interface MaterialImportClientPageProps {
  packagingItems: Packaging[];
}

interface ParsedRow {
  "Codice Materiale": string;
  "Lotto": string;
  "DDT": string;
  "Quantita Netta": number;
  "Data": string | number;
  "Tara (Imballo)": string;
  __rowNum__: number;
}


export default function MaterialImportClientPage({ packagingItems }: MaterialImportClientPageProps) {
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const handleDownloadTemplate = () => {
    const packagingExamples = packagingItems.slice(0, 2).map(p => p.name);
    const templateData = [
      { 
        "Codice Materiale": "CODICE-ESEMPIO-1",
        "Lotto": "LOTTO-A1",
        "DDT": "DDT-123",
        "Quantita Netta": 100.5,
        "Data": "2024-07-25",
        "Tara (Imballo)": packagingExamples[0] || "Nome Tara Esistente",
      },
       { 
        "Codice Materiale": "CODICE-ESEMPIO-2",
        "Lotto": "LOTTO-B2",
        "DDT": "DDT-124",
        "Quantita Netta": 50,
        "Data": 45497, // Excel date number for 2024-07-26
        "Tara (Imballo)": packagingExamples[1] || "",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Carico Magazzino");
    XLSX.writeFile(wb, "template_carico_magazzino.xlsx");
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
        const json: ParsedRow[] = XLSX.utils.sheet_to_json(worksheet, {
             header: [
                "Codice Materiale",
                "Lotto",
                "DDT",
                "Quantita Netta",
                "Data",
                "Tara (Imballo)",
            ],
            range: 1 // Skip header row in Excel file
        });
        
        // Filter out empty rows that might be parsed
        const validData = json.filter(row => row['Codice Materiale'] && row['Lotto'] && row['Quantita Netta']);
        setParsedData(validData);
        toast({ title: 'File analizzato', description: `${validData.length} righe valide trovate.` });
      } catch (error) {
        toast({ variant: 'destructive', title: 'Errore', description: 'Impossibile leggere o analizzare il file.' });
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
    if (!user) {
        toast({ variant: "destructive", title: "Errore", description: "Utente non autenticato."});
        return;
    }
    setIsProcessing(true);
    const result = await importStockFromFile(parsedData, user.uid);
    toast({
        title: result.success ? 'Importazione Completata' : 'Importazione Fallita',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
        duration: 9000,
    });
    if (result.success) {
      setParsedData([]);
      setFileName('');
    }
    setIsProcessing(false);
  };
  
  const clearData = () => {
    setParsedData([]);
    setFileName('');
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
          <Upload className="h-8 w-8 text-primary" />
          Carico Merce da File Excel
        </h1>
        <p className="text-muted-foreground">
          Importa massivamente i lotti di materie prime caricando un file Excel.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Carica File</CardTitle>
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
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2"><List className="h-6 w-6"/> 2. Anteprima Dati</CardTitle>
                        <CardDescription>Controlla i dati letti dal file. Se sono corretti, procedi con l'importazione.</CardDescription>
                    </div>
                    <Button variant="destructive" size="sm" onClick={clearData}>
                        <Trash2 className="mr-2"/>
                        Annulla e Svuota
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="max-h-96 overflow-y-auto border rounded-lg">
                    <Table>
                        <TableHeader className="sticky top-0 bg-muted">
                            <TableRow>
                                <TableHead>Codice Materiale</TableHead>
                                <TableHead>Lotto</TableHead>
                                <TableHead>DDT</TableHead>
                                <TableHead>Q.tà Netta</TableHead>
                                <TableHead>Data</TableHead>
                                <TableHead>Tara</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {parsedData.map((row, index) => (
                                <TableRow key={index}>
                                    <TableCell>{row["Codice Materiale"]}</TableCell>
                                    <TableCell>{row["Lotto"]}</TableCell>
                                    <TableCell>{row["DDT"]}</TableCell>
                                    <TableCell>{row["Quantita Netta"]}</TableCell>
                                     <TableCell>
                                        {typeof row["Data"] === 'number'
                                            ? new Date(Date.UTC(1899, 11, 30 + row["Data"])).toLocaleDateString('it-IT')
                                            : new Date(row["Data"]).toLocaleDateString('it-IT')}
                                    </TableCell>
                                    <TableCell>{row["Tara (Imballo)"]}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
            <CardFooter>
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="w-full" disabled={isProcessing}>
                        <Send className="mr-2" />
                        Conferma e Importa {parsedData.length} lotti
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle/> Sei assolutamente sicuro?</AlertDialogTitle>
                        <AlertDialogDescription>
                           Stai per aggiungere {parsedData.length} lotti al magazzino. L'operazione aggiornerà lo stock dei materiali corrispondenti. Questa azione non può essere annullata facilmente.
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

    </div>
  );
}
