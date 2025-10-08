
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
import { Timer, Save, Loader2, AlertCircle } from 'lucide-react';
import { getTimeTrackingSettings, saveTimeTrackingSettings, type TimeTrackingSettings } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const settingsSchema = z.object({
  minimumPhaseDurationSeconds: z.coerce
    .number()
    .int("Il valore deve essere un numero intero.")
    .min(0, "Il valore non può essere negativo.")
    .max(300, "Il valore non può superare 300 secondi."),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function TimeTrackingSettingsPage() {
  const [settings, setSettings] = useState<TimeTrackingSettings>({ 
      minimumPhaseDurationSeconds: 10,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      minimumPhaseDurationSeconds: 10,
    },
  });

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
        const data = await getTimeTrackingSettings();
        setSettings(data);
        form.reset(data);
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Errore",
            description: "Impossibile caricare le impostazioni.",
        });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (values: SettingsFormValues) => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveTimeTrackingSettings(values, user.uid);
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
              <Timer className="h-8 w-8 text-primary" />
              Gestione Rilevazione Tempi
            </h1>
            <p className="text-muted-foreground">
              Definisci le regole per la validazione e l'analisi dei tempi di produzione.
            </p>
          </header>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <Card>
                <CardHeader>
                  <CardTitle>Regole di Validazione Automatica</CardTitle>
                  <CardDescription>
                    Imposta i parametri usati per determinare se i dati cronometrati sono affidabili.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : (
                    <FormField
                      control={form.control}
                      name="minimumPhaseDurationSeconds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Soglia minima di durata fase (in secondi)</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="Es. 10" {...field} />
                          </FormControl>
                          <FormDescription>
                            Una fase completata in meno di questo tempo renderà il calcolo totale per quella commessa "non affidabile".
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSaving || isLoading}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Salva Impostazioni
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
          
           <Alert variant="default" className="border-blue-500/50 bg-blue-500/10 text-blue-900 dark:text-blue-200">
             <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <AlertTitle className="text-blue-800 dark:text-blue-300">Come funziona l'affidabilità?</AlertTitle>
            <AlertDescription>
             Un tempo di produzione per un articolo è considerato "affidabile" solo se tutte le sue fasi sono state completate organicamente, senza forzature manuali e rispettando la soglia di tempo minima impostata sopra.
            </AlertDescription>
          </Alert>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
