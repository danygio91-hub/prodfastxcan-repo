import { describe, it, expect } from 'vitest';
import { paginateOdlSectionsByHeight } from './odl-pagination-logic';

describe('odl-pagination-logic (FASE 107-QUINQUIES)', () => {
  it('mantiene Treccia + Tubi + Guaina su 1 pagina con Footer quando entrano comodamente nello spazio utile', () => {
    const pages = paginateOdlSectionsByHeight({
      usablePageHeightMm: 197,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: 86, // capacità Pagina 1 = 195.5 - 86 = 109.5 mm
      subsequentHeaderMm: 13.5,
      footerMm: 22.5,
      sections: [
        { sectionType: 'treccia', categoryName: 'Componenti Treccia/Corda', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9] },
        { sectionType: 'tubi', categoryName: 'Componenti Tubi', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9] },
        { sectionType: 'guaina', categoryName: 'Componenti Guaina', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9] },
      ],
    });

    // 3 * 23 = 69 mm + 22.5 footer = 91.5 mm <= 109.5 mm -> tutto su Pagina 1
    expect(pages).toHaveLength(1);
    expect(pages[0].chunks).toHaveLength(3);
    expect(pages[0].chunks.map((c) => c.sectionType)).toEqual(['treccia', 'tubi', 'guaina']);
    expect(pages[0].chunks.every((c) => c.isContinuation === false)).toBe(true);
  });

  it('caso reale 793/PF.2: sposta GUAINA intera a Pagina 2 se GUAINA + Footer sfora anche di 3 mm su Pagina 1', () => {
    const pages = paginateOdlSectionsByHeight({
      usablePageHeightMm: 197,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: 95.5, // capacità Pagina 1 = 195.5 - 95.5 = 100.0 mm
      subsequentHeaderMm: 13.5, // capacità Pagina 2 = 182.0 mm
      footerMm: 24,
      sections: [
        { sectionType: 'treccia', categoryName: 'Componenti Treccia/Corda', sectionHeaderMm: 6.8, tableHeaderMm: 8.2, rowHeightsMm: [11] }, // 26 mm
        { sectionType: 'tubi', categoryName: 'Componenti Tubi', sectionHeaderMm: 6.8, tableHeaderMm: 8.2, rowHeightsMm: [11] }, // 26 mm (cumulato 52 mm)
        { sectionType: 'guaina', categoryName: 'Componenti Guaina', sectionHeaderMm: 6.8, tableHeaderMm: 8.2, rowHeightsMm: [12] }, // 27 mm -> +24 footer = 103 mm (> 100 mm di 3 mm!)
      ],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].chunks.map((c) => c.sectionType)).toEqual(['treccia', 'tubi']);
    expect(pages[1].chunks).toEqual([
      {
        sectionType: 'guaina',
        categoryName: 'Componenti Guaina',
        isContinuation: false,
        rowIndices: [0],
      },
    ]);
  });

  it('anti-footer-orfano: se le 3 sezioni entrano ma il Footer da solo sforerebbe, sposta GUAINA insieme al Footer su Pagina 2', () => {
    const pages = paginateOdlSectionsByHeight({
      usablePageHeightMm: 197,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: 100.5, // capacità Pagina 1 = 95.0 mm
      subsequentHeaderMm: 13.5,
      footerMm: 24,
      sections: [
        { sectionType: 'treccia', categoryName: 'Componenti Treccia/Corda', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [11] }, // 25 mm
        { sectionType: 'tubi', categoryName: 'Componenti Tubi', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [11] }, // 25 mm
        { sectionType: 'guaina', categoryName: 'Componenti Guaina', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [11] }, // 25 mm -> 75 <= 95, ma 75+24 = 99 > 95!
      ],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].chunks.map((c) => c.sectionType)).toEqual(['treccia', 'tubi']);
    expect(pages[1].chunks.map((c) => c.sectionType)).toEqual(['guaina']);
    expect(pages[1].chunks[0].rowIndices).toEqual([0]);
  });

  it('sezione gigante (> 1 pagina intera): splitta al confine esatto della riga <tr> con isContinuation e senza Footer orfano', () => {
    // Capacità Pagina 1 = 195.5 - 95.5 = 100 mm; overhead = 15 mm -> 8 righe da 10 mm (= 95 mm)
    // Capacità Pagina 2 = 195.5 - 15.5 = 180 mm; overhead = 15 mm; footer = 25 mm ->
    // 16 righe su Pagina 2 = 175 mm <= 180 mm (ma 175 + 25 footer = 200 > 180)
    // Anti-footer-orfano deve trattenere 1 riga (15 righe su Pagina 2, riga 24 + Footer su Pagina 3)
    const twentyFourRows = Array.from({ length: 24 }, () => 10);
    const pages = paginateOdlSectionsByHeight({
      usablePageHeightMm: 197,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: 95.5, // cap 100
      subsequentHeaderMm: 15.5, // cap 180
      footerMm: 25,
      sections: [
        {
          sectionType: 'treccia',
          categoryName: 'Componenti Treccia/Corda',
          sectionHeaderMm: 7,
          tableHeaderMm: 8,
          rowHeightsMm: twentyFourRows,
        },
      ],
    });

    expect(pages).toHaveLength(3);
    expect(pages[0].chunks[0].isContinuation).toBe(false);
    expect(pages[0].chunks[0].rowIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pages[1].chunks[0].isContinuation).toBe(true);
    expect(pages[1].chunks[0].rowIndices).toHaveLength(15);
    expect(pages[2].chunks[0].isContinuation).toBe(true);
    expect(pages[2].chunks[0].rowIndices).toEqual([23]);
  });

  it('rispetta splitByCategoryThreshold avviando le categorie su pagina pulita senza mai tagliare nessuna sezione', () => {
    const pages = paginateOdlSectionsByHeight({
      usablePageHeightMm: 197,
      safetyMarginMm: 1.5,
      page1HeaderPlusDetailsMm: 85, // cap 110.5
      subsequentHeaderMm: 13.5, // cap 182
      footerMm: 22,
      splitByCategoryThreshold: 2, // 4 righe > soglia 2 -> separa per categoria
      sections: [
        { sectionType: 'treccia', categoryName: 'Componenti Treccia/Corda', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9, 9] },
        { sectionType: 'tubi', categoryName: 'Componenti Tubi', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9] },
        { sectionType: 'guaina', categoryName: 'Componenti Guaina', sectionHeaderMm: 6.5, tableHeaderMm: 7.5, rowHeightsMm: [9] },
      ],
    });

    expect(pages).toHaveLength(3);
    expect(pages[0].chunks.map((c) => c.sectionType)).toEqual(['treccia']);
    expect(pages[1].chunks.map((c) => c.sectionType)).toEqual(['tubi']);
    expect(pages[2].chunks.map((c) => c.sectionType)).toEqual(['guaina']);
  });
});
