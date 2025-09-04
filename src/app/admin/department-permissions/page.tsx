"use client";

import React, { useState, useEffect, useTransition } from 'react';
import { useToast } from '@/hooks/use-toast';

import { getDepartmentPermissions, saveDepartmentPermission } from './actions';
import type { DepartmentPermissions, PhaseType } from './actions';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { LockKeyhole, Loader2, Save } from 'lucide-react';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';

const phaseTypes: { id: PhaseType; label: string }[] = [
  { id: 'preparation', label: 'Preparazione' },
  { id: 'production', label: 'Produzione' },
  { id: 'quality', label: 'Qualità' },
  { id: 'packaging', label: 'Packaging' },
];

function PermissionsTable() {
  const [permissions, setPermissions] = useState<DepartmentPermissions[]>([]);
  const [initialPermissions, setInitialPermissions] = useState<DepartmentPermissions[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const fetchData = async () => {
    setIsLoading(true);
    const data = await getDepartmentPermissions();
    setPermissions(data);
    setInitialPermissions(JSON.parse(JSON.stringify(data))); // Deep copy for initial state
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  const handlePermissionChange = (departmentCode: string, phaseType: PhaseType, checked: boolean) => {
    setPermissions(currentPermissions =>
      currentPermissions.map(p => {
        if (p.departmentCode === departmentCode) {
          const newAllowedTypes = checked
            ? [...p.allowedPhaseTypes, phaseType]
            : p.allowedPhaseTypes.filter(t => t !== phaseType);
          return { ...p, allowedPhaseTypes: newAllowedTypes };
        }
        return p;
      })
    );
  };

  const handleSaveAll = () => {
    startTransition(async () => {
      let successCount = 0;
      for (const permission of permissions) {
        const result = await saveDepartmentPermission(permission.departmentCode, permission.allowedPhaseTypes);
        if(result.success) successCount++;
      }
      if(successCount === permissions.length) {
        toast({ title: 'Successo', description: 'Tutti i permessi sono stati salvati.' });
        fetchData(); // Refetch to reset initial state
      } else {
        toast({ variant: 'destructive', title: 'Errore', description: 'Alcuni permessi non sono stati salvati correttamente.' });
      }
    });
  };
  
  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(initialPermissions);

  const renderLoading = () => (
    <TableRow>
      <TableCell colSpan={phaseTypes.length + 1} className="h-24 text-center">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Caricamento permessi...</span>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Matrice Permessi Reparto/Fase</CardTitle>
                <CardDescription>Definisci quali tipi di fase ogni reparto è autorizzato a eseguire.</CardDescription>
            </div>
            <Button onClick={handleSaveAll} disabled={isPending || !hasChanges}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
              Salva Modifiche
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reparto</TableHead>
                {phaseTypes.map(pt => <TableHead key={pt.id} className="text-center">{pt.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? renderLoading() : permissions.map((dept) => (
                <TableRow key={dept.departmentCode}>
                  <TableCell className="font-medium">{dept.departmentName}</TableCell>
                  {phaseTypes.map(pt => (
                    <TableCell key={pt.id} className="text-center">
                      <Checkbox
                        checked={dept.allowedPhaseTypes.includes(pt.id)}
                        onCheckedChange={(checked) => handlePermissionChange(dept.departmentCode, pt.id, !!checked)}
                        aria-label={`Permesso per ${dept.departmentName} su ${pt.label}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}


export default function DepartmentPermissionsPage() {
    return (
        <AdminAuthGuard>
            <AppShell>
                <div className="space-y-6">
                    <header>
                        <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                            <LockKeyhole className="h-8 w-8 text-primary" />
                            Gestione Permessi Reparto
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Associa i tipi di fase di lavorazione ai reparti di competenza.
                        </p>
                    </header>
                    <PermissionsTable />
                </div>
            </AppShell>
        </AdminAuthGuard>
    )
}
