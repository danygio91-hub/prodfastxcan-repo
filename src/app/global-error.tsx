'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { isTransientNetworkError } from '@/lib/network-resilience';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const msgLower = (error?.message || '').toLowerCase();
  const isNetworkErr =
    msgLower.includes('network') ||
    msgLower.includes('fetch') ||
    isTransientNetworkError(error);

  const [countdown, setCountdown] = useState<number>(isNetworkErr ? 4 : 0);

  const handleReload = useCallback(() => {
    try {
      reset();
    } catch {
      window.location.reload();
    }
  }, [reset]);

  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  useEffect(() => {
    if (!isNetworkErr) return;

    setCountdown(4);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleReload();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const handleOnline = () => {
      clearInterval(interval);
      handleReload();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [error, isNetworkErr, handleReload]);

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
          {isNetworkErr && countdown > 0 && (
            <div className="flex items-center justify-center gap-2 p-2.5 mb-4 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>Connessione persa, tentativo di riconnessione tra {countdown}s...</span>
            </div>
          )}
          {error?.message && (
            <div className="p-3 bg-slate-800 rounded text-xs text-left text-slate-300 font-mono mb-4 max-h-20 overflow-y-auto break-all">
              {error.message}
            </div>
          )}
          <button
            onClick={handleReload}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            Ricarica Pagina
          </button>
        </div>
      </body>
    </html>
  );
}
