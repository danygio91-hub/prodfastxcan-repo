
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

// This is a simple in-memory store that mimics a database.
// It's designed to persist across hot reloads in development.
type GlobalWithJobOrders = typeof globalThis & {
  _jobOrders?: JobOrder[];
};

// Use a global variable to store the data, so it's not lost on hot reload
const a: GlobalWithJobOrders = globalThis;
if (!a._jobOrders) {
  a._jobOrders = [];
}

// Mock data per le commesse.
export const mockJobOrders: JobOrder[] = a._jobOrders;
