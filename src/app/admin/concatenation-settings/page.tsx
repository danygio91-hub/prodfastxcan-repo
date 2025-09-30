
"use client";

import React, { useState, useEffect } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Combine, Save, Loader2, Link2, Zap } from 'lucide-react';
import { getConcatenationPolicy, saveConcatenationPolicy } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConcatenationSettingsPage() {
  const [policy, setPolicy] = useState<{ ungroupAfterPreparation: boolean }>({ ungroupAfterPreparation: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchPolicy = async () => {
    setIsLoading(true);
    try {
        const data = await getConcatenationPolicy();
        setPolicy(data);
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
    fetchPolicy();
  }, []);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveConcatenationPolicy(policy, user.uid);
    toast({
      title: result.success ? "Impostazioni Salvate" : "Errore",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
    if (result.success) {
      await fetchPolicy();
    }
    setIsSaving(false);
  };

  const handleSwitchChange = (checked: boolean) => {
    setPolicy(prev => ({ ...prev, ungroupAfterPreparation: checked }));
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-3xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Combine className="h-8 w-8 text-primary" />
              Gestione Concatena
            </h1>
            <p className="text-muted-foreground">
              Definisci le regole per lo slegamento automatico dei gruppi di commesse.
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Regole di Slegamento Automatico</CardTitle>
              <CardDescription>
                Attiva queste opzioni per far sì che i gruppi di commesse si annullino automaticamente al completamento di determinate tipologie di fasi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-6 w-6" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[250px]" />
                    <Skeleton className="h-4 w-[200px]" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-4 rounded-md border p-4">
                  <Zap className="h-6 w-6 text-primary" />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="ungroup-preparation" className="text-base">
                      Annulla Gruppo dopo le Fasi di Preparazione
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Se attivo, un gruppo verrà sciolto automaticamente quando tutte le sue fasi di tipo "Preparazione" sono state completate.
                    </p>
                  </div>
                  <Switch
                    id="ungroup-preparation"
                    checked={policy.ungroupAfterPreparation}
                    onCheckedChange={handleSwitchChange}
                  />
                </div>
              )}
               {/* Placeholder for future rules */}
                <div className="flex items-center space-x-4 rounded-md border p-4 opacity-50 cursor-not-allowed">
                  <Link2 className="h-6 w-6" />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="ungroup-production" className="text-base">
                      Annulla Gruppo dopo le Fasi di Produzione (Prossimamente)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Questa opzione non è ancora disponibile.
                    </p>
                  </div>
                  <Switch id="ungroup-production" disabled />
                </div>
            </CardContent>
            <CardContent>
              <Button onClick={handleSave} disabled={isSaving || isLoading}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Salva Impostazioni
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
