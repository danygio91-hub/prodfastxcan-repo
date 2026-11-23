import { RawMaterial, RawMaterialBatch, MaterialWithdrawal } from '@/types';

/**
 * Normalizza un codice lotto per lookup/aggregazioni case-insensitive e trim-safe.
 */
export function normStockLot(lotto?: string | null): string {
    return (lotto || 'SENZA_LOTTO').trim().toUpperCase();
}

export interface HydratedLotInfo {
    lotto: string;
    available: number;
    availableWeightKg: number;
    batches: RawMaterialBatch[];
    unit?: string;
}

/**
 * SOURCE OF TRUTH (SSoT) STOCK LOGIC
 * Re-calculates and hydrates material batches with live residual stock based on recorded withdrawals.
 * Mirroring the logic from Admin's getAllGroupedBatches to ensure 100% parity.
 */
export function hydrateMaterialWithWithdrawals(material: RawMaterial, withdrawals: MaterialWithdrawal[]): RawMaterial {
    const hydratedMaterial = JSON.parse(JSON.stringify(material)) as RawMaterial;

    const normLot = normStockLot;

    // 1. Group withdrawals by lot (mirrors admin logic, normalized case & trim)
    const withdrawalsByLotto = withdrawals.reduce((acc, w) => {
        if (w.status === 'cancelled') return acc;
        const l = normLot(w.lotto);
        acc[l] = (acc[l] || 0) + (w.consumedUnits || 0);
        return acc;
    }, {} as Record<string, number>);

    // 2. Group batches by lot (mirrors admin logic, normalized case & trim)
    const batchesByLotto = (hydratedMaterial.batches || []).reduce((acc, batch) => {
        const lottoKey = normLot(batch.lotto);
        if (!acc[lottoKey]) acc[lottoKey] = [];
        acc[lottoKey].push(batch);
        return acc;
    }, {} as Record<string, RawMaterialBatch[]>);

    // 3. Hydrate each batch by applying FIFO within the lot
    Object.entries(batchesByLotto).forEach(([lotto, batchList]) => {
        // Sort batches by date (oldest first for FIFO)
        batchList.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let remainingWithdrawal = withdrawalsByLotto[lotto] || 0;

        batchList.forEach(batch => {
            const initialLoad = batch.netQuantity || 0;
            const deduction = Math.min(initialLoad, remainingWithdrawal);

            // Popolamento campo dinamico "currentQuantity" (residuo vivo)
            // netQuantity RESTA l'originale immutabile per lo storico
            batch.currentQuantity = Number(Math.max(0, initialLoad - deduction).toFixed(3));
            remainingWithdrawal = Number(Math.max(0, remainingWithdrawal - deduction).toFixed(3));

            // Calcolo proporzionale del peso residuo per il batch
            if (hydratedMaterial.unitOfMeasure === 'kg') {
                batch.currentWeightKg = batch.currentQuantity;
            } else {
                const batchFactor = (hydratedMaterial.unitOfMeasure === 'mt' ? (hydratedMaterial.rapportoKgMt || hydratedMaterial.conversionFactor) : hydratedMaterial.conversionFactor) || 1;
                batch.currentWeightKg = Number((batch.currentQuantity * batchFactor).toFixed(3));
            }

            // TASSATIVO: Ricalcola l'estenuazione in base al residuo reale idratato
            // Evita che un batch con stock positivo sia nascosto se il flag nel DB è stale
            batch.isExhausted = batch.currentQuantity <= 0.001;
        });
    });

    // 4. Final consistency check: Recalculate total currentStockUnits
    // Mantiene il valore SSoT esatto (3 decimali) senza Math.round prematuri su 'n',
    // evitando discrepanze in UI (es. 106 vs 105) e falsi sovra-scarichi su residui decimali.
    const finalTotal = (hydratedMaterial.batches || [])
        .reduce((sum, b) => sum + (b.currentQuantity || 0), 0);

    hydratedMaterial.currentStockUnits = finalTotal <= 0.001 ? 0 : Number(finalTotal.toFixed(3));

    // Calculate totalWeightKg based on currentStockUnits and conversion factors
    if (hydratedMaterial.unitOfMeasure === 'kg') {
        hydratedMaterial.currentWeightKg = hydratedMaterial.currentStockUnits;
    } else {
        const factor = (hydratedMaterial.unitOfMeasure === 'mt' ? (hydratedMaterial.rapportoKgMt || hydratedMaterial.conversionFactor) : hydratedMaterial.conversionFactor) || 1;
        hydratedMaterial.currentWeightKg = Number((hydratedMaterial.currentStockUnits * factor).toFixed(3));
    }

    return hydratedMaterial;
}

/**
 * Restituisce il totale giacenza SSoT derivato dai batch idratati (se presenti),
 * garantendo coerenza assoluta tra il box TOTALE MAGAZZINO e IN USO (LOTTO).
 */
export function getHydratedTotalStockUnits(material?: RawMaterial | null): number {
    if (!material) return 0;
    const batches = Array.isArray(material.batches) ? material.batches : [];
    const hasHydratedBatches = batches.some((b) => b && b.currentQuantity !== undefined);
    if (hasHydratedBatches) {
        const total = batches.reduce((sum, b) => sum + (!b.isExhausted ? (b.currentQuantity || 0) : 0), 0);
        return total <= 0.001 ? 0 : Number(total.toFixed(3));
    }
    const raw = Number(material.currentStockUnits ?? 0);
    return Number.isFinite(raw) ? Math.max(0, Number(raw.toFixed(3))) : 0;
}

/**
 * Estrae i lotti attivi da un materiale già idratato tramite `hydrateMaterialWithWithdrawals`.
 * Legge ESCLUSIVAMENTE `b.currentQuantity` e `b.currentWeightKg` (mai `b.netQuantity`)
 * aggregando i batch per lotto normalizzato e ordinandoli FIFO.
 */
export function extractHydratedLots(hydratedMaterial: RawMaterial): HydratedLotInfo[] {
    const activeBatches = (hydratedMaterial.batches || []).filter(
        (b) => !b.isExhausted && (b.currentQuantity ?? 0) > 0.001
    );

    const bByLotto = activeBatches.reduce((acc, b) => {
        const key = normStockLot(b.lotto);
        if (!acc[key]) acc[key] = [];
        acc[key].push(b);
        return acc;
    }, {} as Record<string, RawMaterialBatch[]>);

    return Object.entries(bByLotto)
        .map(([normKey, batches]) => {
            const sortedBatches = [...batches].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            const displayLotto =
                sortedBatches.find((b) => b.lotto && b.lotto.trim())?.lotto?.trim() || normKey;
            const totalAvailable = Number(
                sortedBatches.reduce((s, b) => s + (b.currentQuantity ?? 0), 0).toFixed(3)
            );
            const totalWeightKg = Number(
                sortedBatches.reduce((s, b) => s + (b.currentWeightKg ?? 0), 0).toFixed(3)
            );
            return {
                lotto: displayLotto,
                available: totalAvailable,
                availableWeightKg: totalWeightKg,
                batches: sortedBatches,
                unit: hydratedMaterial.unitOfMeasure,
            };
        })
        .filter((l) => l.available > 0.001)
        .sort((a, b) => {
            const dA = a.batches[0]?.date ? new Date(a.batches[0].date).getTime() : 0;
            const dB = b.batches[0]?.date ? new Date(b.batches[0].date).getTime() : 0;
            return dA - dB;
        });
}

/**
 * FASE 89: Seleziona il sub-batch attivo di riferimento per un lotto (per tara, imballo, ecc.).
 * Non usa mai ciecamente matchingBatches[0] (che in un lotto con CARICO_RIENTRO è spesso il vecchio carico esaurito):
 * 1. Ordina i sub-batch cronologicamente (dal più vecchio al più recente).
 * 2. Restituisce l'ULTIMO sub-batch con residuo vivo (currentQuantity > 0.001).
 * 3. Se tutti i sub-batch sono a 0, restituisce l'ultimo sub-batch cronologico inserito.
 */
export function selectActiveLotBatch(matchingBatches: RawMaterialBatch[]): RawMaterialBatch | undefined {
    if (!Array.isArray(matchingBatches) || matchingBatches.length === 0) {
        return undefined;
    }

    const sorted = [...matchingBatches].sort((a, b) => {
        const tA = a?.date ? new Date(a.date).getTime() : 0;
        const tB = b?.date ? new Date(b.date).getTime() : 0;
        return (Number.isFinite(tA) ? tA : 0) - (Number.isFinite(tB) ? tB : 0);
    });

    for (let i = sorted.length - 1; i >= 0; i--) {
        const candidate = sorted[i];
        const qty = candidate.currentQuantity !== undefined ? candidate.currentQuantity : (candidate.netQuantity ?? 0);
        if (qty > 0.001 && !candidate.isExhausted) {
            return candidate;
        }
    }

    for (let i = sorted.length - 1; i >= 0; i--) {
        const candidate = sorted[i];
        if ((candidate.currentQuantity ?? 0) > 0.001) {
            return candidate;
        }
    }

    return sorted[sorted.length - 1];
}

/**
 * Calcola il residuo vivo totale (unità e kg) di uno specifico lotto su un materiale già idratato.
 * Somma esclusivamente `currentQuantity` e `currentWeightKg` dei batch appartenenti al lotto normalizzato.
 */
export function getLotResidualSummary(
    hydratedMaterial: RawMaterial,
    lotto?: string | null
): {
    availableUnits: number;
    availableWeightKg: number;
    matchingBatches: RawMaterialBatch[];
    activeBatch: RawMaterialBatch | undefined;
    isExhausted: boolean;
} {
    const targetNorm = normStockLot(lotto);
    const matchingBatches = (hydratedMaterial.batches || []).filter(
        (b) => normStockLot(b.lotto) === targetNorm
    );
    const availableUnits = Number(
        matchingBatches.reduce((s, b) => s + (b.currentQuantity ?? 0), 0).toFixed(3)
    );
    const availableWeightKg = Number(
        matchingBatches.reduce((s, b) => s + (b.currentWeightKg ?? 0), 0).toFixed(3)
    );
    const activeBatch = selectActiveLotBatch(matchingBatches);
    const isExhausted = availableUnits <= 0.001 || availableWeightKg <= 0.001;

    return {
        availableUnits,
        availableWeightKg,
        matchingBatches,
        activeBatch,
        isExhausted,
    };
}

export interface WithdrawalPreviewParams {
    availableUnits: number;
    rawInput?: number | string | null;
    isScaleMode: boolean;
    tareKg?: number;
    unitOfMeasure?: string;
    conversionFactor?: number | null;
    rapportoKgMt?: number | null;
}

export interface WithdrawalPreviewResult {
    hasInput: boolean;
    currentAvailableUnits: number;
    withdrawalUnits: number;
    estimatedRemainingUnits: number;
    netOnScaleUnits: number;
    isOverdraw: boolean;
    isZeroOrNegativeScaleDelta: boolean;
    errorMessage: string | null;
}

/**
 * Calcola in tempo reale l'impatto di uno scarico (Modalità Diretta o Bilancia KG)
 * per fornire all'operatore: Giacenza Attuale, Prelievo e Nuovo Residuo Stimato + blocco UI su sovra-scarico.
 */
export function previewWithdrawalImpact(params: WithdrawalPreviewParams): WithdrawalPreviewResult {
    const {
        availableUnits,
        rawInput,
        isScaleMode,
        tareKg = 0,
        unitOfMeasure = 'kg',
        conversionFactor,
        rapportoKgMt,
    } = params;

    const uom = (unitOfMeasure || 'kg').trim().toLowerCase();
    const safeAvailable = Math.max(0, Number(availableUnits) || 0);
    const floorUnits = (v: number) => Math.floor(Number((v >= 0 ? v + 1e-6 : v).toFixed(4)));
    // Coerente con formatDisplayStock: per 'n' la disponibilità e i display usano floor (105.728 -> 105)
    const formatAvailableVal = (v: number) => (uom === 'n' ? floorUnits(v) : Number(v.toFixed(3)));

    const isEmpty =
        rawInput === undefined ||
        rawInput === null ||
        String(rawInput).trim() === '' ||
        Number.isNaN(Number(rawInput));

    if (isEmpty) {
        return {
            hasInput: false,
            currentAvailableUnits: formatAvailableVal(safeAvailable),
            withdrawalUnits: 0,
            estimatedRemainingUnits: formatAvailableVal(safeAvailable),
            netOnScaleUnits: 0,
            isOverdraw: false,
            isZeroOrNegativeScaleDelta: false,
            errorMessage: null,
        };
    }

    const numericInput = Number(rawInput);

    if (numericInput < 0) {
        return {
            hasInput: true,
            currentAvailableUnits: formatAvailableVal(safeAvailable),
            withdrawalUnits: 0,
            estimatedRemainingUnits: formatAvailableVal(safeAvailable),
            netOnScaleUnits: 0,
            isOverdraw: true,
            isZeroOrNegativeScaleDelta: true,
            errorMessage: 'La quantità non può essere negativa.',
        };
    }

    if (!isScaleMode) {
        const withdrawalUnits = uom === 'n' ? Math.round(numericInput) : Number(numericInput.toFixed(3));
        const isOverdraw = withdrawalUnits > safeAvailable + 0.001;
        const rawRemaining = Math.max(0, safeAvailable - withdrawalUnits);
        const estimatedRemainingUnits = formatAvailableVal(rawRemaining);

        return {
            hasInput: true,
            currentAvailableUnits: formatAvailableVal(safeAvailable),
            withdrawalUnits,
            estimatedRemainingUnits,
            netOnScaleUnits: estimatedRemainingUnits,
            isOverdraw,
            isZeroOrNegativeScaleDelta: withdrawalUnits <= 0.001,
            errorMessage: isOverdraw ? 'Quantità superiore alla giacenza' : null,
        };
    }

    // Modalità Bilancia (Input = Peso Lordo residuo sulla bilancia in KG)
    const netWeightKg = Math.max(0, numericInput - (Number(tareKg) || 0));
    const factor = (uom === 'mt' ? (rapportoKgMt || conversionFactor) : conversionFactor) || 1;
    const rawOnScaleUnits = uom === 'kg' ? netWeightKg : factor > 0 ? netWeightKg / factor : netWeightKg;
    const roundedOnScale = uom === 'n' ? Math.round(rawOnScaleUnits) : Number(rawOnScaleUnits.toFixed(3));
    // Tolleranza float / arrotondamento bilancia (<= 0.01 su continuo, o <= 0.5 su pezzo intero se il valore grezzo è entro il residuo)
    const overScale = roundedOnScale - safeAvailable;
    const netOnScaleUnits =
        overScale > 0 && ((uom === 'n' && overScale <= 0.5 && rawOnScaleUnits <= safeAvailable + 0.01) || (uom !== 'n' && overScale <= 0.01))
            ? formatAvailableVal(safeAvailable)
            : roundedOnScale;

    const isOverdraw = netOnScaleUnits > safeAvailable + 0.01;
    const rawWithdrawn = Math.max(0, safeAvailable - netOnScaleUnits);
    const withdrawalUnits = isOverdraw ? 0 : (uom === 'n' ? Math.round(rawWithdrawn) : Number(rawWithdrawn.toFixed(3)));
    const isZeroOrNegativeScaleDelta = !isOverdraw && withdrawalUnits <= 0.001;

    return {
        hasInput: true,
        currentAvailableUnits: formatAvailableVal(safeAvailable),
        withdrawalUnits,
        estimatedRemainingUnits: netOnScaleUnits,
        netOnScaleUnits,
        isOverdraw,
        isZeroOrNegativeScaleDelta,
        errorMessage: isOverdraw ? 'Quantità superiore alla giacenza' : null,
    };
}

