export type UnitOfMeasure = 'n' | 'mt' | 'kg';
export type PhaseType = 'preparation' | 'production' | 'quality' | 'packaging';
export type MacroArea = 'PREPARAZIONE' | 'PRODUZIONE' | 'QLTY_PACK';

export interface Department {
  id: string;
  code: string;
  name: string;
  macroAreas: MacroArea[];
  dependsOnPreparation?: boolean;
}

export interface WorkPeriod {
  start: Date;
  end: Date | null;
  operatorId: string;
}

export interface MaterialConsumption {
  withdrawalId?: string; // ID of the corresponding withdrawal document
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
  materialStatus?: 'available' | 'missing'; // New field for specific material status
  workPeriods: WorkPeriod[];
  sequence: number;
  workstationScannedAndVerified?: boolean;
  type?: PhaseType;
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  requiresMaterialAssociation?: boolean; // New field for optional material association
  materialConsumptions: MaterialConsumption[];
  allowedMaterialTypes?: Array<RawMaterialType>;
  qualityResult?: 'passed' | 'failed' | null;
  departmentCodes: string[];
  forced?: boolean;
  postponed?: boolean;
  isIndependent?: boolean; // New field
}

export interface JobBillOfMaterialsItem {
  component: string;
  unit: UnitOfMeasure; // 'n' | 'mt' | 'kg' (configurable)
  quantity: number;
  lunghezzaTaglioMm?: number;
  note?: string;
  status: 'pending' | 'committed' | 'withdrawn';
  isFromTemplate: boolean;
}

export interface JobOrder {
  id: string;
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
  problemType?: string; // 'FERMO_MACCHINA' | 'MANCA_MATERIALE' | etc.
  problemNotes?: string;
  problemReportedBy?: string;
  status: 'planned' | 'production' | 'completed' | 'suspended' | 'paused';
  workCycleId?: string;
  billOfMaterials?: JobBillOfMaterialsItem[];
  // New fields for internal ODL number
  numeroODLInterno?: string | null;
  odlCounter?: number;
  odlCreationDate?: Date;
  // New field for job chaining
  workGroupId?: string | null;
  forcedCompletion?: boolean; // New flag for forced closures
  // --- Fields for synthetic group object ---
  jobOrderIds?: string[];
  jobOrderPFs?: string[];
  isPrinted?: boolean; // New field for print tracking
  assignedDate?: string; // New field for Kanban planning (format: YYYY-MM-DD or 'unassigned')
  isPriority?: boolean; // New field for urgent prioritizing
}

export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'supervisor' | 'operator';

export const roles: OperatorRole[] = ['admin', 'supervisor', 'operator'];

export interface OperatorSkill {
  phaseId: string;
  isHardSkill: boolean; // True se è la sua mansione naturale (100% eff), False se è un "tappabuchi" Soft
  efficiencyPercent: number; // % di rendimento (es. 100, 80, 50) utilizzata dal Gantt
}

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
  canAccessInventory?: boolean; // New privilege for inventory access
  canAccessMaterialWithdrawal?: boolean; // New privilege for manual withdrawal
  isReal?: boolean; // Flag to indicate if the operator is an actual worker for capacity calculation
  // Fields to track active state across devices
  activeJobId?: string | null;
  activePhaseName?: string | null;
  syncPulse?: number;
  activeMaterialSessions?: ActiveMaterialSessionData[];
  skills?: OperatorSkill[]; // Matrice Competenze associata
}

export interface OperatorAssignment {
  id: string;
  operatorId: string;
  departmentCode: string; // Il reparto a cui l'operatore è assegnato/prestato
  startDate: string;      // ISO Date
  endDate: string;
  type: 'base' | 'loan';   // 'base' = normale, 'loan' = prestito
  notes?: string;
  createdAt?: string;
}

export interface WorkPhaseTemplate {
  id: string;
  name: string;
  description: string;
  departmentCodes: string[];
  sequence?: number;

  type: PhaseType; // 'preparation' | 'production' | etc.
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  requiresMaterialAssociation?: boolean; // New field for optional material association
  allowedMaterialTypes?: Array<RawMaterialType>;
  isIndependent?: boolean; // New field
}

export interface Workstation {
  id: string;
  name: string;
  departmentCode: string;
}

export type RawMaterialType = string;
export const RawMaterialTypeValues: RawMaterialType[] = ['BOB', 'TUBI', 'PF3V0', 'GUAINA', 'BARRA'];
export type PackagingAssociation = string | 'PRODOTTO';

export interface Packaging {
  id: string;
  name: string;
  description?: string;
  weightKg: number;
  associatedTypes?: PackagingAssociation[];
}

export interface RawMaterialBatch {
  id: string; // unique id for the batch
  inventoryRecordId?: string; // ID of the original inventory record
  date: string; // ISO string date
  ddt: string; // Documento di Trasporto
  netQuantity: number; // Net quantity from DDT or manual input
  grossWeight: number; // Net + Tare, what's on the scale
  tareWeight: number;
  packagingId?: string;
  lotto?: string | null;
  purchaseOrderId?: string; // Link to the PO if received via PO flow
}



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
  unitOfMeasure: UnitOfMeasure; // 'n' | 'mt' | 'kg'
  conversionFactor?: number | null; // e.g. kg per unit (n or mt)
  rapportoKgMt?: number | null; // e.g. kg per meter, used for cutting calculations
  currentStockUnits: number; // Stock in the primary unitOfMeasure (n, mt, or kg)
  currentWeightKg: number; // Stock always in KG, calculated or direct
  batches: RawMaterialBatch[]; // Array of received batches
  stock?: number; // Derived field for display, calculated from batches
  minStockLevel?: number; // Sottoscorta
  reorderLot?: number; // Quantità fissa / Lotto economico di riordino
  leadTimeDays?: number; // Tempo di approvvigionamento (giorni)
}

export interface BillOfMaterialsItem {
  component: string;
  unit: UnitOfMeasure; // 'n' | 'mt' | 'kg'
  quantity: number;
  lunghezzaTaglioMm?: number;
  note?: string;
}

export interface ArticlePhaseTime {
  expectedMinutesPerPiece: number;
  detectedMinutesPerPiece: number;
  enabled?: boolean;
}

export interface Article {
  id: string;
  code: string;
  billOfMaterials: BillOfMaterialsItem[];
  phaseTimes?: Record<string, ArticlePhaseTime>;
  phaseTimesSecondary?: Record<string, ArticlePhaseTime>;
  workCycleId?: string; // Predefinito
  secondaryWorkCycleId?: string; // Secondario
  expectedMinutesDefault?: number; // Tempo previsto totale ciclo predefinito
  expectedMinutesSecondary?: number; // Tempo previsto totale ciclo secondario
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
  notes?: string; // Optional field for manual withdrawals
  lotto?: string | null;
  commitmentId?: string; // Link to the manual commitment if applicable
  isDeclared?: boolean;
  declaredAt?: string; // ISO string
}


export interface WorkCycle {
  id: string;
  name: string;
  description: string;
  phaseTemplateIds: string[];
}

export type MaterialSessionCategory = string; // 'TRECCIA' | 'TUBI' | 'GUAINA'
export interface ActiveMaterialSessionData {
  materialId: string;
  materialCode: string;
  grossOpeningWeight: number;
  netOpeningWeight: number;
  originatorJobId: string | null;
  associatedJobs: { jobId: string; jobOrderPF: string }[];

  category: MaterialSessionCategory;
  packagingId?: string;
  tareWeight?: number;
  lotto?: string | null;
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

export type ProductionProblemType = string; // 'FERMO_MACCHINA' | 'MANCA_MATERIALE' | etc.

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
  forcedCompletion?: boolean; // New flag for forced closures
}

export interface InventoryRecord {
  id: string;
  materialId: string;
  materialCode: string;
  lotto: string;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  packagingId?: string;
  operatorId: string;
  operatorName: string;
  recordedAt: Date | any; // Can be a Timestamp
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date | any;
  inputUnit: UnitOfMeasure;
  inputQuantity: number;
  conversionFactor?: number;
  materialUnitOfMeasure?: UnitOfMeasure;
}

export interface ManualCommitment {
  id: string;
  jobOrderCode: string;
  articleCode: string;
  quantity: number;
  deliveryDate: string; // ISO Date String
  status: 'pending' | 'fulfilled';
  createdAt: any; // Firestore Timestamp
  fulfilledAt?: any; // Firestore Timestamp
  fulfilledBy?: string; // Operator UID
}

export interface ScrapRecord {
  id: string;
  commitmentId: string;
  jobOrderCode: string;
  articleCode: string;
  materialId: string;
  materialCode: string;
  scrappedQuantity: number; // in pieces of the article component
  scrappedWeightKg: number; // total weight of raw material scrapped for these pieces
  declaredAt: any; // Timestamp
  operatorId: string;
  operatorName: string;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierName: string;
  materialCode: string;
  quantity: number;
  receivedQuantity?: number; // Tracks how much has been loaded
  unitOfMeasure: UnitOfMeasure; // 'n' | 'mt' | 'kg'
  expectedDeliveryDate: string; // ISO string
  status: 'pending' | 'received' | 'partially_received' | 'cancelled';
  createdAt: any; // Timestamp
  notes?: string;
}

export interface WorkingShift {
  id: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  breakMinutes: number; // Nuova campo: Pausa in minuti
}

export interface WorkingHoursConfig {
  workingDays: number[]; // 1=Mon, ..., 7=Sun
  shifts: WorkingShift[];
  efficiencyPercentage: number; // Nuova campo: Efficienza / Pause fisiologiche
}

export interface CalendarException {
  id: string;
  resourceType: 'operator' | 'machine' | 'company';
  targetId: string; // operatorId or workstationId
  targetName: string;
  exceptionType: 'sick' | 'vacation' | 'permit' | 'maintenance' | 'other';
  startDate: string; // ISO Date
  endDate: string; // ISO Date
  hoursLost?: number; // per partial days
  notes?: string;
  createdAt: any;
  createdBy: string;
}


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
