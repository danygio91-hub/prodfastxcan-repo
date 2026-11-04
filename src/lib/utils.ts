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
        const trimmed = dateInput.trim();
        // Pure ISO date YYYY-MM-DD -> anchor to 12:00 local to prevent timezone/DST shift
        const pureIsoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (pureIsoMatch) {
            return new Date(parseInt(pureIsoMatch[1], 10), parseInt(pureIsoMatch[2], 10) - 1, parseInt(pureIsoMatch[3], 10), 12, 0, 0);
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
            const d = new Date(trimmed);
            return isNaN(d.getTime()) ? null : d;
        }
        const italianMatch = trimmed.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
        if (italianMatch) {
            let year = parseInt(italianMatch[3], 10);
            if (italianMatch[3].length === 2) {
                year = year < 70 ? 2000 + year : 1900 + year;
            }
            return new Date(year, parseInt(italianMatch[2], 10) - 1, parseInt(italianMatch[1], 10), 12, 0, 0);
        }
        // Supporto per formato raw a 8 cifre senza separatori (DDMMYYYY es. 20112026)
        const eightDigitsMatch = trimmed.match(/^(\d{2})(\d{2})(\d{4})$/);
        if (eightDigitsMatch) {
            const day = parseInt(eightDigitsMatch[1], 10);
            const month = parseInt(eightDigitsMatch[2], 10);
            const year = parseInt(eightDigitsMatch[3], 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return new Date(year, month - 1, day, 12, 0, 0);
            }
        }
    }
    
    // Date object
    if (dateInput instanceof Date && !isNaN(dateInput.getTime())) return dateInput;
    
    // Fallback for numeric timestamp
    if (typeof dateInput === 'number' && !isNaN(dateInput)) return new Date(dateInput);

    return null;
}
/**
 * Normalizza qualsiasi input di data in una stringa "YYYY-MM-DD" sicura.
 * Evita slittamenti di fuso orario ancorando la data alle 12:00 locale se è un oggetto Date.
 */
export function normalizeDateStr(input: any): string | null {
    if (!input) return null;
    
    // Se è già una stringa YYYY-MM-DD valida, la ritorniamo così com'è
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return input;
    }

    const d = parseRobustDate(input);
    if (!d) return null;
    
    // Ancoraggio a mezzogiorno per evitare shift UTC quando si estrae solo la data
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

/**
 * FASE 31: Estrae l'anno di competenza da una data di consegna (o fallback alla data odierna/creazione).
 */
export function extractAnnoCompetenza(dateInput?: any, fallbackDate: Date = new Date()): number {
    if (dateInput) {
        if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
            return dateInput.getFullYear();
        }
        const parsed = parseRobustDate(dateInput);
        if (parsed && !isNaN(parsed.getTime())) {
            return parsed.getFullYear();
        }
        const d = new Date(String(dateInput));
        if (!isNaN(d.getTime())) {
            return d.getFullYear();
        }
    }
    return fallbackDate.getFullYear();
}

/**
 * FASE 31: Genera l'ID univoco composito per il documento Firestore di una commessa (es. 840-PF_2026).
 * Se l'ID fornito include già il suffisso dell'anno, non lo duplica.
 */
export function generateJobDocumentId(ordinePF: string, annoCompetenza: number): string {
    const base = (ordinePF || '').replace(/\//g, '-').trim();
    if (base.endsWith(`_${annoCompetenza}`)) {
        return base;
    }
    return `${base}_${annoCompetenza}`;
}

/**
 * FASE 42: Auto-formattazione input data in tempo reale:
 * Rimuove i caratteri non numerici, inserisce gli slash (DD/MM/YYYY) e limita a 10 caratteri.
 * Supporta anche l'incolla di formati ISO (YYYY-MM-DD -> DD/MM/YYYY).
 */
export function formatToDateInputMask(value: string): string {
    if (!value) return '';
    const trimmed = value.trim();
    // Se l'utente incolla una data ISO YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) {
        return digits;
    }
    if (digits.length <= 4) {
        return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

