'use client';

import React, { useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="it">
      <body className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md p-6 bg-slate-900 border border-amber-500/30 rounded-xl shadow-2xl text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
            <WifiOff className="h-7 w-7 text-amber-400 animate-pulse" />
          </div>
          <h1 className="text-xl font-bold mb-2">Ops! Si è verificato un problema di connessione con il server.</h1>
          <p className="text-sm text-slate-400 mb-4">
            La comunicazione con il database cloud è stata interrotta. Nessun dato è andato perduto.
          </p>
          {error?.message && (
            <div className="p-3 bg-slate-800 rounded text-xs text-left text-slate-300 font-mono mb-4 max-h-20 overflow-y-auto break-all">
              {error.message}
            </div>
          )}
          <button
            onClick={() => {
              try {
                reset();
              } catch {
                window.location.reload();
              }
            }}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg"
          >
            <RefreshCw className="h-4 w-4" />
            Ricarica Pagina
          </button>
        </div>
      </body>
    </html>
  );
}
