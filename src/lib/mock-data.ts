

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

// --- Initial Data (for seeding the database on first run) ---
export const initialJobOrders: JobOrder[] = [];
export const initialOperators: Operator[] = [
    { id: 'op-1', nome: 'Daniel', cognome: 'Rossi', reparto: 'N/D', stato: 'inattivo', password: '1234', role: 'admin', privacySigned: false },
    { id: 'op-2', nome: 'Ruben', cognome: 'Bianchi', reparto: 'Officina', stato: 'inattivo', password: '1234', role: 'superadvisor', privacySigned: true },
    { id: 'op-3', nome: 'Giovanna', cognome: 'Verdi', reparto: 'BF', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false },
    { id: 'op-4', nome: 'Paola', cognome: 'Neri', reparto: 'MAG', stato: 'inattivo', password: '1234', role: 'operator', privacySigned: false },
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
    { id: 'phase-template-1', name: 'Preparazione Componenti', description: 'Raccolta e preparazione dei componenti necessari per l\'assemblaggio.', departmentCode: 'CP' },
    { id: 'phase-template-2', name: 'Assemblaggio Scheda', description: 'Montaggio dei componenti sulla scheda elettronica.', departmentCode: 'CP' },
    { id: 'phase-template-3', name: 'Saldatura', description: 'Processo di saldatura manuale o automatica.', departmentCode: 'CP' },
    { id: 'phase-template-4', name: 'Test Funzionale', description: 'Verifica del corretto funzionamento della scheda assemblata.', departmentCode: 'CG' },
    { id: 'phase-template-5', name: 'Ispezione Visiva', description: 'Controllo visivo della qualità delle saldature e del montaggio.', departmentCode: 'CG' },
];
export const initialWorkstations: Workstation[] = [
    { id: 'ws-1', name: 'Banco Assemblaggio 01', departmentCode: 'CP' },
    { id: 'ws-2', name: 'Stazione Saldatura A', departmentCode: 'CP' },
    { id: 'ws-3', name: 'Banco Test Qualità 01', departmentCode: 'CG' },
    { id: 'ws-4', name: 'Postazione Finitura Manuale', departmentCode: 'BF' },
];
