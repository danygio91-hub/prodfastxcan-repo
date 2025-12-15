
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type InventoryRecord, type Packaging, type RawMaterial } from '@/lib/mock-data';
import { updateInventoryRecord, getPackagingItems, getMaterialById } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Weight, Archive, Package, TestTube } from 'lucide-react';
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
        packagingId: record.packagingId || 'none',
      });
    }
  }, [record, form]);
  
  const watchedValues = form.watch();
  
  const calculatedNetWeight = useMemo(() => {
    if (!material) return 0;
    
    const { inputQuantity, inputUnit, packagingId } = watchedValues;
    const tareWeight = packagingItems.find(p => p.id === packagingId)?.weightKg || 0;

    if (inputUnit === 'kg') {
        // User is inputting GROSS weight. Net weight is Gross - Tare.
        return (inputQuantity || 0) - tareWeight;
    } else {
        // User is inputting net units (pieces or meters).
        // Net weight is calculated from units * conversion factor.
        const conversionFactor = material.conversionFactor;
        if (conversionFactor && conversionFactor > 0) {
            return (inputQuantity || 0) * conversionFactor;
        }
    }
    
    return 0; // Fallback if no valid calculation can be made

  }, [material, watchedValues, packagingItems]);


  const onSubmit = async (values: FormValues) => {
    if (!record || !user || !material) return;
    setIsPending(true);
    
    const tareWeight = packagingItems.find(p => p.id === values.packagingId)?.weightKg || 0;
    let netWeight: number;

    if (values.inputUnit === 'kg') {
        // The user entered the GROSS weight.
        netWeight = values.inputQuantity - tareWeight;
    } else { // 'n' or 'mt'
        // The user entered the net quantity in pieces/meters.
        netWeight = (material.conversionFactor && material.conversionFactor > 0)
            ? values.inputQuantity * material.conversionFactor
            : 0; // Or handle as an error if conversion factor is essential
    }

    if (netWeight < 0) {
        toast({
            variant: "destructive",
            title: "Errore",
            description: "Il peso netto calcolato è negativo. Controllare i dati inseriti.",
        });
        setIsPending(false);
        return;
    }

    // IMPORTANT: We are now passing the *original* input quantity and unit to the server.
    // The server action will be responsible for recalculating everything based on this.
    const result = await updateInventoryRecord(
        record.id, 
        values.inputQuantity, // The value from the form field
        values.inputUnit,     // The unit selected in the form
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
        <Form {...form}>
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
                         <div className="flex items-center space-x-2 rounded-lg border p-3 justify-center">
                            <Label htmlFor="unit-switch">{material.unitOfMeasure.toUpperCase()}</Label>
                            <Switch
                                id="unit-switch"
                                checked={field.value === 'kg'}
                                onCheckedChange={(checked) => {
                                    field.onChange(checked ? 'kg' : material.unitOfMeasure)
                                }}
                            />
                            <Label htmlFor="unit-switch">KG</Label>
                        </div>
                    </FormItem>
                    )}
                />

                <div className="space-y-2">
                    <Label htmlFor="inputQuantity" className="flex items-center gap-2"><Package className="h-4 w-4"/>
                       {form.watch('inputUnit') === 'kg' ? 'Quantità Lorda (KG)' : `Quantità Inserita (${material.unitOfMeasure.toUpperCase()})`}
                    </Label>
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
        </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}
