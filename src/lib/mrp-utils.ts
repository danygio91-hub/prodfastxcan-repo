
import { JobOrder, Article, RawMaterial, PurchaseOrder, ManualCommitment } from '@/types';
import { GlobalSettings } from './settings-types';
import { calculateBOMRequirement } from './inventory-utils';

export interface MRPTimelineEntry {
    jobId: string;
    materialCode: string;
    requiredQty: number;
    status: 'GREEN' | 'AMBER' | 'RED';
    projectedBalance: number;
    supplyArrivalDate?: string; // Data del primo PO che copre la mancanza (se AMBER)
    details: string[]; // Messaggi per il tooltip
}

/**
 * Calcola l'MRP Time-Phased per tutti i materiali.
 * Simula il magazzino cronologicamente prenotando lo stock per le commesse più urgenti.
 */
export function calculateMRPTimelines(
    allJobs: JobOrder[],
    rawMaterials: RawMaterial[],
    purchaseOrders: PurchaseOrder[],
    manualCommitments: ManualCommitment[],
    articles: Article[],
    globalSettings: GlobalSettings | null
): Map<string, MRPTimelineEntry[]> {
    try {
        const timelines = new Map<string, MRPTimelineEntry[]>();
        
        // 1. Raccolta Demand (Richieste)
        const demands: { 
            materialCode: string, 
            qty: number, 
            date: string, 
            jobId: string, 
            odl: string,
            type: 'JOB' | 'COMMITMENT'
        }[] = [];

        allJobs.forEach(job => {
            (job.billOfMaterials || []).forEach(item => {
                if (item.status !== 'withdrawn') {
                    const mat = rawMaterials.find(m => m.code.toUpperCase() === (item.component || '').toUpperCase());
                    if (mat) {
                        const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        
                        // SSoT: Fallback data contestuale per MRP (Data fine prep o consegna)
                        const demandDate = job.dataFinePreparazione || job.dataConsegnaFinale || '9999-12-31';

                        demands.push({
                            materialCode: mat.code.toUpperCase(),
                            qty: req.totalInBaseUnits,
                            date: demandDate,
                            jobId: job.id,
                            odl: job.numeroODLInterno || job.ordinePF || '',
                            type: 'JOB'
                        });
                    }
                }
            });
        });

        manualCommitments.filter(c => c && c.status === 'pending').forEach(c => {
            const art = articles.find(a => a && a.code.toUpperCase() === (c.articleCode || '').toUpperCase());
            if (art) {
                (art.billOfMaterials || []).forEach(item => {
                    const mat = rawMaterials.find(m => m.code.toUpperCase() === (item.component || '').toUpperCase());
                    if (mat) {
                        const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(c.quantity, item, mat, config as any);
                        demands.push({
                            materialCode: mat.code.toUpperCase(),
                            qty: req.totalInBaseUnits,
                            date: c.deliveryDate || '9999-12-31',
                            jobId: c.id,
                            odl: `COMMIT-${c.id.substring(0, 5)}`,
                            type: 'COMMITMENT'
                        });
                    }
                });
            }
        });

        // 2. Raccolta Supply (Forniture)
        const supplies = purchaseOrders
            .filter(po => po && (po.status === 'pending' || po.status === 'partially_received'))
            .map(po => ({
                materialCode: (po.materialCode || '').toUpperCase(),
                qty: (po.quantity || 0) - (po.receivedQuantity || 0),
                // Un PO senza data è trattato come "Mai" (9999-12-31)
                date: po.expectedDeliveryDate || '9999-12-31',
                id: po.id
            }));

        // 3. Calcolo Timeline per Materiale
        rawMaterials.forEach(mat => {
            if (!mat || !mat.code) return;
            const code = mat.code.toUpperCase();
            let currentBalance = mat.currentStockUnits || 0;
            const initialStock = currentBalance;
            
            const matDemands = demands.filter(d => d.materialCode === code);
            const matSupplies = supplies.filter(s => s.materialCode === code);

            // Sorting richieste: Data -> Numero ODL
            matDemands.sort((a, b) => {
                const dateComp = (a.date || '').localeCompare(b.date || '');
                if (dateComp !== 0) return dateComp;
                return (a.odl || '').localeCompare(b.odl || '');
            });

            // Sorting forniture: Per data
            matSupplies.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

            const materialEntries: MRPTimelineEntry[] = [];
            let cumulativeDemands = 0;

            matDemands.forEach(demand => {
                cumulativeDemands += demand.qty;
                
                // PA = Stock Attuale + PO in arrivo entro la data richiesta - Totale richieste fino a questa
                const relevantSupplies = matSupplies.filter(s => s.date <= demand.date);
                const totalSuppliesUntilNow = relevantSupplies.reduce((sum, s) => sum + s.qty, 0);
                
                const projectedAvailability = initialStock + totalSuppliesUntilNow - cumulativeDemands;
                const balanceWithoutPOs = initialStock - cumulativeDemands;

                let status: 'GREEN' | 'AMBER' | 'RED' = 'GREEN';
                let supplyArrivalDate: string | undefined = undefined;
                const details: string[] = [];

                if (projectedAvailability < -0.001) {
                    status = 'RED';
                    details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                    details.push("❌ Stock in esaurimento / Non disponibile per questa data.");
                    details.push("ORDINARE IMMEDIATAMENTE.");
                } else if (balanceWithoutPOs < -0.001) {
                    // Coperto solo grazie ai PO
                    status = 'AMBER';
                    // Troviamo il primo PO che innesca la copertura
                    const firstCoveringPO = relevantSupplies.find((s, idx) => {
                        const sumBefore = initialStock + relevantSupplies.slice(0, idx).reduce((acc, rs) => acc + rs.qty, 0) - cumulativeDemands;
                        const sumAfter = sumBefore + s.qty;
                        return sumBefore < 0 && sumAfter >= 0;
                    }) || relevantSupplies[relevantSupplies.length - 1];

                    supplyArrivalDate = firstCoveringPO?.date;
                    details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                    details.push(`⚠️ Materiale in arrivo il ${supplyArrivalDate ? supplyArrivalDate : 'N/D'}.`);
                    details.push("Monitorare fornitore.");
                } else {
                    status = 'GREEN';
                    details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                    details.push("✅ Disponibile (Stock fisico).");
                }

                materialEntries.push({
                    jobId: demand.jobId,
                    materialCode: code,
                    requiredQty: demand.qty,
                    status,
                    projectedBalance: projectedAvailability,
                    supplyArrivalDate,
                    details
                });
            });

            timelines.set(code, materialEntries);
        });

        return timelines;
    } catch (error) {
        console.error("ERRORE CRITICO CALCOLO MRP (calculateMRPTimelines):", error);
        return new Map(); // Restituisce mappa vuota per Graceful Degradation
    }
}
