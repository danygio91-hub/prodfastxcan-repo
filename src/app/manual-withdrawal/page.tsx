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
import { getRawMaterialByCode, findLastWeightForLotto } from '@/app/scan-job/actions';
import { logManualWithdrawal } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { MinusSquare, QrCode, Loader2, Camera, AlertTriangle, ArrowLeft, Send, Barcode, Package, Search } from 'lucide-react';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from '@/components/ui/switch';

const withdrawalFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().optional(),
  quantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  notes: z.string().optional(),
  jobOrderPF: z.string().optional(),
});
type WithdrawalFormValues = z.infer<typeof withdrawalFormSchema>;

type ScanType = 'material' | 'lotto' | null;

export default function ManualWithdrawalPage() {
  const { operator, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [scanType, setScanType] = useState<ScanType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');

  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(!!scanType, videoRef);

  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
  });
  
  useEffect(() => {
    if (scannedMaterial) {
      setInputUnit('primary');
    }
  }, [scannedMaterial]);

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
  
  const handleScan = useCallback(async (code: string) => {
    setIsCapturing(true);
    if (scanType === 'material') {
      const result = await getRawMaterialByCode(code.trim());
      if ('error' in result) {
        toast({ variant: 'destructive', title: result.title, description: result.error });
      } else {
        setScannedMaterial(result);
        form.setValue('materialId', result.id);
        toast({ title: "Materiale Trovato", description: result.code });
      }
    } else if (scanType === 'lotto') {
      const lottoData = await findLastWeightForLotto(scannedMaterial?.id, code.trim());
        if (lottoData?.material) {
            setScannedMaterial(lottoData.material);
            form.setValue('materialId', lottoData.material.id);
            form.setValue('lotto', code.trim());
            toast({ title: "Lotto Riconosciuto", description: `Materiale: ${lottoData.material.code}, Lotto: ${code.trim()}` });
        } else {
             toast({ variant: 'destructive', title: 'Lotto non trovato', description: 'Nessuno storico per questo lotto. Scansionare prima il materiale se necessario.' });
        }
    }
    setScanType(null); // Close the dialog after scan
    setIsCapturing(false);
  }, [scanType, form, toast, scannedMaterial]);
  
  const triggerScan = async () => {
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
            await handleScan(barcodes[0].rawValue);
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
    if (!operator || !scannedMaterial) return;
    setIsSubmitting(true);

    const result = await logManualWithdrawal({
      ...values,
      operatorId: operator.id,
      operatorName: operator.nome,
      unit: inputUnit === 'kg' ? 'kg' : scannedMaterial.unitOfMeasure,
    });
    
    toast({
      title: result.success ? "Scarico Registrato" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      resetFlow();
    }
    setIsSubmitting(false);
  };

  const resetFlow = () => {
    setScannedMaterial(null);
    form.reset();
  };
  
  const renderScanView = () => (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Scansione {scanType === 'material' ? 'Materiale' : 'Lotto'}</DialogTitle>
      </DialogHeader>
      <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden my-4">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        {!hasPermission && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white p-4 text-center">Permesso fotocamera negato.</div>
        )}
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="w-5/6 h-2/5 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
            </div>
        </div>
      </div>
      <DialogFooter className="flex-col gap-2">
        <Button onClick={triggerScan} disabled={isCapturing || !hasPermission} className="w-full">
          {isCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Camera className="mr-2 h-4 w-4" />}
          {isCapturing ? 'Scansionando...' : 'Scansiona'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );


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
             Registra uno scarico manuale di materiale per la produzione.
            </p>
          </header>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  
                  {scannedMaterial ? (
                    <div className="p-4 border rounded-lg bg-muted text-center">
                        <p className="font-semibold text-lg">{scannedMaterial.code}</p>
                        <p className="text-sm text-muted-foreground">{scannedMaterial.description}</p>
                        <p className="text-xl font-bold text-primary mt-1">
                            Stock: {scannedMaterial.currentStockUnits?.toFixed(2) || '0.00'} {scannedMaterial.unitOfMeasure.toUpperCase()} / {scannedMaterial.currentWeightKg?.toFixed(2) || '0.00'} KG
                        </p>
                    </div>
                  ) : (
                    <div className="p-4 border rounded-lg bg-muted text-center text-sm text-muted-foreground">
                      Scansiona un materiale o un lotto per iniziare.
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button type="button" onClick={() => setScanType('material')} className="w-full h-12">
                          <QrCode className="mr-2 h-4 w-4" /> Scansiona Materiale
                      </Button>
                       <Button type="button" onClick={() => setScanType('lotto')} className="w-full h-12">
                          <Barcode className="mr-2 h-4 w-4" /> Scansiona Lotto
                      </Button>
                  </div>
                  
                  {scannedMaterial && scannedMaterial.unitOfMeasure !== 'kg' && (
                     <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center">
                        <Label htmlFor="unit-switch">{scannedMaterial.unitOfMeasure.toUpperCase()}</Label>
                        <Switch
                          id="unit-switch"
                          checked={inputUnit === 'kg'}
                          onCheckedChange={(checked) => setInputUnit(checked ? 'kg' : 'primary')}
                        />
                        <Label htmlFor="unit-switch">KG</Label>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="lotto"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lotto da Scaricare</FormLabel>
                        <FormControl><Input placeholder="Scansiona o digita il lotto..." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                   <FormField
                    control={form.control}
                    name="jobOrderPF"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Commessa / PF (Opzionale)</FormLabel>
                        <FormControl><Input placeholder="Es. Comm-123/24" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantità da Scaricare ({inputUnit === 'primary' ? scannedMaterial?.unitOfMeasure.toUpperCase() : 'KG'})</FormLabel>
                        <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
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
                  <Button type="button" variant="ghost" onClick={resetFlow}>Annulla</Button>
                  <Button type="submit" disabled={isSubmitting || !scannedMaterial}>
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                    Conferma Prelievo
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        </div>

        <Dialog open={!!scanType} onOpenChange={(open) => !open && setScanType(null)}>
          {renderScanView()}
        </Dialog>

      </AppShell>
    </AuthGuard>
  );
}
