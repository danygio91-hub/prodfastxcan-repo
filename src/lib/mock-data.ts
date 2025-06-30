
'use server';
import fs from 'fs/promises';
import path from 'path';

// --- Type Definitions ---

export interface WorkPeriod {
  start: Date;
  end: Date | null;
  operatorId: string;
}

export interface JobPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'paused' | 'completed';
  materialReady: boolean;
  workPeriods: WorkPeriod[];
  sequence: number;
  workstationScannedAndVerified?: boolean;
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
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
  isProblemReported?: boolean;
  status: 'planned' | 'production' | 'completed';
}

export type Reparto = 'CP' | 'CG' | 'BF' | 'MAG' | 'N/D' | 'Officina';
export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'superadvisor' | 'operator';

export const reparti: Reparto[] = ['CP', 'CG', 'BF', 'MAG', 'N/D', 'Officina'];
export const operatorReparti: Reparto[] = ['CP', 'CG', 'BF', 'MAG'];
export const roles: OperatorRole[] = ['admin', 'superadvisor', 'operator'];

export interface Operator {
  id: string;
  nome: string;
  cognome: string;
  reparto: Reparto;
  stato: StatoOperatore;
  password?: string;
  role: OperatorRole;
  privacySigned?: boolean;
}

export interface WorkPhaseTemplate {
  id: string;
  name: string;
  description: string;
  departmentCode: Reparto;
}

export interface Workstation {
  id: string;
  name: string;
  departmentCode: Reparto;
}

// --- Database File Paths ---
const DB_DIR = path.join(process.cwd(), 'db');
const JOB_ORDERS_FILE = path.join(DB_DIR, 'jobOrders.json');
const OPERATORS_FILE = path.join(DB_DIR, 'operators.json');
const DEPARTMENT_MAP_FILE = path.join(DB_DIR, 'departmentMap.json');
const WORK_PHASE_TEMPLATES_FILE = path.join(DB_DIR, 'workPhaseTemplates.json');
const WORKSTATIONS_FILE = path.join(DB_DIR, 'workstations.json');

// --- Initial Data (for first run) ---
const initialJobOrders: JobOrder[] = [];
const initialOperators: Operator[] = [
    { id: 'op-1', nome: 'Daniel', cognome: 'Rossi', reparto: 'N/D', stato: 'inattivo', password: '1234', role: 'admin', privacySigned: false },
    { id: 'op-2', nome: 'Ruben', cognome: 'Bianchi', reparto: 'Officina', stato: 'inattivo', password: '1234', role: 'superadvisor', privacySigned: true },
    { id: 'op-3', nome: 'Giovanna', cognome: 'Verdi', reparto: 'BF', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false },
    { id: 'op-4', nome: 'Paola', cognome: 'Neri', reparto: 'MAG', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false },
];
const initialDepartmentMap: { [key in Reparto]: string } = {
    CP: 'Assemblaggio Componenti Elettronici',
    CG: 'Controllo Qualità',
    BF: 'Burattatura e Finitura',
    MAG: 'Magazzino',
    'N/D': 'Non Definito',
    Officina: 'Officina',
};
const initialWorkPhaseTemplates: WorkPhaseTemplate[] = [
    { id: 'phase-template-1', name: 'Preparazione Componenti', description: 'Raccolta e preparazione dei componenti necessari per l\'assemblaggio.', departmentCode: 'CP' },
    { id: 'phase-template-2', name: 'Assemblaggio Scheda', description: 'Montaggio dei componenti sulla scheda elettronica.', departmentCode: 'CP' },
    { id: 'phase-template-3', name: 'Saldatura', description: 'Processo di saldatura manuale o automatica.', departmentCode: 'CP' },
    { id: 'phase-template-4', name: 'Test Funzionale', description: 'Verifica del corretto funzionamento della scheda assemblata.', departmentCode: 'CG' },
    { id: 'phase-template-5', name: 'Ispezione Visiva', description: 'Controllo visivo della qualità delle saldature e del montaggio.', departmentCode: 'CG' },
];
const initialWorkstations: Workstation[] = [
    { id: 'ws-1', name: 'Banco Assemblaggio 01', departmentCode: 'CP' },
    { id: 'ws-2', name: 'Stazione Saldatura A', departmentCode: 'CP' },
    { id: 'ws-3', name: 'Banco Test Qualità 01', departmentCode: 'CG' },
    { id: 'ws-4', name: 'Postazione Finitura Manuale', departmentCode: 'BF' },
];


// --- Helper Functions to Read/Write JSON ---
const readData = async <T>(filePath: string, defaultData: T): Promise<T> => {
  try {
    await fs.access(DB_DIR);
  } catch {
    await fs.mkdir(DB_DIR, { recursive: true });
  }

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    // Safely parse JSON with a reviver for date strings
    return JSON.parse(fileContent, (key, value) => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      if (typeof value === 'string' && isoDateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
      return value;
    });
  } catch (error) {
    // If file doesn't exist or is invalid, write the default data and return it
    await writeData(filePath, defaultData);
    return defaultData;
  }
};

const writeData = async <T>(filePath: string, data: T): Promise<void> => {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// --- Data Accessor Functions ---
export const getJobOrdersStore = () => readData<JobOrder[]>(JOB_ORDERS_FILE, initialJobOrders);
export const saveJobOrdersStore = (data: JobOrder[]) => writeData(JOB_ORDERS_FILE, data);

export const getOperatorsStore = () => readData<Operator[]>(OPERATORS_FILE, initialOperators);
export const saveOperatorsStore = (data: Operator[]) => writeData(OPERATORS_FILE, data);

export const getDepartmentMapStore = () => readData<{ [key in Reparto]: string }>(DEPARTMENT_MAP_FILE, initialDepartmentMap);
export const saveDepartmentMapStore = (data: { [key in Reparto]: string }) => writeData(DEPARTMENT_MAP_FILE, data);

export const getWorkPhaseTemplatesStore = () => readData<WorkPhaseTemplate[]>(WORK_PHASE_TEMPLATES_FILE, initialWorkPhaseTemplates);
export const saveWorkPhaseTemplatesStore = (data: WorkPhaseTemplate[]) => writeData(WORK_PHASE_TEMPLATES_FILE, data);

export const getWorkstationsStore = () => readData<Workstation[]>(WORKSTATIONS_FILE, initialWorkstations);
export const saveWorkstationsStore = (data: Workstation[]) => writeData(WORKSTATIONS_FILE, data);
