
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

// Mock data per le commesse. Ora è vuoto di default.
export const mockJobOrders: JobOrder[] = [];
