import { describe, it, expect } from 'vitest';
import { createInitialRow, isManualMultiRowEmpty, type ManualMultiRow } from '@/lib/manual-multi-utils';

describe('FASE 70: Fix UX Inserimento Multiplo (Righe Vuote Bloccanti)', () => {
  describe('createInitialRow', () => {
    it('crea una singola riga con valori iniziali e quantità di default a 100', () => {
      const row = createInitialRow('CP');
      expect(row.department).toBe('CP');
      expect(row.ordinePF).toBe('');
      expect(row.cliente).toBe('');
      expect(row.articleCode).toBe('');
      expect(row.qta).toBe(100);
      expect(row.dataConsegnaFinale).toBe('');
      expect(row.id).toBeDefined();
    });
  });

  describe('isManualMultiRowEmpty', () => {
    it('riconosce come completamente vuota/intonsa la riga appena generata con createInitialRow', () => {
      const row = createInitialRow('CP');
      expect(isManualMultiRowEmpty(row)).toBe(true);
    });

    it('riconosce come vuota una riga anche se la quantità è modificata (es. 50 o 0) ma i campi testo sono vuoti', () => {
      const row1: ManualMultiRow = {
        id: '1',
        department: 'CP',
        ordinePF: '',
        cliente: '',
        articleCode: '',
        qta: 50,
        dataConsegnaFinale: '',
      };
      expect(isManualMultiRowEmpty(row1)).toBe(true);

      const row2: ManualMultiRow = {
        ...row1,
        ordinePF: '   ',
        cliente: '   ',
        articleCode: '',
        dataConsegnaFinale: '',
      };
      expect(isManualMultiRowEmpty(row2)).toBe(true);
    });

    it('NON riconosce come vuota una riga se è stato compilato l\'Ordine PF', () => {
      const row: ManualMultiRow = {
        id: '1',
        department: 'CP',
        ordinePF: '123/PF.1',
        cliente: '',
        articleCode: '',
        qta: 100,
        dataConsegnaFinale: '',
      };
      expect(isManualMultiRowEmpty(row)).toBe(false);
    });

    it('NON riconosce come vuota una riga se è stato compilato il Cliente', () => {
      const row: ManualMultiRow = {
        id: '1',
        department: 'CP',
        ordinePF: '',
        cliente: 'ROSSI SPA',
        articleCode: '',
        qta: 100,
        dataConsegnaFinale: '',
      };
      expect(isManualMultiRowEmpty(row)).toBe(false);
    });

    it('NON riconosce come vuota una riga se è stato compilato l\'Articolo', () => {
      const row: ManualMultiRow = {
        id: '1',
        department: 'CP',
        ordinePF: '',
        cliente: '',
        articleCode: 'ART-001',
        qta: 100,
        dataConsegnaFinale: '',
      };
      expect(isManualMultiRowEmpty(row)).toBe(false);
    });

    it('NON riconosce come vuota una riga se è stata compilata la Data Consegna', () => {
      const row: ManualMultiRow = {
        id: '1',
        department: 'CP',
        ordinePF: '',
        cliente: '',
        articleCode: '',
        qta: 100,
        dataConsegnaFinale: '15/12/2026',
      };
      expect(isManualMultiRowEmpty(row)).toBe(false);
    });
  });

  describe('Filtro preventivo salvataggio', () => {
    it('scarta silenziosamente le righe vuote e mantiene solo quelle con dati', () => {
      const row1 = createInitialRow('CP'); // Vuota
      const row2: ManualMultiRow = {
        id: '2',
        department: 'CP',
        ordinePF: '100/PF',
        cliente: 'CLIENTE A',
        articleCode: 'ART-A',
        qta: 250,
        dataConsegnaFinale: '20/11/2026',
      };
      const row3 = createInitialRow('CG'); // Vuota

      const allRows = [row1, row2, row3];
      const nonEmpty = allRows.filter((r) => !isManualMultiRowEmpty(r));

      expect(nonEmpty.length).toBe(1);
      expect(nonEmpty[0].id).toBe('2');
      expect(nonEmpty[0].ordinePF).toBe('100/PF');
    });
  });
});
