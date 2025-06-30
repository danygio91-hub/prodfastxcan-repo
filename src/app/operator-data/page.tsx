"use client";

import React, { useState, useEffect } from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Users, User, Mail, Factory } from 'lucide-react';
import { getOperator } from '@/lib/auth';
import type { Operator } from '@/lib/mock-data';
import { departmentMap } from '@/lib/mock-data';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';


export default function OperatorDataPage() {
  const [operatorData, setOperatorData] = useState<Operator | null>(null);

  useEffect(() => {
    const operator = getOperator();
    setOperatorData(operator);
  }, []);

  const getFullDepartmentName = (repartoCode: string) => {
    return departmentMap[repartoCode as keyof typeof departmentMap] || 'N/D';
  }

  const email = operatorData ? `${operatorData.nome.toLowerCase()}.${operatorData.cognome.toLowerCase()}@example.com` : "N/A";
  
  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6">
          <OperatorNavMenu />

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
                  <Label htmlFor="lastName" className="flex items-center text-foreground/80">
                    <User className="mr-2 h-5 w-5 text-primary" />
                    Cognome
                  </Label>
                  <Input id="lastName" value={operatorData?.cognome || '...'} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center text-foreground/80">
                    <Mail className="mr-2 h-5 w-5 text-primary" />
                    Email
                  </Label>
                  <Input id="email" type="email" value={email} readOnly className="bg-input text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department" className="flex items-center text-foreground/80">
                    <Factory className="mr-2 h-5 w-5 text-primary" />
                    Reparto di Produzione
                  </Label>
                  <Input id="department" value={operatorData ? getFullDepartmentName(operatorData.reparto) : '...'} readOnly className="bg-input text-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
