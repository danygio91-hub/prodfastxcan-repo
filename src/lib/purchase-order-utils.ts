import { parseRobustDate } from './utils';

export type OrderGroupStatus = 'late' | 'partial' | 'pending' | 'received';

export interface PurchaseOrderYearCandidate {
  orderDate?: any;
  orderYear?: number | null;
  createdAt?: any;
  expectedDeliveryDate?: any;
}

export interface PurchaseOrderStatusItemCandidate {
  status?: string | null;
  quantity?: number | null;
  receivedQuantity?: number | null;
  expectedDeliveryDate?: any;
}

export interface PurchaseOrderDeliveryCandidate {
  expectedDeliveryDate?: Date | string | null;
}

const DEFAULT_LEGACY_ORDER_DATE_ISO = '2026-01-01T00:00:00.000Z';
const DEFAULT_LEGACY_ORDER_YEAR = 2026;

/**
 * Normalizza il numero ordine rimuovendo spazi superflui e convertendo in maiuscolo.
 */
export function normalizeOrderNumber(raw?: string | null): string {
  return String(raw ?? '').trim().toUpperCase();
}

function parseCandidateDate(input: any): Date | null {
  if (!input) return null;
  const parsed = parseRobustDate(input);
  if (!parsed || isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Risolve la data di emissione dell'ordine in formato ISO, con fallback retroattivo sui documenti 2026
 * privi di `orderDate`: `po.orderDate -> po.createdAt -> po.expectedDeliveryDate`.
 */
export function resolvePurchaseOrderDate(po?: PurchaseOrderYearCandidate | null): string {
  const candidates = [po?.orderDate, po?.createdAt, po?.expectedDeliveryDate];
  for (const candidate of candidates) {
    const parsed = parseCandidateDate(candidate);
    if (parsed) {
      return parsed.toISOString();
    }
  }
  return DEFAULT_LEGACY_ORDER_DATE_ISO;
}

/**
 * Risolve l'anno di competenza dell'ordine in modo 100% retrocompatibile:
 * `po.orderYear (> 2000) -> anno di orderDate/createdAt/expectedDeliveryDate -> 2026`.
 */
export function resolvePurchaseOrderYear(po?: PurchaseOrderYearCandidate | null): number {
  if (typeof po?.orderYear === 'number' && Number.isFinite(po.orderYear) && po.orderYear > 2000) {
    return Math.trunc(po.orderYear);
  }

  const candidates = [po?.orderDate, po?.createdAt, po?.expectedDeliveryDate];
  for (const candidate of candidates) {
    const parsed = parseCandidateDate(candidate);
    if (parsed && parsed.getFullYear() > 2000) {
      return parsed.getFullYear();
    }
  }

  return DEFAULT_LEGACY_ORDER_YEAR;
}

/**
 * Costruisce la chiave univoca composita anno-sicura per identificare un ordine fornitore.
 */
export function buildPurchaseOrderGroupKey(orderNumber: string, orderYear: number): string {
  return `${normalizeOrderNumber(orderNumber)}__${orderYear}`;
}

/**
 * Verifica che la data ordine sia valida e non nel futuro (retrodatazione libera fino a fine giornata odierna).
 */
export function isOrderDateValidNotFuture(date?: Date | string | null, now: Date = new Date()): boolean {
  const parsed = parseCandidateDate(date);
  if (!parsed) return false;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return parsed.getTime() <= endOfToday.getTime();
}

function isRowFullyReceived(item: PurchaseOrderStatusItemCandidate): boolean {
  const status = String(item.status || '').toLowerCase();
  if (status === 'received') return true;
  const qty = Number(item.quantity || 0);
  const rec = Number(item.receivedQuantity || 0);
  return qty > 0 && rec >= qty - 0.001;
}

/**
 * Classifica lo stato complessivo di un gruppo ordine in 'late' | 'partial' | 'pending' | 'received'.
 */
export function classifyOrderGroupStatus(
  items: PurchaseOrderStatusItemCandidate[],
  todayStart?: Date
): OrderGroupStatus {
  if (!items || items.length === 0) return 'pending';

  const activeItems = items.filter((i) => String(i.status || '').toLowerCase() !== 'cancelled');
  const pool = activeItems.length > 0 ? activeItems : items;

  if (pool.every(isRowFullyReceived)) {
    return 'received';
  }

  const ref = todayStart ?? new Date();
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

  const openItems = pool.filter((i) => !isRowFullyReceived(i));
  const hasLateOpenItem = openItems.some((item) => {
    const expDate = parseCandidateDate(item.expectedDeliveryDate);
    return expDate !== null && expDate.getTime() < startOfToday.getTime();
  });

  if (hasLateOpenItem) {
    return 'late';
  }

  const hasPartialProgress = pool.some((item) => {
    const status = String(item.status || '').toLowerCase();
    return status === 'received' || status === 'partially_received' || Number(item.receivedQuantity || 0) > 0;
  });

  if (hasPartialProgress) {
    return 'partial';
  }

  return 'pending';
}

/**
 * Eredita la data di consegna prevista dall'ultima riga inserita (se valida) per l'inserimento a cascata.
 */
export function getNextRowDefaultDeliveryDate(
  items: PurchaseOrderDeliveryCandidate[],
  fallbackDate: Date = new Date()
): Date {
  if (items && items.length > 0) {
    const last = items[items.length - 1];
    const parsed = parseCandidateDate(last?.expectedDeliveryDate);
    if (parsed) {
      return new Date(parsed.getTime());
    }
  }
  return new Date(fallbackDate.getTime());
}

