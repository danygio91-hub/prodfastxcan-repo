/**
 * FASE 87: Resilienza di Rete, Configurazione Retry Automatici (stile SWR)
 * e Gestione Eventi di Riconnessione Non Bloccanti.
 */

export interface NetworkRetryConfig {
  shouldRetryOnError: boolean;
  errorRetryCount: number;
  errorRetryInterval: number;
  keepPreviousData?: boolean;
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  dedupingInterval?: number;
}

export const DEFAULT_NETWORK_RETRY_CONFIG: NetworkRetryConfig = {
  shouldRetryOnError: true,
  errorRetryCount: 3,
  errorRetryInterval: 2000,
};

/**
 * FASE 91: Configurazione SWR-style tollerante per la pagina Programmazione.
 * Disabilita revalidateOnFocus per evitare RSC fetch interrotti sui cambi di tab,
 * mantiene sempre i dati precedenti (keepPreviousData: true) e applica retry silenziosi.
 */
export const PROGRAMMAZIONE_SWR_CONFIG: NetworkRetryConfig = {
  shouldRetryOnError: true,
  errorRetryCount: 3,
  errorRetryInterval: 2000,
  keepPreviousData: true,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 10000,
};

/**
 * Determina se un errore è causato da un calo temporaneo di rete, timeout,
 * 502/503/504 da deploy in corso o fallimento di fetch/stream RSC ("Connection closed", ERR_CONTENT_DECODING_FAILED).
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as any).code).toLowerCase()
      : '';

  const msg = (
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'object' && 'message' in error
        ? String((error as any).message)
        : String(error)
  ).toLowerCase();

  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'resource-exhausted' ||
    code === 'aborted' ||
    code === 'cancelled' ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('connection closed') ||
    msg.includes('err_content_decoding_failed') ||
    msg.includes('content_decoding') ||
    msg.includes('decoding') ||
    msg.includes('err_quic_protocol_error') ||
    msg.includes('unexpected end') ||
    msg.includes('socket') ||
    msg.includes('aborted') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('broken pipe') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('quic') ||
    msg.includes('webchannel') ||
    msg.includes('stream')
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

/**
 * FASE 91: Silenziatore errori di rete in background per Programmazione.
 * Ritenta con backoff configurato e, in caso di fallimento di rete ("Connection closed",
 * ERR_CONTENT_DECODING_FAILED, timeout, 502/503/504), NON lancia eccezioni al componente React,
 * preservando i dati precedenti (keepPreviousData: true).
 */
export async function withSilentNetworkRetry<T>(
  label: string,
  fetcher: () => Promise<T>,
  fallbackValue: T,
  config: Partial<NetworkRetryConfig> = PROGRAMMAZIONE_SWR_CONFIG
): Promise<{ ok: boolean; data: T }> {
  try {
    const data = await withNetworkRetry(fetcher, config);
    return { ok: true, data };
  } catch (err) {
    if (isTransientNetworkError(err)) {
      console.warn(`[NetworkResilience - ${label}] Errore di rete silenziato in background (keepPreviousData: true):`, err);
    } else {
      console.warn(`[NetworkResilience - ${label}] Errore background contenuto (keepPreviousData: true):`, err);
    }
    return { ok: false, data: fallbackValue };
  }
}

/**
 * FASE 91: Handler resiliente per callback di errore onSnapshot Firestore.
 * Logga i cali di connessione / "Connection closed" in console senza propagarli all'albero React.
 */
export function handleFirestoreListenerError(contextLabel: string, error: unknown): void {
  const isNetErr = isTransientNetworkError(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as any).message)
        : String(error || 'Errore connessione listener');

  if (isNetErr) {
    console.warn(`[FirestoreListener - ${contextLabel}] Calo connessione / Connection closed silenziato:`, error);
    emitNetworkStatus({ reconnecting: true, reason: message });
  } else {
    console.warn(`[FirestoreListener - ${contextLabel}] Avviso listener gestito senza crash UI:`, error);
  }
}


