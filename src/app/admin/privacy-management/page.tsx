
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

// A simple rich text editor component. In a real app, you'd use a library like TipTap or TinyMCE.
function SimpleRichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // This is a simple implementation. For a real app, a proper rich text editor would be needed.
  return (
    <div className="prose dark:prose-invert max-w-none">
        <textarea
            value={value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '').replace(/<\/?strong>/gi, '')}
            onChange={(e) => {
                const htmlValue = e.target.value.split('\n').map(p => `<p>${p}</p>`).join('');
                onChange(htmlValue);
            }}
            className="w-full h-80 p-4 border rounded-md bg-background"
            placeholder="Scrivi qui il testo dell'informativa..."
        />
    </div>
  );
}


export default function PrivacyManagementPage() {
  const [policy, setPolicy] = useState<{ content: string, lastUpdated: string | null }>({ content: '', lastUpdated: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const fetchPolicy = async () => {
    setIsLoading(true);
    try {
        const data = await getPrivacyPolicy();
        setPolicy(data);
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
      const result = await savePrivacyPolicy(policy.content, user.uid);
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
              <div className="flex justify-between items-center">
                <div>
                    <CardTitle>Editor Informativa</CardTitle>
                    <CardDescription>
                        {policy.lastUpdated 
                            ? `Ultimo aggiornamento: ${format(new Date(policy.lastUpdated), 'dd MMMM yyyy HH:mm', { locale: it })}`
                            : "Nessuna modifica ancora salvata."}
                    </CardDescription>
                </div>
                <Button onClick={handleSave} disabled={isPending || isLoading}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Salva e Richiedi Nuova Firma
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="p-4 border rounded-md">
                     <div dangerouslySetInnerHTML={{ __html: policy.content }} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
