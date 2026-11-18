
import React from 'react';
import { 
    CheckCircle2, AlertTriangle, XCircle, Info, ClipboardCheck, ClipboardList, HelpCircle, Hourglass
} from 'lucide-react';
import { 
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger 
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { JobOrder, RawMaterial, MaterialWithdrawal } from '@/types';
import {
    MRPTimelineEntry,
    aggregateMRPRequirements,
    isBOMItemPhaseCompleted,
    getJobComponentWithdrawnQty,
    type JobComponentWithdrawalIndex,
} from '@/lib/mrp-utils';
import { calculateBOMRequirement } from '@/lib/inventory-utils';
import { GlobalSettings } from '@/lib/settings-types';
import { getDerivedJobStatus } from '@/lib/job-status';

interface MRPSemaphoreProps {
    job: JobOrder;
    mrpTimelines: Map<string, MRPTimelineEntry[]>;
    activeSessions?: any[];
    materialWithdrawals?: MaterialWithdrawal[] | JobComponentWithdrawalIndex;
    rawMaterials?: RawMaterial[];
    globalSettings?: GlobalSettings | null;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

/**
 * Componente SSoT per la visualizzazione dello stato MRP (Semaforo) di una commessa.
 * Unifica la logica tra Power Planning e Gestione Dati.
 */
export function MRPSemaphore({
    job,
    mrpTimelines,
    materialWithdrawals,
    rawMaterials = [],
    globalSettings = null,
    className,
    size = 'md',
}: MRPSemaphoreProps) {
    const derivedStatus = getDerivedJobStatus(job);
    const isClosed = derivedStatus === 'CHIUSO';

    // 1. Logica di Calcolo dello Stato
    const status = (() => {
        const bom = job.billOfMaterials || [];
        if (bom.length === 0) {
            return { 
                color: 'text-slate-400', 
                icon: Info, 
                label: 'NESSUNA BOM', 
                details: ['Controllare configurazione articolo'] 
            };
        }

        const withdrawnItems: typeof bom = [];
        const pendingItems: typeof bom = [];
        const directWithdrawnCodes = new Set<string>();
        const remainingByCode = new Map<string, number>();

        bom.forEach((i) => {
            const compCode = (i.component || '').trim().toUpperCase();
            const rawMat = rawMaterials.find((m) => (m?.code || '').trim().toUpperCase() === compCode);
            const isPhaseOrFlagSatisfied =
                i.status === 'withdrawn' ||
                i.withdrawn === true ||
                isBOMItemPhaseCompleted(job, i, rawMat).completed;

            if (isPhaseOrFlagSatisfied) {
                withdrawnItems.push(i);
                return;
            }

            if (materialWithdrawals && compCode) {
                if (!remainingByCode.has(compCode)) {
                    remainingByCode.set(
                        compCode,
                        getJobComponentWithdrawnQty(job, compCode, materialWithdrawals, rawMaterials)
                    );
                }
                const remWithdrawn = remainingByCode.get(compCode) || 0;
                if (remWithdrawn > 0.0001) {
                    const config = (globalSettings?.rawMaterialTypes || []).find((t) => t.id === rawMat?.type) || {
                        defaultUnit: rawMat?.unitOfMeasure || i.unit || 'n',
                    };
                    const req = calculateBOMRequirement(job.qta, i, rawMat as any, config as any);
                    const reqQty =
                        i.fabbisognoTotale !== undefined && i.fabbisognoTotale !== null && Number(i.fabbisognoTotale) > 0
                            ? Number(i.fabbisognoTotale)
                            : req.totalInBaseUnits;

                    if (reqQty > 0 && remWithdrawn >= reqQty - 0.001) {
                        remainingByCode.set(compCode, Math.max(0, remWithdrawn - reqQty));
                        directWithdrawnCodes.add(compCode);
                        withdrawnItems.push(i);
                        return;
                    } else if (reqQty > 0) {
                        remainingByCode.set(compCode, 0);
                    }
                }
            }

            pendingItems.push(i);
        });

        const formatWithdrawnLine = (i: (typeof bom)[number]) => {
            const compCode = (i.component || '').trim().toUpperCase();
            if (directWithdrawnCodes.has(compCode)) {
                return `✅ ${i.component} - Prelevato (tramite scarico diretto a magazzino)`;
            }
            return `✅ ${i.component} - Prelevato`;
        };

        const PREP_FINISHED_STATUSES = ['PRONTO_PROD', 'IN_PRODUZIONE', 'FINE_PRODUZIONE', 'QLTY_PACK', 'CHIUSO'];
        const isPrepFinished = PREP_FINISHED_STATUSES.includes(derivedStatus) || 
                             ['PRONTO', 'PRONTO PROD', 'IN PROD', 'FINE PROD'].includes((job.status || '').toUpperCase());

        // CASO A: Commessa CHIUSA o con Preparazione Finita (Audit Mode)
        if (isPrepFinished) {
            // [MRP EXCEPTION: ACTIVE SESSIONS OVERRIDE]
            // Controlliamo se per questa commessa esistono impegni congelati da sessioni officina attive
            const hasFrozenCommitment = bom.some(item => {
                const matCode = (item.component || '').toUpperCase().trim();
                const timeline = mrpTimelines.get(matCode) || [];
                const entry = timeline.find(e => e.jobId === job.id);
                return entry?.isFrozen;
            });

            if (pendingItems.length === 0) {
                return {
                    color: 'text-green-500',
                    icon: CheckCircle2,
                    label: 'MATERIALE PRELEVATO',
                    details: withdrawnItems.map(formatWithdrawnLine)
                };
            } else if (hasFrozenCommitment) {
                // Se c'è una sessione attiva, NON andiamo in Audit Mode. 
                // Lasciamo che la logica prosegua verso il CASO B (Semaforo standard).
            } else {
                // REGOLA AUDIT: Per le commesse dove l'impegno è decaduto (Prep finita) ma mancano prelievi
                return {
                    color: 'text-blue-400 dark:text-blue-400', 
                    icon: ClipboardList, 
                    label: 'NOTE AUDIT',
                    details: [
                        'Note: Materiale non associato / prelevato.',
                        ...withdrawnItems.map(formatWithdrawnLine),
                        ...pendingItems.map(i => `⚠️ ${i.component} - Non associato`)
                    ]
                };
            }
        }

        // CASO B: Commessa APERTA (Production Mode)
        if (pendingItems.length === 0) {
            return { 
                color: 'text-green-500', 
                icon: CheckCircle2, 
                label: 'MATERIALE PRELEVATO', 
                details: withdrawnItems.map(formatWithdrawnLine) 
            };
        }

        const componentEntries: { entry: MRPTimelineEntry, item: any }[] = [];
        pendingItems.forEach(item => {
            const matCode = (item.component || '').toUpperCase().trim();
            const timeline = mrpTimelines.get(matCode) || [];
            const entry = timeline.find(e => e.jobId === job.id);
            if (entry) componentEntries.push({ entry, item });
        });

        if (componentEntries.length === 0) {
            return { 
                color: 'text-red-500', 
                icon: HelpCircle, 
                label: 'NON CONFIGURATO', 
                details: ['Dati MRP mancanti per i componenti in BOM'] 
            };
        }

        const isRed = componentEntries.some(ce => ce.entry.status === 'RED');
        const isSupplierLate = !isRed && componentEntries.some(ce => ce.entry.status === 'SUPPLIER_LATE');
        const isExpediteNeeded = !isRed && !isSupplierLate && componentEntries.some(ce => ce.entry.status === 'EXPEDITE_NEEDED');
        const isLate = !isRed && !isSupplierLate && !isExpediteNeeded && componentEntries.some(ce => ce.entry.status === 'LATE');
        const isOrdered = !isRed && !isSupplierLate && !isExpediteNeeded && !isLate && componentEntries.some(ce => ce.entry.status === 'ORDERED');
        const isAmber = !isRed && !isSupplierLate && !isExpediteNeeded && !isLate && !isOrdered && componentEntries.some(ce => ce.entry.status === 'AMBER');
        const isFrozen = componentEntries.some(ce => ce.entry.isFrozen);
        
        const aggregatedEntries = aggregateMRPRequirements(componentEntries);
        const combinedDetails = [
            ...withdrawnItems.map(formatWithdrawnLine),
            ...aggregatedEntries.flatMap(ce => {
                const prefix = ce.item.component;
                return ce.entry.details.map((d: string) => {
                    if (d.startsWith('Fabbisogno')) return `📦 ${prefix} - ${d}`;
                    return d;
                });
            })
        ];

        // Se è congelato, usiamo un'estetica specifica (Clessidra)
        if (isFrozen && isPrepFinished) {
            return {
                color: 'text-amber-500',
                icon: Hourglass,
                label: 'PENDING SESSION',
                details: [
                    "⏳ In attesa chiusura Sessione Officina",
                    ...combinedDetails
                ]
            };
        }

        if (isRed) return { color: 'text-red-500', icon: XCircle, label: 'MANCANZA MATERIALI', details: combinedDetails };
        if (isSupplierLate) return { color: 'text-red-600', icon: AlertTriangle, label: 'RITARDO FORN.', details: combinedDetails };
        if (isExpediteNeeded) return { color: 'text-amber-500', icon: AlertTriangle, label: 'DA ANTICIPARE', details: combinedDetails };
        if (isLate) return { color: 'text-orange-600', icon: AlertTriangle, label: 'IN RITARDO', details: combinedDetails };
        if (isOrdered) return { color: 'text-indigo-500 dark:text-indigo-400', icon: AlertTriangle, label: 'ORDINATO', details: combinedDetails };
        if (isAmber) return { color: 'text-yellow-500', icon: AlertTriangle, label: 'COPERTURA DA ORDINE', details: combinedDetails };
        
        return { 
            color: 'text-green-500', 
            icon: CheckCircle2, 
            label: 'DISPONIBILE', 
            details: combinedDetails 
        };
    })();

    const Icon = status.icon;
    const sizeClasses = {
        sm: 'h-3.5 w-3.5',
        md: 'h-4 w-4',
        lg: 'h-5 w-5'
    };

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={cn(
                        "cursor-help p-1 rounded-full hover:bg-slate-800/50 transition-colors flex items-center justify-center",
                        status.color,
                        className
                    )}>
                        <Icon className={sizeClasses[size]} />
                    </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-slate-900 border-slate-700 p-2 shadow-2xl max-w-[400px]">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5">
                            <Icon className={cn("h-3.5 w-3.5", status.color)} />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-200">
                                {status.label}
                            </span>
                        </div>
                        {status.details && status.details.length > 0 && (
                            <ul className="space-y-1">
                                {status.details.map((d, i) => (
                                    <li key={i} className="text-[9px] font-bold text-slate-400 leading-tight">
                                        {d}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
