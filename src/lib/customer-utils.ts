import { Client } from "@/types";

/**
 * Calcola il prefisso del cliente per il Codice Parlante.
 * 1. Usa l'override manuale se presente (smartCodePrefix).
 * 2. Fallback automatico:
 *    - Se il nome cliente è una parola sola: Prendi le prime 2 lettere (es. ZUCCHINI -> ZU).
 *    - Se il nome cliente è composto: Prendi le iniziali delle prime due parole (es. ALFA STANDARD -> AS).
 */
export function getCustomerPrefix(customer: string | Client): string {
  const name = typeof customer === 'string' ? customer : customer.name;
  const override = typeof customer === 'string' ? null : customer.smartCodePrefix;

  if (override) return override.toUpperCase();
  if (!name) return "??";
  
  const words = name.trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  } else {
    const firstInit = words[0].substring(0, 1);
    const secondInit = words[1].substring(0, 1);
    return (firstInit + secondInit).toUpperCase();
  }
}
