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
import { Progress } from '@/components/ui/progress';
import type { Operator, Department, Article } from '@/types';

interface OperatorSkillLoanDialogProps {
    isOpen: boolean;
    onClose: () => void;
    targetDept: string;
    week: number;
    year: number;
    operators: Operator[];
    currentAllocations: Record<string, { operatorId: string, hours: number }[]>; 
    weeklyLimit: number;
    onSelect: (operatorId: string, hours: number) => void;
}

export default function OperatorSkillLoanDialog({
    isOpen,
    onClose,
    targetDept,
    week,
    year,
    operators,
    currentAllocations,
    weeklyLimit,
    onSelect
}: OperatorSkillLoanDialogProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [customHours, setCustomHours] = useState<Record<string, number>>({});

    const recommendedOperators = useMemo(() => {
        const weekPrefix = `${year}_${week}_`;
        
        // 1. Calcola ore totali già assegnate per ogni operatore in questa settimana
        const usedHoursMap: Record<string, number> = {};
        Object.keys(currentAllocations).forEach(key => {
            if (key.startsWith(weekPrefix)) {
                currentAllocations[key].forEach(a => {
                    usedHoursMap[a.operatorId] = (usedHoursMap[a.operatorId] || 0) + a.hours;
                });
            }
        });

        const targetKey = `${year}_${week}_${targetDept}`;
        const alreadyInDept = currentAllocations[targetKey]?.map(a => a.operatorId) || [];

        // 2. Calcola punteggio e disponibilità
        return operators.map(op => {
            const usedHours = usedHoursMap[op.id] || 0;
            const remainingHours = Math.max(0, weeklyLimit - usedHours);
            const isDeptCompatible = op.reparto.includes(targetDept);
            const isAlreadyHere = alreadyInDept.includes(op.id);
            
            const bestSkill = op.skills?.reduce((prev, curr) => (curr.efficiencyPercent > prev ? curr.efficiencyPercent : prev), 0) || 0;
            const score = (isDeptCompatible ? 1000 : 0) + bestSkill - (isAlreadyHere ? 5000 : 0);

            return { ...op, score, isDeptCompatible, bestSkill, remainingHours, usedHours, isAlreadyHere };
        })
        .filter(op => {
            const matchesSearch = !searchTerm || op.nome.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        })
        .sort((a, b) => b.score - a.score);
    }, [operators, currentAllocations, targetDept, searchTerm, weeklyLimit, year, week]);

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
                                        "flex items-center justify-between p-4 rounded-2xl border-2 transition-all hover:bg-slate-50 group",
                                        op.isAlreadyHere ? "opacity-60 grayscale border-slate-100 bg-slate-50" : (idx === 0 ? "border-emerald-100 bg-emerald-50/20" : "border-slate-100")
                                    )}
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="h-10 w-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500 font-black">
                                            {op.nome.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-slate-800">{op.nome}</span>
                                                {op.isAlreadyHere && <Badge className="bg-slate-400 text-[8px] font-black uppercase h-4 px-1">Già assegnato</Badge>}
                                                {!op.isAlreadyHere && idx === 0 && <Badge className="bg-emerald-500 text-[8px] font-black uppercase h-4 px-1">Top Match</Badge>}
                                            </div>
                                            <div className="flex flex-col gap-1.5 mt-1.5">
                                                <div className="flex items-center gap-2">
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
                                                
                                                <div className="flex flex-col gap-1 w-full max-w-[140px]">
                                                    <div className="flex justify-between text-[8px] font-black uppercase tracking-tighter">
                                                        <span className="text-slate-400">Occupato: {op.usedHours}h</span>
                                                        <span className={cn(op.remainingHours > 0 ? "text-blue-500" : "text-red-400")}>
                                                            Residuo: {op.remainingHours}h
                                                        </span>
                                                    </div>
                                                    <Progress value={(op.usedHours / weeklyLimit) * 100} className="h-1 w-full bg-slate-100 [&>div]:bg-blue-500" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {!op.isAlreadyHere && (
                                        <div className="flex items-center gap-2 ml-4">
                                            <div className="flex flex-col items-center gap-0.5">
                                                <span className="text-[8px] font-black text-slate-400 uppercase">Ore</span>
                                                <Input 
                                                    type="number" 
                                                    className="h-9 w-16 text-center font-black text-sm rounded-lg border-slate-200 focus:ring-blue-500"
                                                    value={customHours[op.id] !== undefined ? customHours[op.id] : op.remainingHours}
                                                    onChange={(e) => setCustomHours(prev => ({ ...prev, [op.id]: parseFloat(e.target.value) || 0 }))}
                                                />
                                            </div>
                                            <Button 
                                                variant="default" 
                                                size="sm" 
                                                className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[10px] gap-2 shadow-lg shadow-blue-900/20"
                                                onClick={() => onSelect(op.id, customHours[op.id] !== undefined ? customHours[op.id] : op.remainingHours)}
                                            >
                                                <PlusCircleIcon className="h-4 w-4" /> Aggiungi
                                            </Button>
                                        </div>
                                    )}
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
