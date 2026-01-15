
"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode } from '@/app/material-loading/actions';
import { logManualWithdrawal } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { MinusSquare, QrCode, Loader2, Camera, AlertTriangle, ArrowLeft, Send } from 'lucide-react';
import { useCameraStream } from '@/hooks/use-camera-stream';

const withdrawalFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().min(1, "Il lotto è obbligatorio."),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  notes: z.string().optional(),
});
type WithdrawalFormValues = z.infer<typeof withdrawalFormSchema>;

type Step = 'scan_material' | 'scan_lotto' | 'form' | 'saving';

export default function ManualWithdrawalPage() {
  const { operator, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('scan_material');
  const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(step === 'scan_material' || step === 'scan_lotto', videoRef);

  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
  });

  useEffect(() => {
    if (!authLoading && operator && !operator.canAccessMaterialWithdrawal) {
      toast({
        variant: "destructive",
        title: "Accesso Negato",
        description: "Non hai i permessi per accedere allo scarico manuale.",
      });
      router.replace('/dashboard');
    }
  }, [operator, authLoading, router, toast]);

  const handleScan = async (code: string, scanType: 'material' | 'lotto') => {
    if (scanType === 'material') {
      const result = await getRawMaterialByCode(code.trim());
      if ('error' in result) {
        toast({ variant: 'destructive', title: result.title, description: result.error });
      } else {
        setScannedMaterial(result);
        form.setValue('materialId', result.id);
        setStep('scan_lotto');
      }
    } else if (scanType === 'lotto') {
      form.setValue('lotto', code.trim());
      setStep('form');
    }
  };
  
  const triggerScan = async (scanType: 'material' | 'lotto') => {
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
            handleScan(barcodes[0].rawValue, scanType);
        } else {
            toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
        }
    } catch (error) {
        toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
    } finally {
        setIsCapturing(false);
    }
  };

  const onSubmit = async (values: WithdrawalFormValues) => {
    if (!operator) return;
    setStep('saving');

    const result = await logManualWithdrawal({
      ...values,
      operatorId: operator.id,
      operatorName: operator.nome,
    });
    
    toast({
      title: result.success ? "Scarico Registrato" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      resetFlow();
    } else {
      setStep('form');
    }
  };

  const resetFlow = () => {
    setScannedMaterial(null);
    form.reset();
    setStep('scan_material');
  };

  const renderStepContent = () => {
    switch (step) {
      case 'scan_material':
      case 'scan_lotto':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{step === 'scan_material' ? '1. Scansione Materiale' : '2. Scansione Lotto'}</CardTitle>
              <CardDescription>Inquadra il codice del {step === 'scan_material' ? 'materiale' : 'lotto'} da cui prelevare.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                   <div className="w-5/6 h-2/5 relative">
                       <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                       <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                       <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                       <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                       <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                   </div>
                </div>
                {!hasPermission && <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white p-4 text-center">Permesso fotocamera negato. Controlla le impostazioni del browser.</div>}
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-2">
                <Button onClick={() => triggerScan(step === 'scan_material' ? 'material' : 'lotto')} disabled={isCapturing || !hasPermission} className="w-full">
                  {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                  <span className="ml-2">Scansiona</span>
                </Button>
                {step === 'scan_lotto' && <Button variant="outline" onClick={() => setStep('scan_material')}>Scansiona altro materiale</Button>}
            </CardFooter>
          </Card>
        );
      case 'form':
        return (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <Card>
                <CardHeader>
                  <CardTitle>3. Dettagli Prelievo</CardTitle>
                  <CardDescription>
                    Materiale: <span className="font-bold text-primary">{scannedMaterial?.code}</span> | Lotto: <span className="font-bold text-primary">{form.getValues('lotto')}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantità da Scaricare ({scannedMaterial?.unitOfMeasure.toUpperCase()})</FormLabel>
                        <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} autoFocus /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Note (Opzionale)</FormLabel>
                        <FormControl><Input placeholder="Es. Prelievo per campioni" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
                <CardFooter className="justify-between">
                  <Button type="button" variant="ghost" onClick={resetFlow}><ArrowLeft className="mr-2 h-4 w-4"/> Annulla</Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                    Conferma Prelievo
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        );
      case 'saving':
        return (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Salvataggio scarico...</p>
            </CardContent>
          </Card>
        );
    }
  };

  if (authLoading || !operator) {
    return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-2xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <MinusSquare className="h-8 w-8 text-primary" />
              Scarico Manuale Materiale
            </h1>
            <p className="text-muted-foreground">
              Registra un prelievo manuale di materiale dal magazzino.
            </p>
          </header>
          {renderStepContent()}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
