import type { ODLConfig } from './odl-config';

export type OdlSectionType = 'treccia' | 'tubi' | 'guaina';

export interface OdlPaginationSectionInput {
  sectionType: OdlSectionType;
  categoryName: string;
  sectionHeaderMm: number;
  tableHeaderMm: number;
  rowHeightsMm: number[];
}

export interface OdlPaginationInput {
  usablePageHeightMm?: number;
  safetyMarginMm?: number;
  page1HeaderPlusDetailsMm: number;
  subsequentHeaderMm: number;
  footerMm: number;
  sections: OdlPaginationSectionInput[];
  splitByCategoryThreshold?: number;
}

export interface OdlPaginatedChunk {
  sectionType: OdlSectionType;
  categoryName: string;
  isContinuation: boolean;
  rowIndices: number[];
}

export interface OdlPaginatedPage {
  chunks: OdlPaginatedChunk[];
}

const DEFAULT_USABLE_PAGE_HEIGHT_MM = 197; // A4 landscape 210mm - 2 * 6.5mm laser safe zone
const DEFAULT_SAFETY_MARGIN_MM = 1.5;

function sumHeights(values: number[], start: number = 0, end: number = values.length): number {
  let total = 0;
  for (let i = start; i < end; i++) {
    const val = values[i];
    if (Number.isFinite(val) && val > 0) {
      total += val;
    }
  }
  return total;
}

/**
 * Motore puro e deterministico di impaginazione ODL basato sulle altezze reali in mm.
 *
 * Garanzie matematiche:
 * 1. Sezione atomica: se un'intera sezione non entra nello spazio residuo della pagina corrente,
 *    viene spostata intera e pulita alla pagina successiva.
 * 2. Zero Footer orfano / zero sovrapposizioni: sull'ultima sezione verifica che entri `sezione + footerMm`;
 *    se la sezione entra ma il Footer no, sposta l'intera ultima sezione insieme al Footer.
 * 3. Sezione gigante (> 1 pagina intera): splitta al confine esatto della riga `<tr>`, ripetendo
 *    intestazione `(CONTINUA)` + `<thead>` e mantenendo sempre almeno 1 riga assieme al Footer finale.
 * 4. Rispetta `splitByCategoryThreshold` dando comunque priorità assoluta alle altezze reali misurate.
 */
export function paginateOdlSectionsByHeight(input: OdlPaginationInput): OdlPaginatedPage[] {
  const activeSections = (input.sections || []).filter((s) => s.rowHeightsMm.length > 0);
  if (activeSections.length === 0) {
    return [
      {
        chunks: [
          {
            sectionType: 'treccia',
            categoryName: 'Distinta Base',
            isContinuation: false,
            rowIndices: [],
          },
        ],
      },
    ];
  }

  const usable = Math.max(
    60,
    (input.usablePageHeightMm ?? DEFAULT_USABLE_PAGE_HEIGHT_MM) -
      (input.safetyMarginMm ?? DEFAULT_SAFETY_MARGIN_MM)
  );
  const page1Cap = Math.max(25, usable - Math.max(0, input.page1HeaderPlusDetailsMm));
  const pageNCap = Math.max(40, usable - Math.max(0, input.subsequentHeaderMm));
  const footerMm = Math.max(0, input.footerMm);

  const getPageCap = (pageIdx: number): number => (pageIdx === 0 ? page1Cap : pageNCap);

  const totalBomRows = activeSections.reduce((sum, s) => sum + s.rowHeightsMm.length, 0);
  const threshold = input.splitByCategoryThreshold;
  const forceCategoryPageBreak =
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    threshold > 0 &&
    totalBomRows > threshold;

  const pages: Array<{ chunks: OdlPaginatedChunk[]; usedMm: number }> = [{ chunks: [], usedMm: 0 }];

  for (let sIdx = 0; sIdx < activeSections.length; sIdx++) {
    const sec = activeSections[sIdx];
    const isLastSection = sIdx === activeSections.length - 1;
    const overheadMm = Math.max(0, sec.sectionHeaderMm) + Math.max(0, sec.tableHeaderMm);
    const rowsTotalMm = sumHeights(sec.rowHeightsMm);
    const fullSectionMm = overheadMm + rowsTotalMm;
    const allIndices = sec.rowHeightsMm.map((_, i) => i);

    if (forceCategoryPageBreak && pages[pages.length - 1].chunks.length > 0) {
      pages.push({ chunks: [], usedMm: 0 });
    }

    let curPageIdx = pages.length - 1;
    let curPage = pages[curPageIdx];
    let curCap = getPageCap(curPageIdx);

    // 1. Verifica inserimento atomico nella pagina corrente (incluso footer se ultima sezione)
    const neededMm = fullSectionMm + (isLastSection ? footerMm : 0);
    if (curPage.usedMm + neededMm <= curCap + 1e-6) {
      curPage.chunks.push({
        sectionType: sec.sectionType,
        categoryName: sec.categoryName,
        isContinuation: false,
        rowIndices: allIndices,
      });
      curPage.usedMm += fullSectionMm;
      continue;
    }

    // 2. Se la pagina corrente ha già altri blocchi, sposta l'intera sezione su una nuova pagina pulita
    if (curPage.chunks.length > 0) {
      pages.push({ chunks: [], usedMm: 0 });
      curPageIdx = pages.length - 1;
      curPage = pages[curPageIdx];
      curCap = getPageCap(curPageIdx);

      if (fullSectionMm + (isLastSection ? footerMm : 0) <= curCap + 1e-6) {
        curPage.chunks.push({
          sectionType: sec.sectionType,
          categoryName: sec.categoryName,
          isContinuation: false,
          rowIndices: allIndices,
        });
        curPage.usedMm += fullSectionMm;
        continue;
      }
    }

    // 3. Sezione gigante su pagina vuota (non entra intera nemmeno da sola -> split al confine <tr>)
    let cursor = 0;
    let isContinuation = false;
    while (cursor < sec.rowHeightsMm.length) {
      let pageIdx = pages.length - 1;
      let targetPage = pages[pageIdx];
      let targetCap = getPageCap(pageIdx);

      if (targetPage.chunks.length > 0) {
        pages.push({ chunks: [], usedMm: 0 });
        pageIdx = pages.length - 1;
        targetPage = pages[pageIdx];
        targetCap = getPageCap(pageIdx);
      }

      const availRowsMm = Math.max(0, targetCap - targetPage.usedMm - overheadMm);
      let end = cursor;
      let accMm = 0;

      while (end < sec.rowHeightsMm.length) {
        const nextRowMm = Math.max(0, sec.rowHeightsMm[end] || 0);
        if (end === cursor || accMm + nextRowMm <= availRowsMm + 1e-6) {
          accMm += nextRowMm;
          end++;
        } else {
          break;
        }
      }

      // Salvaguardia anti-footer-orfano sull'ultima fetta della sezione finale:
      // se tutte le righe residue entrano senza footer ma col footer sforerebbero,
      // lascia almeno l'ultima riga per accompagnare il footer sulla pagina successiva.
      if (
        isLastSection &&
        end === sec.rowHeightsMm.length &&
        end - cursor > 1 &&
        targetPage.usedMm + overheadMm + accMm + footerMm > targetCap + 1e-6
      ) {
        end--;
      }

      const rowIndices: number[] = [];
      for (let i = cursor; i < end; i++) {
        rowIndices.push(i);
      }

      const sliceRowsMm = sumHeights(sec.rowHeightsMm, cursor, end);
      targetPage.chunks.push({
        sectionType: sec.sectionType,
        categoryName: sec.categoryName,
        isContinuation,
        rowIndices,
      });
      targetPage.usedMm += overheadMm + sliceRowsMm;

      cursor = end;
      isContinuation = true;

      if (cursor < sec.rowHeightsMm.length) {
        pages.push({ chunks: [], usedMm: 0 });
      }
    }
  }

  return pages.map(({ chunks }) => ({ chunks }));
}

function parseMmValue(raw: string | undefined, fallbackMm: number): number {
  if (!raw) return fallbackMm;
  const trimmed = String(raw).trim().toLowerCase();
  const num = parseFloat(trimmed);
  if (!Number.isFinite(num) || num <= 0) return fallbackMm;
  if (trimmed.endsWith('px')) return num * 0.2646;
  if (trimmed.endsWith('cm')) return num * 10;
  return num;
}

/**
 * Stima iniziale in mm basata su `ODLConfig` per il primo render prima che `useLayoutEffect`
 * legga gli ingombri DOM effettivi dalla sonda.
 */
export function estimateInitialOdlPaginationInput(
  config: ODLConfig,
  sections: Array<{
    sectionType: OdlSectionType;
    categoryName: string;
    items: any[];
    hasNotes: boolean;
  }>
): OdlPaginationInput {
  const ptToMm = 0.3528;
  const pxToMm = 0.2646;

  const revMm = config.header.showRevInfo && config.header.revText ? 3.8 : 0;
  const titleH = parseMmValue(config.header.titleHeight, 12);
  const logoH = (config.header.logoHeight || 40) * pxToMm + 2;
  const headerColFontMm = (config.typography.headerFontSize || 7) * ptToMm;
  const leftHeaderH = Math.max(titleH, logoH) + headerColFontMm * 1.8 + 10.5;
  const qrTitleH = parseMmValue(config.header.qrTitleHeight, 6);
  const qrBoxH = qrTitleH + (config.header.qrSize || 65) * pxToMm + 3;
  const headerFirstMm = revMm + Math.max(leftHeaderH, qrBoxH) + 2.5;

  const visibleInfoRows = (config.info.columns || []).filter((c) => c.visible).length || 1;
  const infoRowMm = Math.max(8.5, ((config.info.fontSize || 8) + 2) * ptToMm * 1.8 + 3);
  const drawingAreaMm = parseMmValue(config.layout.drawingAreaHeight, 40);
  const detailsMm = Math.max(visibleInfoRows * infoRowMm, drawingAreaMm) + 2.5;

  const baseFontMm = (config.typography.baseFontSize || 8) * ptToMm;
  const cellPadMm = (config.layout.cellPadding || 0) * pxToMm * 2;
  const baseRowMm = Math.max(8.5, baseFontMm * 1.45 + cellPadMm + 2.5);

  return {
    usablePageHeightMm: DEFAULT_USABLE_PAGE_HEIGHT_MM,
    safetyMarginMm: DEFAULT_SAFETY_MARGIN_MM,
    page1HeaderPlusDetailsMm: headerFirstMm + detailsMm,
    subsequentHeaderMm: 13.5,
    footerMm: 23.0,
    splitByCategoryThreshold: config.layout.splitByCategoryThreshold,
    sections: sections.map((sec) => ({
      sectionType: sec.sectionType,
      categoryName: sec.categoryName,
      sectionHeaderMm: 6.8,
      tableHeaderMm: Math.max(7.5, baseFontMm * 2.2 + cellPadMm + 2),
      rowHeightsMm: sec.items.map((item) => {
        const noteLen = String(item?.note || '').trim().length;
        const extraLines = sec.hasNotes && noteLen > 24 ? Math.min(3, Math.ceil(noteLen / 24) - 1) : 0;
        return baseRowMm + extraLines * baseFontMm * 1.3;
      }),
    })),
  };
}
