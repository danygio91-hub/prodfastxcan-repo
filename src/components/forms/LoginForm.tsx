
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AnimatePresence, motion } from 'framer-motion';

import { login } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { mockOperators } from '@/lib/mock-data';

import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { QrCode, Fingerprint, Lock, LogIn, User, CameraOff, Loader2, KeyRound } from 'lucide-react';

const manualLoginSchema = z.object({
  username: z.string().min(1, { message: "Il nome utente è obbligatorio." }),
  password: z.string().min(1, { message: "La password è obbligatoria." }),
});

type LoginStep = 'initial' | 'camera' | 'welcome' | 'face' | 'touch' | 'manual_login' | 'logging_in';

export default function LoginForm() {
    const [step, setStep] = useState<LoginStep>('initial');
    const [scannedOperator, setScannedOperator] = useState<Operator | null>(null);
    const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const router = useRouter();
    const { toast } = useToast();

    useEffect(() => {
        const streamRef = videoRef.current?.srcObject as MediaStream | null;
        
        if (step === 'camera' || step === 'face') {
            const getCameraPermission = async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    setHasCameraPermission(true);
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                } catch (error) {
                    console.error('Error accessing camera:', error);
                    setHasCameraPermission(false);
                    toast({
                        variant: 'destructive',
                        title: 'Accesso Fotocamera Negato',
                        description: 'Abilita i permessi per la fotocamera nelle impostazioni del browser.',
                    });
                    setStep('initial');
                }
            };
            getCameraPermission();
        }

        return () => {
            if (streamRef) {
                streamRef.getTracks().forEach(track => track.stop());
            }
        };
    }, [step, toast]);

    const handleStartQrScan = () => {
        setIsLoading(true);
        setStep('camera');
        setTimeout(() => {
            const operators = mockOperators.filter(op => op.role !== 'admin');
            const randomOperator = operators.length > 0 ? operators[Math.floor(Math.random() * operators.length)] : null;
            if (randomOperator) {
                setScannedOperator(randomOperator);
                toast({ title: "QR Code Riconosciuto", description: `Operatore ${randomOperator.nome} trovato.` });
                setStep('welcome');
            } else {
                toast({ variant: 'destructive', title: 'Errore', description: 'Nessun operatore valido trovato per la scansione.' });
                setStep('initial');
            }
            setIsLoading(false);
        }, 2500);
    };
    
    useEffect(() => {
      if (step === 'welcome') {
        const timer = setTimeout(() => setStep('face'), 2500);
        return () => clearTimeout(timer);
      }
      if (step === 'face') {
         setIsLoading(true);
        const timer = setTimeout(() => {
            toast({ title: "Viso Riconosciuto", description: "Autenticazione facciale completata." });
            setStep('touch');
            setIsLoading(false);
        }, 2500);
        return () => clearTimeout(timer);
      }
    }, [step, toast]);

    const handleTouchAuth = () => {
        setIsLoading(true);
        setTimeout(() => {
            toast({ title: "Impronta Verificata", description: "Autenticazione biometrica completata." });
            if (scannedOperator) {
                performLogin(scannedOperator.nome, scannedOperator.password || '1234');
            }
        }, 1500);
    };
    
    const performLogin = useCallback(async (username: string, password_used: string) => {
        setIsLoading(true);
        setStep('logging_in');
        const operator = await login(username, password_used);
        
        if (operator) {
            toast({
                title: "Accesso Riuscito",
                description: `Benvenuto, ${operator.nome}! Reindirizzamento...`,
            });
            router.push(operator.role === 'admin' ? "/admin/dashboard" : "/dashboard");
        } else {
            toast({
                title: "Accesso Fallito",
                description: "Credenziali non valide o utente non configurato in Firebase. Contatta un amministratore.",
                variant: "destructive",
            });
            setStep('initial');
            setIsLoading(false);
        }
    }, [router, toast]);

    const manualForm = useForm<z.infer<typeof manualLoginSchema>>({
        resolver: zodResolver(manualLoginSchema),
        defaultValues: { username: "", password: "" },
    });

    const onManualSubmit = (values: z.infer<typeof manualLoginSchema>) => {
        performLogin(values.username, values.password);
    };

    const renderStep = () => {
        switch (step) {
            case 'initial':
                return (
                    <motion.div key="initial" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                        <CardHeader className="items-center text-center">
                            <Image src="/logo.svg" alt="PFXcan Logo" width={150} height={100} className="mb-4" />
                            <CardTitle className="text-2xl font-headline">Benvenuto in PFXcan</CardTitle>
                             <CardDescription className="text-muted-foreground">Seleziona una modalità di accesso.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <Button onClick={handleStartQrScan} size="lg" className="h-16 text-lg" disabled={isLoading}>
                               {isLoading ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : <QrCode className="mr-3 h-8 w-8" />}
                                Accesso Rapido con QR
                            </Button>
                            <Button onClick={() => setStep('manual_login')} variant="outline">
                                <KeyRound className="mr-2 h-4 w-4" />
                                Accedi con Password
                            </Button>
                        </CardContent>
                    </motion.div>
                );
            case 'camera':
            case 'face':
                const isFaceScan = step === 'face';
                return (
                    <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                         <CardHeader>
                            <CardTitle className="text-center font-headline">{isFaceScan ? "Riconoscimento Facciale" : "Scansione QR Code"}</CardTitle>
                            <CardDescription className="text-center">{isFaceScan ? "Posiziona il tuo volto nel cerchio." : "Inquadra il QR code del tuo cartellino."}</CardDescription>
                        </CardHeader>
                        <CardContent className="relative flex items-center justify-center aspect-video bg-black rounded-lg">
                            {hasCameraPermission === false && (
                                <Alert variant="destructive" className="flex flex-col items-center text-center m-4">
                                    <CameraOff className="h-8 w-8 mb-2" />
                                    <AlertTitle>Fotocamera non disponibile</AlertTitle>
                                    <AlertDescription>Controlla i permessi nel browser.</AlertDescription>
                                </Alert>
                            )}
                             <video ref={videoRef} className={cn("w-full h-full object-cover rounded-md", hasCameraPermission ? "block" : "hidden")} autoPlay muted playsInline />
                            {hasCameraPermission && (
                                <>
                                    <div className={cn("absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none")}>
                                        <div className={cn("w-2/3 h-2/3 border-4 border-dashed border-primary/70", isFaceScan ? "rounded-full" : "rounded-lg")} />
                                    </div>
                                </>
                            )}
                             {isLoading && (
                                 <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center">
                                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                                    <p className="mt-4 text-lg font-medium text-foreground">{isFaceScan ? "Analisi..." : "Scansione..."}</p>
                                 </div>
                             )}
                        </CardContent>
                        <CardFooter className="pt-6">
                            <Button variant="outline" className="w-full" onClick={() => setStep('initial')}>Annulla</Button>
                        </CardFooter>
                    </motion.div>
                );
            case 'welcome':
                if (!scannedOperator) { setStep('initial'); return null; }
                return (
                     <motion.div key="welcome" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-center p-8 flex flex-col items-center justify-center aspect-video">
                         <Avatar className="h-24 w-24 mx-auto mb-4 border-4 border-primary">
                             <AvatarImage src={`https://placehold.co/100x100.png?text=${scannedOperator.nome.charAt(0)}${scannedOperator.cognome.charAt(0)}`} alt={scannedOperator.nome} data-ai-hint="avatar persona" />
                            <AvatarFallback>{scannedOperator.nome.charAt(0)}{scannedOperator.cognome.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <h2 className="text-3xl font-bold font-headline">Buongiorno, {scannedOperator.nome}!</h2>
                        <p className="text-muted-foreground mt-2">Autenticazione in corso...</p>
                        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mt-6" />
                     </motion.div>
                );
            case 'touch':
                if (!scannedOperator) { setStep('initial'); return null; }
                return (
                     <motion.div key="touch" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                         <CardHeader className="text-center">
                            <CardTitle className="text-2xl font-headline">Verifica Finale</CardTitle>
                            <CardDescription>Conferma la tua identità per completare l'accesso.</CardDescription>
                         </CardHeader>
                         <CardContent className="flex flex-col items-center justify-center gap-6 py-8">
                             <Button onClick={handleTouchAuth} variant="outline" className="h-24 w-24 rounded-full border-4 border-primary/50 flex flex-col items-center justify-center hover:bg-primary/10" disabled={isLoading}>
                                 {isLoading ? <Loader2 className="h-10 w-10 animate-spin text-primary"/> : <Fingerprint className="h-12 w-12 text-primary"/>}
                             </Button>
                             <span className="text-sm text-muted-foreground">Tocca il sensore</span>
                         </CardContent>
                         <CardFooter>
                            <Button variant="link" className="w-full" onClick={() => setStep('initial')}>Accedi con un'altra modalità</Button>
                         </CardFooter>
                     </motion.div>
                );
            case 'manual_login':
                 return (
                     <motion.div key="manual_login" initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}>
                        <Form {...manualForm}>
                            <form onSubmit={manualForm.handleSubmit(onManualSubmit)}>
                                 <CardHeader className="items-center text-center">
                                    <Image src="/logo.svg" alt="PFXcan Logo" width={120} height={80} className="mb-4" />
                                    <CardTitle>Accesso Manuale</CardTitle>
                                    <CardDescription className="text-muted-foreground">Inserisci le tue credenziali.</CardDescription>
                                 </CardHeader>
                                <CardContent className="space-y-6">
                                    <FormField control={manualForm.control} name="username" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><User className="mr-2 h-5 w-5" />Nome Utente</FormLabel> <FormControl><Input placeholder="Es. Mario" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                    <FormField control={manualForm.control} name="password" render={({ field }) => ( <FormItem> <FormLabel className="flex items-center"><Lock className="mr-2 h-5 w-5" />Password</FormLabel> <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                                </CardContent>
                                <CardFooter className="flex-col gap-4">
                                    <Button type="submit" className="w-full" disabled={isLoading}>
                                        {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                                        {isLoading ? "Verifica..." : "Accedi"}
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
