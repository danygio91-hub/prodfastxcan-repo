"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search, Trash2, Edit, Upload, Loader2, BarChart3, Copy, XCircle, RefreshCcw, Timer, FileEdit, Save, FileSpreadsheet } from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Article, RawMaterial, WorkPhaseTemplate } from '@/lib/mock-data';
import ArticleFormDialog from './ArticleFormDialog';
import ArticleTimesDialog from './ArticleTimesDialog';
import { deleteArticle, validateArticlesImport, bulkSaveArticles, validateArticleSettingsImport, bulkUpdateArticleSettings } from './actions';
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
  const [isImportingSettings, setIsImportingSettings] = useState(false);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  
  const [importReport, setImportReport] = useState<{
    newArticles: Omit<Article, 'id'>[];
    updatedArticles: Omit<Article, 'id'>[];
    invalidArticles: { code: string; errors: string[] }[];
  } | null>(null);

  const [settingsReport, setSettingsReport] = useState<{
    validUpdates: Partial<Article>[];
    invalidRows: { code: string; reason: string }[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
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

  const handleSettingsFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingSettings(true);
    toast({ title: 'Analisi Impostazioni...', description: 'Verifica cicli e tempi.' });

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: true });

        const report = await validateArticleSettingsImport(json);
        setSettingsReport(report);
    } catch (error) {
        toast({ variant: "destructive", title: "Errore File", description: "Impossibile processare il file." });
    } finally {
        setIsImportingSettings(false);
        if (settingsInputRef.current) settingsInputRef.current.value = "";
    }
  };

  const handleDownloadSettingsTemplate = () => {
    const templateData = [
      {
        "CODICE ARTICOLO": "ESEMPIO-01",
        "CICLO PREDEFINITO": "Ciclo Standard",
        "TEMPO PREVISTO CICLO PREDEFINITO": 10.5,
        "CICLO SECONDARIO": "Ciclo Alternativo",
        "TEMPO PREVISTO CICLO SECONDARIO": 12.0
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Cicli e Tempi");
    XLSX.writeFile(wb, "template_cicli_tempi.xlsx");
    toast({ title: "Template Scaricato" });
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

  const handleConfirmSettingsUpdate = async () => {
    if (!settingsReport) return;
    setIsSavingBulk(true);
    const result = await bulkUpdateArticleSettings(settingsReport.validUpdates);
    toast({ title: result.success ? "Impostazioni Aggiornate" : "Errore", description: result.message, variant: result.success ? "default" : "destructive" });
    if (result.success) {
        setSettingsReport(null);
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
            <p className="text-muted-foreground mt-1">Gestisci la distinta base e i tempi standard per ogni articolo.</p>
          </div>
          <div className="flex items-center gap-2 pt-2 w-full sm:w-auto flex-wrap justify-end">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
            <input type="file" ref={settingsInputRef} onChange={handleSettingsFileChange} accept=".xlsx, .xls" className="hidden" />
            
            <Button onClick={handleDownloadSettingsTemplate} variant="outline" size="sm" className="bg-amber-500/10 border-amber-500/50 text-amber-700 dark:text-amber-400 h-9 px-3">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Template Impostazioni
            </Button>

            <Button onClick={() => settingsInputRef.current?.click()} variant="outline" size="sm" disabled={isImportingSettings} className="bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400 h-9 px-3">
               {isImportingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileEdit className="mr-2 h-4 w-4" />}
              Importa Cicli/tempi
            </Button>

            <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" disabled={isImporting} className="h-9 px-3">
               {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
              Importa BOM
            </Button>
            <div className="relative w-full sm:w-48 lg:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cerca..." className="pl-9 h-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Button onClick={() => handleOpenForm(null)} className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-4"><PlusCircle className="mr-2 h-4 w-4" />Aggiungi</Button>
          </div>
        </header>

        <Card>
          <CardHeader><CardTitle>Elenco Articoli</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Codice Articolo</TableHead>
                    <TableHead>N° Componenti</TableHead>
                    <TableHead>Ciclo Predefinito</TableHead>
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
                         <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px] uppercase">
                                {article.workCycleId ? "Assegnato" : "Non impostato"}
                            </Badge>
                         </TableCell>
                        <TableCell className="text-right space-x-2">
                           <Button variant="outline" size="sm" onClick={() => handleOpenTimes(article)}>
                            <Timer className="mr-2 h-4 w-4 text-amber-500" /> Cicli/Tempi
                          </Button>
                           <Button variant="outline" size="sm" onClick={() => handleOpenForm(article)}>
                            <Edit className="mr-2 h-4 w-4" /> BOM
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
                    <TableRow><TableCell colSpan={4} className="h-24 text-center">Nessun articolo trovato.</TableCell></TableRow>
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
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-6 w-6 text-primary" /> Analisi Importazione Distinte</DialogTitle></DialogHeader>
            <Tabs defaultValue="new" className="flex-1 overflow-hidden flex flex-col mt-4">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="new"><PlusCircle className="h-4 w-4 text-green-500 mr-2" /> Nuovi ({importReport?.newArticles.length || 0})</TabsTrigger>
                    <TabsTrigger value="update"><RefreshCcw className="h-4 w-4 text-blue-500 mr-2" /> Aggiorna ({importReport?.updatedArticles.length || 0})</TabsTrigger>
                    <TabsTrigger value="errors"><XCircle className="h-4 w-4 text-destructive mr-2" /> Errori ({importReport?.invalidArticles.length || 0})</TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="flex-1 overflow-hidden pt-4">
                  <ScrollArea className="h-[400px] border rounded-md p-2">
                    <Table>
                      <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Componenti</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {importReport?.newArticles.map((art, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono">{art.code}</TableCell>
                            <TableCell>{art.billOfMaterials.length}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="update" className="flex-1 overflow-hidden pt-4">
                  <ScrollArea className="h-[400px] border rounded-md p-2">
                    <Table>
                      <TableHeader><TableRow><TableHead>Codice Esistente</TableHead><TableHead>Nuova Distinta</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {importReport?.updatedArticles.map((art, idx) => (
                          <TableRow key={idx} className="bg-blue-500/5">
                            <TableCell className="font-mono font-bold text-blue-700">{art.code}</TableCell>
                            <TableCell>{art.billOfMaterials.length} comp. (verrà aggiornata)</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="errors" className="flex-1 overflow-hidden pt-4">
                  <ScrollArea className="h-[400px] border rounded-md p-2">
                    <div className="space-y-4">
                      {importReport?.invalidArticles.map((item, idx) => (
                        <div key={idx} className="p-3 border-l-4 border-destructive bg-destructive/5">
                          <p className="font-bold text-destructive">{item.code}</p>
                          <ul className="text-xs mt-1">
                            {item.errors.map((err, eIdx) => <li key={eIdx}>• {err}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
            </Tabs>
            <DialogFooter className="mt-6 border-t pt-4">
              <Button variant="outline" onClick={() => setImportReport(null)}>Annulla tutto</Button>
              <Button onClick={handleConfirmImport} disabled={isSavingBulk || (!importReport?.newArticles.length && !importReport?.updatedArticles.length)} className="bg-green-600 hover:bg-green-700 text-white">
                {isSavingBulk ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Conferma Caricamento
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!settingsReport} onOpenChange={(o) => !o && setSettingsReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><FileEdit className="h-6 w-6 text-amber-500" /> Analisi Aggiornamento Cicli/Tempi</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-hidden flex flex-col mt-4 space-y-4">
                <div className="flex gap-4">
                    <Card className="flex-1 border-green-500/20 bg-green-500/5">
                        <CardHeader className="p-3 pb-0"><CardTitle className="text-sm font-bold text-green-700">Validi per Update</CardTitle></CardHeader>
                        <CardContent className="text-2xl font-black text-green-600">{settingsReport?.validUpdates.length || 0}</CardContent>
                    </Card>
                    <Card className="flex-1 border-destructive/20 bg-destructive/5">
                        <CardHeader className="p-3 pb-0"><CardTitle className="text-sm font-bold text-destructive">Errori (Bloccati)</CardTitle></CardHeader>
                        <CardContent className="text-2xl font-black text-destructive">{settingsReport?.invalidRows.length || 0}</CardContent>
                    </div>
                </div>

                <Tabs defaultValue="valid" className="flex-1 overflow-hidden flex flex-col">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="valid">Dati da Applicare</TabsTrigger>
                        <TabsTrigger value="invalid">Errori</TabsTrigger>
                    </TabsList>
                    <TabsContent value="valid" className="flex-1 overflow-hidden pt-4">
                        <ScrollArea className="h-[350px] border rounded-md p-2">
                            <Table>
                                <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Ciclo Def.</TableHead><TableHead>Tempo</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {settingsReport?.validUpdates.map((upd, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-mono font-bold">{upd.code}</TableCell>
                                            <TableCell className="text-xs">{upd.workCycleId ? "SI" : "-"}</TableCell>
                                            <TableCell className="font-mono">{upd.expectedMinutesDefault} min</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </TabsContent>
                    <TabsContent value="invalid" className="flex-1 overflow-hidden pt-4">
                        <ScrollArea className="h-[350px] border rounded-md p-2">
                            <div className="space-y-2">
                                {settingsReport?.invalidRows.map((err, i) => (
                                    <div key={i} className="p-2 border-l-4 border-destructive bg-destructive/5 text-xs">
                                        <span className="font-bold">{err.code}</span>: {err.reason}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </div>
            <DialogFooter className="mt-6 border-t pt-4">
                <Button variant="outline" onClick={() => setSettingsReport(null)}>Annulla tutto</Button>
                <Button onClick={handleConfirmSettingsUpdate} disabled={isSavingBulk || !settingsReport?.validUpdates.length} className="bg-amber-600 hover:bg-amber-700 text-white">
                    {isSavingBulk ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Conferma e Aggiorna Anagrafiche
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}