'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { WifiOff, RefreshCw, Home, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Registra l'errore a livello globale
    console.error('[RootErrorBoundary]', error);
  }, [error]);

  const handleReload = () => {
    try {
      reset();
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-lg shadow-2xl border-amber-500/40 bg-card">
        <CardHeader className="text-center pb-3 pt-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500/30 flex items-center justify-center mb-3 shadow-inner">
            <WifiOff className="h-8 w-8 text-amber-600 dark:text-amber-400 animate-pulse" />
          </div>
          <CardTitle className="text-xl font-bold text-foreground">
            Ops! Si è verificato un problema di connessione con il server.
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm text-muted-foreground px-6">
          <p className="leading-relaxed">
            L&apos;applicazione ha riscontrato un&apos;interruzione temporanea della comunicazione di rete con il database cloud.
          </p>
          <div className="p-3 bg-muted/60 rounded-md border text-xs text-left font-mono break-all text-muted-foreground/90 max-h-24 overflow-y-auto shadow-2xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300 mb-1">
              <ShieldAlert className="h-3.5 w-3.5" />
              Dettaglio diagnostico:
            </div>
            {error?.message || "Interruzione della connessione di rete o errore client-side."}
          </div>
          <p className="text-xs text-muted-foreground/80 font-medium">
            Tutti i tuoi dati sono protetti nel server. Clicca sul pulsante sottostante per ricaricare e ripristinare il flusso.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 pb-6 px-6">
          <Button 
            onClick={handleReload}
            size="lg"
            className="w-full sm:w-auto font-bold gap-2 shadow-md bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            Ricarica Pagina
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            asChild
            className="w-full sm:w-auto gap-2 cursor-pointer"
          >
            <Link href="/">
              <Home className="h-4 w-4" />
              Torna alla Home
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
