
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
        
        // Data di oggi per normalizzazione Overdue
        const now = new Date();
        const today08 = new Date(now);
        today08.setUTCHours(8, 0, 0, 0);
        const today08ISO = today08.toISOString();

        rawMaterials.forEach(mat => {
            if (!mat || !mat.code) return;
            const matCode = (mat.code || '').toUpperCase().trim();
            const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
            
            // 1. Inizializzazione Balance con Fallback Legacy Stock (In-Memory)
            const batchesSum = (mat.batches || []).reduce((sum, b) => sum + Number(b.currentQuantity || 0), 0);
            let startingStock = Number(mat.currentStockUnits || 0);
            
            // Fallback se CSU=0 ma esiste stock legacy
            if (batchesSum <= 0.001 && Number(mat.stock || 0) > 0) {
                startingStock = Number(mat.stock || 0);
            }

            const initialPhysicalStock = startingStock;

            // 2. Creazione Timeline Eventi per questo materiale
            const events: {
                date: string;
                qty: number; // Positivo per PO, Negativo per Demand
                type: 'PO' | 'DEMAND';
                id: string;
                odl?: string;
            }[] = [];

            // A. PO (Supply) - Solo Pendenti
            const matchedPOs = purchaseOrders
                .filter(po => {
                    if (!po) return false;
                    const status = (po.status as string || '').toLowerCase();
                    if (status === 'completed' || status === 'cancelled') return false;
                    
                    const poMaterialCode = (po.materialCode || '').toUpperCase().trim();
                    const matIdMatch = (po as any).materialId && (po as any).materialId === mat.id;
                    const matCodeMatch = poMaterialCode === matCode;
                    
                    return matIdMatch || matCodeMatch;
                });

            if (matCode === '50X005X33FR' && matchedPOs.length === 0) {
                console.warn(`MRP WARNING [50X005X33FR] - Nessun PO pendente trovato per questo materiale! Verificare stati PO e codici materiale.`);
            }

            matchedPOs.forEach(po => {
                    // Parsing robusto della data (gestisce String, Timestamp o Date)
                    let poDateRaw = po.expectedDeliveryDate;
                    let poDate: Date;
                    
                    if (poDateRaw && typeof poDateRaw === 'object' && poDateRaw !== null && 'toDate' in (poDateRaw as any)) {
                        poDate = (poDateRaw as any).toDate();
                    } else if (poDateRaw) {
                        poDate = new Date(poDateRaw);
                    } else {
                        poDate = new Date();
                        poDate.setDate(poDate.getDate() + 30);
                    }

                    // REGOLA OVERDUE ASSOLUTA: Se data < oggi (mezzanotte), FORZA a oggi ore 08:00
                    const todayMidnight = new Date(now);
                    todayMidnight.setUTCHours(0, 0, 0, 0);
                    
                    let finalDateISO: string;
                    if (poDate < todayMidnight || isNaN(poDate.getTime())) {
                        finalDateISO = today08ISO;
                    } else {
                        // Forza comunque l'orario alle 08:00 per coerenza intraday
                        const d = new Date(poDate);
                        d.setUTCHours(8, 0, 0, 0);
                        finalDateISO = d.toISOString();
                    }
                    
                    events.push({
                        date: finalDateISO,
                        qty: Number(po.quantity || 0) - Number(po.receivedQuantity || 0),
                        type: 'PO',
                        id: po.id
                    });
                });

            // B. Commesse (Demand)
            allJobs.forEach(job => {
                (job.billOfMaterials || []).forEach(item => {
                    if (item.status !== 'withdrawn' && (item.component || '').toUpperCase().trim() === matCode) {
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        const demandDate = job.dataFinePreparazione || job.dataConsegnaFinale || '9999-12-31';
                        
                        // PRIORITÀ INTRADAY: Forza DEMAND alle 16:00 UTC
                        const dWithTime = new Date(demandDate);
                        dWithTime.setUTCHours(16, 0, 0, 0);

                        events.push({
                            date: dWithTime.toISOString(),
                            qty: -Number(req.totalInBaseUnits),
                            type: 'DEMAND',
                            id: job.id,
                            odl: job.numeroODLInterno || job.ordinePF || ''
                        });
                    }
                });
            });

            // C. Manual Commitments (Demand)
            manualCommitments.filter(c => c && c.status === 'pending').forEach(c => {
                const art = articles.find(a => a && a.code.toUpperCase() === (c.articleCode || '').toUpperCase());
                if (art) {
                    (art.billOfMaterials || []).forEach(item => {
                        if ((item.component || '').toUpperCase().trim() === matCode) {
                            const req = calculateBOMRequirement(c.quantity, item, mat, config as any);
                            const demandDate = c.deliveryDate || '9999-12-31';
                            
                            // PRIORITÀ INTRADAY: Forza DEMAND alle 16:00 UTC
                            const dWithTime = new Date(demandDate);
                            dWithTime.setUTCHours(16, 0, 0, 0);

                            events.push({
                                date: dWithTime.toISOString(),
                                qty: -Number(req.totalInBaseUnits),
                                type: 'DEMAND',
                                id: c.id,
                                odl: `COMMIT-${c.id.substring(0, 5)}`
                            });
                        }
                    });
                }
            });

            // 3. Ordinamento Cronologico Rigoroso
            events.sort((a, b) => a.date.localeCompare(b.date));

            if (matCode === '50X005X33FR') {
                console.log(`MRP DEBUG [50X005X33FR] - Sorted Events:`, events.map(e => `${e.date} | ${e.type} | ${e.qty}`));
            }

            // 4. Loop di Calcolo (VERO Running Balance)
            const materialEntries: MRPTimelineEntry[] = [];
            const totalSuppliesOnTimeline = events.filter(e => e.type === 'PO').reduce((sum, e) => sum + e.qty, 0);
            
            let runningBalance = initialPhysicalStock;
            let cumulativeDemands = 0;

            events.forEach(event => {
                if (event.type === 'PO') {
                    runningBalance += Number(event.qty);
                } else {
                    const requiredQty = Math.abs(Number(event.qty));
                    cumulativeDemands += requiredQty;
                    runningBalance -= requiredQty;

                    const currentBalanceAtDemand = runningBalance;
                    const balanceAtEndOfTime = initialPhysicalStock + totalSuppliesOnTimeline - cumulativeDemands;

                    let status: MRPTimelineEntry['status'] = 'RED';
                    let supplyArrivalDate: string | undefined = undefined;
                    const details: string[] = [];

                    // 5. Assegnazione Stato Finale
                    if (currentBalanceAtDemand >= -0.001) {
                        // COPERTO (Green o Amber)
                        if (initialPhysicalStock - cumulativeDemands >= -0.001) {
                            status = 'GREEN';
                            details.push(`Fabbisogno: ${requiredQty.toFixed(2)} ${mat.unitOfMeasure}`);
                            details.push("✅ DISPONIBILE (Stock fisico).");
                        } else {
                            status = 'AMBER';
                            // Cerchiamo l'ultimo PO che ha contribuito alla copertura (già sommato al runningBalance)
                            const lastPO = [...events].filter(e => e.type === 'PO' && e.date <= event.date).pop();
                            supplyArrivalDate = lastPO?.date;
                            details.push(`Fabbisogno: ${requiredQty.toFixed(2)} ${mat.unitOfMeasure}`);
                            details.push(`🟡 COPERTO DA ORDINE: In arrivo il ${supplyArrivalDate ? new Date(supplyArrivalDate).toLocaleDateString('it-IT') : 'N/D'}.`);
                        }
                    } else {
                        // NON COPERTO (Late o Red)
                        if (balanceAtEndOfTime >= -0.001) {
                            status = 'LATE';
                            const nextPO = events.find(e => e.type === 'PO' && e.date > event.date);
                            supplyArrivalDate = nextPO?.date;
                            details.push(`Fabbisogno: ${requiredQty.toFixed(2)} ${mat.unitOfMeasure}`);
                            details.push(`🟠 IN RITARDO: In arrivo il ${supplyArrivalDate ? new Date(supplyArrivalDate).toLocaleDateString('it-IT') : 'futuro'}`);
                        } else {
                            status = 'RED';
                            details.push(`Fabbisogno: ${requiredQty.toFixed(2)} ${mat.unitOfMeasure}`);
                            details.push("❌ MANCANTE: Stock insufficiente e coperture totali non bastano.");
                        }
                    }

                    materialEntries.push({
                        jobId: event.id,
                        materialCode: matCode,
                        requiredQty,
                        status,
                        projectedBalance: currentBalanceAtDemand,
                        supplyArrivalDate,
                        details
                    });

                    if (matCode === '50X005X33FR') {
                        console.log(`MRP DEBUG [50X005X33FR] - Status Assigned: ${status} for Job: ${event.id} (ODL: ${event.odl}) - Balance: ${currentBalanceAtDemand.toFixed(2)} FinalBalance: ${balanceAtEndOfTime.toFixed(2)}`);
                    }
                }
            });

            timelines.set(matCode, materialEntries);
        });

        return timelines;
    } catch (error) {
        console.error("ERRORE CRITICO CALCOLO MRP:", error);
        return new Map();
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
            newDetails.push("❌ MANCANTE: Stock e ordini totali insufficienti.");
            newDetails.push("VERIFICARE PIANO ACQUISTI.");
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
