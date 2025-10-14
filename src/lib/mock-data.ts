

// --- Type Definitions ---

export interface Department {
  id: string;
  code: string;
  name: string;
}

export interface WorkPeriod {
  start: Date;
  end: Date | null;
  operatorId: string;
}

export interface MaterialConsumption {
  materialId: string;
  materialCode: string;
  grossOpeningWeight?: number; // Peso lordo all'apertura della sessione
  netOpeningWeight?: number; // Peso netto calcolato
  closingWeight?: number; // Peso lordo alla chiusura
  pcs?: number;
  lottoBobina?: string;
  packagingId?: string;
  tareWeight?: number;
}

export interface JobPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'paused' | 'completed' | 'skipped';
  materialReady: boolean;
  workPeriods: WorkPeriod[];
  sequence: number;
  workstationScannedAndVerified?: boolean;
  type?: 'preparation' | 'production' | 'quality' | 'packaging';
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  materialConsumptions: MaterialConsumption[];
  allowedMaterialTypes?: Array<RawMaterialType>;
  qualityResult?: 'passed' | 'failed' | null;
  departmentCodes: string[];
  forced?: boolean;
  postponed?: boolean;
  isIndependent?: boolean; // New field
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
  problemType?: 'FERMO_MACCHINA' | 'MANCA_MATERIALE' | 'PROBLEMA_QUALITA' | 'ALTRO';
  problemNotes?: string;
  problemReportedBy?: string;
  status: 'planned' | 'production' | 'completed' | 'suspended' | 'paused';
  workCycleId?: string;
  // New fields for internal ODL number
  numeroODLInterno?: string | null;
  odlCounter?: number;
  odlCreationDate?: Date;
  // New field for job chaining
  workGroupId?: string | null;
}

export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'supervisor' | 'operator';

export const roles: OperatorRole[] = ['admin', 'supervisor', 'operator'];

export interface Operator {
  id: string;
  uid?: string;
  nome: string;
  reparto: string[]; // Department codes
  stato: StatoOperatore;
  password?: string;
  role: OperatorRole;
  privacySigned?: boolean;
  privacyVersion?: number; // Timestamp of the signed policy
  nome_normalized?: string;
  email?: string;
}

export interface WorkPhaseTemplate {
  id: string;
  name: string;
  description: string;
  departmentCodes: string[];
  sequence: number;
  type: 'preparation' | 'production' | 'quality' | 'packaging';
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  allowedMaterialTypes?: Array<RawMaterialType>;
  isIndependent?: boolean; // New field
}

export interface Workstation {
  id: string;
  name: string;
  departmentCode: string;
}

export type PackagingAssociation = RawMaterialType | 'PRODOTTO';

export interface Packaging {
  id: string;
  name: string;
  description?: string;
  weightKg: number;
  associatedTypes?: PackagingAssociation[];
}

export interface RawMaterialBatch {
  id: string; // unique id for the batch
  date: string; // ISO string date
  ddt: string; // Documento di Trasporto
  netQuantity: number; // Net quantity from DDT or manual input
  grossWeight: number; // Net + Tare, what's on the scale
  tareWeight: number;
  packagingId?: string;
  lotto?: string | null;
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
    grossOpeningWeight: number;
    netOpeningWeight: number;
    originatorJobId: string;
    associatedJobs: { jobId: string; jobOrderPF: string }[];
    category: MaterialSessionCategory;
    packagingId?: string;
    tareWeight?: number;
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

export type ProductionProblemType = 'FERMO_MACCHINA' | 'MANCA_MATERIALE' | 'PROBLEMA_QUALITA' | 'ALTRO';

export interface ProductionProblemReport {
    id: string;
    jobId: string;
    jobOrderPF: string;
    phaseId: string;
    phaseName: string;
    problemType: ProductionProblemType,
    notes?: string;
    operatorId: string;
    operatorName: string;
    reportDate: Date | string;
    status: 'open' | 'resolved';
    resolvedAt?: Date | string;
    resolvedBy?: string;
}

export interface WorkGroup {
    id: string;
    jobOrderIds: string[];
    jobOrderPFs: string[];
    status: 'production' | 'paused' | 'completed' | 'suspended';
    createdAt: Date;
    createdBy: string;
    totalQuantity: number;
    workCycleId: string;
    department: string;
    cliente: string;
    phases: JobPhase[];
    details: string; // e.g., "Lavorazione Multi-Commessa"
    // Aggregated fields for display
    numeroODLInterno?: string;
    numeroODL?: string;
    dataConsegnaFinale?: string;
    isProblemReported?: boolean;
    problemType?: ProductionProblemType;
    problemNotes?: string;
    problemReportedBy?: string;
    overallStartTime?: Date | null;
    overallEndTime?: Date | null;
    qta?: number; // Alias for totalQuantity
    ordinePF?: string; // Alias for jobOrderPFs joined
}


// --- Initial Data (for seeding the database on first run) ---
export const initialJobOrders: JobOrder[] = [];
export const initialOperators: Operator[] = [
    { id: 'op-1', nome: 'Daniel', reparto: [], stato: 'inattivo', role: 'admin', privacySigned: false, nome_normalized: 'daniel' },
    { id: 'op-2', nome: 'Ruben', reparto: [], stato: 'inattivo', role: 'supervisor', privacySigned: false, nome_normalized: 'ruben' },
    { id: 'op-3', nome: 'Giovanna', reparto: ['BF'], stato: 'inattivo', role: 'operator', privacySigned: false, nome_normalized: 'giovanna' },
    { id: 'op-4', nome: 'Paola', reparto: ['MAG'], stato: 'inattivo', role: 'operator', privacySigned: false, nome_normalized: 'paola' },
];
export const initialDepartments: Department[] = [
    { id: 'CP', code: 'CP', name: 'Assemblaggio Componenti Elettronici' },
    { id: 'CG', code: 'CG', name: 'Controllo Qualità' },
    { id: 'BF', code: 'BF', name: 'Burattatura e Finitura' },
    { id: 'MAG', code: 'MAG', name: 'Magazzino' },
    { id: 'Collaudo', code: 'Collaudo', name: 'Collaudo e Test Funzionali' },
    { id: 'Officina', code: 'Officina', name: 'Officina' },
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
