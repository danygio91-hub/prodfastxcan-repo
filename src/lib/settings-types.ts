
export type RawMaterialOdlSection = 'TRECCIA' | 'TUBI' | 'GUAINA';
export type TabletWithdrawalMode = 'direct' | 'session';

export interface RawMaterialTypeConfig {
  id: string; // e.g. "BOB"
  label: string; // e.g. "Bobina"
  defaultUnit: string; // Changed from union to string for flexibility
  hasConversion: boolean;
  conversionType?: 'kg/mt' | 'kg/unit';
  requiresCutLength?: boolean;
  enableScrap?: boolean;
  odlSection?: RawMaterialOdlSection;
  tabletWithdrawalMode?: TabletWithdrawalMode;
}

export interface SmartCodeFieldOption {
  label: string;
  code: string;
}

export interface SmartCodeField {
  id: string;
  name: string;
  type: 'dropdown' | 'text';
  options: SmartCodeFieldOption[];
}

export interface SmartCodeSettings {
  enabled: boolean;
  fields: SmartCodeField[];
  pattern: string[]; // IDs of fields in order
  separator: string;
}

export interface GlobalSettings {
  rawMaterialTypes: RawMaterialTypeConfig[];
  unitsOfMeasure: string[];
  productionProblemTypes: { id: string, label: string }[];
  phaseTypes: { id: string, label: string, isExternalRouting: boolean, isTerminal: boolean, macroArea: 'PREPARAZIONE' | 'PRODUZIONE' | 'QLTY_PACK' | 'ESTERNA' }[];
  materialSessionCategories: string[];
  jobOrderQrCodeRule?: string; // e.g. "{ordinePF}@{details}@{qta}"
  smartCodeSettings?: SmartCodeSettings;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  rawMaterialTypes: [
    { id: 'BOB', label: 'Bobina', defaultUnit: 'mt', hasConversion: true, conversionType: 'kg/mt', requiresCutLength: true, enableScrap: false, odlSection: 'TRECCIA', tabletWithdrawalMode: 'session' },
    { id: 'TUBI', label: 'Tubi', defaultUnit: 'n', hasConversion: true, conversionType: 'kg/unit', requiresCutLength: false, enableScrap: false, odlSection: 'TUBI', tabletWithdrawalMode: 'direct' },
    { id: 'PF3V0', label: 'PF3V0', defaultUnit: 'n', hasConversion: true, conversionType: 'kg/unit', requiresCutLength: false, enableScrap: false, odlSection: 'TRECCIA', tabletWithdrawalMode: 'session' },
    { id: 'GUAINA', label: 'Guaina', defaultUnit: 'mt', hasConversion: false, requiresCutLength: true, enableScrap: false, odlSection: 'GUAINA', tabletWithdrawalMode: 'direct' },
    { id: 'BARRA', label: 'Barra', defaultUnit: 'mt', hasConversion: true, conversionType: 'kg/mt', requiresCutLength: true, enableScrap: false, odlSection: 'TRECCIA', tabletWithdrawalMode: 'direct' },
  ],
  unitsOfMeasure: ['n', 'mt', 'kg'],
  productionProblemTypes: [
    { id: 'FERMO_MACCHINA', label: 'Fermo Macchina' },
    { id: 'MANCA_MATERIALE', label: 'Manca Materiale' },
    { id: 'PROBLEMA_QUALITA', label: 'Problema Qualità' },
    { id: 'ALTRO', label: 'Altro' },
  ],
  phaseTypes: [
    { id: 'preparation', label: 'Preparazione', isExternalRouting: false, isTerminal: false, macroArea: 'PREPARAZIONE' },
    { id: 'production', label: 'Produzione', isExternalRouting: false, isTerminal: false, macroArea: 'PRODUZIONE' },
    { id: 'quality', label: 'Qualità', isExternalRouting: false, isTerminal: false, macroArea: 'QLTY_PACK' },
    { id: 'packaging', label: 'Imballaggio', isExternalRouting: false, isTerminal: true, macroArea: 'QLTY_PACK' },
  ],
  materialSessionCategories: ['TRECCIA', 'TUBI', 'GUAINA'],
  jobOrderQrCodeRule: "{ordinePF}@{details}@{qta}",
  smartCodeSettings: {
    enabled: false,
    fields: [],
    pattern: [],
    separator: '-',
  }
};

/**
 * Lookup case-insensitive di una configurazione RawMaterialTypeConfig in GlobalSettings.
 */
export function findMaterialTypeConfig(
  typeId?: string | null,
  globalSettings?: Partial<GlobalSettings> | null
): RawMaterialTypeConfig | undefined {
  const normId = (typeId || '').trim().toUpperCase();
  if (!normId) return undefined;
  const list = globalSettings?.rawMaterialTypes || DEFAULT_GLOBAL_SETTINGS.rawMaterialTypes;
  return list.find((t) => (t?.id || '').trim().toUpperCase() === normId);
}

/**
 * Risolve dinamicamente la sezione Stampa ODL / C.to Lavoro leggendo `odlSection` da RawMaterialTypeConfig,
 * con fallback retrocompatibile se la proprietà non è presente su documenti storici.
 */
export function resolveMaterialOdlSection(
  typeConfig?: Partial<RawMaterialTypeConfig> | null,
  fallbackTypeOrCode?: string | null,
  hasCutLength?: boolean
): RawMaterialOdlSection {
  if (
    typeConfig?.odlSection === 'TRECCIA' ||
    typeConfig?.odlSection === 'TUBI' ||
    typeConfig?.odlSection === 'GUAINA'
  ) {
    return typeConfig.odlSection;
  }

  const normalized = (fallbackTypeOrCode || typeConfig?.id || '').trim().toUpperCase();
  if (
    normalized === 'GUAINA' ||
    normalized === 'GUAINE' ||
    (!typeConfig?.id && (normalized.startsWith('GU-') || normalized.startsWith('GUA-') || normalized.startsWith('GU')))
  ) {
    return 'GUAINA';
  }

  if (
    normalized === 'TUBI' ||
    normalized === 'TUBO' ||
    (!typeConfig?.id && (normalized.startsWith('TB-') || normalized.startsWith('TU-')))
  ) {
    return 'TUBI';
  }

  if (
    typeConfig &&
    typeConfig.requiresCutLength === false &&
    String(typeConfig.defaultUnit || '').toLowerCase() === 'n' &&
    normalized !== 'PF3V0'
  ) {
    return 'TUBI';
  }

  if (hasCutLength) {
    return 'TRECCIA';
  }

  return 'TRECCIA';
}

/**
 * Risolve dinamicamente la modalità di scarico Tablet (`session` vs `direct`) da RawMaterialTypeConfig,
 * con fallback retrocompatibile: 'session' per BOB e PF3V0, 'direct' per BARRA, PIATTO-CU e nuovi tipi.
 */
export function resolveTabletWithdrawalMode(
  typeConfig?: Partial<RawMaterialTypeConfig> | null,
  typeId?: string | null
): TabletWithdrawalMode {
  if (typeConfig?.tabletWithdrawalMode === 'direct' || typeConfig?.tabletWithdrawalMode === 'session') {
    return typeConfig.tabletWithdrawalMode;
  }

  const normalized = (typeId || typeConfig?.id || '').trim().toUpperCase();
  if (normalized === 'BOB' || normalized === 'PF3V0') {
    return 'session';
  }

  return 'direct';
}
