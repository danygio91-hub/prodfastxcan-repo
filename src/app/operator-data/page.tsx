
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Users, User, Mail, Factory, FileLock, Check, Loader2 } from 'lucide-react';
import { type Operator, type Reparto } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from "@/hooks/use-toast";
import { signPrivacyPolicy } from './actions';
import { getDepartmentMap } from '@/app/admin/settings/actions';


export default function OperatorDataPage() {
  const { user, operator: operatorData, loading, refetchOperator } = useAuth();
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [departmentMap, setDepartmentMap] = useState<{ [key in Reparto]?: string }>({});
  const { toast } = useToast();
  const router = useRouter();
  
  const isSigned = !!operatorData?.privacySigned;

  useEffect(() => {
    if (operatorData) {
      setPrivacyAccepted(!!operatorData.privacySigned);
    }
    getDepartmentMap().then(setDepartmentMap);
  }, [operatorData]);

  const getFullDepartmentName = (repartoCode: string) => {
    return departmentMap[repartoCode as keyof typeof departmentMap] || 'N/D';
  }

  const email = user?.email || '...';
  
  const handleSaveSignature = async () => {
    if (!operatorData) {
        toast({
            variant: "destructive",
            title: "Errore",
            description: "Dati operatore non trovati. Impossibile salvare la firma.",
        });
        return;
    }

    setIsSubmitting(true);
    const result = await signPrivacyPolicy(operatorData.id);

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

  if (loading) {
    return (
       <AppShell>
         <div className="space-y-6">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
         </div>
       </AppShell>
    )
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          {isSigned && <OperatorNavMenu />}

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-xl font-headline mb-1">Dati Operatore</CardTitle>
                  <CardDescription>Le tue informazioni personali. Contatta un amministratore per modificarle.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="flex items-center text-foreground/80">
                    <User className="mr-2 h-5 w-5 text-primary" />
                    Nome
                  </Label>
                  <Input id="firstName" value={operatorData?.nome || '...'} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center text-foreground/80">
                    <Mail className="mr-2 h-5 w-5 text-primary" />
                    Email
                  </Label>
                  <Input id="email" type="email" value={email} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="department" className="flex items-center text-foreground/80">
                    <Factory className="mr-2 h-5 w-5 text-primary" />
                    Reparto di Produzione
                  </Label>
                  <Input id="department" value={operatorData ? getFullDepartmentName(operatorData.reparto) : '...'} readOnly className="bg-input text-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

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
              <div className="p-4 border rounded-md bg-background/50 text-sm text-muted-foreground space-y-2">
                <p>Con la presente, l'utente prende atto e accetta che tutte le informazioni, i dati, i processi e le metodologie accessibili tramite questa applicazione sono di proprietà esclusiva e riservata dell'azienda <strong>Power Flex S.r.l.</strong></p>
                <p>È severamente vietata la divulgazione, la copia, la distribuzione o l'utilizzo di tali dati per scopi non autorizzati e al di fuori delle attività lavorative preposte. La violazione di tali obblighi di riservatezza comporterà sanzioni disciplinari come previsto dalla normativa vigente.</p>
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
        </div>
      </AppShell>
    </AuthGuard>
  );
}
