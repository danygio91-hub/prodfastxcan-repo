
"use client";

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { Loader2, Save, Archive, Weight, PackagePlus } from 'lucide-react';
import { type EnrichedBatch, type GroupedBatches } from './actions';
import { addBatchToRawMaterial, updateBatchInRawMaterial } from '../raw-material-management/actions';

const batchFormSchema = z.object({
  materialId: z.string().min(1, "ID Materiale mancante."),
  batchId: z.string().optional(),
  lotto: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Data non valida"}),
  ddt: z.string().min(1, "Il DDT è obbligatorio."),
  netQuantity: z.coerce.number().min(0, "La quantità non può essere negativa."),
  packagingId: z.string().optional(),
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

  const form = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (material && isOpen) {
      if (batch) {
        form.reset({
          materialId: material.materialId,
          batchId: batch.id,
          lotto: batch.lotto || '',
          date: format(new Date(batch.date), 'yyyy-MM-dd'),
          ddt: batch.ddt,
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
          netQuantity: 0,
          packagingId: 'none'
        });
      }
    }
  }, [isOpen, material, batch, form]);

  const onSubmit = async (values: BatchFormValues) => {
    setIsPending(true);
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value) formData.append(key, String(value));
    });

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{batch ? 'Modifica Lotto' : 'Aggiungi Nuovo Lotto'}</DialogTitle>
          <DialogDescription>
            Stai modificando un lotto per il materiale: <span className="font-bold text-primary">{material.materialCode}</span>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField control={form.control} name="lotto" render={({ field }) => ( <FormItem> <FormLabel>N° Lotto (Fornitore)</FormLabel> <FormControl><Input placeholder="Numero lotto opzionale" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
            <FormField control={form.control} name="date" render={({ field }) => ( <FormItem> <FormLabel>Data Ricezione</FormLabel> <FormControl><Input type="date" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
            <FormField control={form.control} name="ddt" render={({ field }) => ( <FormItem> <FormLabel>Documento di Trasporto (DDT)</FormLabel> <FormControl><Input placeholder="Numero DDT" {...field} /></FormControl> <FormMessage /> </FormItem> )} />
            
            <FormField control={form.control} name="netQuantity" render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center">
                  <PackagePlus className="mr-2 h-4 w-4" />Quantità Caricata ({material.unitOfMeasure.toUpperCase()})
                </FormLabel>
                <FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            
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
