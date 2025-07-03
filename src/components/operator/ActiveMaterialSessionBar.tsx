
"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useActiveMaterialSession, type ActiveMaterialSessionData } from '@/contexts/ActiveMaterialSessionProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { closeMaterialSessionAndUpdateStock } from '@/app/scan-job/actions';
import { Boxes, Weight, Send, Loader2, X } from 'lucide-react';

const closingWeightSchema = z.object({
  closingWeight: z.coerce.number().min(0, "Il peso non può essere negativo."),
});

type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

export default function ActiveMaterialSessionBar() {
  const { activeSession, clearSession } = useActiveMaterialSession();
  const { operator } = useAuth();
  const { toast } = useToast();
  const [isClosingDialogOpen, setIsClosingDialogOpen] = useState(false);

  const form = useForm<ClosingWeightFormValues>({
    resolver: zodResolver(closingWeightSchema),
    defaultValues: { closingWeight: 0 },
  });

  const handleCloseSession = async (values: ClosingWeightFormValues) => {
    if (!activeSession || !operator) return;

    if (values.closingWeight > activeSession.openingWeight) {
        form.setError("closingWeight", { type: "manual", message: "Il peso di chiusura non può essere maggiore di quello di apertura." });
        return;
    }

    const result = await closeMaterialSessionAndUpdateStock(
        activeSession,
        values.closingWeight,
        operator.id
    );

    toast({
        title: result.success ? "Sessione Chiusa" : "Errore",
        description: result.message,
        variant: result.success ? "default" : "destructive",
    });

    if (result.success) {
        clearSession();
        setIsClosingDialogOpen(false);
    }
  };

  if (!activeSession) {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-[70px] left-0 right-0 z-50 p-2 sm:p-4 pointer-events-none">
        <Card className="p-3 shadow-2xl w-full max-w-lg mx-auto pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-5 duration-300 bg-secondary/95 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate text-secondary-foreground flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-primary" />
                        Sessione Materiale Attiva
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        Materiale: {activeSession.materialCode} (Aperto: {activeSession.openingWeight} kg)
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="destructive" size="sm" className="h-9" onClick={() => setIsClosingDialogOpen(true)}>
                        <X className="mr-2 h-4 w-4" />
                        Chiudi Sessione
                    </Button>
                </div>
            </div>
        </Card>
      </div>

      <Dialog open={isClosingDialogOpen} onOpenChange={setIsClosingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chiudi Sessione Materiale</DialogTitle>
            <DialogDescription>
              Inserisci il peso finale per il materiale <span className="font-bold">{activeSession.materialCode}</span>.
              Il consumo totale verrà scaricato dal magazzino e associato a tutte le commesse lavorate.
              <br/>
              Peso di apertura: <span className="font-bold">{activeSession.openingWeight} kg</span>.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCloseSession)} className="space-y-4">
              <FormField
                control={form.control}
                name="closingWeight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4"/>Peso Finale (KG)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsClosingDialogOpen(false)}>Annulla</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                  Conferma e Scarica
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
