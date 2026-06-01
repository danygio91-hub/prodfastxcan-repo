
export interface RawMaterialTypeConfig {
  id: string; // e.g. "BOB"
  label: string; // e.g. "Bobina"
  defaultUnit: string; // Changed from union to string for flexibility
  hasConversion: boolean;
  conversionType?: 'kg/mt' | 'kg/unit';
  requiresCutLength?: boolean;
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
    { id: 'BOB', label: 'Bobina', defaultUnit: 'mt', hasConversion: true, conversionType: 'kg/mt', requiresCutLength: true },
    { id: 'TUBI', label: 'Tubi', defaultUnit: 'n', hasConversion: true, conversionType: 'kg/unit', requiresCutLength: false },
    { id: 'PF3V0', label: 'PF3V0', defaultUnit: 'n', hasConversion: true, conversionType: 'kg/unit', requiresCutLength: false },
    { id: 'GUAINA', label: 'Guaina', defaultUnit: 'mt', hasConversion: false, requiresCutLength: true },
    { id: 'BARRA', label: 'Barra', defaultUnit: 'mt', hasConversion: true, conversionType: 'kg/mt', requiresCutLength: true },
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
