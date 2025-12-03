
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type InventoryRecord, type Packaging, type RawMaterial } from '@/lib/mock-data';
import { updateInventoryRecord, getPackagingItems, getMaterialById } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Weight, Archive, Package } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

interface InventoryRecordSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  record: InventoryRecord | null;
  onUpdateSuccess: () => void;
}

const formSchema = z.object({
  inputQuantity: z.coerce.number().positive("La quantità deve essere positiva."),
  grossWeight: z.coerce.number().optional(), // Now optional
  packagingId: z.string().optional(),
  inputUnit: z.enum(['n', 'mt', 'kg']),
});

type FormValues = z.infer<typeof formSchema>;

export default function InventoryRecordSheet({ isOpen, onOpenChange, record, onUpdateSuccess }: InventoryRecordSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [packagingItems, setPackagingItems] = useState<Packaging[]>([]);
  const [material, setMaterial] = useState<RawMaterial | null>(null);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { packagingId: 'none' },
  });

  useEffect(() => {
    getPackagingItems().then(setPackagingItems);
  }, []);

  useEffect(() => {
    if (record) {
      getMaterialById(record.materialId).then(setMaterial);
      form.reset({ 
        inputQuantity: record.inputQuantity,
        inputUnit: record.inputUnit,
        grossWeight: record.grossWeight,
        packagingId: record.packagingId || 'none',
      });
    }
  }, [record, form]);
  
  const watchedValues = form.watch();
  
  const calculatedNetWeight = useMemo(() => {
      if (!material) return 0;
      
      const tareWeight = packagingItems.find(p => p.id === watchedValues.packagingId)?.weightKg || 0;
      let netWeight = 0;

      if (watchedValues.inputUnit === 'kg') {
          netWeight = (watchedValues.inputQuantity || 0) - tareWeight;
      } else {
          const conversionFactor = material.unitOfMeasure === watchedValues.inputUnit 
              ? material.conversionFactor
              : material.secondaryConversionFactor;
          
          if (conversionFactor && conversionFactor > 0) {
              netWeight = (watchedValues.inputQuantity || 0) * conversionFactor;
          }
      }
      return netWeight;
  }, [material, watchedValues, packagingItems]);


  const onSubmit = async (values: FormValues) => {
    if (!record || !user || !material) return;
    setIsPending(true);
    
    const tareWeight = packagingItems.find(p => p.id === values.packagingId)?.weightKg || 0;
    let grossWeight;
    
    if (values.inputUnit === 'kg') {
      grossWeight = values.inputQuantity;
    } else {
      grossWeight = calculatedNetWeight + tareWeight;
    }

    const result = await updateInventoryRecord(
        record.id, 
        values.inputQuantity,
        values.inputUnit,
        grossWeight,
        values.packagingId, 
        user.uid
    );
    toast({
        title: result.success ? "Aggiornato" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
      onUpdateSuccess();
      onOpenChange(false);
    }
    setIsPending(false);
  };
  
  if (!record) return null;

  const isKgPrimary = material?.unitOfMeasure === 'kg';
  const hasSecondaryUnit = material?.secondaryUnitOfMeasure && material.secondaryUnitOfMeasure !== 'none';

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Modifica Registrazione Inventario</SheetTitle>
          <SheetDescription>
            Correggi quantità o tara. Il peso netto verrà ricalcolato.
          </SheetDescription>
        </SheetHeader>
        {!material ? <Skeleton className="h-96 w-full mt-6" /> : (
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-6 py-6">
            <div className="space-y-1">
              <Label>Materiale</Label>
              <p className="p-2 bg-muted rounded-md font-mono text-sm">{record.materialCode}</p>
            </div>
            
             <FormField
                control={form.control}
                name="inputUnit"
                render={({ field }) => (
                  <FormItem>
                     {hasSecondaryUnit && !isKgPrimary && (
                        <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center">
                            <Label htmlFor="unit-switch">{material.unitOfMeasure.toUpperCase()}</Label>
                            <Switch
                                id="unit-switch"
                                checked={field.value === material.secondaryUnitOfMeasure}
                                onCheckedChange={(checked) => {
                                    field.onChange(checked ? material.secondaryUnitOfMeasure : material.unitOfMeasure)
                                }}
                            />
                            <Label htmlFor="unit-switch">{material.secondaryUnitOfMeasure?.toUpperCase()}</Label>
                        </div>
                    )}
                  </FormItem>
                )}
              />

             <div className="space-y-2">
                <Label htmlFor="inputQuantity" className="flex items-center gap-2"><Package className="h-4 w-4"/> Quantità Inserita ({watchedValues.inputUnit?.toUpperCase()})</Label>
                 <Input 
                    id="inputQuantity" 
                    type="number"
                    step="any"
                    {...form.register('inputQuantity')}
                />
                {form.formState.errors.inputQuantity && <p className="text-sm text-destructive">{form.formState.errors.inputQuantity.message}</p>}
            </div>

             <div className="space-y-2">
                <Label htmlFor="packagingId" className="flex items-center gap-2"><Archive className="h-4 w-4"/> Tara Applicata (kg)</Label>
                 <Select onValueChange={(value) => form.setValue('packagingId', value)} defaultValue={record.packagingId || 'none'}>
                  <SelectTrigger id="packagingId">
                    <SelectValue placeholder="Seleziona una tara..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuna Tara (0.00 kg)</SelectItem>
                    {packagingItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.weightKg.toFixed(3)} kg)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
            </div>

             <div className="p-4 rounded-lg border bg-background text-center">
                <Label className="text-muted-foreground">Nuovo Peso Netto Calcolato (kg)</Label>
                <p className="text-2xl font-bold text-primary">{calculatedNetWeight >= 0 ? calculatedNetWeight.toFixed(3) : '---'}</p>
            </div>

          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline">Annulla</Button>
            </SheetClose>
            <Button type="submit" disabled={isPending || calculatedNetWeight < 0}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Salva Modifiche
            </Button>
          </SheetFooter>
        </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
