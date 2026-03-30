
"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import type { ActiveMaterialSessionData } from '@/types';
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
import { closeMaterialSessionAndUpdateStock } from '@/app/scan-job/actions';
import { Boxes, Weight, Send, Loader2, X, AlertTriangle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

const closingWeightSchema = z.object({
    closingWeight: z.coerce.number().min(0, "Il peso non può essere negativo."),
});

type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

function SessionClosureDialog({ session, isOpen, onOpenChange }: { session: ActiveMaterialSessionData; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
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

        if (values.closingWeight > session.grossOpeningWeight + 0.01) { // Tolleranza minima
            form.setError("closingWeight", { type: "manual", message: "Il peso di chiusura non può essere maggiore di quello di apertura." });
            return;
        }

        setIsProcessing(true);
        const result = await closeMaterialSessionAndUpdateStock(
            session,
            values.closingWeight,
            operator.id,
            false // isFinished = false
        );

        toast({
            title: result.success ? "Sessione Chiusa" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            closeSession(session.materialId, session.lotto);
            onOpenChange(false);
        }
        setIsProcessing(false);
    };

    const handleFinishedSubmit = async () => {
        if (!operator) return;
        setIsProcessing(true);
        
        // Passiamo 0 come peso lordo di chiusura (non verrà usato se isFinished=true)
        const result = await closeMaterialSessionAndUpdateStock(
            session,
            0,
            operator.id,
            true // isFinished = true
        );

        toast({
            title: result.success ? "Materiale Finito" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            closeSession(session.materialId, session.lotto);
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
                        Stai chiudendo il prelievo per <span className="font-bold text-foreground">{session.materialCode}</span>.
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

export default function ActiveMaterialSessionBar() {
    const { activeSessions, isLoading } = useActiveMaterialSession();
    const [closingSession, setClosingSession] = useState<ActiveMaterialSessionData | null>(null);

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

    return (
        <>
            <Sheet>
                <SheetTrigger asChild>
                    <Button
                        variant="destructive"
                        className="fixed top-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg animate-in fade-in-0 zoom-in-95"
                    >
                        <div className="relative">
                            <Boxes className="h-6 w-6" />
                            <Badge variant="secondary" className="absolute -top-2 -right-3 h-5 w-5 justify-center p-0 rounded-full">
                                {activeSessions.length}
                            </Badge>
                        </div>
                    </Button>
                </SheetTrigger>
                <SheetContent>
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive" /> Sessioni Materiale Attive</SheetTitle>
                        <SheetDescription>
                            Queste sessioni rimarranno attive finché non verranno chiuse manualmente.
                        </SheetDescription>
                    </SheetHeader>
                    <ScrollArea className="h-[calc(100vh-150px)] pr-4">
                        <div className="grid gap-4 py-4">
                            {activeSessions.map((session) => (
                                <div key={`${session.materialId}-${session.lotto}`} className="p-4 border rounded-lg space-y-3">
                                    <div>
                                        <div className="font-semibold text-sm flex items-center gap-2">{session.materialCode} <Badge variant="outline">{session.category}</Badge></div>
                                        <p className="text-xs text-muted-foreground">Lotto: {session.lotto || 'N/D'}</p>
                                        <p className="text-xs text-muted-foreground">Aperto con: {session.grossOpeningWeight.toFixed(2)} kg</p>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        <p className="font-medium text-foreground">Commesse Associate:</p>
                                        <ul className="list-disc pl-4">
                                            {session.associatedJobs.map(j => <li key={j.jobId}>{j.jobOrderPF}</li>)}
                                        </ul>
                                    </div>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => setClosingSession(session)}
                                    >
                                        <X className="mr-2 h-4 w-4" /> Chiudi Sessione
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    <SheetFooter>
                        <SheetClose asChild>
                            <Button variant="outline">Chiudi</Button>
                        </SheetClose>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            {closingSession && (
                <SessionClosureDialog
                    session={closingSession}
                    isOpen={!!closingSession}
                    onOpenChange={(open) => {
                        if (!open) {
                            setClosingSession(null);
                        }
                    }}
                />
            )}
        </>
    );
}
