import { describe, it, expect } from 'vitest';
import {
  sanitizeOdlFileToken,
  buildSingleOdlDocumentTitle,
  buildBulkOdlDocumentTitle,
  buildOdlIframePrintCss,
  shouldIgnoreElementForOdlCanvas,
  type OdlDomNodeLike,
} from './odl-print-engine';

interface MockNode extends OdlDomNodeLike {
  children: MockNode[];
}

function createMockNode(
  tagName: string,
  options?: { id?: string; classNames?: string[] }
): MockNode {
  const classSet = new Set(options?.classNames || []);
  const node: MockNode = {
    tagName,
    id: options?.id,
    parentElement: null,
    children: [],
    classList: {
      contains: (token: string) => classSet.has(token),
    },
    contains: (other: any) => {
      if (!other) return false;
      if (other === node) return true;
      return node.children.some((child) => child.contains?.(other));
    },
  };
  return node;
}

function appendChild(parent: MockNode, child: MockNode): MockNode {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

describe('odl-print-engine utilities (FASE 107-BIS)', () => {
  it('buildOdlIframePrintCss genera regole @page landscape, print-color-adjust exact e break-after senza pagine bianche finali', () => {
    const css = buildOdlIframePrintCss();

    expect(css).toContain('@page');
    expect(css).toContain('size: A4 landscape;');
    expect(css).toContain('margin: 0;');
    expect(css).toContain('-webkit-print-color-adjust: exact !important;');
    expect(css).toContain('print-color-adjust: exact !important;');
    expect(css).toContain('.odl-page');
    expect(css).toContain('width: 297mm !important;');
    expect(css).toContain('height: 210mm !important;');
    expect(css).toContain('max-height: 210mm !important;');
    expect(css).toContain('break-after: page;');
    expect(css).toContain('page-break-after: always;');
    expect(css).toContain('.odl-page:last-child');
    expect(css).toContain('break-after: auto !important;');
    expect(css).toContain('page-break-after: auto !important;');
    expect(css).toContain('[data-odl-measure="true"]');
    expect(css).toContain('display: none !important;');
  });

  it('sanitizeOdlFileToken e builder titolo documento sanitizzano correttamente caratteri non validi e placeholder', () => {
    expect(sanitizeOdlFileToken('2621/26')).toBe('2621_26');
    expect(sanitizeOdlFileToken(' 185/PF:test*? ')).toBe('185_PF_test');
    expect(sanitizeOdlFileToken('N/D')).toBe('');
    expect(sanitizeOdlFileToken('MANUALE')).toBe('');

    expect(buildSingleOdlDocumentTitle('2621/26', '869/PF')).toBe('ODL_2621_26_869_PF');
    expect(buildSingleOdlDocumentTitle('N/D', '869/PF')).toBe('ODL_869_PF');
    expect(buildSingleOdlDocumentTitle('2621-26', '')).toBe('ODL_2621-26');
    expect(buildSingleOdlDocumentTitle(null, null)).toBe('ODL_Documento');

    const fixedDate = new Date(2026, 10, 24, 9, 5); // 2026-11-24 09:05
    expect(buildBulkOdlDocumentTitle(25, fixedDate)).toBe('ODL_Massivi_25_Commesse_20261124_0905');
  });

  it('shouldIgnoreElementForOdlCanvas conserva solo radice, #odl-pdf-pages e la .odl-page target ignorando app e pagine sorelle', () => {
    const html = createMockNode('HTML');
    const head = appendChild(html, createMockNode('HEAD'));
    const styleEl = appendChild(head, createMockNode('STYLE'));
    const linkEl = appendChild(head, createMockNode('LINK'));
    const headScript = appendChild(head, createMockNode('SCRIPT'));

    const body = appendChild(html, createMockNode('BODY'));
    const appShell = appendChild(body, createMockNode('DIV', { id: 'app-shell' }));

    // Altri elementi della UI (es. DataGrid Programmazione e Modali)
    const dataGrid = appendChild(appShell, createMockNode('TABLE', { id: 'programmazione-grid' }));
    const dataGridRow = appendChild(dataGrid, createMockNode('TR'));
    const bodyScript = appendChild(body, createMockNode('SCRIPT'));
    const previewIframe = appendChild(body, createMockNode('IFRAME'));

    // Container batch ODL con 2 commesse e più pagine
    const container = appendChild(appShell, createMockNode('DIV', { id: 'odl-pdf-pages' }));

    const odl1Wrapper = appendChild(container, createMockNode('DIV'));
    const targetPage = appendChild(odl1Wrapper, createMockNode('DIV', { classNames: ['odl-page'] }));
    const targetTable = appendChild(targetPage, createMockNode('TABLE'));
    const targetCell = appendChild(targetTable, createMockNode('TD'));
    const targetQrSvg = appendChild(targetPage, createMockNode('svg'));
    const siblingPageSameOdl = appendChild(odl1Wrapper, createMockNode('DIV', { classNames: ['odl-page'] }));

    const odl2Wrapper = appendChild(container, createMockNode('DIV'));
    const siblingPageOtherOdl = appendChild(odl2Wrapper, createMockNode('DIV', { classNames: ['odl-page'] }));
    const siblingOtherCell = appendChild(siblingPageOtherOdl, createMockNode('DIV'));

    // Devono essere CONSERVATI (false)
    expect(shouldIgnoreElementForOdlCanvas(html, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(head, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(styleEl, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(linkEl, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(body, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(appShell, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(container, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(odl1Wrapper, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(targetPage, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(targetTable, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(targetCell, targetPage, container)).toBe(false);
    expect(shouldIgnoreElementForOdlCanvas(targetQrSvg, targetPage, container)).toBe(false);

    // Devono essere IGNORATI (true)
    expect(shouldIgnoreElementForOdlCanvas(headScript, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(bodyScript, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(previewIframe, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(dataGrid, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(dataGridRow, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(siblingPageSameOdl, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(odl2Wrapper, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(siblingPageOtherOdl, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(siblingOtherCell, targetPage, container)).toBe(true);
  });

  it('shouldIgnoreElementForOdlCanvas esclude sempre la sonda off-screen [data-odl-measure="true"] e tutti i suoi figli', () => {
    const html = createMockNode('HTML');
    const body = appendChild(html, createMockNode('BODY'));
    const container = appendChild(body, createMockNode('DIV', { id: 'odl-pdf-pages' }));
    const templateRoot = appendChild(container, createMockNode('DIV'));

    const measureProbe: MockNode = {
      ...createMockNode('DIV'),
      getAttribute: (attr: string) => (attr === 'data-odl-measure' ? 'true' : null),
      dataset: { odlMeasure: 'true' },
    };
    appendChild(templateRoot, measureProbe);
    const probeTable = appendChild(measureProbe, createMockNode('TABLE'));
    const probeRow = appendChild(probeTable, createMockNode('TR'));

    const targetPage = appendChild(templateRoot, createMockNode('DIV', { classNames: ['odl-page'] }));

    expect(shouldIgnoreElementForOdlCanvas(measureProbe, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(probeTable, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(probeRow, targetPage, container)).toBe(true);
    expect(shouldIgnoreElementForOdlCanvas(targetPage, targetPage, container)).toBe(false);
  });
});

