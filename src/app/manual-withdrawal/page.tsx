
"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';

import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { logManualWithdrawal } from './actions';
import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import { closeMaterialSessionAndUpdateStock, getRawMaterialByCode, findLastWeightForLotto } from '@/app/scan-job/actions';
import { getLotInfoForMaterial, type LotInfo } from '@/app/admin/raw-material-management/actions';
import type { RawMaterial, ActiveMaterialSessionData } from '@/types';

import { MinusSquare, QrCode, Loader2, Camera, AlertTriangle, ArrowLeft, Send, Barcode, Package, Search, Boxes, Info, PlayCircle, Weight, X, Lock } from 'lucide-react';


import { useCameraStream } from '@/hooks/use-camera-stream';
import { useBatchSelection } from '@/hooks/useBatchSelection';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { getGlobalSettings } from '@/lib/settings-actions';
import { Switch } from '@/components/ui/switch';
import { formatDisplayStock } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const withdrawalFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  lotto: z.string().optional(),
  quantity: z.coerce.number().optional().refine(val => {
    // Se non siamo in modalità sessione, la quantità è obbligatoria e positiva
    return true; // La validazione reale la facciamo condizionale nel refine o nel submit
  }, "La quantità deve essere un numero positivo."),
  notes: z.string().optional(),
  jobOrderPF: z.string().optional(),
  packagingId: z.string().optional(),
}).refine((data) => {
  return true;
}, { path: ['quantity'] });

type WithdrawalFormValues = z.infer<typeof withdrawalFormSchema>;

type ScanType = 'material' | 'lotto' | null;

export default function ManualWithdrawalPage() {
  const { operator, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [scannedMaterial, setScannedMaterial] = useState<RawMaterial | null>(null);
  const [allLots, setAllLots] = useState<LotInfo[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [scanType, setScanType] = useState<ScanType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');
  const [useSession, setUseSession] = useState(false);


  const { activeSessions, startSession, closeSession, getSessionByMaterialId } = useActiveMaterialSession();


  const videoRef = useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(!!scanType, videoRef);

  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
    defaultValues: {
      lotto: '',
      notes: '',
      jobOrderPF: '',
      packagingId: 'none'
    }
  });

  const lottoValue = form.watch('lotto');
  const packagingIdValue = form.watch('packagingId');

  const {
      isLoading: isLoadingLots,
      lotAvailability,
      isFixedTare,
      calculatedNet,
      batchMetadata
  } = useBatchSelection({
      form,
      materialId: scannedMaterial?.id,
      quantityFieldName: 'quantity',
      packagingFieldName: 'packagingId'
  });


  useEffect(() => {
    if (!authLoading && operator && !operator.canAccessMaterialWithdrawal && operator.role !== 'admin' && operator.role !== 'supervisor') {
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
        form.setValue('lotto', code.trim());
    }
    setScanType(null);
    setIsCapturing(false);
  }, [scanType, form, toast]);


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

  const onSubmit = async (values: WithdrawalFormValues, isFinished: boolean = false) => {
    if (!operator || !scannedMaterial) return;
    setIsSubmitting(true);

    if (useSession) {
      const q = values.quantity || 0;
      const initialNet = q; 
      
      const initialTare = packagingItems.find(p => p.id === packagingIdValue)?.weightKg || 0;
      const initialGross = initialNet + initialTare;

      startSession({
        materialId: scannedMaterial.id,
        materialCode: scannedMaterial.code,
        grossOpeningWeight: initialGross,
        netOpeningWeight: initialNet, 
        originatorJobId: null, 
        associatedJobs: values.jobOrderPF ? [{ jobId: values.jobOrderPF, jobOrderPF: values.jobOrderPF }] : [],
        lotto: values.lotto || null,
        packagingId: packagingIdValue,
        tareWeight: initialTare
      }, scannedMaterial.type);

      toast({ title: "Sessione Avviata", description: "Monitora il prelievo dalla barra laterale." });
      resetFlow();
      setIsSubmitting(false);
      return;
    }

    const result = await logManualWithdrawal({
      ...values,
      quantity: values.quantity || 0,
      operatorId: operator.id,
      operatorName: operator.nome,
      unit: isKgMode ? 'kg' : scannedMaterial.unitOfMeasure,
      isFinished: isFinished
    });

    toast({
      title: result.success ? (isFinished ? "Materiale Finito" : "Scarico Registrato") : "Errore",
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
    setAllLots([]);
    form.reset({
      lotto: '',
      notes: '',
      jobOrderPF: '',
      quantity: undefined,
      packagingId: 'none'
    });
  };


  const [packagingItems, setPackagingItems] = useState<any[]>([]);

  useEffect(() => {
     if (scannedMaterial) {
        getLotInfoForMaterial(scannedMaterial.id).then(setAllLots);
     }
  }, [scannedMaterial]);


  useEffect(() => {
    import('../inventory/actions').then(m => m.getPackagingItems().then(setPackagingItems));
  }, []);

  const renderScanView = () => (
    <DialogContent className="max-w-md p-0 overflow-hidden">
      <DialogHeader className="p-6 pb-2 border-b bg-muted/10">
        <DialogTitle className="text-lg font-bold">Scansione {scanType === 'material' ? 'Materiale' : 'Lotto'}</DialogTitle>
      </DialogHeader>
      <div className="p-6 pt-0">
        <div className="relative grid place-items-center aspect-video bg-black rounded-xl overflow-hidden my-4 border-2 border-muted shadow-inner">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            {!hasPermission && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                    <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                    <p className="text-white font-semibold">Accesso Fotocamera Negato</p>
                </div>
            )}
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-5/6 h-2/5 border-2 border-primary/50 rounded-lg relative">
                    <div className="absolute w-full top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow-[0_0_4px_1px_#ef4444]"></div>
                </div>
            </div>
        </div>
        <div className="flex flex-col gap-2">
            <Button onClick={triggerScan} disabled={isCapturing || !hasPermission} className="w-full h-12 text-lg font-black uppercase tracking-tight">
                {isCapturing ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="mr-2 h-5 w-5" />}
                {isCapturing ? 'Analisi...' : 'Scansiona Ora'}
            </Button>
             <Button variant="ghost" onClick={() => setScanType(null)} className="text-muted-foreground uppercase font-bold text-xs">Annulla</Button>
        </div>
      </div>
    </DialogContent>
  );

  const isKgMode = scannedMaterial?.unitOfMeasure === 'kg' || inputUnit === 'kg';
  const selectedPackaging = packagingItems.find(p => p.id === packagingIdValue);
  const tareWeight = selectedPackaging?.weightKg || 0;
  // Use calculated net from hook
  const effectiveNet = calculatedNet > 0 ? calculatedNet : (lotAvailability?.available || 0);
  const expectedGross = effectiveNet + tareWeight;



  if (authLoading || !operator) {
    return <AppShell><div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-3xl mx-auto pb-20">
          <header className="space-y-2 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-3">
                <div className="p-3 bg-primary/10 rounded-2xl border-2 border-primary/20">
                    <MinusSquare className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-black font-headline tracking-tighter uppercase leading-none">
                      Scarico Manuale
                    </h1>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">
                      Gestione prelievi liberi o campionature
                    </p>
                </div>
            </div>
          </header>

          <Form {...form}>
            <form id="withdrawal-form" onSubmit={form.handleSubmit((v) => onSubmit(v, false))} className="space-y-6">
              <Card className="border-2 shadow-xl overflow-hidden rounded-3xl">
                <CardContent className="p-0">
                  {scannedMaterial ? (
                    <div className="animate-in fade-in zoom-in-95 duration-300">
                      <div className="p-6 bg-muted/30 border-b space-y-4">
                        <div className="text-center space-y-1">
                          <p className="font-black text-2xl tracking-tighter leading-none">{scannedMaterial.code}</p>
                          <p className="text-[10px] text-muted-foreground uppercase font-black tracking-[0.2em]">{scannedMaterial.description}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 rounded-2xl bg-background border-2 border-primary/5 flex flex-col items-center justify-center text-center shadow-sm">
                            <Label className="text-[8px] uppercase font-black text-muted-foreground mb-1">Totale Magazzino</Label>
                            <p className="text-lg font-black text-primary leading-tight">
                              {formatDisplayStock(scannedMaterial.currentStockUnits, scannedMaterial.unitOfMeasure)} <span className="text-[10px] opacity-70">{scannedMaterial.unitOfMeasure.toUpperCase()}</span>
                            </p>
                            <p className="text-[9px] font-bold text-muted-foreground mt-1">
                              ({formatDisplayStock(scannedMaterial.currentWeightKg, 'kg')} KG)
                            </p>
                          </div>

                          <div className={cn(
                            "p-3 rounded-2xl border-2 flex flex-col items-center justify-center text-center transition-all shadow-sm",
                            lotAvailability ? "bg-primary border-primary text-primary-foreground shadow-primary/20" : "bg-muted/50 border-dashed border-muted-foreground/30 opacity-70"
                          )}>
                            <Label className={cn("text-[8px] uppercase font-black mb-1", lotAvailability ? "text-primary-foreground/70" : "text-muted-foreground")}>In Uso (LOTTO)</Label>
                            {lotAvailability ? (
                              <>
                                <p className="text-lg font-black leading-tight">
                                  {formatDisplayStock(lotAvailability.available, scannedMaterial.unitOfMeasure)} <span className="text-[10px] opacity-70">{scannedMaterial.unitOfMeasure.toUpperCase()}</span>
                                </p>
                                <p className="text-[9px] font-mono font-bold tracking-tight">{lotAvailability.lotto}</p>
                              </>
                            ) : (
                              <p className="text-[11px] font-black uppercase text-muted-foreground italic">Seleziona Lotto</p>
                            )}
                          </div>
                        </div>

                        {/* Transparency Panel */}
                        {isKgMode && lotAvailability && (
                            <div className="p-4 bg-orange-500/10 border-2 border-orange-500/20 rounded-2xl space-y-3 animate-in slide-in-from-top-4">
                                <div className="flex justify-between items-center text-[10px] uppercase font-black text-orange-800/80">
                                    <span className="flex items-center gap-2"><Info className="h-3 w-3" /> Trasparenza Bilancia</span>
                                    <span>3 Decimali</span>
                                </div>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                    <div className="space-y-1">
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none">Netto Ricalcolato</p>
                                        <p className="text-md font-black">{effectiveNet.toFixed(3)}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none">Tara ({packagingIdValue === 'none' ? '0' : 'Attiva'})</p>
                                        <p className={cn("text-md font-black", isFixedTare ? "text-primary" : "text-orange-600")}>
                                            {isFixedTare && <Lock className="inline-block h-3 w-3 mr-1 mb-1" />}
                                            +{tareWeight.toFixed(3)}
                                        </p>
                                    </div>
                                    <div className="bg-orange-500/10 rounded-xl py-2 space-y-1 border border-orange-500/20">
                                        <p className="text-[9px] font-bold text-orange-800 uppercase leading-none">Lordo (Input)</p>
                                        <p className="text-md font-black text-orange-800">{(Number(form.watch('quantity')) || 0).toFixed(3)}</p>
                                    </div>
                                </div>

                            </div>
                        )}
                      </div>

                      <div className="p-6 space-y-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Boxes className="h-3 w-3" /> Lotti Disponibili (FIFO)
                            </h4>
                            {isLoadingLots && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                          </div>
                          <ScrollArea className="h-36 border-2 rounded-2xl bg-muted/20 border-muted p-1">
                              <div className="grid grid-cols-1 gap-1">
                                  {allLots.length > 0 ? allLots.map(lot => (
                                      <Button 
                                        key={lot.lotto}
                                        type="button"
                                        variant={lot.lotto === lottoValue ? "default" : "ghost"}
                                        className={cn(
                                            "justify-between h-10 px-4 rounded-xl border-transparent",
                                            lot.lotto === lottoValue && "border-primary shadow-md"
                                        )}
                                        onClick={() => {
                                          form.setValue('lotto', lot.lotto);
                                        }}

                                      >
                                          <div className="flex items-center gap-2">
                                              <Barcode className="h-4 w-4 opacity-50" />
                                              <span className="font-mono font-bold text-xs">{lot.lotto}</span>
                                          </div>
                                          <div className="text-xs font-black">
                                              {formatDisplayStock(lot.available, scannedMaterial.unitOfMeasure)}
                                          </div>
                                      </Button>
                                  )) : !isLoadingLots && (
                                      <div className="flex flex-col items-center justify-center h-24 text-center">
                                          <Package className="h-8 w-8 text-muted-foreground/30 mb-2" />
                                          <p className="text-[10px] text-muted-foreground font-bold uppercase">Nessun lotto attivo</p>
                                      </div>
                                  )}
                              </div>
                          </ScrollArea>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name="lotto"
                              render={({ field }) => (
                                <FormItem className="space-y-1">
                                  <FormLabel className="font-black text-[10px] uppercase text-muted-foreground ml-1">Codice Lotto</FormLabel>
                                  <FormControl>
                                      <div className="relative">
                                          <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                          <Input placeholder="Scansiona o digita..." {...field} value={field.value ?? ''} className="font-mono font-black pl-10 h-11 rounded-xl bg-muted/10 border-2" />
                                      </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                                control={form.control}
                                name="packagingId"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="font-black text-[10px] uppercase text-muted-foreground ml-1 flex items-center justify-between">
                                            <span>Tara Imballo / Bobina</span>
                                            {isFixedTare && <Badge variant="outline" className="text-[7px] h-3 px-1 border-primary text-primary font-black"><Lock className="h-2 w-2 mr-0.5" /> CERTIFICATA</Badge>}
                                        </FormLabel>
                                        <Select onValueChange={(val) => field.onChange(val || 'none')} value={field.value || 'none'} disabled={isFixedTare}>
                                            <FormControl>
                                                <SelectTrigger className={cn("h-11 rounded-xl bg-muted/10 border-2 font-bold text-xs", isFixedTare && "bg-primary/5 border-primary/20")}>
                                                    <SelectValue placeholder="Seleziona..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="none" className="text-xs font-bold">Nessuna Tara (0.00 kg)</SelectItem>
                                                {packagingItems.filter(p => !scannedMaterial || (p.associatedTypes && p.associatedTypes.includes(scannedMaterial.type))).map(item => (
                                                    <SelectItem key={item.id} value={item.id} className="text-xs font-bold">{item.name} ({item.weightKg.toFixed(3)} kg)</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />

                        </div>

                        <div className="space-y-4 pt-2">
                             <div className="flex items-center justify-between p-4 border-2 rounded-2xl bg-primary/5 border-primary/10">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-black uppercase tracking-tight">Modalità Sessione</Label>
                                    <p className="text-[10px] text-muted-foreground font-bold uppercase">Apri una sessione per pesate multiple</p>
                                </div>
                                <Switch
                                    checked={useSession}
                                    onCheckedChange={setUseSession}
                                    className="data-[state=checked]:bg-primary"
                                />
                            </div>

                            {scannedMaterial.unitOfMeasure !== 'kg' && (
                                <div className="flex items-center space-x-4 rounded-2xl border-2 p-2 justify-center bg-muted/10 border-muted">
                                    <Label htmlFor="unit-switch" className="text-[10px] font-black uppercase">{scannedMaterial.unitOfMeasure}</Label>
                                    <Switch
                                        id="unit-switch"
                                        checked={inputUnit === 'kg'}
                                        onCheckedChange={(checked) => setInputUnit(checked ? 'kg' : 'primary')}
                                    />
                                    <Label htmlFor="unit-switch" className="text-[10px] font-black uppercase text-orange-600">KG (Bilancia)</Label>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField
                                  control={form.control}
                                  name="jobOrderPF"
                                  render={({ field }) => (
                                    <FormItem className="space-y-1">
                                      <FormLabel className="font-black text-[10px] uppercase text-muted-foreground ml-1">Commessa (Opzionale)</FormLabel>
                                      <FormControl>
                                          <div className="relative">
                                              <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                              <Input placeholder="Es. ODL-2024-..." {...field} value={field.value ?? ''} className="pl-10 h-11 rounded-xl bg-muted/10 border-2" />
                                          </div>
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={form.control}
                                  name="quantity"
                                  render={({ field }) => (
                                    <FormItem className="space-y-1">
                                      <FormLabel className="text-primary font-black uppercase text-[10px] ml-1">
                                        {isKgMode ? 'PESO LORDO (Sulla Bilancia)' : `QUANTITÀ NETTA (${scannedMaterial.unitOfMeasure.toUpperCase()})`}
                                      </FormLabel>
                                      <FormControl>
                                          <div className="relative">
                                              <Weight className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                              <Input 
                                                type="number" 
                                                step="0.001" 
                                                {...field} 
                                                value={field.value ?? ''} 
                                                className="pl-10 h-14 text-2xl font-black font-mono border-2 border-primary/30 rounded-2xl focus:border-primary transition-all shadow-sm" 
                                              />
                                          </div>
                                      </FormControl>
                                      {isKgMode && (
                                          <p className="text-[9px] text-muted-foreground italic font-black uppercase text-right">
                                              L'app considererà una tara di {tareWeight.toFixed(3)}kg
                                          </p>
                                      )}
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                            </div>

                            <FormField
                              control={form.control}
                              name="notes"
                              render={({ field }) => (
                                <FormItem className="space-y-1">
                                  <FormLabel className="font-black text-[10px] uppercase text-muted-foreground ml-1">Note / Causale</FormLabel>
                                  <FormControl><Input placeholder="Es. Sgrido finale o campionatura..." {...field} value={field.value ?? ''} className="h-11 rounded-xl bg-muted/10 border-2" /></FormControl>
                                </FormItem>
                              )}
                            />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-12 text-center space-y-6">
                      <div className="mx-auto w-24 h-24 bg-muted/30 rounded-3xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center animate-pulse">
                          <QrCode className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <div className="space-y-2">
                          <h3 className="text-xl font-black uppercase tracking-tight">Inizia la procedura</h3>
                          <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest max-w-[280px] mx-auto">
                            Scansiona il materiale o inserisci il lotto per sbloccare la registrazione.
                          </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                        <Button type="button" onClick={() => setScanType('material')} className="h-14 rounded-2xl shadow-lg hover:shadow-primary/20 transition-all font-black uppercase text-[10px] tracking-widest">
                          <QrCode className="mr-2 h-5 w-5" /> Materiale
                        </Button>
                        <Button type="button" onClick={() => setScanType('lotto')} className="h-14 rounded-2xl shadow-lg border-2 font-black uppercase text-[10px] tracking-widest" variant="secondary">
                          <Barcode className="mr-2 h-5 w-5" /> Lotto
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
                
                {scannedMaterial && (
                    <CardFooter className="p-6 bg-muted/10 border-t flex flex-col gap-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                            <Button 
                                type="submit" 
                                disabled={isSubmitting} 
                                className="w-full h-16 text-xl font-black uppercase tracking-tighter rounded-2xl shadow-xl shadow-primary/20"
                            >
                                {isSubmitting ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : (useSession ? <PlayCircle className="mr-2 h-6 w-6" /> : <Send className="mr-2 h-6 w-6" />)}
                                {useSession ? 'Avvia Sessione' : 'Registra Scarico'}
                            </Button>
                            
                            {!useSession && lotAvailability && (
                                <Button 
                                    type="button" 
                                    variant="destructive"
                                    onClick={() => onSubmit(form.getValues(), true)}
                                    disabled={isSubmitting}
                                    className="w-full h-16 text-xl font-black uppercase tracking-tighter rounded-2xl border-2 border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive hover:text-white"
                                >
                                    <X className="mr-2 h-6 w-6" /> Materiale Finito
                                </Button>
                            )}
                        </div>
                        <Button type="button" variant="ghost" onClick={resetFlow} className="text-muted-foreground uppercase font-black text-xs h-10 w-full rounded-xl">
                            Annulla tutto
                        </Button>
                    </CardFooter>
                )}
              </Card>
            </form>
          </Form>

          {activeSessions.filter(s => s.originatorJobId === null).length > 0 && (
              <div className="space-y-6 pt-10">
                  <h3 className="font-black text-xl uppercase tracking-tighter flex items-center gap-3">
                    <Info className="h-6 w-6 text-primary" /> Sessioni Manuali Attive
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {activeSessions.filter(s => s.originatorJobId === null).map((s, idx) => (
                          <Card key={idx} className="border-2 border-primary/20 bg-primary/5 rounded-3xl overflow-hidden group shadow-md hover:shadow-lg transition-all">
                              <CardHeader className="py-4 bg-muted/20 border-b">
                                  <div className="flex justify-between items-start">
                                      <div>
                                          <CardTitle className="text-xl font-black tracking-tighter leading-none">{s.materialCode}</CardTitle>
                                          <CardDescription className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mt-1">Lotto: {s.lotto || 'N/D'}</CardDescription>
                                      </div>
                                      <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary font-black text-[10px]">{s.category}</Badge>
                                  </div>
                              </CardHeader>
                              <CardContent className="py-4">
                                  <div className="flex justify-between text-xs font-bold uppercase">
                                      <span className="text-muted-foreground">Iniziata con</span>
                                      <span className="text-primary">{formatDisplayStock(s.netOpeningWeight, 'kg')} KG</span>
                                  </div>
                              </CardContent>
                              <CardFooter className="py-4 border-t bg-background">
                                  <Button 
                                    variant="destructive" 
                                    size="lg" 
                                    className="w-full font-black uppercase tracking-tight rounded-xl h-12"
                                    onClick={() => {
                                        // Lasciamo che la SessionBar gestisca la chiusura via UI premium
                                        // ma apriamo il trigger
                                        const event = new CustomEvent('close-material-session', { detail: s });
                                        window.dispatchEvent(event);
                                        toast({ title: "Chiusura in corso", description: "Completa i dati nella barra delle sessioni attive." });
                                    }}
                                  >
                                      <Package className="mr-2 h-4 w-4" /> Chiudi Sessione
                                  </Button>
                              </CardFooter>
                          </Card>
                      ))}
                  </div>
              </div>
          )}
        </div>

        <Dialog open={!!scanType} onOpenChange={(open) => !open && setScanType(null)}>
          {renderScanView()}
        </Dialog>

      </AppShell>
    </AuthGuard>
  );
}
