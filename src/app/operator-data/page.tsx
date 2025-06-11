
"use client";

import React from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Users, User, Mail, Factory } from 'lucide-react';
import { getOperatorName } from '@/lib/auth'; // Assuming we can get the operator's name

interface OperatorData {
  firstName: string;
  lastName: string;
  email: string;
  department: string;
}

// Mock data for the operator
const mockOperatorData: OperatorData = {
  firstName: "Daniel",
  lastName: "Rossi",
  email: "daniel.rossi@example.com",
  department: "Assemblaggio Componenti Elettronici",
};

export default function OperatorDataPage() {
  const operatorName = getOperatorName(); // Get the logged-in operator's name for display

  // In a real application, you would fetch this data based on the logged-in operator
  const operatorData = operatorName === "Daniel" ? mockOperatorData : {
    firstName: "N/A",
    lastName: "N/A",
    email: "N/A",
    department: "N/A",
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <Link href="/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>

          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center space-x-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle className="text-2xl font-headline">Dati Operatore</CardTitle>
                  <CardDescription>Visualizza le informazioni dell'operatore.</CardDescription>
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
                  <Input id="firstName" value={operatorData.firstName} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="flex items-center text-foreground/80">
                    <User className="mr-2 h-5 w-5 text-primary" />
                    Cognome
                  </Label>
                  <Input id="lastName" value={operatorData.lastName} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center text-foreground/80">
                    <Mail className="mr-2 h-5 w-5 text-primary" />
                    Email
                  </Label>
                  <Input id="email" type="email" value={operatorData.email} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department" className="flex items-center text-foreground/80">
                    <Factory className="mr-2 h-5 w-5 text-primary" />
                    Reparto di Produzione
                  </Label>
                  <Input id="department" value={operatorData.department} readOnly className="bg-input text-foreground" />
                </div>
              </div>
               {operatorName !== "Daniel" && (
                <p className="text-sm text-muted-foreground text-center mt-4">
                  Dati operatore di esempio visualizzati. Effettua il login come 'Daniel' per vedere i dati specifici.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
