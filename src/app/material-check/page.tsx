

"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge as UiBadge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode } from '@/app/material-loading/actions';
import { getMaterialWithdrawalsForMaterial } from '@/app/admin/raw-material-management/actions';
import type { RawMaterial, MaterialWithdrawal } from '@/lib/mock-data';
import { QrCode, AlertTriangle, SearchCheck, Send, Loader2, Keyboard, History, ArrowUpCircle, ArrowDownCircle, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';


interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string; // ISO String
  description: string;
  quantity: number; // Positive for income, negative for outcome
  unit: string;
  id: string; // Batch or Withdrawal ID
};


export default function MaterialCheckPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'result'>('initial');
    const [foundMaterial, setFoundMaterial] = useState<RawMaterial | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    
    // History State
    const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
    const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [hasCameraPermission, setHasCameraPermission] = useState(true);


    useEffect(() => {
        if (!authLoading && operator) {
            const allowedAccessReparti = ['MAG', 'Collaudo', 'CG'];
            const hasAccess = operator.role === 'superadvisor' || 
                              (Array.isArray(operator.reparto) 
                                ? operator.reparto.some(r => allowedAccessReparti.includes(r))
                                : allowedAccessReparti.includes(operator.reparto));
            
            if (!hasAccess) {
                toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
                router.replace('/dashboard');
            }
        }
    }, [operator, authLoading, router, toast]);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);
    
    const handleCodeSubmit = useCallback(async (code: string) => {
        stopCamera();
        setStep('initial');
        const trimmedCode = code.trim();
        if (!trimmedCode) {
            toast({ variant: 'destructive', title: "Codice Vuoto", description: "Inserisci un codice valido." });
            setStep('manual_input');
            return;
        }
        setIsSearching(true);
        toast({ title: "Ricerca in corso", description: `Ricerca materia prima: ${trimmedCode}...` });
        
        const result = await getRawMaterialByCode(trimmedCode);
        
        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
            setFoundMaterial(null);
            setStep('initial');
        } else {
            setFoundMaterial(result);
            setStep('result');
        }
        setIsSearching(false);
    }, [stopCamera, toast]);


    useEffect(() => {
        if (step !== 'scanning') {
            stopCamera();
            return;
        }

        const startCamera = async () => {
            setHasCameraPermission(true);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }

            } catch (err) {
                setHasCameraPermission(false);
                toast({ variant: "destructive", title: "Errore Fotocamera", description: "Accesso negato o non disponibile. Controlla i permessi del browser." });
                stopCamera(); 
            }
        };

        startCamera();

        return () => { stopCamera(); };
    }, [step, stopCamera, toast]);
    
     const triggerScan = async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            toast({ variant: 'destructive', title: 'Fotocamera non pronta.' });
            return;
        }
        if (!('BarcodeDetector' in window)) {
            toast({ variant: 'destructive', title: 'Funzionalità non supportata.' });
            return;
        }

        setIsCapturing(true);
        try {
            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0) {
                handleCodeSubmit(barcodes[0].rawValue);
            } else {
                toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
        } finally {
            setIsCapturing(false);
        }
    };
    
    const resetFlow = () => {
        setFoundMaterial(null);
        setManualCode('');
        setStep('initial');
    };

    const handleOpenHistoryDialog = async () => {
        if (!foundMaterial) return;
        setIsHistoryDialogOpen(true);
        
        const withdrawals = await getMaterialWithdrawalsForMaterial(foundMaterial.id);
        const batches = foundMaterial.batches || [];
        
        const combinedMovements: Movement[] = [
            ...batches.map(b => ({
                type: 'Carico' as const,
                date: b.date,
                description: `Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
                quantity: b.quantity,
                unit: foundMaterial.unitOfMeasure.toUpperCase(),
                id: b.id
            })),
            ...withdrawals.map(w => ({
                type: 'Scarico' as const,
                date: w.withdrawalDate.toISOString(),
                description: `Commesse: ${w.jobOrderPFs.join(', ')}`,
                quantity: -w.consumedWeight,
                unit: 'KG',
                id: w.id
            }))
        ];

        combinedMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setMaterialMovements(combinedMovements);
    };

    if (authLoading || !operator) {
        return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
    }
    
    return (
        <AuthGuard>
            <AppShell>
                <div className="space-y-6 max-w-2xl mx-auto">
                    <OperatorNavMenu />

                    {step === 'initial' && (
                         <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-3"><SearchCheck className="h-7 w-7 text-primary" /> Verifica Materia Prima</CardTitle>
                                <CardDescription>Avvia la scansione o inserisci un codice per cercare una materia prima e visualizzarne i dettagli.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Button onClick={() => setStep('scanning')} className="w-full" size="lg">
                                    <QrCode className="mr-2 h-5 w-5" />
                                    Avvia Scansione
                                </Button>
                                <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full">
                                    <Keyboard className="mr-2 h-5 w-5" />
                                    Inserisci Codice Manualmente
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                     {step === 'manual_input' && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Inserimento Manuale</CardTitle>
                                <CardDescription>Digita il codice della materia prima da cercare.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative">
                                    <Label htmlFor="manualCode">Codice Materia Prima</Label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Input
                                            id="manualCode"
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value)}
                                            placeholder="Es. BOB-123 o TUBI..."
                                            autoFocus
                                            autoComplete="off"
                                        />
                                        <Button onClick={() => handleCodeSubmit(manualCode)} disabled={!manualCode || isSearching}>
                                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            <span className="sr-only">Cerca</span>
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex-col gap-4">
                                <Button type="button" variant="outline" onClick={() => setStep('initial')} className="w-full">Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                    {step === 'scanning' && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-center">Inquadra il Codice Materiale</CardTitle>
                                <CardDescription className="text-center">Posiziona il QR code o il codice a barre all'interno del riquadro.</CardDescription>
                            </CardHeader>
                            <CardContent className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                                {!hasCameraPermission ? (
                                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                                        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                                        <p className="text-destructive-foreground font-semibold">Accesso alla fotocamera negato</p>
                                        <p className="text-sm text-muted-foreground mt-2">Controlla i permessi del browser per continuare.</p>
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 grid place-items-center pointer-events-none">
                                        <div className="w-5/6 h-2/5 relative">
                                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                                            <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex-col gap-2">
                                <Button onClick={triggerScan} disabled={isCapturing || !hasCameraPermission} className="w-full h-12">
                                    {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5" />}
                                    <span className="ml-2">{isCapturing ? 'Scansione...' : 'Scansiona Ora'}</span>
                                </Button>
                                <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                    {step === 'result' && foundMaterial && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Scheda Prodotto: {foundMaterial.code}</CardTitle>
                                <CardDescription>{foundMaterial.description}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 rounded-lg border bg-background">
                                        <Label>Stock Attuale ({foundMaterial.unitOfMeasure.toUpperCase()})</Label>
                                        <p className="text-2xl font-bold">{foundMaterial.currentStockUnits ?? 0}</p>
                                    </div>
                                    <div className="p-3 rounded-lg border bg-background">
                                        <Label>Stock Attuale (KG)</Label>
                                        <p className="text-2xl font-bold">{foundMaterial.currentWeightKg?.toFixed(2) ?? '0.00'}</p>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex-col gap-2">
                                <Button onClick={handleOpenHistoryDialog} variant="secondary" className="w-full">
                                    <History className="mr-2 h-4 w-4" />
                                    Vedi Storico Movimenti
                                </Button>
                                <Button onClick={resetFlow} className="w-full">Cerca un Altro Materiale</Button>
                            </CardFooter>
                        </Card>
                    )}
                </div>

                <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
                    <DialogContent className="sm:max-w-4xl">
                        <DialogHeader>
                            <DialogTitle>Storico Movimenti per: {foundMaterial?.code}</DialogTitle>
                            <DialogDescription>
                                Elenco di tutti i carichi e scarichi registrati per questo materiale.
                            </DialogDescription>
                        </DialogHeader>
                          <ScrollArea className="max-h-[60vh]">
                              <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Data</TableHead>
                                  <TableHead>Tipo</TableHead>
                                  <TableHead>Descrizione</TableHead>
                                  <TableHead className="text-right">Quantità</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {materialMovements.length > 0 ? (
                                    materialMovements.map(mov => (
                                    <TableRow key={mov.id}>
                                        <TableCell>{format(parseISO(mov.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                        <TableCell>
                                            <UiBadge variant={mov.type === 'Carico' ? 'default' : 'destructive'} className={cn(mov.type === 'Carico' && 'bg-green-600 hover:bg-green-700')}>
                                              {mov.type === 'Carico' ? <ArrowUpCircle className="mr-2 h-4 w-4"/> : <ArrowDownCircle className="mr-2 h-4 w-4"/>}
                                              {mov.type}
                                            </UiBadge>
                                        </TableCell>
                                        <TableCell>{mov.description}</TableCell>
                                        <TableCell className={cn("text-right font-mono", mov.type === 'Carico' ? 'text-green-500' : 'text-destructive')}>
                                          {mov.quantity.toFixed(2)} {mov.unit}
                                        </TableCell>
                                    </TableRow>
                                    ))
                                ) : (
                                  <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">Nessuno storico movimenti per questo materiale.</TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                        </ScrollArea>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="outline">Chiudi</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            </AppShell>
        </AuthGuard>
    );
}
