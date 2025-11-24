
"use client";

import React, { useState, useEffect } from 'react';
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
import { type InventoryRecord } from '@/lib/mock-data';
import { updateInventoryRecord } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Weight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

interface InventoryRecordSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  record: InventoryRecord | null;
  onUpdateSuccess: () => void;
}

const formSchema = z.object({
  grossWeight: z.coerce.number().positive("Il peso deve essere positivo."),
});

type FormValues = z.infer<typeof formSchema>;

export default function InventoryRecordSheet({ isOpen, onOpenChange, record, onUpdateSuccess }: InventoryRecordSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  useEffect(() => {
    if (record) {
      form.reset({ grossWeight: record.grossWeight });
    }
  }, [record, form]);
  
  const watchedGrossWeight = form.watch('grossWeight');
  const calculatedNetWeight = record ? watchedGrossWeight - record.tareWeight : 0;

  const onSubmit = async (values: FormValues) => {
    if (!record || !user) return;
    setIsPending(true);

    const result = await updateInventoryRecord(record.id, values.grossWeight, user.uid);
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
            Correggi il peso lordo registrato. Il peso netto verrà ricalcolato.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-6 py-6">
            <div className="space-y-1">
              <Label>Materiale</Label>
              <p className="p-2 bg-muted rounded-md font-mono text-sm">{record.materialCode}</p>
            </div>
            <div className="space-y-1">
              <Label>Lotto</Label>
              <p className="p-2 bg-muted rounded-md font-mono text-sm">{record.lotto}</p>
            </div>
            <div className="space-y-1">
              <Label>Operatore</Label>
              <p className="p-2 bg-muted rounded-md text-sm">{record.operatorName}</p>
            </div>
             <div className="space-y-1">
              <Label>Data Registrazione</Label>
              <p className="p-2 bg-muted rounded-md text-sm">{format(parseISO(record.recordedAt as unknown as string), "dd MMMM yyyy 'alle' HH:mm", { locale: it })}</p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="grossWeight" className="flex items-center gap-2"><Weight className="h-4 w-4"/> Peso Lordo (kg)</Label>
                <Input 
                    id="grossWeight" 
                    type="number"
                    step="0.001"
                    {...form.register('grossWeight')}
                />
                {form.formState.errors.grossWeight && <p className="text-sm text-destructive">{form.formState.errors.grossWeight.message}</p>}
            </div>

             <div className="space-y-1">
              <Label>Tara Applicata (kg)</Label>
              <p className="p-2 bg-muted rounded-md text-sm">{record.tareWeight.toFixed(3)}</p>
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
      </SheetContent>
    </Sheet>
  );
}
