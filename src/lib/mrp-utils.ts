
import { JobOrder, Article, RawMaterial, PurchaseOrder, ManualCommitment } from '@/types';
import { getDerivedJobStatus } from './job-status';
import { GlobalSettings } from './settings-types';
import { calculateBOMRequirement } from './inventory-utils';

export interface MRPTimelineEntry {
    jobId: string;
    materialCode: string;
    requiredQty: number;
    status: 'GREEN' | 'LOW_STOCK' | 'ORDERED' | 'AMBER' | 'LATE' | 'RED';
    projectedBalance: number;
    supplyArrivalDate?: string; 
    details: string[]; 
    totalSimQty?: number; // SSoT: Fabbisogno Totale Simulato (Engine Source)
    totalPO?: number;     // SSoT: Totale Ordini d'Acquisto Pendenti
    isFrozen?: boolean;   // Se l'impegno è congelato da una sessione officina attiva
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
    globalSettings: GlobalSettings | null,
    activeSessions: any[] = []
): Map<string, MRPTimelineEntry[]> {
    try {
        const timelines = new Map<string, MRPTimelineEntry[]>();
        
        const sessionsByMaterial = new Map<string, any[]>();
        activeSessions.forEach(s => {
            if (s.status !== 'open') return;
            const code = (s.materialCode || '').toUpperCase().trim();
            if (!sessionsByMaterial.has(code)) sessionsByMaterial.set(code, []);
            sessionsByMaterial.get(code)!.push(s);
        });

        const MRP_ACTIVE_STATUSES = [
            "DA_INIZIARE", "IN_PREPARAZIONE", "PRONTO_PROD", "IN_PRODUZIONE", "FINE_PRODUZIONE", "QLTY_PACK", 
            "Da Iniziare", "In Preparazione", "Pronto per Produzione", "In Lavorazione", "Fine Produzione", "Pronto per Finitura",
            "DA INIZIARE", "IN PREP.", "PRONTO PROD.", "IN PROD.", "FINE PROD.", "QLTY & PACK", "PRONTO",
            "Manca Materiale", "Problema", "Sospesa", "planned", "In Pianificazione", "IN_PIANIFICAZIONE", "IN_ATTESA",
            "PRODUCTION", "PAUSED", "SUSPENDED", "PIANIFICATE", "PIANIFICATA", "PLANNED", "PIANIFICATO",
            "PREP", "ATTIVO", "ACTIVE", "IN_PROGRESS", "IN_LAVORAZIONE", "CONFIRMED"
        ].map(s => s.trim().toUpperCase());

        rawMaterials.forEach(mat => {
            if (!mat || !mat.code) return;
            const matCode = mat.code.toUpperCase().trim();
            const config = (globalSettings?.rawMaterialTypes || []).find(t => t.id === mat.type) || { defaultUnit: mat.unitOfMeasure };
            const safeStock = Number(mat.minStockLevel) || 0;

            // STEP 1: Isolamento e Sanitizzazione
            const rawStock = Number(mat.currentStockUnits ?? mat.stock ?? 0);
            const initialStock = rawStock < 0 ? 0 : rawStock;
            let currentBalance = initialStock;

            // STEP 2: Normalizzazione Eventi
            const events: { type: 'SUPPLY' | 'DEMAND', date: string, qty: number, data: any, id: string, isFrozen?: boolean }[] = [];

            // 2A. SUPPLY (Purchase Orders)
            purchaseOrders.forEach(po => {
                if (!po) return;
                const status = (po.status as string || '').toLowerCase();
                if (status === 'completed' || status === 'cancelled' || status === 'received') return;
                
                const poMaterialCode = (po.materialCode || (po as any).codiceArticolo || (po as any).code || '').toUpperCase().trim();
                const matIdMatch = (po as any).materialId && (po as any).materialId === mat.id;
                const matCodeMatch = poMaterialCode === matCode;
                
                if (!(matIdMatch || matCodeMatch)) return;

                const qty = (Number(po.quantity) || 0) - (Number(po.receivedQuantity) || 0);
                if (qty <= 0) return;

                let eventDateStr: string;
                try {
                    let poDateRaw = po.expectedDeliveryDate;
                    let poDate: Date;
                    
                    if (poDateRaw && typeof poDateRaw === 'object' && poDateRaw !== null && 'toDate' in (poDateRaw as any)) {
                        poDate = (poDateRaw as any).toDate();
                    } else if (poDateRaw) {
                        poDate = new Date(poDateRaw);
                    } else {
                        poDate = new Date(NaN); 
                    }

                    const todayMidnight = new Date();
                    todayMidnight.setHours(0, 0, 0, 0);

                    if (isNaN(poDate.getTime()) || poDate < todayMidnight) {
                        const fallbackDate = new Date();
                        fallbackDate.setUTCHours(8, 0, 0, 0);
                        eventDateStr = fallbackDate.toISOString();
                    } else {
                        const safeDate = new Date(poDate);
                        safeDate.setUTCHours(8, 0, 0, 0);
                        eventDateStr = safeDate.toISOString();
                    }
                } catch (e) {
                    const fallbackDate = new Date();
                    fallbackDate.setUTCHours(8, 0, 0, 0);
                    eventDateStr = fallbackDate.toISOString();
                }

                events.push({ type: 'SUPPLY', date: eventDateStr, qty, data: po, id: po.id });
            });

            // 2B. DEMAND (Commesse)
            allJobs.forEach(job => {
                const status = (job.status || '').trim().toUpperCase();
                const isVolatile = job.id.startsWith('VOLATILE');
                const derivedStatus = getDerivedJobStatus(job);
                
                const PREP_FINISHED_STATUSES = ['PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'CHIUSO'];
                const isPrepFinished = PREP_FINISHED_STATUSES.includes(derivedStatus) || 
                                     ['PRONTO', 'PRONTO PROD', 'IN PROD', 'FINE PROD'].includes(status);

                let isFrozen = false;
                if (!isVolatile && isPrepFinished) {
                    const matSessions = sessionsByMaterial.get(matCode) || [];
                    const hasActiveSession = matSessions.some(s => {
                        const ids = s.linkedJobOrderIds || [];
                        const pfs = s.linkedJobOrderPFs || [];
                        return ids.includes(job.id) || 
                               (job.ordinePF && (ids.includes(job.ordinePF) || pfs.includes(job.ordinePF))) ||
                               (job.numeroODLInterno && ids.includes(job.numeroODLInterno));
                    });

                    if (!hasActiveSession) return;
                    isFrozen = true;
                }

                if (!isVolatile && !isFrozen && !MRP_ACTIVE_STATUSES.includes(status)) return;

                (job.billOfMaterials || []).forEach(item => {
                    if (item.status !== 'withdrawn' && (item.component || '').toUpperCase().trim() === matCode) {
                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        const finalQty = (item.fabbisognoTotale !== undefined && item.fabbisognoTotale !== null) 
                            ? Number(item.fabbisognoTotale) 
                            : req.totalInBaseUnits;
                        
                        if (finalQty <= 0) return;

                        let eventDateStr: string;
                        try {
                            const demandDateRaw = job.dataFinePreparazione || job.dataConsegnaFinale;
                            let demandDate = new Date(demandDateRaw || Date.now());
                            const todayMidnight = new Date();
                            todayMidnight.setHours(0, 0, 0, 0);
                            
                            if (isNaN(demandDate.getTime()) || demandDate < todayMidnight) {
                                const fallbackDate = new Date();
                                fallbackDate.setUTCHours(16, 0, 0, 0);
                                eventDateStr = fallbackDate.toISOString();
                            } else {
                                const safeDate = new Date(demandDate);
                                safeDate.setUTCHours(16, 0, 0, 0);
                                eventDateStr = safeDate.toISOString();
                            }
                        } catch (e) {
                            const fallbackDate = new Date();
                            fallbackDate.setUTCHours(16, 0, 0, 0);
                            eventDateStr = fallbackDate.toISOString();
                        }

                        events.push({ type: 'DEMAND', date: eventDateStr, qty: finalQty, data: job, id: job.id, isFrozen });
                    }
                });
            });

            // 2C. DEMAND (Manual Commitments)
            manualCommitments.filter(c => c && c.status === 'pending').forEach(c => {
                let finalQty = 0;
                const art = articles.find(a => a && a.code.toUpperCase() === (c.articleCode || '').toUpperCase());
                
                if (art) {
                    (art.billOfMaterials || []).forEach(item => {
                        if ((item.component || '').toUpperCase().trim() === matCode) {
                            const req = calculateBOMRequirement(c.quantity, item, mat, config as any);
                            finalQty += Number(req.totalInBaseUnits);
                        }
                    });
                } else if ((c.articleCode || '').toUpperCase().trim() === matCode) {
                    finalQty = Number(c.quantity);
                }

                if (finalQty <= 0) return;

                let eventDateStr: string;
                try {
                    let demandDate = new Date(c.deliveryDate || Date.now());
                    const todayMidnight = new Date();
                    todayMidnight.setHours(0, 0, 0, 0);

                    if (isNaN(demandDate.getTime()) || demandDate < todayMidnight) {
                        const fallbackDate = new Date();
                        fallbackDate.setUTCHours(16, 0, 0, 0);
                        eventDateStr = fallbackDate.toISOString();
                    } else {
                        const safeDate = new Date(demandDate);
                        safeDate.setUTCHours(16, 0, 0, 0);
                        eventDateStr = safeDate.toISOString();
                    }
                } catch(e) {
                    const fallbackDate = new Date();
                    fallbackDate.setUTCHours(16, 0, 0, 0);
                    eventDateStr = fallbackDate.toISOString();
                }

                events.push({ type: 'DEMAND', date: eventDateStr, qty: finalQty, data: c, id: c.id });
            });

            // STEP 3: Ordinamento Infallibile
            events.sort((a, b) => {
                const dateA = new Date(a.date).getTime();
                const dateB = new Date(b.date).getTime();
                if (dateA !== dateB) return dateA - dateB;
                
                if (a.type === 'SUPPLY' && b.type === 'DEMAND') return -1;
                if (a.type === 'DEMAND' && b.type === 'SUPPLY') return 1;
                
                return a.id.localeCompare(b.id);
            });

            // STEP 4: Simulazione e Snapshot
            const materialEntries: MRPTimelineEntry[] = [];
            let wentBelowZero = false;

            const totalPO = events.filter(e => e.type === 'SUPPLY').reduce((acc, e) => acc + e.qty, 0);
            const totalSimQtyDemand = events.filter(e => e.type === 'DEMAND' && e.id.startsWith('VOLATILE')).reduce((sum, e) => sum + e.qty, 0);

            events.forEach(ev => {
                if (ev.type === 'SUPPLY') {
                    currentBalance += ev.qty;
                } else if (ev.type === 'DEMAND') {
                    currentBalance -= ev.qty;
                    if (currentBalance < -0.001) wentBelowZero = true;

                    materialEntries.push({
                        jobId: ev.id,
                        materialCode: matCode,
                        requiredQty: ev.qty,
                        status: 'GREEN', // Segnaposto, aggiornato in STEP 5
                        projectedBalance: currentBalance,
                        details: [],
                        totalPO: totalPO,
                        totalSimQty: totalSimQtyDemand,
                        isFrozen: ev.isFrozen
                    });
                }
            });

            // STEP 5: Valutazione Stato Finale
            const absoluteFinalBalance = currentBalance;
            let finalGlobalStatus: MRPTimelineEntry['status'] = 'GREEN';
            let globalMessage = "";

            if (!wentBelowZero) {
                if (absoluteFinalBalance < safeStock) {
                    finalGlobalStatus = 'LOW_STOCK';
                    globalMessage = "⚠️ SOTTOSCORTA.";
                } else {
                    finalGlobalStatus = 'GREEN';
                    globalMessage = "✅ DISPONIBILE (Stock fisico o ampiamente coperto).";
                }
            } else {
                if (absoluteFinalBalance >= -0.001) {
                    finalGlobalStatus = 'LATE';
                    globalMessage = "🟠 IN RITARDO: La merce arriva, ma i tempi non sono allineati al bisogno.";
                } else {
                    finalGlobalStatus = 'RED';
                    globalMessage = "❌ MANCANTE: Mancante reale e permanente, stock e ordini insufficienti.";
                }
            }

            materialEntries.forEach(entry => {
                entry.status = finalGlobalStatus;
                
                if (entry.isFrozen) {
                    entry.details.push("⏳ In attesa chiusura Sessione Officina");
                }
                entry.details.push(`Fabbisogno: ${entry.requiredQty.toFixed(2)} ${mat.unitOfMeasure}`);
                entry.details.push(globalMessage);
                
                const dbg = ` [DBG: Init=${initialStock.toFixed(2)}, PO=${totalPO.toFixed(2)}, CurBalance=${entry.projectedBalance.toFixed(2)}, FinalBalance=${absoluteFinalBalance.toFixed(2)}]`;
                entry.details.push(dbg);
                
                if (finalGlobalStatus === 'LATE') {
                    // Trova il primo PO successivo alla data di questa DEMAND
                    const targetDemandDate = events.find(ev => ev.id === entry.jobId)?.date;
                    const nextSupply = events.find(e => e.type === 'SUPPLY' && new Date(e.date).getTime() > new Date(targetDemandDate || 0).getTime());
                    if (nextSupply) {
                        entry.supplyArrivalDate = nextSupply.date;
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
        
        // Priorità Stato: RED > LATE > ORDERED > LOW_STOCK > AMBER > GREEN
        let finalStatus: MRPTimelineEntry['status'] = 'GREEN';
        if (group.entries.some(e => e.status === 'RED')) finalStatus = 'RED';
        else if (group.entries.some(e => e.status === 'LATE')) finalStatus = 'LATE';
        else if (group.entries.some(e => e.status === 'ORDERED')) finalStatus = 'ORDERED';
        else if (group.entries.some(e => e.status === 'LOW_STOCK')) finalStatus = 'LOW_STOCK';
        else if (group.entries.some(e => e.status === 'AMBER')) finalStatus = 'AMBER';

        // Prendi il primo item e entry come rappresentativi per metadati (UOM, etc)
        const repItem = group.items[0];
        const repEntry = group.entries[0];

        // Estrazione Glass-Box Debug dall'entry rappresentativa (se presente)
        const debugString = repEntry.details.find(d => d.includes('[DBG:'))?.match(/\[DBG:[^\]]+\]/)?.[0] || '';

        // BUG 1 Fix: Usa direttamente totalSimQty se disponibile (Single Source of Truth dall'Engine)
        // Se non disponibile (es. righe non simulate), usa la somma calcolata
        const displayQty = (repEntry.totalSimQty !== undefined && repEntry.jobId.startsWith('VOLATILE')) 
            ? repEntry.totalSimQty 
            : totalQty;

        // Ricostruisci i dettagli aggregati
        const unit = repItem.unitOfMeasure || '';
        const newDetails: string[] = [];
        newDetails.push(`Fabbisogno Totale: ${displayQty.toFixed(2)} ${unit}`);
        
        if (finalStatus === 'RED') {
            newDetails.push(`❌ MANCANTE: Stock e ordini totali insufficienti. ${debugString}`);
            newDetails.push("VERIFICARE PIANO ACQUISTI.");
        } else if (finalStatus === 'LATE') {
            const lateEntry = group.entries.find(e => e.status === 'LATE');
            const arrivalStr = lateEntry?.supplyArrivalDate ? ` (Arrivo previsto: ${new Date(lateEntry.supplyArrivalDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })})` : '';
            newDetails.push(`🟠 IN RITARDO: Merce in arrivo o in piazzale, ma tempi non allineati${arrivalStr}. ${debugString}`);
            newDetails.push("Verificare carico a magazzino o anticipare consegna.");
        } else if (finalStatus === 'ORDERED') {
            const orderedEntry = group.entries.find(e => e.status === 'ORDERED' && e.supplyArrivalDate);
            newDetails.push(`💜 ORDINATO: In arrivo il ${orderedEntry?.supplyArrivalDate ? new Date(orderedEntry.supplyArrivalDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : 'N/D'}. ${debugString}`);
            newDetails.push("Monitorare fornitore.");
        } else if (finalStatus === 'LOW_STOCK') {
            const lowStockEntry = group.entries.find(e => e.status === 'LOW_STOCK');
            const arrivalStr = lowStockEntry?.supplyArrivalDate ? ` (Coperto da PO in arrivo il ${new Date(lowStockEntry.supplyArrivalDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })})` : '';
            newDetails.push(`⚠️ SOTTOSCORTA${arrivalStr}. ${debugString}`);
            newDetails.push("Pianificare riassortimento.");
        } else if (finalStatus === 'AMBER') {
            const amberEntry = group.entries.find(e => e.status === 'AMBER' && e.supplyArrivalDate);
            newDetails.push(`🟡 COPERTO DA ORDINE: In arrivo il ${amberEntry?.supplyArrivalDate ? new Date(amberEntry.supplyArrivalDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : 'N/D'}. ${debugString}`);
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
