
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { login } from '@/lib/auth';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';

import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QrCode, Lock, LogIn, User, Loader2, KeyRound, AlertTriangle, Clock, ScanLine, Download, PackagePlus, Camera, TestTube } from 'lucide-react';


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
    const [isScanning, setIsScanning] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const { hasPermission: hasCameraPermission } = useCameraStream(step === 'camera', videoRef);

    const { toast } = useToast();
    const { user, operator, loading: authLoading } = useAuth();

    const manualForm = useForm<z.infer<typeof manualLoginSchema>>({
        resolver: zodResolver(manualLoginSchema),
        defaultValues: { username: "", password: "" },
    });

    const performLogin = useCallback(async (username: string, password_used: string) => {
        setStep('logging_in');
        try {
            await login(username, password_used);
            // On success, the AuthProvider's onAuthStateChanged listener will handle the redirect.
        } catch (error) {
            localStorage.removeItem('login_redirect_path');
            const errorMessage = error instanceof Error ? error.message : "Credenziali non valide o utente non trovato.";
            toast({
                title: "Accesso Fallito",
                description: errorMessage,
                variant: "destructive",
            });
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
    
    const triggerScan = async () => {
        if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
          toast({ variant: 'destructive', title: 'Funzionalità non Supportata', description: 'Il tuo browser non supporta la scansione dei codici a barre.' });
          return;
        }

        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            toast({ variant: 'destructive', title: 'Fotocamera non Pronta', description: 'Attendere che il video sia attivo.' });
            return;
        }

        setIsScanning(true);
        toast({ title: 'Scansione...', description: 'Alla ricerca di un codice nel frame.' });
        
        try {
            const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await barcodeDetector.detect(videoRef.current);

            if (barcodes.length > 0) {
                setStep('initial'); // Stop the camera
                const [username, password] = barcodes[0].rawValue.split('@');
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
            } else {
                toast({ variant: 'destructive', title: 'Nessun Codice Trovato', description: 'Assicurati che il codice sia ben visibile e riprova.' });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Errore di Scansione', description: 'Impossibile processare l\'immagine.' });
        } finally {
            setIsScanning(false);
        }
    };


    const onManualSubmit = (values: z.infer<typeof manualLoginSchema>) => {
        localStorage.removeItem('login_redirect_path');
        performLogin(values.username, values.password);
    };

    const renderStep = () => {
        switch (step) {
            case 'initial':
                return (
                    <>
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
                                <Button variant="secondary" className="h-20 flex-col gap-1 text-secondary-foreground opacity-50 cursor-not-allowed" disabled>
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
                        </CardContent>
                    </>
                );
            case 'camera':
                return (
                    <div>
                         <CardHeader>
                            <CardTitle className="text-center font-headline">Scansione QR Code</CardTitle>
                            <CardDescription className="text-center">Inquadra il QR code e premi il pulsante per scansionare.</CardDescription>
                        </CardHeader>
                        <CardContent className="relative grid place-items-center aspect-square bg-black rounded-lg overflow-hidden">
                             <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                             <div className="absolute inset-0 grid place-items-center pointer-events-none">
                                <div className="w-2/3 h-2/3 relative">
                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                                    <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                                </div>
                             </div>
                             {hasCameraPermission === false && (
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
                                    <Button type="submit" className="w-full" disabled={authLoading}>
                                        {authLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                                        {authLoading ? "Verifica..." : "Accedi"}
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
        </>
    );
}
