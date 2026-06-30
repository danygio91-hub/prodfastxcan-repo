"use client";

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Trash2, Loader2, ClipboardType } from 'lucide-react';
import { Article, Department } from '@/types';
import { parse, isValid, format } from 'date-fns';
import { MaskedDatePicker } from '@/components/ui/masked-date-picker';
import { useToast } from '@/hooks/use-toast';
import { saveSmartPastedJobOrders } from '@/app/admin/data-management/actions';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SmartPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: Article[];
  departments: Department[];
}

export interface ParsedRow {
  id: string;
  articleCode: string;
  quantity: number;
  deliveryDateRaw: string;
  deliveryDateParsed: string | null; // yyyy-MM-dd or null if invalid
  ordinePF: string;
  department: string;
  prepDateParsed: string | null;
}

export function SmartPasteModal({ isOpen, onClose, articles, departments }: SmartPasteModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const productionDepartments = useMemo(() => 
    departments.filter(d => d.macroAreas?.includes('PRODUZIONE') || d.code === 'MAG'),
  [departments]);

  const defaultDept = productionDepartments.length > 0 ? (productionDepartments.find(d => d.code === 'CP') || productionDepartments[0]).code : '';

  const parseEuropeanDate = (dateStr: string): string | null => {
    if (!dateStr || dateStr.trim() === '') return null;
    const cleanStr = dateStr.trim();
    
    // Try DD/MM/YYYY
    let parsedDate = parse(cleanStr, 'dd/MM/yyyy', new Date());
    if (isValid(parsedDate)) return format(parsedDate, 'yyyy-MM-dd');
    
    // Try DD-MM-YYYY
    parsedDate = parse(cleanStr, 'dd-MM-yyyy', new Date());
    if (isValid(parsedDate)) return format(parsedDate, 'yyyy-MM-dd');

    // Try YYYY-MM-DD (Fallback)
    parsedDate = parse(cleanStr, 'yyyy-MM-dd', new Date());
    if (isValid(parsedDate)) return format(parsedDate, 'yyyy-MM-dd');

    return null; // Invalid
  };

  const handleProcess = () => {
    if (!pasteText.trim()) return;

    const lines = pasteText.split('\n').filter(line => line.trim() !== '');
    const newRows: ParsedRow[] = [];

    lines.forEach((line, index) => {
        // Tab separated
        const columns = line.split('\t').map(c => c.trim());
        
        // Expected: Codice Articolo | Quantità | Data Consegna Finale
        const articleCode = (columns[0] || '').replace(/[\r\n\t]/g, '').trim().toUpperCase();
        const qtaRaw = columns[1] || '0';
        const dateRaw = columns[2] || '';

        const quantity = parseFloat(qtaRaw.replace(',', '.'));
        const isQtaValid = !isNaN(quantity) && quantity > 0;

        newRows.push({
            id: `row-${Date.now()}-${index}`,
            articleCode: articleCode,
            quantity: isQtaValid ? quantity : 0,
            deliveryDateRaw: dateRaw,
            deliveryDateParsed: parseEuropeanDate(dateRaw),
            ordinePF: '',
            department: defaultDept,
            prepDateParsed: null,
        });
    });

    setRows(newRows);
    setStep(2);
  };

  const updateRow = (id: string, field: keyof ParsedRow, value: any) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const deleteRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const resetModal = () => {
    setStep(1);
    setPasteText('');
    setRows([]);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  // Validation Check
  const validationState = useMemo(() => {
    const articleMap = new Set(articles.map(a => a.code.toUpperCase().trim()));
    let allValid = true;
    let invalidCount = 0;

    const validatedRows = rows.map(r => {
        const articleExists = articleMap.has(r.articleCode.toUpperCase().trim());
        const hasDate = r.deliveryDateParsed !== null;
        const hasQta = r.quantity > 0;
        const hasPF = r.ordinePF.trim() !== '';

        const isValidRow = articleExists && hasDate && hasQta && hasPF;
        if (!isValidRow) {
            allValid = false;
            invalidCount++;
        }

        return { ...r, articleExists, hasDate, hasQta, hasPF, isValidRow };
    });

    return { validatedRows, allValid: allValid && rows.length > 0, invalidCount };
  }, [rows, articles]);

  const handleSave = async () => {
      if (!validationState.allValid) return;
      setIsSaving(true);
      
      try {
          const payload = validationState.validatedRows.map(r => ({
              ordinePF: r.ordinePF,
              details: r.articleCode,
              qta: r.quantity,
              dataConsegnaFinale: r.deliveryDateParsed!,
              dataFinePreparazione: r.prepDateParsed || r.deliveryDateParsed!, // Fallback to delivery if no prep
              department: r.department
          }));

          const res = await saveSmartPastedJobOrders(payload);
          if (res.success) {
              toast({ title: "Commesse Create", description: res.message });
              handleClose();
          } else {
              toast({ variant: "destructive", title: "Errore di Salvataggio", description: res.message });
          }
      } catch (error) {
          toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare le commesse." });
      } finally {
          setIsSaving(false);
      }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && handleClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ClipboardType className="h-6 w-6 text-primary" />
            Smart Paste Commesse
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
            <div className="flex-1 flex flex-col gap-4 py-4 min-h-[400px]">
                <div className="bg-muted/50 p-4 rounded-md border text-sm text-muted-foreground">
                    Copia le righe da Excel e incollale nel box sottostante.<br/>
                    <strong>Formato colonne atteso (separato da Tab):</strong> <br/>
                    <code className="text-primary font-bold">Codice Articolo | Quantità | Data Consegna Finale (GG/MM/AAAA)</code>
                </div>
                <Textarea 
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Incolla qui le righe di Excel..."
                    className="flex-1 font-mono text-sm min-h-[300px] resize-none"
                />
            </div>
        )}

        {step === 2 && (
            <div className="flex-1 flex flex-col gap-4 py-4 overflow-hidden">
                <div className="flex justify-between items-center bg-muted/30 p-3 rounded-md border">
                    <span className="text-sm font-medium">
                        Totale righe: {rows.length} 
                        {validationState.invalidCount > 0 && (
                            <span className="text-destructive ml-2 font-bold">
                                ({validationState.invalidCount} righe da correggere)
                            </span>
                        )}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setStep(1)} disabled={isSaving}>
                        Indietro
                    </Button>
                </div>
                
                <div className="flex-1 border rounded-md overflow-hidden">
                    <ScrollArea className="h-[500px]">
                        <Table>
                            <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                                <TableRow>
                                    <TableHead className="w-[50px]"></TableHead>
                                    <TableHead className="w-[150px]">Ordine PF <span className="text-destructive">*</span></TableHead>
                                    <TableHead className="w-[200px]">Articolo</TableHead>
                                    <TableHead className="w-[100px]">Quantità</TableHead>
                                    <TableHead className="w-[150px]">Reparto <span className="text-destructive">*</span></TableHead>
                                    <TableHead className="w-[160px]">Fine Prep.</TableHead>
                                    <TableHead className="w-[160px]">Consegna Finale <span className="text-destructive">*</span></TableHead>
                                    <TableHead className="w-[50px] text-right">Azioni</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {validationState.validatedRows.map((row, i) => (
                                    <TableRow key={row.id} className={!row.isValidRow ? 'bg-red-50/50 hover:bg-red-50/80 border-l-4 border-l-red-500' : ''}>
                                        <TableCell className="text-center">
                                            {row.isValidRow ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" /> : <AlertCircle className="h-4 w-4 text-red-500 mx-auto" />}
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                value={row.ordinePF} 
                                                onChange={(e) => updateRow(row.id, 'ordinePF', e.target.value)}
                                                placeholder="Es. 123/PF..."
                                                className={`h-8 text-xs ${!row.hasPF ? 'border-red-300 bg-red-50 focus-visible:ring-red-500' : ''}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <Input 
                                                    value={row.articleCode} 
                                                    onChange={(e) => updateRow(row.id, 'articleCode', e.target.value.replace(/[\r\n\t]/g, '').trimStart().toUpperCase())}
                                                    placeholder="Codice Articolo"
                                                    className={`h-8 text-xs font-mono font-bold ${!row.articleExists ? 'border-red-300 bg-red-50 text-red-600 focus-visible:ring-red-500' : ''}`}
                                                />
                                                {!row.articleExists && <span className="text-[10px] text-red-500 leading-tight">Articolo inesistente</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className={`font-mono text-sm ${!row.hasQta ? 'text-red-600' : ''}`}>{row.quantity}</span>
                                            {!row.hasQta && <span className="text-[10px] text-red-500 block leading-tight">Qta invalida</span>}
                                        </TableCell>
                                        <TableCell>
                                            <Select value={row.department} onValueChange={(v) => updateRow(row.id, 'department', v)}>
                                                <SelectTrigger className="h-8 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {productionDepartments.map(d => (
                                                        <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <MaskedDatePicker 
                                                value={row.prepDateParsed ? parse(row.prepDateParsed, 'yyyy-MM-dd', new Date()) : null}
                                                onChange={(d) => updateRow(row.id, 'prepDateParsed', d ? format(d, 'yyyy-MM-dd') : null)}
                                                className="h-8 text-xs w-full"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <MaskedDatePicker 
                                                    value={row.deliveryDateParsed ? parse(row.deliveryDateParsed, 'yyyy-MM-dd', new Date()) : null}
                                                    onChange={(d) => updateRow(row.id, 'deliveryDateParsed', d ? format(d, 'yyyy-MM-dd') : null)}
                                                    className={`h-8 text-xs w-full ${!row.hasDate ? 'border-red-300 bg-red-50 focus-within:ring-red-500' : ''}`}
                                                />
                                                {!row.hasDate && <span className="text-[10px] text-red-500 leading-tight">Data errata ({row.deliveryDateRaw})</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600" onClick={() => deleteRow(row.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {rows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Nessuna riga da visualizzare.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>
            </div>
        )}

        <DialogFooter className="mt-2">
            {step === 1 ? (
                <Button onClick={handleProcess} disabled={!pasteText.trim()} className="w-full sm:w-auto">
                    Elabora Dati
                </Button>
            ) : (
                <div className="flex w-full justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                        {!validationState.allValid && rows.length > 0 && "Correggi gli errori evidenziati in rosso per procedere."}
                    </span>
                    <Button 
                        onClick={handleSave} 
                        disabled={!validationState.allValid || isSaving || rows.length === 0}
                        className={`w-full sm:w-auto ${validationState.allValid && rows.length > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                    >
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Conferma e Inserisci in Pianificate
                    </Button>
                </div>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
