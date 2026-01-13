
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';
import { useCameraStream } from '@/hooks/use-camera-stream';

import type { JobPhase, RawMaterial, RawMaterialBatch, ActiveMaterialSessionData, RawMaterialType } from '@/lib/mock-data';
import { findLastWeightForLotto, searchRawMaterials, logTubiGuainaWithdrawal } from './actions';
import { getPackagingItems } from '@/app/inventory/actions';

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
import { QrCode, Loader2, Weight, Archive, Send, Package, Boxes, Check, ChevronsUpDown, Barcode, Play, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  material: z.custom<RawMaterial>().nullable(),
  lotto: z.string().optional(),
  ddt: z.string().optional(),
  openingWeight: z.coerce.number().optional(),
  quantityToWithdraw: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

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
  const [step, setStep] = useState<'initial' | 'scanning_material' | 'scanning_lotto'>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RawMaterial[]>([]);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { hasPermission } = useCameraStream(step === 'scanning_material' || step === 'scanning_lotto', videoRef);

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
    setSearchQuery("");
    setIsSearchOpen(false);
  };

  const handleScan = async (scannedValue: string) => {
    setIsProcessing(true);
    if (step === 'scanning_material') {
      const material = await searchRawMaterials(scannedValue, phase.allowedMaterialTypes);
      if (material.length > 0) {
        handleMaterialSelect(material[0]);
      } else {
        toast({ variant: 'destructive', title: 'Materiale non trovato' });
      }
    } else if (step === 'scanning_lotto') {
      form.setValue('lotto', scannedValue);
      const lottoData = await findLastWeightForLotto(selectedMaterial!.id, scannedValue);
      if (lottoData) {
        form.setValue('openingWeight', lottoData.netWeight);
        form.setValue('ddt', lottoData.isInitialLoad ? 'Carico Iniziale' : 'Ultima Chiusura');
      } else {
        toast({ variant: 'destructive', title: 'Lotto non trovato', description: 'Nessuno storico per questo lotto. Inserire il peso manualmente.' });
      }
    }
    setStep('initial');
    setIsProcessing(false);
  };

  const onAvviaSessione = (values: FormValues) => {
    if (!selectedMaterial || !job || !operator) return;
    onSessionStart({
      materialId: selectedMaterial.id,
      materialCode: selectedMaterial.code,
      grossOpeningWeight: values.openingWeight || 0, // This should be gross, need to adjust
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
  
  const triggerScan = async () => {
    // ... scan logic ...
  };

  const renderContent = () => {
    if (step === 'scanning_material' || step === 'scanning_lotto') {
      // ... render scan UI ...
      return <div>Scanning...</div>;
    }
    
    return (
      <Form {...form}>
        <form className="space-y-4">
            {selectedMaterial ? (
                <div className="p-4 border rounded-lg bg-muted">
                    <p className="text-sm font-medium">{selectedMaterial.code}</p>
                    <p className="text-sm text-muted-foreground">{selectedMaterial.description}</p>
                    <p className="text-lg font-bold text-primary">{selectedMaterial.currentWeightKg?.toFixed(2)} KG / {selectedMaterial.currentStockUnits} {selectedMaterial.unitOfMeasure.toUpperCase()}</p>
                </div>
            ) : <Alert>Seleziona o scansiona un materiale</Alert>}

            <div className="flex gap-2">
                <Button type="button" onClick={() => setStep('scanning_material')} className="w-full">
                    <QrCode className="mr-2 h-4 w-4" /> Scansiona Materiale
                </Button>
                 <Button type="button" onClick={() => setStep('scanning_lotto')} className="w-full" disabled={!selectedMaterial}>
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
                    <FormLabel>DDT</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                </FormItem>
            )}/>

             {phase.name.includes("TRECCIA") || phase.name.includes("CORDA") ? (
                <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Kg Netti di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                    </FormItem>
                )}/>
             ) : phase.name.includes("TUBI") ? (
                <>
                    <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Kg Netti di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                    </FormItem>
                    )}/>
                    <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                    <FormItem>
                        <FormLabel>N° pezzi da prelevare</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                    </FormItem>
                    )}/>
                </>
             ) : phase.name.includes("GUAINA") ? (
                <>
                    <FormField control={form.control} name="openingWeight" render={({field}) => (
                    <FormItem>
                        <FormLabel>Mt di Apertura</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                    </FormItem>
                    )}/>
                    <FormField control={form.control} name="quantityToWithdraw" render={({field}) => (
                    <FormItem>
                        <FormLabel>Mt da prelevare</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                    </FormItem>
                    )}/>
                </>
             ): null}

            <DialogFooter>
                <Button type="button" onClick={form.handleSubmit(onAvviaSessione)}>Avvia Sessione Materiale</Button>
                 {(phase.name.includes("TUBI") || phase.name.includes("GUAINA")) && (
                    <Button type="button" onClick={form.handleSubmit(onPrelevaMateriale)}>Preleva Materiale</Button>
                )}
            </DialogFooter>
        </form>
      </Form>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Associa Materiale a "{phase.name}"</DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}

    