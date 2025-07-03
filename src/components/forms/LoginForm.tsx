
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AnimatePresence, motion } from 'framer-motion';

import { login } from '@/lib/auth';
import { useAuth } from '@/components/auth/AuthProvider';

import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { QrCode, Lock, LogIn, User, Loader2, KeyRound, AlertTriangle, Clock, ScanLine, Download } from 'lucide-react';

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

const manualLoginSchema = z.object({
  username: z.string().min(1, { message: "Il nome utente è obbligatorio." }),
  password: z.string().min(1, { message: "La password è obbligatoria." }),
});

type LoginStep = 'initial' | 'camera' | 'logging_in' | 'manual_login';

export default function LoginForm() {
    const [step, setStep] = useState<LoginStep>('initial');
    const [isLoading, setIsLoading] = useState(false);
    const [hasCameraPermission, setHasCameraPermission] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const router = useRouter();
    const { toast } = useToast();
    const { user, operator, loading: authLoading } = useAuth();
    const [installPrompt, setInstallPrompt] = useState<Event | null>(null);

    // Effect to handle PWA install prompt
    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    useEffect(() => {
        if (authLoading) return; 
        
        if (user && operator) {
            toast({
                title: `Buongiorno, ${operator.nome}!`,
                description: `Reindirizzamento in corso...`,
            });
        }
    }, [user, operator, authLoading, toast]);

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
    
    const handleQrLoginClick = (targetPath: string | null) => {
      if (targetPath) {
        localStorage.setItem('login_redirect_path', targetPath);
      } else {
        localStorage.removeItem('login_redirect_path');
      }
      setStep('camera');
    };

    useEffect(() => {
        if (step !== 'camera') {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            return;
        }

        let detectionInterval: ReturnType<typeof setInterval>;
        let localStream: MediaStream | null = null;

        const startCameraAndScan = async () => {
            try {
                if (!('BarcodeDetector' in window)) {
                    toast({ variant: 'destructive', title: 'Funzionalità non Supportata', description: 'Il tuo browser non supporta la scansione di QR code.' });
                    setStep('manual_login');
                    return;
                }

                localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = localStream;
                setHasCameraPermission(true);

                const video = videoRef.current;
                if (video) {
                    video.srcObject = localStream;
                    video.onloadedmetadata = () => {
                        video.play().catch(e => console.error("Video play failed:", e));
                    };
                }

                const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });

                detectionInterval = setInterval(async () => {
                    if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) return;

                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0) {
                        const scannedData = barcodes[0].rawValue;
                        const [username, password] = scannedData.split('@');
                        
                        if (username && password) {
                            clearInterval(detectionInterval);
                            if (streamRef.current) {
                                streamRef.current.getTracks().forEach(track => track.stop());
                                streamRef.current = null;
                            }
                            toast({ title: "QR Code Rilevato", description: "Verifica credenziali in corso..." });
                            performLogin(username, password);
                        }
                    }
                }, 500);

            } catch (err) {
                console.error("Camera access error:", err);
                setHasCameraPermission(false);
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            }
        };

        startCameraAndScan();

        return () => {
            clearInterval(detectionInterval);
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [step, performLogin, toast]);

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
        (installPrompt as any).prompt();
        const { outcome } = await (installPrompt as any).userChoice;
        if (outcome === 'accepted') {
            toast({ title: "Installazione Avviata", description: "L'app verrà aggiunta alla tua schermata principale." });
        }
        setInstallPrompt(null);
    };

    const renderStep = () => {
        switch (step) {
            case 'initial':
                return (
                    <motion.div key="initial" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
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

                            <div className="grid grid-cols-2 gap-3">
                                <Button onClick={() => handleQrLoginClick('/clock-in-out')} variant="secondary" className="h-20 flex-col gap-1">
                                    <Clock className="h-6 w-6" />
                                    Timbratura Rapida
                                </Button>
                                <Button onClick={() => handleQrLoginClick('/scan-job')} variant="secondary" className="h-20 flex-col gap-1">
                                    <ScanLine className="h-6 w-6" />
                                    Scansione Commessa
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
                        </CardContent>
                        {installPrompt && (
                            <CardFooter>
                                <Button onClick={handleInstallClick} variant="ghost" size="sm" className="w-full text-muted-foreground">
                                    <Download className="mr-2 h-4 w-4" />
                                    Installa App sul dispositivo
                                </Button>
                            </CardFooter>
                        )}
                    </motion.div>
                );
            case 'camera':
                return (
                    <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                         <CardHeader>
                            <CardTitle className="text-center font-headline">Scansione QR Code</CardTitle>
                            <CardDescription className="text-center">Inquadra il tuo QR code personale per accedere.</CardDescription>
                        </CardHeader>
                        <CardContent className="relative flex items-center justify-center aspect-video bg-black rounded-lg overflow-hidden">
                             <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                             <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none">
                                <div className="w-2/3 h-2/3 border-4 border-dashed border-primary/70 rounded-lg" />
                             </div>
                             {!hasCameraPermission && (
                                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                                    <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                                    <p className="text-destructive-foreground font-semibold">Accesso alla fotocamera negato</p>
                                    <p className="text-sm text-muted-foreground mt-2">Controlla i permessi del browser per continuare.</p>
                                </div>
                            )}
                        </CardContent>
                        <CardFooter className="pt-6">
                            <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                        </CardFooter>
                    </motion.div>
                );
            case 'manual_login':
                 return (
                     <motion.div key="manual_login" initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}>
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
                                        {isLoading || authLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                                        {isLoading || authLoading ? "Verifica..." : "Accedi"}
                                    </Button>
                                    <Button variant="link" size="sm" onClick={() => setStep('initial')}>Torna all'accesso rapido</Button>
                                </CardFooter>
                            </form>
                        </Form>
                     </motion.div>
                 );
            case 'logging_in':
                return (
                     <motion.div key="logging_in" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-12 gap-4 aspect-video">
                        <Loader2 className="h-16 w-16 animate-spin text-primary" />
                        <p className="text-xl font-semibold">Accesso in corso...</p>
                    </motion.div>
                );
        }
    };

    return (
        <Card className="w-full max-w-md shadow-xl border-border/50 bg-card overflow-hidden">
            <AnimatePresence mode="wait">
                {renderStep()}
            </AnimatePresence>
        </Card>
    );
}
