
import { JobOrder, Article, RawMaterial, PurchaseOrder, ManualCommitment } from '@/types';
import { GlobalSettings } from './settings-types';
import { calculateBOMRequirement } from './inventory-utils';

export interface MRPTimelineEntry {
    jobId: string;
    materialCode: string;
    requiredQty: number;
    status: 'GREEN' | 'AMBER' | 'LATE' | 'RED';
    projectedBalance: number;
    supplyArrivalDate?: string; 
    details: string[]; 
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
                    const mat = rawMaterials.find(m => (m.code || '').toUpperCase().trim() === (item.component || '').toUpperCase().trim());
                    if (mat) {
                        const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        
                        // SSoT: Fallback data contestuale per MRP (Data fine prep o consegna)
                        const demandDate = job.dataFinePreparazione || job.dataConsegnaFinale || '9999-12-31';

                        demands.push({
                            materialCode: mat.code.toUpperCase().trim(),
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
                    const mat = rawMaterials.find(m => (m.code || '').toUpperCase().trim() === (item.component || '').toUpperCase().trim());
                    if (mat) {
                        const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(c.quantity, item, mat, config as any);
                        demands.push({
                            materialCode: mat.code.toUpperCase().trim(),
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
                materialCode: (po.materialCode || '').toUpperCase().trim(),
                qty: (po.quantity || 0) - (po.receivedQuantity || 0),
                date: po.expectedDeliveryDate || '9999-12-31',
                id: po.id
            }));

        // 3. Calcolo Timeline per Materiale
        rawMaterials.forEach(mat => {
            if (!mat || !mat.code) return;
            const code = (mat.code || '').toUpperCase().trim();
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
                
                // Tutti i PO per questo materiale, anche quelli futurissimi
                const totalSuppliesEver = matSupplies.reduce((sum, s) => sum + s.qty, 0);
                
                const projectedAvailability = initialStock + totalSuppliesUntilNow - cumulativeDemands;
                const balanceWithoutPOs = initialStock - cumulativeDemands;
                const absoluteFutureBalance = initialStock + totalSuppliesEver - cumulativeDemands;

                let status: 'GREEN' | 'AMBER' | 'LATE' | 'RED' = 'GREEN';
                let supplyArrivalDate: string | undefined = undefined;
                const details: string[] = [];

                if (projectedAvailability < -0.001) {
                    // Verifichiamo se almeno con i PO futuri arriviamo a coprire
                    if (absoluteFutureBalance >= -0.001) {
                        status = 'LATE';
                        const firstLatePO = matSupplies.find(s => s.date > demand.date);
                        supplyArrivalDate = firstLatePO?.date;
                        details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                        details.push(`🟠 IN RITARDO: In arrivo il ${supplyArrivalDate || 'futuro'}`);
                        details.push("Verificare se è possibile anticipare la consegna.");
                    } else {
                        status = 'RED';
                        details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                        details.push("❌ MANCANTE: Stock insufficiente, nessun ordine futuro sufficiente.");
                        details.push("ORDINARE IMMEDIATAMENTE.");
                    }
                } else if (balanceWithoutPOs < -0.001) {
                    // Coperto grazie ai PO in tempo
                    status = 'AMBER';
                    const firstCoveringPO = relevantSupplies.find((s, idx) => {
                        const sumBefore = initialStock + relevantSupplies.slice(0, idx).reduce((acc, rs) => acc + rs.qty, 0) - cumulativeDemands;
                        const sumAfter = sumBefore + s.qty;
                        return sumBefore < 0 && sumAfter >= 0;
                    }) || relevantSupplies[relevantSupplies.length - 1];

                    supplyArrivalDate = firstCoveringPO?.date;
                    details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                    details.push(`🟡 COPERTO DA ORDINE: In arrivo il ${supplyArrivalDate}.`);
                    details.push("Monitorare fornitore.");
                } else {
                    status = 'GREEN';
                    details.push(`Fabbisogno: ${demand.qty.toFixed(2)} ${mat.unitOfMeasure}`);
                    details.push("✅ DISPONIBILE (Stock fisico).");
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

/**
 * Aggrega i requisiti MRP per Codice Articolo prima della renderizzazione.
 * Utile per evitare liste infinite se la BOM ha molte righe di taglio per lo stesso materiale.
 */
export function aggregateMRPRequirements(componentEntries: { entry: MRPTimelineEntry; item: any }[]): { entry: MRPTimelineEntry; item: any }[] {
    if (!componentEntries || componentEntries.length === 0) return [];

    const groups = new Map<string, { entries: MRPTimelineEntry[]; items: any[] }>();

    componentEntries.forEach(ce => {
        const code = ce.entry.materialCode.toUpperCase().trim();
        if (!groups.has(code)) {
            groups.set(code, { entries: [], items: [] });
        }
        groups.get(code)!.entries.push(ce.entry);
        groups.get(code)!.items.push(ce.item);
    });

    const aggregated: { entry: MRPTimelineEntry; item: any }[] = [];

    groups.forEach((group, code) => {
        const totalQty = group.entries.reduce((sum, e) => sum + (e.requiredQty || 0), 0);
        
        // Priorità Stato: RED > LATE > AMBER > GREEN
        let finalStatus: MRPTimelineEntry['status'] = 'GREEN';
        if (group.entries.some(e => e.status === 'RED')) finalStatus = 'RED';
        else if (group.entries.some(e => e.status === 'LATE')) finalStatus = 'LATE';
        else if (group.entries.some(e => e.status === 'AMBER')) finalStatus = 'AMBER';

        // Prendi il primo item e entry come rappresentativi per metadati (UOM, etc)
        const repItem = group.items[0];
        const repEntry = group.entries[0];

        // Ricostruisci i dettagli aggregati
        // Nota: Cerchiamo di mantenere lo stile originale dei messaggi in mrp-utils.ts
        const unit = repItem.unitOfMeasure || '';
        const newDetails: string[] = [];
        newDetails.push(`Fabbisogno Totale: ${totalQty.toFixed(2)} ${unit}`);
        
        if (finalStatus === 'RED') {
            newDetails.push("❌ MANCANTE: Stock insufficiente, nessun ordine futuro sufficiente.");
            newDetails.push("ORDINARE IMMEDIATAMENTE.");
        } else if (finalStatus === 'LATE') {
            // Prendi la data del primo PO in ritardo trovato nel gruppo
            const lateEntry = group.entries.find(e => e.status === 'LATE' && e.supplyArrivalDate);
            newDetails.push(`🟠 IN RITARDO: In arrivo il ${lateEntry?.supplyArrivalDate || 'futuro'}`);
            newDetails.push("Verificare se è possibile anticipare la consegna.");
        } else if (finalStatus === 'AMBER') {
            // Prendi la data del primo PO di copertura trovato nel gruppo
            const amberEntry = group.entries.find(e => e.status === 'AMBER' && e.supplyArrivalDate);
            newDetails.push(`🟡 COPERTO DA ORDINE: In arrivo il ${amberEntry?.supplyArrivalDate || 'N/D'}.`);
            newDetails.push("Monitorare fornitore.");
        } else {
            newDetails.push("✅ DISPONIBILE (Stock fisico).");
        }

        aggregated.push({
            entry: {
                ...repEntry,
                requiredQty: totalQty,
                status: finalStatus,
                details: newDetails
            },
            item: repItem
        });
    });

    return aggregated;
}
