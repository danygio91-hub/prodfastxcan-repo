
"use client";

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, PlusCircle, Search } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Article {
  code: string;
}

interface ArticleManagementClientPageProps {
  initialArticles: Article[];
}

export default function ArticleManagementClientPage({ initialArticles }: ArticleManagementClientPageProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredArticles = useMemo(() => {
    if (!searchTerm) {
      return initialArticles;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return initialArticles.filter(article =>
      article.code.toLowerCase().includes(lowercasedFilter)
    );
  }, [initialArticles, searchTerm]);

  return (
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
          <Button>
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
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" disabled>
                          Gestisci DB
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="h-24 text-center">
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
  );
}
