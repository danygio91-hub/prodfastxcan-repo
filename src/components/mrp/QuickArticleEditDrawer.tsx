'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Timer, Layers, Package, Loader2, X, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Article, WorkPhaseTemplate, WorkCycle, RawMaterial } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import ArticleTimesDialog from '@/app/admin/article-management/ArticleTimesDialog';
import ArticleFormDialog from '@/app/admin/article-management/ArticleFormDialog';
import { getArticleMasterData } from '@/app/admin/article-management/actions';
import { quickArticleCache } from '@/lib/quick-article-cache';
import { cn } from '@/lib/utils';

export interface QuickArticleEditDrawerProps {
  isOpen: boolean;
  onClose: (refreshed?: boolean) => void;
  articleCode: string | null;
  articles?: Article[];
  phaseTemplates?: WorkPhaseTemplate[];
  onArticleUpdated?: (updatedArticle: Article) => void;
}

/**
 * FASE 54: Quick-Edit Anagrafica Articolo in sovrimpressione da DataGrid.
 * Permette di modificare Standard Tempi / Cicli e Distinta Base (BOM)
 * direttamente in un Drawer laterale senza mai abbandonare la pagina della programmazione,
 * mantenendo intatti filtri, contesto e posizione di scorrimento.
 */
export function QuickArticleEditDrawer({
  isOpen,
  onClose,
  articleCode,
  articles = [],
  phaseTemplates: initialPhaseTemplates,
  onArticleUpdated,
}: QuickArticleEditDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'times' | 'bom'>('times');
  const [currentArticle, setCurrentArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [phaseTemplates, setPhaseTemplates] = useState<WorkPhaseTemplate[]>(initialPhaseTemplates || []);
  const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [preloadedMaterials, setPreloadedMaterials] = useState<RawMaterial[]>([]);
  const [hasSavedAny, setHasSavedAny] = useState(false);
  const articlesRef = useRef(articles);
  articlesRef.current = articles;

  const cleanCode = (articleCode || '').trim();

  // Caricamento / Risoluzione dell'articolo e dei dati master (Parallelizzato con Cache Istantanea SWR)
  useEffect(() => {
    if (!isOpen || !cleanCode) {
      setCurrentArticle(null);
      setHasSavedAny(false);
      return;
    }

    const upper = cleanCode.toUpperCase();

    // 1. Client-side SWR Cache: apertura ISTANTANEA in 0ms se già aperto recentemente
    const cached = quickArticleCache.get(upper);
    if (cached) {
      setCurrentArticle(cached.article);
      setWorkCycles(cached.workCycles);
      setPhaseTemplates(cached.phaseTemplates);
      setGlobalSettings(cached.globalSettings);
      setPreloadedMaterials(cached.materials);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const resolveData = async () => {
      setIsLoading(true);
      setHasSavedAny(false);

      try {
        // 2. Fetch server-side singolo e parallelizzato (Promise.all - no waterfall)
        const masterData = await getArticleMasterData(upper);
        if (isCancelled) return;

        // Memorizza nella cache client per riaperture istantanee
        quickArticleCache.set(upper, masterData);

        setCurrentArticle(masterData.article);
        setWorkCycles(masterData.workCycles);
        setPhaseTemplates(masterData.phaseTemplates);
        setGlobalSettings(masterData.globalSettings);
        setPreloadedMaterials(masterData.materials);
      } catch (err: any) {
        console.error("Errore nel caricamento anagrafica rapida articolo:", err);
        if (!isCancelled) {
          toast({
            variant: "destructive",
            title: "Errore Articolo",
            description: "Impossibile recuperare i dettagli dell'articolo.",
          });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    resolveData();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, cleanCode]);

  // Gestione salvataggio Standard Tempi
  const handleTimesSaved = useCallback(
    (refresh?: boolean, updatedArticle?: Article) => {
      if (updatedArticle) {
        setCurrentArticle(updatedArticle);
        quickArticleCache.updateArticle(updatedArticle);
        setHasSavedAny(true);
        onArticleUpdated?.(updatedArticle);
        router.refresh();
      } else if (refresh) {
        setHasSavedAny(true);
        router.refresh();
      }
    },
    [onArticleUpdated, router]
  );

  // Gestione salvataggio Distinta Base (BOM)
  const handleBOMSaved = useCallback(
    (refresh?: boolean, updatedArticle?: Article) => {
      if (updatedArticle) {
        setCurrentArticle(updatedArticle);
        quickArticleCache.updateArticle(updatedArticle);
        setHasSavedAny(true);
        onArticleUpdated?.(updatedArticle);
        router.refresh();
      } else if (refresh) {
        setHasSavedAny(true);
        router.refresh();
      }
    },
    [onArticleUpdated, router]
  );

  // Chiusura del Drawer con revalidazione se ci sono stati salvataggi
  const handleClose = useCallback(() => {
    if (hasSavedAny) {
      router.refresh();
      onClose(true);
    } else {
      onClose(false);
    }
  }, [hasSavedAny, router, onClose]);

  if (!isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-4xl p-0 flex flex-col h-full overflow-hidden bg-background border-l border-border shadow-2xl"
      >
        {/* HEADER DRAWER */}
        <SheetHeader className="p-5 pb-3 border-b bg-gradient-to-r from-blue-500/10 via-background to-background">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-xs">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold flex items-center gap-2">
                  <span>Anagrafica Rapida:</span>
                  <Badge
                    variant="outline"
                    className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-mono text-sm px-2 py-0.5"
                  >
                    {cleanCode || 'N/D'}
                  </Badge>
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground mt-1">
                  Modifica <strong>Tempi Standard</strong> e <strong>Distinta Base</strong> in sovrimpressione. I dati si riflettono istantaneamente sulle commesse collegate.
                </SheetDescription>
              </div>
            </div>

            {hasSavedAny && (
              <Badge className="bg-emerald-600 text-white font-semibold gap-1 text-xs px-2 py-0.5 animate-in fade-in">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Modifiche Salvate</span>
              </Badge>
            )}
          </div>

          {/* TAB BAR SELECTOR */}
          <div className="pt-3">
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as 'times' | 'bom')}
              className="w-full"
            >
              <TabsList className="grid grid-cols-2 max-w-md h-9 bg-muted/60 p-1 border">
                <TabsTrigger
                  value="times"
                  className="text-xs font-semibold gap-1.5 data-[state=active]:bg-amber-600 data-[state=active]:text-white transition-all"
                >
                  <Timer className="h-4 w-4" />
                  <span>Standard Tempi & Cicli</span>
                </TabsTrigger>
                <TabsTrigger
                  value="bom"
                  className="text-xs font-semibold gap-1.5 data-[state=active]:bg-blue-600 data-[state=active]:text-white transition-all"
                >
                  <Layers className="h-4 w-4" />
                  <span>Distinta Base (BOM)</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </SheetHeader>

        {/* CONTENUTO PRINCIPALE */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium">Caricamento anagrafica articolo...</p>
            </div>
          ) : !currentArticle ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground text-center">
              <AlertCircle className="h-10 w-10 text-amber-500 mb-2 opacity-80" />
              <p className="text-sm font-semibold text-foreground">Articolo non trovato</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Impossibile trovare o inizializzare l'anagrafica per il codice "{cleanCode}".
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* TAB 1: STANDARD TEMPI & CICLI */}
              {activeTab === 'times' && (
                <div className="flex-1 overflow-hidden flex flex-col h-full">
                  <ArticleTimesDialog
                    embedded
                    isOpen={isOpen}
                    article={currentArticle}
                    phaseTemplates={phaseTemplates}
                    workCycles={workCycles}
                    onClose={handleTimesSaved}
                  />
                </div>
              )}

              {/* TAB 2: DISTINTA BASE (BOM) */}
              {activeTab === 'bom' && (
                <div className="flex-1 overflow-hidden flex flex-col h-full">
                  <ArticleFormDialog
                    embedded
                    isOpen={isOpen}
                    article={currentArticle}
                    workCycles={workCycles}
                    globalSettings={globalSettings}
                    preloadedMaterials={preloadedMaterials}
                    onClose={handleBOMSaved}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default QuickArticleEditDrawer;
