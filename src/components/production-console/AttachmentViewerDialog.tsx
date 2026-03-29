"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, ExternalLink, Download, FileImage, FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Attachment {
  name: string;
  url: string;
}

interface AttachmentViewerDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  attachments: Attachment[];
  title?: string;
}

export default function AttachmentViewerDialog({ isOpen, onOpenChange, attachments, title = "Documentazione Tecnica" }: AttachmentViewerDialogProps) {
  
  const getFileIcon = (url: string) => {
    const ext = url.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext || '')) return <FileImage className="h-5 w-5 text-blue-500" />;
    if (['pdf'].includes(ext || '')) return <FileText className="h-5 w-5 text-red-500" />;
    return <FileCode className="h-5 w-5 text-slate-500" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Documenti e disegni tecnici associati a questa commessa.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {attachments && attachments.length > 0 ? (
            attachments.map((att, idx) => (
              <div 
                key={idx} 
                className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 bg-muted rounded-md group-hover:bg-background transition-colors">
                    {getFileIcon(att.url)}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-semibold truncate max-w-[250px]">{att.name}</span>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Allegato {idx + 1}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        asChild
                        className="h-9 w-9"
                    >
                        <a href={att.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        asChild
                        className="h-9 w-9"
                    >
                        <a href={att.url} download={att.name}>
                            <Download className="h-4 w-4" />
                        </a>
                    </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground italic border-2 border-dashed rounded-lg">
                <FileText className="h-10 w-10 opacity-20 mb-2" />
                <p>Nessun allegato trovato.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
