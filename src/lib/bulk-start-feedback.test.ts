import { describe, it, expect } from 'vitest';
import { formatBulkStartFeedback } from './bulk-start-feedback';

describe('FASE 81: Feedback Errore Avvio Massivo Commesse', () => {
    it('restituisce errore specifico quando tutte le commesse sono senza ciclo di lavorazione (singola o multipla)', () => {
        const singleNoCycle = formatBulkStartFeedback({
            startedCount: 0,
            skippedNoCycleCount: 1,
            skippedNoDateCount: 0,
        });

        expect(singleNoCycle.success).toBe(false);
        expect(singleNoCycle.error).toBe('Impossibile avviare: la commessa selezionata non ha un ciclo di lavorazione configurato.');
        expect(singleNoCycle.message).toBe(singleNoCycle.error);

        const multiNoCycle = formatBulkStartFeedback({
            startedCount: 0,
            skippedNoCycleCount: 3,
            skippedNoDateCount: 0,
        });

        expect(multiNoCycle.success).toBe(false);
        expect(multiNoCycle.error).toBe('Impossibile avviare: le commesse selezionate non hanno un ciclo di lavorazione configurato.');
        expect(multiNoCycle.message).toBe(multiNoCycle.error);
    });

    it('restituisce errore specifico quando tutte le commesse sono prive di data di consegna', () => {
        const res = formatBulkStartFeedback({
            startedCount: 0,
            skippedNoCycleCount: 0,
            skippedNoDateCount: 2,
        });

        expect(res.success).toBe(false);
        expect(res.error).toBe('Impossibile avviare: le commesse selezionate sono prive di data di consegna.');
    });

    it('restituisce errore combinato chiaro quando vi sono motivi misti e 0 avviate', () => {
        const res = formatBulkStartFeedback({
            startedCount: 0,
            skippedNoCycleCount: 2,
            skippedNoDateCount: 1,
            skippedOtherReasons: ['Stato non valido'],
        });

        expect(res.success).toBe(false);
        expect(res.error).toBe('Impossibile avviare le commesse selezionate: 2 senza ciclo di lavorazione, 1 prive di data di consegna, 1 non avviabili.');
    });

    it('restituisce warning/messaggio dettagliato quando avvia alcune commesse ma ne salta altre senza ciclo', () => {
        const res = formatBulkStartFeedback({
            startedCount: 3,
            skippedNoCycleCount: 2,
            skippedNoDateCount: 0,
        });

        expect(res.success).toBe(true);
        expect(res.message).toBe('Avviate 3 commesse. 2 commesse saltate (nessun ciclo presente).');
    });

    it('restituisce messaggio completo con scarti misti in caso di successo parziale', () => {
        const res = formatBulkStartFeedback({
            startedCount: 4,
            skippedNoCycleCount: 1,
            skippedNoDateCount: 2,
        });

        expect(res.success).toBe(true);
        expect(res.message).toBe('Avviate 4 commesse. 1 commessa saltata (nessun ciclo presente), 2 commesse saltate (priva di data).');
    });

    it('restituisce messaggio standard pulito quando tutte le commesse selezionate vengono avviate con successo', () => {
        const resProd = formatBulkStartFeedback({
            startedCount: 5,
            skippedNoCycleCount: 0,
            skippedNoDateCount: 0,
            actionType: 'production',
        });

        expect(resProd.success).toBe(true);
        expect(resProd.message).toBe('Avviate in produzione 5 commesse.');

        const resPrint = formatBulkStartFeedback({
            startedCount: 5,
            skippedNoCycleCount: 0,
            skippedNoDateCount: 0,
            actionType: 'print',
        });

        expect(resPrint.success).toBe(true);
        expect(resPrint.message).toBe('Avviate e segnate come stampate 5 commesse.');
    });
});

