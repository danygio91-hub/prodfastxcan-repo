
import React from 'react';
import { 
    CheckCircle2, AlertTriangle, XCircle, Info, ClipboardCheck, ClipboardList, HelpCircle, Hourglass
} from 'lucide-react';
import { 
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger 
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { JobOrder } from '@/types';
import { MRPTimelineEntry, aggregateMRPRequirements } from '@/lib/mrp-utils';
import { getDerivedJobStatus } from '@/lib/job-status';

interface MRPSemaphoreProps {
    job: JobOrder;
    mrpTimelines: Map<string, MRPTimelineEntry[]>;
    activeSessions?: any[];
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

/**
 * Componente SSoT per la visualizzazione dello stato MRP (Semaforo) di una commessa.
 * Unifica la logica tra Power Planning e Gestione Dati.
 */
export function MRPSemaphore({ job, mrpTimelines, className, size = 'md' }: MRPSemaphoreProps) {
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

        const withdrawnItems = bom.filter(i => i.status === 'withdrawn');
        const pendingItems = bom.filter(i => i.status !== 'withdrawn');

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
                    details: withdrawnItems.map(i => `✅ ${i.component} - Prelevato`)
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
                        ...withdrawnItems.map(i => `✅ ${i.component} - Prelevato`),
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
                details: withdrawnItems.map(i => `✅ ${i.component} - Prelevato`) 
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
        const isLate = !isRed && componentEntries.some(ce => ce.entry.status === 'LATE');
        const isAmber = !isRed && !isLate && componentEntries.some(ce => ce.entry.status === 'AMBER');
        const isFrozen = componentEntries.some(ce => ce.entry.isFrozen);
        
        const aggregatedEntries = aggregateMRPRequirements(componentEntries);
        const combinedDetails = [
            ...withdrawnItems.map(i => `✅ ${i.component} - Prelevato`),
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
                label: 'SESSIONE ATTIVA',
                details: combinedDetails
            };
        }

        if (isRed) return { color: 'text-red-500', icon: XCircle, label: 'MANCANZA MATERIALI', details: combinedDetails };
        if (isLate) return { color: 'text-orange-600', icon: AlertTriangle, label: 'IN RITARDO', details: combinedDetails };
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
