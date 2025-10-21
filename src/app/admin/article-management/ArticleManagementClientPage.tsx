
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search, Trash2, Edit } from 'lucide-react';
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
import type { Article } from '@/lib/mock-data';
import ArticleFormDialog from './ArticleFormDialog';
import { deleteArticle } from './actions';
import { useRouter } from 'next/navigation';

interface ArticleManagementClientPageProps {
  initialArticles: Article[];
}

export default function ArticleManagementClientPage({ initialArticles }: ArticleManagementClientPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const { toast } = useToast();
  const router = useRouter();

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
  
  const handleFormClose = (refresh: boolean) => {
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
          <div className="flex items-center gap-2 pt-2 w-full sm:w-auto">
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
                              <ContextMenuTrigger className="font-medium">{article.code}</ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem disabled>Analisi Tempi Articolo</ContextMenuItem>
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
      />
    </>
  );
}
