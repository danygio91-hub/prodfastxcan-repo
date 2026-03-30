import { 
  JobOrder, 
  JobPhase, 
  Operator, 
  WorkGroup, 
  RawMaterial, 
  WorkingHoursConfig, 
  OperatorAssignment, 
  Article, 
  Department, 
  WorkPhaseTemplate, 
  Workstation, 
  RawMaterialType, 
  UnitOfMeasure,
  MacroArea,
  PhaseType,
  StatoOperatore,
  OperatorRole
} from '@/types';

export { type JobOrder, type JobPhase, type Operator, type WorkGroup, type RawMaterial, type WorkingHoursConfig, type OperatorAssignment, type Article, type Department, type WorkPhaseTemplate, type Workstation, type RawMaterialType, type UnitOfMeasure, type MacroArea, type PhaseType, type StatoOperatore, type OperatorRole };

export const roles: OperatorRole[] = ['admin', 'supervisor', 'operator'];
export const RawMaterialTypeValues: RawMaterialType[] = ['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA'];

// --- Initial Data (for seeding the database on first run) ---
export const initialJobOrders: JobOrder[] = [];
export const initialOperators: Operator[] = [
  { id: 'op-1', nome: 'Daniel', reparto: [], stato: 'inattivo', role: 'admin', privacySigned: false, nome_normalized: 'daniel', isReal: false },
  { id: 'op-2', nome: 'Ruben', reparto: [], stato: 'inattivo', role: 'supervisor', privacySigned: false, nome_normalized: 'ruben', isReal: true },
  { id: 'op-3', nome: 'Giovanna', reparto: ['BF'], stato: 'inattivo', role: 'operator', privacySigned: false, nome_normalized: 'giovanna', isReal: true },
  { id: 'op-4', nome: 'Paola', reparto: ['MAG'], stato: 'inattivo', role: 'operator', privacySigned: false, nome_normalized: 'paola', isReal: true },
];
export const initialDepartments: Department[] = [
  { id: 'CP', code: 'CP', name: 'Assemblaggio Componenti Elettronici', macroAreas: ['PRODUZIONE'], dependsOnPreparation: true },
  { id: 'CG', code: 'CG', name: 'Controllo Qualità', macroAreas: ['QLTY_PACK'] },
  { id: 'BF', code: 'BF', name: 'Burattatura e Finitura', macroAreas: ['PRODUZIONE'], dependsOnPreparation: true },
  { id: 'MAG', code: 'MAG', name: 'Magazzino', macroAreas: ['PREPARAZIONE', 'QLTY_PACK'] },
  { id: 'Collaudo', code: 'Collaudo', name: 'Collaudo e Test Funzionali', macroAreas: ['QLTY_PACK'] },
  { id: 'Officina', code: 'Officina', name: 'Officina', macroAreas: ['PRODUZIONE'] },
];
export const initialWorkPhaseTemplates: WorkPhaseTemplate[] = [
  { id: 'phase-template-1', name: 'Taglio Treccia/Corda', description: 'Raccolta e preparazione di treccia e corda.', departmentCodes: ['MAG'], sequence: -3, type: 'preparation', tracksTime: true, requiresMaterialScan: true, requiresMaterialSearch: false, allowedMaterialTypes: ['BOB', 'PF3V0'] },
  { id: 'phase-template-7', name: 'Preparazione Tubi', description: 'Preparazione dei tubi per la commessa.', departmentCodes: ['MAG'], sequence: -2, type: 'preparation', tracksTime: true, requiresMaterialScan: true, requiresMaterialSearch: false, allowedMaterialTypes: ['TUBI'] },
  { id: 'phase-template-6', name: 'Taglio Guaina', description: 'Taglio a misura della guaina termorestringente.', departmentCodes: ['MAG'], sequence: -1, type: 'preparation', tracksTime: true, requiresMaterialScan: false, requiresMaterialSearch: true, allowedMaterialTypes: ['GUAINA'] },
  { id: 'phase-template-2', name: 'Assemblaggio Scheda', description: 'Montaggio dei componenti sulla scheda elettronica.', departmentCodes: ['CP'], sequence: 1, type: 'production', tracksTime: true, requiresMaterialScan: false },
  { id: 'phase-template-3', name: 'Saldatura', description: 'Processo di saldatura manuale o automatica.', departmentCodes: ['CP'], sequence: 2, type: 'production', tracksTime: true, requiresMaterialScan: false },
  { id: 'phase-template-4', name: 'Test Funzionale', description: 'Verifica del corretto funzionamento della scheda assemblata.', departmentCodes: ['CG'], sequence: 3, type: 'quality', tracksTime: false, requiresMaterialScan: false },
  { id: 'phase-template-5', name: 'Ispezione Visiva', description: 'Controllo visivo della qualità delle saldature e del montaggio.', departmentCodes: ['CG'], sequence: 4, type: 'quality', tracksTime: false, requiresMaterialScan: false },
];
export const initialWorkstations: Workstation[] = [
  { id: 'ws-1', name: 'Banco Assemblaggio 01', departmentCode: 'CP' },
  { id: 'ws-2', name: 'Stazione Saldatura A', departmentCode: 'CP' },
  { id: 'ws-3', name: 'Banco Test Qualità 01', departmentCode: 'CG' },
  { id: 'ws-4', name: 'Postazione Finitura Manuale', departmentCode: 'BF' },
];
export const initialDepartmentMap: Record<string, string> = {
  CP: 'Assemblaggio Componenti Elettronici',
  CG: 'Controllo Qualità',
  BF: 'Burattatura e Finitura',
  MAG: 'Magazzino',
  Collaudo: 'Collaudo e Test Funzionali',
  Officina: 'Officina',
  'N/D': 'Non Definito',
};
