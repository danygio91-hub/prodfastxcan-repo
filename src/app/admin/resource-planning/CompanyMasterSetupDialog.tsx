'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Settings2, Save, Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operator } from '@/types';

interface CompanyMasterSetupDialogProps {
    isOpen: boolean;
    onClose: () => void;
    operators: Operator[];
    displayDepts: { id: string; name: string }[];
    currentMaster: any;
    onSave: (distributions: { departmentId: string, assignments: { operatorId: string, hours: number }[] }[]) => Promise<void>;
}

export default function CompanyMasterSetupDialog({
    isOpen,
    onClose,
    operators,
    displayDepts,
    currentMaster,
    onSave
}: CompanyMasterSetupDialogProps) {
    // State: operatorId -> departmentId -> string (for input value, allowing empty)
    const [allocations, setAllocations] = useState<Record<string, Record<string, string>>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Inizializza lo stato con il master corrente (o vuoto se non esiste)
    useEffect(() => {
        if (isOpen) {
            const initial: Record<string, Record<string, string>> = {};
            
            // Crea la struttura base con valori vuoti
            operators.forEach(op => {
                initial[op.id] = {};
                displayDepts.forEach(dept => {
                    initial[op.id][dept.id] = ''; // Partiamo da stringa vuota per forzare la compilazione
                });
            });

            // Se c'è un master salvato, lo pre-carichiamo
            if (currentMaster && currentMaster.distributions) {
                currentMaster.distributions.forEach((dist: any) => {
                    const deptId = dist.departmentId;
                    if (dist.assignments) {
                        dist.assignments.forEach((assign: any) => {
                            if (initial[assign.operatorId]) {
                                initial[assign.operatorId][deptId] = assign.hours.toString();
                            }
                        });
                    }
                });
                
                // Opzionale: Se un operatore era nel master con campi vuoti, i campi rimanenti li portiamo a '0'
                // per facilitare la UI se era già stato configurato in passato.
                operators.forEach(op => {
                    let hasAnyValue = false;
                    displayDepts.forEach(dept => {
                        if (initial[op.id][dept.id] !== '') hasAnyValue = true;
                    });
                    if (hasAnyValue) {
                        displayDepts.forEach(dept => {
                            if (initial[op.id][dept.id] === '') initial[op.id][dept.id] = '0';
                        });
                    }
                });
            }

            setAllocations(initial);
        }
    }, [isOpen, operators, displayDepts, currentMaster]);

    const handleInputChange = (operatorId: string, deptId: string, val: string) => {
        setAllocations(prev => ({
            ...prev,
            [operatorId]: {
                ...prev[operatorId],
                [deptId]: val
            }
        }));
    };

    // Auto-fill: riempie di '0' tutti i campi vuoti
    const handleFillEmptyWithZeros = () => {
        setAllocations(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(opId => {
                Object.keys(next[opId]).forEach(deptId => {
                    if (next[opId][deptId] === '') {
                        next[opId][deptId] = '0';
                    }
                });
            });
            return next;
        });
    };

    // Validazione: controlla se tutti gli input di tutti gli operatori sono numeri validi (non vuoti)
    const validationErrors = useMemo(() => {
        const missingOps: string[] = [];
        operators.forEach(op => {
            const opAllocs = allocations[op.id];
            if (!opAllocs) {
                missingOps.push(op.nome);
                return;
            }
            const hasEmpty = displayDepts.some(dept => opAllocs[dept.id] === '' || opAllocs[dept.id] === undefined);
            if (hasEmpty) {
                missingOps.push(op.nome);
            }
        });
        return missingOps;
    }, [allocations, operators, displayDepts]);

    const isFormValid = validationErrors.length === 0;

    const handleSave = async () => {
        if (!isFormValid) return;
        setIsSaving(true);

        // Trasformiamo Operatore->Reparto in Reparto->Operatore (per server action)
        const distributions = displayDepts.map(dept => {
            const assignments: { operatorId: string, hours: number }[] = [];
            operators.forEach(op => {
                const hoursStr = allocations[op.id]?.[dept.id] || '0';
                const hours = parseFloat(hoursStr) || 0;
                if (hours > 0) { // Salviamo solo se le ore sono > 0 per ottimizzare
                    assignments.push({ operatorId: op.id, hours });
                }
            });
            return { departmentId: dept.id, assignments };
        });

        await onSave(distributions);
        setIsSaving(false);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-7xl h-[90vh] bg-slate-950 border-slate-800 text-white p-0 flex flex-col rounded-[2rem] overflow-hidden">
                <DialogHeader className="p-6 border-b border-slate-800 bg-slate-900 flex flex-row items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="h-12 w-12 bg-blue-600/20 text-blue-500 rounded-xl flex items-center justify-center">
                            <Settings2 className="h-6 w-6" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-black uppercase tracking-tighter">
                                Master Aziendale
                            </DialogTitle>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
                                Capacità Schedulabile di Default
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <Button 
                            variant="outline" 
                            className="h-10 border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 font-bold uppercase text-[10px] tracking-widest"
                            onClick={handleFillEmptyWithZeros}
                        >
                            Riempi vuoti con zero (0)
                        </Button>
                        <Button 
                            className={cn(
                                "h-10 px-8 font-black uppercase text-xs tracking-widest gap-2 shadow-lg transition-all",
                                isFormValid 
                                    ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/50" 
                                    : "bg-slate-800 text-slate-500 cursor-not-allowed"
                            )}
                            onClick={handleSave}
                            disabled={!isFormValid || isSaving}
                        >
                            {isSaving ? <span className="animate-spin">/--\</span> : <Save className="h-4 w-4" />}
                            {isFormValid ? "Salva Master Definitivo" : "Compilazione Incompleta"}
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-col bg-slate-950 relative">
                    {!isFormValid && (
                        <div className="bg-amber-950/40 border-b border-amber-900/50 p-3 px-6 flex items-center gap-3 shrink-0">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest">
                                Attenzione: {validationErrors.length} operatori presentano celle non compilate.
                            </span>
                        </div>
                    )}
                    
                    <ScrollArea className="flex-1 p-6">
                        <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-900">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-slate-950/80 sticky top-0 z-10 border-b border-slate-800 backdrop-blur-md">
                                    <tr>
                                        <th className="px-6 py-4 font-black uppercase text-[10px] tracking-widest text-slate-500">Operatore</th>
                                        {displayDepts.map(dept => (
                                            <th key={dept.id} className="px-4 py-4 text-center font-black uppercase text-[10px] tracking-widest text-slate-400">
                                                {dept.name}
                                            </th>
                                        ))}
                                        <th className="px-6 py-4 text-center font-black uppercase text-[10px] tracking-widest text-slate-500">
                                            Totale Ore
                                        </th>
                                        <th className="px-6 py-4 text-center font-black uppercase text-[10px] tracking-widest text-slate-500">
                                            Stato
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {operators.map((op) => {
                                        const opAllocs = allocations[op.id] || {};
                                        let totalHours = 0;
                                        let isComplete = true;
                                        
                                        displayDepts.forEach(d => {
                                            const val = opAllocs[d.id];
                                            if (val === '' || val === undefined) isComplete = false;
                                            else totalHours += (parseFloat(val) || 0);
                                        });

                                        return (
                                            <tr key={op.id} className="hover:bg-slate-800/30 transition-colors">
                                                <td className="px-6 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center font-black text-xs text-slate-400">
                                                            {op.nome.substring(0, 2).toUpperCase()}
                                                        </div>
                                                        <span className="font-bold text-slate-200">{op.nome}</span>
                                                    </div>
                                                </td>
                                                {displayDepts.map(dept => (
                                                    <td key={dept.id} className="px-4 py-3">
                                                        <div className="flex justify-center">
                                                            <Input 
                                                                type="number"
                                                                className={cn(
                                                                    "h-9 w-20 text-center font-black text-sm rounded-lg border focus:ring-2 transition-all",
                                                                    opAllocs[dept.id] === '' || opAllocs[dept.id] === undefined 
                                                                        ? "bg-amber-950/20 border-amber-900/50 text-amber-500 focus:ring-amber-500/50" 
                                                                        : "bg-slate-950 border-slate-800 text-slate-200 focus:ring-blue-500/50"
                                                                )}
                                                                value={opAllocs[dept.id] ?? ''}
                                                                onChange={(e) => handleInputChange(op.id, dept.id, e.target.value)}
                                                                placeholder="-"
                                                            />
                                                        </div>
                                                    </td>
                                                ))}
                                                <td className="px-6 py-3 text-center">
                                                    <Badge className={cn(
                                                        "font-black text-[11px] px-3 py-1",
                                                        totalHours > 0 ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "bg-slate-800 text-slate-500 border-none"
                                                    )}>
                                                        {totalHours.toFixed(1)}h
                                                    </Badge>
                                                </td>
                                                <td className="px-6 py-3 text-center">
                                                    {isComplete ? (
                                                        <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto" />
                                                    ) : (
                                                        <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto" />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}
