import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PO_SHORTCUTS,
  formatShortcutLabel,
  matchesShortcutEvent,
  serializeShortcutEvent,
  validateShortcutBinding,
  type PoShortcutConfig,
} from './po-shortcuts';

describe('po-shortcuts (FASE 108-TER)', () => {
  it('1. accetta tasti sicuri (F4, F10, Insert, Alt+A, Ctrl+Enter, Shift+Enter, Ctrl+S, Ctrl++)', () => {
    const emptyConfig: PoShortcutConfig = { addRow: null, saveOrder: null };

    expect(validateShortcutBinding('addRow', 'F4', emptyConfig)).toEqual({
      valid: true,
      normalized: 'F4',
    });
    expect(validateShortcutBinding('saveOrder', 'F10', emptyConfig)).toEqual({
      valid: true,
      normalized: 'F10',
    });
    expect(validateShortcutBinding('addRow', 'Insert', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Insert',
    });
    expect(validateShortcutBinding('addRow', 'Alt+A', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Alt+A',
    });
    expect(validateShortcutBinding('saveOrder', 'Ctrl+Enter', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Ctrl+Enter',
    });
    expect(validateShortcutBinding('addRow', 'Shift+Enter', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Shift+Enter',
    });
    expect(validateShortcutBinding('saveOrder', 'Ctrl+S', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Ctrl+S',
    });
    expect(validateShortcutBinding('addRow', 'Ctrl++', emptyConfig)).toEqual({
      valid: true,
      normalized: 'Ctrl++',
    });
  });

  it('2. rifiuta tasti di scrittura/navigazione e scorciatoie di sistema/browser', () => {
    const emptyConfig: PoShortcutConfig = { addRow: null, saveOrder: null };

    for (const bad of ['Space', ' ', 'a', '5', 'F1', 'F5', 'F11', 'F12', 'Ctrl+C', 'Ctrl+V', 'Ctrl+R', 'Escape', 'Tab', 'Enter', 'Shift+A', 'Alt+F4']) {
      const res = validateShortcutBinding('addRow', bad, emptyConfig);
      expect(res.valid).toBe(false);
      expect(res.reason).toBeTruthy();
    }
  });

  it('3. blocca il conflitto interno se addRow e saveOrder usano lo stesso tasto', () => {
    const cfg: PoShortcutConfig = { ...DEFAULT_PO_SHORTCUTS }; // addRow: F4, saveOrder: F10

    const conflictOnSave = validateShortcutBinding('saveOrder', 'F4', cfg);
    expect(conflictOnSave.valid).toBe(false);
    expect(conflictOnSave.reason).toContain('Già assegnato a Aggiungi riga materiale');

    const conflictOnAdd = validateShortcutBinding('addRow', 'F10', cfg);
    expect(conflictOnAdd.valid).toBe(false);
    expect(conflictOnAdd.reason).toContain('Già assegnato a Registra / Salva Ordine');

    // Riassegnare il tasto già posseduto dalla stessa azione è consentito
    expect(validateShortcutBinding('addRow', 'F4', cfg).valid).toBe(true);
  });

  it('4. riconosce e formatta correttamente gli eventi tastiera', () => {
    expect(serializeShortcutEvent({ key: 'f4' })).toBe('F4');
    expect(serializeShortcutEvent({ key: 'Enter', ctrlKey: true })).toBe('Ctrl+Enter');
    expect(serializeShortcutEvent({ key: 'a', altKey: true })).toBe('Alt+A');
    expect(serializeShortcutEvent({ key: '+', ctrlKey: true, shiftKey: true })).toBe('Ctrl++');
    expect(serializeShortcutEvent({ key: 'Control', ctrlKey: true })).toBeNull();

    expect(matchesShortcutEvent({ key: 'F10' }, 'F10')).toBe(true);
    expect(matchesShortcutEvent({ key: 'Enter', ctrlKey: true }, 'Ctrl+Enter')).toBe(true);
    expect(matchesShortcutEvent({ key: 'Enter', ctrlKey: false }, 'Ctrl+Enter')).toBe(false);
    expect(matchesShortcutEvent({ key: 'a', altKey: true }, 'Alt+A')).toBe(true);
    expect(matchesShortcutEvent({ key: 'F4' }, null)).toBe(false);

    expect(formatShortcutLabel('Ctrl+Enter')).toBe('Ctrl+Invio');
    expect(formatShortcutLabel('Insert')).toBe('Ins');
    expect(formatShortcutLabel(null)).toBe('Disabilitato');
  });
});

