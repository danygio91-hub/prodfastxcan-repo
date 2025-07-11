

"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode, logMaterialConsumption, searchRawMaterials } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Search, Keyboard, Info, Weight, Package, User, FileText, Fingerprint, Barcode, CheckCircle } from 'lucide-react';
import { useActiveJob } from '@/contexts/ActiveJobProvider';
import { verifyAndGetJobOrder } from '@/app/scan-job/actions';

// BarcodeDetector types for compilation
interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const consumptionLogSchema = z.object({
  materialId: z.string(),
  kgApertura: z.string().optional(),
  kgChiusura: z.string().optional(),
  notaLordoNetto: z.string().optional(),
  numUnits: z.string().optional(),
  numPezziGuaina: z.string().optional(),
  lunghezzaPezzoGuaina: z.string().optional(),
  cliente: z.string().optional(),
  commessa: z.string().optional(),
  codice: z.string().optional(),
  lottoBobina: z.string().optional(),
}).refine(data => {
    // Both or neither of the weight fields must be present
    const hasOpening = !!data.kgApertura;
    const hasClosing = !!data.kgChiusura;
    return hasOpening === hasClosing;
}, {
    message: "Se si inserisce un peso, sia apertura che chiusura sono obbligatori.",
    path: ["kgChiusura"],
}).refine(data => {
    // Both or neither of the guaina piece fields must be present
    const hasNumPezzi = !!data.numPezziGuaina && Number(data.numPezziGuaina) > 0;
    const hasLunghezzaPezzo = !!data.lunghezzaPezzoGuaina && Number(data.lunghezzaPezzoGuaina) > 0;
    return hasNumPezzi === hasLunghezzaPezzo;
}, {
    message: "Se si consuma a pezzi, sia il numero di pezzi che la lunghezza sono obbligatori.",
    path: ["lunghezzaPezzoGuaina"],
})
.refine(data => {
    const weightProvided = !!data.kgApertura;
    const unitsProvided = !!data.numUnits && Number(data.numUnits) > 0;
    const guainaPezziProvided = !!data.numPezziGuaina && Number(data.numPezziGuaina) > 0;
    
    const methodsUsed = [weightProvided, unitsProvided, guainaPezziProvided].filter(Boolean).length;
    
    return methodsUsed === 1;
}, {
    message: "Inserire il consumo usando un solo metodo: o KG, o Unità totali, o Pezzi x Lunghezza.",
    path: ["numUnits"], // General error path
});


type ConsumptionLogFormValues = z.infer<typeof consumptionLogSchema>;
type SearchResult = Pick<RawMaterial, 'id' | 'code' | 'description'>;

export default function RawMaterialScanPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();
    const { activeJob, setActiveJob } = useActiveJob();

    const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'form'>('initial');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isLottoScanDialogOpen, setIsLottoScanDialogOpen] = useState(false);
    const [isJobScanDialogOpen, setIsJobScanDialogOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const lottoVideoRef = useRef<HTMLVideoElement>(null);
    const jobVideoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!authLoading && operator && operator.reparto !== 'MAG' && operator.role !== 'superadvisor') {
            toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
            router.replace('/dashboard');
        }
    }, [operator, authLoading, router, toast]);


    const form = useForm<ConsumptionLogFormValues>({
        resolver: zodResolver(consumptionLogSchema),
        defaultValues: { materialId: '', kgApertura: '', kgChiusura: '', notaLordoNetto: '', numUnits: '', numPezziGuaina: '', lunghezzaPezzoGuaina: '', cliente: '', commessa: '', codice: '', lottoBobina: '' },
    });

    useEffect(() => {
        if (activeJob) {
            form.setValue('cliente', activeJob.cliente);
            form.setValue('commessa', activeJob.ordinePF);
            form.setValue('codice', activeJob.details);
        }
        if (scannedMaterial) {
            form.setValue('materialId', scannedMaterial.id);
        }
    }, [activeJob, scannedMaterial, form]);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);
    
    const handleCodeSubmit = useCallback(async (code: string) => {
        stopCamera();
        setStep('initial'); // Go back to initial to show loading feedback
        const trimmedCode = code.trim();
        if (!trimmedCode) {
            toast({ variant: 'destructive', title: "Codice Vuoto", description: "Inserisci un codice valido." });
            setStep('manual_input'); // Stay on manual input if empty
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
            form.reset({
                materialId: result.id,
                kgApertura: '', kgChiusura: '', notaLordoNetto: '', numUnits: '', numPezziGuaina: '', lunghezzaPezzoGuaina: '', lottoBobina: '',
                cliente: activeJob?.cliente || '',
                commessa: activeJob?.ordinePF || '',
                codice: activeJob?.details || '',
            });
            setStep('form');
        }
    }, [stopCamera, toast, form, activeJob]);

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
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata', description: 'Il tuo browser non supporta la scansione di QR code.' });
                    setStep('initial'); return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                const video = videoRef.current;
                if (video) {
                    video.srcObject = stream;
                    await video.play();
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
                
                const detect = async () => {
                    if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
                        animationFrameId = requestAnimationFrame(detect);
                        return;
                    };
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
                stopCamera(); setStep('initial');
            }
        };

        startCameraAndScan();
        return () => { 
            cancelAnimationFrame(animationFrameId);
            stopCamera(); 
        };
    }, [step, stopCamera, handleCodeSubmit, toast]);
    
    useEffect(() => {
        if (!isLottoScanDialogOpen) {
            stopCamera();
            return;
        }

        let animationFrameId: number;
        const startLottoCameraAndScan = async () => {
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
                    setIsLottoScanDialogOpen(false);
                    return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                const video = lottoVideoRef.current;
                if (video) {
                    video.srcObject = stream;
                    await video.play();
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
                
                const detect = async () => {
                     if (!lottoVideoRef.current || lottoVideoRef.current.paused || lottoVideoRef.current.readyState < 2) {
                        animationFrameId = requestAnimationFrame(detect);
                        return;
                    };
                    const barcodes = await barcodeDetector.detect(lottoVideoRef.current);
                    if (barcodes.length > 0) {
                        const scannedValue = barcodes[0].rawValue;
                        form.setValue('lottoBobina', scannedValue);
                        toast({ title: "Lotto Scansionato", description: `Lotto: ${scannedValue}` });
                        setIsLottoScanDialogOpen(false);
                    } else {
                        animationFrameId = requestAnimationFrame(detect);
                    }
                };
                detect();

            } catch (err) {
                toast({ variant: 'destructive', title: 'Errore Fotocamera', description: 'Accesso negato o non disponibile.' });
                stopCamera();
                setIsLottoScanDialogOpen(false);
            }
        };

        startLottoCameraAndScan();
        return () => {
             cancelAnimationFrame(animationFrameId);
             stopCamera(); 
        };
    }, [isLottoScanDialogOpen, stopCamera, form, toast]);

    const handleJobScannedData = useCallback(async (data: string) => {
        const parts = data.split('@');
        if (parts.length !== 3) {
            toast({ variant: 'destructive', title: 'QR Code non Valido', description: 'Formato del QR code non corretto. Atteso: "Ordine PF@Codice@Qta"' });
            setIsJobScanDialogOpen(false);
            return;
        }
        const [ordinePF, codice, qta] = parts;
        if (!ordinePF || !codice || !qta) {
            toast({ variant: 'destructive', title: 'QR Code Incompleto', description: 'Dati mancanti nel QR Code.' });
            setIsJobScanDialogOpen(false);
            return;
        }

        toast({ title: "QR Code Rilevato", description: "Verifica commessa in corso..." });
        const result = await verifyAndGetJobOrder({ ordinePF, codice, qta });

        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        } else {
            toast({ title: "Commessa Verificata!", description: `Commessa ${result.id} attivata.`, action: <CheckCircle className="text-green-500"/> });
            setActiveJob(result);
        }
        setIsJobScanDialogOpen(false);
    }, [toast, setActiveJob]);
    
    useEffect(() => {
        if (!isJobScanDialogOpen) {
            stopCamera();
            return;
        }

        let animationFrameId: number;
        const startJobCameraAndScan = async () => {
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
                    setIsJobScanDialogOpen(false);
                    return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                const video = jobVideoRef.current;
                if (video) {
                    video.srcObject = stream;
                    await video.play();
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                
                const detect = async () => {
                     if (!jobVideoRef.current || jobVideoRef.current.paused || jobVideoRef.current.readyState < 2) {
                        animationFrameId = requestAnimationFrame(detect);
                        return;
                    };
                    const barcodes = await barcodeDetector.detect(jobVideoRef.current);
                    if (barcodes.length > 0) {
                        handleJobScannedData(barcodes[0].rawValue);
                    } else {
                        animationFrameId = requestAnimationFrame(detect);
                    }
                };
                detect();

            } catch (err) {
                toast({ variant: 'destructive', title: 'Errore Fotocamera', description: 'Accesso negato o non disponibile.' });
                stopCamera();
                setIsJobScanDialogOpen(false);
            }
        };

        startJobCameraAndScan();
        return () => {
             cancelAnimationFrame(animationFrameId);
             stopCamera(); 
        };
    }, [isJobScanDialogOpen, stopCamera, form, toast, handleJobScannedData]);


    async function onLogSubmit(values: ConsumptionLogFormValues) {
        const formData = new FormData();
        Object.entries(values).forEach(([key, value]) => {
          if (value) formData.append(key, String(value));
        });

        const result = await logMaterialConsumption(formData);
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
        setSearchResults([]);
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
                                <CardTitle className="flex items-center gap-3"><Boxes className="h-7 w-7 text-primary" /> Scansione Materia Prima</CardTitle>
                                <CardDescription>Avvia la scansione o inserisci un codice per registrare un movimento di magazzino.</CardDescription>
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
                                <CardDescription>Digita il codice della materia prima per cercarla.</CardDescription>
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
                                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
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
                                <CardTitle className="text-center">Inquadra il Codice</CardTitle>
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
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="space-y-1"><Label>Tipo</Label><p className="p-2 bg-muted rounded-md">{scannedMaterial.type}</p></div>
                                        <div className="space-y-1"><Label>Sezione</Label><p className="p-2 bg-muted rounded-md">{scannedMaterial.details.sezione || 'N/D'}</p></div>
                                        <div className="space-y-1"><Label>Filo El.</Label><p className="p-2 bg-muted rounded-md">{scannedMaterial.details.filo_el || 'N/D'}</p></div>
                                        <div className="space-y-1"><Label>Larghezza</Label><p className="p-2 bg-muted rounded-md">{scannedMaterial.details.larghezza || 'N/D'}</p></div>
                                        <div className="space-y-1 col-span-2"><Label>Tipologia</Label><p className="p-2 bg-muted rounded-md">{scannedMaterial.details.tipologia || 'N/D'}</p></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 pt-4">
                                        <div className="p-3 rounded-lg border bg-background">
                                            <Label>Stock ({scannedMaterial.unitOfMeasure.toUpperCase()})</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentStockUnits ?? 0}</p>
                                        </div>
                                         <div className="p-3 rounded-lg border bg-background">
                                            <Label>Stock (KG)</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentWeightKg?.toFixed(2) ?? '0.00'}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {scannedMaterial.unitOfMeasure !== 'kg' && !scannedMaterial.conversionFactor && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Fattore di Conversione Mancante</AlertTitle>
                                    <AlertDescription>
                                        Questo materiale non ha un fattore di conversione (es. kg/pz). Lo scarico a peso non aggiornerà lo stock a unità e viceversa. Chiedi a un amministratore di aggiornarlo.
                                    </AlertDescription>
                                </Alert>
                            )}

                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onLogSubmit)}>
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Registra Consumo per Commessa</CardTitle>
                                            <CardDescription>
                                                {activeJob ? `Collegato alla commessa: ${activeJob.ordinePF}` : 'Nessuna commessa attiva. Selezionane una per procedere.'}
                                            </CardDescription>
                                            {!activeJob && (
                                                <Alert variant="destructive" className="mt-2 space-y-3">
                                                    <div className='flex items-start gap-2'>
                                                        <Info className="h-4 w-4 mt-0.5" />
                                                        <div>
                                                            <AlertTitle>Commessa non attiva</AlertTitle>
                                                            <AlertDescription>
                                                                Per registrare un consumo, devi prima scansionare una commessa e avviarla.
                                                            </AlertDescription>
                                                        </div>
                                                    </div>
                                                    <Button type="button" onClick={() => setIsJobScanDialogOpen(true)} className="w-full">
                                                        <QrCode className="mr-2 h-4 w-4" /> Scansiona Commessa Ora
                                                    </Button>
                                                </Alert>
                                            )}
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                             <div className="space-y-4">
                                                <FormField control={form.control} name="kgApertura" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> KG Apertura</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 55.5" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                                <FormField control={form.control} name="kgChiusura" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> KG Chiusura</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 50.2" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             </div>

                                             <div className="relative flex py-2 items-center">
                                                <div className="flex-grow border-t border-border"></div>
                                                <span className="flex-shrink mx-4 text-xs text-muted-foreground">OPPURE</span>
                                                <div className="flex-grow border-t border-border"></div>
                                            </div>
                                             
                                            <div className="space-y-4">
                                                {scannedMaterial.unitOfMeasure !== 'kg' ? (
                                                    <FormField control={form.control} name="numUnits" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Package className="mr-2 h-4 w-4" /> N° {(scannedMaterial.unitOfMeasure || 'n').toUpperCase()} Consumati</FormLabel> <FormControl><Input type="number" placeholder="Es. 10" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                                ) : (
                                                    <Alert variant="default" className="text-center">
                                                        <Info className="h-4 w-4" />
                                                        <AlertTitle>Materiale a Peso</AlertTitle>
                                                        <AlertDescription>
                                                            Questo materiale è gestito solo a KG. Il consumo per unità non è applicabile.
                                                        </AlertDescription>
                                                    </Alert>
                                                )}
                                            </div>
                                            
                                            {scannedMaterial.type === 'GUAINA' && (
                                                <>
                                                    <div className="relative flex py-2 items-center">
                                                        <div className="flex-grow border-t border-border"></div>
                                                        <span className="flex-shrink mx-4 text-xs text-muted-foreground">OPPURE</span>
                                                        <div className="flex-grow border-t border-border"></div>
                                                    </div>

                                                    <div className="space-y-4 p-4 border rounded-md">
                                                        <h3 className="text-sm font-medium">Consumo a Pezzi</h3>
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <FormField control={form.control} name="numPezziGuaina" render={({ field }) => ( <FormItem> <FormLabel>N° Pezzi</FormLabel> <FormControl><Input type="number" placeholder="Es. 5" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                                            <FormField control={form.control} name="lunghezzaPezzoGuaina" render={({ field }) => ( <FormItem> <FormLabel>Lunghezza/Pezzo (mt)</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 0.5" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                                        </div>
                                                    </div>
                                                </>
                                            )}

                                            <Separator className="my-4"/>

                                            <FormField control={form.control} name="notaLordoNetto" render={({ field }) => ( <FormItem> <FormLabel>Nota Lordo/Netto (Opzionale)</FormLabel> <FormControl><Input placeholder="Es. Tara 0.3kg" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                            
                                              {scannedMaterial.type === 'BOB' && (
                                                <div className="space-y-2 pt-4 border-t">
                                                    <h3 className="text-sm font-medium text-muted-foreground">Dati Lotto Bobina (Opzionale)</h3>
                                                    <FormField
                                                        control={form.control}
                                                        name="lottoBobina"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel className="flex items-center">
                                                                    <Barcode className="mr-2 h-4 w-4" /> Numero Lotto Bobina
                                                                </FormLabel>
                                                                <div className="flex gap-2">
                                                                    <FormControl>
                                                                        <Input placeholder="Scansiona o inserisci lotto" {...field} />
                                                                    </FormControl>
                                                                    <Button type="button" variant="outline" size="icon" onClick={() => setIsLottoScanDialogOpen(true)}>
                                                                        <QrCode className="h-4 w-4" />
                                                                        <span className="sr-only">Scansiona lotto</span>
                                                                    </Button>
                                                                </div>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                              )}

                                             <div className="space-y-2 pt-4 border-t">
                                                <h3 className="text-sm font-medium text-muted-foreground">Dati Commessa Collegata</h3>
                                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <FormField control={form.control} name="cliente" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><User className="mr-2 h-4 w-4" /> Cliente</FormLabel> <FormControl><Input {...field} readOnly className="bg-muted" /></FormControl> </FormItem> )} />
                                                    <FormField control={form.control} name="commessa" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><FileText className="mr-2 h-4 w-4" /> Commessa</FormLabel> <FormControl><Input {...field} readOnly className="bg-muted" /></FormControl> </FormItem> )} />
                                                 </div>
                                                 <FormField control={form.control} name="codice" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Fingerprint className="mr-2 h-4 w-4" /> Codice Articolo</FormLabel> <FormControl><Input {...field} readOnly className="bg-muted" /></FormControl> </FormItem> )} />
                                             </div>

                                        </CardContent>
                                        <CardFooter className="flex-col sm:flex-row gap-2">
                                            <Button type="button" variant="outline" onClick={resetFlow} className="w-full sm:w-auto">Annulla / Nuova Operazione</Button>
                                            <Button type="submit" className="w-full sm:w-auto" disabled={form.formState.isSubmitting || !activeJob}>
                                                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                                Registra Consumo
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

                <Dialog open={isJobScanDialogOpen} onOpenChange={setIsJobScanDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Inquadra il QR della Commessa</DialogTitle>
                        </DialogHeader>
                        <div className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                            <video ref={jobVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
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
                            <Button variant="outline" onClick={() => setIsJobScanDialogOpen(false)}>Annulla</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </AppShell>
        </AuthGuard>
    );
}
