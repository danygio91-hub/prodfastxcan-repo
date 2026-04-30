
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
            
            // 1. Inizializzazione Balance (SSoT: Deve usare currentStockUnits idratato)
            let startingStock = Number(mat.currentStockUnits || 0);
            
            // TASSATIVO (BUG 1): Rimuovi fallback su campo legacy 'stock' per evitare stock allucinati.
            // Se le batches idratate dicono 0, allora è 0.
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
                    // FIX 1 (Bypass String Mismatch): Filtro lasco già applicato in actions, 
                    // ma rinforziamo qui per sicurezza in caso di chiamate da altre fonti.
                    if (status === 'completed' || status === 'cancelled' || status === 'received') return false;
                    
                    const poMaterialCode = (po.materialCode || '').toUpperCase().trim();
                    const matIdMatch = (po as any).materialId && (po as any).materialId === mat.id;
                    
                    // FIX 2 (Bypass Missing materialId): Fallback su Codice Materiale se ID non presente o non matchante
                    const matCodeMatch = poMaterialCode === matCode;
                    
                    const isMatch = matIdMatch || matCodeMatch;

                    if (matCode === '50X005X33FR' && isMatch) {
                        console.log(`MRP DEBUG [50X005X33FR] - Trovato PO Matchante: ID=${po.id}, Code=${po.materialCode}, Qty=${po.quantity}, Status=${po.status}`);
                    }

                    return isMatch;
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
            // SSoT Active Statuses (Deve matchare Magazzino Live e includere varianti)
            const MRP_ACTIVE_STATUSES = [
                "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
                "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
                "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
                "Manca Materiale", "Problema", "Sospesa", "planned", "In Pianificazione", "IN_PIANIFICAZIONE", "IN_ATTESA",
                "PRODUCTION", "PAUSED", "SUSPENDED", "PIANIFICATE", "PIANIFICATA", "PLANNED", "PIANIFICATO",
                "PREP", "ATTIVO", "ACTIVE", "IN_PROGRESS", "IN_LAVORAZIONE", "CONFIRMED"
            ].map(s => s.trim().toUpperCase());

            allJobs.forEach(job => {
                if (!job.status) return;
                const status = job.status.trim().toUpperCase();
                const isVolatile = job.id.startsWith('VOLATILE');
                
                // BUG 2 Fix: In-memory Case-Insensitive Filter (SSoT Whitelist)
                if (!isVolatile && !MRP_ACTIVE_STATUSES.includes(status)) {
                    return;
                }

                (job.billOfMaterials || []).forEach(item => {
                    if (item.status !== 'withdrawn' && (item.component || '').toUpperCase().trim() === matCode) {
                        // [MRP SSoT CALCULATION] Use the shared utility to match Warehouse UI logic exactly
                        const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        
                        // Priorità 1: Valore pre-calcolato se presente (SSoT Sync)
                        // Priorità 2: Calcolo real-time tramite utility ufficiale
                        let finalQty = (item.fabbisognoTotale !== undefined && item.fabbisognoTotale !== null) 
                            ? Number(item.fabbisognoTotale) 
                            : req.totalInBaseUnits;

                        const demandQtyBase = finalQty;
                        const demandDate = job.dataFinePreparazione || job.dataConsegnaFinale || '9999-12-31';
                        
                        // PRIORITÀ INTRADAY: Forza DEMAND alle 16:00 UTC (dopo i PO delle 08:00)
                        const dWithTime = new Date(demandDate);
                        dWithTime.setUTCHours(16, 0, 0, 0);

                        events.push({
                            date: dWithTime.toISOString(),
                            qty: -Number(demandQtyBase),
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
                            // ALIGNMENT (Live Warehouse Logic): Usa la stessa logica dei manual commitments del Magazzino Live
                            const req = calculateBOMRequirement(c.quantity, item, mat, config as any);
                            const demandDate = c.deliveryDate || '9999-12-31';
                            
                            // PRIORITÀ INTRADAY: Forza DEMAND alle 16:00 UTC
                            const dWithTime = new Date(demandDate);
                            dWithTime.setUTCHours(16, 0, 0, 0);

                            // [MRP CONVERSION FIX] Blinded logic for manual commitments
                            const ratio = (mat as any).conversionRatio || (mat as any).rapportoKgMt || (mat as any).pesoMetro || (mat as any).kgMtRatio || (mat as any).conversionFactor || 0;
                            const matUnit = (mat.unitOfMeasure || '').toLowerCase();
                            
                            let demandQtyBase = req.totalInBaseUnits;
                            if (matUnit === 'kg' || ratio > 0) {
                                demandQtyBase = req.weightKg;
                            }

                            events.push({
                                date: dWithTime.toISOString(),
                                qty: -Number(demandQtyBase),
                                type: 'DEMAND',
                                id: c.id,
                                odl: `COMMIT-${c.id.substring(0, 5)}`
                            });
                        }
                    });
                } else {
                    // Se il codice del commitment manuale corrisponde direttamente al materiale
                    if ((c.articleCode || '').toUpperCase().trim() === matCode) {
                        const demandDate = c.deliveryDate || '9999-12-31';
                        const dWithTime = new Date(demandDate);
                        dWithTime.setUTCHours(16, 0, 0, 0);

                        events.push({
                            date: dWithTime.toISOString(),
                            qty: -Number(c.quantity),
                            type: 'DEMAND',
                            id: c.id,
                            odl: `DIRECT-${c.id.substring(0, 5)}`
                        });
                    }
                }
            });

            // 3. Ordinamento Cronologico Rigoroso (Stabilità garantita da ID e Tipo)
            events.sort((a, b) => {
                const dateCompare = a.date.localeCompare(b.date);
                if (dateCompare !== 0) return dateCompare;
                // A parità di data: Supply (PO) prima di Demand
                if (a.type === 'PO' && b.type !== 'PO') return -1;
                if (a.type !== 'PO' && b.type === 'PO') return 1;
                return a.id.localeCompare(b.id);
            });

            if (matCode === '50X005X33FR') {
                console.log(`MRP DEBUG [50X005X33FR] - Sorted Events:`, events.map(e => `${e.date} | ${e.type} | ${e.qty}`));
            }

            // 4. Loop di Calcolo (LOGICA PURA & GLASS-BOX DEBUG)
            const materialEntries: MRPTimelineEntry[] = [];
            
            // Calcolo Totali Distinti (Supply, Real Demand [Jobs + Commitments], Simulated Demand)
            const totalPO = events.filter(e => e.type === 'PO').reduce((sum, e) => sum + Number(e.qty), 0);
            const totalRealJobDemand = events.filter(e => !e.id.startsWith('VOLATILE') && (e.type === 'DEMAND' || e.type === 'COMMITMENT' || (e as any).type === 'COMMITMENT')).reduce((sum, e) => sum + Math.abs(Number(e.qty)), 0);
            const totalSimQtyDemand = events.filter(e => e.id.startsWith('VOLATILE')).reduce((sum, e) => sum + Math.abs(Number(e.qty)), 0);
            const totalDemand = totalRealJobDemand + totalSimQtyDemand;

            // Per ogni evento DEMAND (commessa), simuliamo il fabbisogno specifico
            events.forEach((currentEvent) => {
                if (currentEvent.type === 'PO') return; // Saltiamo i PO come target di analisi diretta

                const simQty = Math.abs(Number(currentEvent.qty));
                
                // Bilancio Finale Assoluto per questa specifica commessa 
                // (Stock + Tutti i PO - Tutte le Demand precedenti e attuali)
                const absoluteFinalBalance = initialPhysicalStock + totalPO - totalDemand;

                let runningBalance = initialPhysicalStock;
                let currentBalanceAtSim = 0;
                let coveringPODate: string | null = null;
                let foundThisEvent = false;

                // Loop Cronologico per determinare stato al momento del bisogno e PO di recupero
                for (let ev of events) {
                    runningBalance += Number(ev.qty);
                    
                    // Se l'evento è quello che stiamo analizzando (stesso ID e data)
                    if (ev.id === currentEvent.id && ev.date === currentEvent.date && !foundThisEvent) {
                        currentBalanceAtSim = runningBalance;
                        foundThisEvent = true;
                    } else if (foundThisEvent && ev.type === 'PO' && ev.date > currentEvent.date) {
                        // Se siamo già passati dal bisogno ed è un PO futuro, è un potenziale recupero
                        if (!coveringPODate) coveringPODate = ev.date;
                    }
                }

                // Glass-Box Debug String (Updated: Explicitly show SimQty)
                const dbg = ` [DBG: Stk=${initialPhysicalStock.toFixed(2)}, PO=${totalPO.toFixed(2)}, Job=${totalRealJobDemand.toFixed(2)}, Sim=${totalSimQtyDemand.toFixed(2)}, Cur=${currentBalanceAtSim.toFixed(2)}, Fin=${absoluteFinalBalance.toFixed(2)}]`;

                let status: MRPTimelineEntry['status'] = 'RED';
                let supplyArrivalDate: string | undefined = undefined;
                const details: string[] = [];

                details.push(`Fabbisogno: ${simQty.toFixed(2)} ${mat.unitOfMeasure}`);

                if (currentBalanceAtSim >= -0.001) {
                    // COPERTO (Green o Amber)
                    if (initialPhysicalStock - (totalDemand - runningBalance + currentBalanceAtSim) >= simQty - 0.001) {
                        // Nota: La logica semplificata dell'utente dice "physicalStock >= simQty" 
                        // ma dobbiamo considerare anche le demand precedenti cronologicamente.
                        // Usiamo comunque la versione pura dell'utente per aderenza alla richiesta.
                        if (initialPhysicalStock >= simQty) {
                            status = 'GREEN';
                            details.push("✅ DISPONIBILE (Stock fisico)." + dbg);
                        } else {
                            status = 'AMBER';
                            const lastPO = [...events].filter(e => e.type === 'PO' && e.date <= currentEvent.date).pop();
                            supplyArrivalDate = lastPO?.date;
                            details.push(`🟡 COPERTO DA ORDINE: In arrivo il ${supplyArrivalDate ? new Date(supplyArrivalDate).toLocaleDateString('it-IT') : 'N/D'}.` + dbg);
                        }
                    } else {
                        // Fallback AMBER se coperto cronologicamente ma non da stock iniziale
                        status = 'AMBER';
                        const lastPO = [...events].filter(e => e.type === 'PO' && e.date <= currentEvent.date).pop();
                        supplyArrivalDate = lastPO?.date;
                        details.push(`🟡 COPERTO DA ORDINE: In arrivo prima del fabbisogno.` + dbg);
                    }
                } else {
                    // È negativo al momento del bisogno. Il bilancio finale assoluto lo salva?
                    if (absoluteFinalBalance >= -0.001) {
                         status = 'LATE';
                         supplyArrivalDate = coveringPODate || undefined;
                         details.push(`🟠 IN RITARDO: In arrivo il ${supplyArrivalDate ? new Date(supplyArrivalDate).toLocaleDateString('it-IT') : 'futuro'}.` + dbg);
                    } else {
                         status = 'RED';
                         details.push("❌ MANCANTE: Stock e ordini totali insufficienti." + dbg);
                    }
                }

                materialEntries.push({
                    jobId: currentEvent.id,
                    materialCode: matCode,
                    requiredQty: simQty,
                    status,
                    projectedBalance: currentBalanceAtSim,
                    supplyArrivalDate,
                    details
                });

                if (matCode === '50X005X33FR' || matCode === '100X020TUBFR') {
                    console.log(`MRP DEBUG [${matCode}] - Status: ${status} | Job: ${currentEvent.id} | ${dbg}`);
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

        // Estrazione Glass-Box Debug dall'entry rappresentativa (se presente)
        const debugString = repEntry.details.find(d => d.includes('[DBG:'))?.match(/\[DBG:[^\]]+\]/)?.[0] || '';

        // Ricostruisci i dettagli aggregati
        const unit = repItem.unitOfMeasure || '';
        const newDetails: string[] = [];
        newDetails.push(`Fabbisogno Totale: ${totalQty.toFixed(2)} ${unit}`);
        
        if (finalStatus === 'RED') {
            newDetails.push(`❌ MANCANTE: Stock e ordini totali insufficienti. ${debugString}`);
            newDetails.push("VERIFICARE PIANO ACQUISTI.");
        } else if (finalStatus === 'LATE') {
            const lateEntry = group.entries.find(e => e.status === 'LATE' && e.supplyArrivalDate);
            newDetails.push(`🟠 IN RITARDO: In arrivo il ${lateEntry?.supplyArrivalDate ? new Date(lateEntry.supplyArrivalDate).toLocaleDateString('it-IT') : 'futuro'}. ${debugString}`);
            newDetails.push("Verificare se è possibile anticipare la consegna.");
        } else if (finalStatus === 'AMBER') {
            const amberEntry = group.entries.find(e => e.status === 'AMBER' && e.supplyArrivalDate);
            newDetails.push(`🟡 COPERTO DA ORDINE: In arrivo il ${amberEntry?.supplyArrivalDate ? new Date(amberEntry.supplyArrivalDate).toLocaleDateString('it-IT') : 'N/D'}. ${debugString}`);
            newDetails.push("Monitorare fornitore.");
        } else {
            newDetails.push(`✅ DISPONIBILE (Stock fisico). ${debugString}`);
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
