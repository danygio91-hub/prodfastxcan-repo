
"use client";

import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Clock, Save, Loader2, Plus, Trash2, CalendarDays } from 'lucide-react';
import { getWorkingHoursConfig, saveWorkingHoursConfig } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

const shiftSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Il nome del turno è obbligatorio."),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:mm richiesto."),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:mm richiesto."),
});

const workingHoursSchema = z.object({
  workingDays: z.array(z.number()).min(1, "Selezionare almeno un giorno lavorativo."),
  shifts: z.array(shiftSchema).min(1, "Aggiungere almeno un turno."),
});

type WorkingHoursValues = z.infer<typeof workingHoursSchema>;

const DAYS = [
  { id: 1, label: "Lunedì" },
  { id: 2, label: "Martedì" },
  { id: 3, label: "Mercoledì" },
  { id: 4, label: "Giovedì" },
  { id: 5, label: "Venerdì" },
  { id: 6, label: "Sabato" },
  { id: 7, label: "Domenica" },
];

export default function WorkingHoursPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<WorkingHoursValues>({
    resolver: zodResolver(workingHoursSchema),
    defaultValues: {
      workingDays: [1, 2, 3, 4, 5],
      shifts: [{ id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "shifts",
  });

  useEffect(() => {
    async function loadConfig() {
      setIsLoading(true);
      const config = await getWorkingHoursConfig();
      form.reset(config);
      setIsLoading(false);
    }
    loadConfig();
  }, [form]);

  const onSubmit = async (values: WorkingHoursValues) => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveWorkingHoursConfig(values, user.uid);
    toast({
      title: result.success ? "Successo" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    setIsSaving(false);
  };

  const calculateHours = (start: string, end: string) => {
    try {
      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);
      const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (totalMinutes <= 0) return 0;
      return (totalMinutes / 60).toFixed(2);
    } catch {
      return 0;
    }
  };

  if (isLoading) {
    return (
      <AdminAuthGuard>
        <AppShell>
          <div className="space-y-6 max-w-3xl mx-auto">
            <Skeleton className="h-10 w-64" />
            <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
          </div>
        </AppShell>
      </AdminAuthGuard>
    );
  }

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-3xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              Gestione Orario Lavorativo
            </h1>
            <p className="text-muted-foreground">
              Configura i giorni lavorativi e la struttura dei turni per la programmazione della produzione.
            </p>
          </header>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    Settimana Lavorativa
                  </CardTitle>
                  <CardDescription>Seleziona i giorni in cui l'azienda è operativa.</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="workingDays"
                    render={() => (
                      <FormItem>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                          {DAYS.map((day) => (
                            <FormField
                              key={day.id}
                              control={form.control}
                              name="workingDays"
                              render={({ field }) => {
                                return (
                                  <FormItem
                                    key={day.id}
                                    className="flex flex-row items-start space-x-3 space-y-0"
                                  >
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value?.includes(day.id)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...field.value, day.id])
                                            : field.onChange(
                                                field.value?.filter(
                                                  (value) => value !== day.id
                                                )
                                              )
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal">
                                      {day.label}
                                    </FormLabel>
                                  </FormItem>
                                )
                              }}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      Turni Giornalieri
                    </CardTitle>
                    <CardDescription>Definisci gli orari di attività giornaliera.</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ id: `shift-${Date.now()}`, name: '', startTime: '08:00', endTime: '17:00' })}
                  >
                    <Plus className="h-4 w-4 mr-2" /> Aggiungi Turno
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.map((field, index) => (
                    <div key={field.id} className="space-y-4 p-4 border rounded-lg bg-muted/20 relative">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name={`shifts.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Nome Turno</FormLabel>
                              <FormControl><Input placeholder="Es. Turno Mattina" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`shifts.${index}.startTime`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Inizio</FormLabel>
                              <FormControl><Input type="time" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`shifts.${index}.endTime`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Fine</FormLabel>
                              <FormControl><Input type="time" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">
                          Durata calcolata: <span className="font-bold text-foreground">{calculateHours(form.watch(`shifts.${index}.startTime`), form.watch(`shifts.${index}.endTime`))} ore</span>
                        </span>
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Rimuovi
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
                <CardFooter className="border-t pt-6">
                  <Button type="submit" className="w-full sm:w-auto" disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Salva Configurazione
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
