"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';

import type { JobOrder, JobPhase, RawMaterial, RawMaterialBatch, ActiveMaterialSessionData, RawMaterialType } from '@/lib/mock-data';
import { findLastWeightForLotto, searchRawMaterials, logTubiGuainaWithdrawal, getRawMaterialByCode } from './actions';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from '@/components/ui/badge';
import { QrCode, Loader2, Weight, Archive, Send, Package, Boxes, Check, ChevronsUpDown, Barcode, Play, Minus, Plus, Camera, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  material: z.custom<RawMaterial>().nullable(),
  lotto: z.string().optional(),
  ddt: z.string().optional(),
  openingWeight: z.coerce.number().optional(),
  quantityToWithdraw: z.coerce.number().optional(),
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
  
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(!!scanType, videoRef);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      material: null,
      lotto: "",
      ddt: "",
      openingWeight: 0,
      quantityToWithdraw: 0,
    },
  });

  const selectedMaterial = form.watch('material');

  const handleMaterialSelect = (material: RawMaterial) => {
    form.setValue('material', material);
  };
  
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


  const handleScan = async (scannedValue: string) => {
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
        form.setValue('openingWeight', lottoData.netWeight);
        form.setValue('ddt', lottoData.isInitialLoad ? 'Carico Iniziale' : 'Ultima Chiusura');
      } else {
        toast({ variant: 'destructive', title: 'Lotto non trovato', description: 'Nessuno storico per questo lotto. Inserire il peso manualmente o scansionare prima il materiale.' });
      }
    }
    setScanType(null); // Close scanner view
  };

  const onAvviaSessione = (values: FormValues) => {
    if (!selectedMaterial || !job || !operator) return;
    onSessionStart({
      materialId: selectedMaterial.id,
      materialCode: selectedMaterial.code,
      grossOpeningWeight: values.openingWeight || 0,
      netOpeningWeight: values.openingWeight || 0,
      originatorJobId: job.id,
      associatedJobs: [{ jobId: job.id, jobOrderPF: job.ordinePF }],
    }, selectedMaterial.type);
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
      formData.append('unit', selectedMaterial.unitOfMeasure);
      
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
                    <p className="text-destructive-foreground font-semibold">Accesso Fotocamera Negato</p>
                </div>
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
        <div className="flex flex-col gap-2">
            <Button onClick={triggerScan} disabled={isProcessing || !hasPermission} className="w-full">
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Camera className="mr-2 h-4 w-4" />}
                {isProcessing ? 'Scansionando...' : 'Scansiona Ora'}
            </Button>
             <Button variant="outline" onClick={() => setScanType(null)}>Annulla Scansione</Button>
        </div>
    </div>
  );

  const renderForm = () => (
     <Form {...form}>
        <form className="space-y-4">
            {selectedMaterial ? (
                <div className="p-4 border rounded-lg bg-muted">
                    <p className="font-semibold text-lg">{selectedMaterial.code}</p>
                    <p className="text-sm text-muted-foreground">{selectedMaterial.description}</p>
                    <p className="text-xl font-bold text-primary">{selectedMaterial.currentWeightKg?.toFixed(2)} KG / {selectedMaterial.currentStockUnits} {selectedMaterial.unitOfMeasure.toUpperCase()}</p>
                </div>
            ) : <Alert><AlertDescription>Scansiona un materiale o un lotto per iniziare.</AlertDescription></Alert>}

            <div className="flex gap-2">
                <Button type="button" onClick={() => handleScanTrigger('material')} className="w-full">
                    <QrCode className="mr-2 h-4 w-4" /> Scansiona Materiale
                </Button>
                 <Button type="button" onClick={() => handleScanTrigger('lotto')} className="w-full">
                    <Barcode className="mr-2 h-4 w-4" /> Scansiona Lotto
                </Button>
            </div>
            
            <FormField control={form.control} name="lotto" render={({field}) => (
                <FormItem>
                    <FormLabel>Lotto</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                </FormItem>
            )}/>
            <FormField control={form.control} name="ddt" render={({field}) => (
                <FormItem>
                    <FormLabel>DDT / Origine</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                </FormItem>
            )}/>

             {phase.name.includes("TRECCIA") || phase.name.includes("CORDA") || phase.name.includes("BARRA") ? (
                <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Kg Netti di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                )}/>
             ) : phase.name.includes("TUBI") ? (
                <>
                    <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Kg Netti di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                    )}/>
                    <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                    <FormItem>
                        <FormLabel>N° pezzi da prelevare</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                    )}/>
                </>
             ) : phase.name.includes("GUAINA") ? (
                <>
                    <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Metri di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                    )}/>
                    <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                    <FormItem>
                        <FormLabel>Metri da prelevare</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                    )}/>
                </>
             ): null}

            <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button type="button" onClick={form.handleSubmit(onAvviaSessione)} disabled={!selectedMaterial || isProcessing}>
                  <Play className="mr-2 h-4 w-4" /> Avvia Sessione
                </Button>
                 {(phase.name.includes("TUBI") || phase.name.includes("GUAINA")) && (
                    <Button type="button" onClick={form.handleSubmit(onPrelevaMateriale)} disabled={!selectedMaterial || isProcessing}>
                      <Send className="mr-2 h-4 w-4" /> Preleva Materiale
                    </Button>
                )}
            </DialogFooter>
        </form>
      </Form>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Associa Materiale a "{phase.name}"</DialogTitle>
        </DialogHeader>
        {scanType ? renderScanView() : renderForm()}
      </DialogContent>
    </Dialog>
  );
}
