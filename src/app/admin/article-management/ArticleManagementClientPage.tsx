

"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search, Trash2, Edit, Download, Upload, Loader2, BarChart3, Copy } from 'lucide-react';
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
import type { Article, RawMaterial } from '@/lib/mock-data';
import ArticleFormDialog from './ArticleFormDialog';
import { deleteArticle, saveArticle } from './actions';
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
        "Componente": "COMP-A (es. vite)",
        "Unità di Misura": "n",
        "Quantità per Pz": 2,
        "Lunghezza Taglio (mm)": ""
      },
       { 
        "Codice Articolo": "ART-002",
        "Componente": "COMP-B (es. tubo)",
        "Unità di Misura": "n",
        "Quantità per Pz": 1,
        "Lunghezza Taglio (mm)": 1260
      },
       { 
        "Codice Articolo": "ART-002",
        "Componente": "COMP-C (es. profilo)",
        "Unità di Misura": "mt",
        "Quantità per Pz": 0.5,
        "Lunghezza Taglio (mm)": ""
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Distinta Base");
    XLSX.writeFile(wb, "template_distinta_base.xlsx");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    toast({ title: 'Importazione in corso...', description: 'Analisi del file Excel.' });

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);

      const articlesToImport: { [code: string]: Omit<Article, 'id'> } = {};
      const errors: string[] = [];
      const validMaterialCodes = new Set(rawMaterials.map(m => m.code));

      for (const row of json) {
        const articleCode = row['Codice Articolo'] || row['codice articolo'];
        const component = row['Componente'] || row['componente'];
        const quantity = row['Quantità per Pz'] || row['Quantità'] || row['quantità']; // Support old and new names
        
        if (!articleCode || !component || !quantity) {
          continue; 
        }

        const cleanComponentCode = String(component).split(' ')[0];

        if (!validMaterialCodes.has(cleanComponentCode)) {
          errors.push(`Articolo "${articleCode}": Componente non valido "${component}".`);
          continue;
        }

        if (!articlesToImport[articleCode]) {
          articlesToImport[articleCode] = {
            code: articleCode,
            billOfMaterials: [],
          };
        }
        
        const unit = String(row['Unità di Misura'] || row['unità di misura'] || 'n').toLowerCase() as 'n' | 'mt' | 'kg';
        const lunghezzaTaglio = row['Lunghezza Taglio (mm)'] || row['lunghezza taglio (mm)'] || row['Numero/Misura'] || row['numero/misura'];

        const bomItem: any = {
          component: cleanComponentCode,
          unit,
          quantity: Number(quantity),
        };
        
        if (lunghezzaTaglio) {
          const parsedLength = parseFloat(String(lunghezzaTaglio));
          if (!isNaN(parsedLength) && parsedLength > 0) { // If it's a number, it's a length
            bomItem.lunghezzaTaglioMm = parsedLength;
          } else if (typeof lunghezzaTaglio === 'string' && lunghezzaTaglio.trim() !== '') { // Otherwise it's a note
            bomItem.note = String(lunghezzaTaglio);
          }
        }

        articlesToImport[articleCode].billOfMaterials.push(bomItem);
      }

      if (errors.length > 0) {
        toast({
          variant: "destructive",
          title: "Errore di Validazione Importazione",
          description: `Impossibile importare. ${errors.length} componenti non esistono nell'anagrafica materie prime. Esempio: ${errors[0]}`,
          duration: 9000,
        });
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      
      const articlePromises = Object.values(articlesToImport).map(articleData => saveArticle(articleData));
      const results = await Promise.all(articlePromises);
      
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.length - successCount;

      toast({
        title: "Importazione Completata",
        description: `${successCount} articoli importati/aggiornati. ${errorCount > 0 ? `${errorCount} con errori.` : ''}`,
      });

      if (successCount > 0) {
        router.refresh();
      }

    } catch (error) {
      toast({
        variant: "destructive",
        title: "Errore Importazione",
        description: error instanceof Error ? error.message : "Impossibile leggere o processare il file.",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
            <Button onClick={handleImportClick} variant="outline" size="sm" disabled={isImporting}>
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
                        {initialArticles.length === 0 ? "Nessun articolo con dati di produzione trovato." : "Nessun articolo trovato per la ricerca."}
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
    </>
  );
}
