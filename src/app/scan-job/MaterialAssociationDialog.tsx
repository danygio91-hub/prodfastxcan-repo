
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';

import type { JobOrder, JobPhase, RawMaterial, ActiveMaterialSessionData, RawMaterialType, Packaging, MaterialConsumption } from '@/types';
import { findLastWeightForLotto, logTubiGuainaWithdrawal, getRawMaterialByCode, startMaterialSessionInJob } from './actions';
import { getPackagingItems } from '../inventory/actions';
import { getLotInfoForMaterial, type LotInfo } from '../admin/raw-material-management/actions';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { QrCode, Loader2, Weight, Archive, Send, Barcode, Play, Camera, AlertTriangle, Boxes, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { formatDisplayStock } from '@/lib/utils';

const formSchema = z.object({
  material: z.custom<RawMaterial>().nullable(),
  lotto: z.string().optional(),
  ddt: z.string().optional(),
  openingWeightManual: z.coerce.number().min(0, "Il peso non può essere negativo.").optional(),
  quantityToWithdraw: z.coerce.number().optional(),
  packagingId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;
type ScanType = 'material' | 'lotto' | null;

interface MaterialAssociationDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  phase: JobPhase;
  job: JobOrder | null;
  onSessionStart: (sessionData: Omit<ActiveMaterialSessionData, 'category'>, type: RawMaterialType) => void;
  onWithdrawalComplete: () => void;
}

export default function MaterialAssociationDialog({
  isOpen,
  onOpenChange,
  phase,
  job,
  onSessionStart,
  onWithdrawalComplete,
}: MaterialAssociationDialogProps) {
  const { toast } = useToast();
  const { operator } = useAuth();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanType, setScanType] = useState<ScanType>(null);
  const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const [lotAvailability, setLotAvailability] = useState<LotInfo | null>(null);
  const [availableBatches, setAvailableBatches] = useState<any[]>([]);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(!!scanType, videoRef);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      material: null,
      lotto: "",
      ddt: "",
      openingWeightManual: undefined,
      quantityToWithdraw: undefined,
      packagingId: 'none'
    },
  });

  const selectedMaterial = form.watch('material');
  const lottoValue = form.watch('lotto');

  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
  }, []);

  const handleMaterialSelect = useCallback((material: RawMaterial) => {
    form.setValue('material', material);
  }, [form]);

  const updateLotInfo = useCallback(async (materialId: string, lotto: string) => {
      const lots = await getLotInfoForMaterial(materialId);
      const matched = lots.find(l => l.lotto === lotto);
      setLotAvailability(matched || null);
  }, []);

  const handleLotSelect = useCallback(async (lotto: string) => {
    if (!selectedMaterial) return;
    form.setValue('lotto', lotto);
    
    setIsProcessing(true);
    try {
        const lottoData = await findLastWeightForLotto(selectedMaterial.id, lotto);
        const lots = await getLotInfoForMaterial(selectedMaterial.id);
        const matched = lots.find(l => l.lotto === lotto);
        setLotAvailability(matched || null);
        
        if (lottoData && lottoData.material) {
            form.setValue('openingWeightManual', lottoData.netWeight);
            form.setValue('ddt', 'Storico Lotto');
            form.setValue('packagingId', lottoData.packagingId || 'none');
        } else {
            const batch = selectedMaterial.batches?.find(b => b.lotto === lotto);
            if (batch) {
                form.setValue('openingWeightManual', batch.netQuantity);
                form.setValue('ddt', batch.ddt || '');
                form.setValue('packagingId', batch.packagingId || 'none');
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsProcessing(false);
    }
  }, [selectedMaterial, form]);

  useEffect(() => {
    if (selectedMaterial) {
      setInputUnit('primary');
      const batches = [...(selectedMaterial.batches || [])].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setAvailableBatches(batches);
      
      const currentLotto = form.getValues('lotto');
      if (!currentLotto && batches.length > 0) {
          const oldestLotto = batches.find(b => (b.netQuantity || 0) > 0) || batches[0];
          handleLotSelect(oldestLotto.lotto || '');
      }
    } else {
        setAvailableBatches([]);
    }
  }, [selectedMaterial, form, handleLotSelect]);

  useEffect(() => {
    if (lottoValue && lottoValue.length >= 3 && selectedMaterial) {
        const timer = setTimeout(async () => {
            await updateLotInfo(selectedMaterial.id, lottoValue);
        }, 800);
        return () => clearTimeout(timer);
    } else if (!lottoValue) {
        setLotAvailability(null);
    }
  }, [lottoValue, selectedMaterial, updateLotInfo]);
  
  const handleScanTrigger = (type: ScanType) => {
    setScanType(type);
  };

  const triggerScan = async () => {
    if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
      toast({ variant: 'destructive', title: 'Fotocamera non pronta.' });
      return;
    }
    if (!('BarcodeDetector' in window)) {
        toast({ variant: 'destructive', title: 'Funzionalità non supportata.' });
        return;
    }

    setIsProcessing(true);
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
        setIsProcessing(false);
    }
  };

  const handleScan = useCallback(async (scannedValue: string) => {
    if (scanType === 'material') {
      const materialResult = await getRawMaterialByCode(scannedValue);
      if ('error' in materialResult) {
        toast({ variant: 'destructive', title: materialResult.title, description: materialResult.error });
      } else {
        handleMaterialSelect(materialResult);
      }
    } else if (scanType === 'lotto') {
      const lottoData = await findLastWeightForLotto(selectedMaterial?.id, scannedValue);
      if (lottoData?.material) {
        handleMaterialSelect(lottoData.material);
        form.setValue('lotto', scannedValue);
        form.setValue('openingWeightManual', lottoData.netWeight);
        form.setValue('ddt', 'Storico Lotto');
        form.setValue('packagingId', lottoData.packagingId || 'none');
        await updateLotInfo(lottoData.material.id, scannedValue);
      } else {
        form.setValue('lotto', scannedValue);
        toast({ title: 'Lotto Nuovo', description: 'Nessuno storico trovato. Inserire il peso manualmente.' });
      }
    }
    setScanType(null); 
  }, [scanType, form, toast, selectedMaterial, updateLotInfo]);

  const onAvviaSessione = async () => {
    const values = form.getValues();
    if (!selectedMaterial || !job || !operator) return;

    const openingWeight = values.openingWeightManual;
    if (openingWeight === undefined || openingWeight === null) {
        toast({ variant: 'destructive', title: 'Peso Mancante', description: 'Inserire il peso di apertura.' });
        return;
    }

    setIsProcessing(true);
    const selectedPackaging = packagingItems.find(p => p.id === values.packagingId);

    let associatedJobsForSession: { jobId: string; jobOrderPF: string }[] = [];
    if (job.id.startsWith('group-') && job.jobOrderIds && job.jobOrderPFs) {
        associatedJobsForSession = job.jobOrderIds.map((id, index) => ({
            jobId: id,
            jobOrderPF: job.jobOrderPFs![index]
        }));
    } else {
        associatedJobsForSession = [{ jobId: job.id, jobOrderPF: job.ordinePF }];
    }

    const consumption: MaterialConsumption = {
        materialId: selectedMaterial.id,
        materialCode: selectedMaterial.code,
        grossOpeningWeight: openingWeight + (selectedPackaging?.weightKg || 0),
        netOpeningWeight: openingWeight,
        lottoBobina: values.lotto || '',
        packagingId: values.packagingId || 'none',
        tareWeight: selectedPackaging?.weightKg || 0,
    };

    const registerResult = await startMaterialSessionInJob(job.id, phase.id, consumption);

    if (registerResult.success) {
        onSessionStart({
            materialId: selectedMaterial.id,
            materialCode: selectedMaterial.code,
            grossOpeningWeight: consumption.grossOpeningWeight!,
            netOpeningWeight: consumption.netOpeningWeight!,
            originatorJobId: job.id,
            associatedJobs: associatedJobsForSession,
            packagingId: consumption.packagingId,
            tareWeight: consumption.tareWeight,
            lotto: consumption.lottoBobina,
        }, selectedMaterial.type);
    } else {
        toast({ variant: 'destructive', title: 'Errore', description: registerResult.message });
    }
    setIsProcessing(false);
  };
  
  const onPrelevaMateriale = async (values: FormValues) => {
      if (!selectedMaterial || !job || !operator || !values.quantityToWithdraw) return;
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('materialId', selectedMaterial.id);
      formData.append('operatorId', operator.id);
      formData.append('jobId', job.id);
      formData.append('jobOrderPF', job.ordinePF);
      formData.append('phaseId', phase.id);
      formData.append('quantity', String(values.quantityToWithdraw));
      formData.append('unit', inputUnit === 'kg' ? 'kg' : selectedMaterial.unitOfMeasure);
      formData.append('lotto', values.lotto || '');
      
      const result = await logTubiGuainaWithdrawal(formData);
      toast({
          title: result.success ? 'Prelievo Registrato' : 'Errore',
          description: result.message,
          variant: result.success ? 'default' : 'destructive',
      });
      if (result.success) {
          onWithdrawalComplete();
      }
      setIsProcessing(false);
  };
  
  const renderScanView = () => (
    <div>
        <div className="relative grid place-items-center aspect-video bg-black rounded-lg overflow-hidden my-4">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            {hasPermission === false && (
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
            <Button onClick={triggerScan} disabled={isProcessing || !hasPermission} className="w-full h-12">
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin"/> : <Camera className="mr-2 h-4 w-4" />}
                Scansiona Ora
            </Button>
             <Button variant="outline" onClick={() => setScanType(null)}>Indietro</Button>
        </div>
    </div>
  );

  const renderForm = () => {
    const isBobina = (phase.name.toUpperCase().includes("TRECCIA") || phase.name.toUpperCase().includes("CORDA") || selectedMaterial?.type === 'BOB' || selectedMaterial?.type === 'PF3V0') && selectedMaterial?.unitOfMeasure !== 'n';

    return (
     <Form {...form}>
        <form className="h-full flex flex-col overflow-hidden" onSubmit={(e) => e.preventDefault()}>
          <ScrollArea className="flex-1 px-6 py-2">
            <div className="space-y-4">
              {selectedMaterial ? (
                  <div className="p-4 border rounded-lg bg-muted/50 border-primary/20 space-y-4">
                      <div className="text-center">
                        <p className="font-black text-xl tracking-tight">{selectedMaterial.code}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{selectedMaterial.description}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-md bg-background border flex flex-col items-center justify-center text-center">
                            <Label className="text-[8px] uppercase font-black text-muted-foreground">Totale Magazzino</Label>
                            <p className="text-sm font-black text-primary leading-tight">
                                {formatDisplayStock(selectedMaterial.currentStockUnits, selectedMaterial.unitOfMeasure)} {selectedMaterial.unitOfMeasure.toUpperCase()}
                            </p>
                            <p className="text-[9px] font-bold text-muted-foreground">
                                ({formatDisplayStock(selectedMaterial.currentWeightKg, 'kg')} KG)
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
                                        {formatDisplayStock(lotAvailability.available, selectedMaterial.unitOfMeasure)} {selectedMaterial.unitOfMeasure.toUpperCase()}
                                    </p>
                                    <p className="text-[9px] font-bold text-primary/70">Lotto: {lotAvailability.lotto}</p>
                                </>
                            ) : (
                                <p className="text-[10px] font-bold text-muted-foreground italic">Nessun Lotto</p>
                            )}
                        </div>
                      </div>
                  </div>
              ) : <Alert><AlertDescription>Scansiona un materiale o un lotto per iniziare.</AlertDescription></Alert>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button type="button" onClick={() => handleScanTrigger('material')} className="w-full h-12">
                      <QrCode className="mr-2 h-4 w-4" /> Materiale
                  </Button>
                   <Button type="button" onClick={() => handleScanTrigger('lotto')} className="w-full h-12" variant="secondary">
                      <Barcode className="mr-2 h-4 w-4" /> Lotto
                  </Button>
              </div>
              
              {selectedMaterial && (
                <div className="space-y-4">
                    <FormField control={form.control} name="lotto" render={({field}) => (
                        <FormItem>
                            <FormLabel className="font-bold text-xs uppercase text-muted-foreground">Numero Lotto Scansionato</FormLabel>
                            <FormControl><Input {...field} value={field.value ?? ''} placeholder="Scansiona o digita il lotto" className="font-mono font-bold border-primary/30" /></FormControl>
                        </FormItem>
                    )}/>

                    {availableBatches.length > 0 && (
                        <div className="space-y-2">
                            <Label className="font-bold text-[10px] uppercase text-muted-foreground flex items-center gap-2">
                                <Boxes className="h-3 w-3" /> Lotti Disponibili a Sistema ({availableBatches.length})
                            </Label>
                            <ScrollArea className="h-24 border rounded-md p-1 bg-muted/20">
                                <div className="grid grid-cols-1 gap-1">
                                    {availableBatches.map((b, idx) => {
                                        const isOldest = idx === 0 && (b.netQuantity || 0) > 0;
                                        const isSelected = lottoValue === b.lotto;
                                        return (
                                            <Button 
                                                key={b.id || b.lotto || idx}
                                                type="button"
                                                variant={isSelected ? "default" : "outline"}
                                                size="sm"
                                                className={cn(
                                                    "justify-between text-[11px] h-8 font-bold",
                                                    isOldest && !isSelected && "border-green-500/50 bg-green-500/5 text-green-700"
                                                )}
                                                onClick={() => handleLotSelect(b.lotto || '')}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Barcode className="h-3 w-3 opacity-50" />
                                                    {b.lotto || 'Senza Lotto'}
                                                    {isOldest && <Badge className="text-[8px] h-3 px-1 bg-green-500 hover:bg-green-600">CONSIGLIATO</Badge>}
                                                </div>
                                                <div className="text-[10px] opacity-70">
                                                    {formatDisplayStock(b.netQuantity, selectedMaterial.unitOfMeasure)}
                                                </div>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                            <p className="text-[9px] text-muted-foreground italic flex items-center gap-1">
                                <Info className="h-3 w-3" /> Clicca su un lotto per caricarne i dati (peso, ddt, etc.)
                            </p>
                        </div>
                    )}

                    {lotAvailability && (
                        <Alert className="bg-green-500/10 border-green-500/30 py-2 animate-in fade-in slide-in-from-top-1">
                            <div className="flex items-center gap-3">
                                <Boxes className="h-5 w-5 text-green-600" />
                                <div>
                                    <AlertTitle className="text-xs font-bold text-green-700 uppercase">Lotto {lotAvailability.lotto} Riconosciuto</AlertTitle>
                                    <AlertDescription className="text-sm font-black text-green-600">
                                        Disponibilità: {formatDisplayStock(lotAvailability.available, selectedMaterial.unitOfMeasure)} {selectedMaterial.unitOfMeasure.toUpperCase()}
                                    </AlertDescription>
                                </div>
                            </div>
                        </Alert>
                    )}

                    <FormField control={form.control} name="ddt" render={({field}) => (
                        <FormItem>
                            <FormLabel className="font-bold text-xs uppercase text-muted-foreground">DDT / Origine</FormLabel>
                            <FormControl><Input {...field} value={field.value ?? ''} className="text-xs h-8" /></FormControl>
                        </FormItem>
                    )}/>

                    <div className="space-y-4 border-t pt-4">
                        {isBobina ? (
                            <FormField control={form.control} name="openingWeightManual" render={({field}) => (
                                <FormItem>
                                    <FormLabel className="text-primary font-black uppercase text-xs">Quantità Iniziale ({selectedMaterial.unitOfMeasure === 'kg' ? 'PESO ' : ''}NETTO {selectedMaterial.unitOfMeasure.toUpperCase()})</FormLabel>
                                    <FormControl>
                                        <Input 
                                            type="number"
                                            step="any"
                                            className="bg-background font-mono text-xl font-black h-12 border-2 border-primary/30" 
                                            {...field}
                                            value={field.value ?? ''}
                                        />
                                    </FormControl>
                                    <p className="text-[10px] text-muted-foreground italic">Inserire il peso netto attuale del rocchetto prima di iniziare.</p>
                                </FormItem>
                            )}/>
                        ) : (
                            <>
                                <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center bg-muted/20">
                                    <Label htmlFor="unit-switch-assoc" className="text-xs font-bold">{selectedMaterial.unitOfMeasure.toUpperCase()}</Label>
                                    <Switch
                                        id="unit-switch-assoc"
                                        checked={inputUnit === 'kg'}
                                        onCheckedChange={(checked) => setInputUnit(checked ? 'kg' : 'primary')}
                                    />
                                    <Label htmlFor="unit-switch-assoc" className="text-xs font-bold">KG</Label>
                                </div>
                                <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                                    <FormItem>
                                        <FormLabel className="text-primary font-black uppercase text-xs">Quantità da prelevare ({inputUnit === 'primary' ? selectedMaterial.unitOfMeasure.toUpperCase() : 'KG'})</FormLabel>
                                        <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} className="font-mono text-lg font-bold" /></FormControl>
                                        <FormMessage/>
                                    </FormItem>
                                )}/>
                            </>
                        )}

                        {isBobina && (
                            <FormField control={form.control} name="packagingId" render={({field}) => (
                                <FormItem>
                                    <FormLabel className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground"><Archive className="h-3 w-3" />Tara Imballo Applicata</FormLabel>
                                    <Select onValueChange={(val) => field.onChange(val || 'none')} value={field.value || 'none'}>
                                        <FormControl><SelectTrigger className="text-xs h-8"><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">Nessuna Tara (0.00 kg)</SelectItem>
                                            {packagingItems.filter(p => !selectedMaterial || (p.associatedTypes && p.associatedTypes.includes(selectedMaterial.type))).map(item => (
                                                <SelectItem key={item.id} value={item.id} className="text-xs">{item.name} ({item.weightKg.toFixed(3)} kg)</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )} />
                        )}
                    </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="flex-col sm:flex-col gap-2 p-6 pt-4 border-t sticky bottom-0 bg-background">
              {isBobina ? (
                <Button type="button" onClick={onAvviaSessione} disabled={!selectedMaterial || isProcessing} className="w-full h-14 text-lg font-black uppercase tracking-tighter">
                    {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Play className="mr-2 h-5 w-5 fill-current" />} 
                    Avvia Sessione Bobina
                </Button>
              ) : (
                <Button type="button" onClick={form.handleSubmit(onPrelevaMateriale)} disabled={!selectedMaterial || isProcessing || !form.watch('quantityToWithdraw')} className="w-full h-14 text-lg font-black uppercase tracking-tighter">
                    {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Send className="mr-2 h-5 w-5" />}
                    Registra Scarico
                </Button>
              )}
          </DialogFooter>
        </form>
      </Form>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2 border-b bg-muted/10">
          <DialogTitle className="text-lg font-bold">Associa Materiale: {phase.name}</DialogTitle>
        </DialogHeader>
        {scanType ? <div className="p-6 pt-0">{renderScanView()}</div> : renderForm()}
      </DialogContent>
    </Dialog>
  );
}
