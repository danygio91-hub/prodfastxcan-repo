import { describe, it, expect, vi } from 'vitest';
import {
  isTransientNetworkError,
  withSilentNetworkRetry,
  handleFirestoreListenerError,
  PROGRAMMAZIONE_SWR_CONFIG,
} from './network-resilience';

describe('FASE 91: Resilienza Data-Fetching & Connection closed (Programmazione)', () => {
  it('espone la configurazione SWR tollerante con keepPreviousData: true e revalidateOnFocus: false', () => {
    expect(PROGRAMMAZIONE_SWR_CONFIG.keepPreviousData).toBe(true);
    expect(PROGRAMMAZIONE_SWR_CONFIG.revalidateOnFocus).toBe(false);
    expect(PROGRAMMAZIONE_SWR_CONFIG.revalidateOnReconnect).toBe(false);
    expect(PROGRAMMAZIONE_SWR_CONFIG.shouldRetryOnError).toBe(true);
    expect(PROGRAMMAZIONE_SWR_CONFIG.errorRetryCount).toBe(3);
  });

  it('riconosce Connection closed, ERR_CONTENT_DECODING_FAILED e codici Firestore come errori transitori', () => {
    expect(isTransientNetworkError(new Error('Connection closed'))).toBe(true);
    expect(isTransientNetworkError(new Error('net::ERR_CONTENT_DECODING_FAILED'))).toBe(true);
    expect(isTransientNetworkError(new Error('Unexpected end of JSON input'))).toBe(true);
    expect(isTransientNetworkError({ code: 'unavailable', message: 'The service is currently unavailable' })).toBe(true);
    expect(isTransientNetworkError(new Error('Validation error: quantity required'))).toBe(false);
  });

  it('withSilentNetworkRetry ritenta in autonomia e silenzia Connection closed preservando il fallback (keepPreviousData)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let attempts = 0;
      const res = await withSilentNetworkRetry(
        'testJobs',
        async () => {
          attempts += 1;
          throw new Error('Connection closed');
        },
        ['previous-job'],
        { shouldRetryOnError: true, errorRetryCount: 2, errorRetryInterval: 1 }
      );

      expect(attempts).toBe(3);
      expect(res.ok).toBe(false);
      expect(res.data).toEqual(['previous-job']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('handleFirestoreListenerError logga il calo connessione senza propagare eccezioni', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        handleFirestoreListenerError('articles', new Error('Connection closed'))
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

