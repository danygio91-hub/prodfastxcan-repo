
"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
import { getLotInfoForMaterial, type LotInfo } from '@/app/admin/raw-material-management/actions';
import { logManualWithdrawal } from './actions';
import type { RawMaterial } from '@/lib/mock-data';
import { MinusSquare, QrCode, Loader2, Camera, AlertTriangle, ArrowLeft, Send, Barcode, Package, Search, Boxes } from 'lucide-react';
import { useCameraStream } from '@/hooks/use-camera-stream';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from '@/components/ui/switch';
import { formatDisplayStock } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

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
  const [lotAvailability, setLotAvailability] = useState<LotInfo | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [scanType, setScanType] = useState<ScanType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');

  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(!!scanType, videoRef);

  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
    defaultValues: {
      lotto: '',
      notes: '',
      jobOrderPF: ''
    }
  });

  const lottoValue = form.watch('lotto');

  useEffect(() => {
    if (scannedMaterial) {
      setInputUnit('primary');
    }
  }, [scannedMaterial]);

  const updateLotInfo = useCallback(async (materialId: string, lotto: string) => {
    try {
      const lots = await getLotInfoForMaterial(materialId);
      const matched = lots.find(l => l.lotto === lotto);
      setLotAvailability(matched || null);
    } catch (e) {
      setLotAvailability(null);
    }
  }, []);

  useEffect(() => {
    if (lottoValue && lottoValue.length >= 2 && scannedMaterial) {
      const timer = setTimeout(() => {
        updateLotInfo(scannedMaterial.id, lottoValue);
      }, 600);
      return () => clearTimeout(timer);
    } else {
      setLotAvailability(null);
    }
  }, [lottoValue, scannedMaterial, updateLotInfo]);

  useEffect(() => {
    if (!authLoading && operator && !operator.canAccessMaterialWithdrawal && operator.role !== 'admin') {
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
        await updateLotInfo(lottoData.material.id, code.trim());
      } else {
        form.setValue('lotto', code.trim());
        toast({ title: 'Lotto Nuovo', description: 'Nessuno storico trovato per questo lotto.' });
      }
    }
    setScanType(null);
    setIsCapturing(false);
  }, [scanType, form, toast, scannedMaterial, updateLotInfo]);

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
    setLotAvailability(null);
    form.reset({
      lotto: '',
      notes: '',
      jobOrderPF: ''
    });
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
          {isCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
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
                    <div className="p-4 border rounded-lg bg-muted/50 border-primary/20 space-y-4">
                      <div className="text-center">
                        <p className="font-black text-xl tracking-tight uppercase">{scannedMaterial.code}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{scannedMaterial.description}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-md bg-background border flex flex-col items-center justify-center text-center">
                          <Label className="text-[8px] uppercase font-black text-muted-foreground">Totale Magazzino</Label>
                          <p className="text-sm font-black text-primary leading-tight">
                            {formatDisplayStock(scannedMaterial.currentStockUnits, scannedMaterial.unitOfMeasure)} {scannedMaterial.unitOfMeasure.toUpperCase()}
                          </p>
                          <p className="text-[9px] font-bold text-muted-foreground">
                            ({formatDisplayStock(scannedMaterial.currentWeightKg, 'kg')} KG)
                          </p>
                        </div>

                        <div className={cn(
                          "p-2 rounded-md border flex flex-col items-center justify-center text-center transition-all",
                          lotAvailability ? "bg-primary/10 border-primary/40" : "bg-muted border-dashed opacity-50"
                        )}>
                          <Label className="text-[8px] uppercase font-black text-muted-foreground">Stock Lotto Attivo</Label>
                          {lotAvailability ? (
                            <>
                              <p className="text-sm font-black text-primary leading-tight">
                                {formatDisplayStock(lotAvailability.available, scannedMaterial.unitOfMeasure)} {scannedMaterial.unitOfMeasure.toUpperCase()}
                              </p>
                              <p className="text-[9px] font-bold text-primary/70">Lotto: {lotAvailability.lotto}</p>
                            </>
                          ) : (
                            <p className="text-[10px] font-bold text-muted-foreground italic">Nessun Lotto</p>
                          )}
                        </div>
                      </div>
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
                    <Button type="button" onClick={() => setScanType('lotto')} className="w-full h-12" variant="secondary">
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

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="lotto"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-xs uppercase text-muted-foreground">Numero Lotto</FormLabel>
                          <FormControl><Input placeholder="Scansiona o digita il lotto..." {...field} value={field.value ?? ''} className="font-mono font-bold" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {lotAvailability && (
                      <Alert className="bg-green-500/10 border-green-500/30 py-2 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center gap-3">
                          <Boxes className="h-5 w-5 text-green-600" />
                          <div>
                            <AlertTitle className="text-xs font-bold text-green-700 uppercase">Lotto {lotAvailability.lotto} Riconosciuto</AlertTitle>
                            <AlertDescription className="text-sm font-black text-green-600">
                              Disponibilità: {formatDisplayStock(lotAvailability.available, scannedMaterial!.unitOfMeasure)} {scannedMaterial!.unitOfMeasure.toUpperCase()}
                            </AlertDescription>
                          </div>
                        </div>
                      </Alert>
                    )}

                    <FormField
                      control={form.control}
                      name="jobOrderPF"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-xs uppercase text-muted-foreground">Commessa / PF (Opzionale)</FormLabel>
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
                          <FormLabel className="text-primary font-black uppercase text-xs">Quantità da Scaricare ({inputUnit === 'primary' ? scannedMaterial?.unitOfMeasure.toUpperCase() : 'KG'})</FormLabel>
                          <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} className="font-mono text-lg font-bold" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-bold text-xs uppercase text-muted-foreground">Note (Opzionale)</FormLabel>
                          <FormControl><Input placeholder="Es. Prelievo per campioni" {...field} value={field.value ?? ''} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
                <CardFooter className="justify-between">
                  <Button type="button" variant="ghost" onClick={resetFlow}>Annulla</Button>
                  <Button type="submit" disabled={isSubmitting || !scannedMaterial}>
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
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
