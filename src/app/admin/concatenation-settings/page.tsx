
"use client";

import React, { useState, useEffect } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Combine, Save, Loader2, Link, Zap, ShieldCheck, Unlink } from 'lucide-react';
import { getConcatenationPolicy, saveConcatenationPolicy, type ConcatenationPolicy } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function ConcatenationSettingsPage() {
  const [policy, setPolicy] = useState<ConcatenationPolicy>({ 
      ungroupAfterPreparation: false, 
      ungroupAfterProduction: false,
      ungroupAfterQuality: false,
  });
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

  const handleSwitchChange = (field: keyof ConcatenationPolicy, checked: boolean) => {
    setPolicy(prev => ({ ...prev, [field]: checked }));
  };

  const renderPolicySwitch = (field: keyof ConcatenationPolicy, title: string, description: string, icon: React.ElementType) => {
    const Icon = icon;
    return (
       <div className="flex items-center space-x-4 rounded-md border p-4">
        <Icon className="h-6 w-6 text-primary" />
        <div className="flex-1 space-y-1">
          <Label htmlFor={field} className="text-base">
            {title}
          </Label>
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <Switch
          id={field}
          checked={policy[field]}
          onCheckedChange={(checked) => handleSwitchChange(field, checked)}
        />
      </div>
    );
  }

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8 max-w-4xl mx-auto">
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
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <>
                  {renderPolicySwitch('ungroupAfterPreparation', 'Annulla Gruppo dopo le Fasi di Preparazione', 'Se attivo, un gruppo verrà sciolto automaticamente quando tutte le sue fasi di tipo "Preparazione" sono state completate.', Zap)}
                  {renderPolicySwitch('ungroupAfterProduction', 'Annulla Gruppo dopo le Fasi di Produzione', 'Se attivo, il gruppo verrà sciolto quando tutte le fasi di "Produzione" saranno completate, prima del collaudo.', Link)}
                  {renderPolicySwitch('ungroupAfterQuality', 'Annulla Gruppo dopo il Controllo Qualità', 'Se attivo, il gruppo verrà sciolto dopo che tutte le fasi di "Qualità" sono state superate.', ShieldCheck)}
                </>
              )}
            </CardContent>
            <CardFooter>
              <Button onClick={handleSave} disabled={isSaving || isLoading}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Salva Impostazioni
              </Button>
            </CardFooter>
          </Card>
          
           <Alert variant="default" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
             <Unlink className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-amber-800 dark:text-amber-300">Regola Speciale: Posticipo Fase</AlertTitle>
            <AlertDescription>
             Attenzione: L'azione "Posticipa Taglio Guaina", se utilizzata su un gruppo di commesse, ne causerà l'annullamento immediato per preservare l'integrità del ciclo di lavorazione. Le commesse torneranno individuali e dovranno essere eventualmente raggruppate di nuovo in seguito.
            </AlertDescription>
          </Alert>

        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
