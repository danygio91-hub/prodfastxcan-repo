

// --- Type Definitions ---

export interface WorkPeriod {
  start: Date;
  end: Date | null;
  operatorId: string;
}

export interface MaterialConsumption {
  materialId: string;
  materialCode: string;
  openingWeight?: number;
  closingWeight?: number;
  pcs?: number;
  lottoBobina?: string;
}

export interface JobPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'paused' | 'completed';
  materialReady: boolean;
  workPeriods: WorkPeriod[];
  sequence: number;
  workstationScannedAndVerified?: boolean;
  type?: 'preparation' | 'production' | 'quality';
  requiresMaterialScan?: boolean;
  materialConsumption?: MaterialConsumption | null;
  allowedMaterialTypes?: Array<RawMaterialType>;
  qualityResult?: 'passed' | 'failed' | null;
  departmentCodes: Reparto[];
}

export interface JobOrder {
  id:string;
  cliente: string;
  qta: number;
  department: string;
  details: string;
  ordinePF: string;
  numeroODL: string; // This is Ordine Nr Est from the import
  dataConsegnaFinale: string;
  postazioneLavoro: string;
  phases: JobPhase[];
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
  isProblemReported?: boolean;
  status: 'planned' | 'production' | 'completed' | 'suspended';
  workCycleId?: string;
  // New fields for internal ODL number
  numeroODLInterno?: string;
  odlCounter?: number;
  odlCreationDate?: Date;
}

export type Reparto = 'CP' | 'CG' | 'BF' | 'MAG' | 'N/D' | 'Officina';
export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'superadvisor' | 'operator';

export const reparti: Reparto[] = ['CP', 'CG', 'BF', 'MAG', 'N/D', 'Officina'];
// Deprecated: This was too restrictive. Use `reparti` and filter as needed.
export const operatorReparti: Reparto[] = ['CP', 'CG', 'BF', 'MAG'];
export const roles: OperatorRole[] = ['admin', 'superadvisor', 'operator'];

export interface Operator {
  id: string;
  uid?: string;
  nome: string;
  cognome?: string;
  reparto: Reparto;
  stato: StatoOperatore;
  password?: string;
  role: OperatorRole;
  privacySigned?: boolean;
  nome_normalized?: string;
  email?: string;
}

export interface WorkPhaseTemplate {
  id: string;
  name: string;
  description: string;
  departmentCodes: Reparto[];
  sequence: number;
  type: 'preparation' | 'production' | 'quality';
  requiresMaterialScan?: boolean;
  allowedMaterialTypes?: Array<RawMaterialType>;
}

export interface Workstation {
  id: string;
  name: string;
  departmentCode: Reparto;
}

export interface RawMaterialBatch {
  id: string; // unique id for the batch
  date: string; // ISO string date
  ddt: string; // Documento di Trasporto
  quantity: number; // The quantity in the material's primary unitOfMeasure
  lotto?: string;
}

export type RawMaterialType = 'BOB' | 'TUBI' | 'PF3V0' | 'GUAINA';

export interface RawMaterial {
  id: string; //firestore doc id
  type: RawMaterialType;
  code: string; // a unique code, from QR
  code_normalized?: string; // for case-insensitive search
  description: string;
  details: {
    sezione?: string;
    filo_el?: string;
    larghezza?: string;
    tipologia?: string;
  };
  unitOfMeasure: 'n' | 'mt' | 'kg';
  conversionFactor?: number | null; // e.g. kg per unit (n or mt)
  currentStockUnits: number; // Stock in the primary unitOfMeasure (n, mt, or kg)
  currentWeightKg: number; // Stock always in KG, calculated or direct
  batches: RawMaterialBatch[]; // Array of received batches
  stock?: number; // Derived field for display, calculated from batches
}


export interface MaterialWithdrawal {
  id: string; // doc id
  jobIds: string[];
  jobOrderPFs: string[];
  materialId: string;
  materialCode: string;
  consumedWeight: number;
  consumedUnits?: number | null;
  operatorId: string;
  operatorName?: string;
  withdrawalDate: Date;
}

export interface WorkCycle {
    id: string;
    name: string;
    description: string;
    phaseTemplateIds: string[];
}

export type MaterialSessionCategory = 'TRECCIA' | 'TUBI' | 'GUAINA';
export interface ActiveMaterialSessionData {
    materialId: string;
    materialCode: string;
    openingWeight: number;
    originatorJobId: string;
    associatedJobs: { jobId: string; jobOrderPF: string }[];
    category: MaterialSessionCategory;
}

export interface NonConformityReport {
    id: string;
    materialId: string;
    materialCode: string;
    lotto: string;
    quantity: number; // The quantity of the NC material
    reason: string;
    notes?: string;
    operatorId: string;
    operatorName: string;
    reportDate: Date | string; // Allow string for serialized dates
    status: 'pending' | 'approved' | 'returned';
}

export interface ProductionProblemReport {
    id: string;
    jobId: string;
    jobOrderPF: string;
    phaseId: string;
    phaseName: string;
    problemType: 'FERMO_MACCHINA' | 'MANCA_MATERIALE' | 'PROBLEMA_QUALITA' | 'ALTRO';
    notes?: string;
    operatorId: string;
    operatorName: string;
    reportDate: Date;
    status: 'open' | 'resolved';
}


// --- Initial Data (for seeding the database on first run) ---
export const initialJobOrders: JobOrder[] = [];
export const initialOperators: Operator[] = [
    { id: 'op-1', nome: 'Daniel', cognome: 'Giorlando', reparto: 'N/D', stato: 'inattivo', password: 'Filapara.9!', role: 'admin', privacySigned: false, nome_normalized: 'daniel' },
    { id: 'op-2', nome: 'Ruben', reparto: 'Officina', stato: 'inattivo', password: '1234', role: 'superadvisor', privacySigned: false, nome_normalized: 'ruben' },
    { id: 'op-3', nome: 'Giovanna', reparto: 'BF', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false, nome_normalized: 'giovanna' },
    { id: 'op-4', nome: 'Paola', reparto: 'MAG', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false, nome_normalized: 'paola' },
];
export const initialDepartmentMap: { [key in Reparto]: string } = {
    CP: 'Assemblaggio Componenti Elettronici',
    CG: 'Controllo Qualità',
    BF: 'Burattatura e Finitura',
    MAG: 'Magazzino',
    'N/D': 'Non Definito',
    Officina: 'Officina',
};
export const initialWorkPhaseTemplates: WorkPhaseTemplate[] = [
    { id: 'phase-template-1', name: 'Taglio Treccia/Corda', description: 'Raccolta e preparazione di treccia e corda.', departmentCodes: ['MAG'], sequence: -3, type: 'preparation', requiresMaterialScan: true, allowedMaterialTypes: ['BOB', 'PF3V0'] },
    { id: 'phase-template-7', name: 'Preparazione Tubi', description: 'Preparazione dei tubi per la commessa.', departmentCodes: ['MAG'], sequence: -2, type: 'preparation', requiresMaterialScan: true, allowedMaterialTypes: ['TUBI'] },
    { id: 'phase-template-6', name: 'Taglio Guaina', description: 'Taglio a misura della guaina termorestringente.', departmentCodes: ['MAG'], sequence: -1, type: 'preparation', requiresMaterialScan: true, allowedMaterialTypes: ['GUAINA'] },
    { id: 'phase-template-2', name: 'Assemblaggio Scheda', description: 'Montaggio dei componenti sulla scheda elettronica.', departmentCodes: ['CP'], sequence: 1, type: 'production', requiresMaterialScan: false },
    { id: 'phase-template-3', name: 'Saldatura', description: 'Processo di saldatura manuale o automatica.', departmentCodes: ['CP'], sequence: 2, type: 'production', requiresMaterialScan: false },
    { id: 'phase-template-4', name: 'Test Funzionale', description: 'Verifica del corretto funzionamento della scheda assemblata.', departmentCodes: ['CG'], sequence: 3, type: 'quality', requiresMaterialScan: false },
    { id: 'phase-template-5', name: 'Ispezione Visiva', description: 'Controllo visivo della qualità delle saldature e del montaggio.', departmentCodes: ['CG'], sequence: 4, type: 'quality', requiresMaterialScan: false },
];
export const initialWorkstations: Workstation[] = [
    { id: 'ws-1', name: 'Banco Assemblaggio 01', departmentCode: 'CP' },
    { id: 'ws-2', name: 'Stazione Saldatura A', departmentCode: 'CP' },
    { id: 'ws-3', name: 'Banco Test Qualità 01', departmentCode: 'CG' },
    { id: 'ws-4', name: 'Postazione Finitura Manuale', departmentCode: 'BF' },
];
