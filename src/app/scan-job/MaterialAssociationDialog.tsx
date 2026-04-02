
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';

import type { JobOrder, JobPhase, RawMaterial, ActiveMaterialSessionData, RawMaterialType, Packaging, MaterialConsumption, IndependentMaterialSession } from '@/types';
import { findLastWeightForLotto, logTubiGuainaWithdrawal, getRawMaterialByCode, markPhaseMaterialReady } from './actions';
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
import { QrCode, Loader2, Weight, Archive, Send, Barcode, Play, Camera, AlertTriangle, Boxes, Info, X, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { formatDisplayStock } from '@/lib/utils';
import { useBatchSelection } from '@/hooks/useBatchSelection';


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
  onSessionStart: (sessionData: Omit<IndependentMaterialSession, 'id' | 'startedAt' | 'status' | 'operatorId' | 'operatorName'>, type: RawMaterialType) => Promise<any>;
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
  const [isCapturing, setIsCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [scanType, setScanType] = useState<ScanType>(null);
  const [inputUnit, setInputUnit] = useState<'primary' | 'kg'>('primary');
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
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
  const isBobina = useMemo(() => (phase.name.toUpperCase().includes("TRECCIA") || phase.name.toUpperCase().includes("CORDA") || selectedMaterial?.type === 'BOB' || selectedMaterial?.type === 'PF3V0') && selectedMaterial?.unitOfMeasure !== 'n', [phase.name, selectedMaterial]);

  const {
      isLoading: isLoadingMetadata,
      lotAvailability,
      isFixedTare,
      calculatedNet,
      batchMetadata
  } = useBatchSelection({
      form,
      materialId: selectedMaterial?.id,
      quantityFieldName: isBobina ? 'openingWeightManual' : 'quantityToWithdraw',
      packagingFieldName: 'packagingId'
  });

  const isKgMode = selectedMaterial?.unitOfMeasure === 'kg' || inputUnit === 'kg';
  const effectiveNet = (calculatedNet > 0) ? calculatedNet : (lotAvailability?.available || 0);

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

    setIsCapturing(true);
    try {
        const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
        const barcodes = await barcodeDetector.detect(videoRef.current);
        if (barcodes.length > 0) {
            setFlash(true);
            setTimeout(() => setFlash(false), 500);
            await handleScan(barcodes[0].rawValue);
        } else {
            toast({ variant: 'destructive', title: 'Nessun codice trovato.', description: 'Inquadra meglio il QR.' });
        }
    } catch (error) {
        toast({ variant: 'destructive', title: 'Errore durante la scansione.' });
    } finally {
        setIsCapturing(false);
    }
  };

  const handleScan = useCallback(async (scannedValue: string) => {
    if (scanType === 'material') {
      const materialResult = await getRawMaterialByCode(scannedValue);
      if ('error' in materialResult) {
        toast({ variant: 'destructive', title: materialResult.title, description: materialResult.error });
      } else {
         form.setValue('material', materialResult);
      }
    } else if (scanType === 'lotto') {
        const lottoData = await findLastWeightForLotto(selectedMaterial?.id, scannedValue.trim());
        if (lottoData?.material) {
            form.setValue('material', lottoData.material);
            form.setValue('lotto', scannedValue.trim());
            toast({ title: "Lotto Riconosciuto", description: `Materiale: ${lottoData.material.code}, Lotto: ${scannedValue.trim()}` });
        } else {
            form.setValue('lotto', scannedValue.trim());
            toast({ title: 'Lotto Nuovo', description: 'Nessuno storico trovato per questo lotto.' });
        }
    }

    setScanType(null); 
  }, [scanType, form, toast]);


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

    let linkedJobOrderIds: string[] = [];
    if (job.id.startsWith('group-') && job.jobOrderIds) {
        linkedJobOrderIds = job.jobOrderIds;
    } else {
        linkedJobOrderIds = [job.id];
    }

    const openingGross = openingWeight;
    const tare = selectedPackaging?.weightKg || 0;
    const openingNet = Math.max(0, openingGross - tare);

    const consumption: MaterialConsumption = {
        materialId: selectedMaterial.id,
        materialCode: selectedMaterial.code,
        grossOpeningWeight: openingGross,
        netOpeningWeight: openingNet,
        lottoBobina: values.lotto || '',
        packagingId: values.packagingId || 'none',
        tareWeight: tare,
    };

    const registerResult = await markPhaseMaterialReady(job.id, phase.id, { 
        materialCode: selectedMaterial.code, 
        lotto: values.lotto 
    });
    
    if (registerResult.success) {
    const openingGross = openingWeight;
    const tare = selectedPackaging?.weightKg || 0;
    const openingNet = Math.max(0, openingGross - tare);

    const sessionResult = await onSessionStart({
        materialId: selectedMaterial.id,
        materialCode: selectedMaterial.code,
        lotto: values.lotto || null,
        linkedJobOrderIds: linkedJobOrderIds,
        grossOpeningWeight: openingGross,
        netOpeningWeight: openingNet,
        packagingId: values.packagingId,
        tareWeight: tare,
    }, selectedMaterial.type);
        
        if (sessionResult.success) {
            toast({ title: "Sessione Indipendente Avviata", description: "La bobina è ora attiva e condivisa." });
            onOpenChange(false);
        } else {
            toast({ variant: 'destructive', title: 'Errore Sessione', description: sessionResult.message });
        }
    } else {
        toast({ variant: 'destructive', title: 'Errore', description: registerResult.message });
    }
    setIsProcessing(false);
  };
    const onPrelevaMateriale = async (values: FormValues, isFinished: boolean = false) => {
      if (!selectedMaterial || !job || !operator || (!values.quantityToWithdraw && !isFinished)) return;
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('materialId', selectedMaterial.id);
      formData.append('operatorId', operator.id);
      formData.append('jobId', job.id);
      formData.append('jobOrderPF', job.ordinePF);
      formData.append('phaseId', phase.id);
      formData.append('quantity', String(isKgMode ? effectiveNet : (values.quantityToWithdraw || 0)));
      formData.append('unit', isKgMode ? 'kg' : selectedMaterial.unitOfMeasure);
      formData.append('lotto', values.lotto || '');
      
      const result = await logTubiGuainaWithdrawal(formData, isFinished);
      toast({
          title: result.success ? (isFinished ? 'Materiale Finito' : 'Prelievo Registrato') : 'Errore',
          description: result.message,
          variant: result.success ? 'default' : 'destructive',
      });
      if (result.success) {
          onWithdrawalComplete();
      }
      setIsProcessing(false);
  };
  
  const renderScanView = () => (
    <div className="animate-in fade-in zoom-in-95 duration-300">
        <div className="relative aspect-video bg-black rounded-2xl overflow-hidden my-4 border-4 border-slate-700 shadow-inner group">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            
            {/* Flash Effect */}
            <div className={cn(
                "absolute inset-0 bg-green-500/40 transition-opacity duration-300 pointer-events-none",
                flash ? "opacity-100" : "opacity-0"
            )} />

            {hasPermission === false && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                    <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                    <p className="text-white font-semibold">Accesso Fotocamera Negato</p>
                </div>
            )}

            {/* SPARA BUTTON Overlay */}
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Button 
                    onClick={triggerScan}
                    disabled={isCapturing || !hasPermission}
                    className="h-16 w-16 rounded-full bg-white/20 hover:bg-white/40 border-4 border-white shadow-2xl transition-all active:scale-90"
                >
                    <div className="h-10 w-10 rounded-full bg-red-600 group-hover:bg-red-500 shadow-inner" />
                </Button>
            </div>
            <div className="absolute bottom-2 w-full text-center">
                <span className="text-[10px] font-black uppercase text-white shadow-black drop-shadow-md">Tasto SPARA</span>
            </div>
        </div>
        <div className="flex flex-col gap-2">
             <Button variant="outline" onClick={() => setScanType(null)} className="w-full h-12 border-slate-700 text-slate-300 uppercase font-bold text-[10px] tracking-widest">
                 Indietro
             </Button>
        </div>
    </div>
  );

  const renderForm = () => {
    const selectedPackaging = packagingItems.find(p => p.id === form.watch('packagingId'));
    const tare = selectedPackaging?.weightKg || 0;
    const expectedGross = effectiveNet + tare;


    return (
     <Form {...form}>
        <form className="h-full flex flex-col overflow-hidden" onSubmit={(e) => e.preventDefault()}>
          <ScrollArea className="flex-1 px-6 py-2">
            <div className="space-y-4">
              {selectedMaterial ? (
                  <div className="space-y-3">
                      <div className="p-4 border rounded-xl bg-muted/50 border-primary/20 space-y-3">
                          <div className="text-center">
                            <p className="font-black text-xl tracking-tight leading-none mb-1">{selectedMaterial.code}</p>
                            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest">{selectedMaterial.description}</p>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded-lg bg-background border flex flex-col items-center justify-center text-center shadow-sm">
                                <Label className="text-[8px] uppercase font-black text-muted-foreground mb-1">Totale Magazzino</Label>
                                <p className="text-sm font-black text-primary leading-tight">
                                    {formatDisplayStock(selectedMaterial.currentStockUnits, selectedMaterial.unitOfMeasure)} {selectedMaterial.unitOfMeasure.toUpperCase()}
                                </p>
                                <p className="text-[9px] font-bold text-muted-foreground">
                                    ({formatDisplayStock(selectedMaterial.currentWeightKg, 'kg')} KG)
                                </p>
                            </div>

                            <div className={cn(
                                "p-2 rounded-lg border flex flex-col items-center justify-center text-center transition-all shadow-sm",
                                lotAvailability ? "bg-primary/10 border-primary/40" : "bg-muted border-dashed opacity-50"
                            )}>
                                <Label className="text-[8px] uppercase font-black text-muted-foreground mb-1">In Uso (Lotto)</Label>
                                {lotAvailability ? (
                                    <>
                                        <p className="text-sm font-black text-primary leading-tight">
                                            {formatDisplayStock(lotAvailability.available, selectedMaterial.unitOfMeasure)} {selectedMaterial.unitOfMeasure.toUpperCase()}
                                        </p>
                                        <p className="text-[9px] font-bold text-primary/70">{lotAvailability.lotto}</p>
                                    </>
                                ) : (
                                    <p className="text-[10px] font-bold text-muted-foreground italic">Seleziona Lotto</p>
                                )}
                            </div>
                          </div>
                      </div>

                       {/* Ferrous Rule 1: Transparency Panel for KG */}
                      {isKgMode && lotAvailability && (
                          <div className="p-3 border-2 border-orange-500/20 bg-orange-500/5 rounded-xl space-y-2 animate-in slide-in-from-top-2">
                              <div className="flex justify-between items-center text-[10px] uppercase font-black text-orange-700/70 mb-1">
                                  <span>Trasparenza Peso (KG)</span>
                                  <Info className="h-3 w-3" />
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                  <div>
                                      <p className="text-[8px] font-bold text-muted-foreground uppercase leading-none mb-1">Netto</p>
                                      <p className="text-xs font-black">{effectiveNet.toFixed(3)}</p>
                                  </div>
                                  <div>
                                      <p className="text-[8px] font-bold text-muted-foreground uppercase leading-none mb-1">Tara</p>
                                      <p className={cn("text-xs font-black", isFixedTare ? "text-primary" : "text-orange-600")}>
                                          {isFixedTare && <Lock className="inline-block h-2 w-2 mr-0.5 mb-0.5" />}
                                          +{tare.toFixed(3)}
                                      </p>
                                  </div>
                                  <div className="bg-orange-500/10 rounded py-1">
                                      <p className="text-[8px] font-bold text-orange-700 uppercase leading-none mb-1">Lordo (Input)</p>
                                      <p className="text-xs font-black text-orange-700">{(Number(form.watch(isBobina ? 'openingWeightManual' : 'quantityToWithdraw')) || 0).toFixed(3)}</p>
                                  </div>
                              </div>
                          </div>
                      )}

                  </div>
              ) : <Alert className="border-primary/20 bg-primary/5 text-primary"><AlertDescription className="font-bold text-xs uppercase">Scansiona un materiale o un lotto per iniziare.</AlertDescription></Alert>}

              <div className="grid grid-cols-2 gap-2">
                  <Button type="button" onClick={() => handleScanTrigger('material')} className="h-10 text-[10px] uppercase font-black tracking-widest">
                      <QrCode className="mr-2 h-3 w-3" /> Materiale
                  </Button>
                   <Button type="button" onClick={() => handleScanTrigger('lotto')} className="h-10 text-[10px] uppercase font-black tracking-widest" variant="secondary">
                      <Barcode className="mr-2 h-3 w-3" /> Lotto
                  </Button>
              </div>
              
              {selectedMaterial && (
                <div className="space-y-4">
                    <FormField control={form.control} name="lotto" render={({field}) => (
                        <FormItem className="space-y-1">
                            <FormLabel className="font-black text-[10px] uppercase text-muted-foreground tracking-wider">Numero Lotto Attezzato</FormLabel>
                            <FormControl><Input {...field} value={field.value ?? ''} placeholder="Scansiona o digita..." className="font-mono font-bold text-sm h-9 border-primary/30" /></FormControl>
                        </FormItem>
                    )}/>

                    {availableBatches.length > 0 && (
                        <div className="space-y-2">
                            <Label className="font-black text-[9px] uppercase text-muted-foreground flex items-center gap-2">
                                <Boxes className="h-3 w-3" /> Lotti Disponibili ({availableBatches.length})
                            </Label>
                            <ScrollArea className="h-28 border-2 rounded-xl p-1 bg-muted/30 border-muted">
                                <div className="grid grid-cols-1 gap-1">
                                    {availableBatches.map((b, idx) => {
                                        const isOldest = idx === 0 && (b.netQuantity || 0) > 0;
                                        const isSelected = lottoValue === b.lotto;
                                        return (
                                            <Button 
                                                key={b.id || b.lotto || idx}
                                                type="button"
                                                variant={isSelected ? "default" : "ghost"}
                                                size="sm"
                                                className={cn(
                                                    "justify-between text-[11px] h-9 font-black px-3 rounded-lg border",
                                                    isSelected ? "border-primary" : "border-transparent hover:bg-primary/5",
                                                    isOldest && !isSelected && "border-green-500/20 bg-green-500/5 text-green-700"
                                                )}
                                                onClick={() => form.setValue('lotto', b.lotto || '')}

                                            >
                                                <div className="flex items-center gap-2">
                                                    <Barcode className="h-3 w-3 opacity-50" />
                                                    {b.lotto || 'Senza Lotto'}
                                                    {isOldest && <Badge className="text-[7px] h-3 px-1 bg-green-500 font-black">FIFO</Badge>}
                                                </div>
                                                <div className="text-[10px] font-mono opacity-80">
                                                    {formatDisplayStock(b.netQuantity, selectedMaterial.unitOfMeasure)}
                                                </div>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 border-t pt-4">
                         <FormField control={form.control} name="packagingId" render={({field}) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground flex items-center justify-between">
                                    <span>Applica Tara Bobina</span>
                                    {isFixedTare && <Badge variant="outline" className="text-[7px] h-3 px-1 border-primary text-primary font-black"><Lock className="h-2 w-2 mr-0.5" /> CERTIFICATA</Badge>}
                                </FormLabel>
                                <Select onValueChange={(val) => field.onChange(val || 'none')} value={field.value || 'none'} disabled={isFixedTare}>
                                    <FormControl><SelectTrigger className={cn("text-xs h-9", isFixedTare && "bg-primary/5 border-primary/20")}><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="none">Nessuna (0.0 kg)</SelectItem>
                                        {packagingItems.filter(p => !selectedMaterial || (p.associatedTypes && p.associatedTypes.includes(selectedMaterial.type))).map(item => (
                                            <SelectItem key={item.id} value={item.id} className="text-xs">{item.name} ({item.weightKg.toFixed(3)} kg)</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )} />


                        <FormField control={form.control} name="ddt" render={({field}) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground">Rif. DDT / Note</FormLabel>
                                <FormControl><Input {...field} value={field.value ?? ''} className="text-xs h-9" /></FormControl>
                            </FormItem>
                        )}/>
                    </div>

                    <div className="space-y-4 pt-2">
                        {isBobina ? (
                            <FormField control={form.control} name="openingWeightManual" render={({field}) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-orange-600 font-black uppercase text-[10px]">
                                        PESO LORDO ATTUALE (Sulla Bilancia)
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Weight className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                            <Input 
                                                type="number"
                                                step="any"
                                                className="pl-10 bg-background font-mono text-2xl font-black h-14 border-2 border-primary/30" 
                                                {...field}
                                                value={field.value ?? ''}
                                            />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}/>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center space-x-2 rounded-xl border-2 p-2 justify-center bg-muted/40">
                                    <Label htmlFor="unit-switch-assoc" className="text-[10px] font-black uppercase">{selectedMaterial.unitOfMeasure}</Label>
                                    <Switch
                                        id="unit-switch-assoc"
                                        checked={inputUnit === 'kg'}
                                        onCheckedChange={(checked) => setInputUnit(checked ? 'kg' : 'primary')}
                                    />
                                    <Label htmlFor="unit-switch-assoc" className="text-[10px] font-black uppercase text-orange-600">KG (Bilancia)</Label>
                                </div>
                                <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-primary font-black uppercase text-[10px]">
                                            {isKgMode ? 'PESO LORDO (Sulla Bilancia)' : `QUANTITÀ NETTA (${selectedMaterial.unitOfMeasure.toUpperCase()})`}
                                        </FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Weight className={cn("absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5", isKgMode ? "text-orange-600" : "text-muted-foreground")} />
                                                <Input 
                                                    type="number" 
                                                    step="0.001" 
                                                    {...field} 
                                                    value={field.value ?? ''} 
                                                    className={cn(
                                                        "pl-10 h-14 text-2xl font-black font-mono border-2",
                                                        isKgMode ? "border-orange-500/30" : "border-primary/30"
                                                    )}
                                                />
                                            </div>
                                        </FormControl>
                                        {isKgMode && (
                                            <p className="text-[10px] text-muted-foreground italic text-right font-bold uppercase">
                                                L'app sottrarrà automaticamente {tare.toFixed(3)}kg di tara
                                            </p>
                                        )}
                                        <FormMessage/>
                                    </FormItem>
                                )}/>
                            </div>
                        )}
                    </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="flex-col sm:flex-col gap-2 p-6 pt-4 border-t sticky bottom-0 bg-background shadow-[0_-4px_10px_-5px_rgba(0,0,0,0.1)]">
              {isBobina ? (
                <Button type="button" onClick={onAvviaSessione} disabled={!selectedMaterial || isProcessing} className="w-full h-14 text-lg font-black uppercase tracking-tighter rounded-xl">
                    {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Play className="mr-2 h-5 w-5 fill-current" />} 
                    Avvia Sessione Bobina
                </Button>
              ) : (
                <div className="grid grid-cols-1 gap-2 w-full">
                    <Button 
                        type="button" 
                        onClick={form.handleSubmit((v) => onPrelevaMateriale(v, false))} 
                        disabled={!selectedMaterial || isProcessing || !form.watch('quantityToWithdraw')} 
                        className="w-full h-14 text-lg font-black uppercase tracking-tighter rounded-xl"
                    >
                        {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Send className="mr-2 h-5 w-5" />}
                        Registra Scarico
                    </Button>
                    
                    {/* Ferrous Rule 2: Materiale Finito Button */}
                    {selectedMaterial && lotAvailability && (
                        <Button 
                            type="button" 
                            variant="outline"
                            onClick={() => onPrelevaMateriale(form.getValues(), true)}
                            disabled={isProcessing}
                            className="w-full h-12 text-sm font-black uppercase tracking-tight rounded-xl border-2 border-red-600 bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white transition-all shadow-[0_0_10px_rgba(220,38,38,0.2)]"
                        >
                            <X className="mr-2 h-4 w-4" /> Materiale Finito
                        </Button>
                    )}
                </div>
              )}
          </DialogFooter>
        </form>
      </Form>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
          "max-w-md h-[90vh] flex flex-col p-0 overflow-hidden border-2 transition-colors",
          scanType ? "border-primary/40 bg-slate-900 text-white" : "bg-background"
      )}>
        <DialogHeader className={cn(
            "p-6 pb-2 border-b",
            scanType ? "bg-slate-950 border-slate-800" : "bg-muted/10 border-muted"
        )}>
          <DialogTitle className={cn(
              "text-lg font-black uppercase tracking-tighter flex items-center gap-2",
              scanType ? "text-white" : "text-foreground"
          )}>
              {scanType ? <Camera className="h-5 w-5 text-primary" /> : <Boxes className="h-5 w-5 text-primary" />}
              {scanType ? `Scansione ${scanType === 'material' ? 'Materiale' : 'Lotto'}` : `Associa Materiale: ${phase.name}`}
          </DialogTitle>
          {scanType && <DialogDescription className="text-[10px] font-bold uppercase text-slate-500">Inquadra e premi SPARA</DialogDescription>}
        </DialogHeader>
        {scanType ? <div className="p-6 pt-0">{renderScanView()}</div> : renderForm()}
      </DialogContent>
    </Dialog>
  );
}
