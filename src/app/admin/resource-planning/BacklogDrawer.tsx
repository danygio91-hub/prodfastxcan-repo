'use client';

import React, { useState, useMemo } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
    Search, 
    Box, 
    Package, 
    Timer, 
    Filter, 
    AlertCircle, 
    LayoutList,
    ChevronRight,
    GripVertical,
    XCircle
} from 'lucide-react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import type { JobOrder } from '@/types';
import { Button } from '@/components/ui/button';

interface BacklogDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    unassignedJobs: JobOrder[];
    onExclude?: (jobId: string) => void;
}

export default function BacklogDrawer({ isOpen, onClose, unassignedJobs, onExclude }: BacklogDrawerProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredJobs = useMemo(() => {
        return unassignedJobs.filter(job => 
            job.ordinePF.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.details.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [unassignedJobs, searchTerm]);

    const statusColors: Record<string, string> = {
        'DA_INIZIARE': 'bg-slate-500',
        'IN_PREPARAZIONE': 'bg-amber-500',
        'PRONTO_PROD': 'bg-emerald-500',
        'IN_PRODUZIONE': 'bg-blue-600',
        'FINE_PRODUZIONE': 'bg-purple-600',
        'QLTY_PACK': 'bg-pink-600',
        'CHIUSO': 'bg-emerald-900'
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent side="left" className="w-[400px] sm:w-[450px] p-0 border-r-4 border-blue-600 shadow-2xl bg-white">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 bg-slate-900 text-white">
                        <SheetHeader>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-600 rounded-lg">
                                    <Box className="h-5 w-5 text-white" />
                                </div>
                                <SheetTitle className="text-xl font-black uppercase tracking-tighter text-white">Commesse da Assegnare</SheetTitle>
                            </div>
                            <SheetDescription className="text-slate-400 font-bold text-xs uppercase tracking-widest">
                                {unassignedJobs.length} commesse da assegnare nel tabellone
                            </SheetDescription>
                        </SheetHeader>

                        <div className="mt-6 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder="Cerca ODL, Articolo o Cliente..." 
                                className="h-11 pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-500 font-bold rounded-xl focus-visible:ring-blue-500"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden p-4">
                        <Droppable droppableId="BACKLOG">
                            {(provided, snapshot) => (
                                <div 
                                    ref={provided.innerRef} 
                                    {...provided.droppableProps}
                                    className="h-full"
                                >
                                    <ScrollArea className="h-full pr-4">
                                        <div className="space-y-3 pb-8">
                                            {filteredJobs.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center p-12 text-center opacity-40">
                                                    <LayoutList className="h-12 w-12 text-slate-300 mb-4" />
                                                    <p className="text-sm font-black uppercase tracking-widest text-slate-400 italic">Nessuna commessa trovata</p>
                                                </div>
                                            ) : (
                                                filteredJobs.map((job, index) => (
                                                    <Draggable key={job.id} draggableId={job.id} index={index}>
                                                        {(provided, dSnapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                className={cn(
                                                                    "group bg-white border-2 border-slate-100 rounded-2xl p-4 shadow-sm hover:border-blue-400 transition-all flex items-start gap-3",
                                                                    dSnapshot.isDragging && "shadow-2xl border-blue-600 scale-[1.02] bg-blue-50/50"
                                                                )}
                                                            >
                                                                <div className="mt-1">
                                                                    <GripVertical className="h-4 w-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                                                                </div>
                                                                <div className="flex-1 space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-sm font-black text-slate-900 uppercase tracking-tight">{job.ordinePF}</span>
                                                                        <Badge variant="outline" className="text-[10px] font-black bg-slate-50 text-slate-600 border-slate-200">
                                                                            {job.qta} PZ
                                                                        </Badge>
                                                                    </div>
                                                                    <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{job.cliente}</p>
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <div className={cn("h-2 w-2 rounded-full", statusColors[job.status] || 'bg-slate-300')} />
                                                                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-tighter">{job.status?.replace('_', ' ')}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5">
                                                                            <Badge variant="outline" className="text-[8px] font-black uppercase border-slate-100 text-slate-400">{job.department}</Badge>
                                                                            {onExclude && (
                                                                                <Button variant="ghost" size="icon" className="h-5 w-5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full shrink-0" onClick={(e) => { e.stopPropagation(); onExclude(job.id); }}>
                                                                                    <XCircle className="h-3 w-3" />
                                                                                </Button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))
                                            )}
                                        </div>
                                        {provided.placeholder}
                                    </ScrollArea>
                                </div>
                            )}
                        </Droppable>
                    </div>

                    {/* Footer Info */}
                    <div className="p-4 bg-slate-50 border-t flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-3 w-3 text-blue-600" />
                            <span className="text-[9px] font-bold text-slate-500 uppercase italic">Trascina le card nel reparto core desiderato</span>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
