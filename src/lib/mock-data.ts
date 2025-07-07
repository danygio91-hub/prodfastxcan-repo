
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
  type?: 'preparation' | 'production';
  requiresMaterialScan?: boolean;
  materialConsumption?: MaterialConsumption | null;
}

export interface JobOrder {
  id:string;
  cliente: string;
  qta: number;
  department: string;
  details: string;
  ordinePF: string;
  numeroODL: string;
  dataConsegnaFinale: string;
  postazioneLavoro: string;
  phases: JobPhase[];
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
  isProblemReported?: boolean;
  status: 'planned' | 'production' | 'completed' | 'suspended';
  workCycleId?: string;
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
  type: 'preparation' | 'production';
  requiresMaterialScan?: boolean;
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
  quantityUnits: number; // Can be pieces or meters
  weightKg: number;
}

export interface RawMaterial {
  id: string; //firestore doc id
  type: 'BOB' | 'TUBI' | 'PF3V0' | 'GUAINA';
  code: string; // a unique code, from QR
  code_normalized?: string; // for case-insensitive search
  description: string;
  details: {
    sezione?: string;
    filo_el?: string;
    larghezza?: string;
    tipologia?: string;
  };
  // New UoM fields
  unitOfMeasure: 'pz' | 'mt' | 'kg';
  conversionFactor?: number | null;

  // Stock properties are now calculated from batches
  currentWeightKg: number;
  currentStockUnits: number;

  batches: RawMaterialBatch[]; // Array of received batches
}


export interface MaterialWithdrawal {
  id: string; // doc id
  jobIds: string[];
  jobOrderPFs: string[];
  materialId: string;
  materialCode: string;
  consumedWeight: number;
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
    { id: 'phase-template-1', name: 'Preparazione Componenti', description: 'Raccolta e preparazione dei componenti necessari per l\'assemblaggio.', departmentCodes: ['CP'], sequence: -1, type: 'preparation', requiresMaterialScan: true },
    { id: 'phase-template-6', name: 'TAGLIO GUAINA', description: 'Taglio a misura della guaina termorestringente.', departmentCodes: ['CP'], sequence: -2, type: 'preparation', requiresMaterialScan: true },
    { id: 'phase-template-2', name: 'Assemblaggio Scheda', description: 'Montaggio dei componenti sulla scheda elettronica.', departmentCodes: ['CP'], sequence: 1, type: 'production', requiresMaterialScan: false },
    { id: 'phase-template-3', name: 'Saldatura', description: 'Processo di saldatura manuale o automatica.', departmentCodes: ['CP'], sequence: 2, type: 'production', requiresMaterialScan: false },
    { id: 'phase-template-4', name: 'Test Funzionale', description: 'Verifica del corretto funzionamento della scheda assemblata.', departmentCodes: ['CG'], sequence: 3, type: 'production', requiresMaterialScan: false },
    { id: 'phase-template-5', name: 'Ispezione Visiva', description: 'Controllo visivo della qualità delle saldature e del montaggio.', departmentCodes: ['CG'], sequence: 4, type: 'production', requiresMaterialScan: false },
];
export const initialWorkstations: Workstation[] = [
    { id: 'ws-1', name: 'Banco Assemblaggio 01', departmentCode: 'CP' },
    { id: 'ws-2', name: 'Stazione Saldatura A', departmentCode: 'CP' },
    { id: 'ws-3', name: 'Banco Test Qualità 01', departmentCode: 'CG' },
    { id: 'ws-4', name: 'Postazione Finitura Manuale', departmentCode: 'BF' },
];
