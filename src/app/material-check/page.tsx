
"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
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
import { useMasterData } from '@/contexts/MasterDataProvider';

import { getRawMaterialByCode, findLastWeightForLotto } from '@/app/scan-job/actions';
import { getMaterialWithdrawalsForMaterial, getLotInfoForMaterial, type LotInfo } from '@/app/admin/raw-material-management/actions';
import type { RawMaterial } from '@/types';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { QrCode, AlertTriangle, SearchCheck, Send, Loader2, Keyboard, History, ArrowUpCircle, ArrowDownCircle, Camera, Barcode, Package, Info, Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDisplayStock } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

type Movement = {
  type: 'Carico' | 'Scarico';
  date: string;
  description: string;
  quantity: number;
  unit: string;
  id: string;
};

type Step = 'initial' | 'scanning_material' | 'scanning_lotto' | 'manual_input' | 'result';

export default function MaterialCheckPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const { rawMaterialsMap, isLoading: isMasterLoading } = useMasterData();

    const [step, setStep] = useState<Step>('initial');
    const [foundMaterial, setFoundMaterial] = useState<RawMaterial | null>(null);
    const [foundLotInfo, setFoundLotInfo] = useState<LotInfo | null>(null);
    const [allLots, setAllLots] = useState<LotInfo[]>([]);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    
    const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
    const [materialMovements, setMaterialMovements] = useState<Movement[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [hasCameraPermission, setHasCameraPermission] = useState(true);

    useEffect(() => {
        if (!authLoading && operator) {
            const allowedAccessReparti = ['MAG', 'Collaudo'];
            const hasAccess = operator.role === 'admin' || 
                              operator.role === 'supervisor' || 
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
        setIsCapturing(false);
    }, []);

    if (authLoading || isMasterLoading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }
    
    const fetchMaterialDetails = async (material: RawMaterial, specificLotto?: string) => {
        try {
            const lots = await getLotInfoForMaterial(material.id);
            setAllLots(lots);
            if (specificLotto) {
                const matched = lots.find(l => l.lotto === specificLotto);
                setFoundLotInfo(matched || null);
            }
        } catch (e) {
            console.error("Error fetching lots:", e);
        }
    };

    const handleCodeSubmit = useCallback(async (code: string) => {
        stopCamera();
        const trimmedCode = code.trim();
        if (!trimmedCode) {
            toast({ variant: 'destructive', title: "Codice Vuoto", description: "Inserisci un codice valido." });
            return;
        }
        setIsSearching(true);
        
        if (step === 'scanning_lotto') {
            const lottoData = await findLastWeightForLotto(undefined, trimmedCode);
            if (lottoData?.material) {
                setFoundMaterial(lottoData.material);
                await fetchMaterialDetails(lottoData.material, trimmedCode);
                setStep('result');
            } else {
                toast({ variant: 'destructive', title: 'Lotto non trovato', description: 'Nessuna corrispondenza trovata per questo lotto.' });
                setStep('initial');
            }
        } else {
            // Check cache first
            const cachedMat = rawMaterialsMap.get(trimmedCode.toUpperCase());
            if (cachedMat) {
                setFoundMaterial(cachedMat);
                await fetchMaterialDetails(cachedMat);
                setStep('result');
            } else {
                // Fallback to server if not in cache (could be a very new material)
                const result = await getRawMaterialByCode(trimmedCode);
                if ('error' in result) {
                    toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
                    setStep('initial');
                } else {
                    setFoundMaterial(result);
                    await fetchMaterialDetails(result);
                    setStep('result');
                }
            }
        }
        setIsSearching(false);
    }, [stopCamera, toast, step]);

    useEffect(() => {
        if (step !== 'scanning_material' && step !== 'scanning_lotto') {
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
                toast({ variant: "destructive", title: "Errore Fotocamera", description: "Accesso negato o non disponibile." });
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
            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
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
        setFoundLotInfo(null);
        setAllLots([]);
        setManualCode('');
        setStep('initial');
    };

    const handleOpenHistoryDialog = async () => {
        if (!foundMaterial) return;
        setIsHistoryDialogOpen(true);
        const withdrawals = await getMaterialWithdrawalsForMaterial(foundMaterial.id);
        const combinedMovements: Movement[] = [
            ...(foundMaterial.batches || []).map(b => ({
                type: 'Carico' as const,
                date: b.date,
                description: `Lotto: ${b.lotto || 'N/D'} - DDT: ${b.ddt}`,
                quantity: b.netQuantity,
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
                    {step === 'initial' && (
                         <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-3"><SearchCheck className="h-7 w-7 text-primary" /> Verifica Materiale</CardTitle>
                                <CardDescription>Cerca una materia prima per codice o lotto per visualizzare stock e dettagli.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 gap-4 pt-4">
                                <Button onClick={() => setStep('scanning_material')} className="h-16 text-lg" variant="default">
                                    <QrCode className="mr-2 h-6 w-6" />
                                    Scansione Materiale
                                </Button>
                                <Button onClick={() => setStep('scanning_lotto')} className="h-16 text-lg" variant="secondary">
                                    <Barcode className="mr-2 h-6 w-6" />
                                    Scansione Lotto
                                </Button>
                                <Separator className="my-2" />
                                <Button onClick={() => setStep('manual_input')} variant="outline">
                                    <Keyboard className="mr-2 h-5 w-5" />
                                    Inserimento Manuale
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                     {step === 'manual_input' && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Ricerca Manuale</CardTitle>
                                <CardDescription>Inserisci il codice della materia prima.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="manualCode">Codice Materiale</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="manualCode"
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value)}
                                            placeholder="Es. BOB-123"
                                            autoFocus
                                        />
                                        <Button onClick={() => handleCodeSubmit(manualCode)} disabled={!manualCode || isSearching}>
                                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button variant="outline" onClick={() => setStep('initial')} className="w-full">Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                    {(step === 'scanning_material' || step === 'scanning_lotto') && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-center">Inquadra il Codice {step === 'scanning_lotto' ? 'Lotto' : 'Materiale'}</CardTitle>
                            </CardHeader>
                            <CardContent className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                                {!hasCameraPermission && (
                                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                                        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                                        <p className="text-white font-semibold">Accesso fotocamera negato</p>
                                    </div>
                                )}
                                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                                    <div className="w-5/6 h-2/5 border-2 border-primary/50 rounded-lg relative">
                                        <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex-col gap-2">
                                <Button onClick={triggerScan} disabled={isCapturing || !hasCameraPermission} className="w-full h-12">
                                    {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="mr-2 h-5 w-5" />}
                                    <span className="ml-2">Scansiona Ora</span>
                                </Button>
                                <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                    {step === 'result' && foundMaterial && (
                        <div className="space-y-4">
                            <Card className="border-primary/20 shadow-md">
                                <CardHeader className="bg-muted/30 pb-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-2xl font-bold">{foundMaterial.code}</CardTitle>
                                            <CardDescription className="text-foreground/70">{foundMaterial.description}</CardDescription>
                                        </div>
                                        <UiBadge variant="outline">{foundMaterial.type}</UiBadge>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6 space-y-6">
                                    {foundLotInfo && (
                                        <Alert className="bg-primary/5 border-primary/20">
                                            <Info className="h-4 w-4 text-primary" />
                                            <AlertTitle className="font-bold text-primary">Lotto Selezionato: {foundLotInfo.lotto}</AlertTitle>
                                            <AlertDescription className="text-base font-semibold">
                                                Disponibilità: {formatDisplayStock(foundLotInfo.available, foundMaterial.unitOfMeasure)} {foundMaterial.unitOfMeasure.toUpperCase()}
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="p-4 rounded-lg border bg-background text-center space-y-1">
                                            <Label className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider">Stock Totale ({foundMaterial.unitOfMeasure.toUpperCase()})</Label>
                                            <p className="text-2xl font-black text-primary">{formatDisplayStock(foundMaterial.currentStockUnits, foundMaterial.unitOfMeasure)}</p>
                                        </div>
                                        <div className="p-4 rounded-lg border bg-background text-center space-y-1">
                                            <Label className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider">Peso Netto Totale (KG)</Label>
                                            <p className="text-2xl font-black text-primary">{formatDisplayStock(foundMaterial.currentWeightKg, 'kg')}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="font-bold flex items-center gap-2"><Boxes className="h-4 w-4 text-muted-foreground" /> Breakdown Lotti Disponibili</h4>
                                        <ScrollArea className="h-48 border rounded-md">
                                            <Table>
                                                <TableHeader className="bg-muted/50">
                                                    <TableRow>
                                                        <TableHead>Lotto</TableHead>
                                                        <TableHead className="text-right">Residuo ({foundMaterial.unitOfMeasure.toUpperCase()})</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {allLots.length > 0 ? allLots.map(lot => (
                                                        <TableRow key={lot.lotto} className={cn(lot.lotto === foundLotInfo?.lotto && "bg-primary/5")}>
                                                            <TableCell className="font-mono font-bold">{lot.lotto}</TableCell>
                                                            <TableCell className="text-right font-semibold">{formatDisplayStock(lot.available, foundMaterial.unitOfMeasure)}</TableCell>
                                                        </TableRow>
                                                    )) : (
                                                        <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground italic">Nessun lotto con stock positivo.</TableCell></TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </ScrollArea>
                                    </div>
                                </CardContent>
                                <CardFooter className="bg-muted/30 pt-6 flex flex-col sm:flex-row gap-2">
                                    <Button onClick={handleOpenHistoryDialog} variant="secondary" className="flex-1">
                                        <History className="mr-2 h-4 w-4" />
                                        Storico Movimenti
                                    </Button>
                                    <Button onClick={resetFlow} className="flex-1">Nuova Ricerca</Button>
                                </CardFooter>
                            </Card>
                        </div>
                    )}
                </div>

                <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
                    <DialogContent className="sm:max-w-4xl">
                        <DialogHeader>
                            <DialogTitle>Storico Movimenti: {foundMaterial?.code}</DialogTitle>
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
                                    {materialMovements.map((mov, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell>{format(parseISO(mov.date), 'dd/MM/yyyy HH:mm', { locale: it })}</TableCell>
                                            <TableCell>
                                                <UiBadge variant={mov.type === 'Carico' ? 'default' : 'destructive'}>{mov.type}</UiBadge>
                                            </TableCell>
                                            <TableCell className="text-xs truncate max-w-sm">{mov.description}</TableCell>
                                            <TableCell className={cn("text-right font-mono font-bold", mov.type === 'Carico' ? 'text-green-600' : 'text-destructive')}>
                                                {formatDisplayStock(mov.quantity, mov.unit.toLowerCase() as any)} {mov.unit}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Chiudi</Button></DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </AppShell>
        </AuthGuard>
    );
}
