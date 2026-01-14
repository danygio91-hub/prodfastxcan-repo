"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useActiveMaterialSession } from '@/contexts/ActiveMaterialSessionProvider';
import type { ActiveMaterialSessionData } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from '@/components/ui/input';
import { closeMaterialSessionAndUpdateStock } from '@/app/scan-job/actions';
import { Boxes, Weight, Send, Loader2, X, AlertTriangle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

const closingWeightSchema = z.object({
  closingWeight: z.coerce.number().min(0, "Il peso non può essere negativo."),
});

type ClosingWeightFormValues = z.infer<typeof closingWeightSchema>;

function SessionClosureDialog({ session, isOpen, onOpenChange }: { session: ActiveMaterialSessionData; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
    const { closeSession } = useActiveMaterialSession();
    const { operator } = useAuth();
    const { toast } = useToast();

    const form = useForm<ClosingWeightFormValues>({
        resolver: zodResolver(closingWeightSchema),
        defaultValues: { closingWeight: 0 },
    });
    
    React.useEffect(() => {
      if (isOpen) {
        form.reset({ closingWeight: session.grossOpeningWeight });
      }
    }, [isOpen, session, form]);

    const handleCloseSessionSubmit = async (values: ClosingWeightFormValues) => {
        if (!operator) return;

        if (values.closingWeight > session.grossOpeningWeight) {
            form.setError("closingWeight", { type: "manual", message: "Il peso di chiusura non può essere maggiore di quello di apertura." });
            return;
        }

        const result = await closeMaterialSessionAndUpdateStock(
            session,
            values.closingWeight,
            operator.id
        );

        toast({
            title: result.success ? "Sessione Chiusa" : "Errore",
            description: result.message,
            variant: result.success ? "default" : "destructive",
        });

        if (result.success) {
            closeSession(session.materialId);
            onOpenChange(false);
        }
    };

    return (
       <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
            <DialogHeader>
                <DialogTitle>Chiudi Sessione Materiale</DialogTitle>
                <DialogDescription>
                Inserisci il peso finale per il materiale <span className="font-bold">{session.materialCode}</span>.
                Il consumo totale verrà scaricato dal magazzino e associato a tutte le commesse lavorate.
                <br/>
                Peso Lordo di apertura: <span className="font-bold">{session.grossOpeningWeight.toFixed(2)} kg</span>.
                </DialogDescription>
            </DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(handleCloseSessionSubmit)} className="space-y-4">
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
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                    Conferma e Scarica
                    </Button>
                </DialogFooter>
                </form>
            </Form>
            </DialogContent>
        </Dialog>
    );
}

export default function ActiveMaterialSessionBar() {
  const { activeSessions, isLoading } = useActiveMaterialSession();
  const [closingSession, setClosingSession] = useState<ActiveMaterialSessionData | null>(null);
  
  if (isLoading || !activeSessions || activeSessions.length === 0) {
    return null;
  }

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
            <Button
              variant="destructive"
              className="fixed top-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg animate-in fade-in-0 zoom-in-95"
            >
              <div className="relative">
                <Boxes className="h-6 w-6" />
                 <Badge variant="secondary" className="absolute -top-2 -right-3 h-5 w-5 justify-center p-0 rounded-full">
                  {activeSessions.length}
                </Badge>
              </div>
            </Button>
        </SheetTrigger>
        <SheetContent>
            <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/> Sessioni Materiale Attive</SheetTitle>
                <SheetDescription>
                   Queste sessioni rimarranno attive finché non verranno chiuse manualmente.
                </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-150px)] pr-4">
                <div className="grid gap-4 py-4">
                {activeSessions.map((session) => (
                    <div key={session.materialId} className="p-4 border rounded-lg space-y-3">
                        <div>
                            <div className="font-semibold text-sm flex items-center gap-2">{session.materialCode} <Badge variant="outline">{session.category}</Badge></div>
                            <p className="text-xs text-muted-foreground">Aperto con: {session.grossOpeningWeight.toFixed(2)} kg</p>
                        </div>
                         <div className="text-xs text-muted-foreground">
                            <p className="font-medium text-foreground">Commesse Associate:</p>
                            <ul className="list-disc pl-4">
                               {session.associatedJobs.map(j => <li key={j.jobId}>{j.jobOrderPF}</li>)}
                            </ul>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            onClick={() => setClosingSession(session)}
                        >
                            <X className="mr-2 h-4 w-4" /> Chiudi Sessione
                        </Button>
                    </div>
                ))}
                </div>
            </ScrollArea>
            <SheetFooter>
                <SheetClose asChild>
                    <Button variant="outline">Chiudi</Button>
                </SheetClose>
            </SheetFooter>
        </SheetContent>
      </Sheet>

      {closingSession && (
          <SessionClosureDialog
              session={closingSession}
              isOpen={!!closingSession}
              onOpenChange={(open) => {
                  if (!open) {
                      setClosingSession(null);
                  }
              }}
          />
      )}
    </>
  );
}
