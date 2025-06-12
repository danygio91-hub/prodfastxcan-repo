
// src/lib/mock-data.ts
"use client";

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
  department: string;
  details: string;
  ordinePF: string;
  numeroODL: string;
  dataConsegnaFinale: string; // Formato YYYY-MM-DD
  postazioneLavoro: string;
  phases: JobPhase[];
  overallStartTime?: Date | null;
  overallEndTime?: Date | null;
}

// Mock data per le commesse
export const mockJobOrders: JobOrder[] = [
  {
    id: "PF-001", // ID = ordinePF
    department: "Assemblaggio Componenti Elettronici",
    details: "Assemblaggio scheda madre per Prodotto X.",
    ordinePF: "PF-001",
    numeroODL: "ODL-789",
    dataConsegnaFinale: "2024-12-15",
    postazioneLavoro: "Postazione A-05",
    phases: [
      { id: "phase1-1", name: "Preparazione Componenti", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: "phase1-2", name: "Montaggio su PCB", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: "phase1-3", name: "Saldatura", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
      { id: "phase1-4", name: "Controllo Visivo Iniziale", status: 'pending', materialReady: false, workPeriods: [], sequence: 4, workstationScannedAndVerified: false },
    ]
  },
  {
    id: "PF-002", // ID = ordinePF
    department: "Controllo Qualità",
    details: "Verifica finale Prodotto Y.",
    ordinePF: "PF-002",
    numeroODL: "ODL-790",
    dataConsegnaFinale: "2024-11-30",
    postazioneLavoro: "Banco CQ-02",
    phases: [
      { id: "phase2-1", name: "Preparazione articoli commessa", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: "phase2-2", name: "Ispezione Estetica", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: "phase2-3", name: "Imballaggio Primario", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
    ]
  },
  {
    id: "PF-003", // ID = ordinePF
    department: "Assemblaggio Componenti Elettronici",
    details: "Cablaggio unità di alimentazione per Prodotto Z.",
    ordinePF: "PF-003",
    numeroODL: "ODL-791",
    dataConsegnaFinale: "2025-01-10",
    postazioneLavoro: "Postazione B-01",
    phases: [
      { id: "phase3-1", name: "Taglio Cavi", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: "phase3-2", name: "Crimpatura Connettori", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: "phase3-3", name: "Assemblaggio Cablaggio", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
    ]
  },
  {
    id: "PF-004", // ID = ordinePF
    department: "Assemblaggio Componenti Elettronici",
    details: "Assemblaggio pannello frontale per Prodotto Alpha.",
    ordinePF: "PF-004",
    numeroODL: "ODL-792",
    dataConsegnaFinale: "2025-02-20",
    postazioneLavoro: "Postazione A-02",
    phases: [
      { id: "phase4-1", name: "Installazione Display", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: "phase4-2", name: "Collegamento Pulsanti", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
    ]
  },
  {
    id: "PF-005", // ID = ordinePF
    department: "Controllo Qualità",
    details: "Test di burn-in per Prodotto Beta.",
    ordinePF: "PF-005",
    numeroODL: "ODL-793",
    dataConsegnaFinale: "2025-03-01",
    postazioneLavoro: "Banco CQ-05",
    phases: [
      { id: "phase5-1", name: "Setup Test", status: 'pending', materialReady: true, workPeriods: [], sequence: 1, workstationScannedAndVerified: false },
      { id: "phase5-2", name: "Esecuzione Test (24h)", status: 'pending', materialReady: false, workPeriods: [], sequence: 2, workstationScannedAndVerified: false },
      { id: "phase5-3", name: "Report Risultati", status: 'pending', materialReady: false, workPeriods: [], sequence: 3, workstationScannedAndVerified: false },
    ]
  }
];

