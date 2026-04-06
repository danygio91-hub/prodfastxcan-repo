'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
    Search, 
    Filter, 
    Play, 
    CheckCircle, 
    ArrowRight, 
    SkipForward, 
    Info, 
    AlertCircle, 
    Timer, 
    Package, 
    Truck, 
    Factory, 
    ClipboardCheck, 
    BoxSelect 
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { advanceJobStatus } from './weekly-actions';
import { useToast } from '@/hooks/use-toast';
import type { JobOrder, Article } from '@/types';

interface MasterConsoleProps {
    jobOrders: JobOrder[];
    articles: Article[];
    onRefresh: () => void;
}

export default function MasterConsole({ jobOrders, articles, onRefresh }: MasterConsoleProps) {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('ACTIVE'); // Default: solo attive

    const filteredJobs = useMemo(() => {
        return jobOrders.filter(job => {
            const s = searchTerm.toLowerCase();
            const matchesSearch = !searchTerm || 
                job.ordinePF.toLowerCase().includes(s) ||
                job.cliente.toLowerCase().includes(s) ||
                (job.details || '').toLowerCase().includes(s);
            
            let matchesStatus = true;
            if (statusFilter === 'ACTIVE') {
                matchesStatus = job.status !== 'CHIUSO';
            } else if (statusFilter !== 'ALL') {
                matchesStatus = job.status === statusFilter;
            }
            
            return matchesSearch && matchesStatus;
        });
    }, [jobOrders, searchTerm, statusFilter]);

    const handleAdvance = async (jobId: string, nextStatus?: string) => {
        const res = await advanceJobStatus(jobId, nextStatus);
        if (res.success) {
            toast({ title: "Stato Aggiornato", description: `Nuovo stato: ${res.newStatus}` });
            onRefresh();
        } else {
            toast({ title: "Errore", description: res.message, variant: "destructive" });
        }
    };

    const statusMap: Record<string, { label: string, color: string, icon: React.ReactNode }> = {
        'DA_INIZIARE': { label: 'DA INIZIARE', color: 'bg-slate-400', icon: <BoxSelect className="h-4 w-4" /> },
        'IN_PREPARAZIONE': { label: 'IN PREP.', color: 'bg-amber-500', icon: <Timer className="h-4 w-4" /> },
        'PRONTO_PROD': { label: 'PRONTO PROD.', color: 'bg-emerald-500', icon: <Play className="h-4 w-4" /> },
        'IN_PRODUZIONE': { label: 'IN PROD.', color: 'bg-blue-600', icon: <Factory className="h-4 w-4" /> },
        'FINE_PRODUZIONE': { label: 'FINE PROD.', color: 'bg-purple-600', icon: <CheckCircle className="h-4 w-4" /> },
        'QLTY_PACK': { label: 'QLTY & PACK', color: 'bg-pink-600', icon: <Package className="h-4 w-4" /> },
        'CHIUSO': { label: 'CHIUSO', color: 'bg-slate-900', icon: <Truck className="h-4 w-4" /> }
    };

    return (
        <div className="flex flex-col gap-8 p-6 bg-slate-50 min-h-screen">
            {/* Header / Filtri */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-white p-6 rounded-3xl border-2 border-slate-200 shadow-sm">
                <div className="relative flex-1 w-full max-w-xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <Input 
                        placeholder="Cerca per ODL, Articolo o Cliente..." 
                        className="pl-12 h-12 bg-slate-50 border-2 border-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600 font-bold text-sm rounded-2xl"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-4 md:pb-0 scrollbar-hide">
                    <Button 
                        variant={statusFilter === 'ACTIVE' ? 'default' : 'outline'} 
                        size="sm" 
                        onClick={() => setStatusFilter('ACTIVE')}
                        className={cn("h-10 text-[10px] font-black uppercase tracking-widest px-6 rounded-xl", statusFilter === 'ACTIVE' ? "bg-blue-700 shadow-blue-200 shadow-lg" : "border-2 border-slate-100")}
                    >
                        SOLO ATTIVE
                    </Button>
                    <div className="h-6 w-px bg-slate-200 mx-2" />
                    {Object.entries(statusMap).map(([key, value]) => (
                        <Button 
                            key={key}
                            variant={statusFilter === key ? 'default' : 'outline'} 
                            size="sm" 
                            onClick={() => setStatusFilter(key)}
                            className={cn(
                                "h-10 text-[10px] font-black uppercase gap-2 whitespace-nowrap px-4 rounded-xl border-2 transition-all", 
                                statusFilter === key ? `${value.color} text-white border-transparent shadow-lg` : "border-slate-50 text-slate-400 hover:border-slate-200"
                            )}
                        >
                            {value.label}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Griglia Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {filteredJobs.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center p-32 bg-white rounded-[3rem] border-4 border-dashed border-slate-100 opacity-60">
                        <Filter className="h-16 w-16 text-slate-200 mb-6" />
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-300 italic">Il tuo quartier generale è vuoto</p>
                    </div>
                ) : (
                    filteredJobs.map(job => (
                        <MasterConsoleJobCard 
                            key={job.id} 
                            job={job} 
                            article={articles.find(a => a.code.toUpperCase() === (job.details || '').toUpperCase())}
                            onAdvance={handleAdvance}
                            statusInfo={statusMap[job.status] || { label: job.status, color: 'bg-slate-200', icon: <AlertCircle className="h-4 w-4" /> }}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function MasterConsoleJobCard({ job, article, onAdvance, statusInfo }: { job: JobOrder, article?: Article, onAdvance: (id: string, next?: string) => void, statusInfo: any }) {
    return (
        <Card className="group border-2 border-slate-100 hover:border-blue-400 transition-all shadow-sm hover:shadow-2xl rounded-3xl overflow-hidden bg-white">
            <CardHeader className="p-5 bg-slate-50/50 border-b-2 border-slate-100 flex flex-row items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <span className="text-base font-black uppercase text-slate-900 tracking-tighter">{job.ordinePF}</span>
                        <Badge variant="outline" className="text-[9px] font-black bg-white text-blue-600 border-blue-100 rounded-md py-0 px-1.5 h-5">{job.numeroODLInterno || 'N/D'}</Badge>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate max-w-[180px]">{job.cliente}</p>
                </div>
                <div className={cn("flex flex-col items-center justify-center min-w-[60px] h-[60px] rounded-2xl text-white shadow-xl", statusInfo.color)}>
                    {statusInfo.icon}
                    <span className="text-[8px] font-black uppercase tracking-tighter mt-1.5 leading-none text-center px-1">{statusInfo.label}</span>
                </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.1em] mb-1">Codice Articolo</span>
                        <span className="text-sm font-black uppercase text-slate-800 tracking-tight">{job.details}</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.1em] mb-1">Quantità</span>
                        <span className="text-sm font-black text-blue-700 bg-blue-50 px-2 rounded-lg">{job.qta} PZ</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                        <BoxSelect className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-[10px] font-black text-slate-700 uppercase">{job.department}</span>
                    </div>
                    {job.dataConsegnaFinale && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border-2 border-slate-100">
                            <Truck className="h-3.5 w-3.5 text-slate-400" />
                            <span className="text-[10px] font-black text-slate-700 uppercase">{format(new Date(job.dataConsegnaFinale), 'dd/MM/yyyy')}</span>
                        </div>
                    )}
                </div>

                <div className="h-px bg-slate-100 w-full" />

                {/* Pulsantiera Avanzamento */}
                <div className="grid grid-cols-2 gap-3">
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        className="h-12 font-black text-[10px] uppercase tracking-tighter gap-2 bg-slate-100 hover:bg-blue-600 hover:text-white transition-all shadow-md rounded-xl group/btn"
                        onClick={() => onAdvance(job.id)}
                        disabled={job.status === 'CHIUSO'}
                    >
                        <ArrowRight className="h-4 w-4 group-hover/btn:translate-x-1 transition-transform" />
                        AVANZA ORA
                    </Button>
                    <Button 
                        size="sm" 
                        variant="outline" 
                        className="h-12 font-black text-[10px] uppercase tracking-tighter gap-2 border-2 border-dashed border-slate-200 hover:bg-emerald-600 hover:text-white hover:border-transparent transition-all shadow-sm rounded-xl"
                        onClick={() => onAdvance(job.id, 'CHIUSO')}
                        disabled={job.status === 'CHIUSO'}
                    >
                        <SkipForward className="h-4 w-4" />
                        CHIUDI TUTTO
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                    <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-9 font-black text-[9px] uppercase tracking-widest text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        onClick={() => onAdvance(job.id, 'PRONTO_PROD')}
                        disabled={job.status === 'PRONTO_PROD'}
                    >
                        Salta a Pronto
                    </Button>
                    <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-9 font-black text-[9px] uppercase tracking-widest text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg"
                        onClick={() => onAdvance(job.id, 'QLTY_PACK')}
                        disabled={job.status === 'QLTY_PACK'}
                    >
                        Salta a Pack
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

