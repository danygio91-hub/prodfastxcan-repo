
import { Timestamp } from 'firebase/firestore';

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

export interface WorkPhaseTemplate {
  id: string;
  name: string;
  description: string;
  departmentCodes: string[];
  sequence?: number;
  type: PhaseType;
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  requiresMaterialAssociation?: boolean;
  allowedMaterialTypes?: Array<string>;
  isIndependent?: boolean;
}

export interface Workstation {
  id: string;
  name: string;
  departmentCode: string;
}

export type RawMaterialType = string;

export interface WorkPeriod {
  start: Date | any; // Any for serializable versions
  end: Date | any | null;
  operatorId: string;
  reason?: string;
}

export interface MaterialConsumption {
  withdrawalId?: string;
  materialId: string;
  materialCode: string;
  grossOpeningWeight?: number;
  netOpeningWeight?: number;
  closingWeight?: number;
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
  materialStatus?: 'available' | 'missing';
  workPeriods: WorkPeriod[];
  sequence: number;
  workstationScannedAndVerified?: boolean;
  type?: PhaseType;
  tracksTime?: boolean;
  requiresMaterialScan?: boolean;
  requiresMaterialSearch?: boolean;
  requiresMaterialAssociation?: boolean;
  materialConsumptions: MaterialConsumption[];
  allowedMaterialTypes?: Array<string>;
  qualityResult?: 'passed' | 'failed' | null;
  departmentCodes: string[];
  forced?: boolean;
  postponed?: boolean;
  isIndependent?: boolean;
  pauseReason?: string;
  isSanatoria?: boolean;
  paper_tracked?: boolean;
}

export interface JobBillOfMaterialsItem {
  component: string;
  unit: UnitOfMeasure;
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
  numeroODL: string;
  dataConsegnaFinale: string;
  postazioneLavoro: string;
  phases: JobPhase[];
  overallStartTime?: Date | any | null;
  overallEndTime?: Date | any | null;
  isProblemReported?: boolean;
  problemType?: string;
  problemNotes?: string;
  problemReportedBy?: string;
  status: 'planned' | 'production' | 'completed' | 'suspended' | 'paused' | 'shipped';
  workCycleId?: string;
  billOfMaterials?: JobBillOfMaterialsItem[];
  numeroODLInterno?: string | null;
  odlCounter?: number;
  odlCreationDate?: Date | any;
  workGroupId?: string | null;
  forcedCompletion?: boolean;
  isSanatoria?: boolean;
  jobOrderIds?: string[];
  jobOrderPFs?: string[];
  isPrinted?: boolean;
  assignedDate?: string;
  isPriority?: boolean;
  sortIndex?: number;
  isCarryover?: boolean;
  attachments?: { name: string, url: string }[];
  actualWeightKg?: number;
  numberOfPackages?: number;
}

export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'supervisor' | 'operator';

export interface OperatorSkill {
  phaseId: string;
  isHardSkill: boolean;
  efficiencyPercent: number;
}

export interface Operator {
  id: string;
  uid?: string;
  nome: string;
  reparto: string[];
  stato: StatoOperatore;
  password?: string;
  role: OperatorRole;
  privacySigned?: boolean;
  privacyVersion?: number;
  nome_normalized?: string;
  email?: string;
  canAccessInventory?: boolean;
  canAccessMaterialWithdrawal?: boolean;
  isReal?: boolean;
  activeJobId?: string | null;
  activePhaseName?: string | null;
  syncPulse?: number;
  activeMaterialSessions?: ActiveMaterialSessionData[];
  skills?: OperatorSkill[];
}

export interface OperatorAssignment {
  id: string;
  operatorId: string;
  departmentCode: string;
  startDate: string;
  endDate: string;
  type: 'base' | 'loan';
  notes?: string;
  createdAt?: string;
}

export interface RawMaterialBatch {
  id: string;
  inventoryRecordId?: string;
  date: string;
  ddt: string;
  netQuantity: number;
  grossWeight: number;
  tareWeight: number;
  tareName?: string;
  packagingId?: string;
  lotto?: string | null;
  purchaseOrderId?: string;
  isExhausted?: boolean;
}

export interface RawMaterial {
  id: string;
  type: string;
  code: string;
  code_normalized?: string;
  description: string;
  details: {
    sezione?: string;
    filo_el?: string;
    larghezza?: string;
    tipologia?: string;
  };
  unitOfMeasure: UnitOfMeasure;
  conversionFactor?: number | null;
  rapportoKgMt?: number | null;
  currentStockUnits: number;
  currentWeightKg: number;
  batches: RawMaterialBatch[];
  stock?: number;
  minStockLevel?: number;
  reorderLot?: number;
  leadTimeDays?: number;
}

export interface BillOfMaterialsItem {
  component: string;
  unit: UnitOfMeasure;
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
  workCycleId?: string;
  secondaryWorkCycleId?: string;
  expectedMinutesDefault?: number;
  expectedMinutesSecondary?: number;
  attachments?: { name: string, url: string }[];
  packagingType?: string;
  packingInstructions?: string;
  unitWeightKg?: number;
  packagingTareWeightKg?: number;
}

export interface WorkGroup {
  id: string;
  jobOrderIds: string[];
  jobOrderPFs: string[];
  status: 'production' | 'paused' | 'completed' | 'suspended';
  createdAt: Date | any;
  createdBy: string;
  totalQuantity: number;
  workCycleId: string;
  department: string;
  cliente: string;
  phases: JobPhase[];
  details: string;
  numeroODLInterno?: string;
  numeroODL?: string;
  dataConsegnaFinale?: string;
  isProblemReported?: boolean;
  problemType?: string;
  problemNotes?: string;
  problemReportedBy?: string;
  overallStartTime?: Date | any | null;
  overallEndTime?: Date | any | null;
  qta?: number;
  ordinePF?: string;
  forcedCompletion?: boolean;
  isSanatoria?: boolean;
}

export interface WorkingShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export interface WorkingHoursConfig {
  workingDays: number[];
  shifts: WorkingShift[];
  efficiencyPercentage: number;
}

export interface ProductionSettings {
  capacityBufferPercent: number;
  autoUpdateGanttIntervalHours: number;
  prioritizeActualTime: boolean;
}

export type OverallStatus = 'Da Iniziare' | 'In Preparazione' | 'Pronto per Produzione' | 'In Lavorazione' | 'Completata' | 'Problema' | 'Sospesa' | 'Pronto per Finitura' | 'Manca Materiale';

export interface ManualCommitment {
  id: string;
  jobOrderCode: string;
  articleCode: string;
  quantity: number;
  deliveryDate: string; // ISO Date String
  status: 'pending' | 'fulfilled' | 'cancelled' | 'cancelled_sanatoria';
  createdAt: any; // Firestore Timestamp
  fulfilledAt?: any; // Firestore Timestamp
  fulfilledBy?: string; // Operator UID
  cancelledAt?: any; // Firestore Timestamp
  cancellationReason?: string;
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

export interface MaterialWithdrawal {
  id: string;
  jobIds: string[];
  jobOrderPFs: string[];
  materialId: string;
  materialCode: string;
  consumedWeight: number;
  consumedUnits?: number | null;
  operatorId: string;
  operatorName?: string;
  withdrawalDate: Date | any;
  notes?: string;
  lotto?: string | null;
  commitmentId?: string;
  isDeclared?: boolean;
  declaredAt?: string;
}

export type ProductionProblemType = string;

export interface WorkCycle {
  id: string;
  name: string;
  description: string;
  phaseTemplateIds: string[];
}

export type MaterialSessionCategory = string;

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
  quantity: number;
  reason: string;
  notes?: string;
  operatorId: string;
  operatorName: string;
  reportDate: Date | string;
  status: 'pending' | 'approved' | 'returned';
}

export interface ProductionProblemReport {
  id: string;
  jobId: string;
  jobOrderPF: string;
  phaseId: string;
  phaseName: string;
  problemType: string;
  notes?: string;
  operatorId: string;
  operatorName: string;
  reportDate: Date | string;
  status: 'open' | 'resolved';
  resolvedAt?: Date | string;
  resolvedBy?: string;
  isSanatoria?: boolean;
}

export interface InventoryRecord {
  id: string;
  materialId: string;
  materialCode: string;
  lotto: string;
  grossWeight: number;
  tareWeight: number;
  tareName?: string;
  netWeight: number;
  packagingId?: string;
  operatorId: string;
  operatorName: string;
  recordedAt: Date | any;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date | any;
  inputUnit: UnitOfMeasure;
  inputQuantity: number;
  conversionFactor?: number;
  rapportoKgMt?: number;
  materialUnitOfMeasure?: UnitOfMeasure;
}

export interface ScrapRecord {
  id: string;
  commitmentId: string;
  jobOrderCode: string;
  articleCode: string;
  materialId: string;
  materialCode: string;
  scrappedQuantity: number;
  scrappedWeightKg: number;
  declaredAt: any;
  operatorId: string;
  operatorName: string;
}

export interface CalendarException {
  id: string;
  resourceType: 'operator' | 'machine' | 'company';
  targetId: string;
  targetName: string;
  exceptionType: 'sick' | 'vacation' | 'permit' | 'maintenance' | 'other';
  startDate: string;
  endDate: string;
  hoursLost?: number;
  notes?: string;
  createdAt: any;
  createdBy: string;
}

export type PackagingAssociation = string | 'PRODOTTO';

export interface Packaging {
  id: string;
  name: string;
  description?: string;
  weightKg: number;
  associatedTypes?: PackagingAssociation[];
}

export interface ProductionTimeData {
    estimatedTotalMinutes: number;
    detectedTotalMinutes: number;
    efficiency: number;
    remainingMinutes: number;
    isIpothesis: boolean;
}
