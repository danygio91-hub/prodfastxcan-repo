'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Table as TableIcon,
  ChevronsUpDown,
} from 'lucide-react';
import { parseRobustDate } from '@/lib/utils';
import { saveManualMultiJobOrders } from '@/app/admin/programmazione/actions';
import type { JobOrder, Department, Article } from '@/types';

export interface ManualMultiRow {
  id: string;
  department: string;
  ordinePF: string;
  cliente: string;
  articleCode: string;
  qta: number | string;
  dataConsegnaFinale: string;
}

interface ManualMultiAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: Article[];
  departments: Department[];
  onJobsCreated?: (newJobs: JobOrder[]) => void;
  defaultDepartment?: string;
}

const createInitialRow = (dept: string = 'CP'): ManualMultiRow => ({
  id: Math.random().toString(36).substring(2, 9),
  department: dept,
  ordinePF: '',
  cliente: '',
  articleCode: '',
  qta: 100,
  dataConsegnaFinale: '',
});

export function ManualMultiAddModal({
  isOpen,
  onClose,
  articles = [],
  departments = [],
  onJobsCreated,
  defaultDepartment = 'CP',
}: ManualMultiAddModalProps) {
  const { toast } = useToast();

  const initialDept = defaultDepartment !== 'ALL' ? defaultDepartment : (departments[0]?.code || 'CP');
  const [rows, setRows] = useState<ManualMultiRow[]>([
    createInitialRow(initialDept),
    createInitialRow(initialDept),
    createInitialRow(initialDept),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeArticlePopoverRowId, setActiveArticlePopoverRowId] = useState<string | null>(null);

  // Mappa di ricerca rapida per codice articolo
  const articlesMap = useMemo(() => {
    const map = new Map<string, Article>();
    articles.forEach((a) => {
      const code = String(a.code || a.id).toUpperCase().trim();
      if (code) map.set(code, a);
    });
    return map;
  }, [articles]);

  // Lista codici reparti validi
  const validDepartments = useMemo(() => {
    if (departments && departments.length > 0) {
      return departments.map((d) => d.code);
    }
    return ['CP', 'CG', 'BF', 'MAG'];
  }, [departments]);

  // Validazione Live per ogni singola riga
  const validationResults = useMemo(() => {
    const seenPFs = new Map<string, number>();

    // Conta duplicati di Ordine PF
    rows.forEach((r) => {
      const pf = r.ordinePF.trim().toUpperCase();
      if (pf) {
        seenPFs.set(pf, (seenPFs.get(pf) || 0) + 1);
      }
    });

    return rows.map((r, index) => {
      const isCompletelyEmpty =
        !r.ordinePF.trim() &&
        !r.cliente.trim() &&
        !r.articleCode.trim() &&
        !r.dataConsegnaFinale.trim() &&
        (!r.qta || Number(r.qta) === 0);

      const errors: string[] = [];
      const warnings: string[] = [];

      const pf = r.ordinePF.trim();
      if (!pf) {
        errors.push('Ordine PF obbligatorio');
      } else if ((seenPFs.get(pf.toUpperCase()) || 0) > 1) {
        errors.push('Ordine PF duplicato nella tabella');
      }

      if (!r.cliente.trim()) {
        errors.push('Cliente obbligatorio');
      }

      const qtaNum = Number(r.qta);
      if (isNaN(qtaNum) || qtaNum <= 0) {
        errors.push('Quantità maggiore di 0 obbligatoria');
      }

      const dateStr = r.dataConsegnaFinale.trim();
      if (!dateStr) {
        errors.push('Data Consegna obbligatoria');
      } else {
        const parsedD = parseRobustDate(dateStr);
        if (!parsedD || isNaN(parsedD.getTime())) {
          errors.push('Data non valida (richiesto GG/MM/AAAA o AAAA-MM-GG)');
        }
      }

      // === REGOLE DI VALIDAZIONE ARTICOLO (FASE 26) ===
      const artCode = r.articleCode.trim().toUpperCase();
      if (!artCode) {
        errors.push('Codice Articolo obbligatorio');
      } else {
        const art = articlesMap.get(artCode);
        if (!art) {
          // Bloccante: Articolo inesistente in anagrafica
          errors.push(`Articolo "${artCode}" non trovato in Anagrafica`);
        } else {
          // Bloccante: Distinta Base (BOM) assente o vuota
          if (!art.billOfMaterials || art.billOfMaterials.length === 0) {
            errors.push(`Articolo "${artCode}" privo di Distinta Base (BOM) configurata`);
          }

          // Tollerato (Warning): Ciclo o tempi assenti
          if (!art.workCycleId) {
            warnings.push('Nessun Ciclo di Lavorazione associato (Tollerato)');
          } else if (!art.expectedMinutesDefault || art.expectedMinutesDefault <= 0) {
            warnings.push('Tempi previsti standard assenti (Tollerato)');
          }
        }
      }

      const isValid = !isCompletelyEmpty && errors.length === 0;

      return {
        rowIndex: index,
        rowId: r.id,
        isCompletelyEmpty,
        isValid,
        errors,
        warnings,
      };
    });
  }, [rows, articlesMap]);

  // Conteggi e stato globale di validità
  const { totalRows, validRows, invalidRows, allValidToSubmit } = useMemo(() => {
    const activeResults = validationResults.filter((v) => !v.isCompletelyEmpty);
    const valid = activeResults.filter((v) => v.isValid);
    const invalid = activeResults.filter((v) => !v.isValid);
    const allValid = activeResults.length > 0 && invalid.length === 0;

    return {
      totalRows: rows.length,
      validRows: valid,
      invalidRows: invalid,
      allValidToSubmit: allValid,
    };
  }, [validationResults, rows.length]);

  const updateRow = (id: string, field: keyof ManualMultiRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };

        // Se l'utente seleziona un articolo e questo ha un reparto configurato, impostalo automaticamente
        if (field === 'articleCode' && typeof value === 'string') {
          const matchedArt = articlesMap.get(value.toUpperCase().trim());
          if (matchedArt && (matchedArt as any).department && validDepartments.includes((matchedArt as any).department)) {
            updated.department = (matchedArt as any).department;
          }
        }

        return updated;
      })
    );
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createInitialRow(initialDept)]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length === 1) {
      setRows([createInitialRow(initialDept)]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearAll = () => {
    setRows([
      createInitialRow(initialDept),
      createInitialRow(initialDept),
      createInitialRow(initialDept),
    ]);
  };

  const handleSave = async () => {
    if (!allValidToSubmit || isSaving) return;

    // Filtra solo le righe valide
    const validRowIds = new Set(validRows.map((v) => v.rowId));
    const itemsToSave = rows
      .filter((r) => validRowIds.has(r.id))
      .map((r) => ({
        department: r.department,
        ordinePF: r.ordinePF.trim(),
        cliente: r.cliente.trim(),
        articleCode: r.articleCode.trim().toUpperCase(),
        qta: Number(r.qta),
        dataConsegnaFinale: r.dataConsegnaFinale.trim(),
      }));

    if (itemsToSave.length === 0) return;

    setIsSaving(true);
    try {
      const res = await saveManualMultiJobOrders(itemsToSave);
      if (res.success) {
        toast({
          title: 'Commesse Inserite con Successo',
          description: res.message,
        });

        if (onJobsCreated && res.jobs) {
          onJobsCreated(res.jobs);
        }

        handleClearAll();
        onClose();
      } else {
        toast({
          variant: 'destructive',
          title: 'Errore Inserimento Commesse',
          description: res.message || 'Impossibile completare il salvataggio.',
        });
      }
    } catch (e: any) {
      console.error('Errore saveManualMultiJobOrders:', e);
      toast({
        variant: 'destructive',
        title: 'Errore Server',
        description: e?.message || 'Si è verificato un errore imprevisto durante il salvataggio.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2.5 text-xl font-bold">
              <TableIcon className="h-6 w-6 text-primary" />
              <span>Inserimento Manuale Multiplo Commesse</span>
            </DialogTitle>
            <div className="flex items-center gap-2 mr-6">
              <Badge variant="outline" className="text-xs font-mono">
                Totale: {totalRows}
              </Badge>
              <Badge variant="outline" className="text-xs font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300">
                Pronte: {validRows.length}
              </Badge>
              {invalidRows.length > 0 && (
                <Badge variant="outline" className="text-xs font-mono bg-destructive/10 text-destructive border-destructive/30">
                  Con Errori: {invalidRows.length}
                </Badge>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Compila la griglia come un foglio di calcolo. La validazione live verificherà l'esistenza in anagrafica e la distinta base (BOM).
          </p>
        </DialogHeader>

        {/* TABELLA FOGLIO DI CALCOLO DINAMICA */}
        <div className="flex-1 flex flex-col border rounded-lg overflow-hidden mt-2 bg-card">
          <ScrollArea className="h-[460px] w-full">
            <Table>
              <TableHeader className="bg-muted/80 sticky top-0 z-10 shadow-xs">
                <TableRow className="text-xs uppercase font-semibold">
                  <TableHead className="w-[38px] text-center px-1">#</TableHead>
                  <TableHead className="w-[85px] px-2">Reparto</TableHead>
                  <TableHead className="w-[160px] px-2">Ordine PF *</TableHead>
                  <TableHead className="w-[170px] px-2">Cliente *</TableHead>
                  <TableHead className="w-[240px] px-2">Articolo * (BOM Obbligatoria)</TableHead>
                  <TableHead className="w-[95px] text-right px-2">Q.tà *</TableHead>
                  <TableHead className="w-[135px] text-center px-2">Data Cons. *</TableHead>
                  <TableHead className="w-[160px] text-center px-2">Validazione</TableHead>
                  <TableHead className="w-[45px] text-center px-1">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const val = validationResults[index];
                  const hasErrors = val && val.errors.length > 0;
                  const hasWarnings = val && val.warnings.length > 0;
                  const isValid = val && val.isValid;

                  return (
                    <TableRow
                      key={row.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        hasErrors
                          ? 'bg-destructive/5 dark:bg-destructive/10'
                          : isValid
                          ? 'bg-emerald-500/5 dark:bg-emerald-500/10'
                          : ''
                      }`}
                    >
                      {/* Indice Riga */}
                      <TableCell className="text-center font-mono text-xs text-muted-foreground px-1 py-1.5">
                        {index + 1}
                      </TableCell>

                      {/* Reparto */}
                      <TableCell className="px-1.5 py-1">
                        <Select
                          value={row.department}
                          onValueChange={(val) => updateRow(row.id, 'department', val)}
                        >
                          <SelectTrigger className="h-7 text-xs font-bold font-mono px-2 py-0 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {validDepartments.map((dept) => (
                              <SelectItem key={dept} value={dept} className="text-xs font-bold">
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Ordine PF */}
                      <TableCell className="px-1.5 py-1">
                        <Input
                          value={row.ordinePF}
                          onChange={(e) => updateRow(row.id, 'ordinePF', e.target.value)}
                          placeholder="es. 123/PF.1-1"
                          className="h-7 text-xs font-mono font-bold px-2 py-0"
                        />
                      </TableCell>

                      {/* Cliente */}
                      <TableCell className="px-1.5 py-1">
                        <Input
                          value={row.cliente}
                          onChange={(e) => updateRow(row.id, 'cliente', e.target.value)}
                          placeholder="es. CLIENTE ROSSI"
                          className="h-7 text-xs px-2 py-0"
                        />
                      </TableCell>

                      {/* Articolo con Popover / Autocomplete */}
                      <TableCell className="px-1.5 py-1">
                        <Popover
                          open={activeArticlePopoverRowId === row.id}
                          onOpenChange={(open) => setActiveArticlePopoverRowId(open ? row.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <div className="relative flex items-center w-full">
                              <Input
                                value={row.articleCode}
                                onChange={(e) => updateRow(row.id, 'articleCode', e.target.value.toUpperCase())}
                                placeholder="Seleziona o digita..."
                                className="h-7 text-xs font-mono font-bold px-2 pr-7 uppercase py-0"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setActiveArticlePopoverRowId(row.id)}
                              >
                                <ChevronsUpDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </PopoverTrigger>
                          <PopoverContent className="w-[320px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Cerca codice o descrizione..." className="h-8 text-xs" />
                              <CommandList className="max-h-[220px]">
                                <CommandEmpty>Nessun articolo trovato.</CommandEmpty>
                                <CommandGroup heading="Anagrafica Articoli">
                                  {articles.slice(0, 30).map((art) => {
                                    const code = art.code || art.id;
                                    const hasBOM = art.billOfMaterials && art.billOfMaterials.length > 0;
                                    return (
                                      <CommandItem
                                        key={art.id}
                                        value={code}
                                        onSelect={() => {
                                          updateRow(row.id, 'articleCode', code);
                                          setActiveArticlePopoverRowId(null);
                                        }}
                                        className="cursor-pointer text-xs flex items-center justify-between py-1.5"
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-mono font-bold">{code}</span>
                                          {art.description && (
                                            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                              {art.description}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          {hasBOM ? (
                                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-600 border-emerald-300">
                                              BOM OK
                                            </Badge>
                                          ) : (
                                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-destructive border-destructive/30">
                                              No BOM
                                            </Badge>
                                          )}
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </TableCell>

                      {/* Quantità */}
                      <TableCell className="px-1.5 py-1 text-right">
                        <Input
                          type="number"
                          min={1}
                          value={row.qta}
                          onChange={(e) => updateRow(row.id, 'qta', e.target.value)}
                          placeholder="100"
                          className="h-7 text-xs font-mono font-bold text-right px-2 py-0"
                        />
                      </TableCell>

                      {/* Data Consegna */}
                      <TableCell className="px-1.5 py-1 text-center">
                        <Input
                          value={row.dataConsegnaFinale}
                          onChange={(e) => updateRow(row.id, 'dataConsegnaFinale', e.target.value)}
                          placeholder="GG/MM/AAAA"
                          className="h-7 text-xs font-mono text-center px-1 py-0"
                        />
                      </TableCell>

                      {/* Stato Validazione Live */}
                      <TableCell className="px-1.5 py-1 text-center">
                        <TooltipProvider>
                          {val?.isCompletelyEmpty ? (
                            <span className="text-[10px] text-muted-foreground/60 italic">Riga vuota</span>
                          ) : hasErrors ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-flex items-center gap-1 cursor-help">
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 px-1.5 bg-destructive/10 text-destructive border-destructive/30 max-w-[150px] truncate"
                                  >
                                    <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                                    <span className="truncate">{val.errors[0]}</span>
                                  </Badge>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="bg-destructive text-destructive-foreground text-xs max-w-xs">
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {val.errors.map((err, i) => (
                                    <li key={i}>{err}</li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          ) : hasWarnings ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-flex items-center gap-1 cursor-help">
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 px-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1 shrink-0" />
                                    <span>Pronta (Warning)</span>
                                  </Badge>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-xs">
                                <p className="font-semibold mb-1">Avvisi non bloccanti:</p>
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {val.warnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          ) : isValid ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 px-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Pronta
                            </Badge>
                          ) : null}
                        </TooltipProvider>
                      </TableCell>

                      {/* Azione Rimuovi Riga */}
                      <TableCell className="px-1 py-1 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveRow(row.id)}
                          title="Rimuovi riga"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* BARRA INSERIMENTO NUOVA RIGA */}
          <div className="flex items-center justify-between p-2.5 bg-muted/40 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
              className="h-7 text-xs gap-1 border-dashed text-primary hover:bg-primary/5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Aggiungi Riga</span>
            </Button>

            <span className="text-xs text-muted-foreground">
              Premi <strong>Aggiungi Riga</strong> per inserire ulteriori ordini contemporaneamente.
            </span>
          </div>
        </div>

        {/* FOOTER AZIONI */}
        <DialogFooter className="mt-4 pt-3 border-t flex items-center justify-between sm:justify-between w-full">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={isSaving}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Svuota tutto
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
            >
              Annulla
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !allValidToSubmit || validRows.length === 0}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 shadow-sm"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Salvataggio {validRows.length} commesse...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Conferma e Inserisci ({validRows.length})</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
