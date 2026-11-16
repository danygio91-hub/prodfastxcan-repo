import { describe, expect, it } from 'vitest';
import {
  computeNextStandardOdl,
  extractMaxStandardOdl,
  formatStandardOdl,
  parseStandardOdl,
} from './odl-numerator';

describe('odl-numerator (FASE 84)', () => {
  it('parseStandardOdl riconosce il formato standard [PROGRESSIVO]-[ANNO] e scarta formati custom come RG.1', () => {
    expect(parseStandardOdl('2621-26')).toEqual({
      progressive: 2621,
      yearTwoDigits: 26,
      yearStr: '26',
      rawMatched: '2621-26',
    });

    expect(parseStandardOdl('0045-26')).toEqual({
      progressive: 45,
      yearTwoDigits: 26,
      yearStr: '26',
      rawMatched: '0045-26',
    });

    expect(parseStandardOdl('RG.1')).toBeNull();
    expect(parseStandardOdl('MANUALE')).toBeNull();
    expect(parseStandardOdl('2621')).toBeNull();
    expect(parseStandardOdl('')).toBeNull();
  });

  it('extractMaxStandardOdl estrae il massimo progressivo ignorando valori custom', () => {
    const candidates = ['RG.1', '2619-26', '2621-26', '999-26', 'N/D', '3500-25'];
    expect(extractMaxStandardOdl(candidates, 26)).toEqual({
      maxProgressive: 2621,
      yearTwoDigits: 26,
    });
  });

  it('computeNextStandardOdl restituisce il successivo formattato (es. 2621 -> 2622-26)', () => {
    expect(computeNextStandardOdl(2621, 26, 26)).toEqual({
      nextOdl: '2622-26',
      nextProgressive: 2622,
      yearTwoDigits: 26,
    });

    expect(formatStandardOdl(2622, 26)).toBe('2622-26');
  });
});

