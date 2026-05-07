import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { RawMaterial, JobOrder, Article, PurchaseOrder, ManualCommitment } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function convertTimestampsToDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate();
    if (Array.isArray(obj)) return obj.map(item => convertTimestampsToDates(item));
    const newObj: { [key: string]: any } = {};
    for (const key in obj) { newObj[key] = convertTimestampsToDates(obj[key]); }
    return newObj;
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

// calculateCommitmentQty removed - use calculateBOMRequirement from @/lib/inventory-utils

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
    return prepPhases.every((p: any) => p.status === 'completed' || p.status === 'skipped');
}

/**
 * Utility Parser Robusto & Universale (Firebase, ISO, DD/MM/YYYY)
 */
export function parseRobustDate(dateInput: any): Date | null {
    if (!dateInput) return null;
    
    // Firestore Timestamp (Admin or Client SDK)
    if (typeof dateInput.toDate === 'function') return dateInput.toDate();
    
    // Firestore-like plain object (after JSON serialization)
    if (typeof dateInput === 'object' && dateInput._seconds !== undefined) {
        return new Date(dateInput._seconds * 1000 + (dateInput._nanoseconds || 0) / 1000000);
    }
    
    // String (ISO or Italian)
    if (typeof dateInput === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
            const d = new Date(dateInput);
            return isNaN(d.getTime()) ? null : d;
        }
        const italianMatch = dateInput.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
        if (italianMatch) {
            return new Date(parseInt(italianMatch[3]), parseInt(italianMatch[2]) - 1, parseInt(italianMatch[1]));
        }
    }
    
    // Date object
    if (dateInput instanceof Date && !isNaN(dateInput.getTime())) return dateInput;
    
    // Fallback for numeric timestamp
    if (typeof dateInput === 'number' && !isNaN(dateInput)) return new Date(dateInput);

    return null;
}





