'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  FileSpreadsheet,
  Upload,
  FileDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { processAndValidateImport, commitImportedJobOrders } from '@/app/admin/data-management/actions';
import type { JobOrder, Department } from '@/types';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobsCreated?: (newJobs: JobOrder[]) => void;
  departments?: Department[];
}

export function ExcelImportModal({
  isOpen,
  onClose,
  onJobsCreated,
  departments,
}: ExcelImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'valid' | 'blocked'>('valid');
  const [importReport, setImportReport] = useState<{
    newJobs: JobOrder[];
    jobsToUpdate: JobOrder[];
    blockedJobs: Array<{ row: any; reason: string }>;
  } | null>(null);

  const resetState = () => {
    setImportReport(null);
    setIsAnalyzing(false);
    setIsSaving(false);
    setActiveTab('valid');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (isSaving || isAnalyzing) return;
    resetState();
    onClose();
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Ordine PF': '123/PF.1-1',
        'Codice': 'CODICE_ARTICOLO',
        'Qta': 100,
        'Cliente': 'CLIENTE_ROSSI',
        'Ordine Nr Est': 'EST-001',
        'N° ODL': '0001-26',
        'Data Fine Prep': '2026-11-20',
        'Data Consegna': '2026-11-30',
        'Reparto': 'CP',
        'Ciclo': 'STANDARD',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Commesse');
    XLSX.writeFile(wb, 'Template_Import_Commesse.xlsx');
    toast({
      title: 'Template Scaricato',
      description: 'Compila questo file e ricaricalo nel modale.',
    });
  };

  const processFile = async (file: File) => {
    setIsAnalyzing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Il file Excel non contiene fogli di lavoro.');
      }

      const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { raw: true });
      if (!json || json.length === 0) {
        throw new Error('Il foglio di lavoro selezionato è vuoto.');
      }

      const result = await processAndValidateImport(json);
      if (result.success) {
        setImportReport(result);
        if (result.newJobs.length === 0 && result.blockedJobs.length > 0) {
          setActiveTab('blocked');
        } else {
          setActiveTab('valid');
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Analisi Fallita',
          description: result.message,
        });
      }
    } catch (e: any) {
      console.error('Errore import Excel:', e);
      toast({
        variant: 'destructive',
        title: 'Errore Lettura File',
        description: e instanceof Error ? e.message : 'Impossibile leggere o analizzare il file Excel.',
      });
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isAnalyzing || isSaving) return;
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      processFile(file);
    } else {
      toast({
        variant: 'destructive',
        title: 'Formato non supportato',
        description: 'Seleziona un file valido di tipo .xlsx o .xls.',
      });
    }
  };

  const handleCommit = async () => {
    if (!importReport || importReport.newJobs.length === 0) return;
    setIsSaving(true);
    try {
      const res = await commitImportedJobOrders({
        newJobs: importReport.newJobs,
        jobsToUpdate: [],
      });

      if (res.success) {
        toast({
          title: 'Commesse Caricate con Successo',
          description: res.message,
        });
        if (onJobsCreated && res.jobs) {
          onJobsCreated(res.jobs);
        }
        handleClose();
      } else {
        toast({
          variant: 'destructive',
          title: 'Errore di Salvataggio',
          description: res.message || 'Impossibile completare il caricamento delle commesse.',
        });
      }
    } catch (e: any) {
      console.error('Errore commit commesse:', e);
      toast({
        variant: 'destructive',
        title: 'Errore Server',
        description: e?.message || 'Si è verificato un errore durante il salvataggio su database.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-xl font-bold">
            <FileSpreadsheet className="h-6 w-6 text-green-600 dark:text-green-400" />
            <span>Importazione Commesse da File Excel</span>
          </DialogTitle>
        </DialogHeader>

        {/* Input file nascosto */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept=".xlsx, .xls"
          className="hidden"
        />

        {/* STEP 1: UPLOAD / SELEZIONE FILE */}
        {!importReport && (
          <div className="flex-1 flex flex-col gap-5 py-4 min-h-[380px] justify-center">
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center p-12 space-y-4 rounded-xl border border-dashed border-primary/40 bg-muted/20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-semibold text-base">Analisi e validazione file in corso...</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Verifica anagrafica articoli, distinte base (BOM), cicli di lavoro e date consegna...
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center p-10 border-2 border-dashed border-border rounded-xl bg-card hover:bg-muted/40 transition-colors cursor-pointer text-center group"
                >
                  <div className="p-4 rounded-full bg-green-500/10 group-hover:bg-green-500/20 text-green-600 transition-colors mb-3">
                    <Upload className="h-8 w-8" />
                  </div>
                  <h3 className="font-semibold text-base mb-1">
                    Trascina qui il tuo file Excel o clicca per sfogliare
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm mb-4">
                    Supporta formati <strong>.xlsx</strong> e <strong>.xls</strong>. Il sistema verificherà
                    automaticamente anagrafica, cicli e distinte base.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="h-3.5 w-3.5 mr-2" />
                    Seleziona File dal Computer
                  </Button>
                </div>

                <div className="bg-muted/40 rounded-lg p-4 border text-xs text-muted-foreground space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-blue-500" />
                      Colonne Riconosciute nel File Excel:
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDownloadTemplate}
                      className="h-7 text-xs text-primary hover:text-primary/80 gap-1"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      Scarica Template Excel (.xlsx)
                    </Button>
                  </div>
                  <p>
                    <code className="text-primary font-semibold">Ordine PF</code> (obbligatorio, univoco) |{' '}
                    <code className="text-primary font-semibold">Codice</code> (articolo in anagrafica) |{' '}
                    <code className="text-primary font-semibold">Qta</code> (&gt; 0) |{' '}
                    <code className="text-primary font-semibold">Cliente</code> (obbligatorio) |{' '}
                    <code className="text-primary font-semibold">Data Consegna</code> (GG/MM/AAAA) |{' '}
                    <code className="text-muted-foreground">Reparto</code> (opzionale) |{' '}
                    <code className="text-muted-foreground">Ciclo</code> (opzionale) |{' '}
                    <code className="text-muted-foreground">N° ODL</code> (opzionale)
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2: RECAP ANALISI E VALIDAZIONE */}
        {importReport && (
          <div className="flex-1 flex flex-col mt-2 overflow-hidden gap-3">
            {/* Riepilogo a badge */}
            <div className="flex items-center justify-between bg-muted/40 p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-medium">Esito Validazione:</span>
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {importReport.newJobs.length} Pronte
                </Badge>
                {importReport.blockedJobs.length > 0 && (
                  <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                    <XCircle className="h-3 w-3 mr-1" />
                    {importReport.blockedJobs.length} Bloccate
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetState();
                  fileInputRef.current?.click();
                }}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                Carica un altro file
              </Button>
            </div>

            {/* Alert se ci sono righe bloccate */}
            {importReport.blockedJobs.length > 0 && (
              <div className="flex items-start gap-2 bg-destructive/10 text-destructive border border-destructive/20 p-2.5 rounded-md text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Attenzione:</strong> {importReport.blockedJobs.length} righe contengono errori o dati non conformi
                  e sono state <strong>bloccate</strong>. Solo le righe valide verranno importate nel database.
                </div>
              </div>
            )}

            {/* Tabs Pronte / Bloccate */}
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as 'valid' | 'blocked')}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger
                  value="valid"
                  className="data-[state=active]:text-emerald-700 dark:data-[state=active]:text-emerald-400 font-bold"
                >
                  PRONTE ({importReport.newJobs.length})
                </TabsTrigger>
                <TabsTrigger
                  value="blocked"
                  className="data-[state=active]:text-destructive font-bold"
                >
                  BLOCCATE ({importReport.blockedJobs.length})
                </TabsTrigger>
              </TabsList>

              {/* Tab PRONTE */}
              <TabsContent value="valid" className="flex-1 border rounded-md mt-2 overflow-hidden bg-card">
                <ScrollArea className="h-[320px]">
                  {importReport.newJobs.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Nessuna commessa valida trovata nel file Excel.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0">
                        <TableRow>
                          <TableHead className="w-[140px]">Ordine PF</TableHead>
                          <TableHead>Articolo</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right w-[80px]">Q.tà</TableHead>
                          <TableHead className="w-[120px]">Data Cons.</TableHead>
                          <TableHead className="w-[90px]">Sett. ISO</TableHead>
                          <TableHead className="w-[80px]">Reparto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importReport.newJobs.map((j, i) => (
                          <TableRow key={i} className="hover:bg-muted/30">
                            <TableCell className="font-mono font-medium text-xs">{j.ordinePF}</TableCell>
                            <TableCell className="font-semibold text-xs text-foreground">{j.details}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{j.cliente || 'N/D'}</TableCell>
                            <TableCell className="text-right font-mono font-semibold text-xs">{j.qta}</TableCell>
                            <TableCell className="text-xs">{j.dataConsegnaFinale || '-'}</TableCell>
                            <TableCell className="text-xs font-mono">
                              {j.targetWeek || (j.isoWeek ? `W${j.isoWeek}` : '-')}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                                {j.department || 'N/D'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Tab BLOCCATE */}
              <TabsContent value="blocked" className="flex-1 border rounded-md mt-2 overflow-hidden bg-card">
                <ScrollArea className="h-[320px]">
                  {importReport.blockedJobs.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Nessun errore riscontrato nel file Excel. Tutte le righe sono valide!
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0">
                        <TableRow>
                          <TableHead className="w-[160px]">Riga / Ordine PF</TableHead>
                          <TableHead className="w-[130px]">Articolo</TableHead>
                          <TableHead>Motivo Blocco</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importReport.blockedJobs.map((b, i) => {
                          const row = b.row || {};
                          const pf = row['Ordine PF'] || row['ordinePF'] || row['PF'] || 'N/D';
                          const art = row['Codice'] || row['details'] || row['Articolo'] || '-';
                          return (
                            <TableRow key={i} className="bg-destructive/5 hover:bg-destructive/10">
                              <TableCell className="font-mono text-xs font-semibold text-foreground">
                                {pf}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {art}
                              </TableCell>
                              <TableCell className="text-destructive font-medium text-xs">
                                {b.reason}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="mt-4 pt-3 border-t flex items-center justify-between sm:justify-between w-full">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              className="text-xs gap-1"
            >
              <FileDown className="h-3.5 w-3.5" />
              Template Excel
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isSaving}
            >
              Annulla tutto
            </Button>
            {importReport && (
              <Button
                type="button"
                size="sm"
                onClick={handleCommit}
                disabled={isSaving || importReport.newJobs.length === 0}
                className="bg-green-600 hover:bg-green-700 text-white font-semibold text-xs gap-1.5 shadow-sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Salvataggio...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Carica Commesse Valide ({importReport.newJobs.length})</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
