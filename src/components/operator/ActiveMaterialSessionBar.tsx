
"use client";

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import type { IndependentMaterialSession } from '@/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
    SheetClose,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Boxes, Weight, Send, Loader2, X, AlertTriangle, PlusCircle, Link2, User, Clock, Search, Camera } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { addJobsToSession } from '@/app/actions/material-sessions';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { cn } from '@/lib/utils';

const closingWeightSchema = z.object({
    closingWeight: z.coerce.number().min(0, "Il peso non può essere negativo."),
});

type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

function SessionClosureDialog({ session, isOpen, onOpenChange }: { session: IndependentMaterialSession; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
    const { closeSession } = useActiveMaterialSession();
    const { operator } = useAuth();
    const { toast } = useToast();
    const [isProcessing, setIsProcessing] = useState(false);

    const form = useForm<ClosingWeightFormValues>({
        resolver: zodResolver(closingWeightSchema),
        defaultValues: { closingWeight: 0 },
    });

    React.useEffect(() => {
        if (isOpen) {
            form.reset({ closingWeight: session.grossOpeningWeight });
        }
    }, [isOpen, session, form]);

    const handleCloseSessionSubmit = async (values: ClosingWeightFormValues) => {
        if (!operator) return;

        if (values.closingWeight > session.grossOpeningWeight + 0.01) {
            form.setError("closingWeight", { type: "manual", message: "Il peso di chiusura non può essere maggiore di quello di apertura." });
            return;
        }

        setIsProcessing(true);
        const result = await closeSession(
            session.id,
            values.closingWeight,
            false // isFinished = false
        );

        toast({
            title: result.success ? "Sessione Chiusa" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            onOpenChange(false);
        }
        setIsProcessing(false);
    };

    const handleFinishedSubmit = async () => {
        if (!operator) return;
        setIsProcessing(true);
        
        const result = await closeSession(
            session.id,
            0,
            true // isFinished = true
        );

        toast({
            title: result.success ? "Materiale Finito" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            onOpenChange(false);
        }
        setIsProcessing(false);
    };

    const currentGrossOnScale = form.watch('closingWeight') || 0;
    const netCalculated = Math.max(0, currentGrossOnScale - (session.tareWeight || 0));

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Boxes className="h-5 w-5 text-primary" /> Chiudi Sessione 
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Stai chiudendo il prelievo per <span className="font-bold text-foreground">{session.materialCode}</span> di <span className="font-bold">{session.operatorName}</span>.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Transparency Panel */}
                    <div className="p-4 rounded-xl bg-muted/50 border-2 border-primary/10 space-y-3">
                        <div className="flex justify-between items-center border-b border-primary/10 pb-2">
                            <span className="text-[10px] uppercase font-black text-muted-foreground">Situazione Attuale</span>
                            <Badge variant="outline" className="font-mono text-[10px]">{session.lotto || 'SENZA LOTTO'}</Badge>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2">
                            <div className="text-center">
                                <p className="text-[8px] uppercase font-bold text-muted-foreground">Netto Residuo</p>
                                <p className="text-sm font-black">{session.netOpeningWeight.toFixed(3)}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-[8px] uppercase font-bold text-muted-foreground">Tara ({session.packagingId === 'none' ? 'Inesistente' : 'Bobina'})</p>
                                <p className="text-sm font-black text-orange-600">{session.tareWeight?.toFixed(3) || "0.000"}</p>
                            </div>
                            <div className="text-center bg-primary/5 rounded-md py-1">
                                <p className="text-[8px] uppercase font-bold text-primary">Lordo Atteso</p>
                                <p className="text-sm font-black text-primary">{session.grossOpeningWeight.toFixed(3)}</p>
                            </div>
                        </div>
                    </div>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleCloseSessionSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="closingWeight"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <div className="flex justify-between items-end mb-1">
                                            <FormLabel className="text-xs font-black uppercase text-primary">
                                                PESO LORDO (Sulla Bilancia)
                                            </FormLabel>
                                            <span className="text-[10px] font-bold text-muted-foreground italic">
                                                Netto risultante: {netCalculated.toFixed(3)} kg
                                            </span>
                                        </div>
                                        <FormControl>
                                            <div className="relative">
                                                <Weight className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                                <Input 
                                                    type="number" 
                                                    step="0.001" 
                                                    autoFocus 
                                                    className="pl-10 h-14 text-2xl font-black font-mono border-2 border-primary/20 focus-visible:border-primary"
                                                    {...field} 
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid gap-2">
                                <Button 
                                    type="submit" 
                                    className="w-full h-12 text-lg font-black uppercase tracking-tight"
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                                    Conferma Peso Lordo
                                </Button>
                                
                                <Button 
                                    type="button" 
                                    variant="destructive" 
                                    className="w-full h-12 text-lg font-black uppercase tracking-tight border-2 border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white"
                                    onClick={handleFinishedSubmit}
                                    disabled={isProcessing}
                                >
                                    <X className="mr-2 h-5 w-5" />
                                    Materiale Finito
                                </Button>
                            </div>
                        </form>
                    </Form>
                </div>
                
                <DialogFooter className="sm:justify-center">
                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-muted-foreground text-[10px] uppercase font-bold">
                        Annulla e mantieni attiva
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function AddJobDialog({ sessionId, isOpen, onOpenChange }: { sessionId: string; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
    const [newJobPF, setNewJobPF] = useState('');
    const [isLinking, setIsLinking] = useState(false);
    const { toast } = useToast();

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [lastScanned, setLastScanned] = useState<string | null>(null);
    const { hasPermission } = useCameraStream(scannerOpen && isOpen, videoRef);

    const triggerScan = useCallback(async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) return;
        if (!('BarcodeDetector' in window)) return;

        try {
            const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128'] });
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
                const code = barcodes[0].rawValue.trim();
                if (code && code !== lastScanned) {
                    setLastScanned(code);
                    await addJobsToSession(sessionId, [code]);
                    toast({ title: "Commessa Collegata", description: code });
                }
            }
        } catch (e) {
            console.error("Scan error:", e);
        }
    }, [sessionId, lastScanned, toast]);

    React.useEffect(() => {
        let interval: NodeJS.Timeout;
        if (scannerOpen && isOpen) {
            interval = setInterval(triggerScan, 500);
        }
        return () => clearInterval(interval);
    }, [scannerOpen, isOpen, triggerScan]);

    React.useEffect(() => {
        if (lastScanned) {
            const t = setTimeout(() => setLastScanned(null), 2000);
            return () => clearTimeout(t);
        }
    }, [lastScanned]);

    const handleAddJob = async () => {
        if (!newJobPF.trim()) return;
        setIsLinking(true);
        try {
            const res = await addJobsToSession(sessionId, [newJobPF.trim()]);
            if (res.success) {
                toast({ title: "Commessa Aggiunta" });
                setNewJobPF('');
            } else {
                toast({ variant: 'destructive', title: "Errore", description: res.message });
            }
        } catch (e) {
            toast({ variant: 'destructive', title: "Errore", description: "Impossibile aggiungere la commessa." });
        } finally {
            setIsLinking(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md border-2 border-primary/20 shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 font-black uppercase tracking-tight text-lg">
                        <Link2 className="h-5 w-5 text-primary" /> Collega Commesse
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase opacity-60">Scansiona QR o inserisci manualmente</DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-2">
                    {scannerOpen ? (
                        <div className="space-y-4">
                            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border-4 border-muted shadow-inner">
                                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                                <div className={cn(
                                    "absolute inset-0 bg-green-500/20 transition-opacity duration-300 pointer-events-none",
                                    lastScanned ? "opacity-100" : "opacity-0"
                                )} />
                                {lastScanned && (
                                    <div className="absolute top-4 left-1/2 -translate-x-1/2 animate-in zoom-in-50">
                                        <Badge className="bg-green-600 text-white font-black px-3 py-1 shadow-lg">LETTO: {lastScanned}</Badge>
                                    </div>
                                )}
                            </div>
                            <Button variant="outline" className="w-full h-12 font-black uppercase text-xs tracking-widest" onClick={() => setScannerOpen(false)}>
                                <X className="mr-2 h-4 w-4" /> Chiudi Scanner
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-2">
                                <Button className="h-16 text-lg font-black uppercase tracking-tight rounded-xl shadow-lg border-2 border-primary/20" onClick={() => setScannerOpen(true)}>
                                    <Camera className="mr-3 h-6 w-6" /> Avvia Scanner QR
                                </Button>
                            </div>
                            
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-[10px] uppercase font-black">
                                    <span className="bg-background px-2 text-muted-foreground">Oppure Manuale</span>
                                </div>
                            </div>

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50" />
                                <Input 
                                    placeholder="Es. 81-149-77/PF" 
                                    className="pl-9 h-12 text-lg font-bold rounded-xl border-2"
                                    value={newJobPF}
                                    onChange={e => setNewJobPF(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddJob()}
                                />
                            </div>
                            <Button className="w-full h-12 font-black uppercase tracking-tight rounded-xl" onClick={handleAddJob} disabled={isLinking || !newJobPF.trim()}>
                                {isLinking ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <PlusCircle className="h-5 w-5 mr-2" />}
                                Collega Manualmente
                            </Button>
                        </div>
                    )}
                </div>
                {!scannerOpen && (
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[10px] uppercase font-black text-muted-foreground">Chiudi</Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default function ActiveMaterialSessionBar() {
    const { activeSessions, isLoading } = useActiveMaterialSession();
    const { user, operator } = useAuth();
    const [closingSession, setClosingSession] = useState<IndependentMaterialSession | null>(null);
    const [addingJobToSessionId, setAddingJobToSessionId] = useState<string | null>(null);

    React.useEffect(() => {
        const handleCloseEvent = (e: any) => {
            if (e.detail) {
                setClosingSession(e.detail);
            }
        };
        window.addEventListener('close-material-session', handleCloseEvent);
        return () => window.removeEventListener('close-material-session', handleCloseEvent);
    }, []);

    if (isLoading || !activeSessions || activeSessions.length === 0) {
        return null;
    }

    const isAuthorized = operator?.canManageMaterialSessions || operator?.role === 'admin';

    return (
        <>
            <Sheet>
                <SheetTrigger asChild>
                    <Button
                        variant="destructive"
                        className="fixed top-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg animate-in fade-in-0 zoom-in-95 group overflow-hidden"
                    >
                        <div className="relative z-10">
                            <Boxes className="h-6 w-6 group-hover:scale-110 transition-transform" />
                            <Badge variant="secondary" className="absolute -top-2 -right-3 h-5 w-5 justify-center p-0 rounded-full border-2 border-destructive bg-white text-destructive font-black">
                                {activeSessions.length}
                            </Badge>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-br from-destructive to-destructive/80 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Button>
                </SheetTrigger>
                <SheetContent className="sm:max-w-md bg-slate-950/95 backdrop-blur-xl border-slate-800 text-white">
                    <SheetHeader className="border-b border-slate-800 pb-4">
                        <SheetTitle className="flex items-center gap-2">
                           <div className="p-2 bg-destructive/20 rounded-lg">
                               <Boxes className="h-5 w-5 text-destructive" />
                           </div>
                           <span className="font-black uppercase tracking-tight text-white">Sessioni Attive</span>
                        </SheetTitle>
                        <SheetDescription className="text-[10px] font-bold uppercase text-slate-400">
                            {isAuthorized ? "Pannello di controllo globale officina" : "Queste sono le tue sessioni aperte"}
                        </SheetDescription>
                    </SheetHeader>
                    <ScrollArea className="h-[calc(100vh-180px)] pr-4">
                        <div className="grid gap-4 py-6">
                            {activeSessions.map((session) => {
                                const isMine = session.operatorId === user?.uid;
                                return (                                    <div key={session.id} className="p-4 border-2 rounded-2xl space-y-4 bg-slate-900 border-slate-800 shadow-xl shadow-slate-950/40 transition-all relative overflow-hidden group">
                                        {!isMine && (
                                            <div className="absolute top-0 right-0 px-3 py-1 bg-primary/20 text-primary text-[8px] font-black uppercase rounded-bl-xl border-l border-b border-primary/30">
                                                Officina
                                            </div>
                                        )}
                                        {isMine && !isAuthorized && (
                                            <div className="absolute top-0 right-0 px-3 py-1 bg-destructive/20 text-destructive text-[8px] font-black uppercase rounded-bl-xl border-l border-b border-destructive/30">
                                                Mia
                                            </div>
                                        )}

                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-black text-lg tracking-tight leading-none text-white">{session.materialCode}</h3>
                                                <Badge variant="outline" className="font-mono text-[10px] h-5 border-slate-700 text-slate-300">{session.lotto || 'S/L'}</Badge>
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                <div className="flex items-center gap-1">
                                                    <User className="h-3 w-3" /> {session.operatorName}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" /> {session.startedAt ? format(new Date(session.startedAt), 'HH:mm', { locale: it }) : 'N/D'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-slate-800/50 rounded-xl p-3 space-y-2 border border-slate-700/50">
                                            <div className="flex items-center justify-between text-[9px] font-black uppercase text-slate-300">
                                                <span className="flex items-center gap-1"><Link2 className="h-3 w-3 opacity-60" /> Job Collegati</span>
                                                <span className="opacity-60">{(session.linkedJobOrderPFs || session.linkedJobOrderIds || []).length} Tot</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {(session.linkedJobOrderPFs || session.linkedJobOrderIds || []).map(pf => (
                                                    <Badge key={pf} variant="secondary" className="bg-slate-700 border-slate-600 text-slate-100 font-mono text-[9px] h-6 px-2 hover:bg-slate-600">
                                                        {pf}
                                                    </Badge>
                                                ))}
                                                {(session.linkedJobOrderIds || []).length === 0 && (
                                                    <span className="text-[10px] italic text-slate-500 py-1 font-bold">Nessuna commessa...</span>
                                                )}
                                            </div>
                                            {(isAuthorized || isMine) && (
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="w-full text-[9px] font-black uppercase h-7 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                                                    onClick={() => setAddingJobToSessionId(session.id)}
                                                >
                                                    <PlusCircle className="mr-1 h-3 w-3" /> Aggiungi Commessa
                                                </Button>
                                            )}
                                        </div>


                                        <div className="flex gap-2 pt-2">
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                className="flex-1 font-black text-[10px] uppercase h-10 tracking-wider shadow-lg shadow-destructive/20 active:scale-95 transition-transform"
                                                onClick={() => setClosingSession(session)}
                                            >
                                                <X className="mr-2 h-4 w-4" /> Chiudi Sessione
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                    <SheetFooter className="border-t border-slate-800 pt-4">
                        <SheetClose asChild>
                            <Button variant="outline" className="w-full font-bold uppercase text-[10px] tracking-widest border-slate-700 text-slate-300 hover:bg-slate-800">Chiudi Pannello</Button>
                        </SheetClose>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            {closingSession && (
                <SessionClosureDialog
                    session={closingSession}
                    isOpen={!!closingSession}
                    onOpenChange={(open) => {
                        if (!open) setClosingSession(null);
                    }}
                />
            )}

            {addingJobToSessionId && (
                <AddJobDialog
                    sessionId={addingJobToSessionId}
                    isOpen={!!addingJobToSessionId}
                    onOpenChange={(open) => {
                        if (!open) setAddingJobToSessionId(null);
                    }}
                />
            )}
        </>
    );
}
