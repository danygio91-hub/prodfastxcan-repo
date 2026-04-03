
export interface RawMaterialTypeConfig {
  id: string; // e.g. "BOB"
  label: string; // e.g. "Bobina"
  defaultUnit: string; // Changed from union to string for flexibility
  hasConversion: boolean;
  conversionType?: 'kg/mt' | 'kg/unit';
  requiresCutLength?: boolean;
}

export interface GlobalSettings {
  rawMaterialTypes: RawMaterialTypeConfig[];
  unitsOfMeasure: string[];
  productionProblemTypes: { id: string, label: string }[];
  phaseTypes: { id: string, label: string }[];
  materialSessionCategories: string[];
  jobOrderQrCodeRule?: string; // e.g. "{ordinePF}@{details}@{qta}"
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
    { id: 'preparation', label: 'Preparazione' },
    { id: 'production', label: 'Produzione' },
    { id: 'quality', label: 'Qualità' },
    { id: 'packaging', label: 'Imballaggio' },
  ],
  materialSessionCategories: ['TRECCIA', 'TUBI', 'GUAINA'],
  jobOrderQrCodeRule: "{ordinePF}@{details}@{qta}",
};
