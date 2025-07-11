
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FileLock, Check, Loader2 } from 'lucide-react';
import { type Operator } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from "@/hooks/use-toast";
import { signPrivacyPolicy } from './actions';

interface PrivacyFormProps {
    operator: Operator;
}

export default function PrivacyForm({ operator }: PrivacyFormProps) {
    const { refetchOperator } = useAuth();
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();
    const router = useRouter();

    const isSigned = !!operator.privacySigned;

    useEffect(() => {
        setPrivacyAccepted(isSigned);
    }, [isSigned]);
  
    const handleSaveSignature = async () => {
        if (!operator) {
            toast({
                variant: "destructive",
                title: "Errore",
                description: "Dati operatore non trovati. Impossibile salvare la firma.",
            });
            return;
        }

        setIsSubmitting(true);
        const result = await signPrivacyPolicy(operator.id);

        if (result.success) {
            toast({
                title: "Firma Salvata",
                description: "Grazie per aver accettato. Verrai reindirizzato alla dashboard.",
            });
            await refetchOperator();
            router.push('/dashboard');
        } else {
            toast({
                variant: "destructive",
                title: "Errore",
                description: result.message,
            });
        }
        setIsSubmitting(false);
    };

    return (
        <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <FileLock className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-xl font-headline mb-1">Informativa sulla Privacy e Riservatezza</CardTitle>
                  <CardDescription>
                    {isSigned 
                      ? "Hai già accettato l'informativa." 
                      : "Presa visione obbligatoria per l'utilizzo dell'applicazione."
                    }
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 border rounded-md bg-background/50 text-sm text-muted-foreground space-y-3">
                <h4 className="font-bold text-foreground">Informativa sulla Riservatezza e Diritti di Proprietà</h4>
                <p><strong>Power Flex S.r.l.</strong> detiene tutti i diritti esclusivi e la piena proprietà intellettuale sull'applicazione ProdFastXcan e su ogni suo componente, contenuto, algoritmo e dato in essa integrato o da essa generato.</p>
                <p>È severamente vietata qualsiasi forma di divulgazione, riproduzione, distribuzione o utilizzo esterno di ProdFastXcan, in parte o per intero, senza la preventiva autorizzazione scritta di <strong>Power Flex S.r.l.</strong> Questo include, ma non si limita a, la condivisione di schermate, dati, funzionalità o logiche operative.</p>
                <p>L'utilizzo di ProdFastXcan è esclusivamente concesso per fini interni all'azienda <strong>Power Flex S.r.l.</strong> e per le sole attività connesse ai processi di produzione. Ogni altro uso è espressamente proibito.</p>
                <p className="font-semibold">La presente informativa è da intendersi accettata e vincolante per tutti gli utenti e collaboratori che accedono o utilizzano l'applicazione ProdFastXcan.</p>
              </div>
              <div className="flex items-center space-x-2 pt-4">
                 <Checkbox 
                    id="privacy" 
                    checked={privacyAccepted} 
                    onCheckedChange={(checked) => setPrivacyAccepted(checked as boolean)}
                    disabled={isSigned}
                />
                <Label htmlFor="privacy" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Dichiaro di aver letto e compreso l'informativa sulla privacy.
                </Label>
              </div>
            </CardContent>
            <CardFooter>
               {isSigned ? (
                <div className="w-full text-center text-green-500 font-semibold flex items-center justify-center">
                    <Check className="mr-2 h-5 w-5"/>
                    Informativa accettata e firmata.
                </div>
               ) : (
                <Button 
                    className="w-full"
                    onClick={handleSaveSignature}
                    disabled={!privacyAccepted || isSubmitting}
                >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    Salva Firma e Accetta
                </Button>
               )}
            </CardFooter>
        </Card>
    );
}
