
"use client";

import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/components/auth/AuthProvider';

export default function ClockInOutPage() {
  const { toast } = useToast();
  const { logout, operator } = useAuth();

  const handleAction = async (action: 'in' | 'out') => {
    const title = action === 'in' ? "Timbratura di Ingresso" : "Timbratura di Uscita";
    const description = "Operazione registrata con successo. Verrai disconnesso.";

    toast({ title, description });

    // Simulate API call to log the clocking event
    // In a real app, you would send this to your backend/Firebase.
    console.log(`Clock event: ${action} for operator: ${operator?.id}`);
    await new Promise(resolve => setTimeout(resolve, 1500)); 

    // Log out automatically after the action
    await logout();
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader className="text-center">
              <div className="mx-auto bg-primary text-primary-foreground rounded-full h-16 w-16 flex items-center justify-center mb-4">
                <Clock className="h-8 w-8" />
              </div>
              <CardTitle className="text-2xl font-headline">Timbratura Rapida</CardTitle>
              <CardDescription>
                Benvenuto, {operator?.nome}. Seleziona la tua azione.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              <Button
                variant="default"
                className="h-24 text-xl"
                onClick={() => handleAction('in')}
              >
                <LogIn className="mr-4 h-8 w-8" />
                Registra Entrata
              </Button>
              <Button
                variant="destructive"
                className="h-24 text-xl"
                onClick={() => handleAction('out')}
              >
                <LogOut className="mr-4 h-8 w-8" />
                Registra Uscita
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
