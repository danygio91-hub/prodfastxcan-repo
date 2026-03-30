"use client";

import React, { useState, useEffect } from 'react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Factory, Save, Loader2, Info } from 'lucide-react';
import { getProductionSettings, saveProductionSettings } from './actions';
import type { ProductionSettings } from '@/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const settingsSchema = z.object({
  capacityBufferPercent: z.coerce
    .number()
    .int("Deve essere un intero")
    .min(10, "Minimo 10%")
    .max(100, "Massimo 100%"),
  autoUpdateGanttIntervalHours: z.coerce
    .number()
    .min(0.5, "Minimo mezz'ora")
    .max(24, "Massimo 24 ore"),
  prioritizeActualTime: z.boolean(),
});

export default function ProductionSettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      capacityBufferPercent: 85,
      autoUpdateGanttIntervalHours: 1,
      prioritizeActualTime: true,
    },
  });

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
        const data = await getProductionSettings();
        form.reset(data);
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Errore",
            description: "Impossibile caricare le impostazioni di produzione.",
        });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const onSubmit = async (values: z.infer<typeof settingsSchema>) => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveProductionSettings(values, user.uid);
    toast({
      title: result.success ? "Impostazioni Salvate" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      await fetchSettings();
    }
    setIsSaving(false);
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-4xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Factory className="h-8 w-8 text-primary" />
              Impostazioni Produzione Globale
            </h1>
            <p className="text-muted-foreground">
              Regole fondamentali per lo Schedulatore Gantt e il controllo avanzamento di produzione (MES).
            </p>
          </header>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <Card>
                <CardHeader>
                  <CardTitle>Parametri Pianificazione (MRP)</CardTitle>
                  <CardDescription>
                    Modifica i valori algoritmici su cui si basa il calcolo del Diagramma di Gantt.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {isLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : (
                    <>
                      <FormField
                        control={form.control}
                        name="capacityBufferPercent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Capacità Schedulabile Massima (%)</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} />
                            </FormControl>
                            <FormDescription>
                              Percentuale di ore operatore/macchina impegnabili a sistema (es. 85%). Mantenere un margine (15%) serve ad assorbire urgenze, ritardi o imprevisti senza far crollare il Gantt.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="autoUpdateGanttIntervalHours"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Frequenza Auto-Aggiornamento Avanzamento (Ore)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.5" {...field} />
                            </FormControl>
                            <FormDescription>
                              Se l'operatore non dichiara nulla, ogni quante ore di lavoro il sistema deve aggiornare in background lo stato progressivo della barra di produzione sul Gantt?
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="prioritizeActualTime"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-primary/5">
                            <div className="space-y-0.5 pr-4">
                              <FormLabel className="text-base font-semibold">Priorità Tempo Effettivo</FormLabel>
                              <FormDescription>
                                Se abilitato, l'algoritmo del Gantt userà storicamente il Tempo Rilevato (se consolidato) anziché il Tempo Teorico d'Anagrafica per disegnare l'occupazione oraria.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSaving || isLoading} className="w-full sm:w-auto">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Salva Impostazioni
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
          
           <Alert variant="default" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
             <Info className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-amber-800 dark:text-amber-300">Come influisce la Capacità Massima?</AlertTitle>
            <AlertDescription>
             Se un operatore lavora 8 ore al giorno e la capacità massima è impostata all'85%, l'allocatore automatico del Gantt gli assegnerà compiti produttivi al massimo per **6.8 ore**. I restanti slot serviranno come cuscinetto flessibile.
            </AlertDescription>
          </Alert>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
