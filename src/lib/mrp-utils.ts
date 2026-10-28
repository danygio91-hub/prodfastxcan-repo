
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

            // STEP 4 & 5: Simulazione Running Balance e Valutazione Cronologica per Singola Commessa
            const materialEntries: MRPTimelineEntry[] = [];
            const totalPO = events.filter(e => e.type === 'SUPPLY').reduce((acc, e) => acc + e.qty, 0);
            const totalSimQtyDemand = events.filter(e => e.type === 'DEMAND' && e.id.startsWith('VOLATILE')).reduce((sum, e) => sum + e.qty, 0);
            const totalDemand = events.filter(e => e.type === 'DEMAND').reduce((acc, e) => acc + e.qty, 0);
            const absoluteFinalBalance = initialStock + totalPO - totalDemand;

            events.forEach(ev => {
                if (ev.type === 'SUPPLY') {
                    currentBalance += ev.qty;
                } else if (ev.type === 'DEMAND') {
                    currentBalance -= ev.qty;
                    const curBalanceAtEvent = currentBalance;

                    // Ordini fornitore arrivati prima o alla stessa data di questa commessa
                    const cumulativePO = events
                        .filter(e => e.type === 'SUPPLY' && new Date(e.date).getTime() <= new Date(ev.date).getTime())
                        .reduce((sum, e) => sum + Number(e.qty), 0);

                    // Ordini fornitore futuri (consegna successiva alla data di questa commessa)
                    const futureSupply = events.filter(e => e.type === 'SUPPLY' && new Date(e.date).getTime() > new Date(ev.date).getTime());
                    const totalFuturePO = futureSupply.reduce((sum, e) => sum + Number(e.qty), 0);

                    let status: MRPTimelineEntry['status'] = 'RED';
                    let supplyArrivalDate: string | undefined = undefined;
                    const details: string[] = [];

                    if (ev.isFrozen) {
                        details.push("⏳ In attesa chiusura Sessione Officina");
                    }
                    details.push(`Fabbisogno: ${ev.qty.toFixed(2)} ${mat.unitOfMeasure}`);

                    // RUNNING BALANCE TIME-PHASED:
                    // Il semaforo dipende ESCLUSIVAMENTE dallo Stock Proiettato (CurBalance) al momento di QUESTA specifica commessa
                    if (curBalanceAtEvent >= -0.001) {
                        // COPERTO: Stock proiettato sufficiente
                        if (curBalanceAtEvent - cumulativePO >= -0.001) {
                            if (curBalanceAtEvent < safeStock) {
                                status = 'LOW_STOCK';
                                details.push("⚠️ SOTTOSCORTA.");
                            } else {
                                status = 'GREEN';
                                details.push("✅ DISPONIBILE (Stock fisico o coperto).");
                            }
                        } else {
                            status = 'ORDERED';
                            const lastPO = events.filter(e => e.type === 'SUPPLY' && new Date(e.date).getTime() <= new Date(ev.date).getTime()).pop();
                            supplyArrivalDate = lastPO?.date;
                            details.push(`💜 ORDINATO: Coperto da ordine fornitore.`);
                        }
                    } else {
                        // SCOPERTO (CurBalance < 0 alla data della commessa)
                        // C'è un ordine d'acquisto (PO) emesso per questo materiale (futuro o pendente)?
                        const hasCoveringPO = futureSupply.length > 0 || totalPO > 0;
                        if (hasCoveringPO) {
                            status = 'LATE';
                            supplyArrivalDate = futureSupply[0]?.date;
                            details.push("🟠 IN RITARDO: Merce coperta da ordine fornitore ma con arrivo successivo alla data richiesta.");
                        } else {
                            status = 'RED';
                            details.push("❌ MANCANTE: Nessun ordine fornitore a copertura. Necessario acquistare.");
                        }
                    }

                    const dbg = ` [DBG: Init=${initialStock.toFixed(2)}, PO=${totalPO.toFixed(2)}, CurBalance=${curBalanceAtEvent.toFixed(2)}, FinalBalance=${absoluteFinalBalance.toFixed(2)}]`;
                    details.push(dbg);

                    materialEntries.push({
                        jobId: ev.id,
                        materialCode: matCode,
                        requiredQty: ev.qty,
                        status,
                        projectedBalance: curBalanceAtEvent,
                        supplyArrivalDate,
                        details,
                        totalPO,
                        totalSimQty: totalSimQtyDemand,
                        isFrozen: ev.isFrozen
                    });
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

export type MRPVisualAlarmStatus = 'RED' | 'LATE' | 'ORDERED' | 'LOW_STOCK' | 'GREEN';

export interface MRPAlarmTimelineEntry<TJob = any> {
    entry: MRPTimelineEntry;
    job?: TJob;
    visualStatus: MRPVisualAlarmStatus;
    jobDate?: string;
    isUncovered: boolean;
}

export interface MaterialAlarmItem<TJob = any> {
    matCode: string;
    materialName: string;
    materialType: string; // Categoria / Famiglia merceologica (es. "GUAINA", "TUBI", "CAVO FLEX")
    worstStatus: MRPVisualAlarmStatus;
    isAlarm: boolean; // True SOLO se worstStatus è 'RED' o 'LATE'
    isUnderControl: boolean; // True se worstStatus è 'ORDERED' (coperte da PO in tempo)
    countRed: number;
    countLate: number;
    countOrdered: number;
    entriesWithVisual: MRPAlarmTimelineEntry<TJob>[];
}

export interface GroupedAlarmCategory<TJob = any> {
    category: string;
    worstCategoryStatus: 'RED' | 'LATE';
    materials: MaterialAlarmItem<TJob>[];
}

export interface GroupedUnderControlCategory<TJob = any> {
    category: string;
    materials: MaterialAlarmItem<TJob>[];
}

export interface ClassifiedMRPAlarms<TJob = any> {
    alarmMaterials: MaterialAlarmItem<TJob>[];
    alarmCount: number; // SSoT per i badge rossi: solo materiali con RED o LATE
    underControlMaterials: MaterialAlarmItem<TJob>[];
    underControlCount: number;
    groupedAlarms: GroupedAlarmCategory<TJob>[];
    groupedUnderControl: GroupedUnderControlCategory<TJob>[];
}

export interface ClassifyMRPAlarmsParams<TJob = any> {
    mrpTimelines: Map<string, MRPTimelineEntry[]>;
    allJobs: TJob[];
    rawMaterials: RawMaterial[];
    purchaseOrders?: PurchaseOrder[];
}

/**
 * Single Source of Truth (SSoT) per la classificazione e il conteggio universale degli allarmi MRP.
 * 
 * REGOLA TASSATIVA:
 * Un materiale è considerato un "Allarme" (e incrementa i badge numerici rossi) SOLO SE ha almeno
 * una commessa in stato 🔴 MANCANTE (Red) o 🟠 IN RITARDO (Orange).
 * 
 * Se per un materiale TUTTE le commesse scoperte sono in stato 💜 ORDINATO / IN ARRIVO
 * (coperte da PO nei tempi corretti), quel materiale NON DEVE figurare nel conteggio degli allarmi globali.
 * Viene invece classificato nella sezione "Sotto Controllo".
 */
export function classifyGlobalMRPAlarms<TJob = any>({
    mrpTimelines,
    allJobs,
    rawMaterials,
    purchaseOrders = []
}: ClassifyMRPAlarmsParams<TJob>): ClassifiedMRPAlarms<TJob> {
    const alarmMaterials: MaterialAlarmItem<TJob>[] = [];
    const underControlMaterials: MaterialAlarmItem<TJob>[] = [];

    mrpTimelines.forEach((entries, matCode) => {
        if (!entries || entries.length === 0) return;

        const normalizedCode = matCode.toUpperCase().trim();
        const material = rawMaterials.find(m => (m?.code || '').toUpperCase().trim() === normalizedCode);
        const materialName = material?.description || '';
        // Logica unificata di estrazione Categoria/Famiglia merceologica
        const materialType = ((material as any)?.category || materialName.split(' ')[0] || 'ALTRO').toUpperCase().trim();

        // PO aperti pendenti per questo materiale
        const pendingPOs = purchaseOrders.filter(po => {
            if (!po) return false;
            const status = (po.status as string || '').toLowerCase();
            if (status === 'completed' || status === 'cancelled' || status === 'received') return false;
            const poCode = (po.materialCode || (po as any).codiceArticolo || (po as any).code || '').toUpperCase().trim();
            return poCode === normalizedCode || (po as any).materialId === normalizedCode || (material?.id && (po as any).materialId === material.id);
        });

        const entriesWithVisual: MRPAlarmTimelineEntry<TJob>[] = entries.map(entry => {
            const job = allJobs.find(j => (j as any).id === entry.jobId);
            const jobDate = (job as any)?.dataFinePreparazione || (job as any)?.dataConsegnaFinale;
            
            const isUncovered = entry.projectedBalance < -0.001;
            const hasPO = pendingPOs.length > 0 || (entry.totalPO || 0) > 0;

            let visualStatus: MRPVisualAlarmStatus;

            if (isUncovered) {
                // Stock Proiettato < 0: se coperto da PO con arrivo successivo -> LATE, altrimenti RED
                if (entry.status === 'LATE' || hasPO) {
                    visualStatus = 'LATE';
                } else {
                    visualStatus = 'RED';
                }
            } else {
                // Stock Proiettato >= 0: se coperto grazie a PO -> ORDERED, altrimenti GREEN o LOW_STOCK
                if (entry.status === 'ORDERED' || entry.status === 'AMBER') {
                    visualStatus = 'ORDERED';
                } else if (entry.status === 'LOW_STOCK') {
                    visualStatus = 'LOW_STOCK';
                } else {
                    visualStatus = 'GREEN';
                }
            }

            return {
                entry,
                job,
                visualStatus,
                jobDate,
                isUncovered
            };
        }).sort((a, b) => {
            const dateA = a.jobDate || '9999-12-31';
            const dateB = b.jobDate || '9999-12-31';
            return dateA.localeCompare(dateB);
        });

        const countRed = entriesWithVisual.filter(e => e.visualStatus === 'RED').length;
        const countLate = entriesWithVisual.filter(e => e.visualStatus === 'LATE').length;
        const countOrdered = entriesWithVisual.filter(e => e.visualStatus === 'ORDERED').length;

        const worstStatus: MRPVisualAlarmStatus = 
            countRed > 0 ? 'RED' :
            countLate > 0 ? 'LATE' :
            countOrdered > 0 ? 'ORDERED' :
            entriesWithVisual.some(e => e.visualStatus === 'LOW_STOCK') ? 'LOW_STOCK' : 'GREEN';

        // REGOLA TASSATIVA SSoT:
        const isAlarm = countRed > 0 || countLate > 0;
        const isUnderControl = !isAlarm && countOrdered > 0;

        const item: MaterialAlarmItem<TJob> = {
            matCode: normalizedCode,
            materialName,
            materialType,
            worstStatus,
            isAlarm,
            isUnderControl,
            countRed,
            countLate,
            countOrdered,
            entriesWithVisual
        };

        if (isAlarm) {
            alarmMaterials.push(item);
        } else if (isUnderControl) {
            underControlMaterials.push(item);
        }
    });

    // Raggruppamento Allarmi per Categoria/Famiglia
    const alarmCategoriesMap = new Map<string, MaterialAlarmItem<TJob>[]>();
    alarmMaterials.forEach(mat => {
        if (!alarmCategoriesMap.has(mat.materialType)) {
            alarmCategoriesMap.set(mat.materialType, []);
        }
        alarmCategoriesMap.get(mat.materialType)!.push(mat);
    });

    const groupedAlarms: GroupedAlarmCategory<TJob>[] = Array.from(alarmCategoriesMap.entries()).map(([category, items]) => {
        const hasRed = items.some(m => m.worstStatus === 'RED');
        const worstCategoryStatus: 'RED' | 'LATE' = hasRed ? 'RED' : 'LATE';

        // Ordine materiali nel gruppo: RED prima di LATE, poi alfabetico per codice
        items.sort((a, b) => {
            if (a.worstStatus === 'RED' && b.worstStatus !== 'RED') return -1;
            if (a.worstStatus !== 'RED' && b.worstStatus === 'RED') return 1;
            return a.matCode.localeCompare(b.matCode);
        });

        return {
            category,
            worstCategoryStatus,
            materials: items
        };
    });

    // ORDINAMENTO VISIVO GRUPPI:
    // In cima i gruppi con materiali 🔴 MANCANTE, a seguire quelli 🟠 IN RITARDO.
    // A parità di severità, ordine alfabetico per categoria.
    groupedAlarms.sort((a, b) => {
        if (a.worstCategoryStatus === 'RED' && b.worstCategoryStatus !== 'RED') return -1;
        if (a.worstCategoryStatus !== 'RED' && b.worstCategoryStatus === 'RED') return 1;
        return a.category.localeCompare(b.category);
    });

    // Raggruppamento Materiali "Sotto Controllo" (💜 ORDERED in arrivo nei tempi)
    const underControlCategoriesMap = new Map<string, MaterialAlarmItem<TJob>[]>();
    underControlMaterials.forEach(mat => {
        if (!underControlCategoriesMap.has(mat.materialType)) {
            underControlCategoriesMap.set(mat.materialType, []);
        }
        underControlCategoriesMap.get(mat.materialType)!.push(mat);
    });

    const groupedUnderControl: GroupedUnderControlCategory<TJob>[] = Array.from(underControlCategoriesMap.entries()).map(([category, items]) => {
        items.sort((a, b) => a.matCode.localeCompare(b.matCode));
        return {
            category,
            materials: items
        };
    }).sort((a, b) => a.category.localeCompare(b.category));

    return {
        alarmMaterials,
        alarmCount: alarmMaterials.length,
        underControlMaterials,
        underControlCount: underControlMaterials.length,
        groupedAlarms,
        groupedUnderControl
    };
}

