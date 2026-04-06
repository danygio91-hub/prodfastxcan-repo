'use client';

import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Star, TrendingUp, Info, Search, Factory, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Operator, Department, Article } from '@/types';

interface OperatorSkillLoanDialogProps {
    isOpen: boolean;
    onClose: () => void;
    targetDept: string;
    week: number;
    year: number;
    operators: Operator[];
    currentAllocations: string[]; // IDs di operatori già assegnati
    onSelect: (operatorId: string) => void;
}

export default function OperatorSkillLoanDialog({
    isOpen,
    onClose,
    targetDept,
    week,
    year,
    operators,
    currentAllocations,
    onSelect
}: OperatorSkillLoanDialogProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const recommendedOperators = useMemo(() => {
        // 1. Escludi chi è già assegnato
        const available = operators.filter(op => !currentAllocations.includes(op.id));

        // 2. Calcola punteggio di affinità
        return available.map(op => {
            // Affinità di Reparto (Booleano)
            const isDeptCompatible = op.reparto.includes(targetDept);
            
            // Skill specifica (se esiste una skill che mappa sul reparto o mansione principale)
            // In una produzione reale, targetDept mappa su una o più PhaseId
            // Qui cerchiamo la skill con il punteggio più alto tra quelle dell'operatore
            const bestSkill = op.skills?.reduce((prev, curr) => (curr.efficiencyPercent > prev ? curr.efficiencyPercent : prev), 0) || 0;
            
            // Punteggio finale: Compatibilità Reparto (1000 punti) + Skill Efficiency (0-100)
            const score = (isDeptCompatible ? 1000 : 0) + bestSkill;

            return { ...op, score, isDeptCompatible, bestSkill };
        })
        .filter(op => {
            const matchesSearch = !searchTerm || op.nome.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        })
        .sort((a, b) => b.score - a.score);
    }, [operators, currentAllocations, targetDept, searchTerm]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl bg-white rounded-3xl border-none shadow-2xl overflow-hidden p-0">
                <div className="bg-blue-600 p-6 text-white overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Users className="h-24 w-24" />
                    </div>
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                            <Zap className="h-6 w-6 text-yellow-300" /> Ricerca Prestito Intelligente
                        </DialogTitle>
                        <DialogDescription className="text-blue-100 font-bold opacity-90">
                            Suggerimenti basati su **Skills** e **Affinità di Reparto** per {targetDept} (S{week})
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="mt-6 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                        <Input 
                            placeholder="Cerca operatore per nome..." 
                            className="h-11 pl-10 bg-white/20 border-white/30 text-white placeholder:text-white/50 font-bold rounded-xl focus-visible:ring-white"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="p-6">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                        <TrendingUp className="h-3 w-3" /> Operatori Suggeriti (Pool Globale)
                    </h3>
                    
                    <ScrollArea className="h-[350px] pr-4">
                        <div className="space-y-3">
                            {recommendedOperators.map((op, idx) => (
                                <div 
                                    key={op.id} 
                                    className={cn(
                                        "flex items-center justify-between p-4 rounded-2xl border-2 transition-all hover:bg-slate-50 group cursor-pointer",
                                        idx === 0 ? "border-emerald-100 bg-emerald-50/20" : "border-slate-100"
                                    )}
                                    onClick={() => onSelect(op.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="h-10 w-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500 font-black">
                                            {op.nome.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-slate-800">{op.nome}</span>
                                                {idx === 0 && <Badge className="bg-emerald-500 text-[8px] font-black uppercase h-4 px-1">Top Match</Badge>}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {op.isDeptCompatible ? (
                                                    <Badge variant="outline" className="text-[7px] font-black bg-emerald-50 text-emerald-600 border-emerald-100 uppercase py-0 leading-none">Abilitato {targetDept}</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[7px] font-black bg-slate-100 text-slate-400 border-slate-200 uppercase py-0 leading-none">Fuori Reparto</Badge>
                                                )}
                                                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                                    <Star className={cn("h-3 w-3", op.bestSkill > 80 ? "text-amber-500 fill-amber-500" : "")} />
                                                    Efficienza: {op.bestSkill}%
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <Button variant="ghost" size="sm" className="h-9 w-9 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-white border shadow-sm">
                                        <PlusCircleIcon className="h-5 w-5 text-blue-600" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>

                <DialogFooter className="p-6 bg-slate-50/50 border-t flex items-center justify-between space-x-0">
                    <div className="flex items-center gap-2 text-slate-400">
                        <Info className="h-4 w-4" />
                        <span className="text-[10px] font-bold italic">L'efficienza è calcolata sulla miglior skill rilevata</span>
                    </div>
                    <Button variant="outline" onClick={onClose} className="rounded-xl font-bold uppercase text-xs h-10 px-6">Chiudi</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PlusCircleIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12 h8" />
            <path d="M12 8 v8" />
        </svg>
    );
}
