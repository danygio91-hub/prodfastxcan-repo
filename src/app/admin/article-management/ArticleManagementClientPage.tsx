
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search, Trash2, Edit, Download, Upload, Loader2, BarChart3, Copy, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Article, RawMaterial } from '@/lib/mock-data';
import ArticleFormDialog from './ArticleFormDialog';
import { deleteArticle, validateArticlesImport, bulkSaveArticles } from './actions';
import { useRouter, useSearchParams } from 'next/navigation';

interface ArticleManagementClientPageProps {
  initialArticles: Article[];
  rawMaterials: RawMaterial[];
}

export default function ArticleManagementClientPage({ initialArticles, rawMaterials }: ArticleManagementClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const articleCodeFromUrl = searchParams.get('code');
  
  const [searchTerm, setSearchTerm] = useState(articleCodeFromUrl || '');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  
  const [importReport, setImportReport] = useState<{
    validArticles: Omit<Article, 'id'>[];
    invalidArticles: { code: string; errors: string[] }[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (articleCodeFromUrl) {
      setSearchTerm(articleCodeFromUrl);
    }
  }, [articleCodeFromUrl]);

  const filteredArticles = useMemo(() => {
    if (!searchTerm) {
      return initialArticles;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return initialArticles.filter(article =>
      article.code.toLowerCase().includes(lowercasedFilter)
    );
  }, [initialArticles, searchTerm]);
  
  const handleOpenForm = (article: Article | null) => {
    setEditingArticle(article);
    setIsFormOpen(true);
  };
  
  const handleFormClose = (refresh: boolean = false) => {
    setIsFormOpen(false);
    setEditingArticle(null);
    if(refresh) {
      router.refresh();
    }
  }

  const handleDelete = async (articleId: string) => {
    const result = await deleteArticle(articleId);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      router.refresh();
    }
  };
  
  const handleDownloadTemplate = () => {
    const templateData = [
      { 
        "Codice Articolo": "ART-001",
        "Componente": "COMP-A",
        "Unità di Misura": "n",
        "Quantità per Pz": 2,
        "Lunghezza Taglio (mm)": ""
      },
       { 
        "Codice Articolo": "ART-002",
        "Componente": "COMP-B",
        "Unità di Misura": "n",
        "Quantità per Pz": 1,
        "Lunghezza Taglio (mm)": 1260
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Distinta Base");
    XLSX.writeFile(wb, "template_distinta_base.xlsx");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    toast({ title: 'Analisi File...', description: 'Lettura dei dati in corso.' });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);

      const articlesMap: { [code: string]: Omit<Article, 'id'> } = {};

      for (const row of json) {
        const articleCode = String(row['Codice Articolo'] || row['codice articolo'] || '').trim();
        const component = String(row['Componente'] || row['componente'] || '').trim();
        const quantity = Number(row['Quantità per Pz'] || row['Quantità'] || row['quantità'] || 0);
        
        if (!articleCode || !component) continue;

        const cleanComponentCode = component.split(' ')[0];

        if (!articlesMap[articleCode]) {
          articlesMap[articleCode] = {
            code: articleCode,
            billOfMaterials: [],
          };
        }
        
        const unit = String(row['Unità di Misura'] || row['unità di misura'] || 'n').toLowerCase() as 'n' | 'mt' | 'kg';
        const lunghezzaTaglio = row['Lunghezza Taglio (mm)'] || row['lunghezza taglio (mm)'] || row['Numero/Misura'];

        const bomItem: any = {
          component: cleanComponentCode,
          unit,
          quantity: quantity,
        };
        
        if (lunghezzaTaglio) {
          const parsedLength = parseFloat(String(lunghezzaTaglio));
          if (!isNaN(parsedLength) && parsedLength > 0) {
            bomItem.lunghezzaTaglioMm = parsedLength;
          } else if (typeof lunghezzaTaglio === 'string' && lunghezzaTaglio.trim() !== '') {
            bomItem.note = String(lunghezzaTaglio);
          }
        }

        articlesMap[articleCode].billOfMaterials.push(bomItem);
      }

      const report = await validateArticlesImport(Object.values(articlesMap));
      setImportReport(report);

    } catch (error) {
      toast({
        variant: "destructive",
        title: "Errore File",
        description: error instanceof Error ? error.message : "Impossibile leggere il file Excel.",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  
  const handleConfirmImport = async () => {
    if (!importReport || importReport.validArticles.length === 0) return;

    setIsSavingBulk(true);
    const result = await bulkSaveArticles(importReport.validArticles);
    
    toast({
        title: result.success ? "Importazione Completata" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
        setImportReport(null);
        router.refresh();
    }
    setIsSavingBulk(false);
  };

  const handleNavigateToAnalysis = (articleCode: string) => {
    router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(articleCode)}`);
  };

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <ClipboardList className="h-8 w-8 text-primary" />
              Anagrafica Articoli
            </h1>
            <p className="text-muted-foreground mt-1">
              Visualizza e gestisci la distinta base per ogni articolo.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2 w-full sm:w-auto flex-wrap">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
            <Button onClick={handleDownloadTemplate} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Scarica Template
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}>
               {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
              Importa DB
            </Button>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per codice articolo..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button onClick={() => handleOpenForm(null)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Aggiungi Articolo
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Elenco Articoli</CardTitle>
            <CardDescription>
              Elenco degli articoli con dati di produzione registrati.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Codice Articolo</TableHead>
                    <TableHead>N° Componenti</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArticles.length > 0 ? (
                    filteredArticles.map((article) => (
                      <TableRow key={article.code}>
                        <TableCell>
                            <ContextMenu>
                              <ContextMenuTrigger className="font-medium hover:text-primary hover:underline cursor-pointer">{article.code}</ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem onSelect={() => handleNavigateToAnalysis(article.code)}>
                                  <BarChart3 className="mr-2 h-4 w-4" />
                                  Analisi Tempi Articolo
                                </ContextMenuItem>
                                 <ContextMenuItem onSelect={() => navigator.clipboard.writeText(article.code).then(() => toast({ title: "Copiato!", description: "Codice articolo copiato negli appunti."}))}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copia Codice Articolo
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                        </TableCell>
                         <TableCell>
                          {article.billOfMaterials?.length || 0}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                           <Button variant="outline" size="sm" onClick={() => handleOpenForm(article)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Gestisci DB
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                               <Button variant="destructive" size="sm">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Elimina
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                    Questa azione eliminerà permanentemente l'articolo e la sua distinta base.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(article.id)}>Sì, elimina</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center">
                        {initialArticles.length === 0 ? "Nessun articolo trovato." : "Nessun articolo trovato per la ricerca."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <ArticleFormDialog
        isOpen={isFormOpen}
        onClose={handleFormClose}
        article={editingArticle}
        rawMaterials={rawMaterials}
      />

      <Dialog open={!!importReport} onOpenChange={(open) => !open && setImportReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ClipboardList className="h-6 w-6 text-primary" />
                    Analisi Importazione Database Articoli
                </DialogTitle>
                <DialogDescription>
                    Revisiona i risultati dell'analisi prima di procedere con l'aggiornamento.
                </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="valid" className="flex-1 overflow-hidden flex flex-col mt-4 min-h-0">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="valid" className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Pronti per Caricamento ({importReport?.validArticles.length || 0})
                    </TabsTrigger>
                    <TabsTrigger value="errors" className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        Articoli con Errori ({importReport?.invalidArticles.length || 0})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="valid" className="flex-1 overflow-hidden pt-4 min-h-0">
                    <ScrollArea className="h-[500px] border rounded-md p-2">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Codice Articolo</TableHead>
                                    <TableHead>N° Componenti</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {importReport?.validArticles.map((art, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-mono font-semibold">{art.code}</TableCell>
                                        <TableCell>{art.billOfMaterials.length} componenti</TableCell>
                                    </TableRow>
                                ))}
                                {importReport?.validArticles.length === 0 && (
                                    <TableRow><TableCell colSpan={2} className="text-center py-10 text-muted-foreground italic">Nessun articolo valido trovato nel file.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="errors" className="flex-1 overflow-hidden pt-4 min-h-0">
                    <ScrollArea className="h-[500px] border rounded-md p-2">
                        <div className="space-y-4">
                            {importReport?.invalidArticles.map((item, idx) => (
                                <div key={idx} className="p-3 border-l-4 border-destructive bg-destructive/5 rounded-r-md">
                                    <p className="font-bold text-sm text-destructive">{item.code}</p>
                                    <ul className="text-xs space-y-1 mt-1">
                                        {item.errors.map((err, eIdx) => <li key={eIdx} className="flex items-start gap-2">• {err}</li>)}
                                    </ul>
                                </div>
                            ))}
                            {importReport?.invalidArticles.length === 0 && (
                                <div className="text-center py-10 text-muted-foreground italic">Ottimo! Nessun errore riscontrato nel file.</div>
                            )}
                        </div>
                    </ScrollArea>
                </TabsContent>
            </Tabs>

            <DialogFooter className="mt-6 gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setImportReport(null)}>Annulla tutto</Button>
                <Button 
                    onClick={handleConfirmImport} 
                    disabled={isSavingBulk || !importReport?.validArticles.length}
                    className="bg-green-600 hover:bg-green-700"
                >
                    {isSavingBulk ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
                    Procedi con Caricamento Validi ({importReport?.validArticles.length})
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
