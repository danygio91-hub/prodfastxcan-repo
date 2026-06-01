'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
    Users, 
    Search, 
    Zap, 
    Save, 
    ArrowRight, 
    LayoutDashboard, 
    CheckCircle2,
    Factory,
    Scissors,
    Package,
    Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operator, Department } from '@/types';

interface MassiveAllocationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    week: number;
    year: number;
    operators: Operator[];
    displayDepts: { id: string, name: string }[];
    currentAllocations: Record<string, { operatorId: string, hours: number }[]>;
    weeklyLimit: number;
    onSave: (operatorId: string, distributions: { departmentId: string, hours: number }[]) => Promise<void>;
}

export default function MassiveAllocationDialog({
    isOpen,
    onClose,
    week,
    year,
    operators,
    displayDepts,
    currentAllocations,
    weeklyLimit,
    onSave
}: MassiveAllocationDialogProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
    const [localDist, setLocalDist] = useState<Record<string, number>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Quando cambia l'operatore selezionato, pre-carica la sua distribuzione attuale per questa settimana
    useEffect(() => {
        if (selectedOpId) {
            const weekPrefix = `${year}_${week}_`;
            const dist: Record<string, number> = {};
            
            Object.keys(currentAllocations).forEach(key => {
                if (key.startsWith(weekPrefix)) {
                    const deptId = key.split('_')[2];
                    const assignment = currentAllocations[key].find(a => a.operatorId === selectedOpId);
                    if (assignment) {
                        dist[deptId] = assignment.hours;
                    }
                }
            });
            
            setLocalDist(dist);
        } else {
            setLocalDist({});
        }
    }, [selectedOpId, currentAllocations, week, year, isOpen]);

    const filteredOperators = useMemo(() => {
        return operators.filter(op => 
            !searchTerm || op.nome.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [operators, searchTerm]);

    const totalAssigned = Object.values(localDist).reduce((acc, h) => acc + (h || 0), 0);
    const isOverLimit = totalAssigned > weeklyLimit;

    const handleSave = async () => {
        if (!selectedOpId) return;
        setIsSaving(true);
        const distArray = displayDepts.map(d => ({
            departmentId: d.id,
            hours: localDist[d.id] || 0
        }));
        await onSave(selectedOpId, distArray);
        setIsSaving(false);
        onClose();
        setSelectedOpId(null);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl bg-slate-950 border-slate-800 text-white p-0 overflow-hidden rounded-[2rem]">
                <div className="flex h-[600px]">
                    {/* Sidebar: Selezione Operatore */}
                    <div className="w-1/3 bg-slate-900 border-r border-slate-800 flex flex-col">
                        <div className="p-6 border-b border-slate-800">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-500 mb-4 flex items-center gap-2">
                                <Users className="h-4 w-4" /> 1. Scegli Operatore
                            </h3>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                                <Input 
                                    placeholder="Cerca..." 
                                    className="h-9 pl-9 bg-slate-950 border-slate-800 text-xs font-bold"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <ScrollArea className="flex-1">
                            <div className="p-2 space-y-1">
                                {filteredOperators.map(op => (
                                    <div 
                                        key={op.id}
                                        className={cn(
                                            "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all",
                                            selectedOpId === op.id ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
                                        )}
                                        onClick={() => setSelectedOpId(op.id)}
                                    >
                                        <div className={cn("h-8 w-8 rounded-full flex items-center justify-center font-black text-xs", selectedOpId === op.id ? "bg-white text-blue-600" : "bg-slate-800")}>
                                            {op.nome.substring(0, 2).toUpperCase()}
                                        </div>
                                        <span className="text-sm font-black tracking-tight">{op.nome}</span>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Main Area: Distribuzione Ore */}
                    <div className="flex-1 flex flex-col bg-slate-950">
                        {selectedOpId ? (
                            <>
                                <div className="p-8 border-b border-slate-900/50 bg-gradient-to-b from-slate-900 to-transparent">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                                            <Zap className="h-6 w-6 text-blue-500" /> Pianificazione Massiva
                                        </h2>
                                        <Badge className="bg-slate-900 border-slate-800 text-slate-400 font-bold uppercase py-1 px-3">Settimana {week}</Badge>
                                    </div>
                                    
                                    <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800/50">
                                        <div className="flex justify-between items-end mb-3">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Capacità Utilizzata</span>
                                                <span className={cn("text-3xl font-black italic", isOverLimit ? "text-red-500" : "text-blue-500")}>
                                                    {totalAssigned}h <span className="text-lg text-slate-700 not-italic font-bold">/ {weeklyLimit}h</span>
                                                </span>
                                            </div>
                                            {isOverLimit && <Badge variant="destructive" className="animate-pulse mb-1">SOVRACCARICO</Badge>}
                                        </div>
                                        <Progress value={(totalAssigned / weeklyLimit) * 100} className={cn("h-2 bg-slate-950", isOverLimit ? "[&>div]:bg-red-500" : "[&>div]:bg-blue-600")} />
                                    </div>
                                </div>

                                <ScrollArea className="flex-1 p-8 pt-4">
                                    <div className="space-y-4">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                                            <LayoutDashboard className="h-3 w-3" /> 2. Distribuzione Reparti
                                        </h3>
                                        <div className="grid grid-cols-1 gap-2">
                                            {displayDepts.map(dept => {
                                                const isSatellite = ['PREP', 'PACK'].includes(dept.id);
                                                return (
                                                    <div key={dept.id} className="flex items-center justify-between p-4 bg-slate-900/30 border border-slate-800/50 rounded-2xl group hover:border-slate-700 transition-all">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-10 w-10 bg-slate-950 rounded-xl flex items-center justify-center text-slate-500 group-hover:text-blue-500 transition-colors">
                                                                {dept.id === 'PREP' ? <Scissors className="h-4 w-4" /> : dept.id === 'PACK' ? <Package className="h-4 w-4" /> : <Factory className="h-4 w-4" />}
                                                            </div>
                                                            <span className="font-black uppercase text-xs tracking-widest">{dept.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex flex-col items-end">
                                                                <span className="text-[8px] font-black text-slate-600 uppercase">Ore Settimana</span>
                                                                <div className="flex items-center gap-2">
                                                                    <Input 
                                                                        type="number" 
                                                                        className="h-10 w-20 text-center bg-slate-950 border-slate-800 font-black text-sm rounded-xl focus:ring-blue-600 focus:border-blue-600"
                                                                        value={localDist[dept.id] || ''}
                                                                        onChange={(e) => setLocalDist(prev => ({ ...prev, [dept.id]: parseFloat(e.target.value) || 0 }))}
                                                                    />
                                                                    <Button 
                                                                        variant="ghost" 
                                                                        size="sm" 
                                                                        className="h-8 w-8 p-0 rounded-lg hover:bg-slate-800 text-slate-600 hover:text-white"
                                                                        onClick={() => {
                                                                            const remains = weeklyLimit - (totalAssigned - (localDist[dept.id] || 0));
                                                                            setLocalDist(prev => ({ ...prev, [dept.id]: Math.max(0, remains) }));
                                                                        }}
                                                                    >
                                                                        <Clock className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </ScrollArea>

                                <div className="p-8 border-t border-slate-900/50 bg-slate-900/20 backdrop-blur-sm">
                                    <Button 
                                        className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[11px] tracking-widest gap-2 rounded-2xl shadow-xl shadow-blue-900/20 transition-all active:scale-[0.98]"
                                        onClick={handleSave}
                                        disabled={isSaving || isOverLimit}
                                    >
                                        {isSaving ? <span className="animate-spin mr-2">/--\</span> : <Save className="h-4 w-4" />}
                                        Conferma e Applica Pianificazione Massiva
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40">
                                <Users className="h-16 w-16 text-slate-700 mb-6" />
                                <h4 className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Seleziona un operatore dalla lista</h4>
                                <p className="text-xs font-bold text-slate-700 mt-2">Per iniziare a distribuire le ore nei vari reparti</p>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
