'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Timer, Layers, Package, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Article, WorkPhaseTemplate, WorkCycle, RawMaterial } from '@/types';
import type { GlobalSettings } from '@/lib/settings-types';
import ArticleTimesDialog from '@/app/admin/article-management/ArticleTimesDialog';
import ArticleFormDialog from '@/app/admin/article-management/ArticleFormDialog';
import { getArticleMasterData } from '@/app/admin/article-management/actions';
import { quickArticleCache, type ArticleMasterData } from '@/lib/quick-article-cache';
import { withNetworkRetry, DEFAULT_NETWORK_RETRY_CONFIG } from '@/lib/network-resilience';

export interface QuickArticleEditDrawerProps {
  isOpen: boolean;
  onClose: (refreshed?: boolean) => void;
  articleCode: string | null;
  articles?: Article[];
  phaseTemplates?: WorkPhaseTemplate[];
  workCycles?: WorkCycle[];
  globalSettings?: GlobalSettings | null;
  onArticleUpdated?: (updatedArticle: Article) => void;
}

interface UseQuickArticleSWROptions {
  keepPreviousData?: boolean;
  initialPhaseTemplates?: WorkPhaseTemplate[];
  initialWorkCycles?: WorkCycle[];
  initialGlobalSettings?: GlobalSettings | null;
}

/**
 * FASE 90: Hook SWR-style dedicato al caricamento isolato dei dati del singolo articolo
 * con { keepPreviousData: false } per scartare istantaneamente i dati dell'articolo precedente
 * al cambio di articleId / articleCode ed evitare stalli di stato o race condition.
 */
function useQuickArticleSWR(
  articleId: string | null,
  options: UseQuickArticleSWROptions = { keepPreviousData: false }
) {
  const {
    keepPreviousData = false,
    initialPhaseTemplates = [],
    initialWorkCycles = [],
    initialGlobalSettings = null,
  } = options;
  const { toast } = useToast();

  const [data, setData] = useState<ArticleMasterData | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const requestCounterRef = useRef(0);

  // Scarta immediatamente i dati precedenti quando cambia l'ID e keepPreviousData è false
  useEffect(() => {
    if (!articleId) {
      setData(null);
      setLoadedId(null);
      setIsLoading(false);
      return;
    }

    const upper = articleId.trim().toUpperCase();

    if (!keepPreviousData) {
      setData(null);
      setLoadedId(null);
    }

    // 1. Verifica cache client istantanea (0ms)
    const cached = quickArticleCache.get(upper);
    const hasCompleteMaster =
      cached &&
      cached.article &&
      (cached.phaseTemplates.length > 0 || initialPhaseTemplates.length > 0) &&
      (cached.workCycles.length > 0 || initialWorkCycles.length > 0);

    if (cached && hasCompleteMaster) {
      const mergedCached: ArticleMasterData = {
        article: cached.article,
        workCycles: cached.workCycles.length > 0 ? cached.workCycles : initialWorkCycles,
        phaseTemplates: cached.phaseTemplates.length > 0 ? cached.phaseTemplates : initialPhaseTemplates,
        globalSettings: cached.globalSettings ?? initialGlobalSettings,
        materials: cached.materials || [],
      };
      setData(mergedCached);
      setLoadedId(upper);
      setIsLoading(false);
      return;
    }

    // 2. Fetch server-side isolato con guardia anti-race e .finally() garantito
    let isCancelled = false;
    const currentReqId = ++requestCounterRef.current;
    setIsLoading(true);

    withNetworkRetry(() => getArticleMasterData(upper), DEFAULT_NETWORK_RETRY_CONFIG)
      .then((masterData) => {
        if (isCancelled || currentReqId !== requestCounterRef.current) return;

        const normalizedMaster: ArticleMasterData = {
          article: masterData.article,
          workCycles: masterData.workCycles?.length ? masterData.workCycles : initialWorkCycles,
          phaseTemplates: masterData.phaseTemplates?.length ? masterData.phaseTemplates : initialPhaseTemplates,
          globalSettings: masterData.globalSettings ?? initialGlobalSettings,
          materials: masterData.materials || [],
        };

        quickArticleCache.set(upper, normalizedMaster);
        setData(normalizedMaster);
        setLoadedId(upper);
      })
      .catch((err: any) => {
        console.error('Errore nel caricamento anagrafica rapida articolo:', err);
        if (!isCancelled && currentReqId === requestCounterRef.current) {
          toast({
            variant: 'destructive',
            title: 'Errore Articolo',
            description: "Impossibile recuperare i dettagli dell'articolo.",
          });
        }
      })
      .finally(() => {
        if (!isCancelled && currentReqId === requestCounterRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [articleId, keepPreviousData, initialPhaseTemplates, initialWorkCycles, initialGlobalSettings, toast]);

  // Mutate ottimistico specifico per l'articolo corrente senza blocco UI
  const mutate = useCallback(
    (
      updater: ArticleMasterData | ((current: ArticleMasterData | null) => ArticleMasterData | null)
    ) => {
      if (!articleId) return;
      const upper = articleId.trim().toUpperCase();
      setData((prev) => {
        const base =
          prev ||
          quickArticleCache.get(upper) || {
            article: null,
            workCycles: initialWorkCycles,
            phaseTemplates: initialPhaseTemplates,
            globalSettings: initialGlobalSettings,
            materials: [],
          };
        const next = typeof updater === 'function' ? updater(base) : updater;
        if (next) {
          quickArticleCache.set(upper, next);
          setLoadedId(upper);
        } else {
          quickArticleCache.invalidate(upper);
        }
        return next;
      });
    },
    [articleId, initialWorkCycles, initialPhaseTemplates, initialGlobalSettings]
  );

  // Con keepPreviousData: false, se l'ID richiesto non coincide con quello caricato, non esporre mai il dato vecchio
  const effectiveData =
    !keepPreviousData && articleId && loadedId !== articleId.trim().toUpperCase() ? null : data;

  return {
    data: effectiveData,
    isLoading: Boolean(articleId) && (isLoading || (!effectiveData && loadedId !== articleId?.trim().toUpperCase())),
    mutate,
  };
}

/**
 * FASE 54 & FASE 90: Quick-Edit Anagrafica Articolo in sovrimpressione da DataGrid.
 * Permette di modificare Standard Tempi / Cicli e Distinta Base (BOM)
 * direttamente in un Drawer laterale senza mai abbandonare la pagina della programmazione,
 * usando Optimistic/Local Mutate senza router.refresh() bloccanti.
 */
export function QuickArticleEditDrawer({
  isOpen,
  onClose,
  articleCode,
  phaseTemplates: initialPhaseTemplates = [],
  workCycles: initialWorkCycles = [],
  globalSettings: initialGlobalSettings = null,
  onArticleUpdated,
}: QuickArticleEditDrawerProps) {
  const [activeTab, setActiveTab] = useState<'times' | 'bom'>('times');
  const [hasSavedAny, setHasSavedAny] = useState(false);

  const cleanCode = (articleCode || '').trim();
  const activeArticleKey = isOpen && cleanCode ? cleanCode.toUpperCase() : null;

  // FASE 90 (1): Hook di fetching isolato con { keepPreviousData: false }
  const { data: masterData, isLoading, mutate: mutateArticle } = useQuickArticleSWR(activeArticleKey, {
    keepPreviousData: false,
    initialPhaseTemplates,
    initialWorkCycles,
    initialGlobalSettings,
  });

  // FASE 90 (1): Pulizia esplicita dello stato locale del pannello al cambio di articolo
  useEffect(() => {
    setHasSavedAny(false);
    setActiveTab('times');
  }, [activeArticleKey]);

  const currentArticle = masterData?.article ?? null;
  const workCycles = masterData?.workCycles?.length ? masterData.workCycles : initialWorkCycles;
  const phaseTemplates = masterData?.phaseTemplates?.length ? masterData.phaseTemplates : initialPhaseTemplates;
  const globalSettings = masterData?.globalSettings ?? initialGlobalSettings;
  const preloadedMaterials = masterData?.materials ?? [];

  // FASE 90 (2): Salvataggio Standard Tempi con Optimistic Mutate locale (NO router.refresh)
  const handleTimesSaved = useCallback(
    (refresh?: boolean, updatedArticle?: Article) => {
      if (updatedArticle) {
        mutateArticle((prev) => ({
          article: updatedArticle,
          workCycles: prev?.workCycles?.length ? prev.workCycles : initialWorkCycles,
          phaseTemplates: prev?.phaseTemplates?.length ? prev.phaseTemplates : initialPhaseTemplates,
          globalSettings: prev?.globalSettings ?? initialGlobalSettings,
          materials: prev?.materials || [],
        }));
        setHasSavedAny(true);
        onArticleUpdated?.(updatedArticle);
      } else if (refresh) {
        setHasSavedAny(true);
      }
    },
    [mutateArticle, initialWorkCycles, initialPhaseTemplates, initialGlobalSettings, onArticleUpdated]
  );

  // FASE 90 (2): Salvataggio Distinta Base (BOM) con Optimistic Mutate locale (NO router.refresh)
  const handleBOMSaved = useCallback(
    (refresh?: boolean, updatedArticle?: Article) => {
      if (updatedArticle) {
        mutateArticle((prev) => ({
          article: updatedArticle,
          workCycles: prev?.workCycles?.length ? prev.workCycles : initialWorkCycles,
          phaseTemplates: prev?.phaseTemplates?.length ? prev.phaseTemplates : initialPhaseTemplates,
          globalSettings: prev?.globalSettings ?? initialGlobalSettings,
          materials: prev?.materials || [],
        }));
        setHasSavedAny(true);
        onArticleUpdated?.(updatedArticle);
      } else if (refresh) {
        setHasSavedAny(true);
      }
    },
    [mutateArticle, initialWorkCycles, initialPhaseTemplates, initialGlobalSettings, onArticleUpdated]
  );

  // FASE 90 (2): Chiusura istantanea del Drawer senza router.refresh() bloccante
  const handleClose = useCallback(() => {
    onClose(hasSavedAny);
  }, [hasSavedAny, onClose]);

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
                    key={`times-${currentArticle.id || currentArticle.code}`}
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
                    key={`bom-${currentArticle.id || currentArticle.code}`}
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
