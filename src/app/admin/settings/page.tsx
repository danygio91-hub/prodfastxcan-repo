import AdminAuthGuard from '@/components/AdminAuthGuard';
import AppShell from '@/components/layout/AppShell';
import AdminNavMenu from '@/components/admin/AdminNavMenu';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Settings, Brush, ListTodo } from 'lucide-react';
import { departmentMap, reparti } from '@/lib/mock-data';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from '@/components/ui/separator';

export default function AdminSettingsPage() {
  return (
    <AdminAuthGuard>
      <AppShell>
        <div className="space-y-8">
            <AdminNavMenu />

            <header className="space-y-2">
                <h1 className="text-3xl font-bold font-headline tracking-tight flex items-center gap-3">
                    <Settings className="h-8 w-8 text-primary" />
                    Configurazione App
                </h1>
                <p className="text-muted-foreground">
                    Impostazioni generali e personalizzazione dell'applicazione.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ListTodo className="h-6 w-6 text-primary" />
                            Nomi Reparti
                        </CardTitle>
                        <CardDescription>
                            Visualizza i nomi associati ai codici dei reparti. La modifica sarà disponibile in un aggiornamento futuro.
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

                <Card>
                    <CardHeader>
                         <CardTitle className="flex items-center gap-2">
                            <Brush className="h-6 w-6 text-primary" />
                            Personalizzazione Tema
                        </CardTitle>
                        <CardDescription>
                            Scegli il tema dell'applicazione. Puoi cambiarlo in qualsiasi momento usando il pulsante in basso a destra.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div>
                             <Label>Tema Attuale</Label>
                             <p className="text-sm text-muted-foreground">
                                L'applicazione supporta un tema chiaro e uno scuro. Usa il selettore per cambiare l'aspetto.
                             </p>
                        </div>
                        <Separator />
                        <div>
                            <Label>Anteprima Colori Principali</Label>
                            <div className="flex space-x-4 mt-2">
                                <div className="flex flex-col items-center">
                                    <div className="w-10 h-10 rounded-full bg-primary border-2 border-border"></div>
                                    <span className="text-xs mt-1">Primary</span>
                                </div>
                                 <div className="flex flex-col items-center">
                                    <div className="w-10 h-10 rounded-full bg-secondary border-2 border-border"></div>
                                    <span className="text-xs mt-1">Secondary</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="w-10 h-10 rounded-full bg-accent border-2 border-border"></div>
                                    <span className="text-xs mt-1">Accent</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="w-10 h-10 rounded-full bg-destructive border-2 border-border"></div>
                                    <span className="text-xs mt-1">Destructive</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
      </AppShell>
    </AdminAuthGuard>
  );
}
