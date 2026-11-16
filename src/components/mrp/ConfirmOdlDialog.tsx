'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { Play, Loader2, Hash, Sparkles, Edit3, AlertCircle } from 'lucide-react';
import type { JobOrder } from '@/types';
import { getNextOdlNumber } from '@/app/admin/programmazione/actions';
import { parseStandardOdl } from '@/lib/odl-numerator';

interface ConfirmOdlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  job: JobOrder | null;
  initialProposedOdl?: string;
  onConfirmStart: (
    job: JobOrder,
    chosenOdl: string
  ) => Promise<{ ok: boolean; error?: string } | boolean | void>;
}

export function ConfirmOdlDialog({
  isOpen,
  onClose,
  job,
  initialProposedOdl = '',
  onConfirmStart,
}: ConfirmOdlDialogProps) {
  const [odlInput, setOdlInput] = useState<string>('');
  const [isLoadingProposal, setIsLoadingProposal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const userEditedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen && job) {
      userEditedRef.current = false;
      setIsSubmitting(false);
      setErrorMessage(null);
      setOdlInput(initialProposedOdl || '');

      let cancelled = false;
      setIsLoadingProposal(true);
      getNextOdlNumber()
        .then((freshNextOdl) => {
          if (!cancelled && freshNextOdl && !userEditedRef.current) {
            setOdlInput(freshNextOdl);
          }
        })
        .catch(() => {
          // Mantiene initialProposedOdl in caso di errore
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoadingProposal(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, job, initialProposedOdl]);

  if (!job) return null;

  const trimmedOdl = odlInput.trim();
  const parsedStandard = parseStandardOdl(trimmedOdl);
  const isValidInput = trimmedOdl.length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValidInput || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await onConfirmStart(job, trimmedOdl);
      if (typeof res === 'object' && res !== null) {
        if (res.ok) {
          onClose();
        } else {
          setErrorMessage(
            res.error || "Attenzione: il numero ODL inserito è già in uso su un'altra commessa."
          );
        }
      } else if (res !== false) {
        onClose();
      } else {
        setErrorMessage("Attenzione: il numero ODL inserito è già in uso su un'altra commessa.");
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Errore durante l'avvio della commessa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && !open && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-emerald-500/20 rounded-lg border border-emerald-500/30">
              <Hash className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Assegna N° ODL e Avvia Commessa
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Conferma il progressivo ODL proposto oppure inserisci un codice manuale (es. RG.1).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Riepilogo Commessa */}
          <div className="p-3 rounded-lg bg-slate-800/70 border border-slate-700/70 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Ordine PF
              </div>
              <div className="font-mono font-bold text-base text-white truncate">
                {job.ordinePF || job.id}
              </div>
              <div className="text-xs text-slate-400 truncate">
                Articolo: <strong className="text-slate-200 font-mono">{job.details || 'N/D'}</strong> • {job.cliente || 'N/D'}
              </div>
            </div>
            <div className="text-right shrink-0">
              <Badge variant="outline" className="border-blue-500/40 text-blue-400 font-mono text-xs px-2 py-0.5">
                {(job.qta || 0).toLocaleString('it-IT')} pz
              </Badge>
            </div>
          </div>

          {/* Input N° ODL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="confirm-odl-input" className="text-xs font-bold text-emerald-400">
                Numero ODL (Ordine di Lavoro)
              </Label>
              {isLoadingProposal && (
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Lettura numeratore...
                </span>
              )}
            </div>

            <Input
              id="confirm-odl-input"
              type="text"
              value={odlInput}
              onChange={(e) => {
                userEditedRef.current = true;
                if (errorMessage) setErrorMessage(null);
                setOdlInput(e.target.value);
              }}
              disabled={isSubmitting}
              placeholder="Es. 2622-26 oppure RG.1"
              className="bg-slate-950 border-slate-700 focus:border-emerald-500 h-11 font-mono font-bold text-lg text-emerald-300 tracking-wide"
              autoFocus
            />

            {errorMessage && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {trimmedOdl && !errorMessage && (
              <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
                {parsedStandard ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Formato standard (Progressivo <strong>{parsedStandard.progressive}</strong> / Anno{' '}
                      <strong>20{parsedStandard.yearStr}</strong>) — aggiornerà il numeratore.
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Edit3 className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Formato custom manuale (<strong>{trimmedOdl}</strong>) — non modificherà il contatore automatico.
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
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
              type="submit"
              disabled={!isValidInput || isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Avvio in corso...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  <span>Conferma e Avvia</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
