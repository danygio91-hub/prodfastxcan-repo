import { format } from 'date-fns';

export interface OdlDomNodeLike {
  id?: string;
  tagName?: string;
  parentElement?: OdlDomNodeLike | null;
  contains?: (other: any) => boolean;
  classList?: { contains: (token: string) => boolean };
}

export interface PrintOdlIframeOptions {
  documentTitle: string;
  imageTimeoutMs?: number;
}

export interface GenerateOptimizedOdlPdfOptions {
  fileName: string;
  scale?: number;
  jpegQuality?: number;
  onProgress?: (current: number, total: number) => void;
}

const INVALID_ODL_TOKENS = new Set(['', 'N/D', 'N/A', 'MANUALE', '---', 'NULL', 'UNDEFINED']);
const IMAGE_DATA_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_DATA_URL_CACHE_MAX = 100;
const imageDataUrlCache = new Map<string, { dataUrl: string | null; expiresAt: number }>();

/**
 * Normalizza un token testuale (numero ODL o ordine PF) per titoli documento e nomi file.
 */
export function sanitizeOdlFileToken(raw?: string | null): string {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (!trimmed || INVALID_ODL_TOKENS.has(trimmed.toUpperCase())) {
    return '';
  }
  return trimmed
    .replace(/[\/\\:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Costruisce il titolo/nome file parlante per la stampa o il PDF di un singolo ODL.
 */
export function buildSingleOdlDocumentTitle(
  numeroODL?: string | null,
  orderCode?: string | null
): string {
  const cleanOdl = sanitizeOdlFileToken(numeroODL);
  const cleanOrder = sanitizeOdlFileToken(orderCode);
  if (cleanOdl && cleanOrder) {
    return `ODL_${cleanOdl}_${cleanOrder}`;
  }
  if (cleanOrder) {
    return `ODL_${cleanOrder}`;
  }
  if (cleanOdl) {
    return `ODL_${cleanOdl}`;
  }
  return 'ODL_Documento';
}

/**
 * Costruisce il titolo/nome file parlante per la stampa o il PDF massivo di più ODL.
 */
export function buildBulkOdlDocumentTitle(count: number, now: Date = new Date()): string {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const timestamp = format(now, 'yyyyMMdd_HHmm');
  return `ODL_Massivi_${safeCount}_Commesse_${timestamp}`;
}

/**
 * CSS dedicato all'iframe vettoriale nativo (Opzione 2A):
 * A4 orizzontale senza margini extra, colori di stampa esatti e zero pagine bianche finali.
 */
export function buildOdlIframePrintCss(): string {
  return [
    '@page {',
    '  size: A4 landscape;',
    '  margin: 0;',
    '}',
    'html, body {',
    '  margin: 0 !important;',
    '  padding: 0 !important;',
    '  background: #ffffff !important;',
    '  width: 297mm;',
    '}',
    '* {',
    '  -webkit-print-color-adjust: exact !important;',
    '  print-color-adjust: exact !important;',
    '  color-adjust: exact !important;',
    '  box-sizing: border-box;',
    '}',
    '#odl-print-root {',
    '  width: 297mm;',
    '  margin: 0;',
    '  padding: 0;',
    '}',
    '.odl-page {',
    '  width: 297mm !important;',
    '  height: 210mm !important;',
    '  max-height: 210mm !important;',
    '  break-after: page;',
    '  page-break-after: always;',
    '  break-inside: avoid;',
    '  page-break-inside: avoid;',
    '  overflow: hidden !important;',
    '}',
    '.odl-page:last-child {',
    '  break-after: auto !important;',
    '  page-break-after: auto !important;',
    '}',
  ].join('\n');
}

function nodeContains(
  ancestor: OdlDomNodeLike | null | undefined,
  target: OdlDomNodeLike | null | undefined
): boolean {
  if (!ancestor || !target) return false;
  if (ancestor === target) return true;
  if (typeof ancestor.contains === 'function') {
    return Boolean(ancestor.contains(target));
  }
  let current = target.parentElement ?? null;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentElement ?? null;
  }
  return false;
}

function isInsideHead(element: OdlDomNodeLike): boolean {
  let current = element.parentElement ?? null;
  let hops = 0;
  while (current && hops < 5) {
    if ((current.tagName || '').toUpperCase() === 'HEAD') {
      return true;
    }
    current = current.parentElement ?? null;
    hops++;
  }
  return false;
}

/**
 * Predicato `ignoreElements` per `html2canvas`:
 * mantiene esclusivamente la catena radice -> `#odl-pdf-pages` -> `.odl-page` target
 * (più gli stili in `<head>`), ignorando sia tutta l'app sottostante sia le N-1 pagine sorelle.
 */
export function shouldIgnoreElementForOdlCanvas(
  element: OdlDomNodeLike,
  targetPage: OdlDomNodeLike,
  container: OdlDomNodeLike
): boolean {
  if (!element || !targetPage || !container) return false;

  const tag = (element.tagName || '').toUpperCase();
  if (tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'IFRAME') {
    return true;
  }
  if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY') {
    return false;
  }
  if (isInsideHead(element)) {
    return false;
  }
  if (element === container || element === targetPage) {
    return false;
  }
  if (nodeContains(element, targetPage)) {
    return false;
  }
  if (nodeContains(targetPage, element)) {
    return false;
  }
  return true;
}

async function waitForImagesInRoot(root: ParentNode, timeoutMs: number): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return;

  await Promise.race([
    Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        if (typeof img.decode === 'function') {
          return img.decode().catch(() => {});
        }
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      })
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Attende il commit React (2x requestAnimationFrame) e la decodifica delle immagini in `#odl-pdf-pages`.
 */
export async function waitForOdlContainerReady(
  containerId: string = 'odl-pdf-pages',
  imageTimeoutMs: number = 600
): Promise<HTMLElement | null> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  const container = document.getElementById(containerId);
  if (!container) return null;

  await waitForImagesInRoot(container, imageTimeoutMs);
  return container;
}

/**
 * Modalità A — Stampa Vettoriale Istantanea tramite iframe nascosto (Opzione 2A).
 * Stampa direttamente dal DOM `.odl-page` con qualità vettoriale nativa senza html2canvas.
 */
export async function printOdlContainerViaIframe(
  container: HTMLElement,
  options: PrintOdlIframeOptions
): Promise<{ pageCount: number }> {
  const pageElements = Array.from(container.querySelectorAll('.odl-page')) as HTMLElement[];
  if (pageElements.length === 0) {
    throw new Error('Nessuna pagina ODL generata per la stampa.');
  }

  const existingIframe = document.getElementById('odl-hidden-print-iframe');
  if (existingIframe?.parentNode) {
    existingIframe.parentNode.removeChild(existingIframe);
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'odl-hidden-print-iframe';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(iframe);

  const iframeWin = iframe.contentWindow;
  const iframeDoc = iframeWin?.document;
  if (!iframeWin || !iframeDoc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    throw new Error('Impossibile inizializzare il frame di stampa.');
  }

  const cleanTitle = (options.documentTitle || 'ODL_Documento').trim();
  const baseHref = window.location.origin ? `${window.location.origin}/` : '/';

  iframeDoc.open();
  iframeDoc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${baseHref}"></head><body><div id="odl-print-root"></div></body></html>`
  );
  iframeDoc.close();
  iframeDoc.title = cleanTitle;

  // Copia stylesheet e font attivi del documento principale
  const headNodes = document.head.querySelectorAll('link[rel="stylesheet"], style');
  headNodes.forEach((node) => {
    const tag = node.tagName.toUpperCase();
    if (tag === 'LINK') {
      const origLink = node as HTMLLinkElement;
      if (!origLink.href) return;
      const linkClone = iframeDoc.createElement('link');
      linkClone.rel = 'stylesheet';
      linkClone.href = origLink.href;
      if (origLink.media) linkClone.media = origLink.media;
      iframeDoc.head.appendChild(linkClone);
    } else if (tag === 'STYLE') {
      const styleClone = iframeDoc.createElement('style');
      styleClone.textContent = node.textContent;
      iframeDoc.head.appendChild(styleClone);
    }
  });

  // Inietta per ultimo il foglio di stile @page e .odl-page dedicato
  const printStyleEl = iframeDoc.createElement('style');
  printStyleEl.id = 'odl-iframe-print-css';
  printStyleEl.textContent = buildOdlIframePrintCss();
  iframeDoc.head.appendChild(printStyleEl);

  const printRoot = iframeDoc.getElementById('odl-print-root');
  if (!printRoot) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    throw new Error('Contenitore radice di stampa non trovato.');
  }

  // Clona ogni .odl-page direttamente dentro #odl-print-root così :last-child e pageBreakAfter funzionano senza pagine bianche finali
  pageElements.forEach((pageEl, idx) => {
    const clonedPage = iframeDoc.importNode(pageEl, true) as HTMLElement;
    const isLastPage = idx === pageElements.length - 1;
    clonedPage.style.pageBreakAfter = isLastPage ? 'auto' : 'always';
    clonedPage.style.breakAfter = isLastPage ? 'auto' : 'page';
    printRoot.appendChild(clonedPage);
  });

  const fontsReady = (iframeDoc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  if (fontsReady) {
    await Promise.race([
      fontsReady.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 800)),
    ]);
  }
  await waitForImagesInRoot(printRoot, options.imageTimeoutMs ?? 1500);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const previousDocTitle = document.title;
  let cleaned = false;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (safetyTimer !== null) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (document.title !== previousDocTitle) {
      document.title = previousDocTitle;
    }
    try {
      iframeWin.removeEventListener('afterprint', cleanup);
    } catch {
      // ignore if iframe already detached
    }
    window.removeEventListener('afterprint', cleanup);
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  iframeWin.addEventListener('afterprint', cleanup, { once: true });
  window.addEventListener('afterprint', cleanup, { once: true });
  safetyTimer = setTimeout(cleanup, 60_000);

  // Imposta temporaneamente anche document.title top-level perché Chromium lo usa come default in "Salva come PDF"
  document.title = cleanTitle;
  try {
    iframeWin.focus();
    iframeWin.print();
  } catch (err) {
    cleanup();
    throw err;
  }

  return { pageCount: pageElements.length };
}

function fetchUrlAsDataUrl(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    })
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

/**
 * Pre-carica e converte in DataURL ogni immagine remota (`logoUrl`, `technicalDrawingUrl`) una sola volta per batch,
 * evitando fetch ridondanti per pagina e stalli `imageTimeout` di html2canvas.
 */
async function precacheOdlImagesInContainer(container: HTMLElement): Promise<void> {
  const nowMs = Date.now();
  const imgElements = Array.from(container.querySelectorAll('img'));
  if (imgElements.length === 0) return;

  const remoteImages: { img: HTMLImageElement; src: string }[] = [];
  const urlsToFetch = new Set<string>();

  for (const img of imgElements) {
    const rawSrc = (img.getAttribute('src') || img.src || '').trim();
    if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) continue;
    if (!rawSrc.startsWith('http://') && !rawSrc.startsWith('https://')) continue;

    remoteImages.push({ img, src: rawSrc });
    const cached = imageDataUrlCache.get(rawSrc);
    if (!cached || cached.expiresAt <= nowMs) {
      urlsToFetch.add(rawSrc);
    }
  }

  if (urlsToFetch.size > 0) {
    const resolvedEntries = await Promise.all(
      Array.from(urlsToFetch).map(async (url) => {
        const dataUrl = await fetchUrlAsDataUrl(url, 1800);
        return { url, dataUrl };
      })
    );

    for (const { url, dataUrl } of resolvedEntries) {
      if (imageDataUrlCache.size >= IMAGE_DATA_URL_CACHE_MAX) {
        const oldestKey = imageDataUrlCache.keys().next().value;
        if (oldestKey) imageDataUrlCache.delete(oldestKey);
      }
      imageDataUrlCache.set(url, {
        dataUrl,
        expiresAt: Date.now() + IMAGE_DATA_URL_CACHE_TTL_MS,
      });
    }
  }

  const decodePromises: Promise<unknown>[] = [];
  for (const { img, src } of remoteImages) {
    const cached = imageDataUrlCache.get(src);
    if (cached?.dataUrl) {
      img.removeAttribute('crossorigin');
      img.src = cached.dataUrl;
      if (typeof img.decode === 'function') {
        decodePromises.push(img.decode().catch(() => {}));
      }
    }
  }

  if (decodePromises.length > 0) {
    await Promise.race([
      Promise.all(decodePromises),
      new Promise<void>((resolve) => setTimeout(resolve, 400)),
    ]);
  }
}

/**
 * Modalità B — Generatore PDF Diretto Ottimizzato (Livello 1).
 * Mantiene il layout esatto ma elimina il cloning O(N²) con `ignoreElements`, pre-cacha le immagini una sola volta
 * e usa scale 1.5 / JPEG 0.85 con callback di avanzamento live.
 */
export async function generateOptimizedOdlPdf(
  container: HTMLElement,
  options: GenerateOptimizedOdlPdfOptions
): Promise<{ pageCount: number; fileName: string }> {
  const pageElements = Array.from(container.querySelectorAll('.odl-page')) as HTMLElement[];
  if (pageElements.length === 0) {
    throw new Error('Nessuna pagina ODL generata per il PDF.');
  }

  const [{ jsPDF }, html2canvasModule] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const html2canvas = html2canvasModule.default;

  await precacheOdlImagesInContainer(container);

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const scale = options.scale ?? 1.5;
  const jpegQuality = options.jpegQuality ?? 0.85;
  const totalPages = pageElements.length;

  for (let idx = 0; idx < totalPages; idx++) {
    const targetPage = pageElements[idx];
    options.onProgress?.(idx + 1, totalPages);

    // Permette al browser di aggiornare la UI di avanzamento tra una pagina e l'altra
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const canvas = await html2canvas(targetPage, {
      scale,
      useCORS: true,
      imageTimeout: 800,
      logging: false,
      backgroundColor: '#ffffff',
      ignoreElements: (el) => shouldIgnoreElementForOdlCanvas(el, targetPage, container),
    });

    const imgData = canvas.toDataURL('image/jpeg', jpegQuality);
    canvas.width = 0;
    canvas.height = 0;

    if (idx > 0) {
      pdf.addPage();
    }
    pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
  }

  const rawName = (options.fileName || 'ODL_Documento').trim();
  const finalFileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
  pdf.save(finalFileName);

  return { pageCount: totalPages, fileName: finalFileName };
}

