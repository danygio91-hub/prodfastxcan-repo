
"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode } from '@/app/material-loading/actions';
import type { RawMaterial } from '@/lib/mock-data';
import { QrCode, AlertTriangle, SearchCheck, Send, Loader2, Keyboard, PlayCircle } from 'lucide-react';


interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}


export default function MaterialCheckPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'result'>('initial');
    const [foundMaterial, setFoundMaterial] = useState<RawMaterial | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    
    // Simulator State
    const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
    const [simulatorInput, setSimulatorInput] = useState('');

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!authLoading && operator && operator.reparto !== 'MAG' && operator.role !== 'superadvisor') {
            toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
            router.replace('/dashboard');
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

        let animationFrameId: number;
        const startCameraAndScan = async () => {
            setCameraError(null);
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
                    setStep('initial'); return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
                
                const detect = async () => {
                    if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
                        animationFrameId = requestAnimationFrame(detect);
                        return;
                    }
                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0) {
                        handleCodeSubmit(barcodes[0].rawValue);
                    } else {
                        animationFrameId = requestAnimationFrame(detect);
                    }
                };
                detect();

            } catch (err) {
                setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi.");
                stopCamera(); 
                setStep('initial');
            }
        };

        startCameraAndScan();

        return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
    }, [step, stopCamera, handleCodeSubmit, toast]);
    
    const resetFlow = () => {
        setFoundMaterial(null);
        setManualCode('');
        setStep('initial');
    };

    const handleOpenSimulator = () => {
        setSimulatorInput('');
        setIsSimulatorOpen(true);
    };

    const handleSimulatorSubmit = () => {
        handleCodeSubmit(simulatorInput);
        setIsSimulatorOpen(false);
        setSimulatorInput('');
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
                                {cameraError && (
                                    <Alert variant="destructive" className="mb-4">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertTitle>Errore Fotocamera</AlertTitle>
                                        <AlertDescription>{cameraError}</AlertDescription>
                                    </Alert>
                                )}
                                <Button onClick={() => setStep('scanning')} className="w-full" size="lg">
                                    <QrCode className="mr-2 h-5 w-5" />
                                    Avvia Scansione
                                </Button>
                                <Button onClick={() => setStep('manual_input')} variant="outline" className="w-full">
                                    <Keyboard className="mr-2 h-5 w-5" />
                                    Inserisci Codice Manualmente
                                </Button>
                                <Button onClick={handleOpenSimulator} variant="secondary" size="sm" className="w-full">
                                    <PlayCircle className="mr-2 h-4 w-4" />
                                    Simula Scansione (Test)
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
                            <CardContent className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-5/6 h-2/5 relative flex items-center justify-center">
                                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                                        <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
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
                            <CardFooter>
                                <Button onClick={resetFlow} className="w-full">Cerca un Altro Materiale</Button>
                            </CardFooter>
                        </Card>
                    )}
                </div>

                <Dialog open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Simulatore Scansione QR</DialogTitle>
                            <DialogDescription>Incolla il contenuto del QR code che vuoi simulare.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <Label htmlFor="simulator-input">Contenuto QR Code</Label>
                            <Input 
                                id="simulator-input"
                                value={simulatorInput}
                                onChange={(e) => setSimulatorInput(e.target.value)}
                                placeholder="Codice materiale..."
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsSimulatorOpen(false)}>Annulla</Button>
                            <Button onClick={handleSimulatorSubmit}>Simula Scansione</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </AppShell>
        </AuthGuard>
    );
}

