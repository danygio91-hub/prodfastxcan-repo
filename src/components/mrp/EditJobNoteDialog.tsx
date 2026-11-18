'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { StickyNote, Save, Trash2, Loader2 } from 'lucide-react';
import type { JobOrder } from '@/types';

export interface EditJobNoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  job: JobOrder | null;
  onSave: (job: JobOrder, newNote: string) => Promise<void> | void;
}

export function EditJobNoteDialog({
  isOpen,
  onClose,
  job,
  onSave,
}: EditJobNoteDialogProps) {
  const [noteText, setNoteText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && job) {
      setNoteText(job.note || '');
      setIsSaving(false);
    } else if (!isOpen) {
      setIsSaving(false);
    }
  }, [isOpen, job?.id, job?.note]);

  if (!job) return null;

  const handleSave = async (valueToSave: string) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(job, valueToSave.trim());
    } finally {
      setIsSaving(false);
    }
  };

  const hasExistingNote = Boolean((job.note || '').trim());

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <StickyNote className="h-4 w-4" />
            </div>
            <span>Nota Rapida Commessa</span>
            <Badge
              variant="outline"
              className="font-mono text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 ml-1"
            >
              {job.ordinePF || job.id}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Inserisci o modifica una nota operativa (es. attesa materiale, sollecito cliente, alert). La commessa verrà evidenziata in giallo nella griglia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 px-2.5 py-1.5 rounded border">
            <span className="truncate">
              Cliente: <strong className="text-foreground">{job.cliente || 'N/D'}</strong>
            </span>
            <span className="font-mono truncate ml-2">
              Art: <strong className="text-foreground">{(job as any).articolo || job.details || 'N/D'}</strong>
            </span>
          </div>

          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Scrivi qui la nota per questa commessa..."
            className="min-h-[110px] text-sm resize-y focus-visible:ring-amber-500"
            autoFocus
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSave(noteText);
              }
            }}
          />
          <p className="text-[10px] text-muted-foreground">
            Suggerimento: premi <kbd className="px-1 py-0.5 bg-muted border rounded font-mono">Ctrl + Invio</kbd> per salvare rapidamente. Lascia vuoto per rimuovere l&apos;evidenziazione.
          </p>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <div>
            {hasExistingNote && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSaving}
                onClick={() => void handleSave('')}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Rimuovi Nota</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={onClose}
            >
              Annulla
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSaving}
              onClick={() => void handleSave(noteText)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>Salva</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default EditJobNoteDialog;

