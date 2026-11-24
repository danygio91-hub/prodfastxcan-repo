export type PoShortcutActionId = 'addRow' | 'saveOrder';

export type PoShortcutConfig = Record<PoShortcutActionId, string | null>;

export const PO_SHORTCUT_STORAGE_KEY = 'prodfast:po-modal-shortcuts:v1';

export const DEFAULT_PO_SHORTCUTS: PoShortcutConfig = {
  addRow: 'F4',
  saveOrder: 'F10',
};

export const PO_SHORTCUT_ACTION_LABELS: Record<PoShortcutActionId, string> = {
  addRow: 'Aggiungi riga materiale',
  saveOrder: 'Registra / Salva Ordine',
};

export const PO_SHORTCUT_PRESETS: Record<PoShortcutActionId, string[]> = {
  addRow: ['F4', 'F2', 'F8', 'Alt+A'],
  saveOrder: ['F10', 'Ctrl+Enter', 'F9', 'Alt+S'],
};

export interface ShortcutKeyEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export interface ShortcutValidationResult {
  valid: boolean;
  normalized: string | null;
  reason?: string;
}

const SAFE_FUNCTION_KEYS = new Set(['F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10']);
const FORBIDDEN_FUNCTION_KEYS = new Set(['F1', 'F5', 'F11', 'F12']);
const FORBIDDEN_CTRL_KEYS = new Set(['C', 'V', 'X', 'Z', 'A', 'R', 'W', 'T', 'P', 'N', 'Tab']);
const SAFE_COMBO_KEYS = new Set(['Ctrl+Enter', 'Ctrl+S', 'Ctrl++', 'Shift+Enter']);

function normalizeBaseKey(rawKey: string, code?: string): string {
  const trimmed = String(rawKey || '').trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) return '';
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta' || lower === 'altgraph') {
    return '';
  }

  const fnMatch = lower.match(/^f([1-9]|1[0-2])$/);
  if (fnMatch) {
    return `F${fnMatch[1]}`;
  }

  if (lower === 'enter' || lower === 'return' || lower === 'invio') return 'Enter';
  if (lower === 'insert' || lower === 'ins') return 'Insert';
  if (lower === 'escape' || lower === 'esc') return 'Escape';
  if (lower === 'tab') return 'Tab';
  if (lower === 'backspace') return 'Backspace';
  if (lower === 'delete' || lower === 'del' || lower === 'canc') return 'Delete';
  if (trimmed === ' ' || lower === 'space' || lower === 'spacebar') return 'Space';

  if (trimmed === '+' || code === 'NumpadAdd') return '+';

  if (/^arrow(up|down|left|right)$/i.test(lower)) {
    const dir = lower.slice(5);
    return `Arrow${dir.charAt(0).toUpperCase()}${dir.slice(1)}`;
  }

  if (code) {
    const keyCodeMatch = code.match(/^Key([A-Z])$/);
    if (keyCodeMatch) return keyCodeMatch[1];
    const digitCodeMatch = code.match(/^Digit([0-9])$/);
    if (digitCodeMatch && trimmed.length === 1 && /^[0-9]$/.test(trimmed)) {
      return digitCodeMatch[1];
    }
  }

  if (trimmed.length === 1) {
    if (/^[a-zA-Z]$/.test(trimmed)) return trimmed.toUpperCase();
    return trimmed;
  }

  return trimmed;
}

/**
 * Converte un evento tastiera in una stringa canonica (es. 'F4', 'Ctrl+Enter', 'Alt+A'),
 * oppure null se è stato premuto solo un tasto modificatore.
 */
export function serializeShortcutEvent(e: ShortcutKeyEventLike): string | null {
  const rawKey = String(e.key || '');
  const lower = rawKey.toLowerCase();
  if (
    lower === 'control' ||
    lower === 'shift' ||
    lower === 'alt' ||
    lower === 'meta' ||
    lower === 'altgraph' ||
    lower === 'capslock' ||
    lower === 'numlock' ||
    lower === 'scrolllock' ||
    lower === 'dead' ||
    lower === 'unidentified'
  ) {
    return null;
  }

  const baseKey = normalizeBaseKey(rawKey, e.code);
  if (!baseKey) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Meta');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Su layout US '+' richiede Shift: non includere Shift per la combinazione Ctrl++
  const isPlusWithCtrl = baseKey === '+' && Boolean(e.ctrlKey) && !e.altKey;
  if (e.shiftKey && !isPlusWithCtrl) parts.push('Shift');

  parts.push(baseKey);
  return parts.join('+');
}

/**
 * Normalizza una combinazione testuale (es. 'ctrl+invio' -> 'Ctrl+Enter', 'alt+a' -> 'Alt+A').
 */
export function normalizeShortcutString(rawCombo?: string | null): string | null {
  if (rawCombo === null || rawCombo === undefined) return null;
  const trimmed = String(rawCombo).trim();
  if (!trimmed) return null;

  // Gestione speciale di '+' finale (es. Ctrl++ oppure Shift++)
  let tokens: string[];
  if (trimmed.endsWith('++')) {
    const prefix = trimmed.slice(0, -2);
    tokens = [...prefix.split('+').filter(Boolean), '+'];
  } else if (trimmed === '+') {
    tokens = ['+'];
  } else {
    tokens = trimmed.split('+').filter(Boolean);
  }

  if (tokens.length === 0) return null;

  let hasCtrl = false;
  let hasAlt = false;
  let hasShift = false;
  let hasMeta = false;
  let baseToken = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].trim();
    const low = t.toLowerCase();
    const isLast = i === tokens.length - 1;
    if (!isLast) {
      if (low === 'ctrl' || low === 'control') {
        hasCtrl = true;
        continue;
      }
      if (low === 'alt') {
        hasAlt = true;
        continue;
      }
      if (low === 'shift') {
        hasShift = true;
        continue;
      }
      if (low === 'meta' || low === 'cmd' || low === 'win') {
        hasMeta = true;
        continue;
      }
    }
    baseToken = normalizeBaseKey(t);
  }

  if (!baseToken) return null;

  const parts: string[] = [];
  if (hasMeta) parts.push('Meta');
  if (hasCtrl) parts.push('Ctrl');
  if (hasAlt) parts.push('Alt');
  if (hasShift) parts.push('Shift');
  parts.push(baseToken);
  return parts.join('+');
}

/**
 * Formatta la scorciatoia in etichetta leggibile in italiano (es. 'Ctrl+Invio', 'Ins', 'Disabilitato').
 */
export function formatShortcutLabel(combo?: string | null): string {
  const normalized = normalizeShortcutString(combo);
  if (!normalized) return 'Disabilitato';

  if (normalized === 'Ctrl++') return 'Ctrl++';

  return normalized
    .split('+')
    .map((part) => {
      if (part === 'Enter') return 'Invio';
      if (part === 'Insert') return 'Ins';
      return part;
    })
    .join('+');
}

/**
 * Valida una scorciatoia contro i tasti di digitazione, le combinazioni browser/sistema
 * e i conflitti interni tra le azioni del modal Ordini Fornitore.
 */
export function validateShortcutBinding(
  action: PoShortcutActionId,
  rawCombo: string | null | undefined,
  currentConfig: PoShortcutConfig
): ShortcutValidationResult {
  if (rawCombo === null || rawCombo === undefined || rawCombo === '') {
    return { valid: true, normalized: null };
  }

  if (typeof rawCombo === 'string' && rawCombo.trim() === '') {
    return {
      valid: false,
      normalized: 'Space',
      reason: 'Il tasto "Space" interferisce con la digitazione o navigazione nei campi.',
    };
  }

  const normalized = normalizeShortcutString(rawCombo);
  if (!normalized) {
    return {
      valid: false,
      normalized: null,
      reason: 'Combinazione non riconosciuta. Usa F2–F10, Insert, Alt+tasto o Ctrl+Invio.',
    };
  }

  if (normalized.startsWith('Meta+')) {
    return {
      valid: false,
      normalized,
      reason: 'I tasti di sistema Win/Cmd non sono consentiti.',
    };
  }

  // Blocca combinazioni riservate di sistema / browser
  if (normalized === 'Alt+F4') {
    return {
      valid: false,
      normalized,
      reason: 'Alt+F4 è riservato alla chiusura della finestra.',
    };
  }

  if (FORBIDDEN_FUNCTION_KEYS.has(normalized) || /^(Ctrl|Alt|Shift)\+F([1-9]|1[0-2])$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: `${formatShortcutLabel(normalized)} è riservato a browser/sistema.`,
    };
  }

  if (normalized.startsWith('Ctrl+')) {
    const rest = normalized.slice(5);
    if (FORBIDDEN_CTRL_KEYS.has(rest) || normalized.startsWith('Ctrl+Shift+')) {
      return {
        valid: false,
        normalized,
        reason: `${formatShortcutLabel(normalized)} è riservato al browser o al copia/incolla.`,
      };
    }
  }

  // Consenti solo whitelist rigorosa anti-conflitto
  const isSafeSingleFnOrInsert = SAFE_FUNCTION_KEYS.has(normalized) || normalized === 'Insert';
  const isSafeAltBinding = /^Alt\+([A-Z0-9]|Enter)$/.test(normalized);
  const isSafeExplicitCombo = SAFE_COMBO_KEYS.has(normalized);

  if (!isSafeSingleFnOrInsert && !isSafeAltBinding && !isSafeExplicitCombo) {
    if (!normalized.includes('+') || normalized.startsWith('Shift+')) {
      return {
        valid: false,
        normalized,
        reason: `Il tasto "${formatShortcutLabel(normalized)}" interferisce con la digitazione o navigazione nei campi.`,
      };
    }
    return {
      valid: false,
      normalized,
      reason: `Combinazione "${formatShortcutLabel(normalized)}" non consentita. Usa F2–F10, Insert, Alt+lettera/numero o Ctrl+Invio.`,
    };
  }

  // Conflitto interno tra azioni del modal
  const allActions: PoShortcutActionId[] = ['addRow', 'saveOrder'];
  for (const otherAction of allActions) {
    if (otherAction === action) continue;
    const otherNormalized = normalizeShortcutString(currentConfig[otherAction]);
    if (otherNormalized && otherNormalized === normalized) {
      return {
        valid: false,
        normalized,
        reason: `Già assegnato a ${PO_SHORTCUT_ACTION_LABELS[otherAction]}`,
      };
    }
  }

  return { valid: true, normalized };
}

/**
 * Verifica se l'evento tastiera corrisponde esattamente alla scorciatoia configurata.
 */
export function matchesShortcutEvent(e: ShortcutKeyEventLike, combo?: string | null): boolean {
  const expected = normalizeShortcutString(combo);
  if (!expected) return false;
  const actual = serializeShortcutEvent(e);
  return actual !== null && actual === expected;
}

export function loadPoShortcuts(): PoShortcutConfig {
  const fallback: PoShortcutConfig = { ...DEFAULT_PO_SHORTCUTS };
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(PO_SHORTCUT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<PoShortcutActionId, string | null>>;
    const resolved: PoShortcutConfig = { addRow: null, saveOrder: null };

    for (const action of ['addRow', 'saveOrder'] as PoShortcutActionId[]) {
      if (!(action in parsed)) {
        resolved[action] = DEFAULT_PO_SHORTCUTS[action];
        continue;
      }
      const check = validateShortcutBinding(action, parsed[action] ?? null, resolved);
      resolved[action] = check.valid ? check.normalized : DEFAULT_PO_SHORTCUTS[action];
    }

    return resolved;
  } catch {
    return fallback;
  }
}

export function savePoShortcuts(config: PoShortcutConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PO_SHORTCUT_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignora errori di quota o storage bloccato in incognito
  }
}

