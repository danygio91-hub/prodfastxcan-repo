
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search, Trash2, Edit, Download, Upload, Loader2, BarChart3, Copy, AlertTriangle, CheckCircle2, XCircle, RefreshCcw, Timer } from 'lucide-react';
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
import type { Article, RawMaterial, WorkPhaseTemplate } from '@/lib/mock-data';
import ArticleFormDialog from './ArticleFormDialog';
import ArticleTimesDialog from './ArticleTimesDialog';
import { deleteArticle, validateArticlesImport, bulkSaveArticles } from './actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { getWorkPhaseTemplates } from '../work-phase-management/actions';

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
  const [isTimesOpen, setIsTimesOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [phaseTemplates, setPhaseTemplates] = useState<WorkPhaseTemplate[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  
  const [importReport, setImportReport] = useState<{
    newArticles: Omit<Article, 'id'>[];
    updatedArticles: Omit<Article, 'id'>[];
    invalidArticles: { code: string; errors: string[] }[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (articleCodeFromUrl) {
      setSearchTerm(articleCodeFromUrl);
    }
    getWorkPhaseTemplates().then(setPhaseTemplates);
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

  const handleOpenTimes = (article: Article) => {
    setEditingArticle(article);
    setIsTimesOpen(true);
  };
  
  const handleFormClose = (refresh: boolean = false) => {
    setIsFormOpen(false);
    setEditingArticle(null);
    if(refresh) router.refresh();
  }

  const handleTimesClose = (refresh: boolean = false) => {
    setIsTimesOpen(false);
    setEditingArticle(null);
    if(refresh) router.refresh();
  };

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
  
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    toast({ title: 'Analisi File...', description: 'Lettura dei dati in corso.' });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);

      const articlesMap: { [code: string]: Omit<Article, 'id'> } = {};

      for (const row of json) {
        const articleCode = String(row['Codice Articolo'] || row['codice articolo'] || '').trim();
        const component = String(row['Componente'] || row['componente'] || '').trim();
        const quantity = Number(row['Quantità per Pz'] || row['Quantità'] || row['quantità'] || 0);
        
        if (!articleCode || !component) continue;

        if (!articlesMap[articleCode]) {
          articlesMap[articleCode] = { code: articleCode, billOfMaterials: [] };
        }
        
        const unit = String(row['Unità di Misura'] || row['unità di misura'] || 'n').toLowerCase() as 'n' | 'mt' | 'kg';
        const lunghezzaTaglio = row['Lunghezza Taglio (mm)'] || row['lunghezza taglio (mm)'] || row['Numero/Misura'];

        const bomItem: any = { component: component.split(' ')[0], unit, quantity: quantity };
        
        if (lunghezzaTaglio) {
          const parsedLength = parseFloat(String(lunghezzaTaglio));
          if (!isNaN(parsedLength) && parsedLength > 0) bomItem.lunghezzaTaglioMm = parsedLength;
          else if (typeof lunghezzaTaglio === 'string' && lunghezzaTaglio.trim() !== '') bomItem.note = String(lunghezzaTaglio);
        }

        articlesMap[articleCode].billOfMaterials.push(bomItem);
      }

      const report = await validateArticlesImport(Object.values(articlesMap));
      setImportReport(report);

    } catch (error) {
      toast({ variant: "destructive", title: "Errore File", description: "Impossibile leggere il file Excel." });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  
  const handleConfirmImport = async () => {
    if (!importReport) return;
    const allValid = [...importReport.newArticles, ...importReport.updatedArticles];
    if (allValid.length === 0) return;

    setIsSavingBulk(true);
    const result = await bulkSaveArticles(allValid);
    toast({ title: result.success ? "Importazione Completata" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) {
        setImportReport(null);
        router.refresh();
    }
    setIsSavingBulk(false);
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
            <p className="text-muted-foreground mt-1">Visualizza e gestisci la distinta base e i tempi standard per ogni articolo.</p>
          </div>
          <div className="flex items-center gap-2 pt-2 w-full sm:w-auto flex-wrap">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting}>
               {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
              Importa DB
            </Button>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cerca..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Button onClick={() => handleOpenForm(null)}><PlusCircle className="mr-2 h-4 w-4" />Aggiungi</Button>
          </div>
        </header>

        <Card>
          <CardHeader><CardTitle>Elenco Articoli</CardTitle><CardDescription>Gestione della distinta base e dei tempi medi rilevati/previsti.</CardDescription></CardHeader>
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
                                <ContextMenuItem onSelect={() => router.push(`/admin/production-time-analysis?articleCode=${encodeURIComponent(article.code)}`)}><BarChart3 className="mr-2 h-4 w-4" />Analisi Tempi</ContextMenuItem>
                                <ContextMenuItem onSelect={() => navigator.clipboard.writeText(article.code).then(() => toast({ title: "Copiato!"}))}><Copy className="mr-2 h-4 w-4" />Copia Codice</ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                        </TableCell>
                         <TableCell>{article.billOfMaterials?.length || 0}</TableCell>
                        <TableCell className="text-right space-x-2">
                           <Button variant="outline" size="sm" onClick={() => handleOpenTimes(article)}>
                            <Timer className="mr-2 h-4 w-4 text-amber-500" /> Tempi
                          </Button>
                           <Button variant="outline" size="sm" onClick={() => handleOpenForm(article)}>
                            <Edit className="mr-2 h-4 w-4" /> Gestisci
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" /> Elimina</Button></AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminare l'articolo?</AlertDialogTitle><AlertDialogDescription>L'azione è irreversibile.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(article.id)}>Sì, elimina</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={3} className="h-24 text-center">Nessun articolo trovato.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <ArticleFormDialog isOpen={isFormOpen} onClose={handleFormClose} article={editingArticle} rawMaterials={rawMaterials} />
      
      {editingArticle && (
        <ArticleTimesDialog 
            isOpen={isTimesOpen} 
            onClose={handleTimesClose} 
            article={editingArticle} 
            phaseTemplates={phaseTemplates}
        />
      )}

      <Dialog open={!!importReport} onOpenChange={(o) => !o && setImportReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-6 w-6 text-primary" /> Analisi Importazione</DialogTitle></DialogHeader>
            <Tabs defaultValue="new" className="flex-1 overflow-hidden flex flex-col mt-4">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="new"><PlusCircle className="h-4 w-4 text-green-500 mr-2" /> Nuovi ({importReport?.newArticles.length || 0})</TabsTrigger>
                    <TabsTrigger value="update"><RefreshCcw className="h-4 w-4 text-blue-500 mr-2" /> Aggiorna ({importReport?.updatedArticles.length || 0})</TabsTrigger>
                    <TabsTrigger value="errors"><XCircle className="h-4 w-4 text-destructive mr-2" /> Errori ({importReport?.invalidArticles.length || 0})</TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="flex-1 overflow-hidden pt-4"><ScrollArea className="h-[400px] border rounded-md p-2"><Table><TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Componenti</TableHead></TableRow></TableHeader><TableBody>{importReport?.newArticles.map((art, idx) => (<TableRow key={idx}><TableCell className="font-mono">{art.code}</TableCell><TableCell>{art.billOfMaterials.length}</TableCell></TableRow>))}</TableBody></Table></ScrollArea></TabsContent>
                <TabsContent value="update" className="flex-1 overflow-hidden pt-4"><ScrollArea className="h-[400px] border rounded-md p-2"><Table><TableHeader><TableRow><TableHead>Codice Esistente</TableHead><TableHead>Nuova Distinta</TableHead></TableRow></TableHeader><TableBody>{importReport?.updatedArticles.map((art, idx) => (<TableRow key={idx} className="bg-blue-500/5"><TableCell className="font-mono font-bold text-blue-700">{art.code}</TableCell><TableCell>{art.billOfMaterials.length} comp. (verrà aggiornata)</TableCell></TableRow>))}</TableBody></Table></ScrollArea></TabsContent>
                <TabsContent value="errors" className="flex-1 overflow-hidden pt-4"><ScrollArea className="h-[400px] border rounded-md p-2"><div className="space-y-4">{importReport?.invalidArticles.map((item, idx) => (<div key={idx} className="p-3 border-l-4 border-destructive bg-destructive/5"><p className="font-bold text-destructive">{item.code}</p><ul className="text-xs mt-1">{item.errors.map((err, eIdx) => <li key={eIdx}>• {err}</li>)}</ul></div>))}</div></ScrollArea></TabsContent>
            </Tabs>
            <DialogFooter className="mt-6 border-t pt-4"><Button variant="outline" onClick={() => setImportReport(null)}>Annulla tutto</Button><Button onClick={handleConfirmImport} disabled={isSavingBulk || (!importReport?.newArticles.length && !importReport?.updatedArticles.length)} className="bg-green-600 hover:bg-green-700">{isSavingBulk ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}Conferma Caricamento ({(importReport?.newArticles.length || 0) + (importReport?.updatedArticles.length || 0)})</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
