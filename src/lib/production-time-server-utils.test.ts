
import { describe, it, expect } from 'vitest';
import { distributeTheoreticalTimes } from './production-time-server-utils';
import { JobPhase } from '@/types';

describe('Smart Remainder - Theoretical Time Distribution', () => {

    it('dovrebbe distribuire il tempo rimanente proporzionalmente ai pesi (Regola d\'Oro)', () => {
        // A = 12 minuti (Tempo Totale)
        const totalMinutes = 12;

        const phases: Partial<JobPhase>[] = [
            { id: 'p1', name: 'Taglio', sequence: 1, theoreticalWeight: 1 },
            { id: 'p2', name: 'Aggraffatura', sequence: 2, theoreticalWeight: 1 },
            { id: 'p3', name: 'Collaudo', sequence: 3, theoreticalWeight: 2 },
        ];

        // B = 2 minuti per 'Taglio' (Storico esistente)
        const historicalAverages = [
            { name: 'Taglio', averageMinutesPerPiece: 2 }
        ];

        // C = 12 - 2 = 10 minuti da spalmare
        // Pesi: Aggraffatura (1), Collaudo (2) -> Totale 3
        // Risultato atteso:
        // Taglio: 2 (storico)
        // Aggraffatura: 10 / 3 * 1 = 3.333
        // Collaudo: 10 / 3 * 2 = 6.666
        
        const result = distributeTheoreticalTimes(totalMinutes, phases as JobPhase[], historicalAverages);

        expect(result[0].expectedMinutesPerPiece).toBe(2);
        expect(result[1].expectedMinutesPerPiece).toBeCloseTo(3.333, 3);
        expect(result[2].expectedMinutesPerPiece).toBeCloseTo(6.667, 3);
    });

    it('dovrebbe usare peso di default 1 se theoreticalWeight è mancante', () => {
        const totalMinutes = 10;
        const phases: Partial<JobPhase>[] = [
            { id: 'p1', name: 'Fase 1', sequence: 1 }, // no weight
            { id: 'p2', name: 'Fase 2', sequence: 2, theoreticalWeight: 1 },
        ];

        const result = distributeTheoreticalTimes(totalMinutes, phases as JobPhase[], []);

        // 10 / (1+1) = 5 ciascuno
        expect(result[0].expectedMinutesPerPiece).toBe(5);
        expect(result[1].expectedMinutesPerPiece).toBe(5);
    });

    it('non dovrebbe spalmare se il tempo rimanente è zero o negativo', () => {
        const totalMinutes = 5;
        const historicalAverages = [{ name: 'Fase 1', averageMinutesPerPiece: 10 }];
        const phases: Partial<JobPhase>[] = [
            { id: 'p1', name: 'Fase 1', sequence: 1 },
            { id: 'p2', name: 'Fase 2', sequence: 2, theoreticalWeight: 1 },
        ];

        const result = distributeTheoreticalTimes(totalMinutes, phases as JobPhase[], historicalAverages);

        expect(result[0].expectedMinutesPerPiece).toBe(10);
        expect(result[1].expectedMinutesPerPiece).toBe(0);
    });
});
