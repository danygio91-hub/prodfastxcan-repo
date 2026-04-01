
"use client";

import React, { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { calculateInventoryMovement } from '@/lib/inventory-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Weight, PackagePlus, Scale } from 'lucide-react';
import { type EnrichedBatch, type GroupedBatches } from './actions';
import { addBatchToRawMaterial, updateBatchInRawMaterial } from '../raw-material-management/actions';
import { getPackagingItems } from '../../material-loading/actions';
import { Packaging } from '@/types';

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  batchId: z.string().optional(),
  lotto: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  grossWeight: z.coerce.number().min(0, "Il peso lordo non può essere negativo."),
  packagingId: z.string().optional(),
  netQuantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
});
type BatchFormValues = z.infer<typeof batchFormSchema>;

interface BatchFormDialogProps {
  isOpen: boolean;
  onClose: (refresh?: boolean) => void;
  material: GroupedBatches;
  batch: EnrichedBatch | null;
}

export default function BatchFormDialog({ isOpen, onClose, material, batch }: BatchFormDialogProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);

  const form = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {
        packagingId: 'none'
    },
  });

  const watchedGross = useWatch({ control: form.control, name: 'grossWeight' });
  const watchedPackagingId = useWatch({ control: form.control, name: 'packagingId' });

  // Reattività: Calcola il netto quando cambia lordo o tara
  useEffect(() => {
    if (watchedGross !== undefined && material) {
        const tareWeight = packagingItems.find(p => p.id === watchedPackagingId)?.weightKg || 0;
        const netWeightKg = Math.max(0, watchedGross - tareWeight);
        
        // Use the centralized logic to determine Net Quantity in Base UOM from Net Weight in KG
        // We pass the netWeightKg as the quantity and 'kg' as the inputUom
        const { unitsToChange: calculatedNet } = calculateInventoryMovement(
            { ...material, unitOfMeasure: material.unitOfMeasure } as any,
            { defaultUnit: material.unitOfMeasure, hasConversion: true },
            netWeightKg,
            'kg',
            true // isAddition
        );

        form.setValue('netQuantity', Number(calculatedNet.toFixed(3)));
    }
  }, [watchedGross, watchedPackagingId, packagingItems, form, material]);

  useEffect(() => {
    if (isOpen) {
      getPackagingItems().then(setPackagingItems);
    }
  }, [isOpen]);

  useEffect(() => {
    if (material && isOpen) {
      if (batch) {
        form.reset({
          materialId: material.materialId,
          batchId: batch.id,
          lotto: batch.lotto || '',
          date: format(new Date(batch.date), 'yyyy-MM-dd'),
          ddt: batch.ddt,
          grossWeight: batch.grossWeight || batch.netQuantity, // Fallback se manca lordo
          netQuantity: batch.netQuantity,
          packagingId: batch.packagingId || 'none'
        });
      } else {
        form.reset({
          materialId: material.materialId,
          batchId: undefined,
          lotto: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          ddt: '',
          grossWeight: 0,
          netQuantity: 0,
          packagingId: 'none'
        });
      }
    }
  }, [isOpen, material, batch, form]);

  const onSubmit = async (values: BatchFormValues) => {
    setIsPending(true);
    const formData = new FormData();
    
    // Add all values from form
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) formData.append(key, String(value));
    });

    // Add traceability extra info
    const pkg = packagingItems.find(p => p.id === values.packagingId);
    formData.append('tareWeight', String(pkg?.weightKg || 0));
    formData.append('tareName', pkg?.name || 'Nessuna Tara');

    const result = batch
      ? await updateBatchInRawMaterial(formData)
      : await addBatchToRawMaterial(formData);

    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      onClose(true);
    }
    setIsPending(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{batch ? 'Modifica Lotto' : 'Aggiungi Nuovo Lotto'}</DialogTitle>
          <DialogDescription>
            Stai gestendo un lotto per il materiale: <span className="font-bold text-primary">{material.materialCode}</span>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="lotto" render={({ field }) => ( <FormItem> <FormLabel>N° Lotto</FormLabel> <FormControl><Input placeholder="Lotto" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
                <FormField control={form.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data Ricezione</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
            </div>
            
            <FormField control={form.control} name="ddt" render={({ field }) => ( <FormItem> <FormLabel>Documento di Trasporto (DDT)</FormLabel> <FormControl><Input placeholder="Numero DDT" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
            
            <div className="bg-muted/30 p-4 rounded-lg space-y-4 border">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Scale className="h-4 w-4 text-primary" /> Calcolo Pesi e Quantità
                </h4>
                
                <FormField
                    control={form.control}
                    name="packagingId"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Tara Predefinita (Imballo)</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleziona una tara" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="none">Nessuna Tara (0 kg)</SelectItem>
                                    {packagingItems.map((item) => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.name} ({item.weightKg} kg)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="grossWeight" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Peso Lordo (KG)</FormLabel>
                            <FormControl><Input type="number" step="any" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />

                    <FormField control={form.control} name="netQuantity" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center text-primary font-bold">
                                {material.unitOfMeasure === 'kg' ? 'Netto (KG)' : `Netto (${material.unitOfMeasure.toUpperCase()})`}
                            </FormLabel>
                            <FormControl><Input type="number" step="any" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
                <p className="text-[10px] text-muted-foreground italic text-center">
                    Il campo Netto viene calcolato automaticamente sottraendo la tara dal peso lordo.
                </p>
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onClose()} disabled={isPending}>Annulla</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {batch ? 'Salva Modifiche' : 'Aggiungi Lotto'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
