/**
 * FASE 87: Resilienza di Rete, Configurazione Retry Automatici (stile SWR)
 * e Gestione Eventi di Riconnessione Non Bloccanti.
 */

export interface NetworkRetryConfig {
  shouldRetryOnError: boolean;
  errorRetryCount: number;
  errorRetryInterval: number;
}

export const DEFAULT_NETWORK_RETRY_CONFIG: NetworkRetryConfig = {
  shouldRetryOnError: true,
  errorRetryCount: 3,
  errorRetryInterval: 2000,
};

/**
 * Determina se un errore è causato da un calo temporaneo di rete, timeout,
 * 502/503/504 da deploy in corso o fallimento di fetch/stream.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;

  const msg = (
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'object' && 'message' in error
        ? String((error as any).message)
        : String(error)
  ).toLowerCase();

  return (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('err_content_decoding_failed') ||
    msg.includes('err_quic_protocol_error') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('quic') ||
    msg.includes('webchannel')
  );
}

export type NetworkStatusEventDetail = {
  reconnecting: boolean;
  attempt?: number;
  maxAttempts?: number;
  reason?: string;
};

const NETWORK_STATUS_EVENT = 'pfx:network-status';

export function emitNetworkStatus(detail: NetworkStatusEventDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<NetworkStatusEventDetail>(NETWORK_STATUS_EVENT, { detail }));
  } catch {
    // Ignore in environments without CustomEvent
  }
}

export function subscribeNetworkStatus(
  listener: (detail: NetworkStatusEventDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (ev: Event) => {
    const customEv = ev as CustomEvent<NetworkStatusEventDetail>;
    if (customEv.detail) {
      listener(customEv.detail);
    }
  };
  window.addEventListener(NETWORK_STATUS_EVENT, handler);
  return () => window.removeEventListener(NETWORK_STATUS_EVENT, handler);
}

/**
 * Esegue una funzione asincrona (es. fetcher SWR / Server Action di lettura) applicando
 * la politica di retry automatico `{ shouldRetryOnError: true, errorRetryCount: 3, errorRetryInterval: 2000 }`.
 * Durante i tentativi emette lo stato non bloccante per il banner "Connessione persa, tentativo di riconnessione...".
 */
export async function withNetworkRetry<T>(
  fetcher: () => Promise<T>,
  config: Partial<NetworkRetryConfig> = {}
): Promise<T> {
  const { shouldRetryOnError, errorRetryCount, errorRetryInterval } = {
    ...DEFAULT_NETWORK_RETRY_CONFIG,
    ...config,
  };

  let attempt = 0;

  while (true) {
    try {
      const result = await fetcher();
      if (attempt > 0) {
        emitNetworkStatus({ reconnecting: false });
      }
      return result;
    } catch (err) {
      const isNetErr = isTransientNetworkError(err);
      if (!shouldRetryOnError || !isNetErr || attempt >= errorRetryCount) {
        if (isNetErr) {
          emitNetworkStatus({
            reconnecting: true,
            attempt: errorRetryCount,
            maxAttempts: errorRetryCount,
            reason: err instanceof Error ? err.message : 'Errore di rete',
          });
        }
        throw err;
      }

      attempt += 1;
      emitNetworkStatus({
        reconnecting: true,
        attempt,
        maxAttempts: errorRetryCount,
        reason: err instanceof Error ? err.message : 'Errore di rete',
      });

      await new Promise((resolve) => setTimeout(resolve, errorRetryInterval));
    }
  }
}

