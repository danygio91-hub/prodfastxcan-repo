// src/lib/mock-data.ts

// Definizioni delle interfacce trasferite da scan-job/page.tsx
export interface WorkPeriod {
  start: Date;
  end: Date | null;
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
  id: string; // Questo sarà uguale a ordinePF
  cliente: string;
  qta: number;
  department: string;
  details: string; // Corrisponde a 'Codice'
  ordinePF: string;
  numeroODL: string; // Corrisponde a 'Ordine Nr Est'
  dataConsegnaFinale: string; // Formato YYYY-MM-DD, Corrisponde a 'Consegna prevista'
  postazioneLavoro: string;
  phases: JobPhase[];
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
  isProblemReported?: boolean;
  status: 'planned' | 'production';
}

// Nuova interfaccia per l'operatore
export type Reparto = 'CP' | 'CG' | 'BF' | 'MAG' | 'N/D';
export type StatoOperatore = 'attivo' | 'inattivo' | 'in pausa';
export type OperatorRole = 'admin' | 'superadvisor' | 'operator';

export interface Operator {
  id: string;
  nome: string;
  cognome: string;
  reparto: Reparto;
  stato: StatoOperatore;
  password?: string;
  role: OperatorRole;
}

export const departmentMap: { [key in Reparto]: string } = {
  CP: 'Assemblaggio Componenti Elettronici',
  CG: 'Controllo Qualità',
  BF: 'Burattatura e Finitura',
  MAG: 'Magazzino',
  'N/D': 'Non Definito',
};


// This is a simple in-memory store that mimics a database.
// It's designed to persist across hot reloads in development.
type GlobalWithMockData = typeof globalThis & {
  _jobOrders?: JobOrder[];
  _operators?: Operator[];
};

// Use a global variable to store the data, so it's not lost on hot reload
const a: GlobalWithMockData = globalThis;
if (!a._jobOrders) {
  a._jobOrders = [];
}
if (!a._operators) {
  a._operators = [
    { id: 'op-1', nome: 'Daniel', cognome: 'Rossi', reparto: 'CP', stato: 'inattivo', password: '1234', role: 'admin' },
    { id: 'op-2', nome: 'Ruben', cognome: 'Bianchi', reparto: 'CG', stato: 'inattivo', password: '1234', role: 'superadvisor' },
    { id: 'op-3', nome: 'Giovanna', cognome: 'Verdi', reparto: 'BF', stato: 'inattivo', password: '1234', role: 'operator' },
    { id: 'op-4', nome: 'Paola', cognome: 'Neri', reparto: 'MAG', stato: 'inattivo', password: '1234', role: 'operator' },
  ];
}


// Mock data per le commesse.
export const mockJobOrders: JobOrder[] = a._jobOrders;
export const mockOperators: Operator[] = a._operators;
