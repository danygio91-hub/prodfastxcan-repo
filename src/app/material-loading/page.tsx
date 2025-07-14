
"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode, addBatchToRawMaterial } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Keyboard, Package, Barcode } from 'lucide-react';


interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
});
type BatchFormValues = z.infer<typeof batchFormSchema>;


export default function MaterialLoadingPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'form'>('initial');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isLottoScanDialogOpen, setIsLottoScanDialogOpen] = useState(false);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const lottoVideoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!authLoading && operator && operator.reparto !== 'MAG' && operator.role !== 'superadvisor') {
            toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
            router.replace('/dashboard');
        }
    }, [operator, authLoading, router, toast]);

    const form = useForm<BatchFormValues>({
        resolver: zodResolver(batchFormSchema),
        defaultValues: { materialId: '', lotto: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', quantity: 0 },
    });

    useEffect(() => {
        if (scannedMaterial) {
            form.setValue('materialId', scannedMaterial.id);
        }
    }, [scannedMaterial, form]);

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
        toast({ title: "Ricerca in corso", description: `Ricerca materia prima: ${trimmedCode}...` });
        
        const result = await getRawMaterialByCode(trimmedCode);
        
        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
            setScannedMaterial(null);
            setStep('initial');
        } else {
            setScannedMaterial(result);
            form.reset({ materialId: result.id, lotto: '', date: format(new Date(), 'yyyy-MM-dd'), ddt: '', quantity: 0 });
            setStep('form');
        }
    }, [stopCamera, toast, form]);
    
    const handleLottoScannedData = useCallback((lotto: string) => {
        setIsLottoScanDialogOpen(false);
        form.setValue('lotto', lotto);
        toast({ title: "Lotto Scansionato", description: `Lotto ${lotto} inserito.` });
    }, [form, toast]);


    useEffect(() => {
        if (step !== 'scanning' && !isLottoScanDialogOpen) {
            stopCamera();
            return;
        }

        let animationFrameId: number;
        const startCameraAndScan = async (videoElement: HTMLVideoElement, onScan: (data: string) => void) => {
            setCameraError(null);
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
                    setStep('initial'); return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                if (videoElement) {
                    videoElement.srcObject = stream;
                    await videoElement.play();
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
                
                const detect = async () => {
                    if (!videoElement || videoElement.paused || videoElement.readyState < 2) {
                        animationFrameId = requestAnimationFrame(detect);
                        return;
                    }
                    const barcodes = await barcodeDetector.detect(videoElement);
                    if (barcodes.length > 0) {
                        onScan(barcodes[0].rawValue);
                    } else {
                        animationFrameId = requestAnimationFrame(detect);
                    }
                };
                detect();

            } catch (err) {
                setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi.");
                stopCamera(); 
                setStep('initial');
                setIsLottoScanDialogOpen(false);
            }
        };

        if (step === 'scanning' && videoRef.current) {
            startCameraAndScan(videoRef.current, handleCodeSubmit);
        } else if (isLottoScanDialogOpen && lottoVideoRef.current) {
            startCameraAndScan(lottoVideoRef.current, handleLottoScannedData);
        }

        return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
    }, [step, isLottoScanDialogOpen, stopCamera, handleCodeSubmit, handleLottoScannedData, toast]);

    async function onLogSubmit(values: BatchFormValues) {
        const formData = new FormData();
        Object.entries(values).forEach(([key, value]) => {
          if (value) formData.append(key, String(value));
        });

        const result = await addBatchToRawMaterial(formData);
        toast({
            title: result.success ? "Operazione Riuscita" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            setScannedMaterial(null);
            form.reset();
            setStep('initial');
        }
    };
    
    const resetFlow = () => {
        setScannedMaterial(null);
        setManualCode('');
        form.reset();
        setStep('initial');
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
                                <CardTitle className="flex items-center gap-3"><Boxes className="h-7 w-7 text-primary" /> Carico Materia Prima</CardTitle>
                                <CardDescription>Avvia la scansione o inserisci un codice per registrare una materia prima in ingresso.</CardDescription>
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
                            </CardContent>
                        </Card>
                    )}

                     {step === 'manual_input' && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Inserimento Manuale</CardTitle>
                                <CardDescription>Digita il codice della materia prima da caricare.</CardDescription>
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

                    {step === 'form' && scannedMaterial && (
                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Scheda Prodotto: {scannedMaterial.code}</CardTitle>
                                    <CardDescription>{scannedMaterial.description}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 rounded-lg border bg-background">
                                            <Label>Stock Attuale ({scannedMaterial.unitOfMeasure.toUpperCase()})</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentStockUnits ?? 0}</p>
                                        </div>
                                         <div className="p-3 rounded-lg border bg-background">
                                            <Label>Stock Attuale (KG)</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentWeightKg?.toFixed(2) ?? '0.00'}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onLogSubmit)}>
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Dati di Carico Lotto</CardTitle>
                                            <CardDescription>
                                                Compila i dati per registrare il nuovo lotto in entrata per questo materiale.
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                             <FormField control={form.control} name="quantity" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Package className="mr-2 h-4 w-4" /> Quantità in Entrata ({scannedMaterial.unitOfMeasure.toUpperCase()})</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 500" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             <FormField control={form.control} name="ddt" render={({ field }) => ( <FormItem> <FormLabel>Documento di Trasporto (DDT)</FormLabel> <FormControl><Input placeholder="Numero DDT" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             <FormField control={form.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data Ricezione</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             <FormField control={form.control} name="lotto" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="flex items-center"><Barcode className="mr-2 h-4 w-4" /> N° Lotto Fornitore (Opzionale)</FormLabel>
                                                    <div className="flex gap-2">
                                                        <FormControl><Input placeholder="Scansiona o inserisci lotto" {...field} /></FormControl>
                                                        <Button type="button" variant="outline" size="icon" onClick={() => setIsLottoScanDialogOpen(true)}>
                                                            <QrCode className="h-4 w-4" />
                                                            <span className="sr-only">Scansiona lotto</span>
                                                        </Button>
                                                    </div><FormMessage />
                                                </FormItem>
                                            )} />
                                        </CardContent>
                                        <CardFooter className="flex-col sm:flex-row gap-2">
                                            <Button type="button" variant="outline" onClick={resetFlow} className="w-full sm:w-auto">Annulla</Button>
                                            <Button type="submit" className="w-full sm:w-auto" disabled={form.formState.isSubmitting}>
                                                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                                Registra Carico
                                            </Button>
                                        </CardFooter>
                                    </Card>
                                </form>
                            </Form>
                        </div>
                    )}
                </div>

                <Dialog open={isLottoScanDialogOpen} onOpenChange={setIsLottoScanDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Inquadra il QR/Barcode del Lotto</DialogTitle>
                        </DialogHeader>
                        <div className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                            <video ref={lottoVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-5/6 h-2/5 relative flex items-center justify-center">
                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                                    <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsLottoScanDialogOpen(false)}>Annulla</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </AppShell>
        </AuthGuard>
    );
}
