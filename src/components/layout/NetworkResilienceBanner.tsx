'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import {
  subscribeNetworkStatus,
  emitNetworkStatus,
  isTransientNetworkError,
  type NetworkStatusEventDetail,
} from '@/lib/network-resilience';

export function NetworkResilienceBanner() {
  const [status, setStatus] = useState<NetworkStatusEventDetail>({ reconnecting: false });
  const [isOffline, setIsOffline] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOffline(!navigator.onLine);

    const handleOffline = () => {
      setIsOffline(true);
      setStatus({ reconnecting: true, reason: 'Dispositivo offline' });
    };

    const handleOnline = () => {
      setIsOffline(false);
      setStatus({ reconnecting: false });
      // FASE 91: Evita refetch in background o su tab non visibili (revalidateOnFocus disabilitato)
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        window.dispatchEvent(new CustomEvent('app:refresh', { detail: { silentBackground: true } }));
      }
    };

    // Intercetta rejection di rete transitorie (es. listener Firestore o fetch background caduto)
    // evitando che facciano esplodere l'ErrorBoundary quando i dati sono già presenti a schermo
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isTransientNetworkError(event.reason)) {
        event.preventDefault();
        setStatus({
          reconnecting: true,
          reason: event.reason instanceof Error ? event.reason.message : 'Calo di rete temporaneo',
        });
      }
    };

    const unsubscribe = subscribeNetworkStatus((detail) => {
      setStatus(detail);
    });

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      unsubscribe();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Auto-hide e tentativo silenzioso di riallineamento dopo 4 secondi se la rete è tornata online
  useEffect(() => {
    if (!status.reconnecting || isOffline) return;

    const timer = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        emitNetworkStatus({ reconnecting: false });
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [status, isOffline]);

  const handleManualRetry = useCallback(() => {
    window.dispatchEvent(new Event('app:refresh'));
    if (typeof navigator === 'undefined' || navigator.onLine) {
      setStatus({ reconnecting: false });
    }
  }, []);

  if (!status.reconnecting && !isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-[calc(100%-2rem)] bg-amber-950/95 text-amber-100 border border-amber-500/50 shadow-xl rounded-lg px-3.5 py-2 flex items-center justify-between gap-3 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <WifiOff className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
        <div className="text-xs font-medium leading-tight truncate">
          <span className="font-bold">Connessione persa, tentativo di riconnessione...</span>
          {status.attempt && status.maxAttempts ? (
            <span className="ml-1.5 font-mono text-[11px] text-amber-300">
              ({status.attempt}/{status.maxAttempts})
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={handleManualRetry}
        className="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 rounded px-2 py-1 shrink-0 transition-colors cursor-pointer"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Riprova</span>
      </button>
    </div>
  );
}

