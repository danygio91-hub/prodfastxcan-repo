
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
import { Clock, Save, Loader2, Plus, Trash2, CalendarDays, Coffee, Percent, Calculator } from 'lucide-react';
import { getWorkingHoursConfig, saveWorkingHoursConfig } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

const shiftSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Il nome del turno è obbligatorio."),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:mm richiesto."),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato HH:mm richiesto."),
  breakMinutes: z.coerce.number().min(0, "La pausa non può essere negativa.").default(0),
});

const workingHoursSchema = z.object({
  workingDays: z.array(z.number()).min(1, "Selezionare almeno un giorno lavorativo."),
  shifts: z.array(shiftSchema).min(1, "Aggiungere almeno un turno."),
  efficiencyPercentage: z.coerce.number().min(1, "L'efficienza deve essere almeno 1%").max(100, "L'efficienza non può superare 100%").default(95),
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
      shifts: [{ id: 'shift-1', name: 'Turno Centrale', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }],
      efficiencyPercentage: 95,
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

  const calculateDetailedHours = (start: string, end: string, breakMins: number, efficiency: number) => {
    try {
      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);
      const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (totalMinutes <= 0) return { total: 0, net: 0, effective: 0 };
      
      const total = totalMinutes / 60;
      const net = Math.max(0, (totalMinutes - breakMins) / 60);
      const effective = net * (efficiency / 100);
      
      return { 
        total: total.toFixed(2), 
        net: net.toFixed(2), 
        effective: effective.toFixed(2) 
      };
    } catch {
      return { total: 0, net: 0, effective: 0 };
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

  const efficiency = form.watch('efficiencyPercentage') || 95;

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
              Configura i giorni lavorativi, i turni e l'efficienza stimata per la pianificazione.
            </p>
          </header>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-2">
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
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Percent className="h-5 w-5 text-primary" />
                            Efficienza
                        </CardTitle>
                        <CardDescription>Percentuale di lavoro effettivo.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FormField
                            control={form.control}
                            name="efficiencyPercentage"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Indice Efficienza (%)</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input type="number" {...field} className="pr-8" />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                                        </div>
                                    </FormControl>
                                    <FormDescription className="text-[10px] leading-tight">
                                        Considera pause fisiologiche e tempi morti tecnici.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      Turni Giornalieri
                    </CardTitle>
                    <CardDescription>Definisci gli orari e le pause di attività.</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ id: `shift-${Date.now()}`, name: '', startTime: '08:00', endTime: '17:00', breakMinutes: 60 })}
                  >
                    <Plus className="h-4 w-4 mr-2" /> Aggiungi Turno
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.map((field, index) => {
                    const stats = calculateDetailedHours(
                        form.watch(`shifts.${index}.startTime`),
                        form.watch(`shifts.${index}.endTime`),
                        form.watch(`shifts.${index}.breakMinutes`),
                        efficiency
                    );

                    return (
                    <div key={field.id} className="space-y-4 p-4 border rounded-lg bg-muted/20 relative">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        <FormField
                          control={form.control}
                          name={`shifts.${index}.name`}
                          render={({ field }) => (
                            <FormItem className="sm:col-span-1">
                              <FormLabel>Nome Turno</FormLabel>
                              <FormControl><Input placeholder="Es. Turno Centrale" {...field} /></FormControl>
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
                        <FormField
                          control={form.control}
                          name={`shifts.${index}.breakMinutes`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center gap-2"><Coffee className="h-3 w-3" />Pausa (min)</FormLabel>
                              <FormControl><Input type="number" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <Separator className="bg-border/50" />

                      <div className="flex flex-wrap justify-between items-center gap-4">
                        <div className="flex gap-4">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground">Ore Totali</span>
                                <Badge variant="secondary" className="font-mono text-sm w-fit">{stats.total} h</Badge>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground">Ore Nette</span>
                                <Badge variant="outline" className="font-mono text-sm w-fit border-blue-500/50 text-blue-600">{stats.net} h</Badge>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold text-primary">Capacità Reale (Effettiva)</span>
                                <Badge variant="default" className="font-mono text-base w-fit bg-green-600 hover:bg-green-600">
                                    <Calculator className="h-3 w-3 mr-1.5" />
                                    {stats.effective} h
                                </Badge>
                            </div>
                        </div>
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Rimuovi Turno
                          </Button>
                        )}
                      </div>
                    </div>
                  )})}
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
