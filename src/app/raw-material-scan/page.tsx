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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode, logMaterialConsumption, searchRawMaterials } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { QrCode, AlertTriangle, Boxes, Send, Loader2, Search, Keyboard, Info, Weight, Package, User, FileText, Fingerprint } from 'lucide-react';
import { useActiveJob } from '@/contexts/ActiveJobProvider';

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
  numPz: z.string().optional(),
  cliente: z.string().optional(),
  commessa: z.string().optional(),
  codice: z.string().optional(),
}).refine(data => {
    if (data.kgApertura && !data.kgChiusura) return false;
    if (!data.kgApertura && data.kgChiusura) return false;
    return true;
}, {
    message: "KG Apertura e Chiusura sono entrambi richiesti se uno dei due è compilato.",
    path: ["kgChiusura"],
}).refine(data => data.kgApertura || data.numPz, {
    message: "Devi compilare il consumo in Pezzi o entrambi i campi KG.",
    path: ["numPz"],
});


type ConsumptionLogFormValues = z.infer<typeof consumptionLogSchema>;
type SearchResult = Pick<RawMaterial, 'id' | 'code' | 'description'>;

export default function RawMaterialScanPage() {
    const { operator, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();
    const { activeJob } = useActiveJob();

    const [step, setStep] = useState<'initial' | 'scanning' | 'manual_input' | 'form'>('initial');
    const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!authLoading && operator && operator.reparto !== 'MAG' && operator.reparto !== 'Officina') {
            toast({ variant: 'destructive', title: 'Accesso Negato', description: 'Non hai i permessi per accedere a questa pagina.' });
            router.replace('/dashboard');
        }
    }, [operator, authLoading, router, toast]);

    // Debounce search
    useEffect(() => {
        const handler = setTimeout(async () => {
            if (manualCode.length > 1) {
                setIsSearching(true);
                const results = await searchRawMaterials(manualCode);
                setSearchResults(results);
                setIsSearching(false);
            } else {
                setSearchResults([]);
            }
        }, 300); // 300ms debounce

        return () => {
            clearTimeout(handler);
        };
    }, [manualCode]);

    const form = useForm<ConsumptionLogFormValues>({
        resolver: zodResolver(consumptionLogSchema),
        defaultValues: { materialId: '', kgApertura: '', kgChiusura: '', notaLordoNetto: '', numPz: '', cliente: '', commessa: '', codice: ''},
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
                kgApertura: '', kgChiusura: '', notaLordoNetto: '', numPz: '',
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

        let detectionInterval: ReturnType<typeof setInterval>;

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

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                
                detectionInterval = setInterval(async () => {
                    if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) return;
                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0) {
                        clearInterval(detectionInterval);
                        handleCodeSubmit(barcodes[0].rawValue);
                    }
                }, 500);
            } catch (err) {
                setCameraError("Accesso alla fotocamera negato o non disponibile. Controlla i permessi.");
                stopCamera(); setStep('initial');
            }
        };

        startCameraAndScan();
        return () => { clearInterval(detectionInterval); stopCamera(); };
    }, [step, stopCamera, handleCodeSubmit, toast]);

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
                                <CardDescription>Digita l'inizio del codice per cercare la materia prima. La ricerca non è sensibile alle maiuscole.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative">
                                    <Label htmlFor="manualCode">Codice Materia Prima</Label>
                                    <div className="relative">
                                        <Input
                                            id="manualCode"
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value)}
                                            placeholder="Es. BOB-123 o TUBI..."
                                            autoFocus
                                            autoComplete="off"
                                            className="mt-1"
                                        />
                                        {isSearching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                                    </div>
                                </div>
                                
                                {searchResults.length > 0 && (
                                    <div className="border rounded-md max-h-48 overflow-y-auto">
                                        <p className="p-2 text-xs font-medium text-muted-foreground">Risultati suggeriti:</p>
                                        <ul className="divide-y divide-border">
                                            {searchResults.map(material => (
                                                <li key={material.id}>
                                                    <button
                                                        type="button"
                                                        className="w-full text-left p-2 hover:bg-accent transition-colors"
                                                        onClick={() => handleCodeSubmit(material.code)}
                                                    >
                                                        <p className="font-semibold">{material.code}</p>
                                                        <p className="text-sm text-muted-foreground">{material.description}</p>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {manualCode.length > 1 && !isSearching && searchResults.length === 0 && (
                                    <p className="text-center text-sm text-muted-foreground p-4">Nessun risultato trovato per "{manualCode}".</p>
                                )}
                            </CardContent>
                            <CardFooter className="flex-col gap-4">
                                <Button onClick={() => handleCodeSubmit(manualCode)} disabled={!manualCode}>Cerca Materiale</Button>
                                <Button type="button" variant="outline" onClick={() => setStep('initial')} className="w-full">Annulla</Button>
                            </CardFooter>
                        </Card>
                    )}

                    {step === 'scanning' && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-center">Inquadra il QR Code</CardTitle>
                                <CardDescription className="text-center">Posiziona il QR code della materia prima all'interno del riquadro.</CardDescription>
                            </CardHeader>
                            <CardContent className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                                <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none">
                                    <div className="w-2/3 h-2/3 border-4 border-dashed border-primary/70 rounded-lg" />
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
                                            <Label>Qta Stock</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentStockPcs ?? 0}</p>
                                        </div>
                                         <div className="p-3 rounded-lg border bg-background">
                                            <Label>Kg Stock</Label>
                                            <p className="text-2xl font-bold">{scannedMaterial.currentWeightKg ?? 0}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onLogSubmit)}>
                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Registra Consumo per Commessa</CardTitle>
                                            <CardDescription>
                                                {activeJob ? `Collegato alla commessa: ${activeJob.ordinePF}` : 'Nessuna commessa attiva. Selezionane una per procedere.'}
                                            </CardDescription>
                                            {!activeJob && (
                                                <Alert variant="destructive" className="mt-2">
                                                    <Info className="h-4 w-4" />
                                                    <AlertTitle>Commessa non attiva</AlertTitle>
                                                    <AlertDescription>
                                                        Per registrare un consumo, devi prima scansionare una commessa e avviarla dalla pagina "Scansione Commessa".
                                                    </AlertDescription>
                                                </Alert>
                                            )}
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                             <div className="grid grid-cols-2 gap-4">
                                                <FormField control={form.control} name="kgApertura" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> KG Apertura</FormLabel> <FormControl><Input type="number" placeholder="Es. 55.5" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                                <FormField control={form.control} name="kgChiusura" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" /> KG Chiusura</FormLabel> <FormControl><Input type="number" placeholder="Es. 50.2" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             </div>
                                             <FormField control={form.control} name="notaLordoNetto" render={({ field }) => ( <FormItem> <FormLabel>Nota Lordo/Netto</FormLabel> <FormControl><Input placeholder="Es. Tara 0.3kg" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             <FormField control={form.control} name="numPz" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Package className="mr-2 h-4 w-4" /> N° Pezzi Consumati</FormLabel> <FormControl><Input type="number" placeholder="Es. 10" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                             
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
            </AppShell>
        </AuthGuard>
    );
}
    