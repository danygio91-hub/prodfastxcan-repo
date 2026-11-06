'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Truck,
  Scissors,
  Package,
  Layers,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Info,
  X
} from 'lucide-react';
import { JobOrder, Article, RawMaterial, JobBillOfMaterialsItem } from '@/types';
import { updateExternalizedMaterials } from '@/app/admin/programmazione/actions';
import { cn } from '@/lib/utils';

export type MaterialCategoryType = 'TRECCE' | 'TUBI' | 'GUAINA' | 'ALTRO';

export type TabType = 'ALL' | 'TRECCE' | 'TUBI' | 'GUAINA' | 'ALTRO' | 'EXTERNALIZED';

/**
 * FASE 53: Classificazione rigorosa dei materiali della distinta base (Strict Mapping)
 * Rispettando le definizioni e separazioni già in uso per la generazione ODL e l'anagrafica fasi:
 * - Preparazione Trecce/Corde (BOB, TRECCIA, CORDA, CAVO, BARRA, PF3V0)
 * - Preparazione Tubi (TUBI, TUBO, prefissi TB/TU, diciture Tubi)
 * - Preparazione Guaina (GUAINA, prefissi GU/GUA, diciture Guaina/Termorestringente)
 * - Altro (qualsiasi componente non appartenente alle tre categorie principali - NESSUN fallback a Guaina!)
 */
export function classifyBOMMaterial(
  componentCode: string,
  rawMaterial?: RawMaterial
): MaterialCategoryType {
  const codeUpper = (componentCode || '').trim().toUpperCase();
  const rawType = (rawMaterial?.type || '').trim().toUpperCase();
  const rawDesc = (rawMaterial?.description || '').trim().toUpperCase();

  // 1. Strict Mapping tramite tipo catalogo materie prime (RawMaterial.type)
  if (rawType === 'TUBI' || rawType === 'TUBO') {
    return 'TUBI';
  }
  if (rawType === 'GUAINA' || rawType === 'GUAINE') {
    return 'GUAINA';
  }
  if (['BOB', 'TRECCIA', 'TRECCE', 'CORDA', 'CORDE', 'CAVO', 'CAVI', 'BARRA', 'PF3V0'].includes(rawType)) {
    return 'TRECCE';
  }

  // 2. Strict Mapping per prefissi standard del codice componente
  if (codeUpper.startsWith('TB-') || codeUpper.startsWith('TU-')) {
    return 'TUBI';
  }
  if (codeUpper.startsWith('GU-') || codeUpper.startsWith('GUA-')) {
    return 'GUAINA';
  }
  if (codeUpper.startsWith('TR-') || codeUpper.startsWith('CR-')) {
    return 'TRECCE';
  }

  // 3. Strict Mapping per parole chiave nella descrizione o codice
  // Es. "14X1L23SN TUBI STAGNATI"
  if (/\bTUB[IO]?\b|TUBI|TUBO|STAGNAT[OI]/i.test(rawDesc) || /TUB/i.test(codeUpper)) {
    return 'TUBI';
  }
  if (/GUAIN|TERMOREST/i.test(rawDesc) || /GUAIN|TERMOREST/i.test(codeUpper)) {
    return 'GUAINA';
  }
  if (/TRECC|CORD|CAV|BOB|TREFOL/i.test(rawDesc) || /TRECC|CORD|CAV|BOB|TREFOL/i.test(codeUpper)) {
    return 'TRECCE';
  }

  // 4. Fallback trasparente: ALTRO (nessun fallback pigro a Guaina!)
  return 'ALTRO';
}

interface ClassifiedBOMItem {
  component: string;
  quantity: number;
  unit: string;
  lunghezzaTaglioMm?: number;
  note?: string;
  category: MaterialCategoryType;
  rawMaterial?: RawMaterial;
  isExternalized: boolean;
}

interface ContoLavoroModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: JobOrder | null;
  articles?: Article[];
  rawMaterials?: RawMaterial[];
  onSave?: (jobId: string, externalizedMaterials: string[]) => Promise<boolean>;
  onToggleMaterial?: (jobId: string, materialCode: string, isExternalized: boolean) => Promise<boolean>;
}

export function ContoLavoroModal({
  isOpen,
  onClose,
  job,
  articles = [],
  rawMaterials = [],
  onSave,
  onToggleMaterial,
}: ContoLavoroModalProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('ALL');
  // FASE 53: Stato locale per Batch Save (Salvataggio in blocco)
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Inizializza lo stato locale delle selezioni ogni volta che il modale viene aperto o cambia job
  useEffect(() => {
    if (isOpen && job) {
      const initial = (job.externalizedMaterials || [])
        .map((c) => (c || '').trim().toUpperCase())
        .filter(Boolean);
      setSelectedMaterials(initial);
      setSearchTerm('');
      setActiveTab('ALL');
    }
  }, [isOpen, job]);

  // Mappa di lookup per le materie prime
  const materialsMap = useMemo(() => {
    const map = new Map<string, RawMaterial>();
    (rawMaterials || []).forEach((m) => {
      if (m && m.code) {
        map.set(m.code.trim().toUpperCase(), m);
      }
    });
    return map;
  }, [rawMaterials]);

  // Articolo collegato per eventuale fallback di BOM
  const relatedArticle = useMemo(() => {
    if (!job || !articles) return null;
    const artCode = ((job as any).articolo || job.details || '').trim().toUpperCase();
    return articles.find((a) => a.code.trim().toUpperCase() === artCode) || null;
  }, [job, articles]);

  // Set reattivo dei materiali selezionati localmente
  const selectedSet = useMemo(() => new Set(selectedMaterials), [selectedMaterials]);

  // Raccogli e classifica tutti i materiali in BOM
  const classifiedItems = useMemo<ClassifiedBOMItem[]>(() => {
    if (!job) return [];

    let bom: JobBillOfMaterialsItem[] = job.billOfMaterials || [];
    // Fallback su articolo se la commessa non ha una BOM esplicita
    if (bom.length === 0 && relatedArticle && relatedArticle.billOfMaterials) {
      bom = relatedArticle.billOfMaterials.map((ab) => ({
        component: ab.component,
        quantity: ab.quantity,
        unit: ab.unit,
        lunghezzaTaglioMm: ab.lunghezzaTaglioMm,
        note: ab.note,
        status: 'pending',
        isFromTemplate: true,
      }));
    }

    return bom.map((item) => {
      const code = (item.component || '').trim().toUpperCase();
      const rawMat = materialsMap.get(code);
      const category = classifyBOMMaterial(code, rawMat);

      return {
        component: code,
        quantity: item.quantity || 0,
        unit: (item.unit || rawMat?.unitOfMeasure || 'pz').toLowerCase(),
        lunghezzaTaglioMm: item.lunghezzaTaglioMm,
        note: item.note,
        category,
        rawMaterial: rawMat,
        isExternalized: selectedSet.has(code),
      };
    });
  }, [job, relatedArticle, materialsMap, selectedSet]);

  // Conteggi per le tab
  const counts = useMemo(() => {
    return {
      all: classifiedItems.length,
      trecce: classifiedItems.filter((i) => i.category === 'TRECCE').length,
      tubi: classifiedItems.filter((i) => i.category === 'TUBI').length,
      guaina: classifiedItems.filter((i) => i.category === 'GUAINA').length,
      altro: classifiedItems.filter((i) => i.category === 'ALTRO').length,
      externalized: classifiedItems.filter((i) => i.isExternalized).length,
    };
  }, [classifiedItems]);

  // FASE 53: Generazione DINAMICA delle tab in base alle categorie REALMENTE presenti
  const availableTabs = useMemo(() => {
    const list: {
      id: TabType;
      label: string;
      count: number;
      icon: React.ReactNode;
      activeClass: string;
      badgeBorder: string;
    }[] = [
      {
        id: 'ALL',
        label: `Tutti (${counts.all})`,
        count: counts.all,
        icon: <Package className="h-3 w-3" />,
        activeClass: 'bg-purple-600 hover:bg-purple-700 text-white',
        badgeBorder: '',
      },
    ];

    if (counts.trecce > 0) {
      list.push({
        id: 'TRECCE',
        label: `Trecce/Corde (${counts.trecce})`,
        count: counts.trecce,
        icon: <Scissors className="h-3 w-3 text-amber-500" />,
        activeClass: 'bg-amber-600 hover:bg-amber-700 text-white',
        badgeBorder: 'border-amber-500/30',
      });
    }

    if (counts.tubi > 0) {
      list.push({
        id: 'TUBI',
        label: `Tubi (${counts.tubi})`,
        count: counts.tubi,
        icon: <Layers className="h-3 w-3 text-blue-500" />,
        activeClass: 'bg-blue-600 hover:bg-blue-700 text-white',
        badgeBorder: 'border-blue-500/30',
      });
    }

    if (counts.guaina > 0) {
      list.push({
        id: 'GUAINA',
        label: `Guaina (${counts.guaina})`,
        count: counts.guaina,
        icon: <Scissors className="h-3 w-3 rotate-90 text-sky-500" />,
        activeClass: 'bg-sky-600 hover:bg-sky-700 text-white',
        badgeBorder: 'border-sky-500/30',
      });
    }

    if (counts.altro > 0) {
      list.push({
        id: 'ALTRO',
        label: `Altri (${counts.altro})`,
        count: counts.altro,
        icon: <Package className="h-3 w-3 text-slate-500" />,
        activeClass: 'bg-slate-600 hover:bg-slate-700 text-white',
        badgeBorder: 'border-slate-500/30',
      });
    }

    list.push({
      id: 'EXTERNALIZED',
      label: `In C.to Lavoro (${counts.externalized})`,
      count: counts.externalized,
      icon: <Truck className="h-3 w-3 text-purple-400" />,
      activeClass: 'bg-purple-600 hover:bg-purple-700 text-white',
      badgeBorder: 'border-purple-500/30',
    });

    return list;
  }, [counts]);

  // Se la tab attiva non è più tra quelle disponibili, ripristina 'ALL'
  useEffect(() => {
    if (!availableTabs.some((t) => t.id === activeTab)) {
      setActiveTab('ALL');
    }
  }, [availableTabs, activeTab]);

  // Filtra elementi in base a ricerca e tab attiva
  const filteredItems = useMemo(() => {
    return classifiedItems.filter((item) => {
      // Filtro Tab
      if (activeTab === 'TRECCE' && item.category !== 'TRECCE') return false;
      if (activeTab === 'TUBI' && item.category !== 'TUBI') return false;
      if (activeTab === 'GUAINA' && item.category !== 'GUAINA') return false;
      if (activeTab === 'ALTRO' && item.category !== 'ALTRO') return false;
      if (activeTab === 'EXTERNALIZED' && !item.isExternalized) return false;

      // Filtro Ricerca
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesCode = item.component.toLowerCase().includes(q);
        const matchesDesc = (item.rawMaterial?.description || '').toLowerCase().includes(q);
        const matchesNote = (item.note || '').toLowerCase().includes(q);
        return matchesCode || matchesDesc || matchesNote;
      }

      return true;
    });
  }, [classifiedItems, activeTab, searchTerm]);

  // FASE 53: Toggle in memoria locale (Zero chiamate di rete fino al Salva)
  const handleToggle = (materialCode: string, checked: boolean) => {
    const cleanCode = materialCode.trim().toUpperCase();
    setSelectedMaterials((prev) => {
      if (checked) {
        return prev.includes(cleanCode) ? prev : [...prev, cleanCode];
      } else {
        return prev.filter((c) => c !== cleanCode);
      }
    });
  };

  // FASE 53: Salvataggio in blocco su Firestore
  const handleSave = async () => {
    if (!job) return;
    setIsSaving(true);
    try {
      let isSuccess = false;
      if (onSave) {
        isSuccess = await onSave(job.id, selectedMaterials);
      } else {
        const res = await updateExternalizedMaterials(job.id, selectedMaterials);
        if (res.success) {
          toast({
            title: "C.to Lavoro Aggiornato",
            description: res.message,
          });
          isSuccess = true;
        } else {
          toast({
            variant: "destructive",
            title: "Errore Salvataggio",
            description: res.message,
          });
        }
      }

      if (isSuccess) {
        router.refresh();
        onClose();
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: err?.message || "Impossibile aggiornare i materiali in Conto Lavoro.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!job) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden border border-purple-500/30 shadow-2xl bg-background">
        {/* HEADER */}
        <DialogHeader className="p-5 pb-4 border-b border-border bg-gradient-to-r from-purple-500/10 via-background to-background">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 shadow-xs">
                <Truck className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <span>Gestione Conto Lavoro (Terzista)</span>
                  <Badge variant="outline" className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 font-mono text-xs">
                    {job.ordinePF || job.id}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Seleziona le materie prime da esternalizzare. I componenti selezionati verranno <strong className="text-purple-600 dark:text-purple-400 font-semibold">silenziati dal fabbisogno MRP</strong> di questa commessa.
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* RIEPILOGO COMMESSA */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/60">
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Cliente</span>
              <span className="font-semibold truncate block" title={job.cliente}>{job.cliente || 'N/D'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Articolo / Prodotto</span>
              <span className="font-semibold truncate block" title={job.details}>{job.details || 'N/D'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Quantità Commessa</span>
              <span className="font-bold font-mono text-foreground">{(job.qta || 0).toLocaleString('it-IT')} pz</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Stato Esternalizzazione</span>
              <span className="font-bold text-purple-600 dark:text-purple-400">
                {counts.externalized} su {counts.all} esternalizzati
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* INFO CALLOUT BANNER */}
        <div className="px-5 pt-3">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-950 dark:text-purple-200 text-xs leading-relaxed">
            <Info className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
            <div>
              <strong>Come funziona il Silenziatore Impegni:</strong> I materiali contrassegnati in Conto Lavoro non concorrono al fabbisogno impegnato e non attivano allarmi MRP per questa commessa. Il magazziniere scaricherà fisicamente a magazzino le bobine intere consegnate al terzista.
            </div>
          </div>
        </div>

        {/* BARRA FILTRI E RICERCA */}
        <div className="px-5 pt-3 pb-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* TABS DINAMICHE */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {availableTabs.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-7 text-xs px-2.5 gap-1.5 transition-colors",
                  tab.badgeBorder,
                  activeTab === tab.id && tab.activeClass
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </Button>
            ))}
          </div>

          {/* INPUT RICERCA */}
          <div className="relative w-full sm:w-56">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtra codice o desc..."
              className="h-7 text-xs pl-8 pr-7"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* LISTA MATERIALI BOM */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-xl border-border bg-muted/20 my-4">
              <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold text-foreground">Nessun componente trovato</p>
              <p className="text-xs text-muted-foreground mt-1">
                {classifiedItems.length === 0
                  ? "Nessuna distinta base configurata per questo articolo."
                  : "Nessun materiale corrisponde ai filtri impostati."}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const raw = item.rawMaterial;

              // Calcolo fabbisogno commessa
              const totalRequired = (item.quantity * (job.qta || 1));

              return (
                <div
                  key={item.component}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all duration-150",
                    item.isExternalized
                      ? "bg-purple-500/10 border-purple-500/40 shadow-xs"
                      : "bg-card border-border hover:border-border/80"
                  )}
                >
                  {/* DETTAGLI MATERIALE */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        "p-2 rounded-lg shrink-0 mt-0.5",
                        item.category === 'TRECCE' && "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25",
                        item.category === 'TUBI' && "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25",
                        item.category === 'GUAINA' && "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/25",
                        item.category === 'ALTRO' && "bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/25"
                      )}
                      title={`Fase: ${item.category}`}
                    >
                      {item.category === 'TRECCE' ? (
                        <Scissors className="h-4 w-4" />
                      ) : item.category === 'TUBI' ? (
                        <Layers className="h-4 w-4" />
                      ) : item.category === 'GUAINA' ? (
                        <Scissors className="h-4 w-4 rotate-90" />
                      ) : (
                        <Package className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="font-mono font-bold text-sm text-foreground tracking-tight">
                          {item.component}
                        </span>

                        {/* BADGE CATEGORIA EVIDENZIATO */}
                        {item.category === 'TRECCE' && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-semibold">
                            ✂️ Preparazione Trecce/Corde
                          </Badge>
                        )}
                        {item.category === 'TUBI' && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-semibold">
                            🔧 Preparazione Tubi
                          </Badge>
                        )}
                        {item.category === 'GUAINA' && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 font-semibold">
                            ✂️ Preparazione Guaina
                          </Badge>
                        )}
                        {item.category === 'ALTRO' && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30 font-semibold">
                            📦 Altri Componenti
                          </Badge>
                        )}

                        {/* BADGE STATO C.TO LAVORO */}
                        {item.isExternalized ? (
                          <Badge className="text-[10px] py-0 px-2 bg-purple-600 hover:bg-purple-600 text-white font-bold gap-1 shadow-xs">
                            <Truck className="h-3 w-3" />
                            <span>In C.to Lavoro</span>
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground border-border">
                            Interno Magazzino
                          </Badge>
                        )}
                      </div>

                      {/* DESCRIZIONE E SPECIFICHE */}
                      <p className="text-xs text-muted-foreground truncate" title={raw?.description || item.note}>
                        {raw?.description || item.note || 'Nessuna descrizione disponibile'}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
                        <span>
                          Fabbisogno per pz: <strong className="text-foreground">{item.quantity} {item.unit}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Totale commessa: <strong className="text-foreground">{totalRequired.toLocaleString('it-IT', { maximumFractionDigits: 2 })} {item.unit}</strong>
                        </span>
                        {item.lunghezzaTaglioMm !== undefined && item.lunghezzaTaglioMm !== null && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-purple-600 dark:text-purple-400">
                              L. taglio: {item.lunghezzaTaglioMm} mm
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CONTROLLO SWITCH C.TO LAVORO (IN MEMORIA LOCALE) */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50 shrink-0">
                    <div className="text-right">
                      <span className="text-xs font-semibold block text-foreground">
                        {item.isExternalized ? 'C.to Lavoro ATTIVO' : 'Esternalizza'}
                      </span>
                      <span className="text-[10px] text-muted-foreground block">
                        {item.isExternalized ? 'Impegno MRP silenziato' : 'Impegno normale'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={item.isExternalized}
                        onCheckedChange={(checked) => handleToggle(item.component, checked)}
                        disabled={isSaving}
                        aria-label={`Attiva conto lavoro per ${item.component}`}
                        className="data-[state=checked]:bg-purple-600"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER BATCH SAVE */}
        <DialogFooter className="p-4 border-t border-border bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="font-semibold text-purple-600 dark:text-purple-400">
              {counts.externalized}
            </span>
            <span>su {counts.all} componenti selezionati per C.to Lavoro</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="font-medium"
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleSave}
              disabled={isSaving}
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold gap-1.5 shadow-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Salvataggio...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Salva Modifiche</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
