
import { JobOrder, Article, RawMaterial, PurchaseOrder, ManualCommitment } from '@/types';
import { getDerivedJobStatus } from './job-status';
import { GlobalSettings } from './settings-types';
import { calculateBOMRequirement } from './inventory-utils';
import { parseRobustDate } from './utils';
import { format } from 'date-fns';

export interface MRPTimelineEntry {
    jobId: string;
    materialCode: string;
    requiredQty: number;
    status: 'GREEN' | 'LOW_STOCK' | 'ORDERED' | 'AMBER' | 'SUPPLIER_LATE' | 'EXPEDITE_NEEDED' | 'LATE' | 'RED';
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

            // STEP 1: Isolamento Stock Fisico Attuale
            const rawStock = Number(mat.currentStockUnits ?? mat.stock ?? 0);
            const initialStock = rawStock < 0 ? 0 : rawStock;
            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);

            // STEP 2A: Normalizzazione SUPPLY (Purchase Orders)
            interface SupplyEntry {
                id: string;
                orderNumber: string;
                supplierName: string;
                qty: number;
                remainingQty: number;
                parsedDate: Date | null;
                supplyDateObj: Date;
                dateStr: string;
                isOverdue: boolean;
            }

            const supplies: SupplyEntry[] = [];
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

                const parsedDate = parseRobustDate(po.expectedDeliveryDate);
                const isOverdue = parsedDate !== null && parsedDate.getTime() < todayMidnight.getTime();

                let supplyDateObj: Date;
                if (parsedDate) {
                    supplyDateObj = new Date(parsedDate);
                    supplyDateObj.setHours(8, 0, 0, 0);
                } else {
                    supplyDateObj = new Date();
                    supplyDateObj.setHours(8, 0, 0, 0);
                }

                supplies.push({
                    id: po.id,
                    orderNumber: po.orderNumber || (po as any).numeroOrdine || 'N/D',
                    supplierName: po.supplierName || 'Fornitore',
                    qty,
                    remainingQty: qty,
                    parsedDate,
                    supplyDateObj,
                    dateStr: supplyDateObj.toISOString(),
                    isOverdue
                });
            });

            supplies.sort((a, b) => {
                const diff = a.supplyDateObj.getTime() - b.supplyDateObj.getTime();
                if (diff !== 0) return diff;
                return a.id.localeCompare(b.id);
            });

            // STEP 2B: Normalizzazione DEMAND (Commesse + Manual Commitments)
            interface DemandEntry {
                id: string;
                qty: number;
                parsedDate: Date | null;
                demandDateObj: Date;
                dateStr: string;
                data: any;
                isFrozen?: boolean;
            }

            const demands: DemandEntry[] = [];

            // Commesse
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
                    const compCode = (item.component || '').toUpperCase().trim();
                    if (item.status !== 'withdrawn' && compCode === matCode) {
                        // FASE 45: Esclusione C.to Lavoro (Silenziatore Impegni per Commessa)
                        // Se l'articolo in esame è presente nell'array externalizedMaterials di questa commessa,
                        // la sua quantità NON viene sommata al fabbisogno: l'impegno è silenziato.
                        const isExternalized = Array.isArray(job.externalizedMaterials) &&
                            job.externalizedMaterials.some(m => (m || '').toUpperCase().trim() === matCode);
                        if (isExternalized) return;

                        const req = calculateBOMRequirement(job.qta, item, mat, config as any);
                        const finalQty = (item.fabbisognoTotale !== undefined && item.fabbisognoTotale !== null) 
                            ? Number(item.fabbisognoTotale) 
                            : req.totalInBaseUnits;
                        
                        if (finalQty <= 0) return;

                        const demandDateRaw = job.dataFinePreparazione || job.dataConsegnaFinale;
                        const parsedDemandDate = parseRobustDate(demandDateRaw);
                        let demandDateObj: Date;
                        if (parsedDemandDate) {
                            demandDateObj = new Date(parsedDemandDate);
                            demandDateObj.setHours(16, 0, 0, 0);
                        } else {
                            demandDateObj = new Date();
                            demandDateObj.setHours(16, 0, 0, 0);
                        }

                        demands.push({
                            id: job.id,
                            qty: finalQty,
                            parsedDate: parsedDemandDate,
                            demandDateObj,
                            dateStr: demandDateObj.toISOString(),
                            data: job,
                            isFrozen
                        });
                    }
                });
            });

            // Manual Commitments
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

                const parsedDemandDate = parseRobustDate(c.deliveryDate);
                let demandDateObj: Date;
                if (parsedDemandDate) {
                    demandDateObj = new Date(parsedDemandDate);
                    demandDateObj.setHours(16, 0, 0, 0);
                } else {
                    demandDateObj = new Date();
                    demandDateObj.setHours(16, 0, 0, 0);
                }

                demands.push({
                    id: c.id,
                    qty: finalQty,
                    parsedDate: parsedDemandDate,
                    demandDateObj,
                    dateStr: demandDateObj.toISOString(),
                    data: c
                });
            });

            // STEP 3: Ordinamento Cronologico Fabbisogni
            demands.sort((a, b) => {
                const diff = a.demandDateObj.getTime() - b.demandDateObj.getTime();
                if (diff !== 0) return diff;
                return a.id.localeCompare(b.id);
            });

            // STEP 4 & 5: Simulazione MRP Time-Phased con Pegging tra Stock Fisico e Ordini Fornitore
            let availablePhysicalStock = initialStock;
            const totalPO = supplies.reduce((acc, s) => acc + s.qty, 0);
            const totalSimQtyDemand = demands.filter(d => d.id.startsWith('VOLATILE')).reduce((sum, d) => sum + d.qty, 0);
            const totalDemand = demands.reduce((acc, d) => acc + d.qty, 0);
            const absoluteFinalBalance = initialStock + totalPO - totalDemand;

            const materialEntries: MRPTimelineEntry[] = [];

            demands.forEach(dem => {
                let neededQty = dem.qty;
                let coveredByPhysical = 0;
                let coveredByOnTimePO = 0;
                let coveredByOverduePO = 0;
                let coveredByLateArrivalPO = 0;
                let uncoveredQty = 0;

                const overduePODetails: string[] = [];
                const expeditePODetails: { orderNumber: string; supplierDate: string }[] = [];
                const onTimePODetails: string[] = [];
                let supplyArrivalDate: string | undefined = undefined;

                // 1. Priorità assoluta allo stock fisico presente a magazzino
                if (availablePhysicalStock > 0) {
                    const take = Math.min(availablePhysicalStock, neededQty);
                    coveredByPhysical += take;
                    availablePhysicalStock -= take;
                    neededQty -= take;
                }

                // 2. Se lo stock fisico non basta, attinge agli ordini fornitore in ordine cronologico
                if (neededQty > 0.0001) {
                    for (const supply of supplies) {
                        if (neededQty <= 0.0001) break;
                        if (supply.remainingQty <= 0.0001) continue;

                        const take = Math.min(supply.remainingQty, neededQty);
                        supply.remainingQty -= take;
                        neededQty -= take;

                        const supplyTime = supply.supplyDateObj.getTime();
                        const demandTime = dem.demandDateObj.getTime();
                        const formattedDate = supply.parsedDate ? format(supply.parsedDate, 'dd/MM/yyyy') : 'N/D';

                        if (supply.isOverdue) {
                            // Ordine fornitore scaduto nel passato (< oggi) -> SUPPLIER_LATE
                            coveredByOverduePO += take;
                            overduePODetails.push(`PO ${supply.orderNumber} del ${formattedDate}`);
                            if (!supplyArrivalDate) supplyArrivalDate = supply.dateStr;
                        } else if (supplyTime > demandTime) {
                            // Ordine fornitore futuro ma che arriva dopo la data richiesta dalla commessa -> EXPEDITE_NEEDED
                            coveredByLateArrivalPO += take;
                            expeditePODetails.push({ orderNumber: supply.orderNumber, supplierDate: formattedDate });
                            if (!supplyArrivalDate) supplyArrivalDate = supply.dateStr;
                        } else {
                            // Ordine fornitore in arrivo in tempo
                            coveredByOnTimePO += take;
                            onTimePODetails.push(`PO ${supply.orderNumber} in arrivo il ${formattedDate}`);
                            if (!supplyArrivalDate) supplyArrivalDate = supply.dateStr;
                        }
                    }
                }

                if (neededQty > 0.0001) {
                    uncoveredQty = neededQty;
                }

                let status: MRPTimelineEntry['status'] = 'RED';
                const details: string[] = [];

                if (dem.isFrozen) {
                    details.push("⏳ In attesa chiusura Sessione Officina");
                }
                details.push(`Fabbisogno: ${dem.qty.toFixed(2)} ${mat.unitOfMeasure}`);

                const demandFormattedDate = dem.parsedDate ? format(dem.parsedDate, 'dd/MM/yyyy') : 'N/D';

                // REGOLE TIME-PHASED MRP RIGOROSE (SDOPPIAMENTO FASE 35):
                if (uncoveredQty > 0.0001) {
                    status = 'RED';
                    details.push(`❌ MANCANTE: Stock fisico e ordini insufficienti (Mancano ${uncoveredQty.toFixed(2)} ${mat.unitOfMeasure}). Necessario acquistare.`);
                } else if (coveredByOverduePO > 0.0001) {
                    status = 'SUPPLIER_LATE';
                    const poOverdueStr = overduePODetails.join('; ');
                    details.push(`🔴 RITARDO FORNITORE: Coperto da ordine SCADUTO non ancora consegnato (${poOverdueStr}). Sollecitare fornitore!`);
                } else if (coveredByLateArrivalPO > 0.0001) {
                    status = 'EXPEDITE_NEEDED';
                    const supplyDatesStr = expeditePODetails.map(e => `${e.supplierDate}${e.orderNumber && e.orderNumber !== 'N/D' ? ` (PO ${e.orderNumber})` : ''}`).join(', ');
                    details.push(`🟠 ARRIVO LUNGO: Coperto da ordine in arrivo il ${supplyDatesStr}, successivo alla consegna commessa (${demandFormattedDate}). Anticipare fornitura o riprogrammare!`);
                } else if (coveredByOnTimePO > 0.0001) {
                    status = 'ORDERED';
                    details.push(`💜 ORDINATO: Coperto da ordine fornitore nei tempi (${onTimePODetails.join('; ')}). In arrivo nei tempi.`);
                } else {
                    if (availablePhysicalStock < safeStock) {
                        status = 'LOW_STOCK';
                        details.push(`⚠️ SOTTOSCORTA: Coperto da stock fisico attuale, residuo sotto scorta minima (${safeStock} ${mat.unitOfMeasure}).`);
                    } else {
                        status = 'GREEN';
                        details.push("✅ DISPONIBILE: Coperto da stock fisico presente a magazzino.");
                    }
                }

                // Saldo proiettato alla data della commessa:
                // Se coperto da stock fisico o PO in tempo: >= 0
                // Se coperto da PO in ritardo o mancante: valore negativo indicante la scopertura
                let projectedBalance: number;
                if (status === 'GREEN' || status === 'LOW_STOCK') {
                    projectedBalance = availablePhysicalStock;
                } else if (status === 'ORDERED') {
                    projectedBalance = 0;
                } else {
                    projectedBalance = -(coveredByOverduePO + coveredByLateArrivalPO + uncoveredQty);
                }

                const dbg = ` [DBG: PhysStock=${initialStock.toFixed(2)}, Dem=${dem.qty.toFixed(2)}, PhysCov=${coveredByPhysical.toFixed(2)}, OnTimePO=${coveredByOnTimePO.toFixed(2)}, OverduePO=${coveredByOverduePO.toFixed(2)}, LateArrivalPO=${coveredByLateArrivalPO.toFixed(2)}, Missing=${uncoveredQty.toFixed(2)}, BalAtDate=${projectedBalance.toFixed(2)}]`;
                details.push(dbg);

                materialEntries.push({
                    jobId: dem.id,
                    materialCode: matCode,
                    requiredQty: dem.qty,
                    status,
                    projectedBalance,
                    supplyArrivalDate,
                    details,
                    totalPO,
                    totalSimQty: totalSimQtyDemand,
                    isFrozen: dem.isFrozen
                });
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
        
        // Priorità Stato: RED > SUPPLIER_LATE > EXPEDITE_NEEDED > LATE > ORDERED > LOW_STOCK > AMBER > GREEN
        let finalStatus: MRPTimelineEntry['status'] = 'GREEN';
        if (group.entries.some(e => e.status === 'RED')) finalStatus = 'RED';
        else if (group.entries.some(e => e.status === 'SUPPLIER_LATE')) finalStatus = 'SUPPLIER_LATE';
        else if (group.entries.some(e => e.status === 'EXPEDITE_NEEDED')) finalStatus = 'EXPEDITE_NEEDED';
        else if (group.entries.some(e => e.status === 'LATE')) finalStatus = 'LATE';
        else if (group.entries.some(e => e.status === 'ORDERED')) finalStatus = 'ORDERED';
        else if (group.entries.some(e => e.status === 'LOW_STOCK')) finalStatus = 'LOW_STOCK';
        else if (group.entries.some(e => e.status === 'AMBER')) finalStatus = 'AMBER';

        // Prendi il primo item e l'entry corrispondente al finalStatus per mostrare il corretto glass-box debug
        const repItem = group.items[0];
        const repEntry = group.entries.find(e => e.status === finalStatus) || group.entries[0];

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
        } else if (finalStatus === 'SUPPLIER_LATE') {
            const entry = group.entries.find(e => e.status === 'SUPPLIER_LATE');
            const specificDetail = entry?.details.find(d => d.includes('RITARDO FORNITORE')) || '';
            if (specificDetail) {
                newDetails.push(`${specificDetail} ${debugString}`);
            } else {
                newDetails.push(`🔴 RITARDO FORNITORE: Coperto da ordine SCADUTO non ancora consegnato. Sollecitare fornitore! ${debugString}`);
            }
            newDetails.push("Sollecitare immediatamente il fornitore.");
        } else if (finalStatus === 'EXPEDITE_NEEDED') {
            const entry = group.entries.find(e => e.status === 'EXPEDITE_NEEDED');
            const specificDetail = entry?.details.find(d => d.includes('ARRIVO LUNGO')) || '';
            if (specificDetail) {
                newDetails.push(`${specificDetail} ${debugString}`);
            } else {
                newDetails.push(`🟠 ARRIVO LUNGO: Coperto da ordine in arrivo dopo la consegna commessa. Anticipare fornitura o riprogrammare! ${debugString}`);
            }
            newDetails.push("Anticipare fornitura o riprogrammare commessa.");
        } else if (finalStatus === 'LATE') {
            const lateEntry = group.entries.find(e => e.status === 'LATE');
            const arrivalStr = lateEntry?.supplyArrivalDate ? ` (Arrivo previsto: ${new Date(lateEntry.supplyArrivalDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })})` : '';
            newDetails.push(`🟠 IN RITARDO: Merce in arrivo o in piazzale, ma tempi non allineati${arrivalStr}. ${debugString}`);
            newDetails.push("Verificare carico a magazzino o anticipare consegna.");
        } else if (finalStatus === 'ORDERED') {
            const orderedEntry = group.entries.find(e => e.status === 'ORDERED' && e.supplyArrivalDate) || group.entries.find(e => e.status === 'ORDERED');
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

export type MRPVisualAlarmStatus = 'RED' | 'SUPPLIER_LATE' | 'EXPEDITE_NEEDED' | 'LATE' | 'ORDERED' | 'LOW_STOCK' | 'GREEN';

export interface MRPAlarmTimelineEntry<TJob = any> {
    entry: MRPTimelineEntry;
    job?: TJob;
    visualStatus: MRPVisualAlarmStatus;
    jobDate?: string;
    isUncovered: boolean;
    isMuted?: boolean;
}

export interface MutedMRPAlarmItem<TJob = any> {
    jobId: string;
    job?: TJob;
    matCode: string;
    materialName?: string;
    materialType?: string;
    requiredQty: number;
    projectedBalance: number;
    jobDate?: string;
    visualStatus: MRPVisualAlarmStatus;
    details?: string[];
}

export interface MaterialAlarmItem<TJob = any> {
    matCode: string;
    materialName: string;
    materialType: string; // Categoria / Famiglia merceologica (es. "GUAINA", "TUBI", "CAVO FLEX")
    worstStatus: MRPVisualAlarmStatus;
    isAlarm: boolean; // True SOLO se worstStatus è 'RED', 'SUPPLIER_LATE', 'EXPEDITE_NEEDED' (o legacy 'LATE')
    isUnderControl: boolean; // True se worstStatus è 'ORDERED' (coperte da PO in tempo)
    countRed: number;
    countSupplierLate: number;
    countExpediteNeeded: number;
    countLate: number;
    countOrdered: number;
    criticalDate?: string | null; // FASE 46: Data grezza di consegna più imminente tra le commesse in allarme
    criticalDateFormatted?: string | null; // FASE 46: Data formattata "DD/MM/YYYY"
    isCriticalDateUrgent?: boolean; // FASE 46: True se la data critica è oggi o nel passato
    entriesWithVisual: MRPAlarmTimelineEntry<TJob>[];
}

export interface GroupedAlarmCategory<TJob = any> {
    category: string;
    worstCategoryStatus: 'RED' | 'SUPPLIER_LATE' | 'EXPEDITE_NEEDED' | 'LATE';
    materials: MaterialAlarmItem<TJob>[];
}

export interface GroupedUnderControlCategory<TJob = any> {
    category: string;
    materials: MaterialAlarmItem<TJob>[];
}

export interface ClassifiedMRPAlarms<TJob = any> {
    alarmMaterials: MaterialAlarmItem<TJob>[];
    alarmCount: number; // SSoT per i badge rossi: solo materiali con RED, SUPPLIER_LATE o EXPEDITE_NEEDED
    underControlMaterials: MaterialAlarmItem<TJob>[];
    underControlCount: number;
    groupedAlarms: GroupedAlarmCategory<TJob>[];
    groupedUnderControl: GroupedUnderControlCategory<TJob>[];
    mutedAlarms: MutedMRPAlarmItem<TJob>[]; // FASE 44: Allarmi silenziati per singola commessa
    mutedCount: number;
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
 * una commessa in stato 🔴 MANCANTE (Red), 🔴 RITARDO FORNITORE (Supplier Late) o 🟠 DA ANTICIPARE (Expedite Needed).
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
    const mutedAlarms: MutedMRPAlarmItem<TJob>[] = [];

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

        const entriesWithVisual: MRPAlarmTimelineEntry<TJob>[] = [];

        entries.forEach(entry => {
            const job = allJobs.find(j => (j as any).id === entry.jobId);
            const jobDate = (job as any)?.dataFinePreparazione || (job as any)?.dataConsegnaFinale;
            
            const isUncovered = entry.status === 'RED' || 
                entry.status === 'SUPPLIER_LATE' || 
                entry.status === 'EXPEDITE_NEEDED' || 
                entry.status === 'LATE' || 
                entry.projectedBalance < -0.001;

            let visualStatus: MRPVisualAlarmStatus;
            if (entry.status === 'RED') {
                visualStatus = 'RED';
            } else if (entry.status === 'SUPPLIER_LATE') {
                visualStatus = 'SUPPLIER_LATE';
            } else if (entry.status === 'EXPEDITE_NEEDED') {
                visualStatus = 'EXPEDITE_NEEDED';
            } else if (entry.status === 'LATE') {
                visualStatus = 'LATE';
            } else if (entry.status === 'ORDERED' || entry.status === 'AMBER') {
                visualStatus = 'ORDERED';
            } else if (entry.status === 'LOW_STOCK') {
                visualStatus = 'LOW_STOCK';
            } else {
                visualStatus = 'GREEN';
            }

            // FASE 44: Filtro Silenzioso mirato per singola commessa
            const jobMutedList: string[] = (job as any)?.mutedMaterials || [];
            const isMuted = Array.isArray(jobMutedList) && jobMutedList.some(
                (code: string) => (code || '').toUpperCase().trim() === normalizedCode
            );

            if (isMuted) {
                // Se la commessa ha silenziato questo materiale ed è in deficit, raccoglie in mutedAlarms
                if (isUncovered) {
                    mutedAlarms.push({
                        jobId: entry.jobId,
                        job,
                        matCode: normalizedCode,
                        materialName,
                        materialType,
                        requiredQty: entry.requiredQty,
                        projectedBalance: entry.projectedBalance,
                        jobDate,
                        visualStatus,
                        details: entry.details
                    });
                }
                // Escluso dalla lista principale e dai conteggi rossi degli allarmi!
                return;
            }

            entriesWithVisual.push({
                entry,
                job,
                visualStatus,
                jobDate,
                isUncovered,
                isMuted: false
            });
        });

        // Se tutti i fabbisogni sono stati silenziati o non ce ne sono, non creare allarmi attivi per questo materiale
        if (entriesWithVisual.length === 0) return;

        entriesWithVisual.sort((a, b) => {
            const dateA = a.jobDate || '9999-12-31';
            const dateB = b.jobDate || '9999-12-31';
            return dateA.localeCompare(dateB);
        });

        const countRed = entriesWithVisual.filter(e => e.visualStatus === 'RED').length;
        const countSupplierLate = entriesWithVisual.filter(e => e.visualStatus === 'SUPPLIER_LATE').length;
        const countExpediteNeeded = entriesWithVisual.filter(e => e.visualStatus === 'EXPEDITE_NEEDED').length;
        const countLate = entriesWithVisual.filter(e => e.visualStatus === 'LATE' || e.visualStatus === 'SUPPLIER_LATE' || e.visualStatus === 'EXPEDITE_NEEDED').length;
        const countOrdered = entriesWithVisual.filter(e => e.visualStatus === 'ORDERED').length;

        const worstStatus: MRPVisualAlarmStatus = 
            countRed > 0 ? 'RED' :
            countSupplierLate > 0 ? 'SUPPLIER_LATE' :
            countExpediteNeeded > 0 ? 'EXPEDITE_NEEDED' :
            countLate > 0 ? 'LATE' :
            countOrdered > 0 ? 'ORDERED' :
            entriesWithVisual.some(e => e.visualStatus === 'LOW_STOCK') ? 'LOW_STOCK' : 'GREEN';

        // REGOLA TASSATIVA SSoT:
        // Entrambi gli stati SUPPLIER_LATE ed EXPEDITE_NEEDED contribuiscono al conteggio allarmi
        const isAlarm = countRed > 0 || countSupplierLate > 0 || countExpediteNeeded > 0 || countLate > 0;
        const isUnderControl = !isAlarm && countOrdered > 0;

        // FASE 46: Calcolo Data Critica (First Needed Date tra le commesse in stato di allarme)
        const alarmEntries = entriesWithVisual.filter(e =>
            e.visualStatus === 'RED' ||
            e.visualStatus === 'SUPPLIER_LATE' ||
            e.visualStatus === 'EXPEDITE_NEEDED' ||
            e.visualStatus === 'LATE'
        );

        const candidateEntries = alarmEntries.length > 0 ? alarmEntries : entriesWithVisual;
        let criticalDate: string | null = null;
        let criticalDateFormatted: string | null = null;
        let isCriticalDateUrgent = false;

        const parsedCandidateDates = candidateEntries
            .map(e => {
                const raw = (e.job as any)?.dataConsegnaFinale || e.jobDate;
                const parsed = parseRobustDate(raw);
                return parsed ? { date: new Date(parsed), raw } : null;
            })
            .filter((d): d is { date: Date; raw: string } => d !== null)
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        if (parsedCandidateDates.length > 0) {
            const earliest = parsedCandidateDates[0];
            criticalDate = earliest.raw;
            criticalDateFormatted = format(earliest.date, 'dd/MM/yyyy');

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const targetDay = new Date(earliest.date);
            targetDay.setHours(0, 0, 0, 0);
            isCriticalDateUrgent = targetDay.getTime() <= today.getTime();
        }

        const item: MaterialAlarmItem<TJob> = {
            matCode: normalizedCode,
            materialName,
            materialType,
            worstStatus,
            isAlarm,
            isUnderControl,
            countRed,
            countSupplierLate,
            countExpediteNeeded,
            countLate,
            countOrdered,
            criticalDate,
            criticalDateFormatted,
            isCriticalDateUrgent,
            entriesWithVisual
        };

        if (isAlarm) {
            alarmMaterials.push(item);
        } else if (isUnderControl) {
            underControlMaterials.push(item);
        }
    });

    // Raccoglie eventuali ulteriori materiali silenziati presenti sulle commesse ma non incontrati nel loop sopra
    allJobs.forEach(job => {
        const jobMuted = (job as any)?.mutedMaterials;
        if (Array.isArray(jobMuted) && jobMuted.length > 0) {
            jobMuted.forEach((matCode: string) => {
                const norm = (matCode || '').toUpperCase().trim();
                if (!norm) return;
                const alreadyIncluded = mutedAlarms.some(
                    m => m.jobId === (job as any).id && m.matCode === norm
                );
                if (!alreadyIncluded) {
                    const material = rawMaterials.find(m => (m?.code || '').toUpperCase().trim() === norm);
                    mutedAlarms.push({
                        jobId: (job as any).id,
                        job,
                        matCode: norm,
                        materialName: material?.description || '',
                        materialType: ((material as any)?.category || material?.description?.split(' ')[0] || 'ALTRO').toUpperCase().trim(),
                        requiredQty: 0,
                        projectedBalance: 0,
                        jobDate: (job as any).dataFinePreparazione || (job as any).dataConsegnaFinale,
                        visualStatus: 'RED',
                        details: ['Silenziato per questa commessa']
                    });
                }
            });
        }
    });

    const getSeverityRank = (status: string) => {
        switch (status) {
            case 'RED': return 0;
            case 'SUPPLIER_LATE': return 1;
            case 'EXPEDITE_NEEDED': return 2;
            case 'LATE': return 3;
            default: return 99;
        }
    };

    // Raggruppamento Allarmi per Categoria/Famiglia
    const alarmCategoriesMap = new Map<string, MaterialAlarmItem<TJob>[]>();
    alarmMaterials.forEach(mat => {
        if (!alarmCategoriesMap.has(mat.materialType)) {
            alarmCategoriesMap.set(mat.materialType, []);
        }
        alarmCategoriesMap.get(mat.materialType)!.push(mat);
    });

    const groupedAlarms: GroupedAlarmCategory<TJob>[] = Array.from(alarmCategoriesMap.entries()).map(([category, items]) => {
        let worstCategoryStatus: 'RED' | 'SUPPLIER_LATE' | 'EXPEDITE_NEEDED' | 'LATE' = 'EXPEDITE_NEEDED';
        if (items.some(m => m.worstStatus === 'RED')) worstCategoryStatus = 'RED';
        else if (items.some(m => m.worstStatus === 'SUPPLIER_LATE')) worstCategoryStatus = 'SUPPLIER_LATE';
        else if (items.some(m => m.worstStatus === 'EXPEDITE_NEEDED')) worstCategoryStatus = 'EXPEDITE_NEEDED';
        else worstCategoryStatus = 'LATE';

        // Ordine materiali nel gruppo: RED prima di SUPPLIER_LATE prima di EXPEDITE_NEEDED, poi alfabetico per codice
        items.sort((a, b) => {
            const rankA = getSeverityRank(a.worstStatus);
            const rankB = getSeverityRank(b.worstStatus);
            if (rankA !== rankB) return rankA - rankB;
            return a.matCode.localeCompare(b.matCode);
        });

        return {
            category,
            worstCategoryStatus,
            materials: items
        };
    });

    // ORDINAMENTO VISIVO GRUPPI:
    // In cima i gruppi con materiali 🔴 MANCANTE, a seguire 🔴 RITARDO FORNITORE, poi 🟠 DA ANTICIPARE.
    // A parità di severità, ordine alfabetico per categoria.
    groupedAlarms.sort((a, b) => {
        const rankA = getSeverityRank(a.worstCategoryStatus);
        const rankB = getSeverityRank(b.worstCategoryStatus);
        if (rankA !== rankB) return rankA - rankB;
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
        groupedUnderControl,
        mutedAlarms,
        mutedCount: mutedAlarms.length
    };
}

