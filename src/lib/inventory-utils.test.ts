
import { describe, it, expect } from 'vitest';
import { calculateBOMRequirement } from './inventory-utils';

describe('MRP BOM Requirement Calculation (Tolleranza Zero)', () => {
    
    it('dovrebbe calcolare correttamente il fabbisogno per materiali continui (Cavi/Bobine)', () => {
        // Caso specifico del Bug: 12 pz * 4 per pz * 475mm * 2.5 KG/MT = 57 KG
        const jobQta = 12;
        const bomItem = {
            quantity: 4,
            lunghezzaTaglioMm: 475,
            unit: 'n' as any
        };
        const material = {
            unitOfMeasure: 'kg' as any,
            rapportoKgMt: 2.5,
            conversionFactor: 0
        };
        const config = {
            defaultUnit: 'kg'
        };

        const result = calculateBOMRequirement(jobQta, bomItem, material, config as any);
        
        expect(result.totalPieces).toBe(48);
        expect(result.totalMeters).toBe(22.8);
        expect(result.totalInBaseUnits).toBe(57);
        expect(result.weightKg).toBe(57);
    });

    it('dovrebbe calcolare correttamente il fabbisogno per materiali discreti (Connettori/Viti)', () => {
        const jobQta = 10;
        const bomItem = {
            quantity: 5,
            unit: 'n' as any
        };
        const material = {
            unitOfMeasure: 'n' as any,
            rapportoKgMt: 0,
            conversionFactor: 1
        };
        const config = {
            defaultUnit: 'n'
        };

        const result = calculateBOMRequirement(jobQta, bomItem, material, config as any);
        
        expect(result.totalPieces).toBe(50);
        expect(result.totalInBaseUnits).toBe(50);
    });

    it('dovrebbe calcolare correttamente il fabbisogno per materiali con solo rapporto peso (KG/Unit)', () => {
        const jobQta = 100;
        const bomItem = {
            quantity: 1,
            unit: 'n' as any
        };
        const material = {
            unitOfMeasure: 'kg' as any,
            rapportoKgMt: 0,
            conversionFactor: 0.05 // 50g per pezzo
        };
        const config = {
            defaultUnit: 'kg'
        };

        const result = calculateBOMRequirement(jobQta, bomItem, material, config as any);
        
        expect(result.totalInBaseUnits).toBe(5); // 100 * 0.05
    });
});
