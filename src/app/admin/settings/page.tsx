import Link from 'next/link';
import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Building2, ListTodo, Users, Workflow, Computer, ArrowRight } from 'lucide-react';
import { departmentMap, reparti } from '@/lib/mock-data';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function AdminCompanySettingsPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
          <AdminNavMenu />

          <header className="space-y-2">
            <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              Configurazione Azienda
            </h1>
            <p className="text-muted-foreground">
              Gestisci le impostazioni operative principali della tua azienda.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Link href="/admin/operator-management">
                <Card className="h-full hover:shadow-lg hover:border-primary/50 transition-all duration-300 group">
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                             <div className="flex items-center gap-3">
                                <Users className="h-7 w-7 text-primary" />
                                <span>Gestione Operatori</span>
                            </div>
                           <Button variant="ghost" size="icon" className="text-muted-foreground group-hover:text-primary transition-colors">
                                <ArrowRight className="h-5 w-5" />
                           </Button>
                        </CardTitle>
                        <CardDescription>
                          Aggiungi, modifica o rimuovi gli operatori e i loro permessi.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </Link>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <ListTodo className="h-7 w-7 text-primary" />
                  Gestione/Nomi Reparti
                </CardTitle>
                <CardDescription>
                  Visualizza i nomi dei reparti. La modifica sarà disponibile in futuro.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {reparti.map(code => (
                  <div key={code} className="flex items-center gap-4">
                    <Label htmlFor={`reparto-${code}`} className="w-1/4 font-semibold">{code}</Label>
                    <Input
                      id={`reparto-${code}`}
                      value={departmentMap[code as keyof typeof departmentMap] || 'Non Definito'}
                      readOnly
                      className="bg-muted/50"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

             <Card className="opacity-50 cursor-not-allowed">
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        <Workflow className="h-7 w-7 text-primary" />
                        <span>Gestione Fasi di Lavorazione</span>
                    </CardTitle>
                    <CardDescription>
                        Definisci le fasi standard per ogni reparto. (Prossimamente)
                    </CardDescription>
                </CardHeader>
            </Card>

            <Card className="opacity-50 cursor-not-allowed">
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        <Computer className="h-7 w-7 text-primary" />
                        <span>Gestione Postazioni di Lavoro</span>
                    </CardTitle>
                    <CardDescription>
                       Configura e assegna le postazioni di lavoro. (Prossimamente)
                    </CardDescription>
                </CardHeader>
            </Card>
          </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
