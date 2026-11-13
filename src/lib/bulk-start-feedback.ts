/**
 * Helper per la formattazione dei messaggi di feedback dell'avvio massivo commesse.
 * Gestisce i casi di:
 * - Fallimento totale (0 avviate): feedback esplicito sul motivo (es. mancanza ciclo di lavorazione, data mancante, o misto)
 * - Successo parziale: 'Avviate X commesse. Y commesse saltate (nessun ciclo presente).'
 * - Successo totale: 'Avviate in produzione X commesse.'
 */

export interface BulkStartFeedbackParams {
    startedCount: number;
    skippedNoCycleCount: number;
    skippedNoDateCount: number;
    skippedOtherReasons?: string[];
    actionType?: 'production' | 'print';
}

export interface BulkStartFeedbackResult {
    success: boolean;
    message: string;
    error?: string;
}

export function formatBulkStartFeedback(params: BulkStartFeedbackParams): BulkStartFeedbackResult {
    const {
        startedCount,
        skippedNoCycleCount,
        skippedNoDateCount,
        skippedOtherReasons = [],
        actionType = 'production',
    } = params;

    const totalSkipped = skippedNoCycleCount + skippedNoDateCount + skippedOtherReasons.length;
    const actionLabel = actionType === 'print' ? 'Avviate e segnate come stampate' : 'Avviate in produzione';

    // 1. CASO NESSUNA COMMESSA AVVIATA (Fallimento Totale)
    if (startedCount === 0) {
        let errorMsg = "Nessuna commessa avviata.";

        if (skippedNoCycleCount > 0 && skippedNoDateCount === 0 && skippedOtherReasons.length === 0) {
            errorMsg = skippedNoCycleCount === 1
                ? "Impossibile avviare: la commessa selezionata non ha un ciclo di lavorazione configurato."
                : "Impossibile avviare: le commesse selezionate non hanno un ciclo di lavorazione configurato.";
        } else if (skippedNoDateCount > 0 && skippedNoCycleCount === 0 && skippedOtherReasons.length === 0) {
            errorMsg = skippedNoDateCount === 1
                ? "Impossibile avviare: la commessa selezionata è priva di data di consegna."
                : "Impossibile avviare: le commesse selezionate sono prive di data di consegna.";
        } else if (totalSkipped > 0) {
            const parts: string[] = [];
            if (skippedNoCycleCount > 0) {
                parts.push(`${skippedNoCycleCount} senza ciclo di lavorazione`);
            }
            if (skippedNoDateCount > 0) {
                parts.push(`${skippedNoDateCount} prive di data di consegna`);
            }
            if (skippedOtherReasons.length > 0) {
                parts.push(`${skippedOtherReasons.length} non avviabili`);
            }
            errorMsg = `Impossibile avviare le commesse selezionate: ${parts.join(', ')}.`;
        }

        return {
            success: false,
            message: errorMsg,
            error: errorMsg,
        };
    }

    // 2. CASO TUTTE LE COMMESSE AVVIATE (Successo Totale)
    if (totalSkipped === 0) {
        return {
            success: true,
            message: `${actionLabel} ${startedCount} commesse.`,
        };
    }

    // 3. CASO SUCCESSO PARZIALE (Alcune avviate, altre saltate)
    const skipDetails: string[] = [];
    if (skippedNoCycleCount > 0) {
        skipDetails.push(
            `${skippedNoCycleCount} ${skippedNoCycleCount === 1 ? 'commessa saltata' : 'commesse saltate'} (nessun ciclo presente)`
        );
    }
    if (skippedNoDateCount > 0) {
        skipDetails.push(
            `${skippedNoDateCount} ${skippedNoDateCount === 1 ? 'commessa saltata' : 'commesse saltate'} (priva di data)`
        );
    }
    if (skippedOtherReasons.length > 0) {
        skipDetails.push(
            `${skippedOtherReasons.length} ${skippedOtherReasons.length === 1 ? 'commessa saltata' : 'commesse saltate'}`
        );
    }

    return {
        success: true,
        message: `Avviate ${startedCount} commesse. ${skipDetails.join(', ')}.`,
    };
}
