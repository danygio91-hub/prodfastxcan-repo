
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { login } from '@/lib/auth';
import { useAuth } from '@/components/auth/AuthProvider';

import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { QrCode, Lock, LogIn, User, Loader2, KeyRound, AlertTriangle, Clock, ScanLine, Download, PackagePlus, PlayCircle, Camera } from 'lucide-react';

// Manual type declaration for BarcodeDetector API to ensure compilation
interface BarcodeDetectorOptions {
  formats?: string[];
}
interface DetectedBarcode {
  rawValue: string;
}
declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

// Add type for the install prompt event
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: Array<string>;
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}


const manualLoginSchema = z.object({
  username: z.string().min(1, { message: "Il nome utente è obbligatorio." }),
  password: z.string().min(1, { message: "La password è obbligatoria." }),
});

type LoginStep = 'initial' | 'camera' | 'logging_in' | 'manual_login';

export default function LoginForm() {
    const [step, setStep] = useState<LoginStep>('initial');
    const [isLoading, setIsLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [hasCameraPermission, setHasCameraPermission] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const router = useRouter();
    const { toast } = useToast();
    const { user, operator, loading: authLoading } = useAuth();
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    // QR Simulator State
    const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
    const [simulatorInput, setSimulatorInput] = useState('');

    // Effect to handle PWA install prompt
    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const performLogin = useCallback(async (username: string, password_used: string) => {
        setIsLoading(true);
        setStep('logging_in');
        try {
            await login(username, password_used);
        } catch (error) {
            localStorage.removeItem('login_redirect_path');
            const errorMessage = error instanceof Error ? error.message : "Credenziali non valide o utente non trovato.";
            toast({
                title: "Accesso Fallito",
                description: errorMessage,
                variant: "destructive",
            });
            setIsLoading(false); 
            setStep('manual_login');
        }
    }, [toast]);

    const handleScannedData = useCallback(async (data: string) => {
        const [username, password] = data.split('@');
        if (username && password) {
             performLogin(username, password);
        } else {
            toast({
                variant: 'destructive',
                title: 'Dati QR non Validi',
                description: 'Il formato del QR code per il login non è corretto.',
            });
            setStep('initial');
        }
    }, [performLogin, toast]);
    
    const handleQrLoginClick = (targetPath: string | null) => {
      if (targetPath) {
        localStorage.setItem('login_redirect_path', targetPath);
      } else {
        localStorage.removeItem('login_redirect_path');
      }
      setStep('camera');
    };
    
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (step !== 'camera') {
            stopCamera();
            return;
        }

        const startCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                setHasCameraPermission(true);
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(e => console.error("Video play failed:", e));
                }
            } catch (err) {
                console.error("Camera access error:", err);
                setHasCameraPermission(false);
                stopCamera();
            }
        };

        startCamera();

        return () => {
            stopCamera();
        };
    }, [step, stopCamera]);
    
    const triggerScan = async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            toast({ variant: 'destructive', title: 'Fotocamera non Pronta', description: 'Attendere che il video sia attivo.' });
            return;
        }

        if (!('BarcodeDetector' in window)) {
            toast({ variant: 'destructive', title: 'Funzionalità non Supportata' });
            return;
        }

        setIsScanning(true);
        toast({ title: 'Scansione...', description: 'Alla ricerca di un codice nel frame.' });
        
        try {
            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await barcodeDetector.detect(videoRef.current);

            if (barcodes.length > 0) {
                stopCamera();
                handleScannedData(barcodes[0].rawValue);
            } else {
                toast({ variant: 'destructive', title: 'Nessun Codice Trovato', description: 'Assicurati che il codice sia ben visibile e riprova.' });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Errore di Scansione', description: 'Impossibile processare l\'immagine.' });
        } finally {
            setIsScanning(false);
        }
    };


    const manualForm = useForm<z.infer<typeof manualLoginSchema>>({
        resolver: zodResolver(manualLoginSchema),
        defaultValues: { username: "", password: "" },
    });

    const onManualSubmit = (values: z.infer<typeof manualLoginSchema>) => {
        localStorage.removeItem('login_redirect_path');
        performLogin(values.username, values.password);
    };
    
    const handleInstallClick = async () => {
        if (!installPrompt) {
            return;
        }
        await installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            toast({ title: "Installazione Avviata", description: "L'app verrà aggiunta alla tua schermata principale." });
        }
        setInstallPrompt(null);
    };

    const handleSimulatorSubmit = () => {
        localStorage.removeItem('login_redirect_path');
        handleScannedData(simulatorInput);
        setIsSimulatorOpen(false);
        setSimulatorInput('');
    };

    const renderStep = () => {
        switch (step) {
            case 'initial':
                return (
                    <div>
                        <CardHeader className="items-center text-center">
                            <Image src="/logo.png" alt="PFXcan Logo" width={150} height={100} unoptimized={true} priority={true} />
                            <CardTitle className="text-2xl font-headline">Benvenuto in PFXcan</CardTitle>
                             <CardDescription className="text-muted-foreground">Seleziona una modalità di accesso.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <Button onClick={() => handleQrLoginClick(null)} size="lg" className="h-14 text-lg">
                               <QrCode className="mr-3 h-6 w-6" />
                                Accesso Standard (QR)
                            </Button>

                             <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <Button onClick={() => handleQrLoginClick('/clock-in-out')} variant="secondary" className="h-20 flex-col gap-1 text-secondary-foreground">
                                    <Clock className="h-6 w-6" />
                                    Timbratura
                                </Button>
                                <Button onClick={() => handleQrLoginClick('/scan-job')} className="h-20 flex-col gap-1 bg-green-600 text-white hover:bg-green-700">
                                    <ScanLine className="h-6 w-6" />
                                    Produzione
                                </Button>
                                 <Button onClick={() => handleQrLoginClick('/material-loading')} className="h-20 flex-col gap-1 bg-amber-500 text-white hover:bg-amber-600">
                                    <PackagePlus className="h-6 w-6" />
                                    Carico Merce
                                </Button>
                            </div>
                            
                            <div className="relative flex py-2 items-center">
                                <div className="flex-grow border-t border-muted-foreground/20"></div>
                                <span className="flex-shrink mx-4 text-xs text-muted-foreground">OPPURE</span>
                                <div className="flex-grow border-t border-muted-foreground/20"></div>
                            </div>

                            <Button onClick={() => setStep('manual_login')} variant="outline">
                                <KeyRound className="mr-2 h-4 w-4" />
                                Accedi con Password
                            </Button>

                             <Button onClick={() => setIsSimulatorOpen(true)} variant="secondary" size="sm">
                                <PlayCircle className="mr-2 h-4 w-4" />
                                Simula Scansione QR (Test)
                            </Button>
                        </CardContent>
                        {installPrompt && (
                            <CardFooter>
                                <Button onClick={handleInstallClick} variant="ghost" size="sm" className="w-full text-muted-foreground">
                                    <Download className="mr-2 h-4 w-4" />
                                    Installa App sul dispositivo
                                </Button>
                            </CardFooter>
                        )}
                    </div>
                );
            case 'camera':
                return (
                    <div>
                         <CardHeader>
                            <CardTitle className="text-center font-headline">Scansione QR Code</CardTitle>
                            <CardDescription className="text-center">Inquadra il QR code e premi il pulsante per scansionare.</CardDescription>
                        </CardHeader>
                        <CardContent className="relative flex items-center justify-center aspect-square bg-black rounded-lg overflow-hidden">
                             <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-2/3 h-2/3 relative">
                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                                    <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                </div>
                             </div>
                             {!hasCameraPermission && (
                                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                                    <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                                    <p className="text-destructive-foreground font-semibold">Accesso alla fotocamera negato</p>
                                    <p className="text-sm text-muted-foreground mt-2">Controlla i permessi del browser per continuare.</p>
                                </div>
                            )}
                        </CardContent>
                        <CardFooter className="pt-6 flex flex-col gap-2">
                             <Button onClick={triggerScan} disabled={isScanning || !hasCameraPermission} className="w-full h-14">
                                {isScanning ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                                <span className="ml-2 text-lg">{isScanning ? 'Scansionando...' : 'Scansiona'}</span>
                             </Button>
                            <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                        </CardFooter>
                    </div>
                );
            case 'manual_login':
                 return (
                     <div>
                        <Form {...manualForm}>
                            <form onSubmit={manualForm.handleSubmit(onManualSubmit)}>
                                 <CardHeader className="items-center text-center">
                                    <Image src="/logo.png" alt="PFXcan Logo" width={120} height={80} unoptimized={true} />
                                    <CardTitle>Accesso Manuale</CardTitle>
                                    <CardDescription className="text-muted-foreground">Inserisci le tue credenziali.</CardDescription>
                                 </CardHeader>
                                <CardContent className="space-y-6">
                                    <FormField control={manualForm.control} name="username" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><User className="mr-2 h-5 w-5" />Nome Utente</FormLabel> <FormControl><Input placeholder="Es. Daniel" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                    <FormField control={manualForm.control} name="password" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Lock className="mr-2 h-5 w-5" />Password</FormLabel> <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                </CardContent>
                                <CardFooter className="flex-col gap-4">
                                    <Button type="submit" className="w-full" disabled={isLoading || authLoading}>
                                        {(isLoading || authLoading) ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                                        {(isLoading || authLoading) ? "Verifica..." : "Accedi"}
                                    </Button>
                                    <Button variant="link" size="sm" onClick={() => setStep('initial')}>Torna all'accesso rapido</Button>
                                </CardFooter>
                            </form>
                        </Form>
                     </div>
                 );
            case 'logging_in':
                return (
                     <div className="flex flex-col items-center justify-center p-12 gap-4 aspect-video">
                        <Loader2 className="h-16 w-16 animate-spin text-primary" />
                        <p className="text-xl font-semibold">Accesso in corso...</p>
                    </div>
                );
        }
    };

    return (
        <>
            <Card className="w-full max-w-md shadow-xl border-border/50 bg-card overflow-hidden">
                {renderStep()}
            </Card>

            <Dialog open={isSimulatorOpen} onOpenChange={setIsSimulatorOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Simulatore Scansione QR</DialogTitle>
                        <DialogDescription>
                            Incolla il contenuto del QR code per il login (formato: username@password).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <Label htmlFor="simulator-input">Contenuto QR Code</Label>
                        <Input 
                            id="simulator-input"
                            value={simulatorInput}
                            onChange={(e) => setSimulatorInput(e.target.value)}
                            placeholder="username@password"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSimulatorOpen(false)}>Annulla</Button>
                        <Button onClick={handleSimulatorSubmit}>Simula e Accedi</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
