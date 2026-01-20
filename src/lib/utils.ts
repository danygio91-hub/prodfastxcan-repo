import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDisplayStock(value: number | null | undefined, unit: 'n' | 'mt' | 'kg'): string {
  if (value === null || value === undefined) return '0.00';

  if (unit === 'n') {
    return String(Math.floor(value));
  }
  if (unit === 'mt') {
    // Arrotondamento per difetto al più vicino 0.05
    const rounded = Math.floor(value * 20) / 20;
    return rounded.toFixed(2);
  }
  // kg
  const rounded = Math.floor(value * 100) / 100;
  return rounded.toFixed(2);
}
