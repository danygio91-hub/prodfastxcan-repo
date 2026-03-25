import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { RawMaterial } from "./mock-data";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDisplayStock(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return '0.00';

  if (unit === 'n') {
    return String(Math.floor(value));
  }
  
  if (isNaN(value)) {
    return '0.00';
  }

  if (unit === 'mt') {
    const rounded = Math.floor(value * 20) / 20;
    return rounded.toFixed(2);
  }
  
  const rounded = Math.floor(value * 100) / 100;
  return rounded.toFixed(2);
}

/**
 * Calcola il fabbisogno di materiale convertendolo nell'unità del magazzino (KG, MT o N).
 * Utilizzata per il sistema di alert stock e per i prelievi.
 */
export function calculateCommitmentQty(jobQta: number, bomItem: any, material: RawMaterial | undefined): number {
    if (!material) return 0;
    
    const qta = Number(jobQta) || 0;
    const bomQty = Number(bomItem.quantity) || 0;
    const lengthMm = Number(bomItem.lunghezzaTaglioMm) || 0;
    
    if (material.unitOfMeasure === 'kg') {
        let totalMeters = 0;
        if (lengthMm > 0) {
            totalMeters = (qta * bomQty * lengthMm) / 1000;
        } else if (bomItem.unit === 'mt') {
            totalMeters = qta * bomQty;
        }

        if (totalMeters > 0) {
            return totalMeters * (material.rapportoKgMt || material.conversionFactor || 0);
        }
        
        return (qta * bomQty) * (material.conversionFactor || 0);
    }
    
    if (material.unitOfMeasure === 'mt') {
        if (lengthMm > 0) return (qta * bomQty * lengthMm) / 1000;
        if (bomItem.unit === 'mt') return qta * bomQty;
        return qta * bomQty;
    }
    
    return qta * bomQty;
}

/**
 * Controlla se una commessa è pronta per la produzione.
 * Se deptDependsOnPrep è false, la commessa è considerata sempre pronta per quel reparto.
 * Altrimenti, è pronta solo se tutte le fasi di tipo 'preparation' sono completate.
 */
export function isJobReadyForProduction(job: any, deptDependsOnPrep: boolean = true): boolean {
    if (!deptDependsOnPrep) return true;
    if (!job.phases || job.phases.length === 0) return true;
    const prepPhases = job.phases.filter((p: any) => p.type === 'preparation');
    if (prepPhases.length === 0) return true;
    return prepPhases.every((p: any) => p.status === 'completed');
}


