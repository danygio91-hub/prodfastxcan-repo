"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PackageX, Settings, Clock, User, MessageSquare, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PauseReason = 'Manca Materiale' | 'Guasto Macchina' | 'Attesa Attrezzaggio' | 'Pausa Personale/Fine Turno' | 'Altro';

interface PauseReasonDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: PauseReason, notes?: string) => void;
  isLoading?: boolean;
}

const REASONS: { label: PauseReason; icon: any; color: string }[] = [
  { label: 'Manca Materiale', icon: PackageX, color: 'text-red-500 border-red-200 bg-red-50 hover:bg-red-100' },
  { label: 'Guasto Macchina', icon: Settings, color: 'text-orange-500 border-orange-200 bg-orange-50 hover:bg-orange-100' },
  { label: 'Attesa Attrezzaggio', icon: Clock, color: 'text-blue-500 border-blue-200 bg-blue-50 hover:bg-blue-100' },
  { label: 'Pausa Personale/Fine Turno', icon: User, color: 'text-emerald-500 border-emerald-200 bg-emerald-50 hover:bg-emerald-100' },
  { label: 'Altro', icon: MessageSquare, color: 'text-slate-500 border-slate-200 bg-slate-50 hover:bg-slate-100' },
];

export default function PauseReasonDialog({ isOpen, onOpenChange, onConfirm, isLoading }: PauseReasonDialogProps) {
  const [selectedReason, setSelectedReason] = useState<PauseReason | null>(null);
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    if (!selectedReason) return;
    onConfirm(selectedReason, notes);
    // Reset state after confirm (assuming parent closes it)
    setTimeout(() => {
        setSelectedReason(null);
        setNotes('');
    }, 300);
  };

  const isSaveDisabled = !selectedReason || (selectedReason === 'Altro' && !notes.trim()) || isLoading;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!isLoading) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Motivazione della Pausa
          </DialogTitle>
          <DialogDescription>
            Per procedere con la messa in pausa, seleziona una causale obbligatoria.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          {REASONS.map((r) => {
            const Icon = r.icon;
            const isSelected = selectedReason === r.label;
            return (
              <button
                key={r.label}
                onClick={() => setSelectedReason(r.label)}
                disabled={isLoading}
                className={cn(
                  "flex items-center gap-3 p-3 text-left border rounded-lg transition-all",
                  r.color,
                  isSelected ? "ring-2 ring-primary border-transparent shadow-md scale-[1.02]" : "opacity-80 grayscale-[0.3]"
                )}
              >
                <div className={cn("p-2 rounded-full", isSelected ? "bg-white/50" : "bg-muted")}>
                    <Icon className="h-5 w-5" />
                </div>
                <span className="font-semibold text-sm">{r.label}</span>
              </button>
            );
          })}
        </div>

        {selectedReason === 'Altro' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
            <Label htmlFor="notes" className="text-xs font-bold uppercase text-muted-foreground">
              Dettagli Motivazione (Obbligatorio)
            </Label>
            <Textarea
              id="notes"
              placeholder="Inserisci qui il motivo della pausa..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px]"
              autoFocus
            />
          </div>
        )}

        <DialogFooter className="pt-4">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)} 
            disabled={isLoading}
          >
            Annulla
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isSaveDisabled}
            className={cn(
                "min-w-[100px]",
                selectedReason === 'Manca Materiale' && "bg-red-600 hover:bg-red-700",
                selectedReason === 'Guasto Macchina' && "bg-orange-600 hover:bg-orange-700"
            )}
          >
            {isLoading ? "Salvataggio..." : "Conferma Pausa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
