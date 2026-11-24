import { describe, it, expect } from 'vitest';
import {
  buildPurchaseOrderGroupKey,
  classifyOrderGroupStatus,
  getNextRowDefaultDeliveryDate,
  isOrderDateValidNotFuture,
  normalizeOrderNumber,
  resolvePurchaseOrderDate,
  resolvePurchaseOrderYear,
} from './purchase-order-utils';
import { commitDateInputMask, stepDateInputMask } from './utils';

describe('purchase-order-utils (FASE 108-BIS)', () => {
  it('1. risolve retrocompatibilmente anno e data su record 2026 privi di orderDate/orderYear', () => {
    expect(resolvePurchaseOrderYear({ createdAt: '2026-04-12T09:30:00.000Z' })).toBe(2026);
    expect(resolvePurchaseOrderYear({ expectedDeliveryDate: '2026-11-18T10:00:00.000Z' })).toBe(2026);
    expect(resolvePurchaseOrderYear({})).toBe(2026);
    expect(resolvePurchaseOrderYear(undefined)).toBe(2026);
    expect(resolvePurchaseOrderYear({ orderYear: 2027, orderDate: '2026-12-31T10:00:00.000Z' })).toBe(2027);

    expect(resolvePurchaseOrderDate({ createdAt: '2026-05-03T12:00:00.000Z' })).toBe('2026-05-03T12:00:00.000Z');
    expect(resolvePurchaseOrderDate({ expectedDeliveryDate: '2026-07-10' })).toContain('2026-07-');
    expect(resolvePurchaseOrderDate({})).toBe('2026-01-01T00:00:00.000Z');
  });

  it('2. garantisce coesistenza sicura tra 21/G 2026 e 21/G 2027 e collisione normalizzata nello stesso anno', () => {
    const key2026 = buildPurchaseOrderGroupKey('21/G', 2026);
    const key2027 = buildPurchaseOrderGroupKey('21/G', 2027);
    expect(key2026).toBe('21/G__2026');
    expect(key2027).toBe('21/G__2027');
    expect(key2026).not.toBe(key2027);

    expect(normalizeOrderNumber('  21/g ')).toBe('21/G');
    expect(buildPurchaseOrderGroupKey('  21/g ', 2027)).toBe(key2027);
  });

  it('3. valida isOrderDateValidNotFuture consentendo oggi e passato ma bloccando date future', () => {
    const now = new Date(2026, 10, 24, 15, 30, 0); // 24 Nov 2026
    const todayMorning = new Date(2026, 10, 24, 0, 0, 0);
    const todayEvening = new Date(2026, 10, 24, 23, 59, 0);
    const pastDate = new Date(2025, 0, 15, 12, 0, 0);
    const tomorrow = new Date(2026, 10, 25, 0, 0, 1);

    expect(isOrderDateValidNotFuture(todayMorning, now)).toBe(true);
    expect(isOrderDateValidNotFuture(todayEvening, now)).toBe(true);
    expect(isOrderDateValidNotFuture(pastDate, now)).toBe(true);
    expect(isOrderDateValidNotFuture(tomorrow, now)).toBe(false);
    expect(isOrderDateValidNotFuture('data-invalida', now)).toBe(false);
    expect(isOrderDateValidNotFuture(null, now)).toBe(false);
  });

  it('4. classifica correttamente lo stato gruppo in late, partial, pending, received', () => {
    const refToday = new Date(2026, 10, 24, 10, 0, 0);

    // Tutte ricevute -> received
    expect(
      classifyOrderGroupStatus(
        [
          { status: 'received', quantity: 100, receivedQuantity: 100, expectedDeliveryDate: '2026-11-10' },
          { status: 'pending', quantity: 50, receivedQuantity: 50, expectedDeliveryDate: '2026-11-12' },
        ],
        refToday
      )
    ).toBe('received');

    // Almeno una riga aperta scaduta -> late (anche se altre sono ricevute)
    expect(
      classifyOrderGroupStatus(
        [
          { status: 'received', quantity: 100, receivedQuantity: 100, expectedDeliveryDate: '2026-11-10' },
          { status: 'pending', quantity: 50, receivedQuantity: 0, expectedDeliveryDate: '2026-11-23' },
        ],
        refToday
      )
    ).toBe('late');

    // Almeno una riga ricevuta/parziale e nessuna scaduta -> partial
    expect(
      classifyOrderGroupStatus(
        [
          { status: 'received', quantity: 100, receivedQuantity: 100, expectedDeliveryDate: '2026-11-20' },
          { status: 'pending', quantity: 50, receivedQuantity: 0, expectedDeliveryDate: '2026-11-28' },
        ],
        refToday
      )
    ).toBe('partial');

    expect(
      classifyOrderGroupStatus(
        [
          { status: 'partially_received', quantity: 100, receivedQuantity: 25, expectedDeliveryDate: '2026-11-24' },
        ],
        refToday
      )
    ).toBe('partial');

    // Tutto aperto con data oggi o futura e nessun carico -> pending
    expect(
      classifyOrderGroupStatus(
        [
          { status: 'pending', quantity: 100, receivedQuantity: 0, expectedDeliveryDate: new Date(2026, 10, 24, 12, 0, 0) },
          { status: 'pending', quantity: 50, receivedQuantity: 0, expectedDeliveryDate: '2026-12-01' },
        ],
        refToday
      )
    ).toBe('pending');
  });

  it('5. eredita la data di consegna dall ultima riga inserita tramite getNextRowDefaultDeliveryDate', () => {
    const fallback = new Date(2026, 10, 24, 12, 0, 0);
    const firstRowDate = new Date(2026, 11, 5, 12, 0, 0);
    const lastRowDate = new Date(2026, 11, 18, 12, 0, 0);

    const inherited = getNextRowDefaultDeliveryDate(
      [
        { expectedDeliveryDate: firstRowDate },
        { expectedDeliveryDate: lastRowDate },
      ],
      fallback
    );
    expect(inherited.getTime()).toBe(lastRowDate.getTime());
    expect(inherited).not.toBe(lastRowDate); // restituisce nuova istanza Date

    const fromIso = getNextRowDefaultDeliveryDate(
      [{ expectedDeliveryDate: '2027-01-15T12:00:00.000Z' }],
      fallback
    );
    expect(fromIso.getUTCFullYear()).toBe(2027);
    expect(fromIso.getUTCMonth()).toBe(0);
    expect(fromIso.getUTCDate()).toBe(15);

    expect(getNextRowDefaultDeliveryDate([], fallback).getTime()).toBe(fallback.getTime());
  });

  it('6. gestisce fluidamente la digitazione progressiva della data (0 -> 04 -> 04/1 -> 04/12 -> 04/12/2026) senza perdere la prima cifra', () => {
    const step1 = stepDateInputMask('0');
    expect(step1.formatted).toBe('0');
    expect(step1.completeDate).toBeNull();

    const step2 = stepDateInputMask('04');
    expect(step2.formatted).toBe('04');
    expect(step2.completeDate).toBeNull();

    const step3 = stepDateInputMask('041');
    expect(step3.formatted).toBe('04/1');
    expect(step3.completeDate).toBeNull();

    const step4 = stepDateInputMask('04/12');
    expect(step4.formatted).toBe('04/12');
    expect(step4.completeDate).toBeNull();

    const step5 = stepDateInputMask('04/12/2026');
    expect(step5.formatted).toBe('04/12/2026');
    expect(step5.completeDate).not.toBeNull();
    expect(step5.completeDate!.getFullYear()).toBe(2026);
    expect(step5.completeDate!.getMonth()).toBe(11);
    expect(step5.completeDate!.getDate()).toBe(4);

    // Conferma anno a 2 cifre su Invio/Blur (04/12/26 -> 04/12/2026)
    const fallbackOldDate = new Date(2026, 10, 24, 12, 0, 0);
    const shortCommitted = commitDateInputMask('04/12/26', fallbackOldDate);
    expect(shortCommitted.formatted).toBe('04/12/2026');
    expect(shortCommitted.committedDate?.getFullYear()).toBe(2026);
    expect(shortCommitted.committedDate?.getMonth()).toBe(11);
    expect(shortCommitted.committedDate?.getDate()).toBe(4);

    // Ripristino pulito su blur se input parziale invalido
    const incompleteRestore = commitDateInputMask('04/1', fallbackOldDate);
    expect(incompleteRestore.formatted).toBe('24/11/2026');
    expect(incompleteRestore.committedDate?.getTime()).toBe(fallbackOldDate.getTime());
  });
});

