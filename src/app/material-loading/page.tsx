
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode, addBatchToRawMaterial } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Package, Barcode, PlayCircle, Weight, Check, X, ArrowLeft, ThumbsDown, ThumbsUp, MessageSquare } from 'lucide-react';


interface BarcodeDetectorOptions { formats?: string[]; }
interface DetectedBarcode { rawValue: string; }
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

const batchFormSchema = z.object({
  materialId: z.string().min(1),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
});
type BatchFormValues = z.infer<typeof batchFormSchema>;


export default function MaterialLoadingPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [step, setStep] = useState<'scan_material' | 'scan_lotto' | 'validate' | 'enter_weight' | 'saving' | 'success'>('scan_material');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [scannedLotto, setScannedLotto] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [showNCReport, setShowNCReport] = useState(false);
    const [ncNotes, setNcNotes] = useState('');
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    
    const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
    const [simulatorInput, setSimulatorInput] = useState('');

    useEffect(() => {
        if (!authLoading && operator && operator.reparto !== 'MAG' && operator.role !== 'superadvisor') {
            toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
            router.replace('/dashboard');
        }
    }, [operator, authLoading, router, toast]);

    const form = useForm<BatchFormValues>({
        resolver: zodResolver(batchFormSchema),
        defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' },
    });
    
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsScanning(false);
    }, []);

    const handleMaterialScanned = useCallback(async (code: string) => {
        stopCamera();
        const result = await getRawMaterialByCode(code.trim());
        if ('error' in result) {
            toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
        } else {
            setScannedMaterial(result);
            form.setValue('materialId', result.id);
            setStep('scan_lotto');
        }
    }, [stopCamera, toast, form]);

    const handleLottoScanned = (code: string) => {
        stopCamera();
        setScannedLotto(code.trim());
        form.setValue('lotto', code.trim());
        setStep('validate');
    };

    const startScan = useCallback((onScan: (data: string) => void) => {
        setIsScanning(true);
        let animationFrameId: number;

        const startCameraAndScan = async () => {
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
                    setIsScanning(false); return;
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
                        onScan(barcodes[0].rawValue);
                    } else {
                        animationFrameId = requestAnimationFrame(detect);
                    }
                };
                detect();

            } catch (err) {
                toast({ variant: "destructive", title: "Errore Fotocamera", description: "Accesso negato o non disponibile." });
                stopCamera(); 
            }
        };

        startCameraAndScan();
        return () => { cancelAnimationFrame(animationFrameId); stopCamera(); };
    }, [stopCamera, toast]);
    
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        if (isScanning && step === 'scan_material') {
            cleanup = startScan(handleMaterialScanned);
        } else if (isScanning && step === 'scan_lotto') {
            cleanup = startScan(handleLottoScanned);
        }
        return cleanup;
    }, [isScanning, step, startScan, handleMaterialScanned, handleLottoScanned]);

    async function onWeightSubmit(values: BatchFormValues) {
        setStep('saving');
        const formData = new FormData();
        Object.entries(values).forEach(([key, value]) => {
          if (value !== undefined) formData.append(key, String(value));
        });

        const result = await addBatchToRawMaterial(formData);
        toast({
            title: result.success ? "Carico Registrato" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            setStep('success');
        } else {
            setStep('enter_weight'); // Go back to allow correction
        }
    };
    
    const handleNonConformityReport = (reason: string) => {
        // In a real app, this would send a report to the backend.
        // For now, we'll just log it and show a toast.
        console.log({
            type: 'NON_CONFORMITY_REPORT',
            material: scannedMaterial?.code,
            lotto: scannedLotto,
            reason: reason,
            notes: ncNotes,
            operator: operator?.id,
            timestamp: new Date().toISOString()
        });

        toast({
            title: "Segnalazione Inviata",
            description: `NC per ${reason} registrata. Puoi procedere al carico.`,
            variant: "destructive"
        });
        
        setShowNCReport(false);
    };

    const resetFlow = () => {
        setScannedMaterial(null);
        setScannedLotto(null);
        setShowNCReport(false);
        setNcNotes('');
        form.reset({ date: format(new Date(), 'yyyy-MM-dd'), ddt: 'CARICO_RAPIDO' });
        setStep('scan_material');
    };

    const handleSimulatorSubmit = () => {
        if (step === 'scan_material') {
            handleMaterialScanned(simulatorInput);
        } else if (step === 'scan_lotto') {
            handleLottoScanned(simulatorInput);
        }
        setIsSimulatorOpen(false);
        setSimulatorInput('');
    };

    if (authLoading || !operator) {
        return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
    }
    
    return (
        <AuthGuard>
            <AppShell>
                <div className="space-y-6 max-w-xl mx-auto">
                    <OperatorNavMenu />
                     <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-3"><Package className="h-7 w-7 text-primary" /> Carico Merce Rapido</CardTitle>
                            <CardDescription>Segui i passaggi per registrare un nuovo lotto di materiale in ingresso.</CardDescription>
                        </CardHeader>
                        
                        <CardContent>
                            <ol className="relative flex items-center justify-between w-full text-sm font-medium text-center text-gray-500 dark:text-gray-400">
                                {['Materiale', 'Lotto', 'Convalida', 'Carico'].map((title, index) => {
                                    const stepNames = ['scan_material', 'scan_lotto', 'validate', 'enter_weight'];
                                    const stepIndex = stepNames.indexOf(step);
                                    const isCompleted = stepIndex > index || step === 'saving' || step === 'success';
                                    const isActive = stepIndex === index;

                                    return (
                                        <li key={title} className={`flex items-center ${index < 3 ? 'w-full' : ''} ${isCompleted ? 'text-primary dark:text-primary after:border-primary dark:after:border-primary' : ''} after:content-[''] after:w-full after:h-1 after:border-b after:border-gray-200 after:border-1 after:inline-block dark:after:border-gray-700`}>
                                            <span className={`flex items-center justify-center w-10 h-10 ${isActive || isCompleted ? 'bg-primary/20' : 'bg-muted'} rounded-full lg:h-12 lg:w-12 dark:bg-gray-800 shrink-0`}>
                                                {isCompleted ? <Check className="w-5 h-5 text-primary" /> : <span className={`${isActive ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                            
                            <div className="mt-8">
                                {isScanning ? (
                                    <div className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
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
                                    </div>
                                ) : (
                                    <>
                                     {step === 'scan_material' && (
                                        <div className="text-center space-y-4">
                                            <h3 className="text-xl font-semibold">1. Scansiona il Codice Materiale</h3>
                                            <Button onClick={() => setIsScanning(true)} size="lg"><QrCode className="mr-2 h-5 w-5"/>Avvia Scansione Materiale</Button>
                                        </div>
                                     )}
                                     {step === 'scan_lotto' && (
                                        <div className="text-center space-y-4">
                                            <h3 className="text-xl font-semibold">2. Scansiona il Codice del Lotto</h3>
                                            <p className="text-muted-foreground">Materiale: <span className="font-bold text-primary">{scannedMaterial?.code}</span></p>
                                            <Button onClick={() => setIsScanning(true)} size="lg"><Barcode className="mr-2 h-5 w-5"/>Avvia Scansione Lotto</Button>
                                        </div>
                                     )}
                                     {step === 'validate' && (
                                         <div className="text-center space-y-4">
                                            <h3 className="text-xl font-semibold">3. Convalida / Segnala</h3>
                                            <p className="text-muted-foreground">Il materiale ricevuto è conforme?</p>
                                            <div className="flex justify-center gap-4 pt-4">
                                                <Button onClick={() => setStep('enter_weight')} className="h-24 w-32 flex-col gap-2 bg-green-600 hover:bg-green-700 text-lg">
                                                    <ThumbsUp className="h-8 w-8" />
                                                    OK
                                                </Button>
                                                <Button onClick={() => setShowNCReport(true)} variant="destructive" className="h-24 w-32 flex-col gap-2 text-lg">
                                                    <ThumbsDown className="h-8 w-8" />
                                                    NC
                                                </Button>
                                            </div>
                                            
                                            {showNCReport && (
                                                <Card className="mt-6 text-left p-4 border-destructive">
                                                    <CardHeader className="p-2">
                                                        <CardTitle className="text-base">Segnala Non Conformità</CardTitle>
                                                    </CardHeader>
                                                    <CardContent className="p-2 space-y-4">
                                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                            <Button type="button" variant="outline" onClick={() => handleNonConformityReport('Codifica Errata')}>Codifica Errata</Button>
                                                            <Button type="button" variant="outline" onClick={() => handleNonConformityReport('Dimensioni Errate')}>Dimensioni Errate</Button>
                                                            <Button type="button" variant="outline" onClick={() => handleNonConformityReport('Altro')}>Altro</Button>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label htmlFor="nc-notes">Note (opzionale)</Label>
                                                            <Input id="nc-notes" value={ncNotes} onChange={(e) => setNcNotes(e.target.value)} placeholder="Aggiungi dettagli..." />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}
                                        </div>
                                     )}
                                     {step === 'enter_weight' && (
                                        <div>
                                            <h3 className="text-xl font-semibold text-center mb-4">4. Inserisci il Peso</h3>
                                             <Form {...form}>
                                                <form onSubmit={form.handleSubmit(onWeightSubmit)} className="space-y-6 text-left">
                                                    <p className="text-sm text-muted-foreground">Materiale: <span className="font-bold text-primary">{scannedMaterial?.code}</span> | Lotto: <span className="font-bold text-primary">{scannedLotto}</span></p>
                                                    <FormField control={form.control} name="quantity" render={({ field }) => ( <FormItem> <FormLabel>Quantità in Entrata ({scannedMaterial?.unitOfMeasure.toUpperCase()})</FormLabel> <FormControl><Input type="number" step="any" placeholder="Es. 500" {...field} value={field.value ?? ''} autoFocus /></FormControl> <FormMessage /> </FormItem> )} />
                                                    <Button type="submit" className="w-full">Registra Carico</Button>
                                                </form>
                                            </Form>
                                        </div>
                                     )}
                                     {step === 'saving' && (
                                        <div className="text-center py-8">
                                            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                                            <p className="mt-4 text-muted-foreground">Registrazione in corso...</p>
                                        </div>
                                     )}
                                      {step === 'success' && (
                                        <div className="text-center py-8 space-y-4">
                                            <Check className="h-16 w-16 text-green-500 bg-green-500/10 rounded-full p-2 mx-auto" />
                                            <h3 className="text-xl font-semibold">Carico Registrato con Successo!</h3>
                                            <Button onClick={resetFlow} className="w-full">Carica un Altro Materiale</Button>
                                        </div>
                                     )}
                                    </>
                                )}
                            </div>
                        </CardContent>

                        <CardFooter className="flex-col gap-4">
                           {step !== 'success' && (
                            <div className="w-full flex justify-between items-center">
                                <Button variant="ghost" onClick={resetFlow} disabled={isScanning}><ArrowLeft className="mr-2 h-4 w-4"/>Ricomincia</Button>
                                <Button variant="secondary" size="sm" onClick={() => setIsSimulatorOpen(true)} disabled={isScanning}><PlayCircle className="mr-2 h-4 w-4" />Simula Scansione</Button>
                            </div>
                           )}
                        </CardFooter>
                     </Card>
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
                                placeholder={step === 'scan_material' ? 'Codice materiale...' : 'Codice lotto...'}
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

    