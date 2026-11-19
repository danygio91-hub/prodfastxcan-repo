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



import { describe as describeOdlClean, it as itOdlClean, expect as expectOdlClean } from 'vitest';
import { getCleanOdlValue, getJobCleanOdl } from './odl-numerator';

describeOdlClean('FASE 98-BIS: getCleanOdlValue & getJobCleanOdl', () => {
  itOdlClean('scarta i placeholder e mantiene i valori ODL validi', () => {
    expectOdlClean(getCleanOdlValue(null)).toBe('');
    expectOdlClean(getCleanOdlValue(undefined)).toBe('');
    expectOdlClean(getCleanOdlValue('')).toBe('');
    expectOdlClean(getCleanOdlValue('N/D')).toBe('');
    expectOdlClean(getCleanOdlValue('n/a')).toBe('');
    expectOdlClean(getCleanOdlValue('MANUALE')).toBe('');
    expectOdlClean(getCleanOdlValue('---')).toBe('');
    expectOdlClean(getCleanOdlValue('  2309-26  ')).toBe('2309-26');
  });

  itOdlClean('da priorita a numeroODLInterno e ignora placeholder su numeroODL', () => {
    expectOdlClean(
      getJobCleanOdl({
        numeroODL: 'MANUALE',
        numeroODLInterno: '2309-26',
      })
    ).toBe('2309-26');

    expectOdlClean(
      getJobCleanOdl({
        numeroODL: 'N/D',
        numeroODLInterno: '2309-26',
      })
    ).toBe('2309-26');
  });

  itOdlClean('esegue fallback sui campi successivi quando numeroODLInterno e vuoto o placeholder', () => {
    expectOdlClean(
      getJobCleanOdl({
        numeroODLInterno: '---',
        numeroODL: '2400-26',
      })
    ).toBe('2400-26');

    expectOdlClean(
      getJobCleanOdl({
        numeroODLInterno: '',
        numeroODL: 'MANUALE',
        odlNumber: '2500-26',
      })
    ).toBe('2500-26');
  });
});
