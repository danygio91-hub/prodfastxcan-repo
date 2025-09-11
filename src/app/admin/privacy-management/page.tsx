
"use client";

import React, { useState, useEffect, useTransition } from 'react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { LockKeyhole, Save, Loader2, RefreshCw } from 'lucide-react';
import { getPrivacyPolicy, savePrivacyPolicy } from './actions';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';


export default function PrivacyManagementPage() {
  const [policy, setPolicy] = useState<{ content: string, lastUpdated: string | null }>({ content: '', lastUpdated: null });
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const fetchPolicy = async () => {
    setIsLoading(true);
    try {
        const data = await getPrivacyPolicy();
        setPolicy(data);
        // Convert simple HTML to text for textarea
        setEditedContent(data.content.replace(/<p>/g, '').replace(/<\/p>/g, '\n\n').replace(/<strong>/g, '').replace(/<\/strong>/g, '').trim());
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Errore",
            description: "Impossibile caricare l'informativa sulla privacy.",
        });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPolicy();
  }, []);

  const handleSave = () => {
    if (!user) return;
    startTransition(async () => {
      // Convert text back to simple HTML
      const htmlContent = editedContent
        .split('\n')
        .filter(p => p.trim() !== '')
        .map(p => `<p>${p}</p>`)
        .join('');
        
      const result = await savePrivacyPolicy(htmlContent, user.uid);
      toast({
        title: result.success ? "Operazione Completata" : "Operazione Fallita",
        description: result.message,
        variant: result.success ? "default" : "destructive",
        duration: 9000,
      });
      if (result.success) {
        await fetchPolicy();
      }
    });
  };

  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <LockKeyhole className="h-8 w-8 text-primary" />
              Gestione Informativa Privacy
            </h1>
            <p className="text-muted-foreground">
              Modifica il testo dell'informativa sulla privacy che gli operatori devono accettare al primo accesso o dopo una modifica.
            </p>
          </header>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div>
                    <CardTitle>Editor Informativa</CardTitle>
                    <CardDescription>
                        {policy.lastUpdated 
                            ? `Ultimo aggiornamento: ${format(new Date(policy.lastUpdated), 'dd MMMM yyyy HH:mm', { locale: it })}`
                            : "Nessuna modifica ancora salvata."}
                    </CardDescription>
                </div>
                <Button onClick={handleSave} disabled={isPending || isLoading || editedContent === policy.content}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Salva e Richiedi Nuova Firma
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : (
                <Textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full h-80 p-4 border rounded-md bg-background"
                    placeholder="Scrivi qui il testo dell'informativa..."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
