
"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Users, User, Mail, Factory, FileLock, Check, Loader2, ArrowLeft } from 'lucide-react';
import { type Operator, type Reparto } from '@/lib/mock-data';
import { useAuth } from '@/components/auth/AuthProvider';
import OperatorNavMenu from '@/components/operator/OperatorNavMenu';
import { getDepartmentMap } from '@/app/admin/settings/actions';
import PrivacyForm from './PrivacyForm';


export default function OperatorDataPage() {
  const { operator, loading } = useAuth();
  const [departmentMap, setDepartmentMap] = React.useState<{ [key in Reparto]?: string }>({});
  const router = useRouter();
  
  React.useEffect(() => {
    getDepartmentMap().then(setDepartmentMap);
  }, []);

  const getFullDepartmentName = (repartoCode: string) => {
    return departmentMap[repartoCode as keyof typeof departmentMap] || 'N/D';
  }

  const email = operator?.email || '...';

  if (loading || !operator) {
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
        <div className="space-y-6 max-w-2xl mx-auto">
          {operator?.privacySigned && <OperatorNavMenu />}
          
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
                  <Input id="firstName" value={operator?.nome || '...'} readOnly className="bg-input text-foreground" />
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
                  <Input id="department" value={operator ? getFullDepartmentName(operator.reparto) : '...'} readOnly className="bg-input text-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <PrivacyForm operator={operator} />

        </div>
      </AppShell>
    </AuthGuard>
  );
}

