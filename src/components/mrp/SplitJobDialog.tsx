'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Split, Loader2, CheckCircle2, AlertCircle, ArrowRight, Clock, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Article, JobOrder } from '@/types';
import { splitJobOrder } from '@/app/admin/programmazione/actions';
import { computeNextChildOrdinePF, extractBaseOrdinePF } from '@/lib/job-split-logic';
import { calculateJobHours } from '@/lib/time-reliability';

interface SplitJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  job: JobOrder | null;
  article?: Article;
  existingOrdiniPF?: string[];
  onSplitSuccess: (updatedOriginalJob: JobOrder, childJob: JobOrder) => void;
}

export function SplitJobDialog({
  isOpen,
  onClose,
  job,
  article,
  existingOrdiniPF = [],
  onSplitSuccess,
}: SplitJobDialogProps) {
  const { toast } = useToast();
  const [originalQtyInput, setOriginalQtyInput] = useState<string>('');
  const [childQtyInput, setChildQtyInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const totalQty = useMemo(() => {
    if (!job) return 0;
    return Number(job.qta ?? job.qtaRichiesta ?? 0);
  }, [job]);

  const totalHours = useMemo(() => {
    if (!job) return 0;
    if (typeof job.orePreviste === 'number' && !isNaN(job.orePreviste) && job.orePreviste > 0) {
      return job.orePreviste;
    }
    return calculateJobHours(job, article);
  }, [job, article]);

  const previewChildOrdinePF = useMemo(() => {
    if (!job) return '';
    return computeNextChildOrdinePF(job.ordinePF || job.id, existingOrdiniPF).childOrdinePF;
  }, [job, existingOrdiniPF]);

  useEffect(() => {
    if (job && isOpen) {
      const currentTotal = Number(job.qta ?? job.qtaRichiesta ?? 0);
      if (currentTotal > 1) {
        const defaultOrig = Math.ceil(currentTotal / 2);
        const defaultChild = currentTotal - defaultOrig;
        setOriginalQtyInput(String(defaultOrig));
        setChildQtyInput(String(defaultChild));
      } else {
        setOriginalQtyInput(String(currentTotal));
        setChildQtyInput('0');
      }
      setIsSubmitting(false);
    }
  }, [job, isOpen]);

  const handleOriginalQtyChange = (rawVal: string) => {
    setOriginalQtyInput(rawVal);
    const cleaned = rawVal.trim();
    if (cleaned === '') {
      setChildQtyInput('');
      return;
    }
    const parsed = Number(cleaned);
    if (!isNaN(parsed)) {
      const remainder = Math.max(0, Number((totalQty - parsed).toFixed(3)));
      setChildQtyInput(String(remainder));
    }
  };

  const handleChildQtyChange = (rawVal: string) => {
    setChildQtyInput(rawVal);
    const cleaned = rawVal.trim();
    if (cleaned === '') {
      setOriginalQtyInput('');
      return;
    }
    const parsed = Number(cleaned);
    if (!isNaN(parsed)) {
      const remainder = Math.max(0, Number((totalQty - parsed).toFixed(3)));
      setOriginalQtyInput(String(remainder));
    }
  };

  const parsedOriginal = Number(originalQtyInput);
  const parsedChild = Number(childQtyInput);

  const validationError = useMemo(() => {
    if (!job) return null;
    if (totalQty <= 1) {
      return `La commessa ha quantità ${totalQty} e non può essere suddivisa.`;
    }
    if (originalQtyInput.trim() === '' || childQtyInput.trim() === '') {
      return 'Inserisci entrambe le quantità per procedere.';
    }
    if (isNaN(parsedOriginal) || isNaN(parsedChild)) {
      return 'Inserisci valori numerici validi.';
    }
    if (parsedOriginal <= 0 || parsedChild <= 0) {
      return 'Entrambe le quantità devono essere maggiori di zero.';
    }
    const sum = Number((parsedOriginal + parsedChild).toFixed(3));
    if (Math.abs(sum - totalQty) > 0.0001) {
      return `La somma (${parsedOriginal} + ${parsedChild} = ${sum}) deve essere uguale alla quantità attuale (${totalQty}).`;
    }
    return null;
  }, [job, totalQty, originalQtyInput, childQtyInput, parsedOriginal, parsedChild]);

  const isValid = validationError === null;

  const splitCoeff = totalQty > 0 && !isNaN(parsedOriginal) ? Math.min(1, Math.max(0, parsedOriginal / totalQty)) : 0;
  const origHoursPreview = Number((totalHours * splitCoeff).toFixed(2));
  const childHoursPreview = Number(Math.max(0, totalHours - origHoursPreview).toFixed(2));

  const handleConfirmSplit = () => {
    if (!job || !isValid || isSubmitting) return;
    setIsSubmitting(true);

    splitJobOrder(job.id, parsedOriginal, parsedChild)
      .then((res) => {
        if (res.success && res.updatedOriginalJob && res.childJob) {
          toast({
            title: 'Split Commessa Completato',
            description: res.message,
          });
          onSplitSuccess(res.updatedOriginalJob, res.childJob);
          onClose();
        } else {
          toast({
            variant: 'destructive',
            title: 'Errore Split Commessa',
            description: res.error || res.message || 'Impossibile completare lo split della commessa.',
          });
        }
      })
      .catch((err: any) => {
        toast({
          variant: 'destructive',
          title: 'Errore Imprevisto',
          description: err?.message || 'Si è verificato un errore durante lo split della commessa.',
        });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  if (!job) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && !open && onClose()}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-white shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-amber-500/20 rounded-lg border border-amber-500/30">
              <Split className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Split Commessa (Produzione Parziale)
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Suddividi la quantità richiesta creando una commessa figlia con ricalcolo proporzionale delle ore previste.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Riepilogo Commessa Attuale */}
          <div className="p-3 rounded-lg bg-slate-800/70 border border-slate-700/70 flex items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Commessa Attuale
                </span>
                <Badge variant="outline" className="border-blue-500/40 text-blue-400 font-mono text-[10px] px-1.5 py-0">
                  {job.department || 'N/D'}
                </Badge>
              </div>
              <div className="flex items-center gap-2 font-mono font-bold text-base text-white">
                <span>{job.ordinePF || job.id}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-amber-400">{previewChildOrdinePF}</span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Articolo: <strong className="text-slate-200 font-mono">{job.details || 'N/D'}</strong> • {job.cliente || 'Cliente N/D'}
              </p>
            </div>

            <div className="text-right shrink-0 bg-slate-900/80 px-3 py-2 rounded-md border border-slate-700/80">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Quantità Attuale
              </div>
              <div className="text-lg font-mono font-extrabold text-emerald-400">
                {totalQty.toLocaleString('it-IT')} <span className="text-xs font-normal text-slate-400">pz</span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 flex items-center justify-end gap-1">
                <Clock className="h-3 w-3 text-slate-500" />
                <span>{totalHours.toFixed(2)} h tot.</span>
              </div>
            </div>
          </div>

          {/* Input Reattivi di Split */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 1. Quantità Commessa Originale */}
            <div className="p-3 rounded-lg bg-slate-800/40 border border-blue-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="split-orig-qty" className="text-xs font-bold text-blue-400">
                  Quantità Commessa Originale
                </Label>
                <span className="text-[10px] font-mono text-slate-400">{job.ordinePF}</span>
              </div>

              <Input
                id="split-orig-qty"
                type="number"
                min={1}
                max={Math.max(1, totalQty - 1)}
                step="any"
                value={originalQtyInput}
                onChange={(e) => handleOriginalQtyChange(e.target.value)}
                disabled={isSubmitting}
                className="bg-slate-900 border-slate-700 focus:border-blue-500 h-10 font-mono font-bold text-base text-white"
                placeholder="Es. 700"
                autoFocus
              />

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                <span>Quota: {Math.round(splitCoeff * 100)}%</span>
                <span className="text-blue-300 font-semibold">{origHoursPreview.toFixed(2)} h prev.</span>
              </div>
            </div>

            {/* 2. Quantità Nuova Commessa (Resto) */}
            <div className="p-3 rounded-lg bg-slate-800/40 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="split-child-qty" className="text-xs font-bold text-amber-400">
                  Quantità Nuova Commessa (Resto)
                </Label>
                <span className="text-[10px] font-mono text-amber-300 font-semibold">{previewChildOrdinePF}</span>
              </div>

              <Input
                id="split-child-qty"
                type="number"
                min={1}
                max={Math.max(1, totalQty - 1)}
                step="any"
                value={childQtyInput}
                onChange={(e) => handleChildQtyChange(e.target.value)}
                disabled={isSubmitting}
                className="bg-slate-900 border-slate-700 focus:border-amber-500 h-10 font-mono font-bold text-base text-amber-300"
                placeholder="Es. 300"
              />

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                <span>Quota: {Math.round((1 - splitCoeff) * 100)}%</span>
                <span className="text-amber-300 font-semibold">{childHoursPreview.toFixed(2)} h prev.</span>
              </div>
            </div>
          </div>

          {/* Nota informativa / Validazione */}
          {validationError ? (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{validationError}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
              <Package className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <div>
                La commessa originale <strong>{job.ordinePF}</strong> passerà a{' '}
                <strong>{parsedOriginal.toLocaleString('it-IT')} pz</strong> ({origHoursPreview.toFixed(2)} h) e verrà
                creata <strong>{previewChildOrdinePF}</strong> da{' '}
                <strong>{parsedChild.toLocaleString('it-IT')} pz</strong> ({childHoursPreview.toFixed(2)} h) in stato{' '}
                <strong>Pianificata</strong> (ereditando eventuali fasi già completate).
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white hover:bg-slate-800"
          >
            Annulla
          </Button>
          <Button
            type="button"
            onClick={handleConfirmSplit}
            disabled={!isValid || isSubmitting}
            className="bg-amber-600 hover:bg-amber-500 text-white font-bold gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Split in corso...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Conferma Split</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

