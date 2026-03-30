
"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from '@/components/ui/switch';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { getRawMaterialByCode } from '@/app/scan-job/actions';
import { getPackagingItems, registerInventoryBatch } from './actions';
import type { RawMaterial, Packaging } from '@/types';
import { Warehouse, QrCode, Loader2, Camera, AlertTriangle, ArrowLeft, Weight, Archive, Send, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCameraStream } from '@/hooks/use-camera-stream';
import { formatDisplayStock } from '@/lib/utils';

const inventoryFormSchema = z.object({
  materialId: z.string().min(1),
  lotto: z.string().optional(),
  inputQuantity: z.coerce.number().positive("La quantità deve essere un numero positivo."),
  packagingId: z.string().optional(),
  operatorId: z.string(),
  operatorName: z.string(),
  inputUnit: z.enum(['n', 'mt', 'kg']),
});
type InventoryFormValues = z.infer<typeof inventoryFormSchema>;

type Step = 'scan_material' | 'form' | 'saving' | 'success';

export default function InventoryPage() {
  const { operator, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('scan_material');
  const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isLottoScanOpen, setIsLottoScanOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission: hasCameraPermission } = useCameraStream(step === 'scan_material' || isLottoScanOpen, videoRef);

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventoryFormSchema),
  });

  const selectedPackagingId = form.watch('packagingId');
  const enteredQuantity = form.watch('inputQuantity') || 0;
  const inputUnit = form.watch('inputUnit');

  const calculatedNetWeight = useMemo(() => {
    if (!scannedMaterial || !enteredQuantity) return 0;

    const selectedTara = packagingItems.find(p => p.id === selectedPackagingId)?.weightKg || 0;

    if (inputUnit === 'kg') {
      return (enteredQuantity || 0) - selectedTara;
    }

    const factor = (inputUnit === 'mt')
      ? (scannedMaterial.rapportoKgMt || scannedMaterial.conversionFactor || 0)
      : (scannedMaterial.conversionFactor || 0);

    return (enteredQuantity * factor);
  }, [scannedMaterial, enteredQuantity, inputUnit, packagingItems, selectedPackagingId]);

  useEffect(() => {
    if (!authLoading && operator && !operator.canAccessInventory && operator.role !== 'admin') {
      toast({
        variant: "destructive",
        title: "Accesso Negato",
        description: "Non hai i permessi per accedere alla pagina Inventario."
      });
      router.replace('/dashboard');
    }
  }, [operator, authLoading, router, toast]);

  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
  }, []);

  const handleMaterialScanned = useCallback(async (code: string) => {
    setIsLottoScanOpen(false);
    const result = await getRawMaterialByCode(code.trim());
    if ('error' in result) {
      toast({ variant: 'destructive', title: result.title || "Errore", description: result.error });
      setStep('scan_material');
    } else {
      setScannedMaterial(result);
      if (operator) {
        form.reset({
          materialId: result.id,
          lotto: '',
          packagingId: 'none',
          operatorId: operator.id,
          operatorName: operator.nome,
          inputUnit: result.unitOfMeasure,
          inputQuantity: undefined,
        });
      }
      setStep('form');
    }
  }, [toast, form, operator]);

  const handleLottoScanned = useCallback((code: string) => {
    form.setValue('lotto', code.trim());
    setIsLottoScanOpen(false);
    toast({ title: "Lotto Scansionato", description: `Lotto "${code.trim()}" inserito.` });
  }, [form, toast]);

  const triggerScan = async (onScan: (code: string) => void) => {
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
        onScan(barcodes[0].rawValue);
      } else {
        toast({ variant: 'destructive', title: 'Nessun codice trovato.' });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
    } finally {
      setIsCapturing(false);
    }
  };

  const onSubmit = async (values: InventoryFormValues) => {
    if (!operator || !scannedMaterial) {
      toast({ variant: "destructive", title: "Errore", description: "Dati operatore o materiale mancanti." });
      return;
    }

    setStep('saving');
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) formData.append(key, String(value));
    });

    const result = await registerInventoryBatch(formData);

    toast({
      title: result.success ? "Inventario Registrato" : "Operazione Fallita",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      setStep('success');
    } else {
      setStep('form');
    }
  };

  const resetFlow = () => {
    setScannedMaterial(null);
    form.reset();
    setStep('scan_material');
  };

  if (authLoading || !operator) {
    return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-2xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Warehouse className="h-8 w-8 text-primary" />
              Registrazione Inventario
            </h1>
            <p className="text-muted-foreground">
              Scansiona un materiale e registra il peso per aggiornare l'inventario.
            </p>
          </header>

          <Card>
            {step === 'scan_material' && (
              <>
                <CardHeader>
                  <CardTitle>1. Scansione Materia Prima</CardTitle>
                  <CardDescription>Inquadra il codice a barre o QR code del materiale da inventariare.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden">
                    <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                    {hasCameraPermission === false && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Accesso Fotocamera Negato</AlertTitle>
                          <AlertDescription>Controlla i permessi del browser per continuare.</AlertDescription>
                        </Alert>
                      </div>
                    )}
                    {hasCameraPermission && (
                      <div className="absolute inset-0 grid place-items-center pointer-events-none">
                        <div className="w-5/6 h-2/5 relative">
                          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg"></div>
                          <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button onClick={() => triggerScan(handleMaterialScanned)} disabled={isCapturing || !hasCameraPermission} className="w-full h-12">
                    {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                    <span className="ml-2">{isCapturing ? 'Scansionando...' : 'Scansiona Materiale'}</span>
                  </Button>
                </CardFooter>
              </>
            )}

            {step === 'form' && scannedMaterial && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                  <CardHeader>
                    <CardTitle>2. Inserimento Dati</CardTitle>
                    <CardDescription>
                      Inserisci i dati per il materiale: <span className="font-bold text-primary">{scannedMaterial.code}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="lotto"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Numero Lotto (Opzionale)</FormLabel>
                          <div className="flex items-center gap-2">
                            <FormControl>
                              <Input placeholder="Scansiona o digita il lotto" {...field} />
                            </FormControl>
                            <Button type="button" variant="outline" size="icon" onClick={() => setIsLottoScanOpen(true)}>
                              <QrCode className="h-5 w-5" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="inputUnit"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center">
                            <Label htmlFor="unit-switch">{scannedMaterial.unitOfMeasure.toUpperCase()}</Label>
                            <Switch
                              id="unit-switch"
                              checked={field.value === 'kg'}
                              onCheckedChange={(checked) => field.onChange(checked ? 'kg' : scannedMaterial.unitOfMeasure)}
                            />
                            <Label htmlFor="unit-switch">KG</Label>
                          </div>
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField control={form.control} name="inputQuantity" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4" />
                            {inputUnit === 'kg' ? 'Quantità Lorda (KG)' : `Quantità Inserita (${scannedMaterial.unitOfMeasure.toUpperCase()})`}
                          </FormLabel>
                          <FormControl><Input type="number" step="any" placeholder="Es. 15.5" {...field} value={field.value ?? ''} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="packagingId" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><Archive className="mr-2 h-4 w-4" />Tara (Imballo)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Nessuna" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none">Nessuna Tara (0.00 kg)</SelectItem>
                              {packagingItems.map(item => (
                                <SelectItem key={item.id} value={item.id}>{item.name} ({item.weightKg.toFixed(3)} kg)</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="p-4 rounded-lg border bg-muted">
                      <Label className="text-muted-foreground">Peso Netto Calcolato (KG)</Label>
                      <p className="text-2xl font-bold text-primary">{calculatedNetWeight >= 0 ? formatDisplayStock(calculatedNetWeight, 'kg') : '---'}</p>
                    </div>

                  </CardContent>
                  <CardFooter className="justify-between">
                    <Button type="button" variant="outline" onClick={resetFlow}><ArrowLeft className="mr-2 h-4 w-4" />Annulla</Button>
                    <Button type="submit" disabled={calculatedNetWeight < 0 || form.formState.isSubmitting}>
                      {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Salva Registrazione
                    </Button>
                  </CardFooter>
                </form>
              </Form>
            )}

            {step === 'saving' && (
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <p className="text-muted-foreground">Salvataggio in corso...</p>
              </CardContent>
            )}

            {step === 'success' && (
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="bg-green-100 p-4 rounded-full"><Check className="h-12 w-12 text-green-600" /></div>
                <CardTitle>Inventario Registrato</CardTitle>
                <CardDescription>La registrazione è stata inviata per l'approvazione.</CardDescription>
                <Button onClick={resetFlow} className="mt-4">Registra Altro</Button>
              </CardContent>
            )}
          </Card>
        </div>

        <Dialog open={isLottoScanOpen} onOpenChange={setIsLottoScanOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Scansiona Codice Lotto</DialogTitle></DialogHeader>
            <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden my-4">
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
            </div>
            <DialogFooter>
              <Button onClick={() => triggerScan(handleLottoScanned)} disabled={isCapturing || !hasCameraPermission} className="w-full">
                {isCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                {isCapturing ? 'Scansionando...' : 'Scansiona Lotto'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AuthGuard>
  );
}
