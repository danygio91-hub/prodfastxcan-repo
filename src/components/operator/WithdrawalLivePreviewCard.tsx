"use client";

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { formatDisplayStock, cn } from '@/lib/utils';
import type { WithdrawalPreviewResult } from '@/lib/stock-logic';
import { AlertCircle } from 'lucide-react';

interface WithdrawalLivePreviewCardProps {
  preview: WithdrawalPreviewResult | null;
  unitOfMeasure: string;
  isScaleMode?: boolean;
}

/**
 * Anteprima live SSoT pre-conferma per scarichi operatore:
 * mostra Giacenza Attuale, Prelievo (-X), Nuovo Residuo Stimato
 * e blocca visivamente i sovra-scarichi ("Quantità superiore alla giacenza").
 */
export function WithdrawalLivePreviewCard({
  preview,
  unitOfMeasure,
  isScaleMode = false,
}: WithdrawalLivePreviewCardProps) {
  if (!preview || !preview.hasInput) return null;

  const uomUpper = (unitOfMeasure || 'n').toUpperCase();

  return (
    <div
      className={cn(
        "p-3 rounded-xl border-2 space-y-2 animate-in fade-in duration-200",
        preview.isOverdraw
          ? "bg-red-500/10 border-red-500/40"
          : "bg-emerald-500/5 border-emerald-500/25"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
          Anteprima Scarico Live
        </span>
        {preview.isOverdraw && (
          <Badge variant="destructive" className="text-[10px] font-black uppercase px-2 py-0.5 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Quantità superiore alla giacenza
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-background/80 border">
          <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-1">
            Giacenza Attuale
          </p>
          <p className="text-xs font-black text-foreground font-mono">
            {formatDisplayStock(preview.currentAvailableUnits, unitOfMeasure)} {uomUpper}
          </p>
        </div>

        <div className="p-2 rounded-lg bg-background/80 border">
          <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-1">
            Prelievo
          </p>
          <p
            className={cn(
              "text-xs font-black font-mono",
              preview.isOverdraw ? "text-red-600" : "text-orange-600"
            )}
          >
            -{formatDisplayStock(preview.withdrawalUnits, unitOfMeasure)} {uomUpper}
          </p>
        </div>

        <div
          className={cn(
            "p-2 rounded-lg border",
            preview.isOverdraw
              ? "bg-red-500/10 border-red-500/30"
              : "bg-emerald-500/10 border-emerald-500/30"
          )}
        >
          <p className="text-[8px] font-black uppercase text-muted-foreground leading-none mb-1">
            Nuovo Residuo Stimato
          </p>
          <p
            className={cn(
              "text-xs font-black font-mono",
              preview.isOverdraw ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"
            )}
          >
            {preview.isOverdraw
              ? "NON VALIDO"
              : `${formatDisplayStock(preview.estimatedRemainingUnits, unitOfMeasure)} ${uomUpper}`}
          </p>
        </div>
      </div>

      {isScaleMode && !preview.isOverdraw && preview.isZeroOrNegativeScaleDelta && (
        <p className="text-[10px] text-amber-600 font-bold text-center">
          Riduci il peso sulla bilancia rispetto alla giacenza attuale per registrare un prelievo.
        </p>
      )}
    </div>
  );
}

